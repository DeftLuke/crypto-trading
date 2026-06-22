from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _normalize_database_url(url: str) -> str:
    """Ensure asyncpg driver and strip quotes from env values."""
    url = url.strip().strip('"').strip("'")
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def _is_supabase_host(url: str) -> bool:
    host = urlparse(url.replace("+asyncpg", "")).hostname or ""
    return "supabase.com" in host or "supabase.co" in host


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "research-platform"
    app_env: Literal["development", "staging", "production"] = "development"
    log_level: str = "INFO"
    api_host: str = "0.0.0.0"
    api_port: int = 8100

    # Primary connection — set this to your Supabase Postgres URL
    database_url: str = Field(
        default="postgresql+asyncpg://research:research@localhost:5433/research_db",
    )
    database_ssl: bool | None = None
    database_pool_size: int = 10
    database_max_overflow: int = 20

    # Optional: build DATABASE_URL from Supabase dashboard values
    supabase_url: str = ""
    supabase_db_password: str = ""
    supabase_db_host: str = ""
    supabase_project_ref: str = ""
    supabase_db_user: str = "postgres"

    redis_url: str = "redis://localhost:6380/0"
    data_root: str = "./data"
    market_data_root: str = "./data/market_data"

    default_exchanges: str = "binance,bybit,okx,hyperliquid"
    default_timeframes: str = "1m,5m,15m,30m,1h,4h,1d"
    sync_batch_size: int = 1000
    sync_rate_limit_ms: int = 200

    binance_api_key: str = ""
    binance_api_secret: str = ""
    bybit_api_key: str = ""
    bybit_api_secret: str = ""
    okx_api_key: str = ""
    okx_api_secret: str = ""
    okx_passphrase: str = ""

    scheduler_enabled: bool = False
    sync_interval_minutes: int = 15
    # Legacy Supabase sync — not required for institutional SMC (Parquet store)
    database_required: bool = False

    # Phase 5 — Qdrant memory layer (optional; off by default for trading-only)
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: str = ""
    memory_enabled: bool = False
    memory_low_ram: bool = False
    memory_embedding_provider: str = "hash"  # hash | bge-small | bge-base | bge-large | openai
    memory_embedding_model: str = "BAAI/bge-small-en-v1.5"
    memory_embedding_api_url: str = ""
    memory_embedding_api_key: str = ""
    memory_vector_size: int = 384
    memory_worker_interval_minutes: int = 10

    # Phase 6 — AI Research Agent (optional research; off by default for trading-only)
    agent_enabled: bool = False
    agent_auto_start: bool = False
    agent_low_ram: bool = False
    agent_cycle_interval_minutes: int = 7
    agent_max_hypotheses: int = 12
    agent_max_backtests_per_cycle: int = 5
    agent_meta_learning: bool = True
    agent_meta_threshold: float = 0.35

    # Phase 7 — Paper Trading
    paper_enabled: bool = True
    paper_auto_start: bool = False
    paper_default_balance: float = 1000.0
    paper_default_leverage: int = 50
    paper_margin_pct: float = 0.5
    paper_sizing_mode: str = "margin_pct"
    paper_max_positions: int = 20
    paper_max_positions_per_symbol: int = 3
    paper_max_daily_loss_pct: float = 3.0
    paper_max_drawdown_pct: float = 20.0
    paper_max_exposure_pct: float = 80.0
    paper_max_symbol_exposure_pct: float = 40.0
    paper_slippage_bps: float = 5.0
    paper_spread_bps: float = 2.0
    paper_latency_ms: int = 0
    paper_partial_fill_prob: float = 0.0
    paper_validation_min_trades: int = 100
    paper_validation_min_pf: float = 1.5
    paper_validation_min_sharpe: float = 1.2
    paper_validation_max_dd: float = 20.0
    paper_validation_min_win_rate: float = 45.0

    # Phase 8 — Live Trading Engine
    live_enabled: bool = True
    live_auto_start: bool = False
    live_dry_run: bool = True
    live_default_balance: float = 1000.0
    live_default_leverage: int = 50
    live_max_leverage: int = 50
    live_margin_pct: float = 0.5
    live_sizing_mode: str = "margin_pct"
    live_max_positions: int = 20
    live_max_positions_per_symbol: int = 3
    live_max_daily_loss_pct: float = 3.0
    live_max_drawdown_pct: float = 20.0
    live_max_exposure_pct: float = 80.0
    live_max_symbol_exposure_pct: float = 40.0
    live_max_margin_usage_pct: float = 90.0
    live_api_error_threshold: int = 10
    live_require_approval: bool = True
    live_allow_manual: bool = True
    live_simulated_latency_ms: int = 50
    live_monitor_interval_sec: float = 2.0
    binance_testnet: bool = False

    # Phase 9 — Operations / n8n AI Agent
    operations_enabled: bool = True
    ai_gateway_url: str = ""
    ai_api_key: str = ""
    ai_openai_api_url: str = ""
    ai_openai_api_key: str = ""
    ai_openai_model: str = "gpt-4o-mini"
    openclaw_gateway_url: str = ""
    openclaw_gateway_token: str = ""
    openclaw_model: str = "openclaw/default"
    n8n_base_url: str = ""
    n8n_api_key: str = ""
    n8n_webhook_url: str = ""
    discord_webhook_url: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    operations_daily_summary: bool = True

    # Phase 10 — Enterprise Control Center
    control_enabled: bool = True
    control_trading_mode: str = "demo"  # demo | live
    control_auto_trading: bool = False
    control_manual_approval: bool = True
    control_default_exchange: str = "binance"
    trade_approval_passcode: str = "8888"
    hyperliquid_api_key: str = ""
    hyperliquid_api_secret: str = ""

    # Telegram (optional)
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_db_url(cls, v: str) -> str:
        if isinstance(v, str):
            return _normalize_database_url(v)
        return v

    @model_validator(mode="after")
    def resolve_supabase_database_url(self) -> "Settings":
        if _is_supabase_host(self.database_url):
            if self.database_ssl is None:
                self.database_ssl = True
            return self

        if self.supabase_db_password and (
            self.supabase_db_host or self.supabase_project_ref or self.supabase_url
        ):
            host = self.supabase_db_host
            if not host and self.supabase_project_ref:
                host = f"db.{self.supabase_project_ref}.supabase.co"
            elif not host and self.supabase_url:
                ref = self.supabase_url.replace("https://", "").split(".")[0]
                host = f"db.{ref}.supabase.co"

            user = self.supabase_db_user
            if self.supabase_project_ref and user == "postgres":
                user = f"postgres.{self.supabase_project_ref}"

            self.database_url = (
                f"postgresql+asyncpg://{user}:{self.supabase_db_password}@{host}:5432/postgres"
            )
            if self.database_ssl is None:
                self.database_ssl = True
        return self

    @property
    def database_requires_ssl(self) -> bool:
        if self.database_ssl is not None:
            return self.database_ssl
        return _is_supabase_host(self.database_url)

    @property
    def alembic_database_url(self) -> str:
        """Sync URL for Alembic (psycopg2) with SSL query param when needed."""
        url = self.database_url.replace("+asyncpg", "")
        if not self.database_requires_ssl:
            return url
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        query.setdefault("sslmode", ["require"])
        return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))

    @property
    def exchanges(self) -> list[str]:
        return [x.strip() for x in self.default_exchanges.split(",") if x.strip()]

    @property
    def timeframes(self) -> list[str]:
        return [x.strip() for x in self.default_timeframes.split(",") if x.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
