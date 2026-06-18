from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.session import get_db
from app.models.tables import (
    ConfluenceScore,
    FairValueGap,
    LiquidityLevel,
    LiquiditySweep,
    MarketStructure,
    OrderBlock,
    SignalCandidate,
)
from app.services.analysis_service import AnalysisService

router = APIRouter(tags=["Phase 2 — Analysis Engine"])


def _svc(db: AsyncSession) -> AnalysisService:
    return AnalysisService(db)


@router.get("/indicators")
async def get_indicators(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("15m"),
    mtf: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> dict:
    svc = _svc(db)
    if mtf:
        return {"mtf": svc.compute_mtf(exchange.lower(), symbol.upper(), timeframe)}
    return svc.compute_indicators(exchange.lower(), symbol.upper(), timeframe)


@router.get("/smc")
async def get_smc(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("15m"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return _svc(db).compute_smc(exchange.lower(), symbol.upper(), timeframe)


@router.get("/bos")
async def get_bos(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("15m"),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(MarketStructure)
        .where(
            MarketStructure.exchange == exchange.lower(),
            MarketStructure.symbol == symbol.upper(),
            MarketStructure.timeframe == timeframe,
            MarketStructure.bos.is_(True),
        )
        .order_by(desc(MarketStructure.ts))
        .limit(limit)
    )
    rows = list(result.scalars().all())
    if not rows:
        live = _svc(db).compute_smc(exchange.lower(), symbol.upper(), timeframe)
        return {"source": "live", "latest": live.get("latest", {})}
    return {"count": len(rows), "events": [
        {"ts": r.ts, "bos_type": r.bos_type, "bias": r.structure_bias} for r in rows
    ]}


@router.get("/choch")
async def get_choch(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("15m"),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(MarketStructure)
        .where(
            MarketStructure.exchange == exchange.lower(),
            MarketStructure.symbol == symbol.upper(),
            MarketStructure.timeframe == timeframe,
            MarketStructure.choch.is_(True),
        )
        .order_by(desc(MarketStructure.ts))
        .limit(limit)
    )
    rows = list(result.scalars().all())
    if not rows:
        live = _svc(db).compute_smc(exchange.lower(), symbol.upper(), timeframe)
        return {"source": "live", "latest": live.get("latest", {})}
    return {"count": len(rows), "events": [
        {"ts": r.ts, "choch_type": r.choch_type} for r in rows
    ]}


@router.get("/fvg")
async def get_fvg(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("15m"),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(FairValueGap)
        .where(
            FairValueGap.exchange == exchange.lower(),
            FairValueGap.symbol == symbol.upper(),
            FairValueGap.timeframe == timeframe,
        )
        .order_by(desc(FairValueGap.ts))
        .limit(limit)
    )
    rows = list(result.scalars().all())
    if not rows:
        zones = _svc(db).compute_smc(exchange.lower(), symbol.upper(), timeframe).get("zones", [])
        return {"source": "live", "zones": [z for z in zones if z.get("zone_type") == "FVG"]}
    return {"count": len(rows), "gaps": [
        {"ts": r.ts, "direction": r.direction, "top": r.top, "bottom": r.bottom, "status": r.status}
        for r in rows
    ]}


@router.get("/order-blocks")
async def get_order_blocks(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("15m"),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(OrderBlock)
        .where(
            OrderBlock.exchange == exchange.lower(),
            OrderBlock.symbol == symbol.upper(),
            OrderBlock.timeframe == timeframe,
        )
        .order_by(desc(OrderBlock.ts))
        .limit(limit)
    )
    rows = list(result.scalars().all())
    if not rows:
        zones = _svc(db).compute_smc(exchange.lower(), symbol.upper(), timeframe).get("zones", [])
        return {"source": "live", "zones": [z for z in zones if z.get("zone_type") == "OB"]}
    return {"count": len(rows), "blocks": [
        {"ts": r.ts, "direction": r.direction, "high": r.high, "low": r.low, "status": r.status}
        for r in rows
    ]}


@router.get("/liquidity")
async def get_liquidity(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("15m"),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict:
    levels = await db.execute(
        select(LiquidityLevel)
        .where(
            LiquidityLevel.exchange == exchange.lower(),
            LiquidityLevel.symbol == symbol.upper(),
            LiquidityLevel.timeframe == timeframe,
        )
        .order_by(desc(LiquidityLevel.ts))
        .limit(limit)
    )
    sweeps = await db.execute(
        select(LiquiditySweep)
        .where(
            LiquiditySweep.exchange == exchange.lower(),
            LiquiditySweep.symbol == symbol.upper(),
            LiquiditySweep.timeframe == timeframe,
        )
        .order_by(desc(LiquiditySweep.ts))
        .limit(limit)
    )
    lv = list(levels.scalars().all())
    sw = list(sweeps.scalars().all())
    if not lv and not sw:
        smc = _svc(db).compute_smc(exchange.lower(), symbol.upper(), timeframe)
        return {"source": "live", "latest": smc.get("latest", {})}
    return {
        "levels": [{"ts": r.ts, "type": r.liquidity_type, "price": r.price} for r in lv],
        "sweeps": [{"ts": r.ts, "direction": r.sweep_direction} for r in sw],
    }


@router.get("/signals")
async def list_signals(
    exchange: str | None = None,
    symbol: str | None = None,
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict:
    q = select(SignalCandidate).order_by(desc(SignalCandidate.created_at)).limit(limit)
    if exchange:
        q = q.where(SignalCandidate.exchange == exchange.lower())
    if symbol:
        q = q.where(SignalCandidate.symbol == symbol.upper())
    result = await db.execute(q)
    rows = list(result.scalars().all())
    return {"count": len(rows), "signals": [
        r.signal_json or {
            "symbol": r.symbol, "direction": r.direction,
            "confidence": r.confidence, "entry": r.entry,
        }
        for r in rows
    ]}


@router.post("/signals/generate")
async def generate_signal(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("15m"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        return await _svc(db).generate_signal(exchange.lower(), symbol.upper(), timeframe)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/confluence")
async def get_confluence(
    exchange: str = Query(...),
    symbol: str = Query(...),
    timeframe: str = Query("15m"),
    direction: str = Query("SHORT"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    svc = _svc(db)
    df = svc._load_df(exchange.lower(), symbol.upper(), timeframe)
    if df is None:
        raise HTTPException(status_code=404, detail="No candle data")
    smc = svc.smc.analyze(df).latest()
    smc_dict = smc.to_dict() if smc else {}
    mtf = svc.mtf.latest_snapshot(exchange.lower(), symbol.upper(), timeframe, ("1h",))
    latest = compute_indicators_row(svc, exchange, symbol, timeframe)
    latest.update(mtf)
    result = svc.confluence.score(latest, smc_dict, direction)
    return result.to_dict()


def compute_indicators_row(svc: AnalysisService, exchange: str, symbol: str, tf: str) -> dict:
    from app.indicators.engine import compute_all_indicators, serialize_indicators
    lf = svc.store.read_candles_lazy(exchange, symbol, tf)
    if lf is None:
        return {}
    df = compute_all_indicators(lf)
    return serialize_indicators(df.tail(1).to_dicts()[0]) if len(df) else {}
