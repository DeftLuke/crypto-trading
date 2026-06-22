/** Institutional analytics dashboard + unified navigation */
export function getPlatformUrl(path = '') {
  const base = (import.meta.env.VITE_PLATFORM_URL || '').replace(/\/$/, '');
  if (!base) {
    if (import.meta.env.DEV) return `http://localhost:3000${path}`;
    return '';
  }
  return `${base}${path}`;
}

export const NAV_SECTIONS = [
  {
    id: 'core',
    label: 'Workspace',
    items: [
      { id: 'home', label: 'Home', short: 'Home', glyph: '⌂' },
      { id: 'trading', label: 'Trading', short: 'Trade', glyph: '◫' },
      { id: 'wallet-scanner', label: 'Wallets', short: 'Wallets', glyph: '◎' },
      { id: 'strategy-stats', label: 'Strategy', short: 'Stats', glyph: '◧' },
      { id: 'strategy-tester', label: 'Backtest', short: 'Test', glyph: '◈' },
      { id: 'settings', label: 'Settings', short: 'Settings', glyph: '⚙' },
    ],
  },
  {
    id: 'platform',
    label: 'Institutional',
    items: [
      { id: 'platform-dashboard', label: 'Terminal', short: 'Term', glyph: '◉', platformPath: '/dashboard' },
      { id: 'platform-control', label: 'Control Center', short: 'Control', glyph: '⬡', platformPath: '/control' },
      { id: 'platform-telegram-signals', label: 'Telegram Sources', short: 'TG', glyph: '✉', platformPath: '/telegram-signals' },
      { id: 'platform-paper', label: 'Paper Trading', short: 'Paper', glyph: '▢', platformPath: '/paper' },
      { id: 'platform-live', label: 'Live Trading', short: 'Live', glyph: '●', platformPath: '/live', live: true },
      { id: 'platform-assistant', label: 'AI Assistant', short: 'AI', glyph: '◆', platformPath: '/assistant' },
      { id: 'platform-research', label: 'Research', short: 'Research', glyph: '◐', platformPath: '/research' },
      { id: 'platform-market-data', label: 'Market Data', short: 'Data', glyph: '▤', platformPath: '/market-data' },
      { id: 'platform-risk', label: 'Risk', short: 'Risk', glyph: '◑', platformPath: '/risk' },
      { id: 'platform-system', label: 'System', short: 'System', glyph: '⚡', platformPath: '/system' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);
export const PLATFORM_LINKS = NAV_SECTIONS.find((s) => s.id === 'platform')?.items || [];

export function getNavItem(pageId) {
  return ALL_NAV_ITEMS.find((i) => i.id === pageId);
}

export const SERVICE_TO_PAGE = {
  market_scanner: 'trading',
  'market-scanner': 'trading',
  signal_engine: 'trading',
  trade_bot: 'trading',
  position_monitor: 'trading',
  scheduler: 'trading',
  'tradegpt-backend': 'trading',
  analytics_dashboard: 'platform-dashboard',
  'analytics-dashboard': 'platform-dashboard',
  control_center: 'platform-control',
  'control-center': 'platform-control',
  telegram_bot: 'platform-telegram-signals',
  telegram_signal_ingestion: 'platform-telegram-signals',
  'telegram-signal-service': 'platform-telegram-signals',
  paper_trading: 'platform-paper',
  'paper-trading': 'platform-paper',
  live_trading: 'platform-live',
  'live-trading': 'platform-live',
  ai_assistant: 'platform-assistant',
  research_agent: 'platform-research',
  memory_layer: 'platform-research',
  data_warehouse: 'platform-research',
  backtest_engine: 'strategy-tester',
  operations_agent: 'platform-system',
  n8n_operations: 'platform-system',
};
