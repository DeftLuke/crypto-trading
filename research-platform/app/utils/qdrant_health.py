"""Qdrant health check."""

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("utils.qdrant")


def ping_qdrant() -> bool:
    settings = get_settings()
    if not settings.memory_enabled:
        return True
    try:
        from qdrant_client import QdrantClient

        if settings.qdrant_url == ":memory:":
            client = QdrantClient(":memory:")
        else:
            client = QdrantClient(
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key or None,
            )
        client.get_collections()
        return True
    except Exception as e:
        logger.warning("Qdrant ping failed", extra={"error": str(e)})
        return False
