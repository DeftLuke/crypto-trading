"""Sentence-transformers BGE embedding provider."""

from app.core.logging import get_logger
from app.memory.embeddings.base import EmbeddingProvider

logger = get_logger("memory.embeddings.bge")

MODEL_DIMS = {
    "BAAI/bge-small-en-v1.5": 384,
    "BAAI/bge-base-en-v1.5": 768,
    "BAAI/bge-large-en-v1.5": 1024,
}


class BGEEmbeddingProvider(EmbeddingProvider):
    def __init__(self, model_id: str = "BAAI/bge-small-en-v1.5"):
        self._model_id = model_id
        self._model = None
        self._vector_size = MODEL_DIMS.get(model_id, 384)

    @property
    def model_name(self) -> str:
        return self._model_id

    @property
    def vector_size(self) -> int:
        return self._vector_size

    def _load(self):
        if self._model is not None:
            return
        from sentence_transformers import SentenceTransformer

        logger.info("Loading embedding model", extra={"model": self._model_id})
        self._model = SentenceTransformer(self._model_id)

    def embed(self, texts: list[str]) -> list[list[float]]:
        self._load()
        vectors = self._model.encode(texts, normalize_embeddings=True)
        return [v.tolist() for v in vectors]
