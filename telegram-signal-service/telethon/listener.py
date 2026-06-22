from datetime import datetime, timezone
import asyncio
import importlib.util
from pathlib import Path

from telethon import TelegramClient, events

from api_client.main_trading_api import MainTradingApiClient
from models.parse_context import ParseContext
from parser.router import SignalParserRouter
from parser.store import JsonlSignalStore
from providers.config import ProviderConfig, provider_by_chat


def _load_local_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).resolve().parent / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_format_learner = _load_local_module("tg_format_learner", "format_learner.py")
_message_media = _load_local_module("tg_message_media", "message_media.py")
learn_and_store_group_format = _format_learner.learn_and_store_group_format
download_photo_base64 = _message_media.download_photo_base64


def _stored_chat_id(chat_id: int) -> str:
    """Normalize Telethon channel ids (-100…) to positive ids stored in DB."""
    cid = int(chat_id)
    if cid < 0:
        abs_id = abs(cid)
        if abs_id > 1_000_000_000_000:
            return str(abs_id - 1_000_000_000_000)
    return str(abs(cid))


def _followed_index(sources: list[dict]) -> dict[str, dict]:
    """Index followed sources by every chat id variant Telethon may emit."""
    index: dict[str, dict] = {}
    for source in sources:
        raw = source.get("telegram_chat_id")
        if raw is None:
            continue
        try:
            n = int(raw)
        except (TypeError, ValueError):
            index[str(raw)] = source
            continue
        keys = {str(n), str(abs(n)), _stored_chat_id(n)}
        if n > 0:
            keys.add(str(-(1_000_000_000_000 + n)))
        for key in keys:
            index[key] = source
    return index


