/**
 * Platform architecture + workflow summary for AI assistant (no secrets).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { getLocalControlDashboard, getLocalControlSettings } from './controlCenter.js';
import { checkOpenClawHealth } from './openclaw.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../../..');

const N8N_WORKFLOWS = [
  'tradegpt-unified-telegram.json — inbound Telegram + AI query',
  'trade-execution.json — trade approval webhooks',
  'signal-notify.json — scanner signal → Telegram',
  'ai-assistant.json — /webhook/ai-assistant',
  'platform-events.json — trade lifecycle events',
  'daily-summary.json — daily PnL summary',
];

const TRADE_FLOW = [
  'Market scanner (SMC-MTF) scans top USDT perpetual pairs',
  'Valid setup → signal row in Supabase + Telegram message with LONG/SHORT buttons',
  'User picks size → tradeExecution opens Binance position + exchange SL/TP1',
  'positionMonitor: TP1 30% → move SL to breakeven → TP2 40% → trail runner 30%',
  'Paper dashboard = DB trades merged with live Binance positions + unrealized PnL',
  'Telegram assistant: owner tasks (scanner, signals, positions) + OpenClaw for Q&A',
];

const TRADE_EXECUTION_FLOW = {
  summary: 'Unified pipeline in backend/src/services/tradeExecution.js + positionMonitor.js',
  steps: [
    '1. Signal: scanner/SMC-MTF → Supabase signals + Telegram LONG/SHORT buttons',
    '2. Approve: user picks size (default or manual USDT margin) → executionLock prevents duplicates',
    '3. Open: market entry on Binance Futures → place exchange SL + TP1 (30% qty) + TP2 (40% qty) conditional orders',
    '4. Telegram trade.activated: margin, leverage, SL, TP1, TP2, runner 30%, Binance verify SL×1 TP×1',
    '5. TP1 hit: close 30% → cancel/replace SL to breakeven → reposition TP2 on remaining ~70% runner',
    '6. TP2 hit: close 40% → SL moves to TP1 level (or BE) → ~30% runner left with trailing stop',
    '7. Trail: positionMonitor updates trailing SL on runner until stopped out or manual close',
    '8. Safety: tradeSafetyMonitor + tradeProtection verify missing SL/TP and auto-recover',
  ],
  key_files: [
    'backend/src/services/tradeExecution.js — open + scale-out plan',
    'backend/src/services/tradeProtection.js — exchange SL/TP verify',
    'backend/src/jobs/positionMonitor.js — TP1/TP2/trail phases',
    'backend/src/services/telegramTrade.js — button callbacks + sizing',
    'n8n/workflows/trade-execution.json — approval webhooks',
  ],
  sizing: '30% TP1 · 40% TP2 · 30% runner (trailing after TP2)',
};

export function isTradeExecutionQuestion(text = '') {
  const t = text.toLowerCase();
  return (
    /trade\s*exec|execu?t|exaction|execution (flow|process|task|pipeline)|how (does|do) (trade|trades) (execute|open|work)|read trade|tp1|tp2|runner|scale.?out|position monitor flow/.test(t)
    || (/give me (the )?flow|describe (the )?flow/.test(t) && /trade|exec|position|tp/.test(t))
  );
}

export function isPlatformQuestion(text = '') {
  const t = text.toLowerCase();
  return (
    isTradeExecutionQuestion(t)
    || /read (the )?(full )?(app|application|code|repo|project)|full application|whole application|application wor/.test(t)
    || /give me (the )?flow|how (its|it's|it is) working|how (does|do) .+ work/.test(t)
    || /application code|source code|read my (code|config|repo)|working flow|workflow config|architecture|how (does|do) (the |this |my )?(system|app|platform|stack|application)|n8n|docker|deploy|openclaw|backend structure|codebase/.test(t)
  );
}

export function formatTradeExecutionFlowTelegram() {
  const lines = [
    '⚙️ <b>Trade execution flow</b>',
    '',
    `<i>${TRADE_EXECUTION_FLOW.summary}</i>`,
    '',
    ...TRADE_EXECUTION_FLOW.steps,
    '',
    `<b>Sizing:</b> ${TRADE_EXECUTION_FLOW.sizing}`,
    '',
    '<b>Key files</b>',
    ...TRADE_EXECUTION_FLOW.key_files.map((f) => `• <code>${f}</code>`),
    '',
    'This matches the Telegram messages you see: Trade Activated → TP1 hit (30% + BE SL) → TP2 → trail.',
  ];
  return lines.join('\n').slice(0, 4000);
}

export async function buildPlatformContext() {
  const [dash, settings, openclaw] = await Promise.all([
    getLocalControlDashboard().catch(() => ({})),
    getLocalControlSettings().catch(() => ({})),
    checkOpenClawHealth().catch(() => ({ ok: false })),
  ]);

  const services = (dash.services || []).map((s) => ({
    id: s.service_id,
    name: s.name,
    status: s.status,
    phase: s.phase,
  }));

  let packageName = 'crypto-trading';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/package.json'), 'utf8'));
    packageName = pkg.name || packageName;
  } catch { /* optional */ }

  return {
    project: packageName,
    urls: {
      api: config.publicApiUrl,
      ai_gateway: config.ai?.gatewayUrl || null,
      openclaw: openclaw.ok ? openclaw.url : config.openclaw?.url,
    },
    stack: {
      llm_chat: 'OpenClaw /v1/chat/completions → DeftLLM (Telegram + dashboard assistant)',
      backend: 'Node backend-recovery (Express API, scanner, trade execution)',
      workflows: 'n8n (Telegram trigger, webhooks, notifications)',
      database: 'Supabase (signals, trades, lessons)',
      exchange: `Binance Futures (${config.binance?.tradingMode || 'demo'})`,
      research: config.researchApiUrl || 'offline fallback in backend',
    },
    repo_paths: {
      root: process.env.TRADEGPT_ROOT || '/home/kali/crypto-trading',
      backend_services: 'backend/src/services/',
      routes: 'backend/src/routes/api.js',
      strategies: 'backend/src/strategies/',
      n8n: 'n8n/workflows/',
      deploy: 'deploy/docker-compose.yml',
      openclaw_config: '~/.openclaw/openclaw.json',
      ai_prompts: 'ai-agent/prompts/',
    },
    n8n_workflows: N8N_WORKFLOWS,
    services,
    control_settings: {
      mode: settings.mode,
      auto_trading: settings.auto_trading,
      manual_approval: settings.manual_approval,
      scanner_enabled: settings.scanner_enabled,
      default_leverage: settings.default_leverage,
    },
    trade_flow: TRADE_FLOW,
    trade_execution_flow: TRADE_EXECUTION_FLOW,
    telegram_owner_tasks: [
      'scanner on / scanner off',
      'new signal / demo signal BTC',
      'open positions / open position pnl',
      'dashboard / risk status',
      'enable/disable auto trading',
    ],
    note: 'Full source files are on the VPS repo — assistant summarizes architecture; ask specific modules (scanner, execution, n8n) for detail.',
  };
}

