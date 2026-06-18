import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ProviderConfig:
    id: str
    name: str
    chats: list[str | int]
    parser: str = "generic"
    enabled: bool = True
    symbols_quote_asset: str = "USDT"
    options: dict[str, Any] | None = None


def load_providers(config_path: str) -> list[ProviderConfig]:
    raw = json.loads(Path(config_path).read_text(encoding="utf-8"))
    providers = []
    for item in raw.get("providers", []):
        if item.get("enabled", True) is False:
            continue
        providers.append(
            ProviderConfig(
                id=item["id"],
                name=item.get("name") or item["id"],
                chats=item.get("chats", []),
                parser=item.get("parser", "generic"),
                enabled=True,
                symbols_quote_asset=item.get("symbols_quote_asset", "USDT"),
                options=item.get("options") or {},
            )
        )
    return providers


def provider_by_chat(providers: list[ProviderConfig], chat_id: int | str | None, username: str | None) -> ProviderConfig | None:
    candidates = {str(chat_id), username, f"@{username}" if username else None}
    candidates.discard(None)
    for provider in providers:
        if any(str(chat) in candidates for chat in provider.chats):
            return provider
    return None
