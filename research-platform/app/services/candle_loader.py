"""Phase 1 — Load OHLCV from DB/Parquet; sync to storage if coverage is low."""

from __future__ import annotations

import math
from typing import Callable

import polars as pl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.tables import Candle, MarketMetadata
from app.services.sync_engine import SyncEngine
from app.storage.parquet_store import ParquetStorage

logger = get_logger("services.candle_loader")

ProgressFn = Callable[[float, str, str], None] | None

TIMEFRAME_MS = {
    "1m": 60_000,
    "3m": 180_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}


def expected_bars(timeframe: str, start_ts: int, end_ts: int) -> int:
    ms = TIMEFRAME_MS.get(timeframe, 300_000)
    return max(1, math.ceil((end_ts - start_ts) / ms))


class CandleLoader:
    def __init__(self, exchange: str = "binance") -> None:
        self.exchange = exchange.lower()
        self.store = ParquetStorage()

    def _load_parquet(
        self,
        symbol: str,
        timeframe: str,
        start_ts: int,
        end_ts: int,
    ) -> pl.DataFrame | None:
        lf = self.store.read_candles_lazy(self.exchange, symbol.upper(), timeframe)
        if lf is None:
            return None
        df = (
            lf.filter(pl.col("ts") >= start_ts)
            .filter(pl.col("ts") <= end_ts)
            .collect()
            .sort("ts")
        )
        return df if not df.is_empty() else None

    async def _load_postgres(
        self,
        session: AsyncSession,
        symbol: str,
        timeframe: str,
        start_ts: int,
        end_ts: int,
    ) -> pl.DataFrame | None:
        sym = symbol.upper()
        stmt = (
            select(Candle)
            .where(
                Candle.exchange == self.exchange,
                Candle.symbol == sym,
                Candle.timeframe == timeframe,
                Candle.ts >= start_ts,
                Candle.ts <= end_ts,
            )
            .order_by(Candle.ts)
        )
        result = await session.execute(stmt)
        rows = result.scalars().all()
        if not rows:
            return None
        return pl.DataFrame({
            "ts": [r.ts for r in rows],
            "open": [r.open for r in rows],
            "high": [r.high for r in rows],
            "low": [r.low for r in rows],
            "close": [r.close for r in rows],
            "volume": [r.volume for r in rows],
        })

    async def _count_postgres(
        self,
        session: AsyncSession,
        symbol: str,
        timeframe: str,
        start_ts: int,
        end_ts: int,
    ) -> int:
        df = await self._load_postgres(session, symbol, timeframe, start_ts, end_ts)
        return len(df) if df is not None else 0

    async def ensure_candles(
        self,
        session: AsyncSession,
        symbol: str,
        timeframes: list[str],
        start_ts: int,
        end_ts: int,
        on_progress: ProgressFn = None,
    ) -> dict[str, pl.DataFrame]:
        """Download missing ranges once, then load all TFs into RAM."""
        sym = symbol.upper()
        out: dict[str, pl.DataFrame] = {}
        sync_engine = SyncEngine(session)
        total = len(timeframes)

        for idx, tf in enumerate(timeframes):
            pct = 5 + (idx / max(total, 1)) * 35
            if on_progress:
                on_progress(pct, "download", f"Checking {sym} {tf} candle data…")

            need = expected_bars(tf, start_ts, end_ts)
            min_need = max(50, int(need * 0.85))

            df = self._load_parquet(sym, tf, start_ts, end_ts)
            if df is None or len(df) < min_need:
                pg_count = await self._count_postgres(session, sym, tf, start_ts, end_ts)
                if pg_count < min_need:
                    if on_progress:
                        on_progress(pct + 5, "download", f"Syncing {sym} {tf} to database…")
                    try:
                        full = pg_count == 0 and df is None
                        await sync_engine.sync_ohlcv(self.exchange, sym, tf, full=full)
                        await session.commit()
                    except Exception as exc:
                        logger.warning("Sync failed for %s %s: %s", sym, tf, exc)
                        if pg_count < 50 and (df is None or len(df) < 50):
                            raise RuntimeError(
                                f"Insufficient {sym} {tf} data and sync failed: {exc}"
                            ) from exc

                df = self._load_parquet(sym, tf, start_ts, end_ts)
                if df is None or len(df) < min_need:
                    df = await self._load_postgres(session, sym, tf, start_ts, end_ts)

            if df is None or df.is_empty():
                raise RuntimeError(f"No candle data for {sym} {tf} in selected period")

            out[tf] = df
            logger.info("Loaded %d bars %s %s", len(df), sym, tf)

        if on_progress:
            on_progress(42, "download", f"Loaded {len(out)} timeframes into memory")
        return out
