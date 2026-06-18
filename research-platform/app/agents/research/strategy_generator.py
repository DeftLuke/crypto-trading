"""AI-assisted strategy generation from hypotheses."""

from __future__ import annotations

import itertools
from typing import Any

from app.agents.research.condition_map import (
    INDICATOR_CONDITIONS,
    SESSIONS,
    SMC_CONDITIONS_LONG,
    SMC_CONDITIONS_SHORT,
    parse_conditions,
)
from app.agents.types import Hypothesis, StrategyDefinition
from app.signals.rules_engine import StrategyRule


class StrategyGenerator:
    MAX_CANDIDATES = 50

    def from_hypothesis(self, hypothesis: Hypothesis, index: int = 0) -> StrategyDefinition:
        rules = parse_conditions(hypothesis.conditions)
        session = next((s for s in SESSIONS if s.lower() in hypothesis.description.lower()), None)
        name = f"AI_{hypothesis.direction}_{index}_{hypothesis.hypothesis_id[:8]}"
        return StrategyDefinition(
            strategy_name=name,
            conditions=hypothesis.conditions,
            direction=hypothesis.direction,
            rule_conditions=rules,
            session_filter=session,
            version="1.0",
            source="hypothesis",
        )

    def generate_combinations(
        self,
        direction: str = "SHORT",
        max_candidates: int | None = None,
    ) -> list[StrategyDefinition]:
        max_n = max_candidates or self.MAX_CANDIDATES
        smc = SMC_CONDITIONS_SHORT if direction == "SHORT" else SMC_CONDITIONS_LONG
        candidates: list[StrategyDefinition] = []

        for rsi in INDICATOR_CONDITIONS[:3]:
            for combo_size in (2, 3):
                for smc_combo in itertools.combinations(smc, combo_size):
                    conditions = [rsi, *smc_combo]
                    rules = parse_conditions(conditions)
                    if len(rules) < 2:
                        continue
                    for session in [None, *SESSIONS[:2]]:
                        name = f"AI_GEN_{direction}_{len(candidates)}"
                        candidates.append(
                            StrategyDefinition(
                                strategy_name=name,
                                conditions=conditions,
                                direction=direction,
                                rule_conditions=rules,
                                session_filter=session,
                                source="combinatorial",
                            )
                        )
                        if len(candidates) >= max_n:
                            return candidates
        return candidates

    def to_strategy_rules(self, strategy: StrategyDefinition, rule_id: int = -1) -> list[StrategyRule]:
        if not strategy.rule_conditions:
            strategy.rule_conditions = parse_conditions(strategy.conditions)
        return [
            StrategyRule(
                id=rule_id,
                name=strategy.strategy_name,
                direction=strategy.direction,
                conditions=strategy.rule_conditions,
                enabled=True,
                priority=10,
            )
        ]

    def batch_from_hypotheses(self, hypotheses: list[Hypothesis]) -> list[StrategyDefinition]:
        return [self.from_hypothesis(h, i) for i, h in enumerate(hypotheses)]
