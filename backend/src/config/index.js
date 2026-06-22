import dotenv from 'dotenv';
dotenv.config();

const PUBLIC_API = process.env.PUBLIC_API_URL || 'https://api.deftluke.online';
const PUBLIC_AI = process.env.AI_GATEWAY_PUBLIC_URL || 'https://ai.deftluke.online';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  publicApiUrl: PUBLIC_API,
  researchApiUrl: process.env.RESEARCH_API_URL || '',

  redis: {
    url: process.env.REDIS_URL || '',
  },

  supabase: {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    databaseUrl: process.env.DATABASE_URL,
  },

  binance: {
    tradingMode: process.env.BINANCE_TRADING_MODE
      || (process.env.BINANCE_DEMO === 'true' || process.env.BINANCE_TESTNET === 'true' ? 'demo' : 'live'),
    demoApiKey: process.env.BINANCE_DEMO_API_KEY || process.env.BINANCE_API_KEY,
    demoApiSecret: process.env.BINANCE_DEMO_API_SECRET || process.env.BINANCE_API_SECRET,
    demoPrivateKeyPath: process.env.BINANCE_DEMO_PRIVATE_KEY_PATH || process.env.BINANCE_PRIVATE_KEY_PATH || '',
    liveApiKey: process.env.BINANCE_LIVE_API_KEY || '',
    liveApiSecret: process.env.BINANCE_LIVE_API_SECRET || '',
    livePrivateKeyPath: process.env.BINANCE_LIVE_PRIVATE_KEY_PATH || '',
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    privateKeyPath: process.env.BINANCE_PRIVATE_KEY_PATH || process.env.BINANCE_DEMO_PRIVATE_KEY_PATH || '',
    signatureType: (process.env.BINANCE_SIGNATURE_TYPE || '').toLowerCase(),
    demo: process.env.BINANCE_DEMO === 'true',
    testnet: process.env.BINANCE_TESTNET === 'true' || process.env.BINANCE_DEMO === 'true',
    restUrl: process.env.BINANCE_REST_URL
      || (process.env.BINANCE_TESTNET === 'true' || process.env.BINANCE_DEMO === 'true'
        ? 'https://demo-fapi.binance.com'
        : 'https://fapi.binance.com'),
    wsUrl: process.env.BINANCE_TESTNET === 'true' || process.env.BINANCE_DEMO === 'true'
      ? 'wss://fstream.binancefuture.com'
      : 'wss://fstream.binance.com',
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    pollingEnabled: process.env.TELEGRAM_POLLING_ENABLED === 'true',
    delivery: process.env.TELEGRAM_DELIVERY || 'n8n',
    defaultLeverage: parseInt(process.env.TELEGRAM_DEFAULT_LEVERAGE || '50', 10),
    defaultMarginPct: parseFloat(process.env.TELEGRAM_DEFAULT_MARGIN_PCT || '0.01'),
    defaultPositionUsdt: parseFloat(process.env.TELEGRAM_DEFAULT_POSITION_USDT || '50'),
    /** Comma-separated Telegram user IDs allowed to chat (defaults to owner TELEGRAM_CHAT_ID). */
    allowedUsers: (process.env.TELEGRAM_ALLOWED_USERS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tasksEnabled: process.env.TELEGRAM_TASKS_ENABLED !== 'false',
    assistantEnabled: process.env.TELEGRAM_ASSISTANT_ENABLED !== 'false',
    assistantRestricted: process.env.TELEGRAM_ASSISTANT_RESTRICTED !== 'false',
  },

  externalSignals: {
    ingestionKey: process.env.EXTERNAL_SIGNAL_INGESTION_KEY || '',
    minValidationScore: parseInt(process.env.EXTERNAL_SIGNAL_MIN_VALIDATION_SCORE || '60', 10),
    telegramMinValidationScore: parseInt(process.env.TELEGRAM_MIN_VALIDATION_SCORE || '50', 10),
    maxSignalAgeMinutes: parseInt(process.env.EXTERNAL_SIGNAL_MAX_AGE_MINUTES || '15', 10),
    testMode: process.env.TG_TEST_MODE === 'true',
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
    visionModel: process.env.AI_VISION_MODEL || 'llava:7b',
  },

  /** OpenClaw gateway — primary text LLM for assistant + strategy chat (no vision). */
  openclaw: {
    url: process.env.OPENCLAW_GATEWAY_URL || 'http://host.docker.internal:18789',
    token: process.env.OPENCLAW_GATEWAY_TOKEN || '',
    model: process.env.OPENCLAW_MODEL || 'openclaw/default',
    enabled: process.env.OPENCLAW_ENABLED !== 'false',
  },

  n8n: {
    signalWebhook: process.env.N8N_SIGNAL_WEBHOOK_URL || 'https://n8n.deftluke.online/webhook/signal-notify',
    executeWebhook: process.env.N8N_EXECUTE_WEBHOOK_URL || 'https://n8n.deftluke.online/webhook/trade-execute',
    aiWebhook: process.env.N8N_AI_WEBHOOK_URL || 'https://n8n.deftluke.online/webhook/ai-assistant',
    eventWebhook: process.env.N8N_EVENT_WEBHOOK_URL || 'https://n8n.deftluke.online/webhook/tradegpt-event',
    walletScannerWebhook: process.env.N8N_WALLET_SCANNER_WEBHOOK_URL || '',
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

  dune: {
    apiKey: process.env.DUNE_API_KEY || '',
    solWalletsQueryId: process.env.DUNE_SOL_WALLETS_QUERY_ID || '',
    solTradesQueryId: process.env.DUNE_SOL_TRADES_QUERY_ID || '',
    solTradesRecentQueryId: process.env.DUNE_SOL_TRADES_RECENT_QUERY_ID || '3641835',
    solTokensQueryId: process.env.DUNE_SOL_TOKENS_QUERY_ID || '7714204',
    tronWalletsQueryId: process.env.DUNE_TRON_WALLETS_QUERY_ID || '4003316',
    tronTradesRecentQueryId: process.env.DUNE_TRON_TRADES_RECENT_QUERY_ID || '4009866',
    tronTradesQueryId: process.env.DUNE_TRON_TRADES_QUERY_ID || '4003641',
    baseDailyStatsQueryId: process.env.DUNE_BASE_DAILY_STATS_QUERY_ID || '5797617',
  },

  walletScanner: {
    enabled: process.env.WALLET_SCANNER_ENABLED === 'true',
    scanIntervalMs: parseInt(process.env.WALLET_SCANNER_INTERVAL_MS || '900000', 10),
    dailyRefreshHour: parseInt(process.env.WALLET_SCANNER_DAILY_HOUR || '6', 10),
    dataDir: process.env.WALLET_SCANNER_DATA_DIR || '',
    rules: {
      minWinRate: parseFloat(process.env.WALLET_MIN_WIN_RATE || '0.55'),
      minRoi90d: parseFloat(process.env.WALLET_MIN_ROI_90D || '50'),
      minProfitFactor: parseFloat(process.env.WALLET_MIN_PROFIT_FACTOR || '1.5'),
      minTrades: parseInt(process.env.WALLET_MIN_TRADES || '20', 10),
      maxWallets: parseInt(process.env.WALLET_MAX_COUNT || '1000', 10),
      targetWallets: parseInt(process.env.WALLET_TARGET_COUNT || '750', 10),
    },
    consensus: {
      minWallets: parseInt(process.env.WALLET_CONSENSUS_MIN || '5', 10),
      minAvgScore: parseInt(process.env.WALLET_CONSENSUS_MIN_SCORE || '80', 10),
      minWalletScore: parseInt(process.env.WALLET_CONSENSUS_WALLET_SCORE || '70', 10),
      windowHours: parseInt(process.env.WALLET_CONSENSUS_WINDOW_H || '2', 10),
    },
    liquidity: {
      minLiquidityUsd: parseInt(process.env.WALLET_MIN_LIQUIDITY_USD || '200000', 10),
      minVolume24hUsd: parseInt(process.env.WALLET_MIN_VOLUME_24H || '200000', 10),
      minFdvUsd: parseInt(process.env.WALLET_MIN_FDV_USD || '500000', 10),
    },
  },

  strategy: {
    minConfidence: parseInt(process.env.MIN_SIGNAL_CONFIDENCE || '70', 10),
    maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES || '5', 10),
    riskPerTrade: parseFloat(process.env.RISK_PER_TRADE || '0.01'),
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '0.03'),
    volatilityThreshold: parseFloat(process.env.VOLATILITY_THRESHOLD || '0.30'),
    entryTimeframe: process.env.DEFAULT_ENTRY_TIMEFRAME || '5m',
    scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || '60000', 10),
    backtestGateMinScore: parseInt(process.env.BACKTEST_GATE_MIN_SCORE || '55', 10),
    backtestGateMinWinRate: parseInt(process.env.BACKTEST_GATE_MIN_WIN_RATE || '45', 10),
    backtestGateMinDays: parseInt(process.env.BACKTEST_GATE_MIN_DAYS || '300', 10),
    backtestGateStrict: process.env.BACKTEST_GATE_STRICT === 'true',
  },

  /** Institutional SMC v2 — Python engine via research-api (CP0+) */
  institutionalSmc: {
    enabled: process.env.INSTITUTIONAL_SMC_ENABLED === 'true',
    engineVersion: process.env.SMC_ENGINE_VERSION || 'v2',
    minScore: parseInt(process.env.INSTITUTIONAL_SMC_MIN_SCORE || '80', 10),
    researchApiUrl: process.env.RESEARCH_API_URL || '',
    rejectOnEngineOffline: process.env.INSTITUTIONAL_SMC_REJECT_OFFLINE !== 'false',
    batchSize: parseInt(process.env.INSTITUTIONAL_SMC_BATCH_SIZE || '25', 10),
    timeframes: {
      trend: process.env.INSTITUTIONAL_SMC_TF_TREND || '1d',
      bias: process.env.INSTITUTIONAL_SMC_TF_BIAS || '4h',
      setup: process.env.INSTITUTIONAL_SMC_TF_SETUP || '1h',
      entry: process.env.INSTITUTIONAL_SMC_TF_ENTRY || '15m',
    },
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

  tradeSafety: {
    intervalMs: parseInt(process.env.TRADE_SAFETY_INTERVAL_MS || '30000', 10),
    recoveryEnabled: process.env.TRADE_SAFETY_RECOVERY !== 'false',
    emergencyCloseOnFailure: process.env.TRADE_SAFETY_EMERGENCY_CLOSE !== 'false',
  },
};
