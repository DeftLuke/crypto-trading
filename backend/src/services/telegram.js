import { config } from '../config/index.js';

let bot = null;

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

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ BUY NOW', callback_data: `execute:${signalId}` },
      { text: '⏭ SKIP', callback_data: `skip:${signalId}` },
    ]],
  };

  try {
    const msg = await telegram.sendMessage(config.telegram.chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
    console.log(`[Telegram] Signal sent: ${signal.symbol} ${signal.direction} → chat ${config.telegram.chatId}`);
    return msg.message_id;
  } catch (err) {
    console.error('[Telegram] sendSignalNotification failed:', err.message);
    // Retry without HTML if parse fails
    try {
      const plain = text.replace(/<[^>]+>/g, '');
      const msg = await telegram.sendMessage(config.telegram.chatId, plain, {
        reply_markup: keyboard,
      });
      console.log('[Telegram] Signal sent (plain text fallback)');
      return msg.message_id;
    } catch (err2) {
      console.error('[Telegram] Plain text fallback also failed:', err2.message);
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
    console.log('[Telegram] Alert sent');
  } catch (err) {
    console.error('[Telegram] sendAlert failed:', err.message);
  }
}

export async function sendStartupNotification() {
  await sendAlert(
    '<b>✅ Trading Bot Online</b>\n\nScanner active. You will receive alerts here when signals ≥70% confidence are found.\n\nSend any question to ask the AI assistant.'
  );
}

export async function setupTelegramPolling(onCallback) {
  const telegram = await getBot();
  if (!telegram) return;

  telegram.startPolling();

  telegram.on('callback_query', async (query) => {
    const data = query.data;
    const [action, signalId] = data.split(':');

    if (action === 'execute' || action === 'skip') {
      await telegram.answerCallbackQuery(query.id, {
        text: action === 'execute' ? 'Processing trade...' : 'Signal skipped',
      });
      await onCallback(action, signalId, query);
    }
  });

  telegram.on('message', async (msg) => {
    if (!msg.text) return;

    const text = msg.text.trim();

    if (text.startsWith('/start')) {
      await telegram.sendMessage(msg.chat.id,
        '🤖 <b>Trading AI Agent</b>\n\n' +
        'Ask me anything about your trades!\n\n' +
        '<b>Commands:</b>\n' +
        '/wins — Winning lessons\n' +
        '/losses — Losing lessons\n' +
        '/skipped — Skipped trade lessons\n' +
        '/stats — Pair performance\n' +
        '/ask [question] — Ask AI anything\n\n' +
        'Or just type your question directly.',
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (onCallback) {
      if (text.startsWith('/wins')) {
        await onCallback('lessons', 'wins', msg);
      } else if (text.startsWith('/losses')) {
        await onCallback('lessons', 'losses', msg);
      } else if (text.startsWith('/skipped')) {
        await onCallback('lessons', 'skipped', msg);
      } else if (text.startsWith('/stats')) {
        await onCallback('stats', null, msg);
      } else if (text.startsWith('/ask ')) {
        await onCallback('question', null, { ...msg, text: text.slice(5) });
      } else if (!text.startsWith('/')) {
        await onCallback('question', null, msg);
      }
    }
  });

  console.log('[Telegram] Bot polling started');
}
