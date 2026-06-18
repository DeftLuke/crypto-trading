"""Phase 8 — Institutional live trading engine."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Any, Callable

from app.core.config import get_settings
from app.core.logging import get_logger
from app.live_trading.authorization.strategy_gate import StrategyGate
from app.live_trading.exchanges.binance import BinanceFuturesExchange
from app.live_trading.execution.executor import OrderExecutor
from app.live_trading.feedback.memory_loop import notify_telegram, on_live_trade_closed
from app.live_trading.monitoring.health import LiveHealthMonitor
from app.live_trading.performance.analytics import LivePerformanceAnalytics
from app.live_trading.portfolio.sync import PortfolioSync
from app.live_trading.positions.trailing import LiveTrailingEngine
from app.live_trading.risk.engine import LiveRiskEngine
from app.live_trading.store import LiveStore
from app.live_trading.types import (
    LiveAccount,
    LiveOrder,
    LiveOrderStatus,
    LiveOrderType,
    LivePosition,
    LiveSignal,
    LiveTrade,
    utc_now,
)
from app.paper_trading.market_data.feed import get_market_feed
from app.paper_trading.portfolio.sizing import PositionSizer

logger = get_logger("live_trading.engine")


class LiveTradingEngine:
    def __init__(self) -> None:
        self.store = LiveStore()
        self.settings = get_settings()
        self.exchange = BinanceFuturesExchange()
        self.executor = OrderExecutor(self.exchange)
        self.risk = LiveRiskEngine(self.store)
        self.gate = StrategyGate()
        self.sizer = PositionSizer()
        self.trailing = LiveTrailingEngine()
        self.sync = PortfolioSync(self.store, self.exchange)
        self.analytics = LivePerformanceAnalytics()
        self.health_monitor = LiveHealthMonitor(self.store, self.exchange)
        self.feed = get_market_feed()
        self._running = False
        self._monitor_task: asyncio.Task | None = None
        self._ws_callbacks: list[Callable[[dict], None]] = []

    @property
    def default_account_id(self) -> str:
        if not self.store.accounts:
            acc = LiveAccount(label="Primary Live")
            self.store.accounts[acc.account_id] = acc
        return next(iter(self.store.accounts))

    async def start(self) -> dict[str, Any]:
        if not self.settings.live_enabled:
            return {"status": "disabled", "reason": "LIVE_ENABLED=false"}
        if self._running:
            return {"status": "already_running"}
        await self.exchange.connect()
        self.store.exchange_status["binance"] = self.exchange.status()
        await self.sync.sync_account(self.default_account_id)
        self.feed.subscribe(self._on_price_update)
        if not self.feed._running:
            await self.feed.start()
        self._running = True
        self._monitor_task = asyncio.create_task(self._monitor_loop())
        logger.info("Live trading engine started", extra={"dry_run": self.exchange.dry_run})
        return {
            "status": "started",
            "account_id": self.default_account_id,
            "dry_run": self.exchange.dry_run,
        }

    async def stop(self) -> dict[str, Any]:
        self._running = False
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        await self.exchange.close()
        self.store.exchange_status["binance"] = {"connected": False}
        return {"status": "stopped"}

    async def process_signal(self, signal: LiveSignal, account_id: str | None = None) -> dict[str, Any]:
        aid = account_id or self.default_account_id
        if not self._running:
            return {"accepted": False, "reason": "Engine not running — POST /live/start first"}

        ok, reason = self.gate.is_authorized(signal.strategy_name, signal.manual_override)
        if not ok:
            return {"accepted": False, "reason": reason}

        ok, reason = self.risk.validate_signal(aid, signal)
        if not ok:
            self.store.risk_events.append({"event": "signal_rejected", "reason": reason, "signal": signal.symbol})
            return {"accepted": False, "reason": reason}

        price = signal.entry
        if not price:
            try:
                price = await self.exchange.fetch_ticker(signal.symbol)
            except Exception:
                price = self.feed.get_price(signal.symbol)
        if not price:
            return {"accepted": False, "reason": f"No price for {signal.symbol}"}

        account = self.store.accounts.get(aid) or await self.sync.sync_account(aid)
        stop_dist = abs(price - signal.sl) / price * 100 if signal.sl and price else None
        qty, lev, margin = self.sizer.compute(
            account.equity or account.balance,
            price,
            mode=self.settings.live_sizing_mode,
            margin_pct=self.settings.live_margin_pct,
            leverage=min(self.settings.live_default_leverage, self.settings.live_max_leverage),
            stop_distance_pct=stop_dist,
        )
        if qty <= 0:
            return {"accepted": False, "reason": "Position size zero"}

        order = LiveOrder(
            account_id=aid,
            symbol=signal.symbol.upper(),
            direction=signal.direction.upper(),
            order_type=LiveOrderType.MARKET,
            quantity=qty,
            price=price,
            strategy_name=signal.strategy_name,
        )
        self.store.orders[order.order_id] = order

        try:
            order = await self.executor.submit(order, lev)
        except RuntimeError as e:
            order.status = LiveOrderStatus.REJECTED
            self.executor.log(self.store, "order_rejected", symbol=signal.symbol, error=str(e))
            if self.exchange.error_count >= self.settings.live_api_error_threshold:
                self.risk.trigger_circuit("Exchange API error threshold exceeded")
            return {"accepted": False, "reason": str(e)}

        fill = order.filled_price or price
        notional = fill * order.filled_qty
        pos = LivePosition(
            account_id=aid,
            symbol=signal.symbol.upper(),
            direction=signal.direction.upper(),
            strategy_name=signal.strategy_name,
            strategy_id=signal.strategy_id,
            signal_id=signal.signal_id,
            entry_price=fill,
            current_price=fill,
            quantity=order.filled_qty,
            notional=notional,
            leverage=lev,
            margin=margin,
            stop_loss=signal.sl,
            take_profit=signal.tp1 if isinstance(signal.tp1, (int, float)) else None,
            tp1=signal.tp1 if isinstance(signal.tp1, (int, float)) else None,
            tp2=signal.tp2 if isinstance(signal.tp2, (int, float)) else None,
            liquidation_price=self._liquidation_price(fill, signal.direction.upper(), lev),
        )
        self.store.positions[pos.position_id] = pos
        account.margin_used += margin

        self.executor.log(
            self.store,
            "order_filled",
            symbol=pos.symbol,
            strategy_name=pos.strategy_name,
            order_id=order.order_id,
            latency_ms=order.latency_ms,
        )
        self._broadcast({"type": "position_opened", "position": pos.model_dump(mode="json")})
        await notify_telegram(f"🔴 <b>LIVE OPEN</b> {pos.symbol} {pos.direction} @ {fill:.2f} (dry={self.exchange.dry_run})")

        return {
            "accepted": True,
            "position_id": pos.position_id,
            "order_id": order.order_id,
            "entry": fill,
            "leverage": lev,
            "dry_run": self.exchange.dry_run,
        }

    async def close_position(
        self,
        position_id: str,
        partial_pct: float = 100.0,
        reason: str = "manual",
    ) -> dict[str, Any]:
        pos = self.store.positions.get(position_id)
        if not pos or pos.status != "open":
            return {"closed": False, "reason": "Position not found or already closed"}

        try:
            price = await self.exchange.fetch_ticker(pos.symbol)
        except Exception:
            price = self.feed.get_price(pos.symbol) or pos.current_price

        close_qty = pos.quantity * (partial_pct / 100)
        close_dir = "SHORT" if pos.direction == "LONG" else "LONG"

        order = LiveOrder(
            account_id=pos.account_id,
            symbol=pos.symbol,
            direction=close_dir,
            order_type=LiveOrderType.MARKET,
            quantity=close_qty,
            reduce_only=True,
            strategy_name=pos.strategy_name,
        )
        try:
            order = await self.executor.submit(order, pos.leverage)
        except RuntimeError as e:
            return {"closed": False, "reason": str(e)}

        exit_price = order.filled_price or price
        pnl = self._calc_pnl(pos, exit_price, close_qty)
        account = self.store.accounts[pos.account_id]

        trade = LiveTrade(
            account_id=pos.account_id,
            position_id=pos.position_id,
            signal_id=pos.signal_id,
            strategy_name=pos.strategy_name,
            strategy_id=pos.strategy_id,
            exchange_order_ids=[oid for oid in [order.exchange_order_id] if oid],
            symbol=pos.symbol,
            direction=pos.direction,
            entry_price=pos.entry_price,
            exit_price=exit_price,
            quantity=close_qty,
            leverage=pos.leverage,
            margin=pos.margin * (partial_pct / 100),
            stop_loss=pos.stop_loss,
            take_profit=pos.take_profit,
            pnl_usd=pnl,
            pnl_pct=pnl / pos.margin * 100 if pos.margin else 0,
            roe_pct=pnl / pos.margin * 100 * pos.leverage if pos.margin else 0,
            slippage_bps=order.slippage_bps,
            execution_delay_ms=order.latency_ms,
            duration_sec=int((utc_now() - pos.opened_at).total_seconds()),
            result="WIN" if pnl > 0 else "LOSS",
            close_reason=reason,
            opened_at=pos.opened_at,
        )
        self.store.trades.append(trade)
        account.daily_pnl += pnl
        account.margin_used -= pos.margin * (partial_pct / 100)
        await self.sync.sync_account(pos.account_id)

        if partial_pct >= 100:
            pos.status = "closed"
        else:
            pos.quantity -= close_qty
            pos.margin *= 1 - partial_pct / 100
            pos.notional = pos.quantity * exit_price

        on_live_trade_closed(trade)
        self._broadcast({"type": "trade_closed", "trade": trade.model_dump(mode="json")})
        await notify_telegram(f"🔴 <b>LIVE CLOSE</b> {trade.symbol} {trade.result} PnL ${pnl:.2f} ({reason})")

        return {"closed": True, "trade_id": trade.trade_id, "pnl": pnl, "exit": exit_price}

    async def close_all(self, reason: str = "close_all") -> dict[str, Any]:
        results = []
        for pos in list(self.store.open_positions()):
            r = await self.close_position(pos.position_id, reason=reason)
            results.append({"position_id": pos.position_id, **r})
        return {"closed_count": sum(1 for r in results if r.get("closed")), "results": results}

    async def kill_switch(self) -> dict[str, Any]:
        self.risk.activate_kill_switch()
        close = await self.close_all(reason="kill_switch")
        await notify_telegram("🚨 <b>KILL SWITCH</b> activated — all positions closed")
        self._broadcast({"type": "kill_switch", "circuit": self.store.circuit.model_dump(mode="json")})
        return {"kill_switch": True, **close}

    async def move_sl(self, position_id: str, stop_loss: float) -> dict[str, Any]:
        pos = self.store.positions.get(position_id)
        if not pos or pos.status != "open":
            return {"ok": False, "reason": "Position not found"}
        pos.stop_loss = stop_loss
        pos.updated_at = utc_now()
        return {"ok": True, "stop_loss": stop_loss}

    async def move_tp(self, position_id: str, take_profit: float) -> dict[str, Any]:
        pos = self.store.positions.get(position_id)
        if not pos or pos.status != "open":
            return {"ok": False, "reason": "Position not found"}
        pos.take_profit = take_profit
        pos.tp1 = take_profit
        pos.updated_at = utc_now()
        return {"ok": True, "take_profit": take_profit}

    def pause(self) -> dict[str, Any]:
        self.risk.pause_trading()
        return {"paused": True}

    def resume(self) -> dict[str, Any]:
        self.risk.resume_trading()
        return {"paused": False}

    def disable_strategy(self, strategy_name: str) -> dict[str, Any]:
        self.risk.disable_strategy(strategy_name)
        return {"disabled": strategy_name}

    def reset_circuit(self) -> dict[str, Any]:
        self.risk.reset_circuit()
        return {"reset": True}

    def _on_price_update(self, symbol: str, price: float) -> None:
        if not self._running:
            return
        for pos in self.store.open_positions():
            if pos.symbol != symbol:
                continue
            prev_sl = pos.stop_loss
            self.trailing.update(pos, price)
            if pos.stop_loss != prev_sl and pos.tp1_hit:
                asyncio.create_task(
                    notify_telegram(f"📈 <b>Trailing SL</b> {pos.symbol} → {pos.stop_loss:.2f}")
                )
            should_close, reason = self.trailing.should_close(pos, price)
            if should_close:
                asyncio.create_task(self.close_position(pos.position_id, reason=reason))

    async def _monitor_loop(self) -> None:
        interval = self.settings.live_monitor_interval_sec
        while self._running:
            try:
                aid = self.default_account_id
                await self.sync.sync_account(aid)
                self.risk.check_drawdown(aid)
                self.store.exchange_status["binance"] = self.exchange.status()
                for pos in self.store.open_positions(aid):
                    try:
                        px = await self.exchange.fetch_ticker(pos.symbol)
                        self.trailing.update(pos, px)
                    except Exception:
                        pass
                snap = self.portfolio_snapshot(aid)
                self.store.snapshots.append(snap)
                self._broadcast({"type": "portfolio", "snapshot": snap})
            except Exception as e:
                logger.warning("Live monitor error", extra={"error": str(e)})
            await asyncio.sleep(interval)

    def portfolio_snapshot(self, account_id: str | None = None) -> dict[str, Any]:
        aid = account_id or self.default_account_id
        acc = self.store.accounts.get(aid)
        open_pos = self.store.open_positions(aid)
        unrealized = sum(p.unrealized_pnl for p in open_pos)
        if acc:
            acc.unrealized_pnl = unrealized
            acc.equity = acc.balance + unrealized
        exposure = sum(p.notional for p in open_pos)
        max_exp = (acc.equity * self.settings.live_max_exposure_pct / 100) if acc else 1
        return {
            "account_id": aid,
            "equity": acc.equity if acc else 0,
            "balance": acc.balance if acc else 0,
            "available": acc.available if acc else 0,
            "margin_used": acc.margin_used if acc else 0,
            "unrealized_pnl": unrealized,
            "open_positions": len(open_pos),
            "exposure": exposure,
            "risk_utilization_pct": round(exposure / max_exp * 100, 2) if max_exp else 0,
            "ts": utc_now().isoformat(),
        }

    def _calc_pnl(self, pos: LivePosition, price: float, qty: float) -> float:
        if pos.direction == "LONG":
            return (price - pos.entry_price) * qty
        return (pos.entry_price - price) * qty

    def _liquidation_price(self, entry: float, direction: str, leverage: int) -> float:
        liq_pct = 0.95 / max(leverage, 1)
        if direction == "LONG":
            return entry * (1 - liq_pct)
        return entry * (1 + liq_pct)

    def subscribe_ws(self, callback: Callable[[dict], None]) -> None:
        self._ws_callbacks.append(callback)

    def _broadcast(self, msg: dict) -> None:
        for cb in self._ws_callbacks:
            try:
                cb(msg)
            except Exception:
                pass

    def health(self) -> dict[str, Any]:
        return self.health_monitor.status(self._running)

    def execution_stats(self) -> dict[str, Any]:
        logs = self.store.execution_logs
        filled = [l for l in logs if l.event == "order_filled"]
        rejected = [l for l in logs if l.event == "order_rejected"]
        latencies = [l.latency_ms for l in filled if l.latency_ms]
        return {
            "total_orders": len(logs),
            "fill_rate_pct": round(len(filled) / max(len(filled) + len(rejected), 1) * 100, 2),
            "rejections": len(rejected),
            "avg_latency_ms": round(sum(latencies) / len(latencies), 1) if latencies else 0,
            "api_errors": self.exchange.error_count,
        }


@lru_cache
def get_live_engine() -> LiveTradingEngine:
    return LiveTradingEngine()
