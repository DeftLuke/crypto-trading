"""Research scoring engine — composite strategy score."""

from __future__ import annotations

from typing import Any

from app.agents.types import StrategyScore


class ScoringEngine:
    def score(self, metrics: dict[str, Any], meta_prob: float | None = None) -> StrategyScore:
        pf = _f(metrics.get("profit_factor"), 1.0)
        sharpe = _f(metrics.get("sharpe_ratio"), 0.0)
        sortino = _f(metrics.get("sortino_ratio"), sharpe)
        max_dd = abs(_f(metrics.get("max_drawdown_pct"), 20.0))
        win_rate = _f(metrics.get("win_rate"), 50.0)
        if win_rate <= 1:
            win_rate *= 100
        recovery = _f(metrics.get("recovery_factor"), 1.0)
        expectancy = _f(metrics.get("expectancy"), 0.0)
        wf = metrics.get("walkforward_stability")
        mc = metrics.get("monte_carlo_robustness")

        profitability = min(100.0, pf * 25)
        sharpe_s = min(100.0, max(0, sharpe) * 35)
        sortino_s = min(100.0, max(0, sortino) * 30)
        consistency = min(100.0, win_rate)
        drawdown_s = max(0.0, 100.0 - max_dd * 2.5)
        wf_s = _f(wf, 50.0) if wf is not None else min(100.0, consistency * 0.8)
        mc_s = _f(mc, 50.0) if mc is not None else min(100.0, profitability * 0.7)
        recovery_s = min(100.0, recovery * 20)

        composite = (
            profitability * 0.22
            + sharpe_s * 0.18
            + sortino_s * 0.08
            + consistency * 0.15
            + drawdown_s * 0.15
            + wf_s * 0.10
            + mc_s * 0.07
            + recovery_s * 0.05
        )
        if meta_prob is not None:
            composite = composite * 0.85 + meta_prob * 100 * 0.15

        return StrategyScore(
            strategy_name=metrics.get("strategy_name", "unknown"),
            profitability=round(profitability, 2),
            sharpe=round(sharpe_s, 2),
            sortino=round(sortino_s, 2),
            consistency=round(consistency, 2),
            drawdown=round(drawdown_s, 2),
            walkforward_stability=round(wf_s, 2),
            monte_carlo_robustness=round(mc_s, 2),
            recovery_factor=round(recovery_s, 2),
            composite_score=round(composite, 2),
            meta_success_probability=meta_prob,
        )

    def rank(self, scores: list[StrategyScore]) -> list[StrategyScore]:
        return sorted(scores, key=lambda s: s.composite_score, reverse=True)


def _f(val: Any, default: float) -> float:
    if val is None:
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default
