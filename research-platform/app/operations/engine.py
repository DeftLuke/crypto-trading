"""Phase 9 — Operations engine (n8n AI agent layer)."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger
from app.operations.agents.coordinator import CoordinatorAgent
from app.operations.notifications.engine import NotificationEngine
from app.operations.reports.engine import ReportEngine
from app.operations.store import OperationsStore
from app.operations.types import AgentTask, AuditLog, ChatRequest, utc_now
from app.operations.workflows.runner import WorkflowRunner

logger = get_logger("operations.engine")


class OperationsEngine:
    def __init__(self) -> None:
        self.store = OperationsStore()
        self.settings = get_settings()
        self.coordinator = CoordinatorAgent(self.store)
        self.workflows = WorkflowRunner(self.store)
        self.reports = ReportEngine(self.store)
        self.notify = NotificationEngine()

    async def chat(self, req: ChatRequest):
        return await self.coordinator.chat(req)

    async def run_task(self, task_type: str, params: dict[str, Any] | None = None) -> AgentTask:
        params = params or {}
        task = AgentTask(task_type=task_type, status="running")
        self.store.tasks[task.task_id] = task
        try:
            if task_type == "report":
                report = await self.reports.generate(params.get("report_type", "daily"), params)
                task.result = {"report_id": report.report_id, "download_url": report.download_url}
            elif task_type == "research":
                task.result = await self.workflows.run_workflow("research_cycle")
            elif task_type == "health_check":
                task.result = await self.workflows.run_workflow("health_check")
            elif task_type == "multi_step_report":
                strategies = await self.coordinator.tools.execute("search_strategies")
                report = await self.reports.generate("strategy", {"format": params.get("format", "json")})
                task.steps = [{"step": "search_strategies", "done": True}, {"step": "generate_report", "done": True}]
                task.result = {"strategies": strategies.get("summary"), "report_id": report.report_id, "download_url": report.download_url}
            else:
                task.result = await self.workflows.run_workflow(task_type, params)
            task.status = "completed"
        except Exception as e:
            task.status = "failed"
            task.error = str(e)
        task.completed_at = utc_now()
        self.store.audit_logs.append(AuditLog(event="task", detail={"task_type": task_type, "status": task.status}))
        return task

    async def handle_telegram_command(self, text: str, chat_id: str = "") -> str:
        cmd_map = {
            "/performance": ("search_trades", {}),
            "/risk": ("get_risk_status", {}),
            "/trades": ("search_trades", {"limit": 10}),
            "/strategies": ("search_strategies", {}),
            "/research": ("launch_research", {}),
            "/health": ("system_health", {}),
            "/help": (None, {}),
        }
        cmd = text.strip().split()[0].lower() if text.strip().startswith("/") else None
        if cmd == "/help":
            return (
                "Commands: /performance /risk /trades /strategies /research /health\n"
                "Or ask any question in natural language."
            )
        if cmd and cmd in cmd_map:
            tool_name, params = cmd_map[cmd]
            if tool_name:
                result = await self.coordinator.tools.execute(tool_name, params)
                return result.get("summary", str(result))
        resp = await self.chat(ChatRequest(message=text, channel="telegram", user_id=chat_id or "telegram"))
        return resp.answer

    def status(self) -> dict[str, Any]:
        return {
            "conversations": len(self.store.conversations),
            "actions": len(self.store.actions),
            "active_tasks": len(self.store.active_tasks()),
            "reports": len(self.store.reports),
            "workflows_run": len(self.store.workflows),
            "audit_logs": len(self.store.audit_logs),
            "llm_configured": bool(
                self.settings.openclaw_gateway_url and self.settings.openclaw_gateway_token
            ) or bool(self.settings.ai_gateway_url or self.settings.ai_openai_api_url),
            "openclaw_configured": bool(
                self.settings.openclaw_gateway_url and self.settings.openclaw_gateway_token
            ),
            "n8n_configured": bool(self.settings.n8n_base_url),
            "telegram_configured": bool(self.settings.telegram_bot_token),
        }

    def dashboard_payload(self) -> dict[str, Any]:
        return {
            "status": self.status(),
            "recent_actions": [a.model_dump(mode="json") for a in self.store.recent_actions(10)],
            "active_tasks": [t.model_dump(mode="json") for t in self.store.active_tasks()],
            "recent_reports": [r.model_dump(mode="json") for r in self.store.get_reports(5)],
            "workflows": [w.model_dump(mode="json") for w in self.store.workflows[-10:]],
            "notifications": self.store.notifications[-10:],
            "tools": self.coordinator.tools.list_tools(),
        }


@lru_cache
def get_operations_engine() -> OperationsEngine:
    return OperationsEngine()
