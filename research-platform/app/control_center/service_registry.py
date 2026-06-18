"""Platform service registry — health and control for all phases."""

from __future__ import annotations

import time
from typing import Any

from app.control_center.store import ControlCenterStore
from app.control_center.types import HealthState, PlatformService, ServiceState, utc_now
from app.core.logging import get_logger

logger = get_logger("control_center.services")

SERVICE_DEFS = [
    ("data_warehouse", "Historical Data Warehouse", "1", "/health"),
    ("indicator_engine", "Indicator + SMC Engine", "2", "/signals"),
    ("backtest_engine", "Backtesting Engine", "3", "/backtest/status"),
    ("memory_layer", "Qdrant Memory Layer", "5", "/memory/stats"),
    ("research_agent", "AI Research Agent", "6", "/agent/status"),
    ("paper_trading", "Paper Trading Engine", "7", "/paper/portfolio"),
    ("live_trading", "Live Trading Engine", "8", "/live/portfolio"),
    ("operations_agent", "n8n AI Agent", "9", "/operations/status"),
    ("scheduler", "Background Scheduler", "core", ""),
]


class ServiceRegistry:
    def __init__(self, store: ControlCenterStore) -> None:
        self.store = store
        if not store.services:
            self._init_services()

    def _init_services(self) -> None:
        for sid, name, phase, _ in SERVICE_DEFS:
            self.store.services[sid] = PlatformService(
                service_id=sid, name=name, phase=phase, version="0.10.0", endpoint=_
            )

    async def refresh(self) -> list[PlatformService]:
        try:
            import psutil
            proc = psutil.Process()
            cpu = proc.cpu_percent(interval=0.1)
            ram = proc.memory_info().rss / 1024 / 1024
        except Exception:
            cpu, ram = 0.0, 0.0

        checks = {
            "paper_trading": self._paper_health,
            "live_trading": self._live_health,
            "research_agent": self._agent_health,
            "memory_layer": self._memory_health,
            "operations_agent": self._ops_health,
            "scheduler": self._scheduler_health,
            "indicator_engine": self._signals_health,
            "backtest_engine": self._backtest_health,
            "data_warehouse": self._dataset_health,
        }

        for sid, svc in self.store.services.items():
            svc.cpu_pct = cpu
            svc.ram_mb = round(ram, 1)
            fn = checks.get(sid)
            if fn:
                try:
                    state, health, meta = await fn()
                    svc.state = state
                    svc.health = health
                    svc.metadata = meta
                    svc.error_count = meta.get("error_count", 0)
                    svc.queue_size = meta.get("queue_size", 0)
                except Exception as e:
                    svc.state = ServiceState.FAILED
                    svc.health = HealthState.UNHEALTHY
                    svc.metadata = {"error": str(e)}
            started = self.store._service_started.get(sid)
            svc.uptime_sec = int(time.time() - started) if started else 0
            svc.last_run = utc_now()
        return list(self.store.services.values())

    async def start(self, service_id: str) -> dict[str, Any]:
        self.store._service_started[service_id] = time.time()
        if service_id == "paper_trading":
            from app.paper_trading.engine import get_paper_engine
            return await get_paper_engine().start()
        if service_id == "live_trading":
            from app.live_trading.engine import get_live_engine
            return await get_live_engine().start()
        if service_id == "research_agent":
            from app.agents.orchestrator import get_orchestrator
            return await get_orchestrator().start()
        svc = self.store.services.get(service_id)
        if svc:
            svc.state = ServiceState.RUNNING
        return {"status": "started", "service_id": service_id}

    async def stop(self, service_id: str) -> dict[str, Any]:
        if service_id == "paper_trading":
            from app.paper_trading.engine import get_paper_engine
            return await get_paper_engine().stop()
        if service_id == "live_trading":
            from app.live_trading.engine import get_live_engine
            return await get_live_engine().stop()
        if service_id == "research_agent":
            from app.agents.orchestrator import get_orchestrator
            return await get_orchestrator().stop()
        svc = self.store.services.get(service_id)
        if svc:
            svc.state = ServiceState.STOPPED
        self.store._service_started.pop(service_id, None)
        return {"status": "stopped", "service_id": service_id}

    async def restart(self, service_id: str) -> dict[str, Any]:
        svc = self.store.services.get(service_id)
        if svc:
            svc.state = ServiceState.RESTARTING
        await self.stop(service_id)
        result = await self.start(service_id)
        if svc:
            svc.state = ServiceState.RUNNING
        return {"status": "restarted", **result}

    async def _paper_health(self):
        from app.paper_trading.engine import get_paper_engine
        h = get_paper_engine().health()
        state = ServiceState.RUNNING if h.get("running") else ServiceState.STOPPED
        health = HealthState.HEALTHY if h.get("feed_healthy") else HealthState.DEGRADED
        return state, health, h

    async def _live_health(self):
        from app.live_trading.engine import get_live_engine
        h = get_live_engine().health()
        state = ServiceState.RUNNING if h.get("running") else ServiceState.STOPPED
        health = HealthState.HEALTHY if h.get("exchange_connected") else HealthState.DEGRADED
        return state, health, h

    async def _agent_health(self):
        from app.agents.orchestrator import get_orchestrator
        try:
            s = get_orchestrator().status()
            state = ServiceState.RUNNING if s.get("running") else ServiceState.STOPPED
            return state, HealthState.HEALTHY, s
        except Exception as e:
            return ServiceState.FAILED, HealthState.DEGRADED, {"error": str(e)}

    async def _memory_health(self):
        from app.memory.service import get_memory_service
        s = get_memory_service().stats()
        return ServiceState.RUNNING, HealthState.HEALTHY, s

    async def _ops_health(self):
        from app.operations.engine import get_operations_engine
        s = get_operations_engine().status()
        return ServiceState.RUNNING, HealthState.HEALTHY, s

    async def _scheduler_health(self):
        from app.core.config import get_settings
        enabled = get_settings().scheduler_enabled
        return (
            ServiceState.RUNNING if enabled else ServiceState.STOPPED,
            HealthState.HEALTHY,
            {"scheduler_enabled": enabled},
        )

    async def _signals_health(self):
        return ServiceState.RUNNING, HealthState.HEALTHY, {"status": "ok"}

    async def _backtest_health(self):
        import app.backtest.runner as bt
        active = len(bt._active_jobs)
        return ServiceState.RUNNING, HealthState.HEALTHY, {"active_jobs": active, "queue_size": active}

    async def _dataset_health(self):
        return ServiceState.RUNNING, HealthState.HEALTHY, {"status": "ok"}
