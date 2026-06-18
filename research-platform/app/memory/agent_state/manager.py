"""Agent state memory manager."""

from __future__ import annotations

from typing import Any

from app.memory.types import AgentStateMemory, utc_now_iso


class AgentStateManager:
    STATE_KEY = "global"

    def build_state(
        self,
        trades: list[dict[str, Any]],
        patterns: list[dict[str, Any]],
        reflections: list[dict[str, Any]],
        strategy_rankings: list[dict[str, Any]] | None = None,
    ) -> AgentStateMemory:
        wins = [t for t in trades if (t.get("result") or "").upper() == "WIN"]
        losses = [t for t in trades if (t.get("result") or "").upper() == "LOSS"]

        best = sorted(wins, key=lambda t: float(t.get("profit_percent") or 0), reverse=True)[:5]
        worst = sorted(losses, key=lambda t: float(t.get("profit_percent") or 0))[:5]

        discoveries = [p.get("pattern_name") or p.get("observation", "")[:80] for p in patterns[:5]]
        discoveries += [r.get("observation", "")[:80] for r in reflections[:3]]

        state = AgentStateMemory(
            state_key=self.STATE_KEY,
            learning_state={
                "total_trades_analyzed": len(trades),
                "win_rate": round(len(wins) / len(trades) * 100, 2) if trades else 0,
                "patterns_discovered": len(patterns),
                "reflections_count": len(reflections),
                "updated_at": utc_now_iso(),
            },
            best_setups=[self._setup_summary(t) for t in best],
            worst_setups=[self._setup_summary(t) for t in worst],
            risk_conditions={
                "max_drawdown_observed": min((t.get("profit_percent") or 0) for t in trades) if trades else 0,
                "overtrading_sessions": self._detect_overtrading(trades),
            },
            strategy_rankings=strategy_rankings or [],
            recent_discoveries=[d for d in discoveries if d],
            text=f"Agent state: {len(trades)} trades, {len(patterns)} patterns",
        )
        return state

    def _setup_summary(self, trade: dict[str, Any]) -> dict[str, Any]:
        return {
            "symbol": trade.get("symbol"),
            "direction": trade.get("direction"),
            "profit_percent": trade.get("profit_percent"),
            "session": trade.get("session"),
            "strategy": trade.get("strategy_name"),
        }

    def _detect_overtrading(self, trades: list[dict[str, Any]]) -> list[str]:
        from collections import Counter

        sessions = Counter(t.get("session") for t in trades if t.get("session"))
        return [s for s, c in sessions.items() if c > 20]
