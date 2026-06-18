import { config } from '../config/index.js';
import { emitN8nEvent } from './n8n.js';

let bot = null;
const pendingExecutions = new Map();

async function getBot() {
  if (!config.telegram.token) return null;
  if (!bot) {
    const TelegramBot = (await import('node-telegram-bot-api')).default;
    bot = new TelegramBot(config.telegram.token, { polling: false });
  }
  return bot;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatTelegramSignal(signal) {
  const dir = signal.direction === 'BUY' ? '🟢 LONG' : '🔴 SHORT';
  const reasons = signal.reasons || {};

  let breakdown = '';
  for (const [key, val] of Object.entries(reasons)) {
    const icon = val.status === 'pass' ? '✅' : val.status === 'fail' ? '❌' : '⚠️';
    breakdown += `${icon} <b>${escapeHtml(key.toUpperCase())}</b>: ${escapeHtml(val.detail)}\n`;
  }

  return `<b>🎯 SIGNAL — ${escapeHtml(signal.symbol)}</b>
Direction: ${dir}
Confidence: <b>${signal.confidence}/100</b>
Strategy: SMC-MTF

📊 <b>Breakdown:</b>
${breakdown}
💰 Entry: <code>${signal.entry_price}</code>
🛑 SL: <code>${signal.stop_loss}</code>
🎯 TP1: <code>${signal.tp1}</code> (1R — 30%)
🎯 TP2: <code>${signal.tp2}</code> (2R — 40%)
🎯 TP3: Trailing (30%)

⏰ Expires in 15 min`;
}

export function buildSignalKeyboard(signal, signalId) {
  const dirLabel = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
  return {
    inline_keyboard: [[
      { text: `✅ ${dirLabel} — Set Size`, callback_data: `execute:${signalId}` },
      { text: '⏭ SKIP', callback_data: `skip:${signalId}` },
    ]],
  };
}

/** Rich signal with inline buttons — sent once, directly via Telegram API. */
export async function sendSignalNotification(signal, signalId) {
  const telegram = await getBot();
  if (!telegram || !config.telegram.chatId) {
    console.log('[Telegram] Not configured — skipping signal notification');
    return null;
  }

  const text = formatTelegramSignal(signal);
  const keyboard = buildSignalKeyboard(signal, signalId);

  try {
    const msg = await telegram.sendMessage(config.telegram.chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
      disable_web_page_preview: true,
    });
    console.log(`[Telegram] Signal sent: ${signal.symbol} ${signal.direction}`);
    return msg.message_id;
  } catch (err) {
    console.error('[Telegram] sendSignalNotification failed:', err.message);
    try {
      const msg = await telegram.sendMessage(config.telegram.chatId, text.replace(/<[^>]+>/g, ''), {
        reply_markup: keyboard,
      });
      return msg.message_id;
    } catch (err2) {
      console.error('[Telegram] Plain fallback failed:', err2.message);
      return null;
    }
  }
}

export async function sendTelegramMessage(chatId, text, options = {}) {
  const telegram = await getBot();
  if (!telegram || !chatId) return null;
  try {
    return await telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options,
    });
  } catch {
    return await telegram.sendMessage(chatId, text.replace(/<[^>]+>/g, ''), options);
  }
}

export async function sendTradeLifecycle(eventType, payload = {}) {
  const { trade, signal, message, margin_usdt, leverage, notional_usdt } = payload;
  let text = '';

  if (eventType === 'trade.activated') {
    text =
      `🟢 <b>Trade Activated</b>\n\n` +
      `${signal?.symbol || trade?.symbol} ${signal?.direction || trade?.direction}\n` +
      `Entry: <code>${trade?.entry_price || signal?.entry_price}</code>\n` +
      (margin_usdt ? `Size: $${margin_usdt} margin · ${leverage}x · ~$${notional_usdt} pos\n` : '') +
      `SL: <code>${signal?.stop_loss || trade?.stop_loss}</code>\n` +
      `TP1: <code>${signal?.tp1 || trade?.tp1 || '—'}</code> (30%)\n` +
      `TP2: <code>${signal?.tp2 || trade?.tp2 || '—'}</code> (40%)\n` +
      `TP3: trailing runner (30%)`;
  } else if (eventType === 'trade.closed') {
    const pnl = trade?.pnl ?? 0;
    const emoji = pnl >= 0 ? '🟢' : '🔴';
    text =
      `${emoji} <b>Trade Closed</b>\n\n` +
      `${trade?.symbol} ${trade?.direction}\n` +
      `${message || ''}\n` +
      `PnL: <b>${pnl >= 0 ? '+' : ''}${Number(pnl).toFixed(2)} USDT</b>`;
  } else if (eventType === 'trade.update') {
    text = `📈 <b>Trade Update</b>\n\n${trade?.symbol}\n${message || ''}`;
  } else {
    text = message || eventType;
  }

  await sendTelegramMessage(config.telegram.chatId, text);
}

