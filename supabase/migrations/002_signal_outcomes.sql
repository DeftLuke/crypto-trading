-- Signal outcome tracking + lesson types
-- Run in Supabase SQL Editor

-- Track hypothetical outcomes for all signals (including skipped)
CREATE TABLE IF NOT EXISTS signal_outcomes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  check_minutes INTEGER NOT NULL CHECK (check_minutes IN (15, 20)),
  price_at_check DECIMAL(20, 8),
  outcome VARCHAR(20) CHECK (outcome IN ('win', 'loss', 'breakeven', 'pending', 'inconclusive')),
  hit_tp1 BOOLEAN DEFAULT FALSE,
  hit_sl BOOLEAN DEFAULT FALSE,
  max_favorable DECIMAL(20, 8),
  max_adverse DECIMAL(20, 8),
  r_multiple DECIMAL(10, 4),
  win_probability DECIMAL(5, 2),
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(signal_id, check_minutes)
);

CREATE INDEX idx_signal_outcomes_signal ON signal_outcomes(signal_id);
CREATE INDEX idx_signal_outcomes_outcome ON signal_outcomes(outcome);

-- Extend signals with outcome summary
ALTER TABLE signals ADD COLUMN IF NOT EXISTS user_action VARCHAR(20) DEFAULT 'pending'
  CHECK (user_action IN ('pending', 'executed', 'skipped', 'expired'));
ALTER TABLE signals ADD COLUMN IF NOT EXISTS final_outcome VARCHAR(20);
ALTER TABLE signals ADD COLUMN IF NOT EXISTS outcome_checked_at TIMESTAMPTZ;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS win_probability DECIMAL(5, 2);

-- Extend trade_lessons for skipped vs executed
ALTER TABLE trade_lessons ADD COLUMN IF NOT EXISTS signal_id UUID REFERENCES signals(id);
ALTER TABLE trade_lessons ADD COLUMN IF NOT EXISTS lesson_type VARCHAR(20) DEFAULT 'executed'
  CHECK (lesson_type IN ('executed', 'skipped', 'hypothetical'));
ALTER TABLE trade_lessons ADD COLUMN IF NOT EXISTS ai_model VARCHAR(50) DEFAULT 'qwen2.5:7b-instruct';
ALTER TABLE trade_lessons ADD COLUMN IF NOT EXISTS win_probability DECIMAL(5, 2);

CREATE INDEX idx_trade_lessons_type ON trade_lessons(lesson_type);
CREATE INDEX idx_trade_lessons_signal ON trade_lessons(signal_id);

ALTER TABLE signal_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service full access signal_outcomes" ON signal_outcomes FOR ALL USING (true);

-- Increment signal count on pair_stats when signal created
CREATE OR REPLACE FUNCTION increment_signal_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE pair_stats SET total_signals = total_signals + 1, updated_at = NOW()
  WHERE symbol = NEW.symbol;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_signal_count ON signals;
CREATE TRIGGER trg_signal_count
  AFTER INSERT ON signals
  FOR EACH ROW
  WHEN (NEW.direction IN ('BUY', 'SELL'))
  EXECUTE FUNCTION increment_signal_count();
