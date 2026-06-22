"""Filesystem layout for local market data Parquet store."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_settings


def market_data_root() -> Path:
    settings = get_settings()
    root = Path(settings.market_data_root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def symbol_dir(symbol: str, timeframe: str) -> Path:
    path = market_data_root() / symbol.upper() / timeframe
    path.mkdir(parents=True, exist_ok=True)
    return path


def month_parquet_path(symbol: str, timeframe: str, year: int, month: int) -> Path:
    return symbol_dir(symbol, timeframe) / str(year) / f"{month:02d}.parquet"


def archive_cache_dir(symbol: str, timeframe: str) -> Path:
    path = market_data_root() / "_cache" / "zip" / symbol.upper() / timeframe
    path.mkdir(parents=True, exist_ok=True)
    return path


def zip_cache_path(symbol: str, timeframe: str, year: int, month: int) -> Path:
    sym = symbol.upper()
    return archive_cache_dir(sym, timeframe) / f"{sym}-{timeframe}-{year}-{month:02d}.zip"


def partial_zip_path(symbol: str, timeframe: str, year: int, month: int) -> Path:
    return zip_cache_path(symbol, timeframe, year, month).with_suffix(".zip.part")


def missing_archive_marker_path(symbol: str, timeframe: str, year: int, month: int) -> Path:
    """Tombstone written when Binance Vision returns 404 — avoids re-fetch loops."""
    return zip_cache_path(symbol, timeframe, year, month).with_suffix(".zip.missing")


def ts_to_year_month(ts_ms: int) -> tuple[int, int]:
    dt = datetime.fromtimestamp(ts_ms / 1000, tz=UTC)
    return dt.year, dt.month


def current_year_month() -> tuple[int, int]:
    now = datetime.now(tz=UTC)
    return now.year, now.month
