"""Unified signal → approval → execution pipeline (replaces legacy n8n trade-execute)."""

from __future__ import annotations

from typing import Any

from app.control_center.approval import ApprovalEngine
from app.control_center.audit import AuditLogger
from app.control_center.journal import TradingJournal
from app.control_center.store import ControlCenterStore
from app.control_center.types import TradingMode, utc_now
from app.core.config import get_settings
from app.core.logging import get_logger
from app.live_trading.types import LiveSignal
from app.paper_trading.types import SignalIntake

logger = get_logger("control_center.pipeline")


class TradingPipeline:
    """Central execution gate — all signals flow through here."""

    def __init__(self, store: ControlCenterStore, audit: AuditLogger, journal: TradingJournal, approval: ApprovalEngine) -> None:
        self.store = store
        self.audit = audit
        self.journal = journal
        self.approval = approval
        self.settings = get_settings()

    async def process_signal(self, signal: dict[str, Any], source: str = "signal_engine") -> dict[str, Any]:
        signal = {**signal, "source": source}
        self.audit.log("trade", "signal_received", detail=signal)

        if not self.store.settings.auto_trading:
            await self._notify_signal_only(signal)
            return {"executed": False, "reason": "auto_trading_off", "notified": True}

        if self.store.settings.manual_approval:
            pending = self.approval.create_pending(signal)
            await self._notify_approval_request(pending, signal)
            self.journal.add_event(
                self._ensure_journal(signal).journal_id,
                "signal_created",
                detail={"approval_id": pending.approval_id},
            )
            return {"executed": False, "approval_required": True, "approval_id": pending.approval_id}

        return await self._execute(signal)

    async def approve_and_execute(self, approval_id: str, passcode: str, actor: str = "user") -> dict[str, Any]:
        ok, msg = await self.approval.approve(approval_id, passcode, actor)
        if not ok:
            return {"executed": False, "reason": msg}
        approval = self.store.approvals[approval_id]
        self.journal.add_event(
            self._ensure_journal(approval.payload).journal_id,
            "trade_approved",
            detail={"approval_id": approval_id, "actor": actor},
        )
        return await self._execute(approval.payload)

    async def reject_approval(self, approval_id: str, actor: str = "user") -> dict[str, Any]:
        ok, msg = self.approval.reject(approval_id, actor)
        return {"rejected": ok, "reason": msg}

    async def _execute(self, signal: dict[str, Any]) -> dict[str, Any]:
        mode = self.store.settings.mode
        journal = self._ensure_journal(signal)

        if mode == TradingMode.DEMO:
            from app.paper_trading.engine import get_paper_engine

            eng = get_paper_engine()
            if not eng._running:
                await eng.start()
            intake = SignalIntake.model_validate(signal)
            result = await eng.process_signal(intake)
        else:
            from app.live_trading.engine import get_live_engine

            eng = get_live_engine()
            if not eng._running:
                await eng.start()
            live_sig = LiveSignal.model_validate({**signal, "manual_override": signal.get("manual_override", False)})
            result = await eng.process_signal(live_sig)

        if result.get("accepted") or result.get("closed"):
            pos_id = result.get("position_id")
            self.journal.add_event(journal.journal_id, "trade_opened", detail=result, position_id=pos_id)
            await self._notify_trade_opened(signal, result)
            self.audit.log("trade", "trade_executed", detail={"mode": mode.value, **result})
        else:
            await self._notify_rejected(signal, result.get("reason", "unknown"))
            self.audit.log("trade", "trade_rejected", detail=result)

        return {"executed": bool(result.get("accepted")), **result, "mode": mode.value}

    def _ensure_journal(self, signal: dict) -> Any:
        existing = next(
            (j for j in self.store.journal if j.signal_id == signal.get("signal_id") and j.symbol == signal.get("symbol", "").upper()),
            None,
        )
        if existing:
            return existing
        return self.journal.record_open(
            source="paper" if self.store.settings.mode == TradingMode.DEMO else "live",
            symbol=signal["symbol"].upper(),
            direction=signal["direction"].upper(),
            entry_price=float(signal.get("entry") or 0),
            strategy_name=signal.get("strategy_name", ""),
            signal_id=signal.get("signal_id"),
            sl=signal.get("sl"),
            tp1=signal.get("tp1"),
            tp2=signal.get("tp2"),
            market_conditions=signal.get("indicators", {}),
        )

    async def _notify_signal_only(self, signal: dict) -> None:
        msg = self._format_signal_msg(signal, "Signal Generated (Auto Trading OFF)")
        await self._send_notification("signal", msg)

    async def _notify_approval_request(self, pending, signal: dict) -> None:
        msg = (
            f"📊 <b>Trade Approval Required</b>\n"
            f"{signal['symbol']} {signal['direction']}\n"
            f"Entry: {signal.get('entry', 'market')}\n"
            f"SL: {signal.get('sl', '—')}\n"
            f"Approve ID: <code>{pending.approval_id[:8]}</code>"
        )
        await self._send_notification("approval_request", msg, {"approval_id": pending.approval_id})

    async def _notify_trade_opened(self, signal: dict, result: dict) -> None:
        msg = (
            f"✅ <b>Trade Opened</b>\n"
            f"{signal['symbol']} {signal['direction']}\n"
            f"Entry: {result.get('entry', signal.get('entry'))}\n"
            f"Mode: {self.store.settings.mode.value}"
        )
        await self._send_notification("trade_opened", msg, result)

    async def _notify_rejected(self, signal: dict, reason: str) -> None:
        msg = f"❌ <b>Trade Rejected</b>\n{signal['symbol']} {signal['direction']}\n{reason}"
        await self._send_notification("trade_rejected", msg)

    async def notify_trade_closed(self, trade: dict) -> None:
        duration = trade.get("duration_sec", 0)
        hours, rem = divmod(duration, 3600)
        mins = rem // 60
        emoji = "🟢" if trade.get("pnl_usd", 0) > 0 else "🔴"
        msg = (
            f"{emoji} <b>Trade Closed</b>\n"
            f"{trade.get('symbol')} {trade.get('direction')}\n"
            f"Entry: {trade.get('entry_price')}\n"
            f"Exit: {trade.get('exit_price')}\n"
            f"PnL: {trade.get('pnl_pct', 0):+.2f}% (${trade.get('pnl_usd', 0):+.2f})\n"
            f"Duration: {hours}h {mins}m"
        )
        await self._send_notification("trade_closed", msg, trade)

    async def notify_timeline_event(self, symbol: str, event_type: str, detail: dict) -> None:
        labels = {
            "tp1_hit": "🎯 TP1 Hit — SL moved to entry",
            "tp2_hit": "🎯 TP2 Hit — SL moved to TP1",
            "trailing_activated": "📈 Trailing stop activated",
            "sl_moved": f"🛡 SL moved to {detail.get('stop_loss')}",
            "risk_event": f"⚠️ Risk event: {detail.get('reason', '')}",
        }
        msg = labels.get(event_type, f"📌 {event_type}: {symbol}")
        await self._send_notification(event_type, msg, detail)

    def _format_signal_msg(self, signal: dict, title: str) -> str:
        return (
            f"📡 <b>{title}</b>\n"
            f"{signal['symbol']} {signal['direction']}\n"
            f"Entry: {signal.get('entry', '—')} | SL: {signal.get('sl', '—')}\n"
            f"Strategy: {signal.get('strategy_name', '—')}"
        )

    async def _send_notification(self, event_type: str, message: str, metadata: dict | None = None) -> None:
        from app.control_center.types import NotificationRecord
        from app.operations.notifications.engine import NotificationEngine

        record = NotificationRecord(channel="telegram", event_type=event_type, message=message, metadata=metadata or {})
        self.store.notifications.append(record)
        await NotificationEngine().send(event_type, message, channels=["telegram", "dashboard"], metadata=metadata)
