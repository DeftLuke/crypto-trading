-- Smart Wallet Scanner — Supabase optional persistence (JSON is primary store)
CREATE TABLE IF NOT EXISTS wallet_scan_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL,
  wallet_count INT DEFAULT 0,
  signals_count INT DEFAULT 0,
  results JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_consensus_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_mint TEXT NOT NULL,
  symbol TEXT,
  chain TEXT DEFAULT 'solana',
  wallet_count INT,
  avg_wallet_score NUMERIC,
  confidence INT,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_signals_mint ON wallet_consensus_signals(token_mint);
CREATE INDEX IF NOT EXISTS idx_wallet_signals_created ON wallet_consensus_signals(created_at DESC);

ALTER TABLE wallet_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_consensus_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallet_scan_runs_service ON wallet_scan_runs FOR ALL USING (true);
CREATE POLICY wallet_consensus_signals_service ON wallet_consensus_signals FOR ALL USING (true);
