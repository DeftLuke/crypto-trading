"""Base agent interface — CrewAI-style modular agents."""

from abc import ABC, abstractmethod
from typing import Any

from app.agents.types import AgentState
from app.core.logging import get_logger


class BaseAgent(ABC):
    name: str = "base"

    def __init__(self) -> None:
        self.logger = get_logger(f"agents.{self.name}")

    @abstractmethod
    async def run(self, context: dict[str, Any], state: AgentState) -> dict[str, Any]:
        """Execute agent logic and return context updates."""

    def audit(self, state: AgentState, action: str, detail: dict[str, Any]) -> None:
        entry = {"agent": self.name, "action": action, **detail}
        state.audit_log.append(entry)
        if len(state.audit_log) > 500:
            state.audit_log = state.audit_log[-500:]
        self.logger.info(action, extra={"agent": self.name, **detail})
