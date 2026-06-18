import { config } from '../config/index.js';
import { getSupabase, updateSignal, logEvent } from './supabase.js';
import { getUsdtBalance } from './binance.js';
import {
  askPositionSize,
  askManualSize,
  clearPendingExecution,
  getPendingExecution,
} from './telegram.js';

export async function getDefaultTradeParams() {
  const leverage = config.telegram.defaultLeverage || 50;
  const targetNotional = config.telegram.defaultPositionUsdt || 50;
  let balance = 5000;

  try {
    const bal = await getUsdtBalance();
    balance = parseFloat(bal.available) || balance;
  } catch {
    /* demo fallback */
  }

  const marginFromPct = balance * (config.telegram.defaultMarginPct || 0.01);
  let margin = Math.min(marginFromPct, targetNotional / leverage);
  margin = Math.max(parseFloat(margin.toFixed(2)), 1);

  return {
    leverage,
    margin_usdt: margin,
    notional_usdt: parseFloat((margin * leverage).toFixed(2)),
    balance,
  };
}

async function loadSignal(signalId) {
  const db = getSupabase();
  if (!db || !signalId || signalId.startsWith('local-')) return null;
  const { data } = await db.from('signals').select('*').eq('id', signalId).single();
  return data;
}

export async function executeSignalTrade(signalId, { marginUsdt, leverage = 50, chatId }) {
  const signal = await loadSignal(signalId);
  if (!signal) {
    return { ok: false, message: '❌ Signal not found or expired.' };
  }

  const port = config.port;
  const res = await fetch(`http://127.0.0.1:${port}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...signal,
      id: signalId,
      manual_approved: true,
      position_size_usdt: marginUsdt,
      leverage,
    }),
  });
  const result = await res.json();

  if (!res.ok || !result.success) {
    const err = result.error || result.reason || 'Execution failed';
    const checks = result.checks?.filter((c) => !c.passed).map((c) => c.message).join('; ');
    return {
      ok: false,
      message: `❌ <b>Trade failed</b>\n${signal.symbol} ${signal.direction}\n${err}${checks ? `\n${checks}` : ''}`,
    };
  }

  const trade = result.trade || {};
  await logEvent('trade', 'telegram', `Trade opened via Telegram: ${signal.symbol}`, {
    tradeId: trade.id,
    marginUsdt,
    leverage,
    chatId,
  });

  if (signal.id) {
    await updateSignal(signal.id, { status: 'accepted', user_action: 'executed' });
  }

  return {
    ok: true,
    message:
      `✅ <b>Trade Activated</b> (Demo Futures)\n\n` +
      `<b>Pair:</b> ${signal.symbol}\n` +
      `<b>Direction:</b> ${signal.direction === 'BUY' ? 'LONG' : 'SHORT'}\n` +
      `<b>Entry:</b> <code>${trade.entry_price || signal.entry_price}</code>\n` +
      `<b>Margin:</b> $${marginUsdt} · <b>${leverage}x</b> · ~$${(marginUsdt * leverage).toFixed(0)} position\n` +
      `<b>Qty:</b> ${trade.quantity || '—'}\n` +
      `<b>SL:</b> <code>${signal.stop_loss}</code>\n` +
      `<b>TP1:</b> <code>${signal.tp1}</code> (30% close)\n` +
      `<b>TP2:</b> <code>${signal.tp2}</code> (40% close)\n` +
      `<b>TP3:</b> trailing runner (30%)\n\n` +
      `Monitor: https://trade.deftluke.online/trades`,
    trade: result.trade,
    answer: 'Trade activated',
  };
}

export async function handleTelegramCallback(body = {}) {
  if (body.callback_data) {
    body = { ...parseCallbackData(body.callback_data), ...body, chat_id: body.chat_id || body.chatId };
  }
  const action = body.action || inferAction(body.callback_data || body.data);
  const signalId = body.signal_id || extractSignalId(body.callback_data || body.data);
  const chatId = body.chat_id || body.chatId;

  switch (action) {
    case 'execute_prompt': {
      const signal = await loadSignal(signalId);
      if (!signal) return { ok: false, message: '❌ Signal expired. Wait for a new one.', answer: 'Expired' };
      await askPositionSize(chatId, signal, signalId);
      return { ok: true, message: null, answer: 'Choose size…' };
    }

    case 'execute_default': {
      clearPendingExecution(chatId);
      const { leverage, margin_usdt, notional_usdt } = await getDefaultTradeParams();
      const result = await executeSignalTrade(signalId, {
        marginUsdt: margin_usdt,
        leverage,
        chatId,
      });
      return { ...result, answer: result.ok ? `Opened ~$${notional_usdt} position` : 'Failed' };
    }

    case 'execute_manual': {
      const signal = await loadSignal(signalId);
      if (!signal) return { ok: false, message: '❌ Signal expired.', answer: 'Expired' };
      await askManualSize(chatId, signal, signalId);
      return { ok: true, message: null, answer: 'Enter margin…' };
    }

    case 'execute_size': {
      clearPendingExecution(chatId);
      const margin = parseFloat(body.usdt_amount || body.margin_usdt || 0);
      const leverage = parseInt(body.leverage || config.telegram.defaultLeverage || 50, 10);
      if (!margin || margin <= 0) {
        return { ok: false, message: '❌ Invalid size.', answer: 'Invalid' };
      }
      return executeSignalTrade(signalId, { marginUsdt: margin, leverage, chatId });
    }

    case 'text_size': {
      const pending = getPendingExecution(chatId);
      if (!pending) {
        return { ok: false, message: 'No pending size request. Tap a signal button first.' };
      }
      const text = String(body.text || '').trim();
      const match = text.match(/^([\d.]+)\s*(usdt|usd)?$/i);
      if (!match) {
        return { ok: false, message: 'Send a number like <code>25</code> for $25 USDT margin.' };
      }
      clearPendingExecution(chatId);
      return executeSignalTrade(pending.signalId, {
        marginUsdt: parseFloat(match[1]),
        leverage: config.telegram.defaultLeverage || 50,
        chatId,
      });
    }

    case 'skip': {
      clearPendingExecution(chatId);
      if (signalId) {
        await updateSignal(signalId, { status: 'skipped', user_action: 'skipped' });
      }
      return { ok: true, message: '⏭ Signal skipped.', answer: 'Skipped' };
    }

    default:
      return { ok: false, message: `Unknown action: ${action}` };
  }
}

function extractSignalId(data = '') {
  if (!data) return null;
  const parts = String(data).split(':');
  return parts.length >= 2 ? parts[1] : null;
}

function inferAction(data = '') {
  const d = String(data || '');
  if (d.startsWith('execute:')) return 'execute_prompt';
  if (d.startsWith('default:')) return 'execute_default';
  if (d.startsWith('manual:')) return 'execute_manual';
  if (d.startsWith('size:')) return 'execute_size';
  if (d.startsWith('skip:')) return 'skip';
  return null;
}

export function parseCallbackData(data = '') {
  const d = String(data || '');
  if (d.startsWith('size:')) {
    const [, signalId, amount] = d.split(':');
    return { action: 'execute_size', signal_id: signalId, usdt_amount: parseFloat(amount) };
  }
  const action = inferAction(d);
  return { action, signal_id: extractSignalId(d), callback_data: d };
}
