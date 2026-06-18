"""Workflow runner — event-driven n8n + internal handlers."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings
from app.core.logging import get_logger
from app.operations.notifications.engine import NotificationEngine
from app.operations.store import OperationsStore
from app.operations.types import WorkflowRun, utc_now

logger = get_logger("operations.workflows")

EVENT_HANDLERS = {
    "backtest_completed": ["notify", "store_memory"],
    "research_completed": ["notify", "store_memory"],
    "strategy_approved": ["notify"],
    "strategy_rejected": ["notify"],
    "trade_opened": ["notify"],
    "trade_closed": ["notify", "store_memory"],
    "risk_event": ["notify"],
    "system_error": ["notify"],
    "memory_update": ["notify"],
    "pattern_discovery": ["notify"],
}


class WorkflowRunner:
    def __init__(self, store: OperationsStore) -> None:
        self.store = store
        self.settings = get_settings()
        self.notify = NotificationEngine()

    async def emit(self, event_type: str, payload: dict[str, Any] | None = None) -> WorkflowRun:
        payload = payload or {}
        run = WorkflowRun(workflow_name=event_type, trigger="event", payload=payload, status="running")
        self.store.workflows.append(run)

        handlers = EVENT_HANDLERS.get(event_type, ["notify"])
        results: dict[str, Any] = {}

        for handler in handlers:
            try:
                if handler == "notify":
                    msg = payload.get("message") or f"Platform event: {event_type}"
                    results["notify"] = await self.notify.send(event_type, msg, channels=["telegram", "dashboard"], metadata=payload)
                elif handler == "store_memory":
                    results["memory"] = await self._store_memory(event_type, payload)
            except Exception as e:
                logger.warning("Handler failed", extra={"handler": handler, "error": str(e)})
                results[handler] = {"error": str(e)}

        if self.settings.n8n_base_url:
            results["n8n"] = await self._trigger_n8n(event_type, payload)

        run.status = "completed"
        run.result = results
        run.completed_at = utc_now()
        return run

    async def run_workflow(self, workflow_name: str, payload: dict[str, Any] | None = None) -> WorkflowRun:
        """Manual workflow trigger (scheduled or API)."""
        payload = payload or {}
        run = WorkflowRun(workflow_name=workflow_name, trigger="manual", payload=payload, status="running")
        self.store.workflows.append(run)

        if workflow_name == "daily_summary":
            from app.operations.reports.engine import ReportEngine

            report = await ReportEngine(self.store).generate("daily")
            await self.notify.send("daily_summary", f"Daily report ready: {report.title}", channels=["telegram"])
            run.result = {"report_id": report.report_id}
        elif workflow_name == "research_cycle":
            from app.agents.orchestrator import get_orchestrator

            run.result = await get_orchestrator().run_once()
        elif workflow_name == "memory_cleanup":
            from app.memory.service import get_memory_service

            run.result = get_memory_service().run_learning_cycle()
        elif workflow_name == "health_check":
            from app.operations.tools.registry import ToolRegistry

            run.result = await ToolRegistry().execute("system_health")
        else:
            run.result = await self.emit(workflow_name, payload)

        run.status = "completed"
        run.completed_at = utc_now()
        return run

    async def _trigger_n8n(self, event_type: str, payload: dict) -> dict[str, Any]:
        base = self.settings.n8n_base_url.rstrip("/")
        url = f"{base}/webhook/platform-event"
        headers = {}
        if self.settings.n8n_api_key:
            headers["X-N8N-API-KEY"] = self.settings.n8n_api_key
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(url, json={"event_type": event_type, **payload}, headers=headers)
                return {"ok": r.is_success, "status": r.status_code}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def _store_memory(self, event_type: str, payload: dict) -> dict[str, Any]:
        from uuid import uuid4

        from app.memory.service import get_memory_service

        try:
            return get_memory_service().store_reflection(
                {
                    "memory_id": str(uuid4()),
                    "observation": f"{event_type}: {payload.get('message', '')}",
                    "evidence": str(payload)[:500],
                    "category": event_type,
                    "strategy_name": payload.get("strategy_name", "platform"),
                }
            )
        except Exception as e:
            return {"skipped": str(e)}
