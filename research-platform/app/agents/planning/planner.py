"""Research planning agent."""

from __future__ import annotations

from app.agents.types import Hypothesis, ResearchPlan


class PlanningAgent:
    def create_plan(self, goal: str = "Improve current SMC strategy") -> ResearchPlan:
        tasks = [
            "Recall winning and losing setups from memory",
            "Analyze session and volatility filters",
            "Generate hypotheses for RSI thresholds",
            "Build candidate strategy definitions",
            "Meta-score and prioritize backtests",
            "Evaluate profit factor, Sharpe, drawdown",
            "Generate reflections and store in Qdrant",
            "Update agent learning state",
        ]
        return ResearchPlan(goal=goal, tasks=tasks, priority=0.8)

    def plan_from_hypotheses(self, hypotheses: list[Hypothesis]) -> ResearchPlan:
        tasks = [f"Test hypothesis: {h.title}" for h in hypotheses[:8]]
        tasks.append("Rank results and update memory")
        return ResearchPlan(
            goal="Evaluate generated hypotheses",
            tasks=tasks,
            priority=0.75,
        )
