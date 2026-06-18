"""Phase 6 — AI Research Agent shared types."""

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


class TaskType(str, Enum):
    RECALL = "recall"
    GENERATE_STRATEGY = "generate_strategy"
    EVALUATE_STRATEGY = "evaluate_strategy"
    RUN_BACKTEST = "run_backtest"
    ANALYZE_RESULTS = "analyze_results"
    GENERATE_REFLECTION = "generate_reflection"
    UPDATE_MEMORY = "update_memory"
    DISCOVER_PATTERNS = "discover_patterns"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ResearchTask(BaseModel):
    task_id: str = Field(default_factory=new_id)
    task_type: TaskType
    priority: float = 0.5
    status: TaskStatus = TaskStatus.PENDING
    payload: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None


class StrategyDefinition(BaseModel):
    strategy_name: str
    conditions: list[str]
    direction: str = "SHORT"
    rule_conditions: list[dict[str, Any]] = Field(default_factory=list)
    session_filter: str | None = None
    version: str = "1.0"
    source: str = "ai_agent"

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump()


class Hypothesis(BaseModel):
    hypothesis_id: str = Field(default_factory=new_id)
    title: str
    description: str
    conditions: list[str] = Field(default_factory=list)
    direction: str = "SHORT"
    confidence: float = 0.5
    evidence: str = ""
    priority: float = 0.5
    status: str = "pending"
    created_at: datetime = Field(default_factory=utc_now)


class StrategyScore(BaseModel):
    strategy_name: str
    profitability: float = 0.0
    sharpe: float = 0.0
    sortino: float = 0.0
    consistency: float = 0.0
    drawdown: float = 0.0
    walkforward_stability: float = 0.0
    monte_carlo_robustness: float = 0.0
    recovery_factor: float = 0.0
    composite_score: float = 0.0
    meta_success_probability: float | None = None


class AgentReflection(BaseModel):
    reflection_id: str = Field(default_factory=new_id)
    observation: str
    evidence: str
    confidence: float = 0.5
    category: str = "research"
    supporting_memories: list[str] = Field(default_factory=list)
    reasoning: str = ""
    created_at: datetime = Field(default_factory=utc_now)


class ResearchPlan(BaseModel):
    plan_id: str = Field(default_factory=new_id)
    goal: str
    tasks: list[str] = Field(default_factory=list)
    status: str = "active"
    priority: float = 0.5
    created_at: datetime = Field(default_factory=utc_now)


class AgentInsight(BaseModel):
    insight_id: str = Field(default_factory=new_id)
    title: str
    summary: str
    category: str = "discovery"
    confidence: float = 0.5
    evidence: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class AgentRecommendation(BaseModel):
    recommendation_id: str = Field(default_factory=new_id)
    title: str
    action: str
    rationale: str
    confidence: float = 0.5
    strategy_name: str | None = None
    supporting_memories: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)


class LearningSnapshot(BaseModel):
    best_conditions: list[str] = Field(default_factory=list)
    worst_conditions: list[str] = Field(default_factory=list)
    emerging_patterns: list[str] = Field(default_factory=list)
    risk_warnings: list[str] = Field(default_factory=list)
    regime: str | None = None
    updated_at: datetime = Field(default_factory=utc_now)


class AgentState(BaseModel):
    running: bool = False
    cycle_count: int = 0
    last_cycle_at: datetime | None = None
    last_cycle_duration_ms: int = 0
    current_phase: str = "idle"
    hypotheses_count: int = 0
    strategies_evaluated: int = 0
    backtests_launched: int = 0
    reflections_generated: int = 0
    errors: list[str] = Field(default_factory=list)
    audit_log: list[dict[str, Any]] = Field(default_factory=list)
