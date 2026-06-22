/**
 * Binance scale-out protection: TP1/TP2 at open + SL reposition after partial fills.
 */
import { calculateTPQuantities, getBreakevenSL, getRunnerStopAfterTP2 } from '../strategy/riskManager.js';
import {
  placeTakeProfitOrder,
  placeStopMarketOrder,
  cancelAllOrders,
  getMarkPrice,
  roundToStep,
} from './binance.js';
import {
  getActiveApiKeys,
  placeTakeProfitOrderWithCredentials,
  placeStopMarketOrderWithCredentials,
  cancelAllOrdersWithCredentials,
  cancelAlgoOrderWithCredentials,
  getOpenAlgoOrdersWithCredentials,
  getPositionRiskWithCredentials,
} from './userBinance.js';
import { getPositionRisk } from './binance.js';
import { logEvent } from './supabase.js';

function closeSide(direction) {
  return direction === 'LONG' ? 'SELL' : 'BUY';
}

function roundQty(qty) {
  return parseFloat(Number(qty).toFixed(8));
}

async function placeTpOrder({ symbol, side, price, qty }, credentials = null) {
  if (!price || !Number.isFinite(parseFloat(price)) || qty <= 0) return null;
  const creds = credentials ?? (await getActiveApiKeys());
  try {
    if (creds) {
      return await placeTakeProfitOrderWithCredentials(creds, {
        symbol,
        side,
        stopPrice: price,
        quantity: qty,
      });
    }
    return await placeTakeProfitOrder(symbol, side, price, qty);
  } catch (err) {
    await logEvent('warn', 'tradeProtection', `TP order failed: ${err.message}`, {
      symbol,
      price,
      qty,
    });
    return null;
  }
}

async function placeSlOrder({ symbol, side, stopPrice, closePosition = true }, credentials = null) {
  const creds = credentials ?? (await getActiveApiKeys());
  try {
    if (creds) {
      return await placeStopMarketOrderWithCredentials(creds, {
        symbol,
        side,
        stopPrice,
        closePosition,
      });
    }
    return await placeStopMarketOrder(symbol, side, stopPrice, null, { closePosition });
  } catch (err) {
    await logEvent('warn', 'tradeProtection', `SL order failed: ${err.message}`, {
      symbol,
      stopPrice,
    });
    return null;
  }
}

/** At open: full-position SL (close-all) + TP1 only (30%). TP2 placed after TP1 by monitor. */
export async function placeInitialTradeProtection(
  { symbol, direction, quantity, stopLoss, tp1 },
  credentials = null,
) {
  const side = closeSide(direction);
  const { tp1Qty } = calculateTPQuantities(quantity);
  const slOrder = await placeSlOrder({ symbol, side, stopPrice: stopLoss, closePosition: true }, credentials);
  const tp1Order = slOrder ? await placeTpOrder({ symbol, side, price: tp1, qty: tp1Qty }, credentials) : null;
  return { slOrder, tp1Order, tp1Qty, tp2Order: null };
}

/** Legacy: TP1 + TP2 at open (recovery / explicit split-target mode). */
export async function placeScaleOutTakeProfits(
  { symbol, direction, quantity, tp1, tp2 },
  credentials = null,
) {
  const side = closeSide(direction);
  const { tp1Qty, tp2Qty } = calculateTPQuantities(quantity);
  const tp1Order = await placeTpOrder({ symbol, side, price: tp1, qty: tp1Qty }, credentials);
  const tp2Order = await placeTpOrder({ symbol, side, price: tp2, qty: tp2Qty }, credentials);
  return { tp1Order, tp2Order, tp1Qty, tp2Qty };
}

async function cancelStopOrdersOnly(symbol, credentials = null) {
  const creds = credentials ?? (await getActiveApiKeys());
  if (!creds) {
    await cancelAllOrders(symbol);
    return;
  }
  const openAlgo = await getOpenAlgoOrdersWithCredentials(creds, symbol).catch(() => []);
  const slOrders = (Array.isArray(openAlgo) ? openAlgo : []).filter(
    (o) => o.orderType === 'STOP_MARKET' || o.type === 'STOP_MARKET',
  );
  await Promise.all(
    slOrders.map((o) => cancelAlgoOrderWithCredentials(creds, o.algoId).catch(() => {})),
  );
}

