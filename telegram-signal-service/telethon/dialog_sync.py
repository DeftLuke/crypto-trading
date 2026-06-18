from telethon import TelegramClient

from api_client.main_trading_api import MainTradingApiClient


def _source_type(entity) -> str:  # noqa: ANN001
    if getattr(entity, "broadcast", False):
        return "channel"
    if getattr(entity, "megagroup", False):
        return "supergroup"
    if getattr(entity, "gigagroup", False):
        return "gigagroup"
    return "group" if getattr(entity, "participants_count", None) is not None else "chat"


async def collect_dialog_sources(client: TelegramClient) -> list[dict]:
    sources = []
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if not (dialog.is_group or dialog.is_channel):
            continue
        chat_id = getattr(entity, "id", None)
        if chat_id is None:
            continue
        sources.append({
            "telegram_chat_id": int(chat_id),
            "title": dialog.name or getattr(entity, "title", "") or str(chat_id),
            "username": getattr(entity, "username", None),
            "source_type": _source_type(entity),
            "provider_id": getattr(entity, "username", None) or str(chat_id),
            "parser": "generic",
            "can_read": True,
            "metadata": {
                "participants_count": getattr(entity, "participants_count", None),
                "verified": getattr(entity, "verified", False),
                "scam": getattr(entity, "scam", False),
                "fake": getattr(entity, "fake", False),
            },
        })
    return sources


async def sync_dialog_sources(client: TelegramClient, api_client: MainTradingApiClient) -> dict:
    sources = await collect_dialog_sources(client)
    result = await api_client.sync_sources(sources)
    return {"count": len(sources), "api_result": result}
