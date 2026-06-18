"""In-memory store for Phase 9 operations."""

from __future__ import annotations

from app.operations.types import (
    AgentAction,
    AgentReport,
    AgentTask,
    AuditLog,
    Conversation,
    WorkflowRun,
)


class OperationsStore:
    def __init__(self) -> None:
        self.conversations: dict[str, Conversation] = {}
        self.actions: list[AgentAction] = []
        self.tasks: dict[str, AgentTask] = {}
        self.reports: dict[str, AgentReport] = {}
        self.workflows: list[WorkflowRun] = []
        self.audit_logs: list[AuditLog] = []
        self.user_context: dict[str, dict] = {}
        self.notifications: list[dict] = []

    def get_conversation(self, conversation_id: str | None, user_id: str, channel: str) -> Conversation:
        if conversation_id and conversation_id in self.conversations:
            return self.conversations[conversation_id]
        conv = Conversation(user_id=user_id, channel=channel)
        self.conversations[conv.conversation_id] = conv
        return conv

    def recent_conversations(self, user_id: str | None = None, limit: int = 20) -> list[Conversation]:
        convs = list(self.conversations.values())
        if user_id:
            convs = [c for c in convs if c.user_id == user_id]
        return sorted(convs, key=lambda c: c.updated_at, reverse=True)[:limit]

    def recent_actions(self, limit: int = 50) -> list[AgentAction]:
        return sorted(self.actions, key=lambda a: a.ts, reverse=True)[:limit]

    def active_tasks(self) -> list[AgentTask]:
        return [t for t in self.tasks.values() if t.status in ("pending", "running")]

    def get_reports(self, limit: int = 20) -> list[AgentReport]:
        return sorted(self.reports.values(), key=lambda r: r.created_at, reverse=True)[:limit]
