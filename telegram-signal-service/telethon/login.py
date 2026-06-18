import os
from typing import Any

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError


async def login_with_code(
    client: TelegramClient,
    phone: str,
    code: str | None = None,
    password: str | None = None,
) -> dict[str, Any]:
    await client.connect()

    if await client.is_user_authorized():
        me = await client.get_me()
        return {
            "status": "already_authorized",
            "user": getattr(me, "username", None) or str(getattr(me, "id", "")),
        }

    if not code:
        await client.send_code_request(phone)
        return {"status": "code_sent", "phone": phone}

    try:
        start_kwargs: dict[str, Any] = {
            "phone": phone,
            "code_callback": lambda: code,
        }
        if password:
            start_kwargs["password"] = lambda: password
        await client.start(**start_kwargs)
    except SessionPasswordNeededError:
        if not password:
            return {"status": "password_required", "phone": phone}
        await client.sign_in(password=password)

    me = await client.get_me()
    return {
        "status": "authorized",
        "user": getattr(me, "username", None) or str(getattr(me, "id", "")),
    }


def create_client() -> TelegramClient:
    api_id = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")
    if not api_id or not api_hash:
        raise RuntimeError("TELEGRAM_API_ID and TELEGRAM_API_HASH are required")
    session_name = os.getenv("TELEGRAM_SESSION_NAME", "tradegpt_signal_ingestion")
    return TelegramClient(session_name, int(api_id), api_hash)
