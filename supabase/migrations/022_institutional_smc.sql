-- Institutional SMC Engine — CP0 schema extensions
-- Extends 008_phase2_engine.sql; does not drop existing tables.

-- ── Unified structure events (BOS / MSS / CHOCH) ──────────────────────────
CREATE TABLE IF NOT EXISTS structure_events (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL DEFAULT 'binance',
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('BOS', 'MSS', 'CHOCH')),
  direction VARCHAR(16) NOT NULL CHECK (direction IN ('bullish', 'bearish')),
  price DOUBLE PRECISION NOT NULL,
  strength DOUBLE PRECISION DEFAULT 0 CHECK (strength >= 0 AND strength <= 100),
  structure_state VARCHAR(16) CHECK (structure_state IN ('bullish', 'bearish', 'range')),
  details_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_structure_events_key UNIQUE (exchange, symbol, timeframe, ts, event_type, direction)
);
CREATE INDEX IF NOT EXISTS ix_structure_events_lookup
  ON structure_events (exchange, symbol, timeframe, ts DESC);
CREATE INDEX IF NOT EXISTS ix_structure_events_symbol_created
  ON structure_events (symbol, created_at DESC);

-- ── Extend liquidity_levels ───────────────────────────────────────────────
ALTER TABLE liquidity_levels ADD COLUMN IF NOT EXISTS strength_score DOUBLE PRECISION DEFAULT 0;
ALTER TABLE liquidity_levels ADD COLUMN IF NOT EXISTS taken_status BOOLEAN DEFAULT FALSE;
ALTER TABLE liquidity_levels ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;
ALTER TABLE liquidity_levels ADD COLUMN IF NOT EXISTS session_tag VARCHAR(32);
ALTER TABLE liquidity_levels ADD COLUMN IF NOT EXISTS details_json JSONB DEFAULT '{}';

-- ── Extend liquidity_sweeps (sweeps) ──────────────────────────────────────
ALTER TABLE liquidity_sweeps ADD COLUMN IF NOT EXISTS sweep_type VARCHAR(16)
  CHECK (sweep_type IS NULL OR sweep_type IN ('weak', 'strong'));
ALTER TABLE liquidity_sweeps ADD COLUMN IF NOT EXISTS liquidity_source VARCHAR(64);
ALTER TABLE liquidity_sweeps ADD COLUMN IF NOT EXISTS liquidity_level_id BIGINT REFERENCES liquidity_levels(id);
ALTER TABLE liquidity_sweeps ADD COLUMN IF NOT EXISTS score DOUBLE PRECISION DEFAULT 0
  CHECK (score IS NULL OR (score >= 0 AND score <= 100));
ALTER TABLE liquidity_sweeps ADD COLUMN IF NOT EXISTS details_json JSONB DEFAULT '{}';

-- ── Extend order_blocks ───────────────────────────────────────────────────
ALTER TABLE order_blocks ADD COLUMN IF NOT EXISTS strength_score DOUBLE PRECISION DEFAULT 0;
ALTER TABLE order_blocks ADD COLUMN IF NOT EXISTS mitigated BOOLEAN DEFAULT FALSE;
ALTER TABLE order_blocks ADD COLUMN IF NOT EXISTS mitigated_at TIMESTAMPTZ;
ALTER TABLE order_blocks ADD COLUMN IF NOT EXISTS has_displacement BOOLEAN DEFAULT FALSE;
ALTER TABLE order_blocks ADD COLUMN IF NOT EXISTS has_bos_after BOOLEAN DEFAULT FALSE;
ALTER TABLE order_blocks ADD COLUMN IF NOT EXISTS volume_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE order_blocks ADD COLUMN IF NOT EXISTS retest_confirmed BOOLEAN DEFAULT FALSE;
ALTER TABLE order_blocks ADD COLUMN IF NOT EXISTS details_json JSONB DEFAULT '{}';

-- ── Extend fair_value_gaps (fvgs) ─────────────────────────────────────────
ALTER TABLE fair_value_gaps ADD COLUMN IF NOT EXISTS gap_size DOUBLE PRECISION;
ALTER TABLE fair_value_gaps ADD COLUMN IF NOT EXISTS fill_percentage DOUBLE PRECISION DEFAULT 0;
ALTER TABLE fair_value_gaps ADD COLUMN IF NOT EXISTS filled_status BOOLEAN DEFAULT FALSE;
ALTER TABLE fair_value_gaps ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ;
ALTER TABLE fair_value_gaps ADD COLUMN IF NOT EXISTS details_json JSONB DEFAULT '{}';

