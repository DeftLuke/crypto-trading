"""Batch sync + E5 helpers."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.services.sync_engine import SyncEngine
from app.strategies.e5_institutional.constants import E5_TIMEFRAMES, TOP_FUTURES_USDT
from app.market_data.symbol_universe import get_ranked_futures_universe
from app.strategies.registry import STRATEGY_REGISTRY

router = APIRouter(tags=["sync-batch"])


class SyncBatchRequest(BaseModel):
    exchange: str = "binance"
    symbols: list[str] = Field(default_factory=lambda: list(TOP_FUTURES_USDT[:10]))
    timeframes: list[str] = Field(default_factory=lambda: ["5m", "15m", "1h", "4h"])
    full: bool = False


class SyncBatchResponse(BaseModel):
    started: int
    failed: int
    symbols: list[str]
    timeframes: list[str]


@router.get("/strategies/registry")
async def list_strategies():
    return {
        "strategies": [
            {"id": m.id, "name": m.name, "version": m.version, "engine": m.engine, "description": m.description}
            for m in STRATEGY_REGISTRY.values()
        ]
    }


@router.get("/symbols/futures/top")
async def top_futures_symbols(limit: int = 50):
    limit = max(1, min(limit, 500))
    symbols = get_ranked_futures_universe(limit=limit)
    return {"symbols": symbols, "count": len(symbols), "source": "binance_24h_volume"}


@router.get("/strategies/e5/timeframes")
async def e5_timeframes():
    return E5_TIMEFRAMES


@router.post("/sync/batch", response_model=SyncBatchResponse)
async def sync_batch(body: SyncBatchRequest, db: AsyncSession = Depends(get_db)):
    """Sync multiple symbol/timeframe pairs using existing SyncEngine (no duplicate downloader)."""
    engine = SyncEngine(db)
    started = 0
    failed = 0
    for symbol in body.symbols:
        for tf in body.timeframes:
            try:
                await engine.sync_ohlcv(body.exchange.lower(), symbol.upper(), tf, full=body.full)
                started += 1
                await asyncio.sleep(0.2)
            except Exception:
                failed += 1
    await db.commit()
    return SyncBatchResponse(
        started=started,
        failed=failed,
        symbols=body.symbols,
        timeframes=body.timeframes,
    )
