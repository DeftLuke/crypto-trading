"""Coordinator agent — routes NL requests to specialized agents and tools."""

from __future__ import annotations

from typing import Any

from app.operations.llm.gateway import LLMGateway
from app.operations.store import OperationsStore
from app.operations.tools.registry import ToolRegistry
from app.operations.types import (
    AgentAction,
    AgentRole,
    AuditLog,
    ChatRequest,
    ChatResponse,
    ConversationMessage,
    IntentType,
    ToolCallRecord,
    utc_now,
)
from app.core.logging import get_logger

logger = get_logger("operations.agents.coordinator")

AGENT_MAP = {
    "coordinator": AgentRole.COORDINATOR,
    "trading": AgentRole.TRADING,
    "research": AgentRole.RESEARCH,
    "memory": AgentRole.MEMORY,
    "risk": AgentRole.RISK,
    "monitoring": AgentRole.MONITORING,
    "reporting": AgentRole.REPORTING,
}


class CoordinatorAgent:
    def __init__(self, store: OperationsStore) -> None:
        self.store = store
        self.llm = LLMGateway()
        self.tools = ToolRegistry()

    async def chat(self, req: ChatRequest) -> ChatResponse:
        conv = self.store.get_conversation(req.conversation_id, req.user_id, req.channel)
        conv.messages.append(ConversationMessage(role="user", content=req.message))
        conv.updated_at = utc_now()

        tools_list = self.tools.list_tools()
        classification = await self.llm.classify_intent(req.message, tools_list)
        intent = IntentType(classification.get("intent", "question"))
        agent_name = classification.get("agent", "coordinator")
        agent_role = AGENT_MAP.get(agent_name, AgentRole.COORDINATOR)
        tool_names = classification.get("tools", ["search_memories"])

        memories: list[dict] = []
        try:
            mem_result = await self.tools.execute("search_memories", {"query": req.message, "limit": 5})
            memories = mem_result.get("results", [])
        except Exception:
            pass

        tool_records: list[ToolCallRecord] = []
        tool_results: dict[str, Any] = {}
        for name in tool_names[:5]:
            params = {"query": req.message, "strategy": self._extract_strategy(req.message)}
            if name == "generate_report":
                params = {"report_type": self._report_type(req.message), "format": "json"}
            result = await self.tools.execute(name, params)
            tool_results[name] = result
            tool_records.append(
                ToolCallRecord(
                    tool=name,
                    params=params,
                    result=result,
                    latency_ms=result.get("_latency_ms", 0),
                    success="error" not in result,
                    error=result.get("error"),
                )
            )

        history = [{"role": m.role, "content": m.content} for m in conv.messages[-8:]]
        synthesis_prompt = (
            f"User question: {req.message}\n\n"
            f"Intent: {intent.value}\n"
            f"Tool results:\n{self._format_tools(tool_results)}\n\n"
            f"Provide a clear, data-driven answer for a professional trader."
        )
        llm_result = await self.llm.complete(
            synthesis_prompt,
            context={
                "memories": memories,
                "tool_results": tool_results,
                "history": history,
                **req.context,
            },
        )
        answer = llm_result.get("answer", "Unable to generate response.")

        conv.messages.append(ConversationMessage(role="assistant", content=answer))
        suggestions = self._suggestions(intent, tool_results)

        action = AgentAction(
            conversation_id=conv.conversation_id,
            action_type="chat",
            agent_role=agent_role,
            tool_calls=tool_records,
            input={"message": req.message, "intent": intent.value},
            output={"answer": answer, "model": llm_result.get("model")},
        )
        self.store.actions.append(action)
        self.store.audit_logs.append(
            AuditLog(event="chat", user_id=req.user_id, channel=req.channel, detail={"intent": intent.value, "tools": tool_names})
        )

        return ChatResponse(
            conversation_id=conv.conversation_id,
            answer=answer,
            intent=intent,
            agent=agent_role,
            tool_calls=tool_records,
            memories_used=memories[:5],
            suggestions=suggestions,
            model=llm_result.get("model"),
        )

    def _format_tools(self, results: dict[str, Any]) -> str:
        lines = []
        for name, data in results.items():
            summary = data.get("summary") or data.get("error") or str(data)[:300]
            lines.append(f"- {name}: {summary}")
        return "\n".join(lines)

    def _extract_strategy(self, message: str) -> str | None:
        import re

        m = re.search(r"strategy[_\s]?(\w+)", message, re.I)
        return m.group(1) if m else None

    def _report_type(self, message: str) -> str:
        msg = message.lower()
        for t in ("weekly", "monthly", "risk", "strategy", "research", "trade"):
            if t in msg:
                return t
        return "daily"

    def _suggestions(self, intent: IntentType, tool_results: dict) -> list[str]:
        suggestions = []
        if intent == IntentType.STRATEGY:
            suggestions.append("Compare top strategies by profit factor")
        if intent == IntentType.RISK:
            suggestions.append("Show circuit breaker status")
        if intent == IntentType.RESEARCH:
            suggestions.append("Launch a new research cycle")
        if intent == IntentType.REPORT:
            suggestions.append("Export report as CSV")
        return suggestions[:3]
