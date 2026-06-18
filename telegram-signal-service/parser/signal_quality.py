import re

from models.parse_context import ParseContext
from models.signal import NormalizedSignal

# Prevent vision model from copying example coins — rough max spot/futures entry sanity
_MAX_ENTRY: dict[str, float] = {
    "HBARUSDT": 1.5,
    "XRPUSDT": 25,
    "DOGEUSDT": 2,
    "SHIBUSDT": 0.001,
    "PEPEUSDT": 0.001,
    "NOTUSDT": 0.05,
    "BTCUSDT": 250_000,
    "ETHUSDT": 15_000,
}

_SYMBOL_RE = re.compile(r"#?([A-Z0-9]{2,12})(?:[/\-\s]?USDT|USDT)\b", re.IGNORECASE)
_TRADE_HINT = re.compile(r"\b(long|short|buy|sell|entry|stop\s*loss|sl|tp|take\s*profit|target)\b", re.IGNORECASE)


def symbol_in_text(symbol: str, text: str) -> bool:
    if not symbol or not text:
        return False
    base = symbol.upper().replace("USDT", "")
    if re.search(rf"\b{re.escape(base)}\b", text, re.IGNORECASE):
        return True
    if re.search(rf"#\s*{re.escape(base)}\b", text, re.IGNORECASE):
        return True
    return bool(_SYMBOL_RE.search(text) and base in text.upper())


def has_trade_text(text: str) -> bool:
    return bool(text.strip() and (_TRADE_HINT.search(text) or _SYMBOL_RE.search(text)))


def entry_plausible(symbol: str, entry: float) -> bool:
    if not entry or entry <= 0:
        return False
    cap = _MAX_ENTRY.get(symbol.upper())
    if cap is not None:
        return entry <= cap
    # Unknown alt: reject absurd entries (likely wrong symbol on chart)
    if entry > 50_000:
        return False
    return True


def acceptable_parsed_signal(signal: NormalizedSignal, context: ParseContext) -> bool:
    text = (context.text or "").strip()
    meta = signal.metadata or {}
    levels = meta.get("levels_source") or "text"

    if context.has_image and not text:
        return False

    if levels == "chart" and not symbol_in_text(signal.symbol, text):
        return False

    if not entry_plausible(signal.symbol, float(signal.entry)):
        return False

    if not entry_plausible(signal.symbol, float(signal.stop_loss)):
        return False

    return True
