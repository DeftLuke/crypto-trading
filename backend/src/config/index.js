import dotenv from 'dotenv';
dotenv.config();

const PUBLIC_API = process.env.PUBLIC_API_URL || 'https://api.deftluke.online';
const PUBLIC_AI = process.env.AI_GATEWAY_PUBLIC_URL || 'https://ai.deftluke.online';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  publicApiUrl: PUBLIC_API,

  supabase: {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    databaseUrl: process.env.DATABASE_URL,
  },

  binance: {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    testnet: process.env.BINANCE_TESTNET === 'true',
    restUrl: process.env.BINANCE_TESTNET === 'true'
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com',
    wsUrl: process.env.BINANCE_TESTNET === 'true'
      ? 'wss://stream.binancefuture.com'
      : 'wss://fstream.binance.com',
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  ollama: {
    url: process.env.OLLAMA_URL || PUBLIC_AI,
    viaGateway: process.env.OLLAMA_VIA_GATEWAY !== 'false',
    model: process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct',
    embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
    fallbackModel: process.env.OLLAMA_FALLBACK_MODEL || 'mistral:7b',
  },

  ai: {
    gatewayUrl: process.env.AI_GATEWAY_URL || PUBLIC_AI,
    publicUrl: PUBLIC_AI,
    apiKey: process.env.AI_API_KEY || '',
  },

  n8n: {
    signalWebhook: process.env.N8N_SIGNAL_WEBHOOK_URL || 'https://n8n.deftluke.online/webhook/signal-notify',
    executeWebhook: process.env.N8N_EXECUTE_WEBHOOK_URL || 'https://n8n.deftluke.online/webhook/trade-execute',
    aiWebhook: process.env.N8N_AI_WEBHOOK_URL || 'https://n8n.deftluke.online/webhook/ai-assistant',
    baseUrl: process.env.N8N_BASE_URL || 'https://n8n.deftluke.online',
    apiKey: process.env.N8N_API_KEY || '',
  },

  search: {
    serperApiKey: process.env.SERPER_API_KEY || '',
    serpApiKey: process.env.SERPAPI_KEY || '',
  },

  coingecko: {
    apiKey: process.env.COINGECKO_API_KEY || '',
  },

  strategy: {
    minConfidence: parseInt(process.env.MIN_SIGNAL_CONFIDENCE || '70', 10),
    maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES || '5', 10),
    riskPerTrade: parseFloat(process.env.RISK_PER_TRADE || '0.01'),
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '0.03'),
    volatilityThreshold: parseFloat(process.env.VOLATILITY_THRESHOLD || '0.30'),
    entryTimeframe: process.env.DEFAULT_ENTRY_TIMEFRAME || '5m',
    scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || '60000', 10),
  },

  topPairs: [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
    'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT',
    'FILUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT',
  ],

  timeframes: {
    trend: '1h',
    confirm: '30m',
    obCheck: '15m',
    entry: ['5m', '3m'],
  },

  freqtrade: {
    url: process.env.FREQTRADE_URL || 'http://127.0.0.1:8081',
    publicUrl: process.env.FREQTRADE_PUBLIC_URL || '',
    username: process.env.FREQTRADE_API_USER || 'freqtrader',
    password: process.env.FREQTRADE_API_PASSWORD || '',
    enabled: process.env.FREQTRADE_ENABLED !== 'false',
    configPath: process.env.FREQTRADE_CONFIG_PATH || '',
  },
};
