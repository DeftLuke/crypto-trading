"""Phase 10 control center API schemas."""

from pydantic import BaseModel, Field


class ServiceActionRequest(BaseModel):
    actor: str = "admin"


class SettingsUpdateRequest(BaseModel):
    mode: str | None = None  # demo | live
    auto_trading: bool | None = None
    manual_approval: bool | None = None
    default_exchange: str | None = None
    confirm_live: bool | None = None
    actor: str = "admin"


class SignalExecuteRequest(BaseModel):
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
    source: str = "signal_engine"
    manual_override: bool = False


class ApprovalActionRequest(BaseModel):
    approval_id: str
    passcode: str = ""
    actor: str = "user"


class EmergencyActionRequest(BaseModel):
    actor: str = "admin"
    exchange_id: str | None = None
