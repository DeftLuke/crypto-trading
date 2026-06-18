"""DB-driven strategy rules — no hardcoded strategy logic."""

from dataclasses import dataclass
from typing import Any


@dataclass
class StrategyRule:
    id: int
    name: str
    direction: str
    conditions: list[dict[str, Any]]
    enabled: bool = True
    priority: int = 0

    @classmethod
    def from_row(cls, row: Any) -> "StrategyRule":
        return cls(
            id=row.id,
            name=row.name,
            direction=row.direction,
            conditions=row.conditions_json or [],
            enabled=row.enabled,
            priority=row.priority,
        )


class StrategyRulesEngine:
    """Evaluate configurable rules against feature context."""

    OPERATORS = {
        ">": lambda a, b: a > b,
        ">=": lambda a, b: a >= b,
        "<": lambda a, b: a < b,
        "<=": lambda a, b: a <= b,
        "==": lambda a, b: a == b,
        "!=": lambda a, b: a != b,
    }

    def evaluate_condition(self, cond: dict[str, Any], ctx: dict[str, Any]) -> bool:
        field = cond.get("field", "")
        op = cond.get("op", ">")
        expected = cond.get("value")
        actual = ctx.get(field)
        if actual is None:
            return False
        if cond.get("type") == "bool":
            return bool(actual) == bool(expected)
        fn = self.OPERATORS.get(op)
        if not fn:
            return False
        try:
            return fn(float(actual), float(expected))
        except (TypeError, ValueError):
            return fn(actual, expected)

    def evaluate_rule(self, rule: StrategyRule, ctx: dict[str, Any]) -> bool:
        if not rule.enabled:
            return False
        return all(self.evaluate_condition(c, ctx) for c in rule.conditions)

    def match(self, rules: list[StrategyRule], ctx: dict[str, Any]) -> StrategyRule | None:
        sorted_rules = sorted(rules, key=lambda r: r.priority, reverse=True)
        for rule in sorted_rules:
            if self.evaluate_rule(rule, ctx):
                return rule
        return None

    @staticmethod
    def default_short_rules() -> list[StrategyRule]:
        return [StrategyRule(
            id=0,
            name="default_short",
            direction="SHORT",
            conditions=[
                {"field": "rsi14", "op": ">", "value": 80},
                {"field": "close_below_ema100_1h", "op": "==", "value": 1, "type": "bool"},
                {"field": "bos_bearish", "op": "==", "value": 1, "type": "bool"},
                {"field": "volatility_safe", "op": "==", "value": 1, "type": "bool"},
            ],
        )]
