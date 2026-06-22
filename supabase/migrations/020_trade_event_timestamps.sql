-- Trade lifecycle timestamps + exchange PnL sync
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp1_hit_at TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS tp2_hit_at TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS sl_updated_at TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exchange_realized_pnl DECIMAL(20, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS last_mark_price DECIMAL(20, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS last_mark_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trades_closed_at ON trades(closed_at DESC NULLS LAST);
