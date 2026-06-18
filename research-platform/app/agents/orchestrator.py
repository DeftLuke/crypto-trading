"""Agent orchestrator — 24/7 research loop start/stop."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Any

from app.agents.coordinator import CoordinatorAgent
from app.agents.research.queue import get_research_queue
from app.agents.types import AgentState, ResearchTask, TaskType, utc_now
from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("agents.orchestrator")


class AgentOrchestrator:
    def __init__(self) -> None:
        self.coordinator = CoordinatorAgent()
        self.queue = get_research_queue()
        self.state = AgentState()
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> dict[str, Any]:
        if self.state.running:
            return {"status": "already_running", "cycle_count": self.state.cycle_count}
        self._stop_event.clear()
        self.state.running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("AI Research Agent started")
        return {"status": "started", "cycle_count": self.state.cycle_count}

    async def stop(self) -> dict[str, Any]:
        self.state.running = False
        self._stop_event.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self.state.current_phase = "stopped"
        logger.info("AI Research Agent stopped")
        return {"status": "stopped", "cycle_count": self.state.cycle_count}

    async def run_once(self) -> dict[str, Any]:
        return await self.coordinator.run_cycle(self.state)

    async def _loop(self) -> None:
        settings = get_settings()
        interval = settings.agent_cycle_interval_minutes * 60
        while self.state.running and not self._stop_event.is_set():
            try:
                await self.coordinator.run_cycle(self.state)
            except Exception as e:
                logger.exception("Research cycle failed")
                self.state.errors.append(str(e))
                if len(self.state.errors) > 50:
                    self.state.errors = self.state.errors[-50:]
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
                break
            except asyncio.TimeoutError:
                continue

    def status(self) -> dict[str, Any]:
        return {
            "running": self.state.running,
            "cycle_count": self.state.cycle_count,
            "current_phase": self.state.current_phase,
            "last_cycle_at": self.state.last_cycle_at.isoformat() if self.state.last_cycle_at else None,
            "last_cycle_duration_ms": self.state.last_cycle_duration_ms,
            "hypotheses_count": self.state.hypotheses_count,
            "strategies_evaluated": self.state.strategies_evaluated,
            "backtests_launched": self.state.backtests_launched,
            "reflections_generated": self.state.reflections_generated,
            "queue_pending": self.queue.pending_count(),
            "errors": self.state.errors[-5:],
        }

    def dashboard_payload(self) -> dict[str, Any]:
        mem = self.coordinator.memory.stats()
        learning = self.coordinator.learning_snapshot
        return {
            "status": self.status(),
            "top_discoveries": [i.model_dump(mode="json") for i in self.coordinator.insights[:5]],
            "best_strategies": self.coordinator.rankings[:5],
            "research_queue": self.queue.snapshot()[:10],
            "recent_reflections": self.coordinator.reflections[:5],
            "learning_progress": learning.model_dump(mode="json") if learning else {},
            "pattern_insights": self.coordinator.memory.top_patterns(5),
            "recommendations": [r.model_dump(mode="json") for r in self.coordinator.recommendations[:5]],
            "hypotheses": [h.model_dump(mode="json") for h in self.coordinator.hypotheses[:10]],
            "plans": [p.model_dump(mode="json") for p in self.coordinator.plans[:3]],
            "memory_stats": mem,
        }


@lru_cache
def get_orchestrator() -> AgentOrchestrator:
    return AgentOrchestrator()