-- ── Displacement records (Module 7) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS displacements (
  id BIGSERIAL PRIMARY KEY,
  exchange VARCHAR(32) NOT NULL DEFAULT 'binance',
  symbol VARCHAR(32) NOT NULL,
  timeframe VARCHAR(8) NOT NULL,
  ts BIGINT NOT NULL,
  direction VARCHAR(16) NOT NULL CHECK (direction IN ('bullish', 'bearish')),
  strength_score DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (strength_score >= 0 AND strength_score <= 100),
  atr_expansion BOOLEAN DEFAULT FALSE,
  volume_expansion BOOLEAN DEFAULT FALSE,
  oi_expansion BOOLEAN DEFAULT FALSE,
  body_pct DOUBLE PRECISION,
  details_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_displacements_lookup
  ON displacements (exchange, symbol, timeframe, ts DESC);

-- ── Explainable trade setups (primary AI training dataset) ────────────────
CREATE TABLE IF NOT EXISTS trade_setups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exchange VARCHAR(32) NOT NULL DEFAULT 'binance',
  symbol VARCHAR(32) NOT NULL,
  direction VARCHAR(8) NOT NULL CHECK (direction IN ('LONG', 'SHORT', 'BUY', 'SELL')),
  status VARCHAR(16) NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'accepted', 'rejected', 'executed', 'expired')),
  engine_version VARCHAR(16) NOT NULL DEFAULT 'v2',
  -- MTF snapshot
  tf_trend VARCHAR(8),
  tf_bias VARCHAR(8),
  tf_setup VARCHAR(8),
  tf_entry VARCHAR(8),
  mtf_aligned BOOLEAN DEFAULT FALSE,
  -- Levels
  entry_price DECIMAL(20, 8),
  stop_loss DECIMAL(20, 8),
  tp1 DECIMAL(20, 8),
  tp2 DECIMAL(20, 8),
  tp3 DECIMAL(20, 8),
  -- Scoring
  confluence_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  confluence_breakdown JSONB NOT NULL DEFAULT '{}',
  -- Full explainability (WHY)
  explanation JSONB NOT NULL DEFAULT '{}',
  rejection_reasons TEXT[],
  explainability_complete BOOLEAN DEFAULT FALSE,
  -- Links
  signal_id UUID REFERENCES signals(id),
  signal_candidate_id INTEGER REFERENCES signal_candidates(id),
  confluence_score_id BIGINT REFERENCES confluence_scores(id),
  -- Outcome (filled by signal_outcomes / trades)
  outcome VARCHAR(16),
  outcome_pnl DECIMAL(20, 8),
  outcome_r_multiple DECIMAL(10, 4),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_trade_setups_symbol_status
  ON trade_setups (symbol, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_trade_setups_score
  ON trade_setups (confluence_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_trade_setups_signal
  ON trade_setups (signal_id);

-- ── Rejected setups (mandatory for AI training on negatives) ──────────────
CREATE TABLE IF NOT EXISTS smc_rejections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  exchange VARCHAR(32) NOT NULL DEFAULT 'binance',
  symbol VARCHAR(32) NOT NULL,
  direction VARCHAR(8),
  confluence_score DOUBLE PRECISION,
  rejection_code VARCHAR(64) NOT NULL,
  rejection_reason TEXT NOT NULL,
  explanation JSONB DEFAULT '{}',
  confluence_breakdown JSONB DEFAULT '{}',
  engine_version VARCHAR(16) DEFAULT 'v2',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_smc_rejections_symbol
  ON smc_rejections (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_smc_rejections_code
  ON smc_rejections (rejection_code, created_at DESC);

-- ── Extend signals for institutional engine linkage ───────────────────────
ALTER TABLE signals ADD COLUMN IF NOT EXISTS engine_version VARCHAR(16) DEFAULT 'v1';
ALTER TABLE signals ADD COLUMN IF NOT EXISTS trade_setup_id UUID REFERENCES trade_setups(id);
ALTER TABLE signals ADD COLUMN IF NOT EXISTS confluence_score DOUBLE PRECISION;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS confluence_breakdown JSONB;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS explanation JSONB;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS mtf_aligned BOOLEAN;

-- ── Extend confluence_scores with engine version ──────────────────────────
ALTER TABLE confluence_scores ADD COLUMN IF NOT EXISTS engine_version VARCHAR(16) DEFAULT 'v1';
ALTER TABLE confluence_scores ADD COLUMN IF NOT EXISTS explainability_complete BOOLEAN DEFAULT FALSE;
ALTER TABLE confluence_scores ADD COLUMN IF NOT EXISTS trade_setup_id UUID REFERENCES trade_setups(id);
