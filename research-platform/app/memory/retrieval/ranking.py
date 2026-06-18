"""Memory ranking — composite score from multiple signals."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any


def _parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def recency_score(created_at: str | None, half_life_days: float = 30.0) -> float:
    ts = _parse_ts(created_at)
    if not ts:
        return 0.5
    age_days = (datetime.now(timezone.utc) - ts.astimezone(timezone.utc)).total_seconds() / 86400
    return math.exp(-0.693 * age_days / half_life_days)


def profitability_score(payload: dict[str, Any]) -> float:
    pf = payload.get("profit_factor") or payload.get("performance", {}).get("profit_factor")
    if pf is not None:
        return min(1.0, float(pf) / 3.0)
    pct = payload.get("profit_percent")
    if pct is not None:
        return min(1.0, max(0.0, (float(pct) + 5) / 10))
    wr = payload.get("win_rate")
    if wr is not None:
        return min(1.0, float(wr) / 100 if float(wr) > 1 else float(wr))
    result = (payload.get("result") or "").upper()
    if result == "WIN":
        return 0.85
    if result == "LOSS":
        return 0.15
    return 0.5


def usage_score(weights: dict[str, Any]) -> float:
    count = int(weights.get("usage_count") or 0)
    return min(1.0, math.log1p(count) / math.log1p(50))


def compute_memory_rank(
    payload: dict[str, Any],
    similarity_score: float = 0.5,
) -> float:
    weights = payload.get("weights") or {}
    rec = recency_score(payload.get("created_at") or payload.get("updated_at"))
    prof = profitability_score(payload)
    conf = float(weights.get("confidence_score") or payload.get("confidence") or 0.5)
    conf = min(1.0, max(0.0, conf if conf <= 1 else conf / 100))
    usage = usage_score(weights)
    outcome = min(1.0, max(0.0, float(weights.get("success_score") or 0.5)))
    owm = min(1.0, float(weights.get("memory_weight") or 1.0) / 10.0)
    sim = min(1.0, max(0.0, similarity_score))

    rank = (
        0.20 * rec
        + 0.20 * prof
        + 0.15 * conf
        + 0.10 * usage
        + 0.15 * sim
        + 0.10 * outcome
        + 0.10 * owm
    )
    return round(rank, 6)


def rank_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for item in results:
        sim = float(item.get("similarity_score") or 0.5)
        mr = compute_memory_rank(item, sim)
        item = {**item, "memory_rank": mr}
        ranked.append(item)
    ranked.sort(key=lambda x: x.get("memory_rank", 0), reverse=True)
    return ranked
