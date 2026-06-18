"""Outcome Weighted Memory (OWM) scoring."""

from __future__ import annotations

from typing import Any

from app.memory.types import MemoryWeights, utc_now_iso


def apply_outcome(weights: MemoryWeights, result: str | None, profit_percent: float | None = None) -> MemoryWeights:
    w = weights.model_copy(deep=True)
    is_win = result and result.upper() in ("WIN", "W", "SUCCESS")
    is_loss = result and result.upper() in ("LOSS", "L", "FAIL")

    if is_win:
        w.memory_weight = min(10.0, w.memory_weight * 1.12)
        w.success_score = min(1.0, w.success_score + 0.08)
        if profit_percent and profit_percent > 2:
            w.memory_weight = min(10.0, w.memory_weight * 1.05)
    elif is_loss:
        w.memory_weight = max(0.05, w.memory_weight * 0.88)
        w.success_score = max(0.0, w.success_score - 0.06)
    elif profit_percent is not None:
        if profit_percent > 0:
            w.memory_weight = min(10.0, w.memory_weight * 1.05)
            w.success_score = min(1.0, w.success_score + 0.03)
        elif profit_percent < 0:
            w.memory_weight = max(0.05, w.memory_weight * 0.92)
            w.success_score = max(0.0, w.success_score - 0.04)

    return w


def record_usage(weights: MemoryWeights) -> MemoryWeights:
    w = weights.model_copy(deep=True)
    w.usage_count += 1
    w.last_used = utc_now_iso()
    w.memory_weight = min(10.0, w.memory_weight * 1.02)
    return w


def weights_from_payload(payload: dict[str, Any]) -> MemoryWeights:
    raw = payload.get("weights") or {}
    return MemoryWeights.model_validate(raw)
