-- Phase 3: Institutional Backtesting & Strategy Validation Engine

CREATE TABLE IF NOT EXISTS research_backtest_configs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  strategy_name TEXT NOT NULL DEFAULT 'smc-mtf',
  config_json JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_backtests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id INT REFERENCES research_backtest_configs(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('single', 'multi', 'portfolio', 'walkforward', 'monte_carlo')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'stopped')),
  exchange TEXT NOT NULL DEFAULT 'binance',
  timeframe TEXT NOT NULL DEFAULT '15m',
  symbols JSONB NOT NULL DEFAULT '[]',
  start_ts BIGINT,
  end_ts BIGINT,
  config_json JSONB NOT NULL DEFAULT '{}',
  progress_pct REAL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_backtest_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL DEFAULT 'standard',
  symbol TEXT,
  window_start_ts BIGINT,
  window_end_ts BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  metrics_json JSONB DEFAULT '{}',
  summary_json JSONB DEFAULT '{}',
  export_paths JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_backtest_trades (
  id BIGSERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  entry_time BIGINT NOT NULL,
  exit_time BIGINT,
  entry_price DOUBLE PRECISION NOT NULL,
  exit_price DOUBLE PRECISION,
  leverage REAL DEFAULT 1,
  margin_pct REAL,
  position_size_usd DOUBLE PRECISION,
  stop_loss DOUBLE PRECISION,
  take_profit DOUBLE PRECISION,
  fees_usd DOUBLE PRECISION DEFAULT 0,
  slippage_usd DOUBLE PRECISION DEFAULT 0,
  funding_fees_usd DOUBLE PRECISION DEFAULT 0,
  rsi DOUBLE PRECISION,
  ema20 DOUBLE PRECISION,
  ema50 DOUBLE PRECISION,
  ema100 DOUBLE PRECISION,
  ema200 DOUBLE PRECISION,
  bos BOOLEAN DEFAULT FALSE,
  choch BOOLEAN DEFAULT FALSE,
  fvg BOOLEAN DEFAULT FALSE,
  order_block BOOLEAN DEFAULT FALSE,
  liquidity_sweep BOOLEAN DEFAULT FALSE,
  session TEXT,
  result TEXT CHECK (result IN ('win', 'loss', 'breakeven', 'open')),
  profit_percent DOUBLE PRECISION,
  profit_usd DOUBLE PRECISION,
  mfe DOUBLE PRECISION,
  mae DOUBLE PRECISION,
  drawdown DOUBLE PRECISION,
  strategy_name TEXT,
  signal_confidence REAL,
  exit_reason TEXT,
  features_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_backtest_trade_metrics (
  id SERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  metrics_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (backtest_id, run_id)
);

CREATE TABLE IF NOT EXISTS research_backtest_daily_stats (
  id BIGSERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  stat_date DATE NOT NULL,
  pnl_usd DOUBLE PRECISION DEFAULT 0,
  pnl_pct DOUBLE PRECISION DEFAULT 0,
  trades INT DEFAULT 0,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  balance DOUBLE PRECISION,
  drawdown_pct DOUBLE PRECISION DEFAULT 0,
  stats_json JSONB DEFAULT '{}',
  UNIQUE (backtest_id, run_id, stat_date)
);

CREATE TABLE IF NOT EXISTS research_backtest_weekly_stats (
  id BIGSERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  year INT NOT NULL,
  week INT NOT NULL,
  pnl_usd DOUBLE PRECISION DEFAULT 0,
  trades INT DEFAULT 0,
  stats_json JSONB DEFAULT '{}',
  UNIQUE (backtest_id, run_id, year, week)
);

CREATE TABLE IF NOT EXISTS research_backtest_monthly_stats (
  id BIGSERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  year INT NOT NULL,
  month INT NOT NULL,
  pnl_usd DOUBLE PRECISION DEFAULT 0,
  trades INT DEFAULT 0,
  win_rate DOUBLE PRECISION,
  stats_json JSONB DEFAULT '{}',
  UNIQUE (backtest_id, run_id, year, month)
);

CREATE TABLE IF NOT EXISTS research_backtest_yearly_stats (
  id BIGSERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  year INT NOT NULL,
  pnl_usd DOUBLE PRECISION DEFAULT 0,
  trades INT DEFAULT 0,
  stats_json JSONB DEFAULT '{}',
  UNIQUE (backtest_id, run_id, year)
);

CREATE TABLE IF NOT EXISTS research_backtest_session_stats (
  id SERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  session TEXT NOT NULL,
  trades INT DEFAULT 0,
  wins INT DEFAULT 0,
  win_rate DOUBLE PRECISION,
  profit_factor DOUBLE PRECISION,
  net_profit DOUBLE PRECISION DEFAULT 0,
  stats_json JSONB DEFAULT '{}',
  UNIQUE (backtest_id, run_id, session)
);

CREATE TABLE IF NOT EXISTS research_backtest_symbol_stats (
  id SERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  trades INT DEFAULT 0,
  wins INT DEFAULT 0,
  win_rate DOUBLE PRECISION,
  profit_factor DOUBLE PRECISION,
  net_profit DOUBLE PRECISION DEFAULT 0,
  max_drawdown_pct DOUBLE PRECISION,
  stats_json JSONB DEFAULT '{}',
  UNIQUE (backtest_id, run_id, symbol)
);

CREATE TABLE IF NOT EXISTS research_backtest_smc_stats (
  id SERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  trades INT DEFAULT 0,
  wins INT DEFAULT 0,
  win_rate DOUBLE PRECISION,
  profit_factor DOUBLE PRECISION,
  net_profit DOUBLE PRECISION DEFAULT 0,
  stats_json JSONB DEFAULT '{}',
  UNIQUE (backtest_id, run_id, feature)
);

CREATE TABLE IF NOT EXISTS research_backtest_drawdown_stats (
  id SERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  max_drawdown_pct DOUBLE PRECISION,
  max_drawdown_usd DOUBLE PRECISION,
  avg_drawdown_pct DOUBLE PRECISION,
  longest_drawdown_bars INT,
  recovery_factor DOUBLE PRECISION,
  stats_json JSONB DEFAULT '{}',
  UNIQUE (backtest_id, run_id)
);

CREATE TABLE IF NOT EXISTS research_backtest_equity_curve (
  id BIGSERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  ts BIGINT NOT NULL,
  balance DOUBLE PRECISION NOT NULL,
  equity DOUBLE PRECISION NOT NULL,
  drawdown_pct DOUBLE PRECISION DEFAULT 0,
  daily_pnl DOUBLE PRECISION DEFAULT 0,
  UNIQUE (backtest_id, run_id, ts)
);

CREATE TABLE IF NOT EXISTS research_backtest_monte_carlo_results (
  id SERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  run_id UUID REFERENCES research_backtest_runs(id) ON DELETE CASCADE,
  simulations INT NOT NULL,
  worst_drawdown_pct DOUBLE PRECISION,
  expected_return_pct DOUBLE PRECISION,
  risk_of_ruin DOUBLE PRECISION,
  results_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_backtest_walkforward_results (
  id SERIAL PRIMARY KEY,
  backtest_id UUID NOT NULL REFERENCES research_backtests(id) ON DELETE CASCADE,
  fold INT NOT NULL,
  train_start_ts BIGINT,
  train_end_ts BIGINT,
  validate_start_ts BIGINT,
  validate_end_ts BIGINT,
  train_metrics_json JSONB DEFAULT '{}',
  validate_metrics_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS research_backtest_strategy_rankings (
  id SERIAL PRIMARY KEY,
  comparison_id UUID NOT NULL,
  strategy_name TEXT NOT NULL,
  backtest_id UUID REFERENCES research_backtests(id) ON DELETE SET NULL,
  rank INT,
  composite_score DOUBLE PRECISION,
  profitability_score DOUBLE PRECISION,
  drawdown_score DOUBLE PRECISION,
  sharpe_score DOUBLE PRECISION,
  consistency_score DOUBLE PRECISION,
  recovery_score DOUBLE PRECISION,
  metrics_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_research_backtests_status ON research_backtests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_research_backtest_runs_backtest ON research_backtest_runs(backtest_id);
CREATE INDEX IF NOT EXISTS ix_research_backtest_trades_backtest ON research_backtest_trades(backtest_id, symbol);
CREATE INDEX IF NOT EXISTS ix_research_backtest_trades_run ON research_backtest_trades(run_id);
CREATE INDEX IF NOT EXISTS ix_research_backtest_equity_ts ON research_backtest_equity_curve(backtest_id, run_id, ts);

INSERT INTO research_backtest_configs (name, strategy_name, config_json)
VALUES (
  'default_smc_mtf',
  'smc-mtf',
  '{"account_balance": 100, "risk_pct": 0.01, "margin_pct": 0.5, "leverage": 50, "timeframe": "15m", "fee_rate": 0.0004, "slippage_pct": 0.0002}'::jsonb
) ON CONFLICT (name) DO NOTHING;
