from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.tables import FeatureDataset, Symbol, SyncJob, SystemHealth
from app.schemas.api import (
    CandleRow,
    DatasetStatusResponse,
    HealthResponse,
    SyncJobResponse,
    SyncStartRequest,
    SymbolCreate,
    SymbolResponse,
    SystemHealthResponse,
)
from app.services.monitoring import MonitoringService
from app.services.sync_engine import SyncEngine
from app.storage.parquet_store import ParquetStorage
from app.utils.redis_client import ping_redis
from app.utils.qdrant_health import ping_qdrant

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health(db: AsyncSession = Depends(get_db)) -> HealthResponse:
    checks: dict = {}
    try:
        await db.execute(select(Symbol).limit(1))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"

    try:
        stats = ParquetStorage().storage_stats()
        checks["parquet"] = stats
    except Exception as e:
        checks["parquet"] = f"error: {e}"

    checks["redis"] = "ok" if await ping_redis() else "degraded"
    checks["qdrant"] = "ok" if ping_qdrant() else "degraded"

    status = "healthy" if checks.get("database") == "ok" else "degraded"
    return HealthResponse(
        status=status,
        service="research-platform",
        timestamp=datetime.now(UTC),
        checks=checks,
    )


@router.get("/symbols", response_model=list[SymbolResponse])
async def list_symbols(
    exchange: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[Symbol]:
    q = select(Symbol).where(Symbol.active.is_(True))
    if exchange:
        q = q.where(Symbol.exchange == exchange.lower())
    result = await db.execute(q.order_by(Symbol.exchange, Symbol.symbol))
    return list(result.scalars().all())


@router.post("/symbols/add", response_model=SymbolResponse)
async def add_symbol(body: SymbolCreate, db: AsyncSession = Depends(get_db)) -> Symbol:
    sym = Symbol(
        exchange=body.exchange.lower(),
        symbol=body.symbol.upper(),
        market_type=body.market_type,
        base_asset=body.base_asset,
        quote_asset=body.quote_asset,
        active=True,
    )
    db.add(sym)
    await db.flush()
    await db.refresh(sym)
    return sym


@router.post("/sync/start", response_model=SyncJobResponse)
async def start_sync(body: SyncStartRequest, db: AsyncSession = Depends(get_db)) -> SyncJob:
    engine = SyncEngine(db)
    try:
        job = await engine.sync_ohlcv(
            body.exchange.lower(),
            body.symbol.upper(),
            body.timeframe,
            full=body.full,
        )
        return job
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/sync/status", response_model=SyncJobResponse)
async def sync_status(job_id: int, db: AsyncSession = Depends(get_db)) -> SyncJob:
    engine = SyncEngine(db)
    job = await engine.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/candles", response_model=list[CandleRow])
async def get_candles(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query(...),
    limit: int = Query(500, le=5000),
    db: AsyncSession = Depends(get_db),
) -> list[CandleRow]:
    store = ParquetStorage()
    lf = store.read_candles_lazy(exchange.lower(), symbol.upper(), timeframe)
    if lf is None:
        return []
    df = lf.sort("ts", descending=True).limit(limit).collect().sort("ts")
    return [CandleRow(**row) for row in df.to_dicts()]


@router.get("/dataset/status", response_model=list[DatasetStatusResponse])
async def dataset_status(db: AsyncSession = Depends(get_db)) -> list[FeatureDataset]:
    result = await db.execute(
        select(FeatureDataset).order_by(desc(FeatureDataset.created_at)).limit(20)
    )
    return list(result.scalars().all())


@router.get("/system/health", response_model=list[SystemHealthResponse])
async def system_health(db: AsyncSession = Depends(get_db)) -> list[SystemHealth]:
    result = await db.execute(
        select(SystemHealth).order_by(desc(SystemHealth.recorded_at)).limit(50)
    )
    rows = list(result.scalars().all())
    if not rows:
        monitoring = MonitoringService(db)
        rows = await monitoring.record_health_snapshot()
    return rows
