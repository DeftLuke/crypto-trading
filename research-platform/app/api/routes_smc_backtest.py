"""SMC-MTF backtest API — DB-first pipeline with progress."""

from pydantic import BaseModel, Field

from fastapi import APIRouter, HTTPException

from app.services.smc_backtest_service import smc_backtest_service

router = APIRouter(tags=["smc-backtest"])


class SmcBacktestRunRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "15m"
    period: str = Field(default="3m", pattern="^(1w|1m|3m|6m|1y)$")
    initial_capital: float = 10_000


class SmcBacktestJobResponse(BaseModel):
    job_id: str
    status: str = "running"
    progress_pct: float = 0
    phase: str | None = None
    message: str | None = None


@router.post("/backtest/smc/run", response_model=SmcBacktestJobResponse)
async def start_smc_backtest(body: SmcBacktestRunRequest) -> SmcBacktestJobResponse:
    job_id = await smc_backtest_service.start_job(
        symbol=body.symbol.upper(),
        timeframe=body.timeframe,
        period=body.period,
        initial_capital=body.initial_capital,
    )
    return SmcBacktestJobResponse(job_id=job_id, status="running", progress_pct=0, phase="init")


@router.get("/backtest/smc/status/{job_id}")
async def smc_backtest_status(job_id: str) -> dict:
    st = smc_backtest_service.job_status(job_id)
    if st.get("status") == "unknown":
        raise HTTPException(404, "Job not found")
    return st


@router.post("/backtest/smc/sync")
async def run_smc_backtest_sync(body: SmcBacktestRunRequest) -> dict:
    """Blocking run — used by Node subprocess / internal proxy."""
    try:
        result = await smc_backtest_service.run(
            symbol=body.symbol.upper(),
            timeframe=body.timeframe,
            period=body.period,
            initial_capital=body.initial_capital,
        )
        return result
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
