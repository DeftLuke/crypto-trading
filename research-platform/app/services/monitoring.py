from datetime import UTC, datetime

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.tables import MarketMetadata, SyncJob, SyncJobStatus, SystemHealth
from app.storage.parquet_store import ParquetStorage
from app.utils.redis_client import ping_redis

logger = get_logger("services.monitoring")


class MonitoringService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def record_health_snapshot(self) -> list[SystemHealth]:
        entries: list[SystemHealth] = []

        parquet_stats = ParquetStorage().storage_stats()
        entries.append(SystemHealth(
            component="storage",
            status="ok",
            message="Parquet storage stats",
            metrics=parquet_stats,
        ))

        redis_ok = await ping_redis()
        entries.append(SystemHealth(
            component="redis",
            status="ok" if redis_ok else "degraded",
            message="Redis ping" if redis_ok else "Redis unreachable",
        ))

        meta_result = await self.session.execute(
            select(MarketMetadata).order_by(desc(MarketMetadata.last_sync_at)).limit(100)
        )
        metadata_rows = list(meta_result.scalars().all())
        stale = 0
        now = datetime.now(UTC)
        for m in metadata_rows:
            if m.last_sync_at and (now - m.last_sync_at).total_seconds() > 3600:
                stale += 1
        entries.append(SystemHealth(
            component="data_freshness",
            status="ok" if stale == 0 else "degraded",
            message=f"{stale} stale series (>1h)",
            metrics={"tracked_series": len(metadata_rows), "stale_count": stale},
        ))

        failed_result = await self.session.execute(
            select(SyncJob)
            .where(SyncJob.status == SyncJobStatus.FAILED.value)
            .order_by(desc(SyncJob.created_at))
            .limit(10)
        )
        failed = list(failed_result.scalars().all())
        entries.append(SystemHealth(
            component="sync_jobs",
            status="ok" if not failed else "degraded",
            message=f"{len(failed)} recent failed jobs",
            metrics={"recent_failures": len(failed)},
        ))

        for entry in entries:
            self.session.add(entry)
        await self.session.flush()
        logger.info("Health snapshot recorded", extra={"components": len(entries)})
        return entries
