"""Main backtesting orchestrator."""

from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Any

import polars as pl

from app.backtest.analytics import AnalyticsEngine
from app.backtest.comparison import StrategyComparisonEngine
from app.backtest.config import BacktestConfig, BacktestMode
from app.backtest.equity import EquityEngine
from app.backtest.feature_pipeline import FeaturePipeline
from app.backtest.metrics import MetricsEngine
from app.backtest.monte_carlo import MonteCarloEngine
from app.backtest.simulator import TradeSimulator
from app.backtest.types import BacktestResult, BacktestSymbolResult
from app.backtest.walkforward import WalkForwardEngine
from app.core.logging import get_logger
from app.signals.rules_engine import StrategyRule, StrategyRulesEngine

logger = get_logger("backtest.engine")


class BacktestEngine:
    def __init__(self, config: BacktestConfig, rules: list[StrategyRule] | None = None) -> None:
        self.config = config
        self.rules = rules or StrategyRulesEngine.default_short_rules()
        self.pipeline = FeaturePipeline()
        self.metrics_engine = MetricsEngine()
        self.equity_engine = EquityEngine()
        self.analytics = AnalyticsEngine()
        self.monte_carlo = MonteCarloEngine()
        self.comparison = StrategyComparisonEngine()

    def run_symbol(
        self,
        symbol: str,
        preloaded: pl.DataFrame | None = None,
    ) -> BacktestSymbolResult:
        df = preloaded or self.pipeline.load_features(
            self.config.exchange,
            symbol,
            self.config.timeframe,
            self.config.start_ts,
            self.config.end_ts,
        )
        if df is None or df.is_empty():
            return BacktestSymbolResult(symbol=symbol, trades=[], equity_curve=[], metrics={}, signals_total=0)

        rows = df.to_dicts()
        sim = TradeSimulator(self.config, self.rules, symbol)
        sim.run(rows, self.pipeline.build_context)

        metrics = self.metrics_engine.compute(
            sim.trades,
            sim.equity_curve,
            self.config.risk.account_balance,
        )
        return BacktestSymbolResult(
            symbol=symbol,
            trades=sim.trades,
            equity_curve=sim.equity_curve,
            metrics=metrics,
            signals_total=sim.signals_total,
        )

    def run(self, backtest_id: str | None = None) -> BacktestResult:
        bid = backtest_id or BacktestResult.new_id()
        symbols = self.config.symbols
        symbol_results: list[BacktestSymbolResult] = []

        if self.config.mode in (BacktestMode.MULTI, BacktestMode.PORTFOLIO) and len(symbols) > 1:
            symbol_results = self._run_parallel(symbols)
        else:
            for sym in symbols:
                symbol_results.append(self.run_symbol(sym))

        all_trades = []
        combined_equity = []
        for sr in symbol_results:
            all_trades.extend(sr.trades)
            combined_equity.extend(sr.equity_curve)
        combined_equity.sort(key=lambda e: e.ts)

        metrics = self.metrics_engine.compute(
            all_trades,
            combined_equity,
            self.config.risk.account_balance,
        )

        analytics = {
            "sessions": self.analytics.session_stats(all_trades),
            "symbols": self.analytics.symbol_stats(all_trades),
            "smc": self.analytics.smc_stats(all_trades),
            "direction": self.analytics.direction_stats(all_trades),
            "drawdown": self.analytics.drawdown_report(
                metrics.get("max_drawdown_pct", 0),
                metrics.get("avg_drawdown_pct", 0),
                metrics.get("net_profit", 0),
                self.config.risk.account_balance,
            ),
            "daily": self.equity_engine.daily_pnl(combined_equity),
            "weekly": self.equity_engine.aggregate_trades_by_period(all_trades, "weekly"),
            "monthly": self.equity_engine.aggregate_trades_by_period(all_trades, "monthly"),
            "yearly": self.equity_engine.aggregate_trades_by_period(all_trades, "yearly"),
        }

        walkforward: list[dict] = []
        monte_carlo: dict | None = None

        if self.config.mode == BacktestMode.WALKFORWARD and symbols:
            wf = WalkForwardEngine(self.config, self.rules)
            df = self.pipeline.load_features(
                self.config.exchange, symbols[0], self.config.timeframe,
                self.config.start_ts, self.config.end_ts,
            )
            if df is not None:
                walkforward = wf.run(df, symbols[0])

        if self.config.mode == BacktestMode.MONTE_CARLO or self.config.monte_carlo_simulations:
            monte_carlo = self.monte_carlo.run(
                all_trades,
                self.config.risk.account_balance,
                self.config.monte_carlo_simulations,
            )

        return BacktestResult(
            backtest_id=bid,
            mode=self.config.mode.value,
            symbols=symbols,
            trades=all_trades,
            equity_curve=combined_equity,
            metrics=metrics,
            analytics=analytics,
            symbol_results=symbol_results,
            walkforward=walkforward,
            monte_carlo=monte_carlo,
        )

    def _run_parallel(self, symbols: list[str]) -> list[BacktestSymbolResult]:
        results = []
        workers = min(self.config.max_workers, len(symbols))
        if workers <= 1:
            return [self.run_symbol(s) for s in symbols]

        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_run_symbol_worker, self.config.to_dict(), s): s for s in symbols}
            for fut in as_completed(futures):
                sym = futures[fut]
                try:
                    data = fut.result()
                    results.append(BacktestSymbolResult(**data))
                except Exception as exc:
                    logger.error("Parallel backtest failed", extra={"symbol": sym, "error": str(exc)})
                    results.append(BacktestSymbolResult(symbol=sym, trades=[], equity_curve=[], metrics={}))
        return results


def _run_symbol_worker(config_dict: dict, symbol: str) -> dict[str, Any]:
    """Picklable worker for multiprocessing."""
    config = BacktestConfig.from_dict(config_dict)
    config.symbols = [symbol]
    engine = BacktestEngine(config)
    result = engine.run_symbol(symbol)
    return {
        "symbol": result.symbol,
        "trades": result.trades,
        "equity_curve": result.equity_curve,
        "metrics": result.metrics,
        "signals_total": result.signals_total,
    }
