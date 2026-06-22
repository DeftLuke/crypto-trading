"""Phase 3 — Institutional backtesting API."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.backtest.comparison import StrategyComparisonEngine
from app.backtest.config import BacktestConfig, BacktestMode
from app.backtest.runner import runner
from app.database.session import AsyncSessionLocal, get_db
from app.repositories.backtest_repository import BacktestRepository
from app.schemas.backtest import (
    BacktestCompareRequest,
    BacktestRankingResponse,
    BacktestResultsResponse,
    BacktestStartRequest,
    BacktestStatusResponse,
)
from app.services.analysis_service import AnalysisService

router = APIRouter(tags=["backtest"])


def _build_config(req: BacktestStartRequest) -> BacktestConfig:
    mode = BacktestMode(req.mode)
    if req.strategy_name == "E5_INSTITUTIONAL_V1" and req.mode == "single" and len(req.symbols) > 1:
        mode = BacktestMode.MULTI
    base = BacktestConfig(
        strategy_name=req.strategy_name,
        exchange=req.exchange,
        timeframe=req.timeframe,
        symbols=req.symbols,
        mode=mode,
        start_ts=req.start_ts,
        end_ts=req.end_ts,
        min_confidence=req.score_threshold,
    )
    base.risk.leverage = req.leverage
    if req.config:
        merged = base.to_dict()
        merged.update(req.config)
        return BacktestConfig.from_dict(merged)
    return base


@router.post("/backtest/start", response_model=BacktestStatusResponse)
async def start_backtest(req: BacktestStartRequest, db: AsyncSession = Depends(get_db)):
    repo = BacktestRepository(db)
    config = _build_config(req)
    bt = await repo.create_backtest(
        name=req.name,
        mode=req.mode,
        exchange=req.exchange,
        timeframe=req.timeframe,
        symbols=req.symbols,
        config_json=config.to_dict(),
        start_ts=req.start_ts,
        end_ts=req.end_ts,
    )
    await repo.update_status(bt.id, "running", 5)
    await db.commit()

    analysis = AnalysisService(db)
    rules = await analysis.load_rules()

    async def persist(result, run_id, export_paths):
        async with AsyncSessionLocal() as session:
            r = BacktestRepository(session)
            await r.persist_result(bt.id, result, UUID(run_id), export_paths)
            await session.commit()

    bid = str(bt.id)
    await runner.start(config, rules, backtest_id=bid, persist_fn=persist)
    return BacktestStatusResponse(backtest_id=bid, status="running", progress_pct=5)


@router.post("/backtest/stop")
async def stop_backtest(backtest_id: str, db: AsyncSession = Depends(get_db)):
    stopped = runner.stop(backtest_id)
    if stopped:
        repo = BacktestRepository(db)
        await repo.update_status(UUID(backtest_id), "stopped")
        await db.commit()
    return {"stopped": stopped, "backtest_id": backtest_id}


@router.get("/backtest/status", response_model=BacktestStatusResponse)
async def backtest_status(backtest_id: str):
    st = runner.status(backtest_id)
    return BacktestStatusResponse(
        backtest_id=backtest_id,
        status=st.get("status", "unknown"),
        progress_pct=st.get("progress_pct", 0),
        error=st.get("error"),
        metrics=st.get("metrics"),
        export_paths=st.get("export_paths"),
    )


@router.get("/backtest/results", response_model=BacktestResultsResponse)
async def backtest_results(backtest_id: str, db: AsyncSession = Depends(get_db)):
    repo = BacktestRepository(db)
    bt = await repo.get_backtest(UUID(backtest_id))
    if not bt:
        raise HTTPException(404, "Backtest not found")
    run = await repo.get_latest_run(UUID(backtest_id))
    trades = await repo.get_trades(UUID(backtest_id), limit=1)
    return BacktestResultsResponse(
        backtest_id=backtest_id,
        mode=bt.mode,
        symbols=bt.symbols or [],
        metrics=run.metrics_json if run else {},
        trade_count=len(trades),
    )


@router.get("/backtest/trades")
async def backtest_trades(
    backtest_id: str,
    limit: int = Query(500, le=5000),
    db: AsyncSession = Depends(get_db),
):
    repo = BacktestRepository(db)
    rows = await repo.get_trades(UUID(backtest_id), limit=limit)
    return {
        "count": len(rows),
        "trades": [
            {
                "trade_id": t.trade_id,
                "symbol": t.symbol,
                "direction": t.direction,
                "entry_time": t.entry_time,
                "exit_time": t.exit_time,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "profit_usd": t.profit_usd,
                "profit_percent": t.profit_percent,
                "result": t.result,
                "session": t.session,
                "signal_confidence": t.signal_confidence,
            }
            for t in rows
        ],
    }


@router.get("/backtest/equity")
async def backtest_equity(backtest_id: str, db: AsyncSession = Depends(get_db)):
    repo = BacktestRepository(db)
    rows = await repo.get_equity(UUID(backtest_id))
    return {"count": len(rows), "equity": [{"ts": r.ts, "balance": r.balance, "drawdown_pct": r.drawdown_pct} for r in rows]}


@router.get("/backtest/drawdown")
async def backtest_drawdown(backtest_id: str, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    from app.models.tables import BacktestDrawdownStat
    result = await db.execute(select(BacktestDrawdownStat).where(BacktestDrawdownStat.backtest_id == UUID(backtest_id)))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Drawdown stats not found")
    return {
        "max_drawdown_pct": row.max_drawdown_pct,
        "max_drawdown_usd": row.max_drawdown_usd,
        "avg_drawdown_pct": row.avg_drawdown_pct,
        "recovery_factor": row.recovery_factor,
    }


@router.get("/backtest/monthly")
async def backtest_monthly(backtest_id: str, db: AsyncSession = Depends(get_db)):
    run = await BacktestRepository(db).get_latest_run(UUID(backtest_id))
    if not run or not run.metrics_json:
        return {"monthly": []}
    return {"monthly": run.metrics_json.get("monthly", [])}


@router.get("/backtest/sessions")
async def backtest_sessions(backtest_id: str, db: AsyncSession = Depends(get_db)):
    rows = await BacktestRepository(db).get_session_stats(UUID(backtest_id))
    return {"sessions": [{"session": r.session, "trades": r.trades, "win_rate": r.win_rate, "profit_factor": r.profit_factor, "net_profit": r.net_profit} for r in rows]}


@router.get("/backtest/smc")
async def backtest_smc(backtest_id: str, db: AsyncSession = Depends(get_db)):
    rows = await BacktestRepository(db).get_smc_stats(UUID(backtest_id))
    return {"smc": [{"feature": r.feature, "trades": r.trades, "win_rate": r.win_rate, "profit_factor": r.profit_factor, "net_profit": r.net_profit} for r in rows]}


@router.get("/backtest/monte-carlo")
async def backtest_monte_carlo(backtest_id: str, db: AsyncSession = Depends(get_db)):
    row = await BacktestRepository(db).get_monte_carlo(UUID(backtest_id))
    if not row:
        raise HTTPException(404, "Monte Carlo results not found")
    return row.results_json or {}


@router.get("/backtest/walkforward")
async def backtest_walkforward(backtest_id: str, db: AsyncSession = Depends(get_db)):
    rows = await BacktestRepository(db).get_walkforward(UUID(backtest_id))
    return {"folds": [{"fold": r.fold, "validate_metrics": r.validate_metrics_json} for r in rows]}


@router.post("/backtest/rankings", response_model=BacktestRankingResponse)
async def backtest_rankings(req: BacktestCompareRequest, db: AsyncSession = Depends(get_db)):
    repo = BacktestRepository(db)
    strategies = []
    for bid in req.backtest_ids:
        run = await repo.get_latest_run(UUID(bid))
        bt = await repo.get_backtest(UUID(bid))
        if run and run.metrics_json:
            strategies.append({**run.metrics_json, "strategy_name": bt.name if bt else bid, "backtest_id": bid})
    engine = StrategyComparisonEngine()
    rankings = engine.rank(strategies)
    return BacktestRankingResponse(comparison_id=rankings[0]["comparison_id"] if rankings else "", rankings=rankings)
