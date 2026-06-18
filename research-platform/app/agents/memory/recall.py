"""Memory recall wrapper — Phase 5 integration."""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.memory.service import MemoryService, get_memory_service

logger = get_logger("agents.memory.recall")


class AgentMemoryRecall:
    """Recall winning/losing setups, patterns, reflections before reasoning."""

    def __init__(self, memory: MemoryService | None = None) -> None:
        self.memory = memory or get_memory_service()

    def recall_context(self, query: str = "SMC trading setups") -> dict[str, Any]:
        multi = self.memory.retrieval.multi_collection_recall(query, limit_per=8)
        patterns = self.memory.top_patterns(10)
        reflections = self.memory.list_reflections(15)
        agent_state = self.memory.get_agent_state()

        winning = [
            t for t in multi.get("trade_memories", [])
            if (t.get("result") or "").upper() == "WIN"
        ]
        losing = [
            t for t in multi.get("trade_memories", [])
            if (t.get("result") or "").upper() == "LOSS"
        ]

        return {
            "winning_setups": winning[:10],
            "losing_setups": losing[:10],
            "patterns": patterns,
            "reflections": reflections,
            "recent_discoveries": agent_state.get("recent_discoveries", []),
            "strategies": multi.get("strategy_memories", [])[:5],
            "signals": multi.get("signal_memories", [])[:5],
            "query": query,
        }

    def recall_for_setup(self, setup: dict[str, Any]) -> dict[str, Any]:
        return self.memory.recall(setup)
