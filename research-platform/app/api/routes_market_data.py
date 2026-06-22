"""Market data API — Binance Vision archives + local Parquet manager."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.market_data.constants import INSTITUTIONAL_MTF
from app.market_data.download_queue import get_download_queue
from app.market_data.manager import MarketDataManager
from app.market_data.symbol_universe import get_ranked_futures_universe, universe_size

router = APIRouter(prefix="/market-data", tags=["market-data"])
_manager = MarketDataManager()


class IngestRequest(BaseModel):
    symbol: str = Field(..., min_length=3, max_length=32)
    timeframe: str = Field(..., min_length=2, max_length=8)
    months_back: int | None = Field(default=None, ge=1, le=120)
    force: bool = False


class EnsureRequest(BaseModel):
    symbol: str = Field(..., min_length=3, max_length=32)
    timeframes: list[str] = Field(default_factory=lambda: list(INSTITUTIONAL_MTF))
    months_back: int | None = Field(default=None, ge=1, le=120)


class AppendBarRequest(BaseModel):
    symbol: str
    timeframe: str
    ts: int = Field(..., description="Open time ms")
    open: float
    high: float
    low: float
    close: float
    volume: float


class LoadTailRequest(BaseModel):
    symbol: str
    timeframe: str
    limit: int = Field(default=500, ge=10, le=5000)


@router.get("/health")
async def market_data_health() -> dict:
    stats = _manager.storage_stats()
    return {"status": "ok", "source": "binance.vision+parquet", **stats}


@router.get("/status/{symbol}/{timeframe}")
async def timeframe_status(symbol: str, timeframe: str) -> dict:
    return _manager.status(symbol.upper(), timeframe)


@router.post("/status/mtf")
async def mtf_status(body: EnsureRequest) -> dict:
    return _manager.mtf_status(body.symbol.upper(), body.timeframes)


@router.post("/ingest")
async def ingest_archive(body: IngestRequest) -> dict:
    return _manager.ingest_archives(
        body.symbol.upper(),
        body.timeframe,
        months_back=body.months_back,
        force=body.force,
    )


@router.post("/ensure")
async def ensure_data(body: EnsureRequest) -> dict:
    return {
        "symbol": body.symbol.upper(),
        "results": _manager.ensure_timeframes(
            body.symbol.upper(),
            body.timeframes,
            months_back=body.months_back,
        ),
    }


@router.post("/candles/append")
async def append_candle(body: AppendBarRequest) -> dict:
    path = _manager.append_bar(
        body.symbol.upper(),
        body.timeframe,
        ts=body.ts,
        open=body.open,
        high=body.high,
        low=body.low,
        close=body.close,
        volume=body.volume,
    )
    return {"ok": True, "path": str(path)}


@router.post("/candles/tail")
async def load_tail(body: LoadTailRequest) -> dict:
    df = _manager.load_tail(body.symbol.upper(), body.timeframe, body.limit)
    if df is None or df.is_empty():
        raise HTTPException(status_code=404, detail="No local data")
    return {
        "symbol": body.symbol.upper(),
        "timeframe": body.timeframe,
        "count": len(df),
        "candles": df.to_dicts(),
    }


@router.get("/validate/{symbol}/{timeframe}")
async def validate(symbol: str, timeframe: str, limit: int = 500) -> dict:
    return _manager.validate_continuity(symbol.upper(), timeframe, limit)


class AutoDownloadRequest(BaseModel):
    auto_download: bool = True
    auto_update: bool = True


class StartPhaseRequest(BaseModel):
    phase: int | None = Field(default=None, ge=1, le=20)


@router.get("/universe")
async def market_data_universe(limit: int | None = None) -> dict:
    n = limit or universe_size()
    symbols = get_ranked_futures_universe(limit=n)
    return {
        "symbols": symbols,
        "count": len(symbols),
        "target_size": n,
        "phase_size": int(__import__("os").getenv("MARKET_DATA_PHASE_SIZE", "50")),
        "source": "binance_24h_volume",
    }


@router.post("/jobs/refresh-universe")
async def refresh_download_universe() -> dict:
    """Re-fetch top ranked pairs (default 200) and expand phased queue."""
    return get_download_queue().refresh_universe()


@router.get("/jobs/progress")
async def download_progress() -> dict:
    """Full phased download progress — poll every 2s from dashboard."""
    return get_download_queue().get_progress()


@router.post("/jobs/auto")
async def configure_auto_download(body: AutoDownloadRequest) -> dict:
    return get_download_queue().configure_auto(
        auto_download=body.auto_download,
        auto_update=body.auto_update,
    )


@router.post("/jobs/start")
async def start_download_phase(body: StartPhaseRequest) -> dict:
    try:
        return get_download_queue().start_phase(body.phase)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/jobs/pause")
async def pause_downloads() -> dict:
    return get_download_queue().pause()


@router.post("/jobs/resume")
async def resume_downloads() -> dict:
    return get_download_queue().resume()


@router.post("/jobs/reset/{phase}")
async def reset_phase(phase: int) -> dict:
    if phase < 1:
        raise HTTPException(status_code=400, detail="phase must be >= 1")
    return get_download_queue().reset_phase(phase)
