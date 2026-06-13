import { config } from '../config/index.js';

let bot = null;

/** Pending position-size requests: chatId -> { signalId, signal } */
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

export async function sendSignalNotification(signal, signalId) {
  const telegram = await getBot();
  if (!telegram || !config.telegram.chatId) {
    console.log('[Telegram] Not configured — skipping notification');
    return null;
  }

  const text = formatTelegramSignal(signal);
  const dirLabel = signal.direction === 'BUY' ? 'LONG' : 'SHORT';

  const keyboard = {
    inline_keyboard: [[
      { text: `✅ ${dirLabel} — Set Size`, callback_data: `execute:${signalId}` },
      { text: '⏭ SKIP', callback_data: `skip:${signalId}` },
    ]],
  };

  try {
    const msg = await telegram.sendMessage(config.telegram.chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    console.log(`[Telegram] Signal sent: ${signal.symbol} ${signal.direction}`);
    return msg.message_id;
  } catch (err) {
    console.error('[Telegram] sendSignalNotification failed:', err.message);
    try {
      const plain = text.replace(/<[^>]+>/g, '');
      const msg = await telegram.sendMessage(config.telegram.chatId, plain, {
        reply_markup: keyboard,
      });
      return msg.message_id;
    } catch (err2) {
      throw err2;
    }
  }
}

function formatTelegramSignal(signal) {
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

export async function sendTradeUpdate(trade, message) {
  const telegram = await getBot();
  if (!telegram || !config.telegram.chatId) return;

  const text = `<b>📈 Trade Update — ${trade.symbol}</b>
${message}
Status: ${trade.status}
PnL: ${trade.pnl ? trade.pnl.toFixed(2) + ' USDT' : 'Open'}`;

  await telegram.sendMessage(config.telegram.chatId, text, { parse_mode: 'HTML' });
}

export async function sendAlert(message) {
  const telegram = await getBot();
  if (!telegram || !config.telegram.chatId) return;
  try {
    await telegram.sendMessage(config.telegram.chatId, message, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[Telegram] sendAlert failed:', err.message);
  }
}

export async function sendStartupNotification() {
  await sendAlert(
    '<b>✅ TradeGPT Online</b>\n\n' +
    'Scanner is <b>OFF</b> by default.\n' +
    '• <code>/startT</code> — start signal scanner\n' +
    '• <code>/stop</code> — stop scanner\n' +
    '• <code>/stats</code> — pair performance\n' +
    '• Natural language — ask about any coin'
  );
}

export async function askPositionSize(chatId, signal, signalId) {
  const telegram = await getBot();
  if (!telegram) return;

  pendingExecutions.set(chatId, { signalId, signal });

  const dir = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
  await telegram.sendMessage(chatId,
    `<b>📐 Position Size — ${signal.symbol} ${dir}</b>\n\n` +
    'Enter position size in USDT (margin) or coin quantity.\n' +
    'Examples: <code>50</code> (USDT) or <code>0.01 BTC</code>\n\n' +
    'Or pick a preset:',
  {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '$25', callback_data: `size:${signalId}:25` },
          { text: '$50', callback_data: `size:${signalId}:50` },
          { text: '$100', callback_data: `size:${signalId}:100` },
        ],
        [
          { text: '$200', callback_data: `size:${signalId}:200` },
          { text: '$500', callback_data: `size:${signalId}:500` },
        ],
      ],
    },
  });
}

export function getPendingExecution(chatId) {
  return pendingExecutions.get(chatId);
}

export function clearPendingExecution(chatId) {
  pendingExecutions.delete(chatId);
}

export async function setupTelegramPolling(onCallback) {
  const telegram = await getBot();
  if (!telegram) return;

  telegram.startPolling();

  telegram.on('callback_query', async (query) => {
    const data = query.data;
    const chatId = query.message?.chat?.id;

    if (data.startsWith('execute:')) {
      const signalId = data.split(':')[1];
      await telegram.answerCallbackQuery(query.id, { text: 'Enter position size...' });
      await onCallback('execute_prompt', signalId, query);
    } else if (data.startsWith('size:')) {
      const [, signalId, usdtAmount] = data.split(':');
      await telegram.answerCallbackQuery(query.id, { text: `Executing $${usdtAmount}...` });
      await onCallback('execute_size', signalId, { ...query, usdtAmount: parseFloat(usdtAmount) });
    } else if (data.startsWith('skip:')) {
      const signalId = data.split(':')[1];
      await telegram.answerCallbackQuery(query.id, { text: 'Signal skipped' });
      await onCallback('skip', signalId, query);
    }
  });

  telegram.on('message', async (msg) => {
    if (!msg.text) return;
    const text = msg.text.trim();
    const chatId = msg.chat.id;

    if (text === '/startT' || text === '/startt') {
      await onCallback('scanner_start', null, msg);
      return;
    }

    if (text === '/stop' || text === '/stopT' || text === '/stopt') {
      await onCallback('scanner_stop', null, msg);
      return;
    }

    if (text.startsWith('/start')) {
      await telegram.sendMessage(chatId,
        '🤖 <b>TradeGPT — Trading Assistant</b>\n\n' +
        '<b>Scanner:</b>\n' +
        '• <code>/startT</code> — start signal scanner\n' +
        '• <code>/stop</code> — stop scanner\n\n' +
        '<b>Analysis:</b>\n' +
        '• Ask about any coin naturally\n' +
        '• <code>/stats</code> <code>/wins</code> <code>/losses</code> <code>/skipped</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const pending = pendingExecutions.get(chatId);
    if (pending && !text.startsWith('/')) {
      const sizeMatch = text.match(/^([\d.]+)\s*(usdt|usd)?$/i);
      if (sizeMatch) {
        pendingExecutions.delete(chatId);
        await onCallback('execute_size', pending.signalId, {
          ...msg,
          usdtAmount: parseFloat(sizeMatch[1]),
        });
        return;
      }
    }

    if (onCallback) {
      if (text.startsWith('/wins')) await onCallback('lessons', 'wins', msg);
      else if (text.startsWith('/losses')) await onCallback('lessons', 'losses', msg);
      else if (text.startsWith('/skipped')) await onCallback('lessons', 'skipped', msg);
      else if (text.startsWith('/stats')) await onCallback('stats', null, msg);
      else if (text.startsWith('/ask ')) await onCallback('question', null, { ...msg, text: text.slice(5) });
      else if (!text.startsWith('/')) await onCallback('question', null, msg);
    }
  });

  console.log('[Telegram] Bot polling started');
}
