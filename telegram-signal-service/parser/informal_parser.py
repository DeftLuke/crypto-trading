"""Parse informal VIP signals: 'Btr long', 'Koma Short', 'MIRA LONG 0.056'."""

from __future__ import annotations

import re

from models.signal import NormalizedSignal
from providers.config import ProviderConfig

NOT_SIGNAL_RE = re.compile(
    r"(?:target\s*\d|take[\s\-]*profit|all\s+target|achieved|acheived|achive|book\s+\d+\s*%|"
    r"offer\s+price|complete\s+\d+\s*react|good\s+morning|premium\s+group|profit\s*:\s*\d|"
    r"stop[\s\-]*loss\s+got\s+hit|session\s+successfully\s+closed|need\s+free\s+signal)",
    re.IGNORECASE,
)

EMOJI_RE = re.compile(r"[📈📉🔼🔽⬇️⬆️✅✔️🤑😎🤝👍💥🐋🏆]+")

DIRECTION_ONLY_RE = re.compile(
    r"^#?\s*([A-Za-z][A-Za-z0-9]{1,11})\s+(long|short|buy|sell)(?:\s+now)?\s*$",
    re.IGNORECASE,
)

SYMBOL_DIR_ENTRY_RE = re.compile(
    r"^#?\s*([A-Za-z][A-Za-z0-9]{1,11})\s+(long|short|buy|sell)\s+([0-9]+(?:\.[0-9]+)?)\s*$",
    re.IGNORECASE,
)

HASH_DIR_ENTRY_RE = re.compile(
    r"#\s*([A-Za-z][A-Za-z0-9]{1,11})\s+(long|short|buy|sell)\D{0,8}([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE,
)

DIR_SYMBOL_SL_RE = re.compile(
    r"^(long|short|buy|sell)\s+([A-Za-z][A-Za-z0-9]{1,11})\s+(?:cmp\s+)?(?:stop\s*loss|stoploss|sl)\s+([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE,
)


def _clean(text: str) -> str:
    return EMOJI_RE.sub(" ", text or "").replace(",", " ").strip()


def _to_symbol(base: str, quote: str = "USDT") -> str:
    b = base.upper().replace("/", "").replace("-", "")
    if b.endswith(quote):
        return b
    return f"{b}{quote}"


def _to_side(token: str) -> str:
    return "LONG" if token.upper() in {"LONG", "BUY"} else "SHORT"


def _hint_signal(text: str) -> NormalizedSignal:
    return NormalizedSignal(
        provider="",
        symbol="",
        side="LONG",
        entry=0.0,
        stop_loss=0.0,
        take_profit=[0.0, 0.0],
        raw_message=text,
        parser="informal",
        metadata={"levels_source": "group_hint", "informal_format": True},
    )


def parse_informal_signal(message: str, provider: ProviderConfig) -> NormalizedSignal | None:
    cleaned = _clean(message)
    if not cleaned or NOT_SIGNAL_RE.search(cleaned):
        return None

    m = SYMBOL_DIR_ENTRY_RE.match(cleaned) or DIRECTION_ONLY_RE.match(cleaned)
    if m:
        symbol = _to_symbol(m.group(1), provider.symbols_quote_asset)
        side = _to_side(m.group(2))
        entry = float(m.group(3)) if m.lastindex and m.lastindex >= 3 and m.group(3) else 0.0
        sig = _hint_signal(message)
        sig.provider = provider.name
        sig.symbol = symbol
        sig.side = side
        sig.entry = entry
        if entry > 0:
            sig.metadata["entry_hint"] = entry
        return sig

    m = HASH_DIR_ENTRY_RE.search(cleaned)
    if m:
        sig = _hint_signal(message)
        sig.provider = provider.name
        sig.symbol = _to_symbol(m.group(1), provider.symbols_quote_asset)
        sig.side = _to_side(m.group(2))
        sig.entry = float(m.group(3))
        sig.metadata["entry_hint"] = sig.entry
        return sig

    m = DIR_SYMBOL_SL_RE.match(cleaned)
    if m:
        sig = _hint_signal(message)
        sig.provider = provider.name
        sig.symbol = _to_symbol(m.group(2), provider.symbols_quote_asset)
        sig.side = _to_side(m.group(1))
        sig.stop_loss = float(m.group(3))
        sig.metadata["levels_source"] = "mixed"
        sig.metadata["sl_hint"] = sig.stop_loss
        return sig

    return None
