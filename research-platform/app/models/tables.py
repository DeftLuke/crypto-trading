from datetime import datetime
from enum import Enum
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class MarketType(str, Enum):
    SPOT = "spot"
    FUTURES = "futures"


class SyncJobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class Symbol(Base):
    __tablename__ = "symbols"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    market_type: Mapped[str] = mapped_column(String(16), default=MarketType.FUTURES.value)
    base_asset: Mapped[str | None] = mapped_column(String(16))
    quote_asset: Mapped[str | None] = mapped_column(String(16))
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("exchange", "symbol", "market_type", name="uq_symbols_exchange_symbol_market"),
        Index("ix_symbols_active_exchange", "active", "exchange"),
    )


class Candle(Base):
    __tablename__ = "candles"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("exchange", "symbol", "timeframe", "ts", name="uq_candles_key"),
        Index("ix_candles_lookup", "exchange", "symbol", "timeframe", "ts"),
        Index("ix_candles_ts", "ts"),
    )


class FundingRate(Base):
    __tablename__ = "funding_rates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    rate: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("exchange", "symbol", "ts", name="uq_funding_rates_key"),
        Index("ix_funding_rates_lookup", "exchange", "symbol", "ts"),
    )


class OpenInterest(Base):
    """Open interest snapshots. Schema extensible for liquidations later."""

    __tablename__ = "open_interest"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    open_interest: Mapped[float] = mapped_column(Float, nullable=False)
    open_interest_value: Mapped[float | None] = mapped_column(Float)
    # Future: liquidation_volume, long_liquidations, short_liquidations
    metadata_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("exchange", "symbol", "ts", name="uq_open_interest_key"),
        Index("ix_open_interest_lookup", "exchange", "symbol", "ts"),
    )


class MarketMetadata(Base):
    __tablename__ = "market_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    first_ts: Mapped[int | None] = mapped_column(BigInteger)
    last_ts: Mapped[int | None] = mapped_column(BigInteger)
    candle_count: Mapped[int] = mapped_column(BigInteger, default=0)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    parquet_path: Mapped[str | None] = mapped_column(Text)
    extra: Mapped[dict | None] = mapped_column(JSONB)

    __table_args__ = (
        UniqueConstraint("exchange", "symbol", "timeframe", name="uq_market_metadata_key"),
        Index("ix_market_metadata_freshness", "last_sync_at"),
    )


class SyncJob(Base):
    __tablename__ = "sync_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    exchange: Mapped[str | None] = mapped_column(String(32))
    symbol: Mapped[str | None] = mapped_column(String(32))
    timeframe: Mapped[str | None] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(16), default=SyncJobStatus.PENDING.value, index=True)
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    rows_processed: Mapped[int] = mapped_column(BigInteger, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_sync_jobs_status_created", "status", "created_at"),)


class SystemHealth(Base):
    __tablename__ = "system_health"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    component: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    metrics: Mapped[dict | None] = mapped_column(JSONB)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class IndicatorValue(Base):
    __tablename__ = "indicator_values"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    indicator: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[float | None] = mapped_column(Float)
    values_json: Mapped[dict | None] = mapped_column(JSONB)

    __table_args__ = (
        UniqueConstraint(
            "exchange", "symbol", "timeframe", "ts", "indicator", name="uq_indicator_values_key"
        ),
        Index("ix_indicator_values_lookup", "exchange", "symbol", "timeframe", "indicator", "ts"),
    )


class SmcFeature(Base):
    __tablename__ = "smc_features"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    bos: Mapped[bool] = mapped_column(Boolean, default=False)
    choch: Mapped[bool] = mapped_column(Boolean, default=False)
    order_block: Mapped[bool] = mapped_column(Boolean, default=False)
    liquidity_sweep: Mapped[bool] = mapped_column(Boolean, default=False)
    fvg: Mapped[bool] = mapped_column(Boolean, default=False)
    details_json: Mapped[dict | None] = mapped_column(JSONB)

    __table_args__ = (
        UniqueConstraint("exchange", "symbol", "timeframe", "ts", name="uq_smc_features_key"),
        Index("ix_smc_features_lookup", "exchange", "symbol", "timeframe", "ts"),
    )


class FeatureDataset(Base):
    __tablename__ = "feature_datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    row_count: Mapped[int] = mapped_column(BigInteger, default=0)
    parquet_path: Mapped[str | None] = mapped_column(Text)
    from_ts: Mapped[int | None] = mapped_column(BigInteger)
    to_ts: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_feature_datasets_status", "status"),)


class MarketStructure(Base):
    __tablename__ = "market_structure"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    bos: Mapped[bool] = mapped_column(Boolean, default=False)
    bos_type: Mapped[str | None] = mapped_column(String(16))
    choch: Mapped[bool] = mapped_column(Boolean, default=False)
    choch_type: Mapped[str | None] = mapped_column(String(16))
    structure_bias: Mapped[str | None] = mapped_column(String(16))
    external_structure: Mapped[str | None] = mapped_column(String(32))
    internal_structure: Mapped[str | None] = mapped_column(String(32))
    idm: Mapped[bool] = mapped_column(Boolean, default=False)
    details_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("exchange", "symbol", "timeframe", "ts", name="uq_market_structure_key"),
        Index("ix_market_structure_lookup", "exchange", "symbol", "timeframe", "ts"),
    )


