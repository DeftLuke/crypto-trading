"""Central memory orchestration service."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.core.logging import get_logger
from app.memory.agent_state.manager import AgentStateManager
from app.memory.collections import CollectionName
from app.memory.embeddings.service import get_embedding_service
from app.memory.evolution.pattern_discovery import PatternDiscovery
from app.memory.owm import apply_outcome
from app.memory.qdrant.client import QdrantMemoryStore, get_qdrant_store
from app.memory.reflections.engine import ReflectionEngine
from app.memory.retrieval.engine import RetrievalEngine
from app.memory.retrieval.ranking import compute_memory_rank
from app.memory.retrieval.trade_recall import TradeRecallEngine
from app.memory.types import (
    AgentStateMemory,
    BacktestMemory,
    PatternMemory,
    ReflectionMemory,
    SignalMemory,
    StrategyMemory,
    TradeMemory,
    build_search_text,
    utc_now_iso,
)

logger = get_logger("memory.service")

COLLECTION_MAP = {
    "trade": "trade_memories",
    "signal": "signal_memories",
    "backtest": "backtest_memories",
    "reflection": "reflection_memories",
    "pattern": "pattern_memories",
    "strategy": "strategy_memories",
    "risk": "risk_memories",
    "market": "market_memories",
    "agent_state": "agent_state_memories",
    "deployment": "deployment_memories",
}


class MemoryService:
    def __init__(self, store: QdrantMemoryStore | None = None):
        self.memory_store = store or get_qdrant_store()
        self.memory_store.ensure_collections()
        self.embedder = get_embedding_service()
        self.retrieval = RetrievalEngine(self.memory_store)
        self.trade_recall = TradeRecallEngine(self.retrieval)
        self.reflections = ReflectionEngine()
        self.patterns = PatternDiscovery()
        self.agent_state = AgentStateManager()

    def _prepare(self, model: Any, collection: CollectionName) -> dict[str, Any]:
        payload = model.to_payload() if hasattr(model, "to_payload") else dict(model)
        if not payload.get("text"):
            payload["text"] = build_search_text(payload)
        weights = payload.get("weights") or {}
        payload["memory_rank"] = compute_memory_rank(payload)
        payload["updated_at"] = utc_now_iso()
        return payload

    def store(self, collection: CollectionName, model: Any) -> dict[str, Any]:
        payload = self._prepare(model, collection)
        if isinstance(model, TradeMemory) and model.result:
            w = apply_outcome(model.weights, model.result, model.profit_percent)
            payload["weights"] = w.model_dump()
            payload["memory_rank"] = compute_memory_rank(payload)

        vector = self.embedder.embed_one(payload["text"])
        pid = self.memory_store.upsert(collection, payload["memory_id"], vector, payload)
        logger.info("Stored memory", extra={"collection": collection, "memory_id": payload["memory_id"]})
        return {**payload, "point_id": pid, "collection": collection}

    def store_trade(self, data: dict[str, Any]) -> dict[str, Any]:
        mem = TradeMemory.model_validate(data)
        return self.store("trade_memories", mem)

    def store_signal(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.store("signal_memories", SignalMemory.model_validate(data))

    def store_backtest(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.store("backtest_memories", BacktestMemory.model_validate(data))

    def store_reflection(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.store("reflection_memories", ReflectionMemory.model_validate(data))

    def store_pattern(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.store("pattern_memories", PatternMemory.model_validate(data))

    def store_strategy(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.store("strategy_memories", StrategyMemory.model_validate(data))

    def recall(self, setup: dict[str, Any]) -> dict[str, Any]:
        return self.trade_recall.recall_similar_trades(setup)

    def search(
        self,
        query: str,
        collection: CollectionName = "trade_memories",
        mode: str = "semantic",
        limit: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        if mode == "keyword":
            return self.retrieval.keyword_search(collection, query, limit)
        if mode == "hybrid":
            return self.retrieval.hybrid_search(collection, query, limit, filters)
        return self.retrieval.semantic_search(collection, query, limit, filters)

    def multi_recall(self, query: str, limit: int = 5) -> dict[str, list[dict[str, Any]]]:
        return self.retrieval.multi_collection_recall(query, limit_per=limit)

    def stats(self) -> dict[str, Any]:
        counts = self.memory_store.collection_stats()
        return {
            "collections": counts,
            "total_memories": sum(counts.values()),
            "embedding_model": self.embedder.model_name,
            "vector_size": self.embedder.vector_size,
        }

    def top_patterns(self, limit: int = 10) -> list[dict[str, Any]]:
        items, _ = self.memory_store.scroll("pattern_memories", limit=200)
        items.sort(key=lambda x: x.get("memory_rank", 0), reverse=True)
        return items[:limit]

    def list_reflections(self, limit: int = 20) -> list[dict[str, Any]]:
        items, _ = self.memory_store.scroll("reflection_memories", limit=limit)
        items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return items

    def get_agent_state(self) -> dict[str, Any]:
        items, _ = self.memory_store.scroll("agent_state_memories", limit=5)
        if items:
            return items[0]
        return AgentStateMemory().to_payload()

    def process_trade_close(self, trade: dict[str, Any]) -> dict[str, Any]:
        stored = self.store_trade(trade)
        reflection = self.reflections.generate_trade_reflection(trade)
        ref_stored = self.store_reflection(reflection.to_payload())
        return {"trade": stored, "reflection": ref_stored}

    def run_learning_cycle(self) -> dict[str, Any]:
        trades, _ = self.memory_store.scroll("trade_memories", limit=500)
        patterns = self.patterns.discover_from_trades(trades)
        stored_patterns = [self.store_pattern(p.to_payload()) for p in patterns[:10]]

        reflections = self.list_reflections(50)
        state = self.agent_state.build_state(trades, stored_patterns, reflections)
        state_stored = self.store("agent_state_memories", state)

        return {
            "trades_analyzed": len(trades),
            "patterns_discovered": len(stored_patterns),
            "agent_state_updated": state_stored.get("memory_id"),
        }


@lru_cache
def get_memory_service() -> MemoryService:
    return MemoryService()
