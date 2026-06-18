-- Phase 2: Indicator + SMC Engine tables

CREATE TABLE IF NOT EXISTS market_structure (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  bos BOOLEAN DEFAULT FALSE,
  bos_type VARCHAR(16),
  choch BOOLEAN DEFAULT FALSE,
  choch_type VARCHAR(16),
  structure_bias VARCHAR(16),
  external_structure VARCHAR(32),
  internal_structure VARCHAR(32),
  idm BOOLEAN DEFAULT FALSE,
  details_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_market_structure_key UNIQUE (exchange, symbol, timeframe, ts)
);
CREATE INDEX IF NOT EXISTS ix_market_structure_lookup ON market_structure (exchange, symbol, timeframe, ts);

CREATE TABLE IF NOT EXISTS order_blocks (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  direction VARCHAR(16) NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  status VARCHAR(16) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_order_blocks_lookup ON order_blocks (exchange, symbol, timeframe, status, ts);

CREATE TABLE IF NOT EXISTS fair_value_gaps (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  direction VARCHAR(16) NOT NULL,
  top DOUBLE PRECISION NOT NULL,
  bottom DOUBLE PRECISION NOT NULL,
  status VARCHAR(16) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_fvg_lookup ON fair_value_gaps (exchange, symbol, timeframe, status, ts);

CREATE TABLE IF NOT EXISTS liquidity_levels (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  liquidity_type VARCHAR(32) NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  status VARCHAR(16) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_liquidity_levels_lookup ON liquidity_levels (exchange, symbol, timeframe, ts);

CREATE TABLE IF NOT EXISTS liquidity_sweeps (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  sweep_direction VARCHAR(16) NOT NULL,
  swept_price DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_liquidity_sweeps_lookup ON liquidity_sweeps (exchange, symbol, timeframe, ts);

CREATE TABLE IF NOT EXISTS market_sessions (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  ts BIGINT NOT NULL,
  session VARCHAR(16) NOT NULL,
  hour_utc INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_market_sessions_lookup ON market_sessions (exchange, symbol, ts);

CREATE TABLE IF NOT EXISTS signal_candidates (
  id SERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  direction VARCHAR(8) NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  entry DOUBLE PRECISION,
  stop_loss DOUBLE PRECISION,
  tp1 DOUBLE PRECISION,
  tp2 DOUBLE PRECISION,
  tp3 VARCHAR(16),
  rule_name VARCHAR(64),
  signal_json JSONB,
  telegram_text TEXT,
  status VARCHAR(16) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_signal_candidates_lookup ON signal_candidates (exchange, symbol, status, created_at);

CREATE TABLE IF NOT EXISTS confluence_scores (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  direction VARCHAR(8) NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  breakdown_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_confluence_scores_lookup ON confluence_scores (exchange, symbol, timeframe, ts);

CREATE TABLE IF NOT EXISTS strategy_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  direction VARCHAR(8) NOT NULL,
  conditions_json JSONB,
  enabled BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_strategy_rules_enabled ON strategy_rules (enabled, priority);

INSERT INTO strategy_rules (name, direction, conditions_json, enabled, priority, description)
VALUES (
  'default_short',
  'SHORT',
  '[
    {"field": "rsi14", "op": ">", "value": 80},
    {"field": "close_below_ema100_1h", "op": "==", "value": 1, "type": "bool"},
    {"field": "bos_bearish", "op": "==", "value": 1, "type": "bool"},
    {"field": "volatility_safe", "op": "==", "value": 1, "type": "bool"}
  ]'::jsonb,
  true, 10, 'Default institutional short setup'
) ON CONFLICT (name) DO NOTHING;

INSERT INTO alembic_version (version_num) VALUES ('002') ON CONFLICT (version_num) DO NOTHING;
