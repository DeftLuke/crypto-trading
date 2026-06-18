"""Deterministic hash-based embeddings for tests and low-RAM mode."""

import hashlib
import math

from app.memory.embeddings.base import EmbeddingProvider


class HashEmbeddingProvider(EmbeddingProvider):
    """Fast pseudo-embeddings — no ML dependencies."""

    def __init__(self, vector_size: int = 384, model_name: str = "hash-384"):
        self._vector_size = vector_size
        self._model_name = model_name

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def vector_size(self) -> int:
        return self._vector_size

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._hash_to_vector(t) for t in texts]

    def _hash_to_vector(self, text: str) -> list[float]:
        seed = hashlib.sha256(text.encode()).digest()
        vec: list[float] = []
        for i in range(self._vector_size):
            b = seed[i % len(seed)]
            vec.append((b / 127.5) - 1.0)
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]
