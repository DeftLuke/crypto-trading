"""E5 Institutional batch backtest engine — 50+ symbols, multiprocessing."""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Any

from app.backtest.analytics import AnalyticsEngine
from app.backtest.config import BacktestConfig
from app.backtest.metrics import MetricsEngine
from app.backtest.types import BacktestResult, BacktestSymbolResult
from app.core.logging import get_logger
from app.strategies.e5_institutional.data_loader import InstitutionalDataLoader
from app.strategies.e5_institutional.features import build_e5_features
from app.strategies.e5_institutional.signals import generate_e5_signals
from app.strategies.e5_institutional.simulator import E5TradeSimulator

logger = get_logger("strategies.e5.engine")


class E5InstitutionalEngine:
    """Runs E5_INSTITUTIONAL_V1 across symbols using cached Parquet data."""

    def __init__(self, config: BacktestConfig) -> None:
        self.config = config
        self.loader = InstitutionalDataLoader(config.exchange)
        self.metrics = MetricsEngine()
        self.analytics = AnalyticsEngine()

    def run_symbol(self, symbol: str) -> BacktestSymbolResult:
        df = build_e5_features(
            self.loader,
            symbol,
            self.config.start_ts,
            self.config.end_ts,
            signal_tf=self.config.timeframe,
        )
        if df is None or df.is_empty():
            return BacktestSymbolResult(symbol=symbol, trades=[], equity_curve=[], metrics={}, signals_total=0)

        threshold = float(self.config.min_confidence or 85)
        if threshold <= 1:
            threshold = 85

        signals = generate_e5_signals(
            df,
            symbol,
            strategy_id=self.config.strategy_name,
            score_threshold=threshold,
        )
        bars = df.to_dicts()
        sim = E5TradeSimulator(self.config, symbol)
        sim.run(bars, signals)

        metrics = self.metrics.compute(sim.trades, sim.equity_curve, self.config.risk.account_balance)
        return BacktestSymbolResult(
            symbol=symbol,
            trades=sim.trades,
            equity_curve=sim.equity_curve,
            metrics=metrics,
            signals_total=len(signals),
        )

    def run(self, backtest_id: str | None = None) -> BacktestResult:
        bid = backtest_id or BacktestResult.new_id()
        symbols = self.config.symbols
        results: list[BacktestSymbolResult] = []

        workers = min(self.config.max_workers, max(1, len(symbols)))
        if workers > 1 and len(symbols) > 1:
            results = self._parallel(symbols, workers)
        else:
            for sym in symbols:
                results.append(self.run_symbol(sym))

        all_trades = []
        equity = []
        for r in results:
            all_trades.extend(r.trades)
            equity.extend(r.equity_curve)
        equity.sort(key=lambda e: e.ts)

        metrics = self.metrics.compute(all_trades, equity, self.config.risk.account_balance)
        analytics = {
            "sessions": self.analytics.session_stats(all_trades),
            "symbols": self.analytics.symbol_stats(all_trades),
            "direction": self.analytics.direction_stats(all_trades),
        }

        return BacktestResult(
            backtest_id=bid,
            mode=self.config.mode.value if hasattr(self.config.mode, "value") else str(self.config.mode),
            symbols=symbols,
            trades=all_trades,
            equity_curve=equity,
            metrics=metrics,
            analytics=analytics,
            symbol_results=results,
        )

    def _parallel(self, symbols: list[str], workers: int) -> list[BacktestSymbolResult]:
        results: list[BacktestSymbolResult] = []
        cfg = self.config.to_dict()
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futs = {pool.submit(_e5_worker, cfg, s): s for s in symbols}
            for fut in as_completed(futs):
                sym = futs[fut]
                try:
                    data = fut.result()
                    results.append(BacktestSymbolResult(**data))
                except Exception as exc:
                    logger.error("E5 symbol failed", extra={"symbol": sym, "error": str(exc)})
                    results.append(BacktestSymbolResult(symbol=sym, trades=[], equity_curve=[], metrics={}))
        return results


def _e5_worker(config_dict: dict[str, Any], symbol: str) -> dict[str, Any]:
    config = BacktestConfig.from_dict(config_dict)
    config.symbols = [symbol]
    eng = E5InstitutionalEngine(config)
    r = eng.run_symbol(symbol)
    return {
        "symbol": r.symbol,
        "trades": r.trades,
        "equity_curve": r.equity_curve,
        "metrics": r.metrics,
        "signals_total": r.signals_total,
    }
