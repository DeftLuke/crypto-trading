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
        self.followed_sources = {str(source.get("telegram_chat_id")): source for source in sources}
        await self._schedule_format_learning()
        await self._schedule_scrape()

    async def _schedule_format_learning(self) -> None:
        for chat_id, source in self.followed_sources.items():
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
        if not pending or self._scraping:
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
            # Do not call refresh_followed_sources here — 30s loop handles follow list only

    async def refresh_loop(self, interval_seconds: int = 30) -> None:
        while True:
            await asyncio.sleep(interval_seconds)
            try:
                await self.refresh_followed_sources()
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
            followed = self.followed_sources.get(str(chat_id))
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

            parsed = self.parser.parse(context, provider)
            msg_time = event.message.date
            ts = datetime.now(timezone.utc).isoformat()
            if msg_time:
                if msg_time.tzinfo is None:
                    msg_time = msg_time.replace(tzinfo=timezone.utc)
                ts = msg_time.isoformat()

            if not parsed:
                await self.api_client.save_message({
                    "source_id": followed.get("id"),
                    "telegram_chat_id": chat_id,
                    "message_id": event.message.id,
                    "raw_message": context.combined_text() or context.text,
                    "parse_status": "skipped",
                    "api_result": {"pipeline_stage": "received", "reason": "Not a trading signal"},
                    "message_date": ts,
                })
                return

            parsed.timestamp = ts
            parsed.provider_message_id = event.message.id
            parsed.source_chat_id = chat_id
            payload = parsed.to_main_api_payload()
            result = await self.api_client.validate_signal(payload)
            passed = bool(result.get("passed"))
            await self.api_client.supersede_chat_messages(chat_id, keep_message_id=event.message.id)
            await self.api_client.save_message({
                "source_id": followed.get("id"),
                "telegram_chat_id": chat_id,
                "message_id": event.message.id,
                "raw_message": context.combined_text() or context.text,
                "parsed_signal": payload,
                "parse_status": "parsed",
                "api_result": {**result, "pipeline_stage": "validated" if passed else "rejected", "live": True},
                "message_date": ts,
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
