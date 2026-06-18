"""Coordinator — orchestrates modular agents through shared context."""

from __future__ import annotations

import time
from typing import Any

from app.agents.hypothesis.generator import HypothesisGenerator
from app.agents.learning.learning_agent import LearningAgent
from app.agents.memory.recall import AgentMemoryRecall
from app.agents.meta.predictor import MetaLearningPredictor
from app.agents.planning.planner import PlanningAgent
from app.agents.reflection.agent_reflection import ReflectionAgent
from app.agents.regime.detector import RegimeDetector
from app.agents.research.strategy_generator import StrategyGenerator
from app.agents.scoring.ranking_agent import RankingAgent
from app.agents.types import (
    AgentInsight,
    AgentRecommendation,
    AgentState,
    Hypothesis,
    ResearchPlan,
    StrategyDefinition,
    utc_now,
)
from app.agents.validation.validator import ValidationAgent
from app.core.config import get_settings
from app.core.logging import get_logger
from app.memory.evolution.pattern_discovery import PatternDiscovery
from app.memory.service import get_memory_service

logger = get_logger("agents.coordinator")


class CoordinatorAgent:
    """Runs full research workflow: recall → hypothesize → generate → evaluate → reflect → learn."""

    def __init__(self) -> None:
        self.memory_recall = AgentMemoryRecall()
        self.hypothesis_gen = HypothesisGenerator()
        self.strategy_gen = StrategyGenerator()
        self.meta = MetaLearningPredictor()
        self.scorer_ranker = RankingAgent()
        self.reflection = ReflectionAgent()
        self.validation = ValidationAgent()
        self.learning = LearningAgent()
        self.planner = PlanningAgent()
        self.regime = RegimeDetector()
        self.pattern_discovery = PatternDiscovery()
        self.memory = get_memory_service()

        self._hypotheses: list[Hypothesis] = []
        self._plans: list[ResearchPlan] = []
        self._rankings: list[dict] = []
        self._reflections: list[dict] = []
        self._insights: list[AgentInsight] = []
        self._recommendations: list[AgentRecommendation] = []
        self._learning_snapshot = None

    async def run_cycle(self, state: AgentState) -> dict[str, Any]:
        settings = get_settings()
        t0 = time.perf_counter()
        state.current_phase = "recall"
        state.cycle_count += 1

        memory_ctx = self.memory_recall.recall_context()
        state.audit_log.append({"phase": "recall", "patterns": len(memory_ctx.get("patterns", []))})

        state.current_phase = "analyze"
        regime = self.regime.detect(memory_ctx.get("regime_hints"))

        state.current_phase = "hypothesize"
        self._hypotheses = self.hypothesis_gen.generate(memory_ctx, max_hypotheses=settings.agent_max_hypotheses)
        state.hypotheses_count = len(self._hypotheses)
        self._plans = [self.planner.create_plan(), self.planner.plan_from_hypotheses(self._hypotheses)]

        state.current_phase = "generate"
        strategies = self.strategy_gen.batch_from_hypotheses(self._hypotheses[: settings.agent_max_backtests_per_cycle])

        state.current_phase = "meta_score"
        scored_candidates: list[tuple[StrategyDefinition, dict]] = []
        for strat in strategies:
            meta = self.meta.predict(strat.to_dict(), memory_ctx)
            if meta["success_probability"] >= settings.agent_meta_threshold:
                scored_candidates.append((strat, meta))

        scored_candidates.sort(key=lambda x: x[1]["success_probability"], reverse=True)
        top = scored_candidates[: settings.agent_max_backtests_per_cycle]

        state.current_phase = "evaluate"
        evaluated: list[dict] = []
        for strat, meta in top:
            metrics = await self._evaluate_strategy(strat, memory_ctx)
            metrics["strategy_name"] = strat.strategy_name
            validation = self.validation.analyze(metrics, strat.to_dict())
            evaluated.append(
                {
                    "strategy_name": strat.strategy_name,
                    "strategy": strat.to_dict(),
                    "metrics": metrics,
                    "meta_success_probability": meta["success_probability"],
                    "validation": validation,
                }
            )
            state.strategies_evaluated += 1

        state.current_phase = "rank"
        rankings = self.scorer_ranker.rank(evaluated)
        self._rankings = [r.model_dump() for r in rankings]

        state.current_phase = "reflect"
        for ev in evaluated:
            ref = self.reflection.generate(ev["strategy"], ev["metrics"])
            stored = self.reflection.persist(ref)
            self._reflections.append({**ref.model_dump(mode="json"), "memory_id": stored.get("memory_id")})
            state.reflections_generated += 1

            self.memory.store_strategy(
                {
                    "strategy_name": ev["strategy_name"],
                    "rules": ev["strategy"].get("conditions", []),
                    "performance": ev["metrics"],
                    "status": "validated" if ev["validation"]["passed"] else "rejected",
                }
            )

        state.current_phase = "patterns"
        trades, _ = self.memory.memory_store.scroll("trade_memories", limit=300)
        patterns = self.pattern_discovery.discover_from_trades(trades)
        stored_patterns = [self.memory.store_pattern(p.to_payload()) for p in patterns[:5]]

        state.current_phase = "learn"
        score_dicts = [r.model_dump() for r in rankings]
        self._learning_snapshot = self.learning.learn(memory_ctx, score_dicts, stored_patterns, regime)
        self.learning.persist_state(self._learning_snapshot, score_dicts)
        self._insights = self.learning.to_insights(self._learning_snapshot)

        val_recs = self.validation.recommendations(
            [{**e["validation"], "strategy_name": e["strategy_name"]} for e in evaluated]
        )
        self._recommendations = val_recs + self._build_recommendations(rankings)

        state.current_phase = "complete"
        state.last_cycle_at = utc_now()
        state.last_cycle_duration_ms = int((time.perf_counter() - t0) * 1000)
        logger.info(
            "Research cycle complete",
            extra={
                "cycle": state.cycle_count,
                "hypotheses": len(self._hypotheses),
                "evaluated": len(evaluated),
                "duration_ms": state.last_cycle_duration_ms,
            },
        )

        return {
            "cycle": state.cycle_count,
            "hypotheses": len(self._hypotheses),
            "strategies_evaluated": len(evaluated),
            "top_strategy": self._rankings[0] if self._rankings else None,
            "regime": regime,
            "duration_ms": state.last_cycle_duration_ms,
        }

    async def _evaluate_strategy(self, strategy: StrategyDefinition, memory_ctx: dict[str, Any]) -> dict[str, Any]:
        """Evaluate via memory recall + heuristic metrics (full backtest optional)."""
        setup = {
            "symbol": "BTCUSDT",
            "direction": strategy.direction,
            "smc_features": {c.lower(): True for c in strategy.conditions if "bos" in c.lower() or "ob" in c.lower()},
            "indicators": {"rsi": 82 if "RSI > 80" in strategy.conditions else 75},
            "strategy_name": strategy.strategy_name,
        }
        recall = self.memory_recall.recall_for_setup(setup)
        win_rate = recall.get("win_rate", 50) or 50
        avg_profit = recall.get("average_profit_percent", 0) or 0
        count = recall.get("count", 0) or 0

        meta = self.meta.predict(strategy.to_dict(), memory_ctx)
        pf = meta["expected_profit_factor"] * (win_rate / 100 + 0.3)
        sharpe = min(3.0, pf * 0.6)
        dd = meta["expected_drawdown"]
        trades = max(count, 20)

        return {
            "profit_factor": round(pf, 3),
            "sharpe_ratio": round(sharpe, 3),
            "sortino_ratio": round(sharpe * 1.1, 3),
            "max_drawdown_pct": round(dd, 2),
            "win_rate": round(win_rate, 2),
            "expectancy": round(avg_profit * 10, 2),
            "total_trades": trades,
            "recovery_factor": round(pf / max(dd / 100, 0.01), 2),
        }

    def _build_recommendations(self, rankings) -> list[AgentRecommendation]:
        recs: list[AgentRecommendation] = []
        if rankings:
            top = rankings[0]
            recs.append(
                AgentRecommendation(
                    title=f"Top strategy: {top.strategy_name}",
                    action="paper_trade_candidate",
                    rationale=f"Composite score {top.composite_score:.1f} — candidate for Phase 7 paper trading",
                    confidence=min(0.95, top.composite_score / 100),
                    strategy_name=top.strategy_name,
                )
            )
        return recs

    @property
    def hypotheses(self) -> list[Hypothesis]:
        return self._hypotheses

    @property
    def plans(self) -> list[ResearchPlan]:
        return self._plans

    @property
    def rankings(self) -> list[dict]:
        return self._rankings

    @property
    def reflections(self) -> list[dict]:
        return self._reflections

    @property
    def insights(self) -> list[AgentInsight]:
        return self._insights

    @property
    def recommendations(self) -> list[AgentRecommendation]:
        return self._recommendations

    @property
    def learning_snapshot(self):
        return self._learning_snapshot
