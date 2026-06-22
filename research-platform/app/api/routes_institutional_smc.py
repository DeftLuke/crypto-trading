"""Institutional SMC API — CP0+ endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.institutional_smc.orchestrator import InstitutionalSmcOrchestrator

router = APIRouter(prefix="/institutional-smc", tags=["institutional-smc"])

_orchestrator = InstitutionalSmcOrchestrator()


class AnalyzeRequest(BaseModel):
    symbol: str = Field(..., min_length=3, max_length=32)
    persist: bool = False


class BatchAnalyzeRequest(BaseModel):
    symbols: list[str] = Field(..., min_length=1, max_length=100)
    persist: bool = False


@router.get("/health")
async def institutional_smc_health() -> dict:
    spec = _orchestrator.get_spec()
    return {
        "status": "ok",
        "engine_version": spec["engine_version"],
        "phase": spec.get("phase", "CP1"),
        "modules_implemented": spec.get("modules_implemented", []),
        "modules_pending": spec.get("modules_pending", []),
        "min_trade_score": spec["min_trade_score"],
        "candle_source": "binance.vision+parquet",
    }


@router.get("/spec")
async def institutional_smc_spec() -> dict:
    return _orchestrator.get_spec()


@router.post("/analyze")
async def analyze_symbol(body: AnalyzeRequest) -> dict:
    if body.persist:
        from app.database.session import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            result = await _orchestrator.analyze_async(
                body.symbol.upper(),
                persist=True,
                session=db,
            )
            await db.commit()
    else:
        result = await _orchestrator.analyze_async(body.symbol.upper(), persist=False)
    return result.to_dict()


@router.post("/analyze/batch")
async def analyze_batch(body: BatchAnalyzeRequest) -> dict:
    if len(body.symbols) > 100:
        raise HTTPException(status_code=400, detail="Max 100 symbols per batch")
    symbols = [s.upper() for s in body.symbols]
    if body.persist:
        from app.database.session import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            results = await _orchestrator.analyze_batch_async(
                symbols,
                persist=True,
                session=db,
            )
            await db.commit()
    else:
        results = await _orchestrator.analyze_batch_async(symbols, persist=False)
    return {
        "count": len(results),
        "results": [r.to_dict() for r in results],
    }
