"""
Load OHLCV from existing research-platform storage ONLY.

Uses Parquet files written by SyncEngine (app/services/sync_engine.py).
Does NOT download from exchanges — call POST /sync/start or batch sync first.
"""

from __future__ import annotations

import polars as pl

from app.core.config import get_settings
from app.core.logging import get_logger
from app.storage.parquet_store import ParquetStorage

logger = get_logger("strategies.e5.data")


class InstitutionalDataLoader:
    """Read cached candles — Parquet primary, optional PostgreSQL fallback via repository."""

    def __init__(self, exchange: str = "binance") -> None:
        self.exchange = exchange.lower()
        self.store = ParquetStorage()
        self.settings = get_settings()

    def load(
        self,
        symbol: str,
        timeframe: str,
        start_ts: int | None = None,
        end_ts: int | None = None,
    ) -> pl.DataFrame | None:
        lf = self.store.read_candles_lazy(self.exchange, symbol.upper(), timeframe)
        if lf is None:
            logger.warning(
                "No parquet data — run sync first",
                extra={"symbol": symbol, "timeframe": timeframe},
            )
            return None
        if start_ts:
            lf = lf.filter(pl.col("ts") >= start_ts)
        if end_ts:
            lf = lf.filter(pl.col("ts") <= end_ts)
        df = lf.collect().sort("ts")
        return df if not df.is_empty() else None

    def has_data(self, symbol: str, timeframe: str) -> bool:
        return self.store.candle_path(self.exchange, symbol.upper(), timeframe).exists()
