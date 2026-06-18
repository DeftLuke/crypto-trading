import base64
import io

from telethon import TelegramClient
from telethon.tl.types import Message


async def download_photo_base64(client: TelegramClient, message: Message, max_bytes: int = 4_000_000) -> str | None:
    if not message or not message.photo:
        return None
    try:
        data = await client.download_media(message, file=bytes)
        if not data or len(data) > max_bytes:
            return None
        return base64.b64encode(data).decode("ascii")
    except Exception:  # noqa: BLE001
        return None
