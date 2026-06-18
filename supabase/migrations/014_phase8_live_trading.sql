-- Phase 8 — Institutional Live Trading Engine

CREATE TABLE IF NOT EXISTS live_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange TEXT NOT NULL DEFAULT 'binance',
    label TEXT NOT NULL DEFAULT 'Primary',
    balance NUMERIC(18, 8) NOT NULL DEFAULT 0,
    available NUMERIC(18, 8) DEFAULT 0,
    equity NUMERIC(18, 8) DEFAULT 0,
    margin_used NUMERIC(18, 8) DEFAULT 0,
    unrealized_pnl NUMERIC(18, 8) DEFAULT 0,
    daily_pnl NUMERIC(18, 8) DEFAULT 0,
    api_key_encrypted TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS live_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES live_accounts(id),
    exchange_order_id TEXT,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    order_type TEXT NOT NULL,
    quantity NUMERIC(18, 8),
    price NUMERIC(18, 8),
    stop_price NUMERIC(18, 8),
    status TEXT NOT NULL,
    filled_price NUMERIC(18, 8),
    filled_qty NUMERIC(18, 8),
    slippage_bps NUMERIC(8, 4),
    latency_ms INTEGER,
    strategy_name TEXT,
    reduce_only BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS live_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES live_accounts(id),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    strategy_name TEXT,
    strategy_id TEXT,
    signal_id TEXT,
    entry_price NUMERIC(18, 8) NOT NULL,
    current_price NUMERIC(18, 8),
    quantity NUMERIC(18, 8),
    notional NUMERIC(18, 8),
    leverage INTEGER DEFAULT 10,
    margin NUMERIC(18, 8),
    stop_loss NUMERIC(18, 8),
    take_profit NUMERIC(18, 8),
    tp1 NUMERIC(18, 8),
    tp2 NUMERIC(18, 8),
    trailing_stop NUMERIC(18, 8),
    liquidation_price NUMERIC(18, 8),
    funding_impact NUMERIC(18, 8) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    exchange TEXT DEFAULT 'binance',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS live_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES live_accounts(id),
    position_id UUID,
    signal_id TEXT,
    strategy_name TEXT,
    strategy_id TEXT,
    exchange_order_ids JSONB DEFAULT '[]',
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry_price NUMERIC(18, 8),
    exit_price NUMERIC(18, 8),
    quantity NUMERIC(18, 8),
    leverage INTEGER,
    margin NUMERIC(18, 8),
    stop_loss NUMERIC(18, 8),
    take_profit NUMERIC(18, 8),
    pnl_usd NUMERIC(18, 8),
    pnl_pct NUMERIC(10, 4),
    roe_pct NUMERIC(10, 4),
    fees NUMERIC(18, 8) DEFAULT 0,
    funding NUMERIC(18, 8) DEFAULT 0,
    duration_sec INTEGER,
    slippage_bps NUMERIC(8, 4),
    execution_delay_ms INTEGER,
    result TEXT,
    close_reason TEXT,
    opened_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event TEXT NOT NULL,
    symbol TEXT,
    strategy_name TEXT,
    detail JSONB DEFAULT '{}',
    latency_ms INTEGER,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    severity TEXT DEFAULT 'warning',
    detail JSONB DEFAULT '{}',
    account_id UUID,
    strategy_name TEXT,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES live_accounts(id),
    equity NUMERIC(18, 8),
    balance NUMERIC(18, 8),
    margin_used NUMERIC(18, 8),
    unrealized_pnl NUMERIC(18, 8),
    open_positions INTEGER,
    exposure NUMERIC(18, 8),
    risk_utilization_pct NUMERIC(8, 4),
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange TEXT NOT NULL,
    connected BOOLEAN DEFAULT FALSE,
    dry_run BOOLEAN DEFAULT TRUE,
    latency_ms INTEGER,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_name TEXT NOT NULL UNIQUE,
    backtest_passed BOOLEAN DEFAULT FALSE,
    walkforward_passed BOOLEAN DEFAULT FALSE,
    monte_carlo_passed BOOLEAN DEFAULT FALSE,
    paper_trading_passed BOOLEAN DEFAULT FALSE,
    risk_approved BOOLEAN DEFAULT FALSE,
    strategy_approved BOOLEAN DEFAULT FALSE,
    deployed_at TIMESTAMPTZ,
    deployed_by TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS circuit_breakers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    active BOOLEAN DEFAULT FALSE,
    reason TEXT,
    kill_switch BOOLEAN DEFAULT FALSE,
    trading_paused BOOLEAN DEFAULT FALSE,
    disabled_strategies JSONB DEFAULT '[]',
    triggered_at TIMESTAMPTZ,
    reset_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_positions_status ON live_positions(status);
CREATE INDEX IF NOT EXISTS idx_live_positions_symbol ON live_positions(symbol);
CREATE INDEX IF NOT EXISTS idx_live_trades_strategy ON live_trades(strategy_name);
CREATE INDEX IF NOT EXISTS idx_live_trades_closed ON live_trades(closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_logs_ts ON execution_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_ts ON risk_events(ts DESC);