export async function repositionProtectiveStop(
  { symbol, direction, stopPrice, quantity, preserveTp = false },
  credentials = null,
) {
  const side = closeSide(direction);
  const creds = credentials ?? (await getActiveApiKeys());
  if (!stopPrice || !Number.isFinite(parseFloat(stopPrice))) return false;

  try {
    if (preserveTp) {
      await cancelStopOrdersOnly(symbol, creds);
    } else if (creds) {
      await cancelAllOrdersWithCredentials(creds, symbol);
    } else {
      await cancelAllOrders(symbol);
    }
    await placeSlOrder({ symbol, side, stopPrice, closePosition: true }, creds);
    return true;
  } catch (err) {
    await logEvent('warn', 'tradeProtection', `SL reposition failed: ${err.message}`, {
      symbol,
      stopPrice,
      quantity,
    });
    return false;
  }
}

/** After TP1 fill: breakeven SL on runner + re-place TP2 (cancel-all removes open TP2). */
export async function repositionAfterTP1(
  { symbol, direction, originalQty, remainQty, stopPrice, tp2 },
  credentials = null,
) {
  const slOk = await repositionProtectiveStop(
    { symbol, direction, stopPrice, quantity: remainQty, preserveTp: true },
    credentials,
  );

  const { tp2Qty } = calculateTPQuantities(originalQty);
  const side = closeSide(direction);
  const creds = credentials ?? (await getActiveApiKeys());
  let tp2Order = null;

  if (tp2 && tp2Qty > 0) {
    try {
      const creds = credentials ?? (await getActiveApiKeys());
      let existing = [];
      if (creds) {
        const raw = await getOpenAlgoOrdersWithCredentials(creds, symbol);
        existing = Array.isArray(raw)
          ? raw.filter((o) => (o.orderType || o.type) === 'TAKE_PROFIT_MARKET' && parseFloat(o.quantity || 0) > 0)
          : [];
      }
      const hasTp2 = existing.some((o) => Math.abs(parseFloat(o.quantity) - tp2Qty) / tp2Qty < 0.02);
      if (!hasTp2) {
        tp2Order = await placeTpOrder({ symbol, side, price: tp2, qty: tp2Qty }, creds);
      }
    } catch (err) {
      await logEvent('warn', 'tradeProtection', `TP2 re-place after TP1 failed: ${err.message}`, { symbol });
    }
  }

  return { slOk, tp2Order };
}

/** After TP2 fill: SL at TP1 on runner (or breakeven if mark has not reached TP1). */
export async function repositionAfterTP2(
  { symbol, direction, remainQty, stopPrice, tp1, entryPrice },
  credentials = null,
) {
  const mark = await getMarkPrice(symbol).catch(() => null);
  const effectiveStop = getRunnerStopAfterTP2(tp1 ?? stopPrice, direction, {
    markPrice: mark,
    entryPrice: entryPrice ?? stopPrice,
  });
  return repositionProtectiveStop(
    { symbol, direction, stopPrice: effectiveStop, quantity: remainQty },
    credentials,
  );
}

export async function getLivePositionQty(symbol, credentials = null) {
  try {
    const { getCachedPositions, isUserStreamLive } = await import('./binanceUserStream.js');
    if (isUserStreamLive()) {
      const pos = getCachedPositions().find((p) => p.symbol === symbol);
      if (pos) return pos.quantity;
      // Cache miss during partial fill — fall through to REST
    }
    const creds = credentials ?? (await getActiveApiKeys());
    const rows = creds
      ? await getPositionRiskWithCredentials(creds, symbol)
      : await getPositionRisk(symbol);
    const row = Array.isArray(rows) ? rows.find((p) => p.symbol === symbol) : rows;
    return Math.abs(parseFloat(row?.positionAmt || 0));
  } catch {
    return null;
  }
}

/** Positions below this notional are dust — auto-flatten instead of trailing. */
export const DUST_NOTIONAL_USDT = 0.5;

export function positionNotional(position = {}) {
  const direct = parseFloat(position.notional);
  if (Number.isFinite(direct) && direct > 0) return Math.abs(direct);
  const qty = Math.abs(parseFloat(position.quantity) || 0);
  const px = parseFloat(position.current_price ?? position.markPrice ?? position.entry_price) || 0;
  return qty * px;
}

export function isDustNotional(notional) {
  const n = Math.abs(parseFloat(notional) || 0);
  return n > 0 && n < DUST_NOTIONAL_USDT;
}

/** Runner qty too small to manage — flatten and finalize trade. */
export function isRunnerDust(liveQty, markPrice, originalQty) {
  const qty = Math.abs(parseFloat(liveQty) || 0);
  if (!qty) return false;
  if (isDustNotional(qty * (parseFloat(markPrice) || 0))) return true;
  const orig = parseFloat(originalQty);
  return orig > 0 && qty / orig < 0.02;
}

