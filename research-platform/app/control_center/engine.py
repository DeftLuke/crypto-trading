"""Enterprise control center orchestrator."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.control_center.approval import ApprovalEngine
from app.control_center.audit import AuditLogger
from app.control_center.emergency import EmergencyControls
from app.control_center.exchanges.manager import ExchangeManager
from app.control_center.journal import TradingJournal
from app.control_center.pipeline import TradingPipeline
from app.control_center.service_registry import ServiceRegistry
from app.control_center.store import ControlCenterStore
from app.control_center.types import TradingMode, TradingSettings, utc_now
from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger("control_center.engine")


class ControlCenterEngine:
    def __init__(self) -> None:
        self.store = ControlCenterStore()
        self.settings_cfg = get_settings()
        self.audit = AuditLogger(self.store)
        self.journal = TradingJournal(self.store, self.audit)
        self.approval = ApprovalEngine(self.store, self.audit)
        self.pipeline = TradingPipeline(self.store, self.audit, self.journal, self.approval)
        self.services = ServiceRegistry(self.store)
        self.exchanges = ExchangeManager()
        self.emergency = EmergencyControls(self.store, self.audit)
        self._load_settings()

    def _load_settings(self) -> None:
        s = self.store.settings
        s.mode = TradingMode.LIVE if self.settings_cfg.control_trading_mode == "live" else TradingMode.DEMO
        s.auto_trading = self.settings_cfg.control_auto_trading
        s.manual_approval = self.settings_cfg.control_manual_approval
        s.default_exchange = self.settings_cfg.control_default_exchange

    def update_settings(self, updates: dict[str, Any], actor: str = "admin") -> TradingSettings:
        s = self.store.settings
        if "mode" in updates:
            s.mode = TradingMode(updates["mode"])
        if "auto_trading" in updates:
            s.auto_trading = bool(updates["auto_trading"])
        if "manual_approval" in updates:
            s.manual_approval = bool(updates["manual_approval"])
        if "default_exchange" in updates:
            s.default_exchange = updates["default_exchange"]
        s.updated_at = utc_now()
        self.audit.log("system", "settings_updated", actor=actor, detail=updates)
        return s

    async def dashboard(self) -> dict[str, Any]:
        services = await self.services.refresh()
        exchanges = await self.exchanges.all_status()
        self.journal.sync_from_engines()

        from app.live_trading.engine import get_live_engine
        from app.paper_trading.engine import get_paper_engine
        from app.memory.service import get_memory_service
        from app.operations.engine import get_operations_engine

        paper = get_paper_engine()
        live = get_live_engine()
        mem = get_memory_service().stats()

        return {
            "settings": self.store.settings.model_dump(mode="json"),
            "services": [s.model_dump(mode="json") for s in services],
            "exchanges": [e.model_dump(mode="json") for e in exchanges],
            "positions": {
                "paper": [p.model_dump(mode="json") for p in paper.store.get_open_positions()],
                "live": [p.model_dump(mode="json") for p in live.store.open_positions()],
            },
            "pending_approvals": [a.model_dump(mode="json") for a in self.store.pending_approvals()],
            "risk": {
                "paper": paper.risk.status(paper.default_account_id),
                "live": live.risk.status(live.default_account_id),
                "circuit_breaker": live.store.circuit.model_dump(mode="json"),
            },
            "memory": mem,
            "ai_activity": await self._ai_activity(),
            "backtests": await self._backtest_status(),
            "workflows": get_operations_engine().store.workflows[-10:],
            "notifications": [n.model_dump(mode="json") for n in self.store.notifications[-20:]],
            "journal_count": len(self.store.journal),
            "audit_count": len(self.store.audit),
        }

    async def _ai_activity(self) -> dict[str, Any]:
        try:
            from app.agents.orchestrator import get_orchestrator
            from app.memory.service import get_memory_service

            orch = get_orchestrator()
            mem = get_memory_service()
            return {
                "agent_status": orch.status(),
                "recommendations": len(orch.coordinator.recommendations),
                "hypotheses": len(orch.coordinator.hypotheses),
                "reflections": mem.list_reflections(5),
                "top_patterns": mem.top_patterns(5),
                "memory_total": mem.stats().get("total_memories", 0),
            }
        except Exception as e:
            return {"error": str(e)}

    async def _backtest_status(self) -> dict[str, Any]:
        import app.backtest.runner as bt

        jobs = list(bt._job_status.values())
        return {
            "active": len(bt._active_jobs),
            "jobs": jobs[-10:],
            "completed": sum(1 for j in jobs if j.get("status") == "completed"),
            "failed": sum(1 for j in jobs if j.get("status") == "failed"),
        }


@lru_cache
def get_control_center() -> ControlCenterEngine:
    return ControlCenterEngine()
