from datetime import datetime, timezone
import importlib.util
from pathlib import Path
from typing import Any

from telethon import TelegramClient

from api_client.main_trading_api import MainTradingApiClient
from models.parse_context import ParseContext
from parser.router import SignalParserRouter
from providers.config import ProviderConfig


def _load_local_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


_format_learner = _load_local_module("tg_format_learner", "format_learner.py")
_message_media = _load_local_module("tg_message_media", "message_media.py")
learn_and_store_group_format = _format_learner.learn_and_store_group_format
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


async def scrape_source(
    client: TelegramClient,
    source: dict[str, Any],
    parser: SignalParserRouter,
    api_client: MainTradingApiClient,
    *,
    limit: int = 25,
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

    async for message in client.iter_messages(chat_id, limit=limit):
        stats["scanned"] += 1
        context = await _build_context_from_message(client, message, source)
        if not context:
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
            await api_client.save_message({
                **base_record,
                "parsed_signal": None,
                "parse_status": "skipped",
                "api_result": {"is_signal": False, "scrape": True},
            })
            stats["skipped"] += 1
            continue

        parsed.timestamp = timestamp
        parsed.provider_message_id = message.id
        parsed.source_chat_id = chat_id
        payload = parsed.to_main_api_payload()

        result = await api_client.validate_signal(payload)
        passed = bool(result.get("passed"))
        if passed:
            stats["validated"] += 1
        else:
            stats["rejected"] += 1

        await api_client.save_message({
            **base_record,
            "parsed_signal": payload,
            "parse_status": "parsed",
            "api_result": {**result, "scrape": True},
        })
        stats["parsed"] += 1

    metadata = dict(source.get("metadata") or {})
    metadata["last_scrape_at"] = datetime.now(timezone.utc).isoformat()
    metadata["last_scrape_stats"] = stats
    metadata.pop("scrape_requested_at", None)
    await api_client.update_source(source["id"], {"metadata": metadata})
    return stats


async def scrape_followed_groups(
    client: TelegramClient,
    api_client: MainTradingApiClient,
    parser: SignalParserRouter,
    *,
    limit: int = 25,
    learn_formats: bool = True,
) -> dict[str, Any]:
    sources = await api_client.followed_sources()
    summary = {"groups": len(sources), "results": [], "totals": {"scanned": 0, "parsed": 0, "skipped": 0, "validated": 0, "rejected": 0}}

    for source in sources:
        title = source.get("title") or source.get("telegram_chat_id")
        try:
            if learn_formats and parser.ai_parser:
                await learn_and_store_group_format(client, source, api_client, parser.ai_parser)
            per_source_limit = int((source.get("metadata") or {}).get("scrape_limit") or limit)
            stats = await scrape_source(client, source, parser, api_client, limit=per_source_limit)
            for key in summary["totals"]:
                summary["totals"][key] += stats.get(key, 0)
            summary["results"].append({"title": title, **stats})
            print(f"[SignalIngestion] Scrape {title}: {stats}")
        except Exception as err:  # noqa: BLE001
            summary["results"].append({"title": title, "error": str(err)})
            print(f"[SignalIngestion] Scrape failed {title}: {err}")

    return summary
