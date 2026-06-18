"""Phase 8 — Live trading domain types."""

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


class LiveOrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_MARKET = "stop_market"
    TAKE_PROFIT = "take_profit"
    TAKE_PROFIT_MARKET = "take_profit_market"
    TRAILING = "trailing"


class LiveOrderStatus(str, Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    PARTIAL = "partial"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class LiveSignal(BaseModel):
    symbol: str
    direction: str
    confidence: float = 0.0
    entry: float | None = None
    sl: float | None = None
    tp1: float | None = None
    tp2: float | None = None
    tp3: str | float | None = None
    strategy_name: str = "manual"
    strategy_id: str | None = None
    signal_id: str | None = None
    session: str | None = None
    smc: dict[str, Any] = Field(default_factory=dict)
    indicators: dict[str, Any] = Field(default_factory=dict)
    source: str = "signal_engine"
    manual_override: bool = False


class LiveAccount(BaseModel):
    account_id: str = Field(default_factory=new_id)
    exchange: str = "binance"
    label: str = "Primary"
    balance: float = 0.0
    available: float = 0.0
    equity: float = 0.0
    margin_used: float = 0.0
    unrealized_pnl: float = 0.0
    daily_pnl: float = 0.0
    updated_at: datetime = Field(default_factory=utc_now)


class LiveOrder(BaseModel):
    order_id: str = Field(default_factory=new_id)
    exchange_order_id: str | None = None
    account_id: str
    symbol: str
    direction: str
    order_type: LiveOrderType = LiveOrderType.MARKET
    quantity: float = 0.0
    price: float | None = None
    stop_price: float | None = None
    status: LiveOrderStatus = LiveOrderStatus.PENDING
    filled_price: float | None = None
    filled_qty: float = 0.0
    slippage_bps: float = 0.0
    latency_ms: int = 0
    strategy_name: str = "manual"
    reduce_only: bool = False
    created_at: datetime = Field(default_factory=utc_now)


class LivePosition(BaseModel):
    position_id: str = Field(default_factory=new_id)
    account_id: str
    symbol: str
    direction: str
    strategy_name: str = "manual"
    strategy_id: str | None = None
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
    funding_impact: float = 0.0
    status: str = "open"
    exchange: str = "binance"
    opened_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class LiveTrade(BaseModel):
    trade_id: str = Field(default_factory=new_id)
    account_id: str
    position_id: str
    signal_id: str | None = None
    strategy_name: str
    strategy_id: str | None = None
    exchange_order_ids: list[str] = Field(default_factory=list)
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
    fees: float = 0.0
    funding: float = 0.0
    duration_sec: int = 0
    slippage_bps: float = 0.0
    execution_delay_ms: int = 0
    result: str = "WIN"
    close_reason: str = "manual"
    opened_at: datetime = Field(default_factory=utc_now)
    closed_at: datetime = Field(default_factory=utc_now)


class ExecutionLog(BaseModel):
    log_id: str = Field(default_factory=new_id)
    event: str
    symbol: str | None = None
    strategy_name: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)
    latency_ms: int = 0
    ts: datetime = Field(default_factory=utc_now)


class CircuitBreakerState(BaseModel):
    active: bool = False
    reason: str = ""
    triggered_at: datetime | None = None
    kill_switch: bool = False
    trading_paused: bool = False
    disabled_strategies: list[str] = Field(default_factory=list)