class StructureEvent(Base):
    """Unified BOS / MSS / CHOCH events — migration 022."""

    __tablename__ = "structure_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False, default="binance")
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    strength: Mapped[float] = mapped_column(Float, default=0)
    structure_state: Mapped[str | None] = mapped_column(String(16))
    details_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "exchange", "symbol", "timeframe", "ts", "event_type", "direction",
            name="uq_structure_events_key",
        ),
        Index("ix_structure_events_lookup", "exchange", "symbol", "timeframe", "ts"),
        Index("ix_structure_events_symbol_created", "symbol", "created_at"),
    )


class OrderBlock(Base):
    __tablename__ = "order_blocks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active")
    strength_score: Mapped[float | None] = mapped_column(Float, default=0)
    mitigated: Mapped[bool | None] = mapped_column(Boolean, default=False)
    mitigated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    has_displacement: Mapped[bool | None] = mapped_column(Boolean, default=False)
    has_bos_after: Mapped[bool | None] = mapped_column(Boolean, default=False)
    volume_confirmed: Mapped[bool | None] = mapped_column(Boolean, default=False)
    retest_confirmed: Mapped[bool | None] = mapped_column(Boolean, default=False)
    details_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_order_blocks_lookup", "exchange", "symbol", "timeframe", "status", "ts"),
    )


class FairValueGap(Base):
    __tablename__ = "fair_value_gaps"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    top: Mapped[float] = mapped_column(Float, nullable=False)
    bottom: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active")
    gap_size: Mapped[float | None] = mapped_column(Float)
    fill_percentage: Mapped[float | None] = mapped_column(Float, default=0)
    filled_status: Mapped[bool | None] = mapped_column(Boolean, default=False)
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    details_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_fvg_lookup", "exchange", "symbol", "timeframe", "status", "ts"),
    )


class LiquidityLevel(Base):
    __tablename__ = "liquidity_levels"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    liquidity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active")
    strength_score: Mapped[float | None] = mapped_column(Float, default=0)
    taken_status: Mapped[bool | None] = mapped_column(Boolean, default=False)
    taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    session_tag: Mapped[str | None] = mapped_column(String(32))
    details_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_liquidity_levels_lookup", "exchange", "symbol", "timeframe", "ts"),
    )


class LiquiditySweep(Base):
    __tablename__ = "liquidity_sweeps"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sweep_direction: Mapped[str] = mapped_column(String(16), nullable=False)
    swept_price: Mapped[float | None] = mapped_column(Float)
    sweep_type: Mapped[str | None] = mapped_column(String(16))
    liquidity_source: Mapped[str | None] = mapped_column(String(64))
    liquidity_level_id: Mapped[int | None] = mapped_column(BigInteger)
    score: Mapped[float | None] = mapped_column(Float, default=0)
    details_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_liquidity_sweeps_lookup", "exchange", "symbol", "timeframe", "ts"),
    )


class Displacement(Base):
    __tablename__ = "displacements"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    strength_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    atr_expansion: Mapped[bool | None] = mapped_column(Boolean, default=False)
    volume_expansion: Mapped[bool | None] = mapped_column(Boolean, default=False)
    oi_expansion: Mapped[bool | None] = mapped_column(Boolean, default=False)
    body_pct: Mapped[float | None] = mapped_column(Float)
    details_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_displacements_lookup", "exchange", "symbol", "timeframe", "ts"),
    )


class MarketSession(Base):
    __tablename__ = "market_sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    session: Mapped[str] = mapped_column(String(16), nullable=False)
    hour_utc: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_market_sessions_lookup", "exchange", "symbol", "ts"),
    )


