-- Trailing stop-loss: persist the peak (best) price reached since TP2 so the
-- runner trails from the real high-water mark instead of resetting to entry
-- on every monitor tick. Without this column the trailing engine silently
-- recomputes from entry_price each cycle (peak never saved).
ALTER TABLE trades ADD COLUMN IF NOT EXISTS peak_price DECIMAL(20, 8);
