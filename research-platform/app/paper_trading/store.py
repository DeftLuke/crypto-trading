"""In-memory paper trading store."""

from __future__ import annotations

from app.paper_trading.types import (
    PaperAccount,
    PaperOrder,
    PaperPosition,
    PaperTrade,
    PortfolioSnapshot,
    RiskEvent,
    StrategyValidation,
)


class PaperStore:
    def __init__(self) -> None:
        self.accounts: dict[str, PaperAccount] = {}
        self.orders: dict[str, PaperOrder] = {}
        self.positions: dict[str, PaperPosition] = {}
        self.trades: list[PaperTrade] = []
        self.validations: dict[str, StrategyValidation] = {}
        self.approvals: dict[str, dict] = {}
        self.risk_events: list[RiskEvent] = []
        self.snapshots: list[PortfolioSnapshot] = []
        self.daily_stats: dict[str, dict] = {}
        self.strategy_metrics: dict[str, dict] = {}

    def get_open_positions(self, account_id: str | None = None) -> list[PaperPosition]:
        pos = [p for p in self.positions.values() if p.status.value == "open"]
        if account_id:
            pos = [p for p in pos if p.account_id == account_id]
        return pos

    def get_trades(self, limit: int = 500, strategy: str | None = None) -> list[PaperTrade]:
        trades = self.trades
        if strategy:
            trades = [t for t in trades if t.strategy_name == strategy]
        return sorted(trades, key=lambda t: t.closed_at, reverse=True)[:limit]
