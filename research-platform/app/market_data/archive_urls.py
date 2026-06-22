"""Build Binance Vision archive download URLs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from app.market_data.constants import ARCHIVE_MARKET, BINANCE_VISION_BASE


@dataclass(frozen=True)
class ArchiveMonth:
    symbol: str
    timeframe: str
    year: int
    month: int

    @property
    def filename(self) -> str:
        sym = self.symbol.upper()
        return f"{sym}-{self.timeframe}-{self.year}-{self.month:02d}.zip"

    @property
    def url(self) -> str:
        sym = self.symbol.upper()
        return (
            f"{BINANCE_VISION_BASE}/data/{ARCHIVE_MARKET}/"
            f"{sym}/{self.timeframe}/{self.filename}"
        )


def iter_months(
    symbol: str,
    timeframe: str,
    start_year: int,
    start_month: int,
    end_year: int | None = None,
    end_month: int | None = None,
) -> list[ArchiveMonth]:
    """Inclusive month range up to current UTC month."""
    now = datetime.now(tz=UTC)
    end_year = end_year or now.year
    end_month = end_month or now.month

    out: list[ArchiveMonth] = []
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        out.append(ArchiveMonth(symbol.upper(), timeframe, y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def months_for_bar_count(timeframe: str, bar_count: int) -> int:
    """Rough month count needed for N bars (generous buffer)."""
    bars_per_month = {
        "15m": 2880,
        "1h": 720,
        "4h": 180,
        "1d": 31,
    }.get(timeframe, 1000)
    return max(1, (bar_count // max(bars_per_month, 1)) + 2)


def build_archive_plan(
    symbol: str,
    timeframe: str,
    *,
    months_back: int | None = None,
    min_bars: int = 200,
    listing_ym: tuple[int, int] | None = None,
) -> list[ArchiveMonth]:
    """Months to fetch from Binance Vision (inclusive of listing month when known)."""
    now = datetime.now(tz=UTC)
    count = months_back or months_for_bar_count(timeframe, min_bars)
    start = now.replace(day=1)
    for _ in range(count - 1):
        if start.month == 1:
            start = start.replace(year=start.year - 1, month=12)
        else:
            start = start.replace(month=start.month - 1)

    if listing_ym:
        ly, lm = listing_ym
        if (start.year, start.month) < (ly, lm):
            start = start.replace(year=ly, month=lm, day=1)

    return iter_months(symbol, timeframe, start.year, start.month)
