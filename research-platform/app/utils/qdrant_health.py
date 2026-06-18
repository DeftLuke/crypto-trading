"""Qdrant health check."""

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("utils.qdrant")


def ping_qdrant() -> bool:
    settings = get_settings()
    if not settings.memory_enabled:
        return True
    try:
        from app.memory.qdrant.client import get_qdrant_store

        store = get_qdrant_store()
        store.client.get_collections()
        return True
    except Exception as e:
        logger.warning("Qdrant ping failed", extra={"error": str(e)})
        return False
