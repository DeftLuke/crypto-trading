import polars as pl
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import Candle, MarketMetadata
from app.storage.parquet_store import ParquetStorage


class CandleRepository:
    """Dual-write access: Parquet (primary bulk) + PostgreSQL (query)."""

    def __init__(self, session: AsyncSession, parquet: ParquetStorage | None = None) -> None:
        self.session = session
        self.parquet = parquet or ParquetStorage()

    def read_lazy(self, exchange: str, symbol: str, timeframe: str) -> pl.LazyFrame | None:
        return self.parquet.read_candles_lazy(exchange, symbol, timeframe)

    def write_batch(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        df: pl.DataFrame,
    ) -> None:
        self.parquet.write_candles(exchange, symbol, timeframe, df, merge=True)

    async def upsert_db(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        df: pl.DataFrame,
    ) -> int:
        records = [
            {
                "exchange": exchange,
                "symbol": symbol,
                "timeframe": timeframe,
                "ts": row["ts"],
                "open": row["open"],
                "high": row["high"],
                "low": row["low"],
                "close": row["close"],
                "volume": row["volume"],
            }
            for row in df.iter_rows(named=True)
        ]
        if not records:
            return 0
        stmt = insert(Candle).values(records)
        stmt = stmt.on_conflict_do_nothing(constraint="uq_candles_key")
        await self.session.execute(stmt)
        return len(records)

    async def upsert_metadata(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        first_ts: int | None,
        last_ts: int | None,
        count: int,
        parquet_path: str,
    ) -> None:
        from datetime import UTC, datetime

        stmt = insert(MarketMetadata).values({
            "exchange": exchange,
            "symbol": symbol,
            "timeframe": timeframe,
            "first_ts": first_ts,
            "last_ts": last_ts,
            "candle_count": count,
            "last_sync_at": datetime.now(UTC),
            "parquet_path": parquet_path,
        })
        stmt = stmt.on_conflict_do_update(
            constraint="uq_market_metadata_key",
            set_={
                "first_ts": stmt.excluded.first_ts,
                "last_ts": stmt.excluded.last_ts,
                "candle_count": stmt.excluded.candle_count,
                "last_sync_at": stmt.excluded.last_sync_at,
                "parquet_path": stmt.excluded.parquet_path,
            },
        )
        await self.session.execute(stmt)
