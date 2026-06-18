"""Learning agent — continuous learning from research outputs."""

from __future__ import annotations

from typing import Any

from app.agents.types import AgentInsight, LearningSnapshot
from app.memory.service import get_memory_service


class LearningAgent:
    def learn(
        self,
        memory_context: dict[str, Any],
        scores: list[dict[str, Any]],
        patterns: list[dict[str, Any]],
        regime: dict[str, Any],
    ) -> LearningSnapshot:
        best: list[str] = []
        worst: list[str] = []
        emerging: list[str] = []
        warnings: list[str] = []

        for s in sorted(scores, key=lambda x: x.get("composite_score", 0), reverse=True)[:3]:
            name = s.get("strategy_name", "")
            cs = s.get("composite_score", 0)
            if cs >= 60:
                best.append(f"{name} (score {cs:.0f})")

        for s in sorted(scores, key=lambda x: x.get("composite_score", 0))[:3]:
            if s.get("composite_score", 0) < 45:
                worst.append(s.get("strategy_name", "unknown"))

        for p in patterns[:5]:
            wr = p.get("win_rate") or 0
            if wr >= 60:
                emerging.append(p.get("pattern_name") or p.get("text", "")[:60])

        for w in memory_context.get("losing_setups", [])[:5]:
            sym = w.get("symbol", "")
            if sym:
                warnings.append(f"Avoid repeating losing {sym} setup without confluence review")

        if regime.get("volatility") == "high_volatility":
            warnings.append("High volatility regime — tighten risk or widen stops")
        if regime.get("trend") == "ranging":
            warnings.append("Ranging market — trend-following setups may underperform")

        return LearningSnapshot(
            best_conditions=best,
            worst_conditions=worst,
            emerging_patterns=emerging,
            risk_warnings=warnings,
            regime=regime.get("regime"),
        )

    def to_insights(self, snapshot: LearningSnapshot) -> list[AgentInsight]:
        insights: list[AgentInsight] = []
        for pat in snapshot.emerging_patterns[:3]:
            insights.append(
                AgentInsight(
                    title=f"Emerging pattern: {pat}",
                    summary=f"Pattern showing strength in current research cycle",
                    category="pattern",
                    confidence=0.7,
                )
            )
        for warn in snapshot.risk_warnings[:2]:
            insights.append(
                AgentInsight(
                    title="Risk warning",
                    summary=warn,
                    category="risk",
                    confidence=0.8,
                )
            )
        return insights

    def persist_state(self, snapshot: LearningSnapshot, scores: list[dict[str, Any]]) -> None:
        from app.memory.types import AgentStateMemory

        mem = get_memory_service()
        state = AgentStateMemory(
            state_key="research_agent",
            learning_state=snapshot.model_dump(mode="json"),
            strategy_rankings=scores[:10],
            recent_discoveries=snapshot.emerging_patterns,
            text=f"Learning: {len(snapshot.emerging_patterns)} patterns, regime {snapshot.regime}",
        )
        mem.store("agent_state_memories", state)
