-- E5 Institutional backtest: signals + strategy registry

CREATE TABLE IF NOT EXISTS institutional_strategies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  description TEXT,
  engine TEXT NOT NULL DEFAULT 'e5_institutional',
  config_json JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO institutional_strategies (id, name, description, engine)
VALUES (
  'E5_INSTITUTIONAL_V1',
  'TradeGPT E5 Institutional',
  'HTF trend + liquidity sweep + MSS + displacement + FVG/OB + AI score >= 85',
  'e5_institutional'
) ON CONFLICT (id) DO UPDATE SET updated_at = NOW();

CREATE TABLE IF NOT EXISTS research_backtest_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id UUID REFERENCES research_backtests(id) ON DELETE CASCADE,
  signal_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'E5_INSTITUTIONAL_V1',
  direction TEXT NOT NULL,
  ts BIGINT NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  stop_loss DOUBLE PRECISION,
  tp1 DOUBLE PRECISION,
  tp2 DOUBLE PRECISION,
  tp3 DOUBLE PRECISION,
  score DOUBLE PRECISION,
  score_breakdown JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_backtest_signals_bt ON research_backtest_signals(backtest_id);
CREATE INDEX IF NOT EXISTS idx_research_backtest_signals_symbol ON research_backtest_signals(symbol, ts DESC);

CREATE TABLE IF NOT EXISTS research_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id UUID REFERENCES research_backtests(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  symbol TEXT,
  total_trades INT DEFAULT 0,
  winning_trades INT DEFAULT 0,
  losing_trades INT DEFAULT 0,
  win_rate DOUBLE PRECISION,
  profit_factor DOUBLE PRECISION,
  sharpe_ratio DOUBLE PRECISION,
  sortino_ratio DOUBLE PRECISION,
  max_drawdown_pct DOUBLE PRECISION,
  net_profit DOUBLE PRECISION,
  expectancy DOUBLE PRECISION,
  metrics_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_research_perf_metrics_bt ON research_performance_metrics(backtest_id);
