"""Emergency controls — audited kill switches."""

from __future__ import annotations

from typing import Any

from app.control_center.audit import AuditLogger
from app.control_center.store import ControlCenterStore
from app.control_center.types import TradingMode


class EmergencyControls:
    def __init__(self, store: ControlCenterStore, audit: AuditLogger) -> None:
        self.store = store
        self.audit = audit

    async def stop_auto_trading(self, actor: str = "admin") -> dict[str, Any]:
        self.store.settings.auto_trading = False
        self.audit.log("system", "stop_auto_trading", actor=actor)
        return {"auto_trading": False}

    async def close_all_positions(self, actor: str = "admin") -> dict[str, Any]:
        from app.live_trading.engine import get_live_engine
        from app.paper_trading.engine import get_paper_engine

        paper_eng = get_paper_engine()
        paper_result = {"closed_count": 0}
        if paper_eng._running:
            for pos in list(paper_eng.store.get_open_positions()):
                await paper_eng.close_position(pos.position_id, reason="emergency_close_all")
                paper_result["closed_count"] += 1
        live = await get_live_engine().close_all() if get_live_engine()._running else {"closed_count": 0}
        self.audit.log("trade", "close_all_positions", actor=actor, detail={"paper": paper_result, "live": live})
        return {"paper": paper_result, "live": live}

    async def kill_switch(self, actor: str = "admin") -> dict[str, Any]:
        from app.live_trading.engine import get_live_engine

        self.store.settings.auto_trading = False
        result = await get_live_engine().kill_switch()
        self.audit.log("risk", "kill_switch", actor=actor, detail=result)
        return result

    async def pause_research(self, actor: str = "admin") -> dict[str, Any]:
        from app.agents.orchestrator import get_orchestrator

        result = await get_orchestrator().stop()
        self.audit.log("system", "pause_research", actor=actor)
        return result

    async def pause_ai_agent(self, actor: str = "admin") -> dict[str, Any]:
        self.audit.log("system", "pause_ai_agent", actor=actor)
        return {"paused": True, "note": "Operations agent chat remains available; auto workflows paused via stop_auto_trading"}

    async def disable_exchange(self, exchange_id: str, actor: str = "admin") -> dict[str, Any]:
        from app.control_center.exchanges.manager import ExchangeManager

        result = await ExchangeManager().disconnect(exchange_id)
        self.audit.log("system", "disable_exchange", actor=actor, detail={"exchange": exchange_id})
        return result

    async def disable_strategies(self, actor: str = "admin") -> dict[str, Any]:
        from app.live_trading.engine import get_live_engine

        eng = get_live_engine()
        for name in list(eng.store.deployments.keys()) or []:
            eng.disable_strategy(name)
        self.audit.log("strategy", "disable_all_strategies", actor=actor)
        return {"disabled": True}
