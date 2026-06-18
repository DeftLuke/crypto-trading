from datetime import datetime, timezone
from typing import Any
import importlib.util
from pathlib import Path

from telethon import TelegramClient

from api_client.main_trading_api import MainTradingApiClient


def _load_message_media():
    path = Path(__file__).resolve().parent / "message_media.py"
    spec = importlib.util.spec_from_file_location("tg_message_media", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load message_media.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_message_media = _load_message_media()
download_photo_base64 = _message_media.download_photo_base64


async def collect_group_samples(client: TelegramClient, chat_id: int, limit: int = 40) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    async for message in client.iter_messages(chat_id, limit=limit):
        text = (message.raw_text or message.message or "").strip()
        has_image = bool(message.photo)
        if not text and not has_image:
            continue
        sample: dict[str, Any] = {
            "message_id": message.id,
            "text": text[:800],
            "has_image": has_image,
            "date": message.date.isoformat() if message.date else None,
        }
        if has_image and len(samples) < 8:
            image_b64 = await download_photo_base64(client, message)
            if image_b64:
                sample["image_hint"] = "chart_screenshot"
        samples.append(sample)
    return samples


async def learn_and_store_group_format(
    client: TelegramClient,
    source: dict[str, Any],
    api_client: MainTradingApiClient,
    ai_parser,
) -> dict[str, Any]:
    chat_id = int(source["telegram_chat_id"])
    samples = await collect_group_samples(client, chat_id)
    profile = ai_parser.learn_group_format(
        group_title=source.get("title") or str(chat_id),
        group_username=source.get("username"),
        samples=samples,
    )
    profile.pop("learn_requested_at", None)
    metadata = dict(source.get("metadata") or {})
    metadata["format_profile"] = profile
    await api_client.update_source(source["id"], {"metadata": metadata})
    return profile
