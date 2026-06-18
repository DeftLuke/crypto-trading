"""Phase 10 — Enterprise control center domain types."""

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


class ServiceState(str, Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    PAUSED = "paused"
    RESTARTING = "restarting"
    FAILED = "failed"
    UPDATING = "updating"


class HealthState(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


class TradingMode(str, Enum):
    DEMO = "demo"
    LIVE = "live"


class PlatformService(BaseModel):
    service_id: str
    name: str
    phase: str
    state: ServiceState = ServiceState.STOPPED
    health: HealthState = HealthState.UNKNOWN
    version: str = "0.0.0"
    uptime_sec: int = 0
    last_run: datetime | None = None
    queue_size: int = 0
    error_count: int = 0
    cpu_pct: float = 0.0
    ram_mb: float = 0.0
    endpoint: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExchangeConnection(BaseModel):
    exchange_id: str
    label: str
    connected: bool = False
    api_ok: bool = False
    ws_ok: bool = False
    dry_run: bool = True
    latency_ms: int = 0
    error_rate_pct: float = 0.0
    error_count: int = 0
    balance: float = 0.0
    available: float = 0.0
    open_positions: int = 0
    open_orders: int = 0
    last_sync: datetime | None = None
    funding_rate: float | None = None


class TradingSettings(BaseModel):
    mode: TradingMode = TradingMode.DEMO
    auto_trading: bool = False
    manual_approval: bool = True
    approval_passcode_hash: str = ""
    default_exchange: str = "binance"
    notify_on_signal_only: bool = True
    updated_at: datetime = Field(default_factory=utc_now)


class PendingApproval(BaseModel):
    approval_id: str = Field(default_factory=new_id)
    signal_id: str | None = None
    symbol: str
    direction: str
    entry: float | None = None
    sl: float | None = None
    tp1: float | None = None
    tp2: float | None = None
    strategy_name: str = "manual"
    confidence: float = 0.0
    status: str = "pending"  # pending | approved | rejected | expired
    channel: str = "telegram"
    created_at: datetime = Field(default_factory=utc_now)
    expires_at: datetime | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class TimelineEvent(BaseModel):
    event_id: str = Field(default_factory=new_id)
    trade_id: str | None = None
    position_id: str | None = None
    event_type: str
    detail: dict[str, Any] = Field(default_factory=dict)
    ts: datetime = Field(default_factory=utc_now)


class JournalEntry(BaseModel):
    journal_id: str = Field(default_factory=new_id)
    trade_id: str | None = None
    source: str = "paper"  # paper | live | legacy
    symbol: str
    direction: str
    strategy_name: str = ""
    signal_id: str | None = None
    entry_price: float = 0.0
    exit_price: float | None = None
    sl: float | None = None
    tp1: float | None = None
    tp2: float | None = None
    tp3: str | float | None = None
    pnl_usd: float = 0.0
    pnl_pct: float = 0.0
    result: str = ""
    market_conditions: dict[str, Any] = Field(default_factory=dict)
    timeline: list[TimelineEvent] = Field(default_factory=list)
    opened_at: datetime = Field(default_factory=utc_now)
    closed_at: datetime | None = None


class PlatformAuditEntry(BaseModel):
    audit_id: str = Field(default_factory=new_id)
    category: str  # trade | user | ai | risk | workflow | system | strategy
    action: str
    actor: str = "system"
    role: str = "admin"
    detail: dict[str, Any] = Field(default_factory=dict)
    ip: str | None = None
    ts: datetime = Field(default_factory=utc_now)


class NotificationRecord(BaseModel):
    notification_id: str = Field(default_factory=new_id)
    channel: str
    event_type: str
    message: str
    delivered: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)
    ts: datetime = Field(default_factory=utc_now)
