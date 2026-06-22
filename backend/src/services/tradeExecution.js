/**
 * Unified trade execution pipeline — same flow as test-trade-protection-flow.js
 *
 * Open:  market entry + qty-based SL + TP1 (30%) + TP2 (40%) on Binance
 * TP1:   close 30% → SL breakeven → re-place TP2 on runner (70%)
 * TP2:   close 40% → SL at TP1 (or breakeven if mark below TP1) → trail 30% runner
 */
import { calculateTPQuantities } from '../strategy/riskManager.js';
import { verifyExchangeProtection } from './tradeProtection.js';
import { sendTradeLifecycle, sendTradeUpdate } from './telegram.js';
import { logEvent } from './supabase.js';

export function buildScaleOutPlan(quantity) {
  const { tp1Qty, tp2Qty, tp3Qty } = calculateTPQuantities(quantity);
  return {
    tp1Qty,
    tp2Qty,
    runnerQty: tp3Qty,
    tp1Pct: 30,
    tp2Pct: 40,
    runnerPct: 30,
  };
}

export function formatProtectionVerify(verify) {
  if (!verify) return 'Protection: pending verification';
  return (
    `Protection: SL×${verify.slCount} TP×${verify.tpCount} · ` +
    `position ${verify.positionQty} · mark ${verify.markPrice ?? '—'}`
  );
}

/** Post-open Binance check + Telegram trade.activated (single source for TG open notify). */
export async function finalizeTradeOpen({
  savedTrade,
  signal,
  sizing = {},
  slOrder,
  tp1Order,
  tp2Order,
  skipTelegram = false,
}) {
  let verify = null;
  try {
    await new Promise((r) => setTimeout(r, 800));
    verify = await verifyExchangeProtection(savedTrade.symbol);
  } catch (err) {
    await logEvent('warn', 'execute', `Protection verify skipped: ${err.message}`, {
      symbol: savedTrade.symbol,
    });
  }

  const plan = buildScaleOutPlan(parseFloat(savedTrade.original_quantity || savedTrade.quantity));
  const minTp = savedTrade.tp1_hit ? (savedTrade.tp2_hit ? 0 : 1) : 1;
  const protectionOk = verify?.hasPosition && verify.slCount >= 1 && verify.tpCount >= minTp;

  const marginUsdt = sizing.marginUsdt ?? savedTrade.margin_usdt;
  const leverageVal = savedTrade.leverage ?? sizing.leverage;
  const notionalUsdt = resolveNotionalUsdt(savedTrade, sizing);

  if (!skipTelegram) {
    await sendTradeLifecycle('trade.activated', {
      trade: savedTrade,
      signal,
      margin_usdt: marginUsdt,
      leverage: leverageVal,
      notional_usdt: notionalUsdt,
      plan,
      verify,
      protectionOk,
      orders: {
        sl: slOrder?.algoId || slOrder?.orderId,
        tp1: tp1Order?.algoId || tp1Order?.orderId,
        tp2: tp2Order?.algoId || tp2Order?.orderId,
      },
    }).catch((err) => logEvent('warn', 'execute', `TG activate failed: ${err.message}`));
  }

  return { verify, plan, protectionOk, notionalUsdt, marginUsdt, leverage: leverageVal };
}

/** Derive position notional for Telegram / UI when only margin or qty is stored. */
export function resolveNotionalUsdt(trade = {}, sizing = {}) {
  const fromSizing = parseFloat(sizing.notional);
  if (Number.isFinite(fromSizing) && fromSizing > 0) return fromSizing;

  const fromTrade = parseFloat(trade.notional_usdt);
  if (Number.isFinite(fromTrade) && fromTrade > 0) return fromTrade;

  const margin = parseFloat(sizing.marginUsdt ?? trade.margin_usdt);
  const lev = parseInt(sizing.leverage ?? trade.leverage, 10);
  if (Number.isFinite(margin) && margin > 0 && Number.isFinite(lev) && lev > 0) {
    return parseFloat((margin * lev).toFixed(2));
  }

  const qty = parseFloat(trade.quantity);
  const entry = parseFloat(trade.entry_price);
  if (Number.isFinite(qty) && qty > 0 && Number.isFinite(entry) && entry > 0) {
    return parseFloat((qty * entry).toFixed(2));
  }

  return null;
}

/** Telegram updates for position monitor phases (TP1 / TP2 / trail). */
export async function notifyTradePhase(phase, trade, details = {}) {
  const symbol = trade?.symbol || '—';
  const qty = details.quantity ?? trade?.quantity;
  const fmtTime = (iso) => {
    if (!iso) return '';
    const s = new Date(iso).toISOString().replace('T', ' ').slice(0, 19);
    return `\n⏱ ${s} UTC`;
  };

  const messages = {
    tp1: `✅ <b>TP1 hit</b> (30% closed)\n` +
      `${symbol} · runner <code>${qty}</code>\n` +
      `SL → breakeven <code>${details.stopLoss ?? trade?.stop_loss ?? '—'}</code>` +
      fmtTime(details.hitAt || trade?.tp1_hit_at),
    tp2: `✅ <b>TP2 hit</b> (40% closed)\n` +
      `${symbol} · runner <code>${qty}</code> (~30%)\n` +
      `SL → <code>${details.stopLoss ?? trade?.stop_loss ?? '—'}</code> · trailing active` +
      fmtTime(details.hitAt || trade?.tp2_hit_at),
    trail: `📊 <b>Trail SL updated</b>\n${symbol} → <code>${details.stopLoss ?? trade?.stop_loss ?? '—'}</code>` +
      fmtTime(details.hitAt || trade?.sl_updated_at),
  };

  const message = messages[phase] || details.message;
  if (!message) return;
  await sendTradeUpdate(trade, message);
}
