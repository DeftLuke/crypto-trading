-- Extended trade columns for sizing, leverage, and position tracking
ALTER TABLE trades ADD COLUMN IF NOT EXISTS leverage INTEGER;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS original_quantity DECIMAL(20, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS initial_stop_loss DECIMAL(20, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS notional_usdt DECIMAL(20, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS margin_usdt DECIMAL(20, 8);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS sizing_mode VARCHAR(30);
