"""Market data constants — Binance Vision futures UM archives."""

from __future__ import annotations

from typing import Final

BINANCE_VISION_BASE: Final[str] = "https://data.binance.vision"
ARCHIVE_MARKET: Final[str] = "futures/um/monthly/klines"

SUPPORTED_TIMEFRAMES: Final[tuple[str, ...]] = (
    "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
)

TIMEFRAME_MS: Final[dict[str, int]] = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "4h": 14_400_000,
    "6h": 21_600_000,
    "8h": 28_800_000,
    "12h": 43_200_000,
    "1d": 86_400_000,
    "3d": 259_200_000,
    "1w": 604_800_000,
}

INSTITUTIONAL_MTF: Final[tuple[str, ...]] = ("1d", "4h", "1h", "15m")

MIN_BARS: Final[dict[str, int]] = {
    "1d": 120,
    "4h": 200,
    "1h": 300,
    "15m": 400,
}

DEFAULT_LIMITS: Final[dict[str, int]] = {
    "1d": 200,
    "4h": 300,
    "1h": 400,
    "15m": 500,
}

# Symbols with no usable Vision history — excluded from download queue.
# BSBUSDT: newly listed; Vision 404s for all requested months → infinite retry loop.
DEFAULT_SYMBOL_BLACKLIST: Final[frozenset[str]] = frozenset({"BSBUSDT"})
