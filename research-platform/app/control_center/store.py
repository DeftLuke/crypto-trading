"""Control center in-memory store."""

from __future__ import annotations

from app.control_center.types import (
    JournalEntry,
    NotificationRecord,
    PendingApproval,
    PlatformAuditEntry,
    PlatformService,
    TradingSettings,
)


class ControlCenterStore:
    def __init__(self) -> None:
        self.services: dict[str, PlatformService] = {}
        self.settings: TradingSettings = TradingSettings()
        self.approvals: dict[str, PendingApproval] = {}
        self.journal: list[JournalEntry] = []
        self.audit: list[PlatformAuditEntry] = []
        self.notifications: list[NotificationRecord] = []
        self.workflow_runs: list[dict] = []
        self._service_started: dict[str, float] = {}

    def pending_approvals(self) -> list[PendingApproval]:
        return [a for a in self.approvals.values() if a.status == "pending"]

    def get_journal(self, limit: int = 100) -> list[JournalEntry]:
        return sorted(self.journal, key=lambda j: j.opened_at, reverse=True)[:limit]

    def audit_logs(self, limit: int = 200, category: str | None = None) -> list[PlatformAuditEntry]:
        logs = self.audit
        if category:
            logs = [l for l in logs if l.category == category]
        return sorted(logs, key=lambda l: l.ts, reverse=True)[:limit]
