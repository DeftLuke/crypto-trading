"""Background memory learning jobs."""

import asyncio

from app.core.logging import get_logger

logger = get_logger("tasks.memory")


def job_memory_learning_cycle() -> None:
    """Analyze new trades/signals, discover patterns, update agent state."""
    try:
        from app.memory.service import get_memory_service

        svc = get_memory_service()
        result = svc.run_learning_cycle()
        logger.info("Memory learning cycle complete", extra=result)
    except Exception as e:
        logger.error("Memory learning cycle failed", extra={"error": str(e)})


async def async_memory_learning_cycle() -> None:
    await asyncio.to_thread(job_memory_learning_cycle)
