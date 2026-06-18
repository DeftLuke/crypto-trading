"""Background agent research jobs."""

import asyncio

from app.core.logging import get_logger

logger = get_logger("tasks.agent")


def job_agent_research_cycle() -> None:
    try:
        from app.agents.orchestrator import get_orchestrator

        orch = get_orchestrator()
        if not orch.state.running:
            asyncio.run(orch.run_once())
        else:
            logger.debug("Agent loop active — skipping scheduled single cycle")
    except Exception as e:
        logger.error("Agent research cycle failed", extra={"error": str(e)})
