"""Phase 5 memory API schemas."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.memory.collections import CollectionName


class MemoryStoreResponse(BaseModel):
    memory_id: str
    collection: str
    memory_rank: float = 0.0
    point_id: str | None = None


class TradeMemoryRequest(BaseModel):
    trade_id: str | None = None
    symbol: str
    direction: str
    timeframe: str = "15m"
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
    user_id: str | None = None
    role: str | None = None


class SignalMemoryRequest(BaseModel):
    signal_id: str | None = None
    symbol: str
    direction: str
    confidence: float = 0.0
    timeframe: str = "15m"
    conditions: dict[str, Any] = Field(default_factory=dict)
    indicator_state: dict[str, Any] = Field(default_factory=dict)
    market_context: dict[str, Any] = Field(default_factory=dict)
    smc_state: dict[str, Any] = Field(default_factory=dict)
    outcome: str | None = None


class BacktestMemoryRequest(BaseModel):
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


class ReflectionMemoryRequest(BaseModel):
    observation: str
    evidence: str = ""
    confidence: float = 0.5
    category: str = "general"
    related_symbols: list[str] = Field(default_factory=list)


class PatternMemoryRequest(BaseModel):
    pattern_name: str
    conditions: list[str] = Field(default_factory=list)
    win_rate: float | None = None
    profit_factor: float | None = None
    trade_count: int = 0
    avg_profit: float | None = None
    session: str | None = None


class StrategyMemoryRequest(BaseModel):
    strategy_name: str
    version: str = "1.0"
    rules: list[str] = Field(default_factory=list)
    performance: dict[str, Any] = Field(default_factory=dict)
    deployment_history: list[dict[str, Any]] = Field(default_factory=list)
    improvement_history: list[dict[str, Any]] = Field(default_factory=list)
    status: str = "draft"


class RecallRequest(BaseModel):
    symbol: str | None = None
    direction: str | None = None
    timeframe: str | None = None
    session: str | None = None
    indicators: dict[str, Any] = Field(default_factory=dict)
    smc_features: dict[str, Any] = Field(default_factory=dict)
    smc: dict[str, Any] = Field(default_factory=dict)
    rsi: float | None = None
    confluence_score: float | None = None
    strategy_name: str | None = None
    limit: int = 20


class SearchRequest(BaseModel):
    query: str
    collection: CollectionName = "trade_memories"
    mode: Literal["semantic", "keyword", "hybrid"] = "semantic"
    limit: int = 10
    filters: dict[str, Any] = Field(default_factory=dict)


class MemoryStatsResponse(BaseModel):
    collections: dict[str, int]
    total_memories: int
    embedding_model: str
    vector_size: int


class DashboardMemoryResponse(BaseModel):
    top_patterns: list[dict[str, Any]]
    top_reflections: list[dict[str, Any]]
    agent_state: dict[str, Any]
    stats: MemoryStatsResponse
    learning_progress: dict[str, Any]
