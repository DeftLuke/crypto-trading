import asyncio
from datetime import UTC, datetime

import polars as pl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.tables import SyncJob, SyncJobStatus
from app.repositories.candle_repository import CandleRepository
from app.services.exchange_adapter import TIMEFRAME_MS, get_exchange_adapter
from app.services.validation import DataValidator

logger = get_logger("services.sync")


class SyncEngine:
    """Incremental OHLCV sync — full history first, then gap-fill only."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.settings = get_settings()
        self.repo = CandleRepository(session)
        self.validator = DataValidator()

    async def sync_ohlcv(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        full: bool = False,
        repair_gaps: bool = True,
    ) -> SyncJob:
        job = SyncJob(
            job_type="download_history" if full else "sync_latest_data",
            exchange=exchange,
            symbol=symbol,
            timeframe=timeframe,
            status=SyncJobStatus.RUNNING.value,
            started_at=datetime.now(UTC),
        )
        self.session.add(job)
        await self.session.flush()

        try:
            rows = await self._download(exchange, symbol, timeframe, full=full)
            if repair_gaps and not full:
                repaired = await self._repair_gaps(exchange, symbol, timeframe)
                rows += repaired
            job.rows_processed = rows
            job.progress_pct = 100.0
            job.status = SyncJobStatus.COMPLETED.value
            job.finished_at = datetime.now(UTC)
            await self._update_metadata(exchange, symbol, timeframe)
        except Exception as e:
            job.status = SyncJobStatus.FAILED.value
            job.error_message = str(e)
            job.finished_at = datetime.now(UTC)
            logger.exception("Sync failed", extra={"exchange": exchange, "symbol": symbol})
            raise
        finally:
            await self.session.flush()
        return job

    async def _download(
        self,
        exchange: str,
        symbol: str,
        timeframe: str,
        full: bool,
    ) -> int:
        adapter = get_exchange_adapter(exchange)
        await adapter.connect()
        total_rows = 0
        batch_size = self.settings.sync_batch_size
        tf_ms = TIMEFRAME_MS.get(timeframe, 60_000)

        since: int | None = None
        if not full:
            since = self.repo.parquet.last_ts(exchange, symbol, timeframe)
            if since:
                since += tf_ms

        try:
            while True:
                candles = await adapter.fetch_ohlcv(
                    symbol, timeframe, since=since, limit=batch_size
                )
                if not candles:
                    break

                df = pl.DataFrame({
                    "ts": [int(c[0]) for c in candles],
                    "open": [float(c[1]) for c in candles],
                    "high": [float(c[2]) for c in candles],
                    "low": [float(c[3]) for c in candles],
                    "close": [float(c[4]) for c in candles],
                    "volume": [float(c[5]) for c in candles],
                })

                self.repo.write_batch(exchange, symbol, timeframe, df)
                await self.repo.upsert_db(exchange, symbol, timeframe, df)
                total_rows += len(df)

                last_ts = int(candles[-1][0])
                since = last_ts + tf_ms

                if len(candles) < batch_size:
                    break
                await asyncio.sleep(self.settings.sync_rate_limit_ms / 1000)
        finally:
            await adapter.close()

        return total_rows

    async def _repair_gaps(self, exchange: str, symbol: str, timeframe: str) -> int:
        lf = self.repo.read_lazy(exchange, symbol, timeframe)
        if lf is None:
            return 0
        df = lf.collect()
        tf_ms = TIMEFRAME_MS.get(timeframe, 60_000)
        gaps = self.validator._detect_gaps(df, tf_ms)
        if not gaps:
            return 0

        logger.info(
            "Repairing gaps",
            extra={"exchange": exchange, "symbol": symbol, "gaps": len(gaps)},
        )
        adapter = get_exchange_adapter(exchange)
        await adapter.connect()
        repaired = 0
        try:
            for gap_ts in gaps[:50]:
                candles = await adapter.fetch_ohlcv(
                    symbol, timeframe, since=gap_ts, limit=10
                )
                if not candles:
                    continue
                batch_df = pl.DataFrame({
                    "ts": [int(c[0]) for c in candles],
                    "open": [float(c[1]) for c in candles],
                    "high": [float(c[2]) for c in candles],
                    "low": [float(c[3]) for c in candles],
                    "close": [float(c[4]) for c in candles],
                    "volume": [float(c[5]) for c in candles],
                })
                self.repo.write_batch(exchange, symbol, timeframe, batch_df)
                await self.repo.upsert_db(exchange, symbol, timeframe, batch_df)
                repaired += len(batch_df)
                await asyncio.sleep(self.settings.sync_rate_limit_ms / 1000)
        finally:
            await adapter.close()
        return repaired

    async def _update_metadata(self, exchange: str, symbol: str, timeframe: str) -> None:
        path = self.repo.parquet.candle_path(exchange, symbol, timeframe)
        lf = self.repo.read_lazy(exchange, symbol, timeframe)
        first_ts = last_ts = count = None
        if lf is not None:
            stats = lf.select([
                pl.col("ts").min().alias("first_ts"),
                pl.col("ts").max().alias("last_ts"),
                pl.len().alias("count"),
            ]).collect()
            if not stats.is_empty():
                first_ts = stats.item(0, "first_ts")
                last_ts = stats.item(0, "last_ts")
                count = stats.item(0, "count")

        await self.repo.upsert_metadata(
            exchange, symbol, timeframe, first_ts, last_ts, count or 0, str(path)
        )

    async def get_job(self, job_id: int) -> SyncJob | None:
        result = await self.session.execute(select(SyncJob).where(SyncJob.id == job_id))
        return result.scalar_one_or_none()
