"""Validation and behavioral analysis agent."""

from __future__ import annotations

from typing import Any

from app.agents.types import AgentRecommendation


class ValidationAgent:
    MIN_TRADES = 30
    MAX_DD_WARN = 25.0
    MIN_PF = 1.2

    def analyze(self, metrics: dict[str, Any], strategy: dict[str, Any]) -> dict[str, Any]:
        warnings: list[str] = []
        trades = int(metrics.get("total_trades") or 0)
        pf = float(metrics.get("profit_factor") or 0)
        dd = abs(float(metrics.get("max_drawdown_pct") or 0))
        sharpe = float(metrics.get("sharpe_ratio") or 0)
        wf = metrics.get("walkforward_stability")

        if trades < self.MIN_TRADES:
            warnings.append(f"Low sample size ({trades} trades) — possible overfitting")
        if dd > self.MAX_DD_WARN:
            warnings.append(f"High drawdown concentration ({dd:.1f}%)")
        if pf < self.MIN_PF:
            warnings.append(f"Weak profit factor ({pf:.2f})")
        if sharpe < 0.5 and trades > 20:
            warnings.append("Low Sharpe — weak risk-adjusted returns")
        if wf is not None and float(wf) < 40:
            warnings.append("Walk-forward instability — strategy may not generalize")

        n_conditions = len(strategy.get("conditions") or [])
        if n_conditions > 5 and trades < 50:
            warnings.append("Strategy drift risk — too many conditions for sample size")

        passed = len(warnings) == 0 and pf >= self.MIN_PF and dd <= self.MAX_DD_WARN
        return {
            "passed": passed,
            "warnings": warnings,
            "robustness_score": max(0, 100 - len(warnings) * 15),
            "overfitting_risk": "high" if trades < 20 else "medium" if trades < 50 else "low",
        }

    def recommendations(self, validation_results: list[dict[str, Any]]) -> list[AgentRecommendation]:
        recs: list[AgentRecommendation] = []
        for v in validation_results:
            for w in v.get("warnings", []):
                recs.append(
                    AgentRecommendation(
                        title="Risk warning",
                        action="review",
                        rationale=w,
                        confidence=0.75,
                        strategy_name=v.get("strategy_name"),
                    )
                )
        return recs
