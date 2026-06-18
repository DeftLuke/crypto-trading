-- Strategy catalog + enriched backtest results (native + QuantConnect imports)

CREATE TABLE IF NOT EXISTS strategy_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  source TEXT NOT NULL DEFAULT 'native'
    CHECK (source IN ('native', 'quantconnect', 'research', 'custom')),
  engine TEXT NOT NULL DEFAULT 'native',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'candidate', 'production', 'archived')),
  external_project_id TEXT,
  symbols JSONB DEFAULT '[]',
  config_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO strategy_catalog (id, name, description, source, engine, status)
VALUES (
  'smc-mtf',
  'SMC Multi-Timeframe',
  'Smart Money Concepts scanner — production crypto futures',
  'native',
  'native',
  'production'
) ON CONFLICT (id) DO NOTHING;

ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'native';
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS run_name TEXT;
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS return_pct DECIMAL(14,4);
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS sharpe DECIMAL(10,4);
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS psr DECIMAL(10,4);
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS score DECIMAL(10,2);
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS external_project_id TEXT;
ALTER TABLE backtest_runs ADD COLUMN IF NOT EXISTS promoted BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_backtest_runs_score ON backtest_runs(score DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_source ON backtest_runs(source, strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_catalog_status ON strategy_catalog(status);

ALTER TABLE strategy_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_strategy_catalog" ON strategy_catalog FOR ALL USING (true);
