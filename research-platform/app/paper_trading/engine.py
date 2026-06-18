"""Main paper trading engine — signal intake, execution, monitoring."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Any, Callable

from app.core.config import get_settings
from app.core.logging import get_logger
from app.paper_trading.execution.simulator import ExecutionSimulator
from app.paper_trading.feedback.memory_loop import notify_telegram, on_trade_closed
from app.paper_trading.market_data.feed import get_market_feed
from app.paper_trading.performance.analytics import PerformanceAnalytics
from app.paper_trading.portfolio.sizing import PositionSizer
from app.paper_trading.positions.trailing import TrailingStopEngine
from app.paper_trading.risk.engine import RiskEngine
from app.paper_trading.store import PaperStore
from app.paper_trading.types import (
    OrderType,
    PaperAccount,
    PaperOrder,
    PaperPosition,
    PaperTrade,
    PortfolioSnapshot,
    PositionStatus,
    SignalIntake,
    utc_now,
)
from app.paper_trading.validation.engine import ValidationEngine

logger = get_logger("paper_trading.engine")


class PaperTradingEngine:
    def __init__(self) -> None:
        self.store = PaperStore()
        self.settings = get_settings()
        self.risk = RiskEngine(self.store)
        self.sizer = PositionSizer()
        self.executor = ExecutionSimulator()
        self.trailing = TrailingStopEngine()
        self.analytics = PerformanceAnalytics()
        self.validation = ValidationEngine()
        self.feed = get_market_feed()
        self._running = False
        self._monitor_task: asyncio.Task | None = None
        self._peak_equity: dict[str, float] = {}
        self._ws_callbacks: list[Callable[[dict], None]] = []
        self._ensure_default_account()

    def _ensure_default_account(self) -> None:
        if not self.store.accounts:
            acc = PaperAccount(name="Default Paper", balance=self.settings.paper_default_balance, equity=self.settings.paper_default_balance)
            self.store.accounts[acc.account_id] = acc
            self._peak_equity[acc.account_id] = acc.equity

    @property
    def default_account_id(self) -> str:
        return next(iter(self.store.accounts))

    async def start(self) -> dict[str, Any]:
        if self._running:
            return {"status": "already_running"}
        self._running = True
        self.feed.subscribe(self._on_price_update)
        await self.feed.start()
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        logger.info("Paper trading engine started")
        return {"status": "started", "account_id": self.default_account_id}

    async def stop(self) -> dict[str, Any]:
        self._running = False
        await self.feed.stop()
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        return {"status": "stopped"}

    async def process_signal(self, signal: SignalIntake, account_id: str | None = None) -> dict[str, Any]:
        aid = account_id or self.default_account_id
        ok, reason = self.risk.validate_signal(aid, signal)
        if not ok:
            return {"accepted": False, "reason": reason}

        price = signal.entry or self.feed.get_price(signal.symbol)
        if not price:
            return {"accepted": False, "reason": f"No price for {signal.symbol}"}

        account = self.store.accounts[aid]
        stop_dist = None
        if signal.sl and price:
            stop_dist = abs(price - signal.sl) / price * 100

        qty, lev, margin = self.sizer.compute(
            account.balance,
            price,
            mode=self.settings.paper_sizing_mode,
            margin_pct=self.settings.paper_margin_pct,
            leverage=self.settings.paper_default_leverage,
            stop_distance_pct=stop_dist,
        )

        order = PaperOrder(
            account_id=aid,
            symbol=signal.symbol.upper(),
            direction=signal.direction.upper(),
            order_type=OrderType.MARKET,
            quantity=qty,
            price=price,
        )
        order = self.executor.simulate_fill(order, price, signal.direction.upper())
        if order.status.value in ("rejected",):
            return {"accepted": False, "reason": "Order rejected by simulator"}

        fill = order.filled_price or price
        notional = fill * order.filled_qty
        pos = PaperPosition(
            account_id=aid,
            symbol=signal.symbol.upper(),
            direction=signal.direction.upper(),
            strategy_name=signal.strategy_name,
            signal_id=signal.signal_id,
            entry_price=fill,
            current_price=fill,
            quantity=order.filled_qty,
            notional=notional,
            leverage=lev,
            margin=margin,
            stop_loss=signal.sl,
            take_profit=signal.tp1,
            tp1=signal.tp1,
            tp2=signal.tp2 if isinstance(signal.tp2, (int, float)) else None,
            session=signal.session,
            confidence=signal.confidence,
            smc=signal.smc,
            indicators=signal.indicators,
        )
        pos.liquidation_price = self._liquidation_price(pos)

        self.store.orders[order.order_id] = order
        self.store.positions[pos.position_id] = pos
        account.margin_used += margin
        account.balance -= margin

        self._broadcast({"type": "position_opened", "position": pos.model_dump(mode="json")})
        await notify_telegram(f"📄 <b>Paper OPEN</b> {pos.symbol} {pos.direction} @ {fill:.2f}")

        return {"accepted": True, "position_id": pos.position_id, "entry": fill, "leverage": lev}

    async def close_position(self, position_id: str, partial_pct: float = 100.0, reason: str = "manual") -> dict[str, Any]:
        pos = self.store.positions.get(position_id)
        if not pos or pos.status != PositionStatus.OPEN:
            return {"closed": False, "reason": "Position not found or already closed"}

        price = self.feed.get_price(pos.symbol) or pos.current_price
        close_qty = pos.quantity * (partial_pct / 100)
        pnl = self._calc_pnl(pos, price, close_qty)
        account = self.store.accounts[pos.account_id]

        trade = PaperTrade(
            account_id=pos.account_id,
            position_id=pos.position_id,
            signal_id=pos.signal_id,
            strategy_name=pos.strategy_name,
            symbol=pos.symbol,
            direction=pos.direction,
            entry_price=pos.entry_price,
            exit_price=price,
            quantity=close_qty,
            leverage=pos.leverage,
            margin=pos.margin * (partial_pct / 100),
            stop_loss=pos.stop_loss,
            take_profit=pos.take_profit,
            pnl_usd=pnl,
            pnl_pct=pnl / pos.margin * 100 if pos.margin else 0,
            roe_pct=pnl / pos.margin * 100 * pos.leverage if pos.margin else 0,
            duration_sec=int((utc_now() - pos.opened_at).total_seconds()),
            session=pos.session,
            confidence=pos.confidence,
            smc=pos.smc,
            indicators=pos.indicators,
            result="WIN" if pnl > 0 else "LOSS",
            close_reason=reason,
            opened_at=pos.opened_at,
        )
        self.store.trades.append(trade)

        account.balance += pos.margin * (partial_pct / 100) + pnl
        account.margin_used -= pos.margin * (partial_pct / 100)
        account.daily_pnl += pnl
        account.equity = account.balance + self._unrealized(pos.account_id)
        self._peak_equity[pos.account_id] = max(self._peak_equity.get(pos.account_id, account.equity), account.equity)

        if partial_pct >= 100:
            pos.status = PositionStatus.CLOSED
        else:
            pos.quantity -= close_qty
            pos.margin *= (1 - partial_pct / 100)
            pos.notional = pos.quantity * price

        on_trade_closed(trade)
        self._update_strategy_metrics(trade)
        self._broadcast({"type": "trade_closed", "trade": trade.model_dump(mode="json")})
        await notify_telegram(f"📄 <b>Paper CLOSE</b> {trade.symbol} {trade.result} PnL ${pnl:.2f}")

        return {"closed": True, "trade_id": trade.trade_id, "pnl": pnl}

    def move_sl(self, position_id: str, new_sl: float) -> dict[str, Any]:
        pos = self.store.positions.get(position_id)
        if not pos or pos.status != PositionStatus.OPEN:
            return {"ok": False}
        pos.stop_loss = new_sl
        return {"ok": True, "stop_loss": new_sl}

    def move_tp(self, position_id: str, new_tp: float) -> dict[str, Any]:
        pos = self.store.positions.get(position_id)
        if not pos or pos.status != PositionStatus.OPEN:
            return {"ok": False}
        pos.take_profit = new_tp
        pos.tp1 = new_tp
        return {"ok": True, "take_profit": new_tp}

    def _on_price_update(self, symbol: str, price: float) -> None:
        for pos in self.store.get_open_positions():
            if pos.symbol != symbol:
                continue
            self.trailing.update(pos, price)
            pos.unrealized_pnl = self._calc_pnl(pos, price, pos.quantity)
            pos.roe_pct = pos.unrealized_pnl / pos.margin * 100 * pos.leverage if pos.margin else 0
            should_close, reason = self.trailing.should_close(pos, price)
            if should_close:
                asyncio.create_task(self.close_position(pos.position_id, reason=reason))

    async def _monitor_loop(self) -> None:
        while self._running:
            try:
                for acc_id, acc in self.store.accounts.items():
                    acc.unrealized_pnl = self._unrealized(acc_id)
                    acc.equity = acc.balance + acc.unrealized_pnl + acc.margin_used
                    self.risk.check_drawdown(acc_id, self._peak_equity.get(acc_id, acc.equity))
                    self.store.snapshots.append(
                        PortfolioSnapshot(
                            account_id=acc_id,
                            balance=acc.balance,
                            equity=acc.equity,
                            open_positions=len(self.store.get_open_positions(acc_id)),
                            daily_pnl=acc.daily_pnl,
                        )
                    )
                self._broadcast({"type": "portfolio", "accounts": [a.model_dump(mode="json") for a in self.store.accounts.values()]})
            except Exception as e:
                logger.warning("Monitor loop error", extra={"error": str(e)})
            await asyncio.sleep(2)

    def _calc_pnl(self, pos: PaperPosition, price: float, qty: float) -> float:
        if pos.direction == "LONG":
            return (price - pos.entry_price) * qty
        return (pos.entry_price - price) * qty

    def _unrealized(self, account_id: str) -> float:
        return sum(p.unrealized_pnl for p in self.store.get_open_positions(account_id))

    def _liquidation_price(self, pos: PaperPosition) -> float:
        liq_pct = 0.95 / pos.leverage
        if pos.direction == "LONG":
            return pos.entry_price * (1 - liq_pct)
        return pos.entry_price * (1 + liq_pct)

    def _update_strategy_metrics(self, trade: PaperTrade) -> None:
        strat = trade.strategy_name
        trades = [t for t in self.store.trades if t.strategy_name == strat]
        self.store.strategy_metrics[strat] = self.analytics.compute(trades)
        val = self.validation.evaluate(strat, trades)
        self.store.validations[strat] = val
        if val.verdict == "pass":
            self.store.approvals[strat] = {"approved": True, "score": val.approval_score, "at": val.evaluated_at.isoformat()}

    def subscribe_ws(self, callback: Callable[[dict], None]) -> None:
        self._ws_callbacks.append(callback)

    def _broadcast(self, msg: dict) -> None:
        for cb in self._ws_callbacks:
            try:
                cb(msg)
            except Exception:
                pass

    def health(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "feed_healthy": self.feed.healthy,
            "accounts": len(self.store.accounts),
            "open_positions": len(self.store.get_open_positions()),
            "total_trades": len(self.store.trades),
            "circuit_breaker": self.risk.circuit_breaker,
        }


@lru_cache
def get_paper_engine() -> PaperTradingEngine:
    return PaperTradingEngine()