export async function sendTradeUpdate(trade, message) {
  await sendTradeLifecycle('trade.update', { trade, message });
}

export async function sendAlert(message) {
  await sendTelegramMessage(config.telegram.chatId, message);
}

export async function sendStartupNotification() {
  await sendAlert(
    '<b>✅ TradeGPT Online</b>\n\n' +
    'Scanner <b>ON</b> — signals arrive with LONG/SHORT buttons.\n' +
    '📷 Send a <b>chart screenshot</b> to scan trend & levels (vision AI).\n' +
    'Tap direction → Default or Manual size.\n\n' +
    'All trade updates sent here automatically.'
  );
}

export async function askPositionSize(chatId, signal, signalId) {
  pendingExecutions.set(chatId, { signalId, signal, mode: 'size' });
  const dir = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
  const lev = config.telegram.defaultLeverage || 50;
  const pct = ((config.telegram.defaultMarginPct || 0.01) * 100).toFixed(0);

  await sendTelegramMessage(chatId,
    `<b>📐 Position Size — ${signal.symbol} ${dir}</b>\n\nChoose how to enter this trade:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: `⚡ Default (${pct}% margin · ${lev}x)`, callback_data: `default:${signalId}` }],
          [{ text: '✏️ Manual Size', callback_data: `manual:${signalId}` }],
        ],
      },
    },
  );
}

export async function askManualSize(chatId, signal, signalId) {
  pendingExecutions.set(chatId, { signalId, signal, mode: 'manual' });
  const dir = signal.direction === 'BUY' ? 'LONG' : 'SHORT';

  await sendTelegramMessage(chatId,
    `<b>✏️ Manual Size — ${signal.symbol} ${dir}</b>\n\n` +
    'Type margin in USDT (e.g. <code>25</code>)\n' +
    `Leverage: ${config.telegram.defaultLeverage || 50}x\n\nOr pick a preset:`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '$10', callback_data: `size:${signalId}:10` },
            { text: '$25', callback_data: `size:${signalId}:25` },
            { text: '$50', callback_data: `size:${signalId}:50` },
          ],
          [
            { text: '$100', callback_data: `size:${signalId}:100` },
            { text: '$200', callback_data: `size:${signalId}:200` },
          ],
        ],
      },
    },
  );
}

export function getPendingExecution(chatId) {
  return pendingExecutions.get(chatId);
}

export function clearPendingExecution(chatId) {
  pendingExecutions.delete(chatId);
}

export async function sendWalletConsensusAlert(signal) {
  const telegram = await getBot();
  if (!telegram || !config.telegram.chatId) return null;

  const wallets = (signal.wallets || [])
    .slice(0, 8)
    .map((w) => `• <code>${escapeHtml(w.address.slice(0, 8))}…</code> score ${w.score}`)
    .join('\n');

  const text = `<b>🐋 SMART WALLET CONSENSUS</b>\n\n<b>Token:</b> ${escapeHtml(signal.symbol || '')}\n<b>Confidence:</b> ${signal.confidence}/100\n\n${wallets}`;
  return telegram.sendMessage(config.telegram.chatId, text, { parse_mode: 'HTML' });
}

export async function setupTelegramPolling(onCallback) {
  const telegram = await getBot();
  if (!telegram) return;
  telegram.startPolling();
  telegram.on('callback_query', async (query) => {
    const { handleTelegramCallback, parseCallbackData } = await import('./telegramTrade.js');
    const parsed = parseCallbackData(query.data);
    const result = await handleTelegramCallback({ ...parsed, chat_id: query.message?.chat?.id });
    await telegram.answerCallbackQuery(query.id, { text: result.answer || (result.ok ? 'OK' : 'Error') });
    if (result.message) await sendTelegramMessage(query.message?.chat?.id, result.message);
  });
  telegram.on('message', async (msg) => {
    const hasImage = Boolean(msg.photo?.length)
      || Boolean(msg.document?.mime_type?.startsWith('image/'));
    if (hasImage) {
      await handleTelegramInboundPhoto(msg);
      return;
    }
    if (msg.text) await handleTelegramInboundMessage(msg);
  });
  console.log('[Telegram] Bot polling started (callbacks + AI chat)');
}

/** Handle plain-text messages and slash commands when n8n does not own inbound Telegram. */
export async function handleTelegramInboundMessage(msg) {
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  if (!text) return;

  const pending = pendingExecutions.get(chatId);
  if (pending && !text.startsWith('/')) {
    const { handleTelegramCallback } = await import('./telegramTrade.js');
    const result = await handleTelegramCallback({ action: 'text_size', chat_id: chatId, text });
    if (result.message) await sendTelegramMessage(chatId, result.message);
    return;
  }

  const cmd = text.split(/\s+/)[0]?.toLowerCase();
  if (cmd === '/start') {
    await sendTelegramMessage(chatId,
      '🤖 <b>TradeGPT</b>\n\n' +
      '📷 <b>Send a chart screenshot</b> (TradingView/Binance) — I will scan trend, levels & setups.\n' +
      'Add a caption like "scan this" or "is this a long?"\n\n' +
      'Tap signal buttons: LONG/SHORT → Default or Manual size.\n' +
      '/stats · /demo BTCUSDT · /stop');
    return;
  }
  if (cmd === '/stats') {
    try {
      const { getScannerState } = await import('./scannerState.js');
      const st = await getScannerState();
      await sendTelegramMessage(chatId,
        `📊 <b>Scanner</b>\nRunning: <b>${st.isRunning ? 'ON' : 'OFF'}</b>\n` +
        `Pairs scanned: ${st.pairsScanned || 0}\nLast: ${st.lastSignalSymbol || '—'}`);
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ ${err.message}`);
    }
    return;
  }
  if (cmd === '/stop') {
    try {
      const { setScannerRunning } = await import('./scannerState.js');
      setScannerRunning(false);
      await sendTelegramMessage(chatId, '⏹ Scanner stopped.');
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ ${err.message}`);
    }
    return;
  }
  if (cmd === '/demo') {
    try {
      const symbol = (text.split(/\s+/)[1] || 'BTCUSDT').toUpperCase();
      const { sendDemoSignalToTelegram } = await import('./controlCenter.js');
      await sendDemoSignalToTelegram(symbol, { force: true });
      await sendTelegramMessage(chatId, `📡 Demo signal sent for <b>${symbol}</b>`);
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ ${err.message}`);
    }
    return;
  }
  if (text.startsWith('/')) return;

  try {
    const telegram = await getBot();
    if (telegram) await telegram.sendChatAction(chatId, 'typing');
    const { askPersonalAssistant } = await import('./personalAssistant.js');
    const result = await askPersonalAssistant(chatId, text);
    const answer = String(result.answer || 'No response').slice(0, 4000);
    await sendTelegramMessage(chatId, answer);
  } catch (err) {
    console.error('[Telegram] AI chat failed:', err.message);
    await sendTelegramMessage(chatId, `❌ AI unavailable: ${err.message}`);
  }
}

