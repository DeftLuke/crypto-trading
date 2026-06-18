-- Telegram Signal Ingestion Service

CREATE TABLE IF NOT EXISTS telegram_signal_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  username TEXT,
  source_type TEXT DEFAULT 'unknown',
  provider_id TEXT,
  parser TEXT DEFAULT 'generic',
  is_followed BOOLEAN DEFAULT FALSE,
  can_read BOOLEAN DEFAULT TRUE,
  last_message_id BIGINT,
  last_synced_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_signal_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID REFERENCES telegram_signal_sources(id) ON DELETE SET NULL,
  telegram_chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  raw_message TEXT NOT NULL,
  parsed_signal JSONB,
  parse_status TEXT DEFAULT 'unparsed',
  api_result JSONB DEFAULT '{}',
  message_date TIMESTAMPTZ,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (telegram_chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_signal_sources_followed ON telegram_signal_sources(is_followed);
CREATE INDEX IF NOT EXISTS idx_telegram_signal_sources_title ON telegram_signal_sources(title);
CREATE INDEX IF NOT EXISTS idx_telegram_signal_messages_received ON telegram_signal_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_signal_messages_chat ON telegram_signal_messages(telegram_chat_id, message_id DESC);

ALTER TABLE telegram_signal_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_signal_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service full access telegram signal sources"
  ON telegram_signal_sources FOR ALL USING (true);

CREATE POLICY "Service full access telegram signal messages"
  ON telegram_signal_messages FOR ALL USING (true);
