from datetime import datetime, timezone
import asyncio
import importlib.util
from pathlib import Path
from typing import Any, TypedDict

from telethon import TelegramClient

from api_client.main_trading_api import MainTradingApiClient
from models.parse_context import ParseContext
from parser.router import SignalParserRouter
from parser.signal_quality import has_trade_text
from providers.config import ProviderConfig


def _load_local_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_message_media = _load_local_module("tg_message_media", "message_media.py")
download_photo_base64 = _message_media.download_photo_base64


async def _build_context_from_message(client: TelegramClient, message, followed: dict) -> ParseContext | None:
    text = (message.raw_text or message.message or "").strip()
    image_b64 = await download_photo_base64(client, message) if message.photo else None
    if not text and not image_b64:
        return None
    metadata = followed.get("metadata") or {}
    return ParseContext(
        text=text,
        image_b64=image_b64,
        has_image=bool(image_b64),
        group_title=followed.get("title") or "",
        group_username=followed.get("username"),
        format_profile=metadata.get("format_profile") or {},
    )


async def _message_timestamp(message) -> str:
    msg_time = message.date
    if msg_time:
        if msg_time.tzinfo is None:
            msg_time = msg_time.replace(tzinfo=timezone.utc)
        return msg_time.isoformat()
    return datetime.now(timezone.utc).isoformat()


def _worth_scanning(context: ParseContext) -> bool:
    if has_trade_text(context.text or ""):
        return True
    if context.has_image and context.text.strip():
        return True
    return False


async def archive_recent_messages(
    client: TelegramClient,
    source: dict[str, Any],
    api_client: MainTradingApiClient,
    *,
    limit: int = 50,
) -> dict[str, int]:
    """Store last N messages raw (text + image) for audit — no parsing."""
    chat_id = int(source["telegram_chat_id"])
    stats = {"archived": 0, "skipped_empty": 0}

    async for message in client.iter_messages(chat_id, limit=limit):
        context = await _build_context_from_message(client, message, source)
        if not context:
            stats["skipped_empty"] += 1
            continue
        timestamp = await _message_timestamp(message)
        await api_client.save_message({
            "source_id": source.get("id"),
            "telegram_chat_id": chat_id,
            "message_id": message.id,
            "raw_message": context.combined_text() or context.text or "[image only]",
            "parse_status": "archived",
            "message_date": timestamp,
            "api_result": {"pipeline_stage": "archived", "archive": True},
            "audit": {
                "has_image": context.has_image,
                "original_text": context.text or "",
                "image_base64": context.image_b64,
                "image_mime": "image/jpeg",
                "parse_stage": "archived",
            },
        })
        stats["archived"] += 1
        await asyncio.sleep(1.5)

    metadata = dict(source.get("metadata") or {})
    metadata["last_archive_at"] = datetime.now(timezone.utc).isoformat()
    metadata["last_archive_stats"] = stats
    metadata.pop("archive_requested_at", None)
    metadata.pop("archive_limit", None)
    await api_client.update_source(source["id"], {"metadata": metadata})
    return stats


async def _save_parsed(
    api_client: MainTradingApiClient,
    base_record: dict,
    payload: dict,
) -> dict[str, Any]:
    result = await api_client.validate_signal(payload)
    passed = bool(result.get("passed"))
    await api_client.supersede_chat_messages(
        base_record["telegram_chat_id"],
        keep_message_id=base_record["message_id"],
    )
    await api_client.save_message({
        **base_record,
        "parsed_signal": payload,
        "parse_status": "parsed",
        "api_result": {**result, "scrape": True},
    })
    return {"parsed": 1, "validated": int(passed), "rejected": int(not passed)}


