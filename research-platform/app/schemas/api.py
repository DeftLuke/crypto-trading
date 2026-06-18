from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str = "0.1.0"
    timestamp: datetime
    checks: dict[str, Any] = Field(default_factory=dict)


class SymbolCreate(BaseModel):
    exchange: str
    symbol: str
    market_type: str = "futures"
    base_asset: str | None = None
    quote_asset: str | None = None


class SymbolResponse(BaseModel):
    id: int
    exchange: str
    symbol: str
    market_type: str
    active: bool

    model_config = {"from_attributes": True}


class SyncStartRequest(BaseModel):
    exchange: str
    symbol: str
    timeframe: str
    full: bool = False


class SyncJobResponse(BaseModel):
    id: int
    job_type: str
    exchange: str | None
    symbol: str | None
    timeframe: str | None
    status: str
    progress_pct: float
    rows_processed: int
    error_message: str | None

    model_config = {"from_attributes": True}


class CandleQuery(BaseModel):
    exchange: str
    symbol: str
    timeframe: str
    from_ts: int | None = None
    to_ts: int | None = None
    limit: int = Field(default=500, le=5000)


class CandleRow(BaseModel):
    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class DatasetStatusResponse(BaseModel):
    id: int
    name: str
    exchange: str
    symbol: str
    timeframe: str
    status: str
    row_count: int
    parquet_path: str | None

    model_config = {"from_attributes": True}


class SystemHealthResponse(BaseModel):
    component: str
    status: str
    message: str | None
    metrics: dict | None
    recorded_at: datetime

    model_config = {"from_attributes": True}
