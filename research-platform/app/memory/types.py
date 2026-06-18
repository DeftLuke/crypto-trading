"""Memory payload types and helpers."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_memory_id() -> str:
    return str(uuid4())


class MemoryWeights(BaseModel):
    memory_weight: float = 1.0
    success_score: float = 0.5
    confidence_score: float = 0.5
    usage_count: int = 0
    last_used: str | None = None


class BaseMemoryPayload(BaseModel):
    memory_id: str = Field(default_factory=new_memory_id)
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)
    text: str = ""
    tags: list[str] = Field(default_factory=list)
    weights: MemoryWeights = Field(default_factory=MemoryWeights)
    memory_rank: float = 0.0
    source: str = "system"
    user_id: str | None = None
    role: str | None = None

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class TradeMemory(BaseMemoryPayload):
    trade_id: str | None = None
    symbol: str = ""
    direction: str = ""
    timeframe: str = ""
    entry: float | None = None
    exit: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    leverage: float | None = None
    margin: float | None = None
    risk_pct: float | None = None
    profit_percent: float | None = None
    profit_usd: float | None = None
    result: str | None = None
    session: str | None = None
    indicators: dict[str, Any] = Field(default_factory=dict)
    smc_features: dict[str, Any] = Field(default_factory=dict)
    confluence_score: float | None = None
    strategy_name: str | None = None


class SignalMemory(BaseMemoryPayload):
    signal_id: str | None = None
    symbol: str = ""
    direction: str = ""
    confidence: float = 0.0
    timeframe: str = ""
    conditions: dict[str, Any] = Field(default_factory=dict)
    indicator_state: dict[str, Any] = Field(default_factory=dict)
    market_context: dict[str, Any] = Field(default_factory=dict)
    smc_state: dict[str, Any] = Field(default_factory=dict)
    outcome: str | None = None


class BacktestMemory(BaseMemoryPayload):
    backtest_id: str | None = None
    strategy: str = ""
    parameters: dict[str, Any] = Field(default_factory=dict)
    date_range: dict[str, str] = Field(default_factory=dict)
    profit_factor: float | None = None
    sharpe: float | None = None
    drawdown: float | None = None
    win_rate: float | None = None
    expectancy: float | None = None
    final_score: float | None = None


class StrategyMemory(BaseMemoryPayload):
    strategy_name: str = ""
    version: str = "1.0"
    rules: list[str] = Field(default_factory=list)
    performance: dict[str, Any] = Field(default_factory=dict)
    deployment_history: list[dict[str, Any]] = Field(default_factory=list)
    improvement_history: list[dict[str, Any]] = Field(default_factory=list)
    status: str = "draft"


class ReflectionMemory(BaseMemoryPayload):
    observation: str = ""
    evidence: str = ""
    confidence: float = 0.5
    category: str = "general"
    related_symbols: list[str] = Field(default_factory=list)


class PatternMemory(BaseMemoryPayload):
    pattern_name: str = ""
    conditions: list[str] = Field(default_factory=list)
    win_rate: float | None = None
    profit_factor: float | None = None
    trade_count: int = 0
    avg_profit: float | None = None
    session: str | None = None


class RiskMemory(BaseMemoryPayload):
    event_type: str = ""
    severity: str = "medium"
    description: str = ""
    exposure: float | None = None
    drawdown: float | None = None


class AgentStateMemory(BaseMemoryPayload):
    state_key: str = "default"
    learning_state: dict[str, Any] = Field(default_factory=dict)
    best_setups: list[dict[str, Any]] = Field(default_factory=list)
    worst_setups: list[dict[str, Any]] = Field(default_factory=list)
    risk_conditions: dict[str, Any] = Field(default_factory=dict)
    strategy_rankings: list[dict[str, Any]] = Field(default_factory=list)
    recent_discoveries: list[str] = Field(default_factory=list)


def build_search_text(data: dict[str, Any]) -> str:
    """Flatten memory dict into embeddable text."""
    skip = {"memory_id", "created_at", "updated_at", "weights", "memory_rank", "text"}
    parts: list[str] = []
    for key, val in data.items():
        if key in skip or val is None:
            continue
        if isinstance(val, (dict, list)):
            parts.append(f"{key}: {json.dumps(val, default=str)}")
        else:
            parts.append(f"{key}: {val}")
    return " | ".join(parts)
