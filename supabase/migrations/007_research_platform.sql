-- Supabase migration: Research Platform Phase 1 tables
-- Run in Supabase SQL Editor or: alembic upgrade head
-- symbols
CREATE TABLE IF NOT EXISTS symbols (
  id SERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  market_type VARCHAR(16) NOT NULL DEFAULT 'futures',
  base_asset VARCHAR(16),
  quote_asset VARCHAR(16),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_symbols_exchange_symbol_market UNIQUE (exchange, symbol, market_type)
);
CREATE INDEX IF NOT EXISTS ix_symbols_exchange ON symbols (exchange);
CREATE INDEX IF NOT EXISTS ix_symbols_symbol ON symbols (symbol);
CREATE INDEX IF NOT EXISTS ix_symbols_active_exchange ON symbols (active, exchange);

-- candles
CREATE TABLE IF NOT EXISTS candles (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  volume DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_candles_key UNIQUE (exchange, symbol, timeframe, ts)
);
CREATE INDEX IF NOT EXISTS ix_candles_lookup ON candles (exchange, symbol, timeframe, ts);
CREATE INDEX IF NOT EXISTS ix_candles_ts ON candles (ts);

-- funding_rates
CREATE TABLE IF NOT EXISTS funding_rates (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  ts BIGINT NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_funding_rates_key UNIQUE (exchange, symbol, ts)
);
CREATE INDEX IF NOT EXISTS ix_funding_rates_lookup ON funding_rates (exchange, symbol, ts);

-- open_interest (extensible for liquidations)
CREATE TABLE IF NOT EXISTS open_interest (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  ts BIGINT NOT NULL,
  open_interest DOUBLE PRECISION NOT NULL,
  open_interest_value DOUBLE PRECISION,
  metadata_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_open_interest_key UNIQUE (exchange, symbol, ts)
);
CREATE INDEX IF NOT EXISTS ix_open_interest_lookup ON open_interest (exchange, symbol, ts);

-- market_metadata
CREATE TABLE IF NOT EXISTS market_metadata (
  id SERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  first_ts BIGINT,
  last_ts BIGINT,
  candle_count BIGINT DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  parquet_path TEXT,
  extra JSONB,
  CONSTRAINT uq_market_metadata_key UNIQUE (exchange, symbol, timeframe)
);
CREATE INDEX IF NOT EXISTS ix_market_metadata_freshness ON market_metadata (last_sync_at);

-- sync_jobs
CREATE TABLE IF NOT EXISTS sync_jobs (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(64) NOT NULL,
  exchange VARCHAR(32),
  symbol VARCHAR(32),
  timeframe VARCHAR(8),
  status VARCHAR(16) DEFAULT 'pending',
  progress_pct DOUBLE PRECISION DEFAULT 0,
  rows_processed BIGINT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_sync_jobs_job_type ON sync_jobs (job_type);
CREATE INDEX IF NOT EXISTS ix_sync_jobs_status ON sync_jobs (status);
CREATE INDEX IF NOT EXISTS ix_sync_jobs_status_created ON sync_jobs (status, created_at);

-- system_health
CREATE TABLE IF NOT EXISTS system_health (
  id SERIAL PRIMARY KEY,
  component VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  message TEXT,
  metrics JSONB,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_system_health_component ON system_health (component);
CREATE INDEX IF NOT EXISTS ix_system_health_recorded_at ON system_health (recorded_at);

-- indicator_values
CREATE TABLE IF NOT EXISTS indicator_values (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  indicator VARCHAR(32) NOT NULL,
  value DOUBLE PRECISION,
  values_json JSONB,
  CONSTRAINT uq_indicator_values_key UNIQUE (exchange, symbol, timeframe, ts, indicator)
);
CREATE INDEX IF NOT EXISTS ix_indicator_values_lookup ON indicator_values (exchange, symbol, timeframe, indicator, ts);

-- smc_features
CREATE TABLE IF NOT EXISTS smc_features (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  bos BOOLEAN DEFAULT FALSE,
  choch BOOLEAN DEFAULT FALSE,
  order_block BOOLEAN DEFAULT FALSE,
  liquidity_sweep BOOLEAN DEFAULT FALSE,
  fvg BOOLEAN DEFAULT FALSE,
  details_json JSONB,
  CONSTRAINT uq_smc_features_key UNIQUE (exchange, symbol, timeframe, ts)
);
CREATE INDEX IF NOT EXISTS ix_smc_features_lookup ON smc_features (exchange, symbol, timeframe, ts);

-- feature_datasets
CREATE TABLE IF NOT EXISTS feature_datasets (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  status VARCHAR(16) DEFAULT 'pending',
  row_count BIGINT DEFAULT 0,
  parquet_path TEXT,
  from_ts BIGINT,
  to_ts BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_feature_datasets_status ON feature_datasets (status);

-- Alembic version tracking (if using alembic against Supabase)
CREATE TABLE IF NOT EXISTS alembic_version (
  version_num VARCHAR(32) NOT NULL PRIMARY KEY
);
INSERT INTO alembic_version (version_num) VALUES ('001')
ON CONFLICT (version_num) DO NOTHING;
