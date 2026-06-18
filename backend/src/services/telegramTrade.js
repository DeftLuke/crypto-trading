import { config } from '../config/index.js';
import { getSupabase, updateSignal, logEvent } from './supabase.js';
import { getUsdtBalance, computeRiskBasedSizing } from './binance.js';
import { internalApiHeaders, internalApiUrl } from '../lib/internalFetch.js';
import {
  askPositionSize,
  askManualSize,
  clearPendingExecution,
  getPendingExecution,
} from './telegram.js';

export async function getDefaultTradeParams({ entry, stopLoss, symbol } = {}) {
  const preferredLeverage = config.telegram.defaultLeverage || 50;
  const riskPercent = config.strategy.riskPerTrade || 0.01;
  let balance = 5000;
  let available = 5000;

  try {
    const bal = await getUsdtBalance();
    balance = parseFloat(bal.total) || parseFloat(bal.available) || balance;
    available = parseFloat(bal.available) || balance;
  } catch {
    /* demo fallback */
  }

  const base = {
    leverage: preferredLeverage,
    risk_percent: riskPercent * 100,
    balance,
    available,
    sizing_mode: 'risk_percent',
  };

  const entryPrice = parseFloat(entry);
  const sl = parseFloat(stopLoss);
  if (entryPrice > 0 && sl > 0 && Math.abs(entryPrice - sl) > 0) {
    const calc = computeRiskBasedSizing({
      accountEquity: balance,
      availableBalance: available,
      entryPrice,
      stopLossPrice: sl,
      riskPercent,
      preferredLeverage,
    });
    if (calc.ok) {
      return {
        ...base,
        margin_usdt: parseFloat((calc.positionValue / preferredLeverage).toFixed(2)),
        notional_usdt: parseFloat(calc.positionValue.toFixed(2)),
        quantity: parseFloat(calc.qty.toFixed(8)),
        risk_amount: parseFloat(calc.riskAmount.toFixed(2)),
        price_risk: calc.priceRisk,
        can_open: calc.canOpen,
        symbol: symbol || null,
      };
    }
  }

  return {
    ...base,
    margin_usdt: null,
    notional_usdt: null,
    risk_amount: parseFloat((balance * riskPercent).toFixed(2)),
    note: 'Sized at execution from entry, stop loss, and 1% equity risk',
  };
}

async function loadSignal(signalId) {
  const db = getSupabase();
  if (!db || !signalId || signalId.startsWith('local-')) return null;
  const { data } = await db.from('signals').select('*').eq('id', signalId).single();
  return data;
}

export async function executeSignalTrade(signalId, { marginUsdt, leverage = 50, chatId, useRiskSizing = false }) {
  const signal = await loadSignal(signalId);
  if (!signal) {
    return { ok: false, message: '❌ Signal not found or expired.' };
  }

  const port = config.port;
  const body = {
    ...signal,
    id: signalId,
    manual_approved: true,
    leverage,
  };

  if (useRiskSizing || !marginUsdt) {
    body.use_risk_sizing = true;
  } else {
    body.size_mode = 'notional';
    body.notional_usdt = marginUsdt;
    body.position_size_usdt = marginUsdt;
  }

  const res = await fetch(internalApiUrl('/api/execute'), {
    method: 'POST',
    headers: internalApiHeaders(),
    body: JSON.stringify(body),
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
  const sizing = result.sizing || {};
  const lev = trade.leverage || leverage;
  const notional = sizing.notional || trade.notional_usdt || (marginUsdt || 0);
  const margin = trade.margin_usdt || sizing.marginUsdt || (lev > 0 ? notional / lev : 0);

  await logEvent('trade', 'telegram', `Trade opened via Telegram: ${signal.symbol}`, {
    tradeId: trade.id,
    marginUsdt: margin,
    notional,
    leverage: lev,
    riskAmount: sizing.riskAmount,
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
      `<b>Risk:</b> $${(sizing.riskAmount || 0).toFixed(2)} (1% equity)\n` +
      `<b>Position:</b> ~$${notional.toFixed(2)} notional · <b>${lev}x</b> · margin ~$${margin.toFixed(2)}\n` +
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
      const result = await executeSignalTrade(signalId, { useRiskSizing: true, chatId });
      return { ...result, answer: result.ok ? 'Opened with 1% risk sizing' : 'Failed' };
    }

    case 'execute_manual': {
      const signal = await loadSignal(signalId);
      if (!signal) return { ok: false, message: '❌ Signal expired.', answer: 'Expired' };
      await askManualSize(chatId, signal, signalId);
      return { ok: true, message: null, answer: 'Enter position size…' };
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
        return { ok: false, message: 'Send a number like <code>100</code> for $100 USDT position size.' };
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
