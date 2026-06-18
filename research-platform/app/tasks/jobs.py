"""Scheduled task implementations."""

import asyncio

from sqlalchemy import select

from app.core.config import get_settings
from app.core.logging import get_logger
from app.database.session import AsyncSessionLocal
from app.models.tables import Symbol
from app.services.dataset_builder import DatasetBuilder
from app.services.futures_sync import FuturesSyncService
from app.services.indicator_service import IndicatorService
from app.services.monitoring import MonitoringService
from app.services.sync_engine import SyncEngine
from app.services.validation import DataValidator
from app.storage.parquet_store import ParquetStorage

logger = get_logger("tasks.jobs")


def _run_async(coro):
    return asyncio.run(coro)


async def _active_symbols():
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Symbol).where(Symbol.active.is_(True)))
        return list(result.scalars().all())


async def _sync_all(full: bool = False) -> None:
    symbols = await _active_symbols()
    if not symbols:
        logger.info("No active symbols to sync")
        return
    settings = get_settings()
    async with AsyncSessionLocal() as session:
        engine = SyncEngine(session)
        for sym in symbols:
            for tf in settings.timeframes:
                try:
                    await engine.sync_ohlcv(sym.exchange, sym.symbol, tf, full=full)
                    await session.commit()
                except Exception:
                    await session.rollback()
                    logger.exception("Sync failed", extra={"symbol": sym.symbol, "timeframe": tf})


async def _sync_futures() -> None:
    symbols = await _active_symbols()
    async with AsyncSessionLocal() as session:
        futures = FuturesSyncService(session)
        for sym in symbols:
            try:
                await futures.sync_funding_rates(sym.exchange, sym.symbol)
                await futures.sync_open_interest(sym.exchange, sym.symbol)
                await session.commit()
            except Exception:
                await session.rollback()
                logger.exception("Futures sync failed", extra={"symbol": sym.symbol})


def job_sync_latest_data() -> None:
    logger.info("Job: sync_latest_data")
    _run_async(_sync_all(full=False))
    _run_async(_sync_futures())


def job_download_history() -> None:
    logger.info("Job: download_history")
    _run_async(_sync_all(full=True))


async def _validate_all() -> None:
    store = ParquetStorage()
    symbols = await _active_symbols()
    validator = DataValidator()
    settings = get_settings()
    for sym in symbols:
        for tf in settings.timeframes:
            lf = store.read_candles_lazy(sym.exchange, sym.symbol, tf)
            if lf is None:
                continue
            df = lf.collect()
            report = validator.validate_candles(df, sym.exchange, sym.symbol, tf)
            logger.info("Validation report", extra=report.to_dict())


def job_validate_data() -> None:
    logger.info("Job: validate_data")
    _run_async(_validate_all())


async def _calculate_indicators() -> None:
    symbols = await _active_symbols()
    settings = get_settings()
    async with AsyncSessionLocal() as session:
        service = IndicatorService(session)
        for sym in symbols:
            for tf in settings.timeframes:
                lf = ParquetStorage().read_candles_lazy(sym.exchange, sym.symbol, tf)
                if lf is None:
                    continue
                try:
                    await service.compute_and_persist(sym.exchange, sym.symbol, tf)
                    await session.commit()
                except Exception:
                    await session.rollback()
                    logger.exception(
                        "Indicator persist failed",
                        extra={"symbol": sym.symbol, "timeframe": tf},
                    )


def job_calculate_indicators() -> None:
    logger.info("Job: calculate_indicators")
    _run_async(_calculate_indicators())


async def _build_datasets() -> None:
    symbols = await _active_symbols()
    async with AsyncSessionLocal() as session:
        builder = DatasetBuilder(session)
        for sym in symbols[:10]:
            try:
                await builder.build(sym.exchange, sym.symbol, "15m")
                await session.commit()
            except Exception:
                await session.rollback()
                logger.exception("Dataset build failed", extra={"symbol": sym.symbol})


def job_build_feature_dataset() -> None:
    logger.info("Job: build_feature_dataset")
    _run_async(_build_datasets())


async def _record_health() -> None:
    async with AsyncSessionLocal() as session:
        monitoring = MonitoringService(session)
        await monitoring.record_health_snapshot()
        await session.commit()


def job_record_health() -> None:
    _run_async(_record_health())
