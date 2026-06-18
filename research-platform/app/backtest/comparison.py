"""Strategy comparison and composite ranking."""

from typing import Any
from uuid import uuid4


class StrategyComparisonEngine:
    WEIGHTS = {
        "profitability": 0.25,
        "drawdown": 0.20,
        "sharpe": 0.20,
        "consistency": 0.15,
        "recovery": 0.20,
    }

    def rank(self, strategies: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not strategies:
            return []
        comparison_id = str(uuid4())
        scored = []

        max_return = max(s.get("return_pct", 0) for s in strategies) or 1
        min_dd = min(s.get("max_drawdown_pct", 100) for s in strategies)
        max_sharpe = max(s.get("sharpe_ratio", 0) for s in strategies) or 1
        max_pf = max(s.get("profit_factor", 0) for s in strategies) or 1
        max_recovery = max(s.get("recovery_factor", 0) for s in strategies) or 1

        for s in strategies:
            prof = s.get("return_pct", 0) / max_return * 100
            dd = 100 - (s.get("max_drawdown_pct", 0) / (min_dd + 0.01) * 50) if min_dd else 50
            sharpe = s.get("sharpe_ratio", 0) / max_sharpe * 100
            consistency = min(s.get("win_rate", 0), 100)
            recovery = s.get("recovery_factor", 0) / max_recovery * 100

            composite = (
                prof * self.WEIGHTS["profitability"]
                + dd * self.WEIGHTS["drawdown"]
                + sharpe * self.WEIGHTS["sharpe"]
                + consistency * self.WEIGHTS["consistency"]
                + recovery * self.WEIGHTS["recovery"]
            )
            scored.append({
                "comparison_id": comparison_id,
                "strategy_name": s.get("strategy_name", "unknown"),
                "backtest_id": s.get("backtest_id"),
                "composite_score": round(composite, 2),
                "profitability_score": round(prof, 2),
                "drawdown_score": round(dd, 2),
                "sharpe_score": round(sharpe, 2),
                "consistency_score": round(consistency, 2),
                "recovery_score": round(recovery, 2),
                "metrics": s,
            })

        scored.sort(key=lambda x: x["composite_score"], reverse=True)
        for i, row in enumerate(scored):
            row["rank"] = i + 1
        return scored
