"""Live trading in-memory store."""

from __future__ import annotations

from app.live_trading.types import (
    CircuitBreakerState,
    ExecutionLog,
    LiveAccount,
    LiveOrder,
    LivePosition,
    LiveTrade,
)


class LiveStore:
    def __init__(self) -> None:
        self.accounts: dict[str, LiveAccount] = {}
        self.orders: dict[str, LiveOrder] = {}
        self.positions: dict[str, LivePosition] = {}
        self.trades: list[LiveTrade] = []
        self.execution_logs: list[ExecutionLog] = []
        self.risk_events: list[dict] = []
        self.snapshots: list[dict] = []
        self.exchange_status: dict[str, dict] = {"binance": {"connected": False, "latency_ms": 0}}
        self.deployments: dict[str, dict] = {}
        self.circuit: CircuitBreakerState = CircuitBreakerState()
        self.strategy_metrics: dict[str, dict] = {}
        self._peak_equity: dict[str, float] = {}

    def open_positions(self, account_id: str | None = None) -> list[LivePosition]:
        pos = [p for p in self.positions.values() if p.status == "open"]
        if account_id:
            pos = [p for p in pos if p.account_id == account_id]
        return pos

    def get_trades(self, limit: int = 500, strategy: str | None = None) -> list[LiveTrade]:
        trades = self.trades
        if strategy:
            trades = [t for t in trades if t.strategy_name == strategy]
        return sorted(trades, key=lambda t: t.closed_at, reverse=True)[:limit]
