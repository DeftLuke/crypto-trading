import asyncio
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.tables import FundingRate, OpenInterest, SyncJob, SyncJobStatus
from app.repositories.funding_repository import FundingRepository
from app.services.exchange_adapter import get_exchange_adapter

logger = get_logger("services.futures_sync")


class FuturesSyncService:
    """Sync funding rates and open interest for futures symbols."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = FundingRepository(session)
        self.settings = get_settings()

    async def sync_funding_rates(self, exchange: str, symbol: str) -> SyncJob:
        job = SyncJob(
            job_type="sync_funding_rates",
            exchange=exchange,
            symbol=symbol,
            status=SyncJobStatus.RUNNING.value,
            started_at=datetime.now(UTC),
        )
        self.session.add(job)
        await self.session.flush()

        try:
            rows = await self._download_funding(exchange, symbol)
            job.rows_processed = rows
            job.progress_pct = 100.0
            job.status = SyncJobStatus.COMPLETED.value
            job.finished_at = datetime.now(UTC)
        except Exception as e:
            job.status = SyncJobStatus.FAILED.value
            job.error_message = str(e)
            job.finished_at = datetime.now(UTC)
            raise
        finally:
            await self.session.flush()
        return job

    async def sync_open_interest(self, exchange: str, symbol: str, timeframe: str = "1h") -> SyncJob:
        job = SyncJob(
            job_type="sync_open_interest",
            exchange=exchange,
            symbol=symbol,
            timeframe=timeframe,
            status=SyncJobStatus.RUNNING.value,
            started_at=datetime.now(UTC),
        )
        self.session.add(job)
        await self.session.flush()

        try:
            rows = await self._download_open_interest(exchange, symbol, timeframe)
            job.rows_processed = rows
            job.progress_pct = 100.0
            job.status = SyncJobStatus.COMPLETED.value
            job.finished_at = datetime.now(UTC)
        except Exception as e:
            job.status = SyncJobStatus.FAILED.value
            job.error_message = str(e)
            job.finished_at = datetime.now(UTC)
            raise
        finally:
            await self.session.flush()
        return job

    async def _last_funding_ts(self, exchange: str, symbol: str) -> int | None:
        result = await self.session.execute(
            select(FundingRate.ts)
            .where(FundingRate.exchange == exchange, FundingRate.symbol == symbol)
            .order_by(FundingRate.ts.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        return int(row) if row is not None else None

    async def _last_oi_ts(self, exchange: str, symbol: str) -> int | None:
        result = await self.session.execute(
            select(OpenInterest.ts)
            .where(OpenInterest.exchange == exchange, OpenInterest.symbol == symbol)
            .order_by(OpenInterest.ts.desc())
            .limit(1)
        )
        row = result.scalar_one_or_none()
        return int(row) if row is not None else None

    async def _download_funding(self, exchange: str, symbol: str) -> int:
        adapter = get_exchange_adapter(exchange)
        await adapter.connect()
        total = 0
        since = await self._last_funding_ts(exchange, symbol)
        if since:
            since += 1
        try:
            while True:
                batch = await adapter.fetch_funding_rate_history(symbol, since=since, limit=100)
                if not batch:
                    break
                records = []
                for item in batch:
                    ts = int(item.get("timestamp") or item.get("datetime") or 0)
                    rate = float(item.get("fundingRate") or item.get("rate") or 0)
                    if ts <= 0:
                        continue
                    records.append({"exchange": exchange, "symbol": symbol, "ts": ts, "rate": rate})
                if records:
                    total += await self.repo.upsert_funding(records)
                    since = max(r["ts"] for r in records) + 1
                if len(batch) < 100:
                    break
                await asyncio.sleep(self.settings.sync_rate_limit_ms / 1000)
        finally:
            await adapter.close()
        return total

    async def _download_open_interest(self, exchange: str, symbol: str, timeframe: str) -> int:
        adapter = get_exchange_adapter(exchange)
        await adapter.connect()
        total = 0
        since = await self._last_oi_ts(exchange, symbol)
        if since:
            since += 1
        try:
            while True:
                batch = await adapter.fetch_open_interest_history(
                    symbol, timeframe, since=since, limit=100
                )
                if not batch:
                    break
                records = []
                for item in batch:
                    ts = int(item.get("timestamp") or 0)
                    oi = float(item.get("openInterestAmount") or item.get("openInterest") or 0)
                    oi_value = item.get("openInterestValue")
                    if ts <= 0:
                        continue
                    records.append({
                        "exchange": exchange,
                        "symbol": symbol,
                        "ts": ts,
                        "open_interest": oi,
                        "open_interest_value": float(oi_value) if oi_value is not None else None,
                        "metadata_json": item,
                    })
                if records:
                    total += await self.repo.upsert_open_interest(records)
                    since = max(r["ts"] for r in records) + 1
                if len(batch) < 100:
                    break
                await asyncio.sleep(self.settings.sync_rate_limit_ms / 1000)
        finally:
            await adapter.close()
        return total