export function formatPlatformOverviewTelegram(ctx) {
  const lines = [
    '🏗 <b>TradeGPT platform overview</b>',
    '',
    `<b>Stack</b>`,
    `• LLM: OpenClaw → DeftLLM`,
    `• API: ${ctx.urls?.api || 'backend'}`,
    `• DB: Supabase · Exchange: ${ctx.stack?.exchange}`,
    `• Workflows: n8n (${ctx.n8n_workflows?.length || 0} flows)`,
    '',
    `<b>Trade flow</b>`,
    ...ctx.trade_flow.map((s, i) => `${i + 1}. ${s.replace(/^\d+\.\s*/, '')}`),
    '',
    `<b>Repo</b> (${ctx.repo_paths?.root})`,
    `• ${ctx.repo_paths?.backend_services}`,
    `• ${ctx.repo_paths?.strategies}`,
    `• ${ctx.repo_paths?.deploy}`,
    '',
    `<b>Services</b> (${ctx.services?.filter((s) => s.status === 'running').length || 0} running)`,
    ...(ctx.services || []).slice(0, 6).map((s) => `• ${s.name}: ${s.status}`),
    '',
    `<b>Telegram tasks</b>: ${ctx.telegram_owner_tasks.join(' · ')}`,
    '',
    ctx.note,
  ];
  return lines.join('\n').slice(0, 4000);
}
