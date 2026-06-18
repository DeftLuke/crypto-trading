"""Trading journal + event timeline."""

from __future__ import annotations

from app.control_center.audit import AuditLogger
from app.control_center.store import ControlCenterStore
from app.control_center.types import JournalEntry, TimelineEvent, utc_now


class TradingJournal:
    def __init__(self, store: ControlCenterStore, audit: AuditLogger) -> None:
        self.store = store
        self.audit = audit

    def record_open(
        self,
        source: str,
        symbol: str,
        direction: str,
        entry_price: float,
        strategy_name: str = "",
        signal_id: str | None = None,
        sl: float | None = None,
        tp1: float | None = None,
        tp2: float | None = None,
        position_id: str | None = None,
        market_conditions: dict | None = None,
    ) -> JournalEntry:
        entry = JournalEntry(
            source=source,
            symbol=symbol,
            direction=direction,
            strategy_name=strategy_name,
            signal_id=signal_id,
            entry_price=entry_price,
            sl=sl,
            tp1=tp1,
            tp2=tp2,
            market_conditions=market_conditions or {},
            timeline=[
                TimelineEvent(
                    event_type="trade_opened",
                    position_id=position_id,
                    detail={"entry": entry_price, "symbol": symbol, "direction": direction},
                )
            ],
        )
        self.store.journal.append(entry)
        self.audit.log("trade", "journal_open", detail={"journal_id": entry.journal_id, "symbol": symbol})
        return entry

    def add_event(
        self,
        journal_id: str,
        event_type: str,
        detail: dict | None = None,
        trade_id: str | None = None,
        position_id: str | None = None,
    ) -> TimelineEvent | None:
        entry = next((j for j in self.store.journal if j.journal_id == journal_id), None)
        if not entry:
            return None
        ev = TimelineEvent(event_type=event_type, trade_id=trade_id, position_id=position_id, detail=detail or {})
        entry.timeline.append(ev)
        self.audit.log("trade", f"timeline_{event_type}", detail={"journal_id": journal_id, **(detail or {})})
        return ev

    def record_close(
        self,
        journal_id: str,
        exit_price: float,
        pnl_usd: float,
        pnl_pct: float,
        result: str,
        reason: str = "manual",
    ) -> JournalEntry | None:
        entry = next((j for j in self.store.journal if j.journal_id == journal_id), None)
        if not entry:
            return None
        entry.exit_price = exit_price
        entry.pnl_usd = pnl_usd
        entry.pnl_pct = pnl_pct
        entry.result = result
        entry.closed_at = utc_now()
        entry.timeline.append(
            TimelineEvent(event_type="trade_closed", detail={"exit": exit_price, "pnl_usd": pnl_usd, "reason": reason})
        )
        self.audit.log("trade", "journal_close", detail={"journal_id": journal_id, "pnl_usd": pnl_usd})
        return entry

    def find_by_position(self, position_id: str) -> JournalEntry | None:
        for j in self.store.journal:
            for ev in j.timeline:
                if ev.position_id == position_id:
                    return j
        return None

    def sync_from_engines(self) -> int:
        """Import closed trades from paper/live engines into journal."""
        count = 0
        existing_ids = {j.trade_id for j in self.store.journal if j.trade_id}

        from app.live_trading.engine import get_live_engine
        from app.paper_trading.engine import get_paper_engine

        for trade in get_paper_engine().store.get_trades(500):
            if trade.trade_id in existing_ids:
                continue
            self.store.journal.append(
                JournalEntry(
                    trade_id=trade.trade_id,
                    source="paper",
                    symbol=trade.symbol,
                    direction=trade.direction,
                    strategy_name=trade.strategy_name,
                    signal_id=trade.signal_id,
                    entry_price=trade.entry_price,
                    exit_price=trade.exit_price,
                    sl=trade.stop_loss,
                    pnl_usd=trade.pnl_usd,
                    pnl_pct=trade.pnl_pct,
                    result=trade.result,
                    closed_at=trade.closed_at,
                    timeline=[
                        TimelineEvent(event_type="trade_opened", detail={"entry": trade.entry_price}),
                        TimelineEvent(event_type="trade_closed", detail={"exit": trade.exit_price, "reason": trade.close_reason}),
                    ],
                )
            )
            count += 1

        for trade in get_live_engine().store.get_trades(500):
            if trade.trade_id in existing_ids:
                continue
            self.store.journal.append(
                JournalEntry(
                    trade_id=trade.trade_id,
                    source="live",
                    symbol=trade.symbol,
                    direction=trade.direction,
                    strategy_name=trade.strategy_name,
                    signal_id=trade.signal_id,
                    entry_price=trade.entry_price,
                    exit_price=trade.exit_price,
                    sl=trade.stop_loss,
                    pnl_usd=trade.pnl_usd,
                    pnl_pct=trade.pnl_pct,
                    result=trade.result,
                    closed_at=trade.closed_at,
                    timeline=[
                        TimelineEvent(event_type="trade_opened", detail={"entry": trade.entry_price}),
                        TimelineEvent(event_type="trade_closed", detail={"exit": trade.exit_price, "reason": trade.close_reason}),
                    ],
                )
            )
            count += 1
        return count
