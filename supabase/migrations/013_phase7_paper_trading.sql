-- Phase 7 — Paper Trading Engine

CREATE TABLE IF NOT EXISTS paper_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT 'Default Paper',
    balance NUMERIC(18, 8) NOT NULL DEFAULT 1000,
    equity NUMERIC(18, 8) NOT NULL DEFAULT 1000,
    margin_used NUMERIC(18, 8) DEFAULT 0,
    unrealized_pnl NUMERIC(18, 8) DEFAULT 0,
    daily_pnl NUMERIC(18, 8) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES paper_accounts(id),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    order_type TEXT NOT NULL,
    quantity NUMERIC(18, 8),
    price NUMERIC(18, 8),
    status TEXT NOT NULL,
    filled_price NUMERIC(18, 8),
    slippage_bps NUMERIC(8, 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES paper_accounts(id),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    strategy_name TEXT,
    entry_price NUMERIC(18, 8) NOT NULL,
    quantity NUMERIC(18, 8),
    leverage INTEGER DEFAULT 10,
    margin NUMERIC(18, 8),
    stop_loss NUMERIC(18, 8),
    take_profit NUMERIC(18, 8),
    status TEXT NOT NULL DEFAULT 'open',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS paper_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES paper_accounts(id),
    position_id UUID,
    signal_id TEXT,
    strategy_name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry_price NUMERIC(18, 8),
    exit_price NUMERIC(18, 8),
    quantity NUMERIC(18, 8),
    leverage INTEGER,
    margin NUMERIC(18, 8),
    pnl_usd NUMERIC(18, 8),
    pnl_pct NUMERIC(10, 4),
    roe_pct NUMERIC(10, 4),
    duration_sec INTEGER,
    session TEXT,
    confidence NUMERIC(6, 2),
    smc JSONB DEFAULT '{}',
    indicators JSONB DEFAULT '{}',
    result TEXT,
    close_reason TEXT,
    opened_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_strategy ON paper_trades(strategy_name, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol ON paper_trades(symbol, closed_at DESC);
CREATE INDEX IF NOT EXISTS idx_paper_positions_status ON paper_positions(status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS paper_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_name TEXT NOT NULL,
    metrics JSONB NOT NULL DEFAULT '{}',
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_name TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'warning', 'reject')),
    approval_score NUMERIC(6, 2),
    metrics JSONB DEFAULT '{}',
    notes JSONB DEFAULT '[]',
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strategy_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_name TEXT NOT NULL UNIQUE,
    approved BOOLEAN NOT NULL DEFAULT false,
    approval_score NUMERIC(6, 2),
    approved_at TIMESTAMPTZ,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES paper_accounts(id),
    balance NUMERIC(18, 8),
    equity NUMERIC(18, 8),
    open_positions INTEGER,
    daily_pnl NUMERIC(18, 8),
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID,
    event_type TEXT NOT NULL,
    severity TEXT DEFAULT 'medium',
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_daily_statistics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID,
    trade_date DATE NOT NULL,
    trades INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    net_pnl NUMERIC(18, 8) DEFAULT 0,
    UNIQUE(account_id, trade_date)
);

COMMENT ON TABLE paper_trades IS 'Phase 7 paper trade journal — mirrors live trade schema for Phase 8';