/** Chart screenshot → vision AI market scan (+ optional trade buttons). */
export async function handleTelegramInboundPhoto(msg) {
  const chatId = msg.chat.id;
  const caption = String(msg.caption || msg.text || '').trim();

  try {
    const telegram = await getBot();
    if (!telegram) throw new Error('Telegram bot not configured');
    await telegram.sendChatAction(chatId, 'upload_photo');

    const { analyzeTelegramChart, downloadTelegramImageBase64 } = await import('./chartVision.js');
    const imageB64 = await downloadTelegramImageBase64(telegram, msg);
    if (!imageB64) {
      await sendTelegramMessage(chatId, '❌ Could not read that image. Send a PNG/JPG chart screenshot.');
      return;
    }

    const result = await analyzeTelegramChart(imageB64, caption);

    let replyMarkup;
    if (result.signal) {
      const { saveSignal } = await import('./supabase.js');
      const { data: saved } = await saveSignal(result.signal);
      const signalId = saved?.id || `chart-${Date.now()}`;
      replyMarkup = buildSignalKeyboard(result.signal, signalId);
    }

    await sendTelegramMessage(chatId, result.message, replyMarkup ? { reply_markup: replyMarkup } : {});
  } catch (err) {
    console.error('[Telegram] Chart scan failed:', err.message);
    await sendTelegramMessage(chatId,
      `❌ Chart scan failed: ${err.message}\n\n` +
      'Tip: send a clear TradingView screenshot (max 4MB). Vision model: llava:7b on AI gateway.');
  }
}
