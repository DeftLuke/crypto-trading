"""Initial schema — Phase 1 research platform

Revision ID: 001
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "symbols",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("market_type", sa.String(16), nullable=False),
        sa.Column("base_asset", sa.String(16)),
        sa.Column("quote_asset", sa.String(16)),
        sa.Column("active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exchange", "symbol", "market_type", name="uq_symbols_exchange_symbol_market"),
    )
    op.create_index("ix_symbols_active_exchange", "symbols", ["active", "exchange"])
    op.create_index(op.f("ix_symbols_exchange"), "symbols", ["exchange"])
    op.create_index(op.f("ix_symbols_symbol"), "symbols", ["symbol"])

    op.create_table(
        "candles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("timeframe", sa.String(8), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False),
        sa.Column("open", sa.Float(), nullable=False),
        sa.Column("high", sa.Float(), nullable=False),
        sa.Column("low", sa.Float(), nullable=False),
        sa.Column("close", sa.Float(), nullable=False),
        sa.Column("volume", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exchange", "symbol", "timeframe", "ts", name="uq_candles_key"),
    )
    op.create_index("ix_candles_lookup", "candles", ["exchange", "symbol", "timeframe", "ts"])
    op.create_index("ix_candles_ts", "candles", ["ts"])

    op.create_table(
        "funding_rates",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False),
        sa.Column("rate", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exchange", "symbol", "ts", name="uq_funding_rates_key"),
    )
    op.create_index("ix_funding_rates_lookup", "funding_rates", ["exchange", "symbol", "ts"])

    op.create_table(
        "open_interest",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False),
        sa.Column("open_interest", sa.Float(), nullable=False),
        sa.Column("open_interest_value", sa.Float()),
        sa.Column("metadata_json", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exchange", "symbol", "ts", name="uq_open_interest_key"),
    )
    op.create_index("ix_open_interest_lookup", "open_interest", ["exchange", "symbol", "ts"])

    op.create_table(
        "market_metadata",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("timeframe", sa.String(8), nullable=False),
        sa.Column("first_ts", sa.BigInteger()),
        sa.Column("last_ts", sa.BigInteger()),
        sa.Column("candle_count", sa.BigInteger(), default=0),
        sa.Column("last_sync_at", sa.DateTime(timezone=True)),
        sa.Column("parquet_path", sa.Text()),
        sa.Column("extra", postgresql.JSONB()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exchange", "symbol", "timeframe", name="uq_market_metadata_key"),
    )
    op.create_index("ix_market_metadata_freshness", "market_metadata", ["last_sync_at"])

    op.create_table(
        "sync_jobs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("job_type", sa.String(64), nullable=False),
        sa.Column("exchange", sa.String(32)),
        sa.Column("symbol", sa.String(32)),
        sa.Column("timeframe", sa.String(8)),
        sa.Column("status", sa.String(16), default="pending"),
        sa.Column("progress_pct", sa.Float(), default=0),
        sa.Column("rows_processed", sa.BigInteger(), default=0),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sync_jobs_status_created", "sync_jobs", ["status", "created_at"])
    op.create_index(op.f("ix_sync_jobs_job_type"), "sync_jobs", ["job_type"])
    op.create_index(op.f("ix_sync_jobs_status"), "sync_jobs", ["status"])

    op.create_table(
        "system_health",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("component", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("message", sa.Text()),
        sa.Column("metrics", postgresql.JSONB()),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_system_health_component"), "system_health", ["component"])
    op.create_index(op.f("ix_system_health_recorded_at"), "system_health", ["recorded_at"])

    op.create_table(
        "indicator_values",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("timeframe", sa.String(8), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False),
        sa.Column("indicator", sa.String(32), nullable=False),
        sa.Column("value", sa.Float()),
        sa.Column("values_json", postgresql.JSONB()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "exchange", "symbol", "timeframe", "ts", "indicator", name="uq_indicator_values_key"
        ),
    )
    op.create_index(
        "ix_indicator_values_lookup",
        "indicator_values",
        ["exchange", "symbol", "timeframe", "indicator", "ts"],
    )

    op.create_table(
        "smc_features",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("timeframe", sa.String(8), nullable=False),
        sa.Column("ts", sa.BigInteger(), nullable=False),
        sa.Column("bos", sa.Boolean(), default=False),
        sa.Column("choch", sa.Boolean(), default=False),
        sa.Column("order_block", sa.Boolean(), default=False),
        sa.Column("liquidity_sweep", sa.Boolean(), default=False),
        sa.Column("fvg", sa.Boolean(), default=False),
        sa.Column("details_json", postgresql.JSONB()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("exchange", "symbol", "timeframe", "ts", name="uq_smc_features_key"),
    )
    op.create_index("ix_smc_features_lookup", "smc_features", ["exchange", "symbol", "timeframe", "ts"])

    op.create_table(
        "feature_datasets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("exchange", sa.String(32), nullable=False),
        sa.Column("symbol", sa.String(32), nullable=False),
        sa.Column("timeframe", sa.String(8), nullable=False),
        sa.Column("status", sa.String(16), default="pending"),
        sa.Column("row_count", sa.BigInteger(), default=0),
        sa.Column("parquet_path", sa.Text()),
        sa.Column("from_ts", sa.BigInteger()),
        sa.Column("to_ts", sa.BigInteger()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_feature_datasets_status", "feature_datasets", ["status"])


def downgrade() -> None:
    for t in (
        "feature_datasets", "smc_features", "indicator_values", "system_health",
        "sync_jobs", "market_metadata", "open_interest", "funding_rates", "candles", "symbols",
    ):
        op.drop_table(t)
