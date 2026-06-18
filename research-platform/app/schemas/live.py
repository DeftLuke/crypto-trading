"""Phase 8 live trading API schemas."""

from typing import Any

from pydantic import BaseModel, Field


class LiveSignalRequest(BaseModel):
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
    source: str = "dashboard"
    manual_override: bool = True
    account_id: str | None = None
    smc: dict[str, Any] = Field(default_factory=dict)
    indicators: dict[str, Any] = Field(default_factory=dict)


class LiveCloseRequest(BaseModel):
    position_id: str
    partial_pct: float = 100.0
    reason: str = "manual"


class LiveMoveSlRequest(BaseModel):
    position_id: str
    stop_loss: float


class LiveMoveTpRequest(BaseModel):
    position_id: str
    take_profit: float


class LiveDisableStrategyRequest(BaseModel):
    strategy_name: str
