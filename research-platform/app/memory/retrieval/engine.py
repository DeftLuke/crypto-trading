"""Memory retrieval engine — semantic, filtered, hybrid search."""

from __future__ import annotations

from typing import Any

from qdrant_client.http import models as qmodels

from app.memory.collections import CollectionName
from app.memory.embeddings.service import get_embedding_service
from app.memory.qdrant.client import QdrantMemoryStore
from app.memory.retrieval.ranking import rank_results
from app.memory.owm import record_usage, weights_from_payload


class RetrievalEngine:
    def __init__(self, store: QdrantMemoryStore):
        self.store = store
        self.embedder = get_embedding_service()

    def _build_filter(self, filters: dict[str, Any] | None) -> qmodels.Filter | None:
        if not filters:
            return None
        must: list[qmodels.Condition] = []
        for key, val in filters.items():
            if val is None or val == "":
                continue
            must.append(
                qmodels.FieldCondition(key=key, match=qmodels.MatchValue(value=val))
            )
        if not must:
            return None
        return qmodels.Filter(must=must)

    def semantic_search(
        self,
        collection: CollectionName,
        query: str,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        vector = self.embedder.embed_one(query)
        qf = self._build_filter(filters)
        results = self.store.search(collection, vector, limit=limit * 2, query_filter=qf)
        return rank_results(results)[:limit]

    def keyword_search(
        self,
        collection: CollectionName,
        keyword: str,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        items, _ = self.store.scroll(collection, limit=500)
        kw = keyword.lower()
        matched = [i for i in items if kw in (i.get("text") or "").lower() or kw in str(i).lower()]
        return rank_results(matched)[:limit]

    def hybrid_search(
        self,
        collection: CollectionName,
        query: str,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        semantic = self.semantic_search(collection, query, limit=limit, filters=filters)
        keyword = self.keyword_search(collection, query, limit=limit)
        seen: set[str] = set()
        merged: list[dict[str, Any]] = []
        for item in semantic + keyword:
            mid = item.get("memory_id") or item.get("point_id")
            if mid in seen:
                continue
            seen.add(mid)
            merged.append(item)
        return rank_results(merged)[:limit]

    def multi_collection_recall(
        self,
        query: str,
        collections: list[CollectionName] | None = None,
        limit_per: int = 5,
    ) -> dict[str, list[dict[str, Any]]]:
        cols = collections or [
            "trade_memories",
            "signal_memories",
            "reflection_memories",
            "pattern_memories",
            "strategy_memories",
        ]
        out: dict[str, list[dict[str, Any]]] = {}
        for col in cols:
            out[col] = self.semantic_search(col, query, limit=limit_per)
        return out

    def touch_usage(self, payload: dict[str, Any]) -> dict[str, Any]:
        w = record_usage(weights_from_payload(payload))
        payload = {**payload, "weights": w.model_dump()}
        return payload
