"""Pydantic schemas for Phase 3 backtest API."""

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class BacktestStartRequest(BaseModel):
    name: str = "backtest_run"
    mode: str = Field(default="single", pattern="^(single|multi|portfolio|walkforward|monte_carlo|e5)$")
    exchange: str = "binance"
    timeframe: str = "15m"
    symbols: list[str] = Field(default_factory=lambda: ["BTCUSDT"])
    start_ts: int | None = None
    end_ts: int | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    strategy_name: str = "smc-mtf"
    score_threshold: float = 85.0
    leverage: int = 10


class BacktestStatusResponse(BaseModel):
    backtest_id: str
    status: str
    progress_pct: float = 0
    error: str | None = None
    metrics: dict[str, Any] | None = None
    export_paths: dict[str, str] | None = None


class BacktestResultsResponse(BaseModel):
    backtest_id: str
    mode: str
    symbols: list[str]
    metrics: dict[str, Any]
    analytics: dict[str, Any] = Field(default_factory=dict)
    trade_count: int = 0
    walkforward: list[dict[str, Any]] = Field(default_factory=list)
    monte_carlo: dict[str, Any] | None = None


class BacktestCompareRequest(BaseModel):
    backtest_ids: list[str] = Field(min_length=2)


class BacktestRankingResponse(BaseModel):
    comparison_id: str
    rankings: list[dict[str, Any]]
