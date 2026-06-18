from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("utils.redis")

_redis = None


async def get_redis():
    global _redis
    if _redis is None:
        import redis.asyncio as redis

        _redis = redis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


async def ping_redis() -> bool:
    try:
        client = await get_redis()
        return bool(await client.ping())
    except Exception as e:
        logger.warning("Redis ping failed", extra={"error": str(e)})
        return False