class SignalCandidate(Base):
    __tablename__ = "signal_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    entry: Mapped[float | None] = mapped_column(Float)
    stop_loss: Mapped[float | None] = mapped_column(Float)
    tp1: Mapped[float | None] = mapped_column(Float)
    tp2: Mapped[float | None] = mapped_column(Float)
    tp3: Mapped[str | None] = mapped_column(String(16))
    rule_name: Mapped[str | None] = mapped_column(String(64))
    signal_json: Mapped[dict | None] = mapped_column(JSONB)
    telegram_text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_signal_candidates_lookup", "exchange", "symbol", "status", "created_at"),
    )


class ConfluenceScore(Base):
    __tablename__ = "confluence_scores"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    exchange: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    breakdown_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_confluence_scores_lookup", "exchange", "symbol", "timeframe", "ts"),
    )


class StrategyRuleRow(Base):
    __tablename__ = "strategy_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    conditions_json: Mapped[list | None] = mapped_column(JSONB)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_strategy_rules_enabled", "enabled", "priority"),
    )


# --- Phase 3: Backtesting Engine ---


class BacktestConfigRow(Base):
    __tablename__ = "research_backtest_configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    strategy_name: Mapped[str] = mapped_column(String(64), default="smc-mtf")
    config_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Backtest(Base):
    __tablename__ = "research_backtests"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    config_id: Mapped[int | None] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    mode: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    exchange: Mapped[str] = mapped_column(String(32), default="binance")
    timeframe: Mapped[str] = mapped_column(String(8), default="15m")
    symbols: Mapped[list] = mapped_column(JSONB, default=list)
    start_ts: Mapped[int | None] = mapped_column(BigInteger)
    end_ts: Mapped[int | None] = mapped_column(BigInteger)
    config_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    progress_pct: Mapped[float] = mapped_column(Float, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BacktestRun(Base):
    __tablename__ = "research_backtest_runs"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    run_type: Mapped[str] = mapped_column(String(32), default="standard")
    symbol: Mapped[str | None] = mapped_column(String(32))
    window_start_ts: Mapped[int | None] = mapped_column(BigInteger)
    window_end_ts: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    metrics_json: Mapped[dict | None] = mapped_column(JSONB)
    summary_json: Mapped[dict | None] = mapped_column(JSONB)
    export_paths: Mapped[dict | None] = mapped_column(JSONB)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BacktestTrade(Base):
    __tablename__ = "research_backtest_trades"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    run_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    trade_id: Mapped[str] = mapped_column(String(32), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    entry_time: Mapped[int] = mapped_column(BigInteger, nullable=False)
    exit_time: Mapped[int | None] = mapped_column(BigInteger)
    entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    exit_price: Mapped[float | None] = mapped_column(Float)
    leverage: Mapped[float] = mapped_column(Float, default=1)
    margin_pct: Mapped[float | None] = mapped_column(Float)
    position_size_usd: Mapped[float | None] = mapped_column(Float)
    stop_loss: Mapped[float | None] = mapped_column(Float)
    take_profit: Mapped[float | None] = mapped_column(Float)
    fees_usd: Mapped[float] = mapped_column(Float, default=0)
    slippage_usd: Mapped[float] = mapped_column(Float, default=0)
    funding_fees_usd: Mapped[float] = mapped_column(Float, default=0)
    rsi: Mapped[float | None] = mapped_column(Float)
    ema20: Mapped[float | None] = mapped_column(Float)
    ema50: Mapped[float | None] = mapped_column(Float)
    ema100: Mapped[float | None] = mapped_column(Float)
    ema200: Mapped[float | None] = mapped_column(Float)
    bos: Mapped[bool] = mapped_column(Boolean, default=False)
    choch: Mapped[bool] = mapped_column(Boolean, default=False)
    fvg: Mapped[bool] = mapped_column(Boolean, default=False)
    order_block: Mapped[bool] = mapped_column(Boolean, default=False)
    liquidity_sweep: Mapped[bool] = mapped_column(Boolean, default=False)
    session: Mapped[str | None] = mapped_column(String(16))
    result: Mapped[str | None] = mapped_column(String(16))
    profit_percent: Mapped[float | None] = mapped_column(Float)
    profit_usd: Mapped[float | None] = mapped_column(Float)
    mfe: Mapped[float | None] = mapped_column(Float)
    mae: Mapped[float | None] = mapped_column(Float)
    drawdown: Mapped[float | None] = mapped_column(Float)
    strategy_name: Mapped[str | None] = mapped_column(String(64))
    signal_confidence: Mapped[float | None] = mapped_column(Float)
    exit_reason: Mapped[str | None] = mapped_column(String(32))
    features_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BacktestTradeMetric(Base):
    __tablename__ = "research_backtest_trade_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    run_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    metrics_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BacktestDailyStat(Base):
    __tablename__ = "research_backtest_daily_stats"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    run_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    stat_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    pnl_usd: Mapped[float] = mapped_column(Float, default=0)
    pnl_pct: Mapped[float] = mapped_column(Float, default=0)
    trades: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    balance: Mapped[float | None] = mapped_column(Float)
    drawdown_pct: Mapped[float] = mapped_column(Float, default=0)
    stats_json: Mapped[dict | None] = mapped_column(JSONB)


class BacktestSessionStat(Base):
    __tablename__ = "research_backtest_session_stats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    run_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    session: Mapped[str] = mapped_column(String(16), nullable=False)
    trades: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    win_rate: Mapped[float | None] = mapped_column(Float)
    profit_factor: Mapped[float | None] = mapped_column(Float)
    net_profit: Mapped[float] = mapped_column(Float, default=0)
    stats_json: Mapped[dict | None] = mapped_column(JSONB)


class BacktestSymbolStat(Base):
    __tablename__ = "research_backtest_symbol_stats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    run_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    trades: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    win_rate: Mapped[float | None] = mapped_column(Float)
    profit_factor: Mapped[float | None] = mapped_column(Float)
    net_profit: Mapped[float] = mapped_column(Float, default=0)
    max_drawdown_pct: Mapped[float | None] = mapped_column(Float)
    stats_json: Mapped[dict | None] = mapped_column(JSONB)


class BacktestSmcStat(Base):
    __tablename__ = "research_backtest_smc_stats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    run_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    feature: Mapped[str] = mapped_column(String(32), nullable=False)
    trades: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    win_rate: Mapped[float | None] = mapped_column(Float)
    profit_factor: Mapped[float | None] = mapped_column(Float)
    net_profit: Mapped[float] = mapped_column(Float, default=0)
    stats_json: Mapped[dict | None] = mapped_column(JSONB)


class BacktestDrawdownStat(Base):
    __tablename__ = "research_backtest_drawdown_stats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    run_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    max_drawdown_pct: Mapped[float | None] = mapped_column(Float)
    max_drawdown_usd: Mapped[float | None] = mapped_column(Float)
    avg_drawdown_pct: Mapped[float | None] = mapped_column(Float)
    longest_drawdown_bars: Mapped[int | None] = mapped_column(Integer)
    recovery_factor: Mapped[float | None] = mapped_column(Float)
    stats_json: Mapped[dict | None] = mapped_column(JSONB)


class BacktestEquityCurve(Base):
    __tablename__ = "research_backtest_equity_curve"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    run_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    ts: Mapped[int] = mapped_column(BigInteger, nullable=False)
    balance: Mapped[float] = mapped_column(Float, nullable=False)
    equity: Mapped[float] = mapped_column(Float, nullable=False)
    drawdown_pct: Mapped[float] = mapped_column(Float, default=0)
    daily_pnl: Mapped[float] = mapped_column(Float, default=0)


class BacktestMonteCarloResult(Base):
    __tablename__ = "research_backtest_monte_carlo_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    run_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    simulations: Mapped[int] = mapped_column(Integer, nullable=False)
    worst_drawdown_pct: Mapped[float | None] = mapped_column(Float)
    expected_return_pct: Mapped[float | None] = mapped_column(Float)
    risk_of_ruin: Mapped[float | None] = mapped_column(Float)
    results_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BacktestWalkforwardResult(Base):
    __tablename__ = "research_backtest_walkforward_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    backtest_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    fold: Mapped[int] = mapped_column(Integer, nullable=False)
    train_start_ts: Mapped[int | None] = mapped_column(BigInteger)
    train_end_ts: Mapped[int | None] = mapped_column(BigInteger)
    validate_start_ts: Mapped[int | None] = mapped_column(BigInteger)
    validate_end_ts: Mapped[int | None] = mapped_column(BigInteger)
    train_metrics_json: Mapped[dict | None] = mapped_column(JSONB)
    validate_metrics_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BacktestStrategyRanking(Base):
    __tablename__ = "research_backtest_strategy_rankings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    comparison_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    strategy_name: Mapped[str] = mapped_column(String(64), nullable=False)
    backtest_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    rank: Mapped[int | None] = mapped_column(Integer)
    composite_score: Mapped[float | None] = mapped_column(Float)
    profitability_score: Mapped[float | None] = mapped_column(Float)
    drawdown_score: Mapped[float | None] = mapped_column(Float)
    sharpe_score: Mapped[float | None] = mapped_column(Float)
    consistency_score: Mapped[float | None] = mapped_column(Float)
    recovery_score: Mapped[float | None] = mapped_column(Float)
    metrics_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

