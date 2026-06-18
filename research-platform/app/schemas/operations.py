"""Phase 9 operations API schemas."""

from typing import Any

from pydantic import BaseModel, Field


class ChatRequestBody(BaseModel):
    message: str
    conversation_id: str | None = None
    user_id: str = "default"
    channel: str = "dashboard"
    context: dict[str, Any] = Field(default_factory=dict)


class TaskRequestBody(BaseModel):
    task_type: str
    params: dict[str, Any] = Field(default_factory=dict)


class WorkflowRunRequest(BaseModel):
    workflow_name: str
    payload: dict[str, Any] = Field(default_factory=dict)


class EventEmitRequest(BaseModel):
    event_type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class TelegramWebhookBody(BaseModel):
    text: str
    chat_id: str = ""
