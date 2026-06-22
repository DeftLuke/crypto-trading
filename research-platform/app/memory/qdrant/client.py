"""Qdrant client wrapper."""

from __future__ import annotations

from functools import lru_cache
from typing import Any
from uuid import UUID

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.core.config import get_settings
from app.core.logging import get_logger
from app.memory.collections import ALL_COLLECTIONS, CollectionName

logger = get_logger("memory.qdrant")


def _point_id(memory_id: str) -> str:
    try:
        UUID(memory_id)
        return memory_id
    except ValueError:
        import hashlib

        h = hashlib.md5(memory_id.encode()).hexdigest()
        return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


class QdrantMemoryStore:
    def __init__(self, client: QdrantClient, vector_size: int):
        self.client = client
        self.vector_size = vector_size

    def ensure_collections(self) -> None:
        existing = {c.name for c in self.client.get_collections().collections}
        for name in ALL_COLLECTIONS:
            if name in existing:
                continue
            self.client.create_collection(
                collection_name=name,
                vectors_config=qmodels.VectorParams(size=self.vector_size, distance=qmodels.Distance.COSINE),
            )
            logger.info("Created Qdrant collection", extra={"collection": name})

    def upsert(self, collection: CollectionName, memory_id: str, vector: list[float], payload: dict[str, Any]) -> str:
        pid = _point_id(memory_id)
        self.client.upsert(
            collection_name=collection,
            points=[qmodels.PointStruct(id=pid, vector=vector, payload=payload)],
        )
        return pid

    def search(
        self,
        collection: CollectionName,
        vector: list[float],
        limit: int = 10,
        query_filter: qmodels.Filter | None = None,
        score_threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        response = self.client.query_points(
            collection_name=collection,
            query=vector,
            limit=limit,
            query_filter=query_filter,
            score_threshold=score_threshold,
            with_payload=True,
            with_vectors=False,
        )
        out: list[dict[str, Any]] = []
        for hit in response.points or []:
            item = dict(hit.payload or {})
            item["similarity_score"] = hit.score
            item["point_id"] = str(hit.id)
            out.append(item)
        return out

    def scroll(
        self,
        collection: CollectionName,
        limit: int = 100,
        offset: str | None = None,
    ) -> tuple[list[dict[str, Any]], str | None]:
        records, next_offset = self.client.scroll(
            collection_name=collection,
            limit=limit,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        items = [dict(r.payload or {}) for r in records]
        return items, str(next_offset) if next_offset else None

    def count(self, collection: CollectionName) -> int:
        info = self.client.get_collection(collection)
        return info.points_count or 0

    def collection_stats(self) -> dict[str, int]:
        return {name: self.count(name) for name in ALL_COLLECTIONS}

    def delete(self, collection: CollectionName, memory_id: str) -> None:
        self.client.delete(
            collection_name=collection,
            points_selector=qmodels.PointIdsList(points=[_point_id(memory_id)]),
        )


@lru_cache
def get_qdrant_store() -> QdrantMemoryStore:
    settings = get_settings()
    if settings.qdrant_url == ":memory:":
        client = QdrantClient(":memory:")
    else:
        client = QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key or None)
    return QdrantMemoryStore(client, vector_size=settings.memory_vector_size)
