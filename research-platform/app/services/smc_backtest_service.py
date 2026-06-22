"""
3-Phase SMC-MTF Backtest Pipeline
  Phase 1 — Historical downloader (DB/Parquet + sync)
  Phase 2 — SMC detection + indicators (FeaturePipeline)
  Phase 3 — Backtesting engine + metrics
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime, timedelta
from typing import Any, Callable
from uuid import uuid4

import polars as pl

from app.backtest.config import BacktestConfig
from app.backtest.engine import BacktestEngine
from app.backtest.feature_pipeline import FeaturePipeline
from app.core.logging import get_logger
from app.database.session import AsyncSessionLocal
from app.services.candle_loader import CandleLoader
from app.signals.rules_engine import StrategyRule, StrategyRulesEngine

logger = get_logger("services.smc_backtest")

ProgressFn = Callable[[float, str, str], None] | None

PERIOD_DAYS = {
    "1w": 7,
    "1m": 30,
    "3m": 90,
    "6m": 180,
    "1y": 365,
}

_jobs: dict[str, dict[str, Any]] = {}


def _period_range(period: str) -> tuple[int, int]:
    days = PERIOD_DAYS.get(period, 90)
    end = datetime.now(UTC).replace(hour=23, minute=59, second=59, microsecond=999000)
    start = end - timedelta(days=days)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _warmup_ms(timeframe: str) -> int:
    ms_map = {
        "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
        "30m": 1_800_000, "1h": 3_600_000,
    }
    return 500 * ms_map.get(timeframe, 300_000)


def smc_mtf_rules() -> list[StrategyRule]:
    """SMC Multi-Timeframe — RSI + MTF EMA100 + BOS alignment."""
    return [
        StrategyRule(
            id=1,
            name="smc_long",
            direction="LONG",
            priority=10,
            conditions=[
                {"field": "rsi14", "op": "<", "value": 30},
                {"field": "close_above_ema100_1h", "op": "==", "value": 1, "type": "bool"},
                {"field": "bos_bullish", "op": "==", "value": 1, "type": "bool"},
                {"field": "volatility_safe", "op": "==", "value": 1, "type": "bool"},
            ],
        ),
        StrategyRule(
            id=2,
            name="smc_short",
            direction="SHORT",
            priority=10,
            conditions=[
                {"field": "rsi14", "op": ">", "value": 70},
                {"field": "close_below_ema100_1h", "op": "==", "value": 1, "type": "bool"},
                {"field": "bos_bearish", "op": "==", "value": 1, "type": "bool"},
                {"field": "volatility_safe", "op": "==", "value": 1, "type": "bool"},
            ],
        ),
    ]


def _avg_rr(trades: list) -> float:
    rrs = []
    for t in trades:
        if not t.exit_price or not t.stop_loss or not t.entry_price:
            continue
        risk = abs(t.entry_price - t.stop_loss)
        if risk <= 0:
            continue
        pnl = (t.exit_price - t.entry_price) if t.direction == "LONG" else (t.entry_price - t.exit_price)
        rrs.append(pnl / risk)
    return round(sum(rrs) / len(rrs), 2) if rrs else 0.0


def format_frontend_payload(
    symbol: str,
    timeframe: str,
    period: str,
    start_ts: int,
    end_ts: int,
    symbol_result,
    initial_capital: float,
    duration_ms: int,
    bars_analyzed: int,
) -> dict[str, Any]:
    m = symbol_result.metrics or {}
    trades_out = []
    for t in symbol_result.trades:
        if not t.exit_time or t.exit_price is None:
            continue
        direction = "BUY" if t.direction == "LONG" else "SELL"
        risk = abs(t.entry_price - (t.stop_loss or t.entry_price)) or 1
        pnl = (t.exit_price - t.entry_price) if t.direction == "LONG" else (t.entry_price - t.exit_price)
        r_mult = pnl / risk
        outcome = "win" if (t.profit_usd or 0) > 0 else "loss" if (t.profit_usd or 0) < 0 else "breakeven"
        trades_out.append({
            "direction": direction,
            "entry": t.entry_price,
            "exit": t.exit_price,
            "stopLoss": t.stop_loss,
            "tp2": t.take_profit,
            "outcome": outcome,
            "rMultiple": round(r_mult, 3),
            "pnl": t.profit_usd or 0,
            "pnlDollar": t.profit_usd or 0,
            "entryTime": t.entry_time // 1000,
            "exitTime": t.exit_time // 1000,
            "entryDate": datetime.fromtimestamp(t.entry_time / 1000, UTC).isoformat(),
            "exitDate": datetime.fromtimestamp(t.exit_time / 1000, UTC).isoformat(),
            "open": False,
        })

    equity = [
        {"time": e.ts // 1000, "equity": e.balance}
        for e in (symbol_result.equity_curve or [])
    ]
    if not equity:
        equity = [{"time": end_ts // 1000, "equity": initial_capital}]

    net_profit = m.get("net_profit", 0)
    net_pct = m.get("return_pct", net_profit / initial_capital * 100 if initial_capital else 0)
    avg_rr = _avg_rr(symbol_result.trades)

    chart_candles = []
    # chart built separately if needed

    return {
        "symbol": symbol.upper(),
        "strategyId": "smc-mtf",
        "entryTimeframe": timeframe,
        "period": period,
        "startDate": datetime.fromtimestamp(start_ts / 1000, UTC).isoformat(),
        "endDate": datetime.fromtimestamp(end_ts / 1000, UTC).isoformat(),
        "barsAnalyzed": bars_analyzed,
        "totalTrades": m.get("total_trades", len(trades_out)),
        "wins": m.get("winning_trades", 0),
        "losses": m.get("losing_trades", 0),
        "winRate": m.get("win_rate", 0),
        "profitFactor": m.get("profit_factor", 0),
        "totalPnl": net_profit,
        "netProfit": net_profit,
        "netProfitPercent": round(net_pct, 2),
        "avgRMultiple": avg_rr,
        "averageRR": avg_rr,
        "maxDrawdownPercent": m.get("max_drawdown_pct", 0),
        "maxDrawdown": {"value": 0, "percent": m.get("max_drawdown_pct", 0)},
        "initialCapital": initial_capital,
        "finalEquity": m.get("final_balance", initial_capital + net_profit),
        "grossProfit": m.get("gross_profit", 0),
        "grossLoss": m.get("gross_loss", 0),
        "avgWin": m.get("average_win", 0),
        "avgLoss": m.get("average_loss", 0),
        "largestWin": m.get("largest_win", 0),
        "largestLoss": m.get("largest_loss", 0),
        "maxConsecutiveWins": m.get("longest_win_streak", 0),
        "maxConsecutiveLosses": m.get("longest_loss_streak", 0),
        "equityCurve": equity,
        "trades": trades_out,
        "chartCandles": chart_candles,
        "dataSource": "python",
        "engine": "research-platform",
        "durationMs": duration_ms,
        "summary": {
            "totalTrades": m.get("total_trades", 0),
            "winRate": m.get("win_rate", 0),
            "profitFactor": m.get("profit_factor", 0),
            "maxDrawdown": m.get("max_drawdown_pct", 0),
            "netProfitPct": round(net_pct, 1),
            "averageRR": avg_rr,
        },
    }


class SmcBacktestService:
    async def run(
        self,
        symbol: str,
        timeframe: str = "15m",
        period: str = "3m",
        initial_capital: float = 10_000,
        on_progress: ProgressFn = None,
    ) -> dict[str, Any]:
        t0 = time.time()
        sym = symbol.upper()
        start_ts, end_ts = _period_range(period)
        fetch_start = start_ts - _warmup_ms(timeframe)

        mtf_tfs = sorted(set([timeframe, "15m", "30m", "1h"]))

        if on_progress:
            on_progress(2, "init", f"Starting SMC backtest {sym} {timeframe} {period}")

        async with AsyncSessionLocal() as session:
            loader = CandleLoader()
            candles_map = await loader.ensure_candles(
                session, sym, mtf_tfs, fetch_start, end_ts, on_progress
            )

        if on_progress:
            on_progress(45, "smc", "Running SMC detection + indicators…")

        pipeline = FeaturePipeline()
        df = pipeline.load_features(
            "binance", sym, timeframe, fetch_start, end_ts, use_cached=False
        )
        if df is None:
            entry_df = candles_map.get(timeframe)
            if entry_df is None:
                raise RuntimeError(f"Feature pipeline failed for {sym} {timeframe}")
            from app.indicators.engine import compute_all_indicators
            df = compute_all_indicators(pl.LazyFrame(entry_df)).collect().sort("ts")

        bars_in_period = len(df.filter(pl.col("ts") >= start_ts)) if not df.is_empty() else 0

        if on_progress:
            on_progress(70, "backtest", f"Simulating trades on {bars_in_period:,} bars…")

        config = BacktestConfig(
            strategy_name="smc-mtf",
            exchange="binance",
            timeframe=timeframe,
            symbols=[sym],
            start_ts=start_ts,
            end_ts=end_ts,
        )
        config.risk.account_balance = initial_capital

        engine = BacktestEngine(config, smc_mtf_rules())
        symbol_result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: engine.run_symbol(sym, preloaded=df)
        )

        if on_progress:
            on_progress(95, "report", "Building results…")

        duration_ms = int((time.time() - t0) * 1000)
        payload = format_frontend_payload(
            sym, timeframe, period, start_ts, end_ts,
            symbol_result, initial_capital, duration_ms, bars_in_period,
        )

        # Chart candles from entry TF
        period_df = df.filter(pl.col("ts") >= start_ts).filter(pl.col("ts") <= end_ts)
        if not period_df.is_empty():
            step = max(1, len(period_df) // 1500)
            sampled = period_df[::step]
            payload["chartCandles"] = [
                {
                    "time": int(r["ts"] // 1000),
                    "open": r["open"],
                    "high": r["high"],
                    "low": r["low"],
                    "close": r["close"],
                    "volume": r["volume"],
                }
                for r in sampled.to_dicts()
            ]

        if on_progress:
            on_progress(100, "done", "Backtest complete")

        return payload

    async def start_job(
        self,
        symbol: str,
        timeframe: str,
        period: str,
        initial_capital: float = 10_000,
    ) -> str:
        job_id = str(uuid4())

        def progress(pct: float, phase: str, message: str) -> None:
            _jobs[job_id] = {
                "status": "running",
                "progress_pct": pct,
                "phase": phase,
                "message": message,
            }

        _jobs[job_id] = {"status": "running", "progress_pct": 0, "phase": "init", "message": "Starting…"}

        async def _task() -> None:
            try:
                result = await self.run(
                    symbol, timeframe, period, initial_capital, on_progress=progress
                )
                _jobs[job_id] = {
                    "status": "completed",
                    "progress_pct": 100,
                    "phase": "done",
                    "message": "Complete",
                    "result": result,
                }
            except Exception as exc:
                logger.exception("SMC backtest job failed")
                _jobs[job_id] = {
                    "status": "failed",
                    "progress_pct": 0,
                    "phase": "error",
                    "message": str(exc),
                    "error": str(exc),
                }

        asyncio.create_task(_task())
        return job_id

    def job_status(self, job_id: str) -> dict[str, Any]:
        return _jobs.get(job_id, {"status": "unknown", "progress_pct": 0, "error": "Job not found"})


smc_backtest_service = SmcBacktestService()
