"""Tool registry — interfaces to all platform phases."""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from typing import Any

from app.core.logging import get_logger

logger = get_logger("operations.tools")


class BaseTool(ABC):
    name: str = "base"
    description: str = ""

    @abstractmethod
    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        ...


class SearchTradesTool(BaseTool):
    name = "search_trades"
    description = "Search paper and live trades with optional filters"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.paper_trading.engine import get_paper_engine
        from app.live_trading.engine import get_live_engine

        limit = params.get("limit", 50)
        strategy = params.get("strategy")
        paper = get_paper_engine().store.get_trades(limit, strategy)
        live = get_live_engine().store.get_trades(limit, strategy)
        trades = [
            {"source": "paper", **t.model_dump(mode="json")} for t in paper
        ] + [{"source": "live", **t.model_dump(mode="json")} for t in live]
        wins = [t for t in trades if (t.get("pnl_usd") or 0) > 0]
        return {
            "count": len(trades),
            "trades": trades[:limit],
            "win_rate": round(len(wins) / len(trades) * 100, 2) if trades else 0,
            "summary": f"Found {len(trades)} trades ({len(wins)} wins)",
        }


class SearchStrategiesTool(BaseTool):
    name = "search_strategies"
    description = "List and rank strategies with paper validation status"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.paper_trading.engine import get_paper_engine

        eng = get_paper_engine()
        metrics = eng.store.strategy_metrics
        approvals = eng.store.approvals
        validations = {k: v.model_dump(mode="json") for k, v in eng.store.validations.items()}
        ranked = sorted(metrics.items(), key=lambda x: x[1].get("net_profit", 0), reverse=True)
        return {
            "strategies": [{"name": k, **v, "approved": k in approvals} for k, v in ranked],
            "validations": validations,
            "approvals": approvals,
            "summary": f"{len(metrics)} strategies tracked, {len(approvals)} approved for live",
        }


class SearchBacktestsTool(BaseTool):
    name = "search_backtests"
    description = "Search backtest results from Phase 3"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        import app.backtest.runner as bt_runner

        jobs = list(bt_runner._job_status.values())[: params.get("limit", 20)]
        return {
            "count": len(jobs),
            "backtests": jobs,
            "summary": f"{len(jobs)} backtest jobs in runner cache",
        }


class SearchMemoriesTool(BaseTool):
    name = "search_memories"
    description = "Semantic search across Qdrant memory collections"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.memory.service import get_memory_service

        query = params.get("query", "trading patterns strategies")
        mem = get_memory_service()
        recalled = mem.multi_recall(query=query, limit=params.get("limit", 8))
        total = sum(len(v) for v in recalled.values())
        flat = []
        for coll, items in recalled.items():
            for item in items:
                flat.append({"collection": coll, **item})
        return {"count": total, "results": flat[: params.get("limit", 8)], "collections": recalled, "summary": f"Recalled {total} memories"}


class SearchReflectionsTool(BaseTool):
    name = "search_reflections"
    description = "Search agent reflections and lessons learned"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.memory.service import get_memory_service

        mem = get_memory_service()
        refs = mem.list_reflections(limit=params.get("limit", 10))
        return {"count": len(refs), "reflections": refs, "summary": f"{len(refs)} reflections found"}


class SearchSignalsTool(BaseTool):
    name = "search_signals"
    description = "Recent trading signals from signal engine"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        try:
            from app.agents.orchestrator import get_orchestrator

            recs = get_orchestrator().coordinator.recommendations
            signals = [r.model_dump(mode="json") if hasattr(r, "model_dump") else r for r in recs[: params.get("limit", 20)]]
            return {"count": len(signals), "signals": signals, "summary": f"{len(signals)} agent recommendations/signals"}
        except Exception as e:
            return {"count": 0, "signals": [], "summary": f"Signals unavailable: {e}"}


class SearchPositionsTool(BaseTool):
    name = "search_positions"
    description = "Open paper and live positions"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.paper_trading.engine import get_paper_engine
        from app.live_trading.engine import get_live_engine

        paper = get_paper_engine().store.get_open_positions()
        live = get_live_engine().store.open_positions()
        return {
            "paper": [p.model_dump(mode="json") for p in paper],
            "live": [p.model_dump(mode="json") for p in live],
            "count": len(paper) + len(live),
            "summary": f"{len(paper)} paper + {len(live)} live open positions",
        }


class SearchRiskEventsTool(BaseTool):
    name = "search_risk_events"
    description = "Risk events from paper and live engines"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.live_trading.engine import get_live_engine

        live_events = get_live_engine().store.risk_events[-20:]
        return {"events": live_events, "count": len(live_events), "summary": f"{len(live_events)} recent risk events"}


