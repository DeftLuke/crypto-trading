-- Per-user demo + live Binance API keys and trading mode preference

ALTER TABLE user_api_keys
  ADD COLUMN IF NOT EXISTS account_mode TEXT NOT NULL DEFAULT 'demo';

UPDATE user_api_keys
SET account_mode = CASE WHEN testnet THEN 'demo' ELSE 'live' END
WHERE account_mode IS NULL OR account_mode = 'demo';

ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_user_id_exchange_key;

CREATE UNIQUE INDEX IF NOT EXISTS user_api_keys_user_exchange_mode_idx
  ON user_api_keys (user_id, exchange, account_mode);

ALTER TABLE user_api_keys
  DROP CONSTRAINT IF EXISTS user_api_keys_user_exchange_mode;

ALTER TABLE user_api_keys
  ADD CONSTRAINT user_api_keys_user_exchange_mode UNIQUE (user_id, exchange, account_mode);

CREATE TABLE IF NOT EXISTS user_trading_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trading_mode TEXT NOT NULL DEFAULT 'demo' CHECK (trading_mode IN ('demo', 'live')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_trading_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own trading settings"
  ON user_trading_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users upsert own trading settings"
  ON user_trading_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own api keys"
  ON user_api_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own api keys"
  ON user_api_keys FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
