-- Strategy system: backtests, user API keys, scanner state, learned patterns

CREATE TABLE IF NOT EXISTS backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '5m',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  total_trades INT DEFAULT 0,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0,
  profit_factor DECIMAL(10,4) DEFAULT 0,
  total_pnl DECIMAL(20,8) DEFAULT 0,
  max_drawdown DECIMAL(10,4) DEFAULT 0,
  avg_r_multiple DECIMAL(10,4) DEFAULT 0,
  results JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange TEXT NOT NULL DEFAULT 'binance',
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  testnet BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, exchange)
);

CREATE TABLE IF NOT EXISTS scanner_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_running BOOLEAN DEFAULT false,
  last_scan_at TIMESTAMPTZ,
  last_signal_symbol TEXT,
  pairs_scanned INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO scanner_state (id, is_running) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS learned_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_key TEXT NOT NULL UNIQUE,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('avoid', 'favor')),
  symbol TEXT,
  direction TEXT,
  reason TEXT,
  loss_count INT DEFAULT 0,
  win_count INT DEFAULT 0,
  confidence_penalty INT DEFAULT 0,
  source_lesson_id UUID REFERENCES trade_lessons(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy ON backtest_runs(strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learned_patterns_key ON learned_patterns(pattern_key);
CREATE INDEX IF NOT EXISTS idx_signals_symbol_status ON signals(symbol, status, created_at DESC);

ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;
