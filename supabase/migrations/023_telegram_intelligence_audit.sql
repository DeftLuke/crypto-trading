-- Telegram Intelligence Audit Layer (Modules 1–5)
-- Raw archive, group memory, parsed output, structured rejections

CREATE TABLE IF NOT EXISTS telegram_raw_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID REFERENCES telegram_signal_sources(id) ON DELETE SET NULL,
  telegram_chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  text TEXT,
  image_url TEXT,
  image_base64 TEXT,
  image_mime TEXT DEFAULT 'image/jpeg',
  message_timestamp TIMESTAMPTZ,
  has_image BOOLEAN DEFAULT FALSE,
  processed_status TEXT DEFAULT 'pending'
    CHECK (processed_status IN ('pending', 'parsing', 'parsed', 'skipped', 'validated', 'rejected', 'archived')),
  inbox_message_id UUID REFERENCES telegram_signal_messages(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (telegram_chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_raw_messages_source
  ON telegram_raw_messages (source_id, message_timestamp DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_telegram_raw_messages_status
  ON telegram_raw_messages (processed_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_raw_messages_chat
  ON telegram_raw_messages (telegram_chat_id, message_id DESC);

CREATE TABLE IF NOT EXISTS telegram_group_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_id UUID NOT NULL REFERENCES telegram_signal_sources(id) ON DELETE CASCADE,
  group_title TEXT,
  group_username TEXT,
  common_patterns JSONB DEFAULT '[]',
  signal_keywords JSONB DEFAULT '[]',
  entry_format TEXT,
  sl_format TEXT,
  tp_format TEXT,
  emoji_patterns JSONB DEFAULT '[]',
  successful_examples JSONB DEFAULT '[]',
  format_profile JSONB DEFAULT '{}',
  learned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (source_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_group_memory_updated
  ON telegram_group_memory (updated_at DESC);

CREATE TABLE IF NOT EXISTS parsed_signals_raw (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raw_message_id UUID REFERENCES telegram_raw_messages(id) ON DELETE SET NULL,
  source_id UUID REFERENCES telegram_signal_sources(id) ON DELETE SET NULL,
  inbox_message_id UUID REFERENCES telegram_signal_messages(id) ON DELETE SET NULL,
  telegram_chat_id BIGINT,
  message_id BIGINT,
  original_message TEXT,
  original_text TEXT,
  has_image BOOLEAN DEFAULT FALSE,
  ai_output JSONB NOT NULL DEFAULT '{}',
  model_used TEXT,
  parser_used TEXT,
  parse_stage TEXT DEFAULT 'unknown'
    CHECK (parse_stage IN ('rule', 'ai', 'vision', 'mixed', 'unknown', 'failed')),
  confidence NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parsed_signals_raw_created
  ON parsed_signals_raw (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parsed_signals_raw_source
  ON parsed_signals_raw (source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parsed_signals_raw_chat
  ON parsed_signals_raw (telegram_chat_id, message_id DESC);

CREATE TABLE IF NOT EXISTS telegram_signal_rejections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parsed_signal_id UUID REFERENCES parsed_signals_raw(id) ON DELETE SET NULL,
  raw_message_id UUID REFERENCES telegram_raw_messages(id) ON DELETE SET NULL,
  inbox_message_id UUID REFERENCES telegram_signal_messages(id) ON DELETE SET NULL,
  signal_id UUID REFERENCES signals(id) ON DELETE SET NULL,
  source_id UUID REFERENCES telegram_signal_sources(id) ON DELETE SET NULL,
  telegram_chat_id BIGINT,
  message_id BIGINT,
  reject_stage TEXT NOT NULL
    CHECK (reject_stage IN ('parse', 'validation', 'execution', 'quality')),
  reject_reason TEXT,
  validation_score NUMERIC,
  failed_rules JSONB DEFAULT '[]',
  ai_output JSONB,
  validation_result JSONB,
  original_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_signal_rejections_created
  ON telegram_signal_rejections (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_signal_rejections_stage
  ON telegram_signal_rejections (reject_stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_signal_rejections_source
  ON telegram_signal_rejections (source_id, created_at DESC);

ALTER TABLE telegram_raw_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_group_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE parsed_signals_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_signal_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service full access telegram_raw_messages"
  ON telegram_raw_messages FOR ALL USING (true);
CREATE POLICY "Service full access telegram_group_memory"
  ON telegram_group_memory FOR ALL USING (true);
CREATE POLICY "Service full access parsed_signals_raw"
  ON parsed_signals_raw FOR ALL USING (true);
CREATE POLICY "Service full access telegram_signal_rejections"
  ON telegram_signal_rejections FOR ALL USING (true);
