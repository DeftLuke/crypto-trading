import re

from models.signal import NormalizedSignal
from providers.config import ProviderConfig


SYMBOL_RE = re.compile(r"\b([A-Z0-9]{2,12})(?:[/\-\s]?USDT|USDT)\b", re.IGNORECASE)
SIDE_RE = re.compile(r"\b(LONG|SHORT|BUY|SELL)\b", re.IGNORECASE)
ENTRY_RE = re.compile(r"(?:entry|entries|enter|buy\s*zone|sell\s*zone)\D{0,20}([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
SL_RE = re.compile(r"(?:sl|stop\s*loss|stoploss)\D{0,20}([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
TP_RE = re.compile(
    r"(?:tp\d*|target\d*|take[\s\-]*profits?\d*)\D{0,30}([0-9]+(?:\.[0-9]+)?)",
    re.IGNORECASE,
)
TAKE_PROFIT_BLOCK_RE = re.compile(
    r"take[\s\-]*profits?[\s:]*((?:[\s\n\r]*[0-9]+(?:\.[0-9]+)?)+)",
    re.IGNORECASE,
)
NUMBER_RE = re.compile(r"(?<![A-Za-z])([0-9]+(?:\.[0-9]+)?)(?![A-Za-z])")


def _first_float(match: re.Match[str] | None) -> float | None:
    if not match:
        return None
    try:
        return float(match.group(1))
    except (TypeError, ValueError):
        return None


def _normalize_symbol(text: str, quote_asset: str) -> str | None:
    match = SYMBOL_RE.search(text)
    if not match:
        return None
    base = match.group(1).upper()
    if base.endswith(quote_asset):
        return base
    return f"{base}{quote_asset}"


def _infer_side(text: str, entry: float | None, stop_loss: float | None) -> str | None:
    match = SIDE_RE.search(text)
    if match:
        token = match.group(1).upper()
        return "LONG" if token in {"LONG", "BUY"} else "SHORT"
    if entry and stop_loss:
        return "LONG" if stop_loss < entry else "SHORT"
    return None


def _extract_take_profits(cleaned: str, entry: float | None, stop_loss: float | None) -> list[float]:
    take_profit = [float(v) for v in TP_RE.findall(cleaned)]
    if take_profit:
        return take_profit

    block = TAKE_PROFIT_BLOCK_RE.search(cleaned)
    if block:
        take_profit = [float(v) for v in NUMBER_RE.findall(block.group(1))]
        if take_profit:
            return take_profit

    numbers = [float(v) for v in NUMBER_RE.findall(cleaned)]
    if entry is not None and stop_loss is not None:
        take_profit = [n for n in numbers if n not in {entry, stop_loss}]
        if take_profit:
            return take_profit[:4]

    if len(numbers) >= 4:
        return numbers[2:6]
    return []


def parse_generic_signal(message: str, provider: ProviderConfig) -> NormalizedSignal | None:
    cleaned = message.replace(",", "").replace(":", " ")
    symbol = _normalize_symbol(cleaned, provider.symbols_quote_asset)
    entry = _first_float(ENTRY_RE.search(cleaned))
    stop_loss = _first_float(SL_RE.search(cleaned))
    take_profit = _extract_take_profits(cleaned, entry, stop_loss)

    if entry is None:
        numbers = [float(v) for v in NUMBER_RE.findall(cleaned)]
        if len(numbers) >= 4:
            entry = numbers[0]
            if stop_loss is None:
                stop_loss = numbers[1]
            if not take_profit:
                take_profit = numbers[2:]

    side = _infer_side(cleaned, entry, stop_loss)
    if not symbol or not side or entry is None or stop_loss is None or not take_profit:
        return None

    return NormalizedSignal(
        provider=provider.name,
        symbol=symbol,
        side=side,
        entry=entry,
        stop_loss=stop_loss,
        take_profit=take_profit[:4],
        raw_message=message,
        parser="rule",
    ).ensure_take_profits().validate()
