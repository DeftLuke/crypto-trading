"""Hypothesis generation from memory and patterns."""

from __future__ import annotations

from itertools import combinations
from typing import Any

from app.agents.research.condition_map import INDICATOR_CONDITIONS, SESSIONS, SMC_CONDITIONS_LONG, SMC_CONDITIONS_SHORT
from app.agents.types import Hypothesis


class HypothesisGenerator:
    def generate(self, memory_context: dict[str, Any], max_hypotheses: int = 12) -> list[Hypothesis]:
        hypotheses: list[Hypothesis] = []
        patterns = memory_context.get("patterns", [])
        reflections = memory_context.get("reflections", [])
        winning = memory_context.get("winning_setups", [])

        for pat in patterns[:5]:
            name = pat.get("pattern_name") or pat.get("text", "")[:60]
            wr = pat.get("win_rate") or 0
            if wr >= 55:
                hypotheses.append(
                    Hypothesis(
                        title=f"Pattern boost: {name}",
                        description=f"Existing pattern shows {wr:.0f}% win rate — test as primary filter",
                        conditions=(pat.get("conditions") or [name])[:6],
                        direction="SHORT" if "bearish" in name.lower() or "short" in name.lower() else "LONG",
                        confidence=min(0.9, 0.5 + (wr / 200)),
                        evidence=f"{pat.get('trade_count', 0)} historical trades, PF {pat.get('profit_factor', '—')}",
                        priority=0.6 + (wr / 200),
                    )
                )

        for ref in reflections[:3]:
            obs = ref.get("observation") or ref.get("text", "")
            if obs:
                hypotheses.append(
                    Hypothesis(
                        title="Reflection-driven test",
                        description=obs[:200],
                        conditions=self._extract_conditions(obs),
                        confidence=float(ref.get("confidence") or 0.6),
                        evidence=ref.get("evidence", "")[:300],
                        priority=0.55,
                    )
                )

        if winning:
            avg_rsi = _avg_field(winning, "rsi", nested="indicators")
            if avg_rsi and avg_rsi > 75:
                hypotheses.append(
                    Hypothesis(
                        title="Higher RSI threshold",
                        description=f"Winning setups avg RSI {avg_rsi:.0f} — test RSI > {int(avg_rsi - 3)}",
                        conditions=[f"RSI > {int(avg_rsi - 3)}", "EMA100 Bearish", "Bearish BOS"],
                        direction="SHORT",
                        confidence=0.65,
                        evidence=f"Based on {len(winning)} winning memory recalls",
                        priority=0.7,
                    )
                )

        for session in SESSIONS:
            hypotheses.append(
                Hypothesis(
                    title=f"{session} session filter",
                    description=f"Test SMC short rules restricted to {session} session",
                    conditions=["RSI > 80", "EMA100 Bearish", "Bearish BOS", "Bearish OB Retest"],
                    direction="SHORT",
                    confidence=0.55,
                    evidence="Session segmentation hypothesis",
                    priority=0.5,
                )
            )

        combo_bases = [
            (["RSI > 80", "EMA100 Bearish", "Bearish BOS"], "SHORT"),
            (["RSI > 85", "Bearish BOS", "Liquidity Sweep"], "SHORT"),
            (["RSI < 30", "EMA100 Bullish", "Bullish BOS"], "LONG"),
        ]
        for conds, direction in combo_bases:
            hypotheses.append(
                Hypothesis(
                    title=f"Combo: {' + '.join(conds[:2])}",
                    description=f"Test {' + '.join(conds)} for {direction}",
                    conditions=conds,
                    direction=direction,
                    confidence=0.5,
                    evidence="Template combination",
                    priority=0.45,
                )
            )

        seen: set[str] = set()
        unique: list[Hypothesis] = []
        for h in sorted(hypotheses, key=lambda x: x.priority, reverse=True):
            key = h.title.lower()
            if key in seen:
                continue
            seen.add(key)
            unique.append(h)
            if len(unique) >= max_hypotheses:
                break
        return unique

    def _extract_conditions(self, text: str) -> list[str]:
        found: list[str] = []
        lower = text.lower()
        for cond in INDICATOR_CONDITIONS + SMC_CONDITIONS_SHORT + SMC_CONDITIONS_LONG:
            if cond.lower() in lower:
                found.append(cond)
        return found or ["RSI > 80", "Bearish BOS"]


def _avg_field(items: list[dict], field: str, nested: str | None = None) -> float | None:
    vals: list[float] = []
    for item in items:
        v = item.get(field)
        if v is None and nested:
            v = (item.get(nested) or {}).get(field)
        if v is not None:
            try:
                vals.append(float(v))
            except (TypeError, ValueError):
                pass
    return sum(vals) / len(vals) if vals else None
