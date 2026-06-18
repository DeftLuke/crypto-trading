"""Report generation engine."""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.operations.store import OperationsStore
from app.operations.tools.registry import ToolRegistry
from app.operations.types import AgentReport, utc_now


class ReportEngine:
    def __init__(self, store: OperationsStore | None = None) -> None:
        self.store = store
        self.tools = ToolRegistry()
        self.settings = get_settings()
        self._reports_dir = Path(self.settings.data_root) / "reports"
        self._reports_dir.mkdir(parents=True, exist_ok=True)

    async def generate(self, report_type: str, params: dict[str, Any] | None = None) -> AgentReport:
        params = params or {}
        title = f"{report_type.title()} Report — {utc_now().strftime('%Y-%m-%d %H:%M UTC')}"
        content: dict[str, Any] = {"generated_at": utc_now().isoformat(), "type": report_type}

        if report_type in ("daily", "weekly", "monthly", "trade"):
            trades = await self.tools.execute("search_trades", {"limit": 500})
            content["trades"] = trades
            perf = trades.get("trades", [])
            content["summary"] = {
                "total": trades.get("count", 0),
                "win_rate": trades.get("win_rate", 0),
            }
        elif report_type == "strategy":
            content["strategies"] = await self.tools.execute("search_strategies")
        elif report_type == "risk":
            content["risk"] = await self.tools.execute("get_risk_status")
            content["events"] = await self.tools.execute("search_risk_events")
        elif report_type == "research":
            content["memories"] = await self.tools.execute("search_memories", {"query": "research discoveries", "limit": 15})
            content["reflections"] = await self.tools.execute("search_reflections")
        else:
            content["health"] = await self.tools.execute("system_health")

        fmt = params.get("format", "json")
        report = AgentReport(report_type=report_type, title=title, format=fmt, content=content)

        if fmt == "csv" and content.get("trades", {}).get("trades"):
            report.file_path = self._write_csv(report.report_id, content["trades"]["trades"])
        else:
            report.file_path = self._write_json(report.report_id, content)

        report.download_url = f"/operations/reports/{report.report_id}/download"
        if self.store:
            self.store.reports[report.report_id] = report
        return report

    def _write_json(self, report_id: str, content: dict) -> str:
        path = self._reports_dir / f"{report_id}.json"
        path.write_text(json.dumps(content, indent=2, default=str), encoding="utf-8")
        return str(path)

    def _write_csv(self, report_id: str, trades: list[dict]) -> str:
        path = self._reports_dir / f"{report_id}.csv"
        if not trades:
            path.write_text("", encoding="utf-8")
            return str(path)
        buf = io.StringIO()
        keys = list(trades[0].keys())[:20]
        writer = csv.DictWriter(buf, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        for row in trades:
            writer.writerow({k: row.get(k) for k in keys})
        path.write_text(buf.getvalue(), encoding="utf-8")
        return str(path)

    def read_report_file(self, report_id: str) -> tuple[str, bytes] | None:
        for ext, mime in ((".json", "application/json"), (".csv", "text/csv")):
            path = self._reports_dir / f"{report_id}{ext}"
            if path.exists():
                return mime, path.read_bytes()
        return None
