-- Trade Execution Audit Layer (Phase 1–9 foundation)
-- Extends trades; append-only events, partial closes, performance, learning dataset.

-- ── Extend trades (position header + sync health) ─────────────────────────────
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exchange VARCHAR(30) DEFAULT 'binance_demo';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS risk_percentage DECIMAL(8, 4);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS lifecycle_stage VARCHAR(30) DEFAULT 'OPEN';
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exchange_qty DECIMAL(20, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS db_exchange_sync_ok BOOLEAN DEFAULT TRUE;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS protection_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trades_lifecycle ON trades(lifecycle_stage) WHERE status IN ('open', 'partial');
CREATE INDEX IF NOT EXISTS idx_trades_sync_ok ON trades(db_exchange_sync_ok) WHERE db_exchange_sync_ok = FALSE;

-- ── Phase 2: trade_execution_events ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_execution_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  price DECIMAL(20, 8),
  quantity DECIMAL(20, 8),
  percentage DECIMAL(8, 4),
  realized_pnl DECIMAL(20, 8),
  fees DECIMAL(20, 8) DEFAULT 0,
  funding DECIMAL(20, 8) DEFAULT 0,
  old_sl DECIMAL(20, 8),
  new_sl DECIMAL(20, 8),
  remaining_qty DECIMAL(20, 8),
  exchange_order_id VARCHAR(80),
  exchange_response JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_events_trade ON trade_execution_events(trade_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trade_events_type ON trade_execution_events(event_type, created_at DESC);

-- ── Phase 4: trade_partial_closes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_partial_closes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  phase VARCHAR(20) NOT NULL CHECK (phase IN ('TP1', 'TP2', 'TP3', 'RUNNER', 'SL', 'MANUAL', 'LIQUIDATION')),
  close_pct DECIMAL(8, 4),
  closed_qty DECIMAL(20, 8) NOT NULL,
  remaining_qty DECIMAL(20, 8),
  exit_price DECIMAL(20, 8),
  realized_pnl DECIMAL(20, 8) DEFAULT 0,
  fees DECIMAL(20, 8) DEFAULT 0,
  source VARCHAR(20) DEFAULT 'fill' CHECK (source IN ('fill', 'inferred', 'manual')),
  exchange_trade_id VARCHAR(80),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_partials_trade ON trade_partial_closes(trade_id, created_at);

-- ── Phase 6: trade_performance ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id UUID NOT NULL UNIQUE REFERENCES trades(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  signal_source TEXT,
  strategy_name TEXT,
  gross_profit DECIMAL(20, 8) DEFAULT 0,
  fees DECIMAL(20, 8) DEFAULT 0,
  funding DECIMAL(20, 8) DEFAULT 0,
  net_profit DECIMAL(20, 8) DEFAULT 0,
  roi_pct DECIMAL(10, 4),
  win BOOLEAN,
  tp1_hit BOOLEAN DEFAULT FALSE,
  tp2_hit BOOLEAN DEFAULT FALSE,
  tp3_hit BOOLEAN DEFAULT FALSE,
  be_exit BOOLEAN DEFAULT FALSE,
  sl_exit BOOLEAN DEFAULT FALSE,
  exchange_synced BOOLEAN DEFAULT FALSE,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_perf_closed ON trade_performance(closed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_trade_perf_source ON trade_performance(signal_source, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_perf_win ON trade_performance(win, closed_at DESC);

-- ── Phase 9: trade_learning_dataset ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_learning_dataset (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id UUID NOT NULL UNIQUE REFERENCES trades(id) ON DELETE CASCADE,
  performance_id UUID REFERENCES trade_performance(id),
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_learning_created ON trade_learning_dataset(created_at DESC);

-- RLS (service role full access — match existing pattern)
ALTER TABLE trade_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_partial_closes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_learning_dataset ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service full access trade_execution_events" ON trade_execution_events FOR ALL USING (true);
CREATE POLICY "Service full access trade_partial_closes" ON trade_partial_closes FOR ALL USING (true);
CREATE POLICY "Service full access trade_performance" ON trade_performance FOR ALL USING (true);
CREATE POLICY "Service full access trade_learning_dataset" ON trade_learning_dataset FOR ALL USING (true);
