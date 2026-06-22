-- Phase 2: Signal lineage, latency tracking, close factors (feeds Phase 4 loop)

ALTER TABLE signals ADD COLUMN IF NOT EXISTS signal_source TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS strategy_name TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS source_group TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS validation_score INTEGER;

ALTER TABLE telegram_signal_messages ADD COLUMN IF NOT EXISTS signal_id UUID REFERENCES signals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_signal_messages_signal ON telegram_signal_messages(signal_id);

ALTER TABLE trades ADD COLUMN IF NOT EXISTS signal_received_at TIMESTAMPTZ;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS execution_latency_ms INTEGER;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS signal_source TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_name TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS close_factors JSONB DEFAULT '{}';

ALTER TABLE trade_lessons ADD COLUMN IF NOT EXISTS close_factors JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(signal_source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_strategy ON signals(strategy_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_signal_source ON trades(signal_source, closed_at DESC);
