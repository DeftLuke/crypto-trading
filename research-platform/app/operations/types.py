"""Phase 9 — Operations & AI agent domain types."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class IntentType(str, Enum):
    QUESTION = "question"
    ANALYSIS = "analysis"
    RESEARCH = "research"
    TRADING = "trading"
    RISK = "risk"
    REPORT = "report"
    MONITORING = "monitoring"
    STRATEGY = "strategy"
    WORKFLOW = "workflow"
    UNKNOWN = "unknown"


class AgentRole(str, Enum):
    COORDINATOR = "coordinator"
    TRADING = "trading"
    RESEARCH = "research"
    MEMORY = "memory"
    RISK = "risk"
    MONITORING = "monitoring"
    REPORTING = "reporting"


class ConversationMessage(BaseModel):
    role: str  # user | assistant | system | tool
    content: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    ts: datetime = Field(default_factory=utc_now)


class Conversation(BaseModel):
    conversation_id: str = Field(default_factory=new_id)
    user_id: str = "default"
    channel: str = "dashboard"  # dashboard | telegram | discord | api
    messages: list[ConversationMessage] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ToolCallRecord(BaseModel):
    tool: str
    params: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    latency_ms: int = 0
    success: bool = True
    error: str | None = None


class AgentAction(BaseModel):
    action_id: str = Field(default_factory=new_id)
    conversation_id: str | None = None
    action_type: str
    agent_role: AgentRole = AgentRole.COORDINATOR
    tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] = Field(default_factory=dict)
    approved: bool = False
    ts: datetime = Field(default_factory=utc_now)


class AgentTask(BaseModel):
    task_id: str = Field(default_factory=new_id)
    conversation_id: str | None = None
    task_type: str
    status: str = "pending"  # pending | running | completed | failed
    steps: list[dict[str, Any]] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    completed_at: datetime | None = None


class AgentReport(BaseModel):
    report_id: str = Field(default_factory=new_id)
    report_type: str  # daily | weekly | monthly | research | risk | trade | strategy
    title: str
    format: str = "json"  # json | csv | pdf
    content: dict[str, Any] = Field(default_factory=dict)
    file_path: str | None = None
    download_url: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class WorkflowRun(BaseModel):
    run_id: str = Field(default_factory=new_id)
    workflow_name: str
    trigger: str
    payload: dict[str, Any] = Field(default_factory=dict)
    status: str = "pending"
    n8n_execution_id: str | None = None
    result: dict[str, Any] = Field(default_factory=dict)
    started_at: datetime = Field(default_factory=utc_now)
    completed_at: datetime | None = None


class AuditLog(BaseModel):
    log_id: str = Field(default_factory=new_id)
    event: str
    user_id: str = "default"
    channel: str = "api"
    detail: dict[str, Any] = Field(default_factory=dict)
    ts: datetime = Field(default_factory=utc_now)


class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None
    user_id: str = "default"
    channel: str = "dashboard"
    context: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    conversation_id: str
    answer: str
    intent: IntentType
    agent: AgentRole
    tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    memories_used: list[dict[str, Any]] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    model: str | None = None
