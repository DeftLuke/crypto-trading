"""Phase 7 paper trading API schemas."""

from typing import Any

from pydantic import BaseModel, Field


class PaperSignalRequest(BaseModel):
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
    source: str = "dashboard"
    account_id: str | None = None


class PaperCloseRequest(BaseModel):
    position_id: str
    partial_pct: float = 100.0
    reason: str = "manual"


class PaperMoveSlRequest(BaseModel):
    position_id: str
    stop_loss: float


class PaperMoveTpRequest(BaseModel):
    position_id: str
    take_profit: float
