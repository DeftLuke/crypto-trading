"""Immutable audit logging."""

from __future__ import annotations

from app.control_center.store import ControlCenterStore
from app.control_center.types import PlatformAuditEntry


class AuditLogger:
    def __init__(self, store: ControlCenterStore) -> None:
        self.store = store

    def log(
        self,
        category: str,
        action: str,
        actor: str = "system",
        role: str = "admin",
        detail: dict | None = None,
        ip: str | None = None,
    ) -> PlatformAuditEntry:
        entry = PlatformAuditEntry(
            category=category,
            action=action,
            actor=actor,
            role=role,
            detail=detail or {},
            ip=ip,
        )
        self.store.audit.append(entry)
        return entry
