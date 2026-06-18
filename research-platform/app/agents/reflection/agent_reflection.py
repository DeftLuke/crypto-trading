"""Enhanced reflection agent with structured evidence."""

from __future__ import annotations

from typing import Any

from app.agents.types import AgentReflection
from app.memory.service import get_memory_service


class ReflectionAgent:
    def generate(
        self,
        strategy: dict[str, Any],
        metrics: dict[str, Any],
        memory_ids: list[str] | None = None,
    ) -> AgentReflection:
        name = strategy.get("strategy_name", "strategy")
        pf = metrics.get("profit_factor", 0)
        wr = metrics.get("win_rate", 0)
        if wr and wr <= 1:
            wr *= 100
        dd = metrics.get("max_drawdown_pct", 0)
        trades = metrics.get("total_trades", 0)

        success = pf and float(pf) >= 1.5 and float(wr or 0) >= 52

        if success:
            observation = (
                f"{name} succeeded: Profit Factor {pf:.2f}, Win Rate {wr:.0f}%, "
                f"Max DD {abs(float(dd or 0)):.1f}%. "
                f"Key conditions: {', '.join(strategy.get('conditions', [])[:4])}."
            )
            reasoning = "Strong profitability and acceptable drawdown suggest robust edge in tested regime."
        else:
            observation = (
                f"{name} underperformed: PF {pf or 0:.2f}, WR {wr or 0:.0f}%, DD {abs(float(dd or 0)):.1f}%. "
                f"Review conditions: {', '.join(strategy.get('conditions', [])[:4])}."
            )
            reasoning = "Weak metrics may indicate overfitting, wrong session filter, or regime mismatch."

        evidence = f"trades={trades}; pf={pf}; wr={wr}; dd={dd}; sharpe={metrics.get('sharpe_ratio')}"
        confidence = min(0.95, 0.5 + (float(wr or 0) / 200) + (min(float(pf or 0), 3) / 10))

        return AgentReflection(
            observation=observation,
            evidence=evidence,
            confidence=round(confidence, 3),
            category="strategy_evaluation",
            supporting_memories=memory_ids or [],
            reasoning=reasoning,
        )

    def from_pattern(self, pattern: dict[str, Any]) -> AgentReflection:
        return AgentReflection(
            observation=(
                f"{pattern.get('pattern_name', 'Pattern')}: "
                f"{' + '.join(pattern.get('conditions', [])[:4])} "
                f"produced {pattern.get('win_rate', 0):.0f}% win rate across {pattern.get('trade_count', 0)} trades."
            ),
            evidence=str(pattern),
            confidence=min(0.95, 0.5 + (pattern.get("trade_count", 0) * 0.005)),
            category="pattern",
            reasoning="Discovered via pattern discovery engine",
        )

    def persist(self, reflection: AgentReflection) -> dict[str, Any]:
        mem = get_memory_service()
        return mem.store_reflection(
            {
                "observation": reflection.observation,
                "evidence": reflection.evidence,
                "confidence": reflection.confidence,
                "category": reflection.category,
            }
        )
