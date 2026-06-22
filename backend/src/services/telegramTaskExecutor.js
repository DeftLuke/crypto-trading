/**
 * Owner-authorized Telegram tasks — scanner, demo signals, positions, risk, control.
 */
import { config } from '../config/index.js';
import { isTelegramOwner } from './telegramPermissions.js';
import { getScannerState, setScannerRunning } from './scannerState.js';
import { sendDemoSignalToTelegram, getLocalControlDashboard, updateLocalControlSettings } from './controlCenter.js';
import { formatOpenPositionsTelegram } from './paperSnapshot.js';
import { buildPlatformContext, formatPlatformOverviewTelegram, formatTradeExecutionFlowTelegram, isPlatformQuestion, isTradeExecutionQuestion } from './platformContext.js';
import { extractSymbolsFromText } from './personalAssistant.js';
import { logEvent } from './supabase.js';

function pickSymbol(text, fallback = 'BTCUSDT') {
  const symbols = extractSymbolsFromText(text);
  if (symbols.length) return symbols[0];
  return fallback;
}

async function formatPositions() {
  return formatOpenPositionsTelegram();
}

async function formatRisk() {
  const dash = await getLocalControlDashboard();
  const risk = dash.risk || {};
  const settings = dash.settings || {};
  return (
    `⚖️ <b>Risk status</b>\n` +
    `Mode: ${settings.mode || 'demo'} · Auto: ${settings.auto_trading ? 'ON' : 'OFF'}\n` +
    `Open: ${risk.open_trades ?? '—'} · Exposure: $${Number(risk.total_exposure || 0).toFixed(0)}\n` +
    `Margin: $${Number(risk.total_margin || 0).toFixed(0)} · Daily PnL: ${risk.daily_pnl ?? '—'} USDT`
  );
}

async function formatDashboard() {
  const dash = await getLocalControlDashboard();
  const scanner = dash.scanner || {};
  const risk = dash.risk || {};
  const settings = dash.settings || {};
  return (
    `🎛 <b>Control</b>\n` +
    `Scanner: ${scanner.running ? '🟢 ON' : '🔴 OFF'} · Pairs: ${scanner.pairs_scanned ?? 0}\n` +
    `Auto trade: ${settings.auto_trading ? 'ON' : 'OFF'} · Approval: ${settings.manual_approval ? 'manual' : 'auto'}\n` +
    `Open trades: ${risk.open_trades ?? 0} · Exposure $${Number(risk.total_exposure || 0).toFixed(0)}`
  );
}

/** Regex + keyword task router for authorized owner. Returns HTML string or null. */
export async function tryOwnerTasks(chatId, text) {
  if (!isTelegramOwner(chatId)) return null;
  if (config.telegram?.tasksEnabled === false) return null;

  const t = text.trim();
  const lower = t.toLowerCase();

  if (/^(start|run|enable|turn on|resume)\s+(the\s+)?scanner/.test(lower)
    || /^scanner\s+(on|start|run|enable|resume)\b/.test(lower)
    || lower === 'start scanner' || lower === 'scanner on') {
    await setScannerRunning(true);
    await logEvent('info', 'telegram', 'Scanner started via assistant', { chat_id: chatId });
    return '🟢 Scanner started.';
  }

  if (/^(stop|pause|disable|turn off)\s+(the\s+)?scanner/.test(lower)
    || /^scanner\s+(off|stop|pause|disable)\b/.test(lower)
    || lower === 'stop scanner' || lower === 'scanner off') {
    await setScannerRunning(false);
    await logEvent('info', 'telegram', 'Scanner stopped via assistant', { chat_id: chatId });
    return '🔴 Scanner stopped.';
  }

  if (/scanner\s+(status|state)|^(status|stats)\s*scanner/.test(lower) || lower === 'scanner status') {
    const st = await getScannerState();
    return (
      `📡 <b>Scanner</b>\nRunning: <b>${st.isRunning ? 'ON' : 'OFF'}</b>\n` +
      `Pairs scanned: ${st.pairsScanned || 0}\nLast signal: ${st.lastSignalSymbol || '—'}`
    );
  }

  if (/demo\s+signal|send\s+demo|^\/demo/.test(lower) || /demo\s+(for\s+)?\w+/.test(lower)) {
    const symbol = pickSymbol(t);
    await sendDemoSignalToTelegram(symbol, { force: true });
    await logEvent('info', 'telegram', `Demo signal ${symbol}`, { chat_id: chatId });
    return `📡 Demo signal sent for <b>${symbol}</b>. Check buttons above.`;
  }

  if (
    /^(?:new|fresh|latest|give me|send me|get)\s+(?:a\s+)?signal\b/i.test(t)
    || /^signal\s*(please|now)?\b/i.test(t)
    || /\b(?:new|fresh)\s+signal\b/i.test(t)
    || /\bsignal\s+(?:give|send|please)\b/i.test(t)
  ) {
    const symbol = pickSymbol(t);
    const result = await sendDemoSignalToTelegram(symbol, { force: true });
    await logEvent('info', 'telegram', `New signal ${symbol}`, { chat_id: chatId });
    if (!result.ok) {
      return `⚠️ No valid setup for ${symbol}. Sent forced demo if possible — try <code>demo signal BTC</code>.`;
    }
    const dir = result.signal?.direction === 'BUY' ? 'LONG' : 'SHORT';
    return `📡 <b>New signal</b> — ${result.signal?.symbol} ${dir} (${result.signal?.confidence}%)\nTap LONG/SHORT buttons above to trade.`;
  }

  if (isTradeExecutionQuestion(t)) {
    return formatTradeExecutionFlowTelegram();
  }

  if (isPlatformQuestion(t)) {
    const ctx = await buildPlatformContext();
    return formatPlatformOverviewTelegram(ctx);
  }

  if (/open\s+positions?|my\s+positions?|what('s| is)\s+open|show\s+positions?/.test(lower)) {
    return formatPositions();
  }

  if (/open\s+posit.*pnl|pnl.*open\s+posit|position\s+pnl|unrealized\s+pnl|open\s+pnl|positin\s+pnl/.test(lower)) {
    return formatPositions();
  }

  if (/exposure|risk\s+status|margin\s+usage|how much (am i|are we) (exposed|at risk)/.test(lower)) {
    return formatRisk();
  }

  if (/dashboard|control\s+(center|status|panel)|system\s+overview/.test(lower)) {
    return formatDashboard();
  }

  if (/enable\s+auto(\s|-)?trad|turn on auto(\s|-)?trad|auto trad(e|ing)\s+on/.test(lower)) {
    await updateLocalControlSettings({ auto_trading: true, manual_approval: false }, `telegram:${chatId}`);
    return '✅ Auto-trading enabled (demo mode). Signals can execute without manual approval.';
  }

  if (/disable\s+auto(\s|-)?trad|turn off auto(\s|-)?trad|auto trad(e|ing)\s+off/.test(lower)) {
    await updateLocalControlSettings({ auto_trading: false }, `telegram:${chatId}`);
    return '⏸ Auto-trading disabled. Signals still arrive — approve manually.';
  }

  if (/set\s+leverage\s+(\d+)/.test(lower)) {
    const lev = parseInt(lower.match(/set\s+leverage\s+(\d+)/)[1], 10);
    if (lev < 1 || lev > 125) return 'Leverage must be 1–125.';
    await updateLocalControlSettings({ default_leverage: lev }, `telegram:${chatId}`);
    return `✅ Default leverage set to ${lev}x.`;
  }

  return null;
}
