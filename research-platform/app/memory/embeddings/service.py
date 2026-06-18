"""Embedding service factory."""

from functools import lru_cache

from app.core.config import get_settings
from app.core.logging import get_logger
from app.memory.embeddings.base import EmbeddingProvider
from app.memory.embeddings.bge import BGEEmbeddingProvider
from app.memory.embeddings.hash_provider import HashEmbeddingProvider
from app.memory.embeddings.openai_compat import OpenAICompatEmbeddingProvider

logger = get_logger("memory.embeddings")


def create_embedding_provider() -> EmbeddingProvider:
    settings = get_settings()
    provider = settings.memory_embedding_provider.lower()

    if provider == "hash" or settings.memory_low_ram:
        return HashEmbeddingProvider(vector_size=settings.memory_vector_size)

    if provider in ("openai", "openai_compat", "jina"):
        if not settings.memory_embedding_api_url or not settings.memory_embedding_api_key:
            logger.warning("OpenAI-compat embedding configured but URL/key missing — using hash fallback")
            return HashEmbeddingProvider(vector_size=settings.memory_vector_size)
        return OpenAICompatEmbeddingProvider(
            base_url=settings.memory_embedding_api_url,
            api_key=settings.memory_embedding_api_key,
            model=settings.memory_embedding_model,
            vector_size=settings.memory_vector_size,
        )

    model_map = {
        "bge-small": "BAAI/bge-small-en-v1.5",
        "bge-base": "BAAI/bge-base-en-v1.5",
        "bge-large": "BAAI/bge-large-en-v1.5",
        "bge": "BAAI/bge-small-en-v1.5",
    }
    model_id = model_map.get(provider, settings.memory_embedding_model)
    try:
        return BGEEmbeddingProvider(model_id=model_id)
    except Exception as e:
        logger.warning("BGE load failed, using hash fallback", extra={"error": str(e)})
        return HashEmbeddingProvider(vector_size=settings.memory_vector_size)


@lru_cache
def get_embedding_service() -> EmbeddingProvider:
    return create_embedding_provider()
