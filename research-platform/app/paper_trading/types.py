"""Phase 7 — Paper trading domain types."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class OrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_MARKET = "stop_market"
    TAKE_PROFIT = "take_profit"
    TRAILING = "trailing"


class OrderStatus(str, Enum):
    PENDING = "pending"
    FILLED = "filled"
    PARTIAL = "partial"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class PositionStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"


class SignalIntake(BaseModel):
    symbol: str
    direction: str
    confidence: float = 0.0
    entry: float | None = None
    sl: float | None = None
    tp1: float | None = None
    tp2: float | None = None
    tp3: str | float | None = None
    strategy_name: str = "manual"
    signal_id: str | None = None
    session: str | None = None
    smc: dict[str, Any] = Field(default_factory=dict)
    indicators: dict[str, Any] = Field(default_factory=dict)
    source: str = "signal_engine"


class PaperAccount(BaseModel):
    account_id: str = Field(default_factory=new_id)
    name: str = "Default Paper"
    balance: float = 1000.0
    equity: float = 1000.0
    margin_used: float = 0.0
    unrealized_pnl: float = 0.0
    daily_pnl: float = 0.0
    created_at: datetime = Field(default_factory=utc_now)


class PaperOrder(BaseModel):
    order_id: str = Field(default_factory=new_id)
    account_id: str
    symbol: str
    direction: str
    order_type: OrderType = OrderType.MARKET
    quantity: float = 0.0
    price: float | None = None
    stop_price: float | None = None
    status: OrderStatus = OrderStatus.PENDING
    filled_price: float | None = None
    filled_qty: float = 0.0
    slippage_bps: float = 0.0
    latency_ms: int = 0
    created_at: datetime = Field(default_factory=utc_now)


class PaperPosition(BaseModel):
    position_id: str = Field(default_factory=new_id)
    account_id: str
    symbol: str
    direction: str
    strategy_name: str = "manual"
    signal_id: str | None = None
    entry_price: float
    current_price: float = 0.0
    quantity: float = 0.0
    notional: float = 0.0
    leverage: int = 10
    margin: float = 0.0
    stop_loss: float | None = None
    take_profit: float | None = None
    tp1: float | None = None
    tp2: float | None = None
    trailing_stop: float | None = None
    tp1_hit: bool = False
    tp2_hit: bool = False
    unrealized_pnl: float = 0.0
    roe_pct: float = 0.0
    liquidation_price: float | None = None
    status: PositionStatus = PositionStatus.OPEN
    session: str | None = None
    confidence: float = 0.0
    smc: dict[str, Any] = Field(default_factory=dict)
    indicators: dict[str, Any] = Field(default_factory=dict)
    opened_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class PaperTrade(BaseModel):
    trade_id: str = Field(default_factory=new_id)
    account_id: str
    position_id: str
    signal_id: str | None = None
    strategy_name: str
    symbol: str
    direction: str
    entry_price: float
    exit_price: float
    quantity: float
    leverage: int
    margin: float
    stop_loss: float | None = None
    take_profit: float | None = None
    pnl_usd: float = 0.0
    pnl_pct: float = 0.0
    roe_pct: float = 0.0
    duration_sec: int = 0
    session: str | None = None
    confidence: float = 0.0
    smc: dict[str, Any] = Field(default_factory=dict)
    indicators: dict[str, Any] = Field(default_factory=dict)
    result: str = "WIN"
    close_reason: str = "manual"
    opened_at: datetime = Field(default_factory=utc_now)
    closed_at: datetime = Field(default_factory=utc_now)


class StrategyValidation(BaseModel):
    validation_id: str = Field(default_factory=new_id)
    strategy_name: str
    verdict: str  # pass | warning | reject
    approval_score: float = 0.0
    trade_count: int = 0
    win_rate: float = 0.0
    profit_factor: float = 0.0
    sharpe: float = 0.0
    sortino: float = 0.0
    max_drawdown_pct: float = 0.0
    notes: list[str] = Field(default_factory=list)
    evaluated_at: datetime = Field(default_factory=utc_now)


class RiskEvent(BaseModel):
    event_id: str = Field(default_factory=new_id)
    account_id: str
    event_type: str
    severity: str = "medium"
    message: str
    created_at: datetime = Field(default_factory=utc_now)


class PortfolioSnapshot(BaseModel):
    snapshot_id: str = Field(default_factory=new_id)
    account_id: str
    balance: float
    equity: float
    open_positions: int
    daily_pnl: float
    ts: datetime = Field(default_factory=utc_now)
