-- Phase 10 — Enterprise Control Center

CREATE TABLE IF NOT EXISTS platform_services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    phase TEXT,
    state TEXT DEFAULT 'stopped',
    health TEXT DEFAULT 'unknown',
    version TEXT,
    uptime_sec INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    queue_size INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode TEXT NOT NULL DEFAULT 'demo',
    auto_trading BOOLEAN DEFAULT FALSE,
    manual_approval BOOLEAN DEFAULT TRUE,
    default_exchange TEXT DEFAULT 'binance',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS trade_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id TEXT NOT NULL UNIQUE,
    signal_id TEXT,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload JSONB DEFAULT '{}',
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_journal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id TEXT NOT NULL UNIQUE,
    trade_id TEXT,
    source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    strategy_name TEXT,
    signal_id TEXT,
    entry_price NUMERIC(18, 8),
    exit_price NUMERIC(18, 8),
    sl NUMERIC(18, 8),
    tp1 NUMERIC(18, 8),
    tp2 NUMERIC(18, 8),
    pnl_usd NUMERIC(18, 8),
    pnl_pct NUMERIC(10, 4),
    result TEXT,
    market_conditions JSONB DEFAULT '{}',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS trade_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id TEXT REFERENCES trade_journal(journal_id),
    event_type TEXT NOT NULL,
    detail JSONB DEFAULT '{}',
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    actor TEXT DEFAULT 'system',
    role TEXT DEFAULT 'admin',
    detail JSONB DEFAULT '{}',
    ip TEXT,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT,
    delivered BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange_id TEXT NOT NULL UNIQUE,
    connected BOOLEAN DEFAULT FALSE,
    api_ok BOOLEAN DEFAULT FALSE,
    ws_ok BOOLEAN DEFAULT FALSE,
    dry_run BOOLEAN DEFAULT TRUE,
    latency_ms INTEGER,
    error_count INTEGER DEFAULT 0,
    balance NUMERIC(18, 8),
    last_sync TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_journal_opened ON trade_journal(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_timeline_journal ON trade_timeline(journal_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_ts ON platform_audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_trade_approvals_status ON trade_approvals(status);
