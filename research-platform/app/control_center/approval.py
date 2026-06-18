"""Manual approval engine with passcode verification."""

from __future__ import annotations

import hashlib

from app.control_center.audit import AuditLogger
from app.control_center.store import ControlCenterStore
from app.control_center.types import PendingApproval, utc_now
from app.core.config import get_settings


class ApprovalEngine:
    def __init__(self, store: ControlCenterStore, audit: AuditLogger) -> None:
        self.store = store
        self.audit = audit
        self.settings = get_settings()

    def create_pending(self, signal: dict) -> PendingApproval:
        approval = PendingApproval(
            symbol=signal["symbol"].upper(),
            direction=signal["direction"].upper(),
            entry=signal.get("entry"),
            sl=signal.get("sl"),
            tp1=signal.get("tp1"),
            tp2=signal.get("tp2"),
            strategy_name=signal.get("strategy_name", "manual"),
            confidence=float(signal.get("confidence", 0)),
            signal_id=signal.get("signal_id"),
            payload=signal,
        )
        self.store.approvals[approval.approval_id] = approval
        self.audit.log("trade", "approval_created", detail={"approval_id": approval.approval_id, "symbol": approval.symbol})
        return approval

    def verify_passcode(self, passcode: str) -> bool:
        expected = self.settings.trade_approval_passcode
        if not expected:
            return False
        return passcode == expected

    async def approve(self, approval_id: str, passcode: str, actor: str = "user") -> tuple[bool, str]:
        approval = self.store.approvals.get(approval_id)
        if not approval or approval.status != "pending":
            return False, "Approval not found or already processed"
        if not self.verify_passcode(passcode):
            self.audit.log("trade", "approval_passcode_failed", actor=actor, detail={"approval_id": approval_id})
            return False, "Invalid passcode"
        approval.status = "approved"
        self.audit.log("trade", "approval_granted", actor=actor, detail={"approval_id": approval_id})
        return True, "approved"

    def reject(self, approval_id: str, actor: str = "user") -> tuple[bool, str]:
        approval = self.store.approvals.get(approval_id)
        if not approval:
            return False, "Not found"
        approval.status = "rejected"
        self.audit.log("trade", "approval_rejected", actor=actor, detail={"approval_id": approval_id})
        return True, "rejected"

    def list_pending(self) -> list[PendingApproval]:
        return self.store.pending_approvals()
