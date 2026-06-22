"""Grid-search parameter optimization for EMA and ATR settings."""

from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass
from copy import deepcopy

from backtest.engine import BacktestEngine
from backtest.metrics import PerformanceSummary, compute_metrics
from config.settings import Settings
from strategies.tradegpt_e5 import build_feature_frame, generate_signals

logger = logging.getLogger(__name__)


@dataclass
class OptimizationResult:
    best_params: dict
    best_summary: PerformanceSummary
    trials: list[dict]


def optimize_parameters(
    ltf_df,
    htf_df,
    base_settings: Settings,
    ema_fast_range: tuple[int, ...] = (15, 20, 25),
    ema_mid_range: tuple[int, ...] = (40, 50, 60),
    atr_range: tuple[int, ...] = (10, 14, 20),
) -> OptimizationResult:
    """
    Test combinations of EMA and ATR values; score by profit factor × win rate.
    """
    combos = list(itertools.product(ema_fast_range, ema_mid_range, atr_range))
    if len(combos) > base_settings.optimization_samples:
        combos = combos[: base_settings.optimization_samples]

    best_score = -1.0
    best_params: dict = {}
    best_summary: PerformanceSummary | None = None
    trials: list[dict] = []

    for ema_fast, ema_mid, atr_period in combos:
        settings = deepcopy(base_settings)
        settings.ema_fast = ema_fast
        settings.ema_mid = ema_mid
        settings.atr_period = atr_period

        try:
            features = build_feature_frame(ltf_df, htf_df, settings)
            signals = generate_signals(features, settings)
            engine = BacktestEngine(settings)
            result = engine.run(features, signals)
            summary = compute_metrics(result)
            score = summary.profit_factor * (summary.win_rate / 100) * (1 + summary.net_profit_pct / 100)
            if summary.total_trades < 3:
                score *= 0.1
            trials.append(
                {
                    "ema_fast": ema_fast,
                    "ema_mid": ema_mid,
                    "atr_period": atr_period,
                    "score": round(score, 4),
                    "net_profit": summary.net_profit,
                    "win_rate": summary.win_rate,
                    "total_trades": summary.total_trades,
                },
            )
            if score > best_score:
                best_score = score
                best_params = {
                    "ema_fast": ema_fast,
                    "ema_mid": ema_mid,
                    "atr_period": atr_period,
                }
                best_summary = summary
        except Exception as exc:
            logger.warning("Optimization trial failed (%s, %s, %s): %s", ema_fast, ema_mid, atr_period, exc)

    if best_summary is None:
        from backtest.metrics import PerformanceSummary as PS

        best_summary = PS(
            total_trades=0, winning_trades=0, losing_trades=0, win_rate=0,
            profit_factor=0, net_profit=0, net_profit_pct=0, max_drawdown=0,
            max_drawdown_pct=0, sharpe_ratio=0, average_rr=0,
            gross_profit=0, gross_loss=0, initial_balance=base_settings.initial_balance,
            final_balance=base_settings.initial_balance,
        )

    logger.info("Best params: %s (score=%.4f)", best_params, best_score)
    return OptimizationResult(best_params=best_params, best_summary=best_summary, trials=trials)