/** Snapshot open protection orders on Binance for verification. */
export async function verifyExchangeProtection(symbol, credentials = null) {
  const creds = credentials ?? (await getActiveApiKeys());
  const positionQty = await getLivePositionQty(symbol, creds);
  const markPrice = await getMarkPrice(symbol).catch(() => null);

  let algoOrders = [];
  if (creds) {
    try {
      const raw = await getOpenAlgoOrdersWithCredentials(creds, symbol);
      algoOrders = Array.isArray(raw) ? raw : [];
    } catch (err) {
      algoOrders = { error: err.message };
    }
  }

  const orders = Array.isArray(algoOrders) ? algoOrders : [];
  const slOrders = orders.filter((o) => o.orderType === 'STOP_MARKET' || o.type === 'STOP_MARKET');
  const tpOrders = orders.filter((o) => o.orderType === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT_MARKET');

  return {
    symbol,
    markPrice,
    positionQty,
    hasPosition: positionQty > 0,
    slCount: slOrders.length,
    tpCount: tpOrders.length,
    slOrders: slOrders.map(summarizeAlgoOrder),
    tpOrders: tpOrders.map(summarizeAlgoOrder),
    ok: positionQty > 0 && slOrders.length >= 1,
  };
}

function summarizeAlgoOrder(o) {
  return {
    algoId: o.algoId,
    type: o.orderType || o.type,
    side: o.side,
    triggerPrice: o.triggerPrice,
    quantity: o.quantity,
    closePosition: o.closePosition,
  };
}

function tpQtyMatches(order, expectedQty, tolerance = 0.04) {
  const q = parseFloat(order?.quantity || 0);
  return expectedQty > 0 && Math.abs(q - expectedQty) / expectedQty <= tolerance;
}

/** Recreate missing SL/TP on exchange for an active DB trade. */
export async function ensureTradeProtection(trade, credentials = null) {
  const creds = credentials ?? (await getActiveApiKeys());
  if (!creds || !trade?.symbol) return null;

  let verify = await verifyExchangeProtection(trade.symbol, creds);
  if (!verify?.hasPosition) {
    await cancelOrphanProtectionOrders(trade.symbol, creds);
    return verify;
  }

  const side = closeSide(trade.direction);
  const originalQty = parseFloat(trade.original_quantity || trade.quantity);
  const { tp1Qty, tp2Qty } = calculateTPQuantities(originalQty);

  if (verify.slCount < 1) {
    await placeSlOrder({
      symbol: trade.symbol,
      side,
      stopPrice: trade.stop_loss,
      closePosition: true,
    }, creds);
  }

  if (!trade.tp1_hit) {
    const hasTp1 = verify.tpOrders.some((o) => tpQtyMatches(o, tp1Qty));
    if (!hasTp1) {
      await placeTpOrder({ symbol: trade.symbol, side, price: trade.tp1, qty: tp1Qty }, creds);
    }
  } else if (!trade.tp2_hit && trade.tp2) {
    const hasTp2 = verify.tpOrders.some((o) => tpQtyMatches(o, tp2Qty));
    if (!hasTp2) {
      await placeTpOrder({ symbol: trade.symbol, side, price: trade.tp2, qty: tp2Qty }, creds);
    }
  }

  return verifyExchangeProtection(trade.symbol, creds);
}

/** Cancel leftover algo orders when exchange position is flat. */
export async function cancelOrphanProtectionOrders(symbol, credentials = null) {
  const creds = credentials ?? (await getActiveApiKeys());
  const qty = await getLivePositionQty(symbol, creds);
  if (qty == null || qty > 0) return { cancelled: false, reason: 'position_open' };
  if (creds) {
    await cancelAllOrdersWithCredentials(creds, symbol);
  } else {
    await cancelAllOrders(symbol);
  }
  await logEvent('info', 'tradeProtection', `Cancelled orphan protection orders: ${symbol}`);
  return { cancelled: true };
}

/** Check SL on Binance is at breakeven (at/above entry for LONG). */
export async function verifyBreakevenStop(symbol, entryPrice, direction, tickSize = null) {
  const verify = await verifyExchangeProtection(symbol);
  const sl = verify.slOrders?.[0];
  if (!sl) {
    return { ok: false, reason: 'No SL order on exchange', verify };
  }

  const trigger = parseFloat(sl.triggerPrice);
  const entry = parseFloat(entryPrice);
  const expected = getBreakevenSL(entry, direction);
  const tolerance = Math.max(tickSize || entry * 0.001, entry * 0.001);
  const isLong = direction === 'LONG';
  const atBreakeven = isLong
    ? trigger <= entry + tolerance && trigger >= entry - tolerance * 3
    : trigger >= entry - tolerance && trigger <= entry + tolerance * 3;
  const nearExpected = Math.abs(trigger - expected) <= tolerance * 2;

  return {
    ok: atBreakeven && nearExpected,
    trigger,
    entry,
    expected,
    atBreakeven,
    nearExpected,
    slOrder: sl,
    verify,
  };
}

/** True if SL is still at initial stop (below entry for LONG), not breakeven yet. */
export function isInitialStopLevel(triggerPrice, entryPrice, initialStop, direction) {
  const trigger = parseFloat(triggerPrice);
  const entry = parseFloat(entryPrice);
  const initial = parseFloat(initialStop);
  if (direction === 'LONG') {
    return trigger <= initial + entry * 0.001 && trigger < entry;
  }
  return trigger >= initial - entry * 0.001 && trigger > entry;
}

/** Check runner SL after TP2 — TP1 lock if mark passed TP1, else breakeven. */
export async function verifyRunnerStopAtTP1(symbol, tp1Price, direction, tickSize = null, entryPrice = null) {
  const verify = await verifyExchangeProtection(symbol);
  const sl = verify.slOrders?.[0];
  if (!sl) return { ok: false, reason: 'No SL order', verify };

  const trigger = parseFloat(sl.triggerPrice);
  const tp1 = parseFloat(tp1Price);
  const mark = parseFloat(verify.markPrice);
  const entry = parseFloat(entryPrice);
  const tolerance = Math.max(tickSize || tp1 * 0.001, tp1 * 0.001);
  const isLong = direction === 'LONG';
  const markPastTp1 = isLong ? mark >= tp1 - tolerance : mark <= tp1 + tolerance;

  if (markPastTp1) {
    const expected = getRunnerStopAfterTP2(tp1, direction, { markPrice: mark, entryPrice: entry });
    const nearTp1 = Math.abs(trigger - expected) <= tolerance * 2;
    return { ok: nearTp1, trigger, tp1, expected, mode: 'tp1_lock', slOrder: sl, verify };
  }

  if (entry) {
    const beCheck = await verifyBreakevenStop(symbol, entry, direction, tickSize);
    return { ok: beCheck.ok, trigger: beCheck.trigger, tp1, expected: beCheck.expected, mode: 'breakeven_hold', slOrder: sl, verify };
  }

  return { ok: false, trigger, tp1, reason: 'mark below TP1 and no entry', verify };
}

/** Validate 30/40/30 split vs live position and open TP orders. */
export function verifyScaleOutQuantities({
  originalQty,
  liveQty,
  tpOrders = [],
  phase,
  rules,
}) {
  const raw = calculateTPQuantities(originalQty);
  const tp1Qty = roundQtyToStep(raw.tp1Qty, rules?.stepSize);
  const tp2Qty = roundQtyToStep(raw.tp2Qty, rules?.stepSize);
  const runnerQty = roundQtyToStep(raw.tp3Qty, rules?.stepSize);
  const expectedAfterTp1 = roundQtyToStep(originalQty - tp1Qty, rules?.stepSize);
  const expectedAfterTp2 = roundQtyToStep(originalQty - tp1Qty - tp2Qty, rules?.stepSize);

  const pct = (q) => (originalQty > 0 ? ((q / originalQty) * 100).toFixed(1) : '0');
  const within = (actual, expected, tol = 0.035) =>
    expected > 0 && Math.abs(actual - expected) / expected <= tol;

  const tpQtys = tpOrders.map((o) => parseFloat(o.quantity || 0)).filter((q) => q > 0);
  const checks = { phase, originalQty, liveQty, tp1Qty, tp2Qty, runnerQty, tpQtys };

  if (phase === 'open') {
    checks.positionPct = pct(liveQty);
    checks.positionOk = within(liveQty, originalQty, 0.01);
    checks.tp1OrderOk = tpQtys.some((q) => within(q, tp1Qty));
    checks.tp2OrderOk = tpQtys.some((q) => within(q, tp2Qty));
    checks.ok = checks.positionOk && checks.tp1OrderOk && checks.tp2OrderOk;
    return checks;
  }

  if (phase === 'after_tp1') {
    checks.positionPct = pct(liveQty);
    checks.positionOk = within(liveQty, expectedAfterTp1);
    checks.tp2OrderOk = tpQtys.some((q) => within(q, tp2Qty));
    checks.ok = checks.positionOk && checks.tp2OrderOk;
    return checks;
  }

  if (phase === 'after_tp2') {
    checks.positionPct = pct(liveQty);
    checks.positionOk = within(liveQty, expectedAfterTp2) || within(liveQty, runnerQty);
    checks.noTpOrders = tpQtys.length === 0;
    checks.ok = checks.positionOk && checks.noTpOrders;
    return checks;
  }

  checks.ok = false;
  return checks;
}

function roundQtyToStep(qty, stepSize) {
  if (!stepSize) return parseFloat(Number(qty).toFixed(8));
  return roundToStep(qty, stepSize);
}
