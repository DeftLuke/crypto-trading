"""Live trading health monitoring."""

from __future__ import annotations

from typing import Any

from app.live_trading.exchanges.binance import BinanceFuturesExchange
from app.live_trading.store import LiveStore


class LiveHealthMonitor:
    def __init__(self, store: LiveStore, exchange: BinanceFuturesExchange) -> None:
        self.store = store
        self.exchange = exchange

    def status(self, running: bool) -> dict[str, Any]:
        cb = self.store.circuit
        return {
            "running": running,
            "exchange_connected": self.exchange.connected,
            "dry_run": self.exchange.dry_run,
            "exchange_latency_ms": self.exchange.last_latency_ms,
            "exchange_errors": self.exchange.error_count,
            "open_positions": len(self.store.open_positions()),
            "total_trades": len(self.store.trades),
            "circuit_breaker": cb.model_dump(mode="json"),
            "kill_switch": cb.kill_switch,
            "trading_paused": cb.trading_paused,
            "accounts": len(self.store.accounts),
        }