class TelegramSignalListener:
    def __init__(
        self,
        client: TelegramClient,
        providers: list[ProviderConfig],
        parser: SignalParserRouter,
        api_client: MainTradingApiClient,
        store: JsonlSignalStore,
    ) -> None:
        self.client = client
        self.providers = providers
        self.parser = parser
        self.api_client = api_client
        self.store = store
        self.followed_sources: dict[str, dict] = {}
        self._learning: set[str] = set()
        self._scraping: set[str] = set()

    async def refresh_followed_sources(self) -> None:
        sources = await self.api_client.followed_sources()
        self.followed_sources = _followed_index(sources)
        await self._schedule_format_learning()
        await self._schedule_scrape()

    def _lookup_followed(self, chat_id: int) -> dict | None:
        return self.followed_sources.get(str(chat_id)) or self.followed_sources.get(_stored_chat_id(chat_id))

    async def _schedule_format_learning(self) -> None:
        unique: dict[str, dict] = {}
        for source in self.followed_sources.values():
            key = str(source.get("id") or source.get("telegram_chat_id"))
            unique[key] = source
        for source in unique.values():
            chat_id = str(source.get("telegram_chat_id"))
            if chat_id in self._learning:
                continue
            profile = (source.get("metadata") or {}).get("format_profile") or {}
            if profile.get("learned_at") and not profile.get("learn_requested_at"):
                continue
            self._learning.add(chat_id)
            asyncio.create_task(self._learn_format(chat_id, source))

    async def _learn_format(self, chat_id: str, source: dict) -> None:
        try:
            if not self.parser.ai_parser:
                return
            profile = await learn_and_store_group_format(
                self.client,
                source,
                self.api_client,
                self.parser.ai_parser,
            )
            if profile.get("learn_requested_at"):
                profile.pop("learn_requested_at", None)
            print(f"[SignalIngestion] Learned format for {source.get('title')}: {profile.get('style', 'unknown')}")
            refreshed = dict(source)
            meta = dict(refreshed.get("metadata") or {})
            meta["format_profile"] = profile
            refreshed["metadata"] = meta
            self.followed_sources[chat_id] = refreshed
        except Exception as err:  # noqa: BLE001
            print(f"[SignalIngestion] Format learning failed for {source.get('title')}: {err}")
        finally:
            self._learning.discard(chat_id)

    async def _clear_scrape_request(self, source: dict) -> None:
        metadata = dict(source.get("metadata") or {})
        if not metadata.pop("scrape_requested_at", None):
            return
        await self.api_client.update_source(source["id"], {"metadata": metadata})

    async def _schedule_scrape(self) -> None:
        pending = [
            source for source in self.followed_sources.values()
            if (source.get("metadata") or {}).get("scrape_requested_at")
        ]
        archive_pending = [
            source for source in self.followed_sources.values()
            if (source.get("metadata") or {}).get("archive_requested_at")
        ]
        if archive_pending and "archive" not in self._scraping:
            self._scraping.add("archive")
            jobs: list[tuple[dict, int]] = []
            for source in archive_pending:
                meta = dict(source.get("metadata") or {})
                limit = int(meta.get("archive_limit") or 50)
                meta.pop("archive_requested_at", None)
                meta.pop("archive_limit", None)
                await self.api_client.update_source(source["id"], {"metadata": meta})
                jobs.append((source, limit))
            asyncio.create_task(self._run_archive(jobs))
        if not pending or "all" in self._scraping:
            return
        self._scraping.add("all")
        for source in pending:
            await self._clear_scrape_request(source)
        asyncio.create_task(self._run_scrape(pending))

    async def _run_scrape(self, _sources: list[dict]) -> None:
        try:
            scraper = _load_local_module("tg_history_scraper", "history_scraper.py")
            limit = int((_sources[0].get("metadata") or {}).get("scrape_limit") or 25)
            latest_only = bool((_sources[0].get("metadata") or {}).get("scrape_latest_signal", True))
            summary = await scraper.scrape_followed_groups(
                self.client,
                self.api_client,
                self.parser,
                limit=limit,
                learn_formats=not latest_only,
                latest_signal_only=latest_only,
            )
            print(f"[SignalIngestion] Scrape complete: {summary.get('totals')}")
        except Exception as err:  # noqa: BLE001
            print(f"[SignalIngestion] Scrape failed: {err}")
        finally:
            self._scraping.discard("all")

    async def _run_archive(self, jobs: list[tuple[dict, int]]) -> None:
        try:
            scraper = _load_local_module("tg_history_scraper", "history_scraper.py")
            for source, limit in jobs:
                stats = await scraper.archive_recent_messages(
                    self.client,
                    source,
                    self.api_client,
                    limit=limit,
                )
                print(f"[SignalIngestion] Archived {source.get('title')}: {stats}")
        except Exception as err:  # noqa: BLE001
            print(f"[SignalIngestion] Archive failed: {err}")
        finally:
            self._scraping.discard("archive")
            # Do not call refresh_followed_sources here — 30s loop handles follow list only

    async def refresh_loop(self, interval_seconds: int = 120) -> None:
        while True:
            await asyncio.sleep(interval_seconds)
            try:
                sources = await self.api_client.followed_sources()
                self.followed_sources = _followed_index(sources)
            except Exception as err:  # noqa: BLE001
                print(f"[SignalIngestion] Followed source refresh failed: {err}")

    async def _build_context(self, event, followed: dict) -> ParseContext | None:
        message = event.message
        text = (message.raw_text or message.message or "").strip()
        image_b64 = await download_photo_base64(self.client, message) if message.photo else None

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

    async def _record_parsed_example(self, followed: dict, context: ParseContext, payload: dict) -> None:
        metadata = dict(followed.get("metadata") or {})
        profile = dict(metadata.get("format_profile") or {})
        examples = list(profile.get("parsed_examples") or [])
        examples.insert(0, {
            "symbol": payload.get("symbol"),
            "side": payload.get("side"),
            "snippet": (context.text or "")[:240],
            "has_image": context.has_image,
            "levels_source": (payload.get("metadata") or {}).get("levels_source"),
            "at": datetime.now(timezone.utc).isoformat(),
        })
        profile["parsed_examples"] = examples[:5]
        profile["last_signal_at"] = datetime.now(timezone.utc).isoformat()
        metadata["format_profile"] = profile
        await self.api_client.update_source(followed["id"], {"metadata": metadata})

    def register(self) -> None:
        @self.client.on(events.NewMessage(chats=None))
        async def on_message(event):  # noqa: ANN001
            chat = await event.get_chat()
            username = getattr(chat, "username", None)
            raw_chat_id = getattr(chat, "id", None)
            if raw_chat_id is None:
                return
            chat_id = int(raw_chat_id)
            followed = self._lookup_followed(chat_id)
            if not followed:
                return

            context = await self._build_context(event, followed)
            if not context:
                return

            provider = ProviderConfig(
                id=followed.get("provider_id") or str(chat_id),
                name=followed.get("title") or followed.get("provider_id") or str(chat_id),
                chats=[chat_id],
                parser=followed.get("parser") or "generic",
                enabled=True,
            )
            if not provider_by_chat(self.providers, chat_id, username):
                pass

            msg_time = event.message.date
            ts = datetime.now(timezone.utc).isoformat()
            if msg_time:
                if msg_time.tzinfo is None:
                    msg_time = msg_time.replace(tzinfo=timezone.utc)
                ts = msg_time.isoformat()

            stored_chat_id = int(followed.get("telegram_chat_id") or _stored_chat_id(chat_id))

            audit_base = {
                "has_image": context.has_image,
                "original_text": context.text or "",
                "image_base64": context.image_b64,
                "image_mime": "image/jpeg",
            }

            await self.api_client.save_message({
                "source_id": followed.get("id"),
                "telegram_chat_id": stored_chat_id,
                "message_id": event.message.id,
                "raw_message": context.combined_text() or context.text,
                "parse_status": "parsing",
                "api_result": {"pipeline_stage": "parsing", "live": True},
                "message_date": ts,
                "audit": {**audit_base, "parse_stage": "parsing"},
            })

            parsed, parse_audit = self.parser.parse_with_audit(context, provider)

            if not parsed:
                await self.api_client.save_message({
                    "source_id": followed.get("id"),
                    "telegram_chat_id": stored_chat_id,
                    "message_id": event.message.id,
                    "raw_message": context.combined_text() or context.text,
                    "parse_status": "skipped",
                    "api_result": {
                        "pipeline_stage": "received",
                        "reason": parse_audit.get("reject_reason") or "Not a trading signal",
                        "live": True,
                    },
                    "message_date": ts,
                    "audit": {**audit_base, **parse_audit},
                })
                return

            parsed.timestamp = ts
            parsed.provider_message_id = event.message.id
            parsed.source_chat_id = stored_chat_id
            payload = parsed.to_main_api_payload()
            result = await self.api_client.validate_signal(payload)
            passed = bool(result.get("passed"))
            await self.api_client.supersede_chat_messages(stored_chat_id, keep_message_id=event.message.id)
            await self.api_client.save_message({
                "source_id": followed.get("id"),
                "telegram_chat_id": stored_chat_id,
                "message_id": event.message.id,
                "raw_message": context.combined_text() or context.text,
                "parsed_signal": payload,
                "parse_status": "parsed",
                "api_result": {
                    **result,
                    "pipeline_stage": "validated" if passed else "rejected",
                    "live": True,
                },
                "message_date": ts,
                "audit": {
                    **audit_base,
                    **parse_audit,
                    "parser_used": parsed.parser,
                    "model_used": (payload.get("metadata") or {}).get("ai_model") or parse_audit.get("model_used"),
                    "ai_output": parse_audit.get("ai_output") or payload,
                },
            })
            await self._record_parsed_example(followed, context, payload)

            self.store.append({
                "provider": provider.name,
                "raw_message": context.combined_text() or context.text,
                "source_chat_id": chat_id,
                "provider_message_id": event.message.id,
                "received_at": datetime.now(timezone.utc).isoformat(),
                "message_date": ts,
                "parsed": payload,
                "api_result": result,
                "status": "sent",
                "has_image": context.has_image,
            })
            print(
                f"[SignalIngestion] LIVE {parsed.provider} {parsed.symbol} {parsed.side} "
                f"-> {'passed' if passed else result.get('reason', 'rejected')}",
                flush=True,
            )