async def scrape_source(
    client: TelegramClient,
    source: dict[str, Any],
    parser: SignalParserRouter,
    api_client: MainTradingApiClient,
    *,
    limit: int = 25,
    latest_signal_only: bool = False,
) -> dict[str, int]:
    chat_id = int(source["telegram_chat_id"])
    stats = {"scanned": 0, "parsed": 0, "skipped": 0, "validated": 0, "rejected": 0}

    provider = ProviderConfig(
        id=source.get("provider_id") or str(chat_id),
        name=source.get("title") or str(chat_id),
        chats=[chat_id],
        parser=source.get("parser") or "generic",
        enabled=True,
    )

    scan_limit = max(limit, 25) if latest_signal_only else limit
    found = False

    async for message in client.iter_messages(chat_id, limit=scan_limit):
        stats["scanned"] += 1
        context = await _build_context_from_message(client, message, source)
        if not context or not _worth_scanning(context):
            continue

        parsed = parser.parse(context, provider)
        timestamp = await _message_timestamp(message)
        base_record = {
            "source_id": source.get("id"),
            "telegram_chat_id": chat_id,
            "message_id": message.id,
            "raw_message": context.combined_text() or context.text,
            "message_date": timestamp,
        }

        if not parsed:
            continue

        parsed.timestamp = timestamp
        parsed.provider_message_id = message.id
        parsed.source_chat_id = chat_id
        payload = parsed.to_main_api_payload()

        saved = await _save_parsed(api_client, base_record, payload)
        stats["parsed"] += saved["parsed"]
        stats["validated"] += saved["validated"]
        stats["rejected"] += saved["rejected"]
        found = True

        if latest_signal_only:
            print(f"[SignalIngestion] Latest signal for {source.get('title')}: {payload.get('symbol')} {payload.get('side')}")
            break

    if latest_signal_only and not found:
        stats["skipped"] = 1
        print(f"[SignalIngestion] No valid signal in last {stats['scanned']} messages for {source.get('title')}")

    metadata = dict(source.get("metadata") or {})
    metadata["last_scrape_at"] = datetime.now(timezone.utc).isoformat()
    metadata["last_scrape_stats"] = stats
    metadata["scrape_latest_signal"] = latest_signal_only
    metadata.pop("scrape_requested_at", None)
    await api_client.update_source(source["id"], {"metadata": metadata})
    return stats


async def _report_scrape_progress(
    api_client: MainTradingApiClient,
    sources: list[dict[str, Any]],
    *,
    status: str,
    completed: int,
    current_title: str | None = None,
    results: list[dict[str, Any]] | None = None,
    error: str | None = None,
) -> None:
    progress = {
        "status": status,
        "total": len(sources),
        "completed": completed,
        "current": current_title,
        "results": results or [],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if error:
        progress["error"] = error
    await asyncio.gather(
        *[
            api_client.update_source(
                source["id"],
                {
                    "metadata": {
                        **(source.get("metadata") or {}),
                        "scrape_progress": progress,
                    },
                },
            )
            for source in sources
        ],
        return_exceptions=True,
    )


class ScrapeTotals(TypedDict):
    scanned: int
    parsed: int
    skipped: int
    validated: int
    rejected: int


class ScrapeSummary(TypedDict):
    groups: int
    results: list[dict[str, Any]]
    totals: ScrapeTotals


async def scrape_followed_groups(
    client: TelegramClient,
    api_client: MainTradingApiClient,
    parser: SignalParserRouter,
    *,
    limit: int = 25,
    learn_formats: bool = False,
    latest_signal_only: bool = True,
) -> ScrapeSummary:
    sources = await api_client.followed_sources()
    summary: ScrapeSummary = {
        "groups": len(sources),
        "results": [],
        "totals": {"scanned": 0, "parsed": 0, "skipped": 0, "validated": 0, "rejected": 0},
    }

    if not sources:
        return summary

    await _report_scrape_progress(api_client, sources, status="running", completed=0, current_title="Starting…")

    for index, source in enumerate(sources):
        title = source.get("title") or source.get("telegram_chat_id")
        await _report_scrape_progress(
            api_client,
            sources,
            status="running",
            completed=index,
            current_title=title,
            results=summary["results"],
        )
        try:
            meta = source.get("metadata") or {}
            per_source_limit = int(meta.get("scrape_limit") or limit)
            stats = await scrape_source(
                client,
                source,
                parser,
                api_client,
                limit=per_source_limit,
                latest_signal_only=latest_signal_only or bool(meta.get("scrape_latest_signal", True)),
            )
            for key in summary["totals"]:
                summary["totals"][key] += stats.get(key, 0)
            row = {"title": title, **stats}
            summary["results"].append(row)
            print(f"[SignalIngestion] Scrape {title}: {stats}", flush=True)
        except Exception as err:  # noqa: BLE001
            summary["results"].append({"title": title, "error": str(err)})
            print(f"[SignalIngestion] Scrape failed {title}: {err}", flush=True)
            await _report_scrape_progress(
                api_client,
                sources,
                status="running",
                completed=index + 1,
                current_title=None,
                results=summary["results"],
                error=str(err),
            )

    await _report_scrape_progress(
        api_client,
        sources,
        status="done",
        completed=len(sources),
        current_title=None,
        results=summary["results"],
    )
    return summary