class GetRiskStatusTool(BaseTool):
    name = "get_risk_status"
    description = "Current risk status for paper and live accounts"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.paper_trading.engine import get_paper_engine
        from app.live_trading.engine import get_live_engine

        paper = get_paper_engine()
        live = get_live_engine()
        return {
            "paper": paper.risk.status(paper.default_account_id),
            "live": live.risk.status(live.default_account_id),
            "summary": "Paper and live risk status retrieved",
        }


class LaunchResearchTool(BaseTool):
    name = "launch_research"
    description = "Trigger AI research agent cycle (Phase 6)"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.agents.orchestrator import get_orchestrator

        result = await get_orchestrator().run_once()
        return {"result": result, "summary": "Research cycle completed"}


class LaunchBacktestTool(BaseTool):
    name = "launch_backtest"
    description = "Launch a backtest (requires strategy params)"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        return {
            "status": "queued",
            "message": "Backtest launch requires strategy config via /backtest/start API",
            "params_received": params,
            "summary": "Use dashboard or POST /backtest/start with full strategy config",
        }


class ApproveStrategyTool(BaseTool):
    name = "approve_strategy"
    description = "Recommend strategy approval (requires human confirmation)"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("strategy_name", "")
        from app.paper_trading.engine import get_paper_engine

        val = get_paper_engine().store.validations.get(name)
        if not val:
            return {"approved": False, "summary": f"Strategy '{name}' not found in validations"}
        if val.verdict != "pass":
            return {"approved": False, "summary": f"Strategy '{name}' validation verdict: {val.verdict}"}
        return {
            "approved": False,
            "requires_human": True,
            "recommendation": "approve",
            "score": val.approval_score,
            "summary": f"Strategy '{name}' passed validation (score {val.approval_score}) — human approval required",
        }


class PauseStrategyTool(BaseTool):
    name = "pause_strategy"
    description = "Disable a strategy on live engine (requires confirmation)"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("strategy_name", "")
        if params.get("confirmed"):
            from app.live_trading.engine import get_live_engine

            get_live_engine().disable_strategy(name)
            return {"disabled": name, "summary": f"Strategy '{name}' disabled on live engine"}
        return {"requires_confirmation": True, "summary": f"Confirm to disable strategy '{name}'"}


class GenerateReportTool(BaseTool):
    name = "generate_report"
    description = "Generate platform report (daily/weekly/strategy/risk)"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.operations.reports.engine import ReportEngine

        report = await ReportEngine().generate(params.get("report_type", "daily"), params)
        return {"report_id": report.report_id, "title": report.title, "download_url": report.download_url, "summary": report.title}


class SystemHealthTool(BaseTool):
    name = "system_health"
    description = "Monitor API, paper, live, research, memory health"

    async def execute(self, params: dict[str, Any]) -> dict[str, Any]:
        from app.live_trading.engine import get_live_engine
        from app.memory.service import get_memory_service
        from app.paper_trading.engine import get_paper_engine

        research_status: dict[str, Any] = {"status": "unknown"}
        try:
            from app.agents.orchestrator import get_orchestrator

            research_status = get_orchestrator().status()
        except Exception as e:
            research_status = {"status": "error", "error": str(e)}

        mem_stats = get_memory_service().stats()
        return {
            "paper": get_paper_engine().health(),
            "live": get_live_engine().health(),
            "research_agent": research_status,
            "memory": mem_stats,
            "summary": "System health snapshot collected",
        }


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}
        for cls in [
            SearchTradesTool, SearchStrategiesTool, SearchBacktestsTool, SearchMemoriesTool,
            SearchReflectionsTool, SearchSignalsTool, SearchPositionsTool, SearchRiskEventsTool,
            GetRiskStatusTool, LaunchResearchTool, LaunchBacktestTool, ApproveStrategyTool,
            PauseStrategyTool, GenerateReportTool, SystemHealthTool,
        ]:
            tool = cls()
            self._tools[tool.name] = tool

    def list_tools(self) -> list[dict[str, str]]:
        return [{"name": t.name, "description": t.description} for t in self._tools.values()]

    async def execute(self, name: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        tool = self._tools.get(name)
        if not tool:
            return {"error": f"Unknown tool: {name}"}
        t0 = time.perf_counter()
        try:
            result = await tool.execute(params or {})
            result["_latency_ms"] = int((time.perf_counter() - t0) * 1000)
            return result
        except Exception as e:
            logger.warning("Tool failed", extra={"tool": name, "error": str(e)})
            return {"error": str(e), "_latency_ms": int((time.perf_counter() - t0) * 1000)}
