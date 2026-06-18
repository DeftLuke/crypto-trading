"""Ranking agent — strategy leaderboard."""

from __future__ import annotations

from app.agents.scoring.engine import ScoringEngine
from app.agents.types import StrategyScore


class RankingAgent:
    def __init__(self) -> None:
        self.scorer = ScoringEngine()

    def rank(self, evaluated: list[dict]) -> list[StrategyScore]:
        scores = [
            self.scorer.score(
                {**e.get("metrics", {}), "strategy_name": e.get("strategy_name", "?")},
                e.get("meta_success_probability"),
            )
            for e in evaluated
        ]
        return self.scorer.rank(scores)
