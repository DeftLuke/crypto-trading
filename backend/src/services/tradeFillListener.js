/**
 * Real-time fill handler — Binance user-stream ORDER_TRADE_UPDATE (no 15s poll delay).
 */
import { getSupabase, updateTrade, logEvent } from './supabase.js';
import { recordPartialClose, auditTpHit, auditBreakevenMove, logTradeEvent, EVENT_TYPES } from './tradeEventAudit.js';
import { updatePerformanceDraft, reconcileLegsFromExchange } from './tradePerformanceEngine.js';
import { getBreakevenSL, calculateTPQuantities } from '../strategy/riskManager.js';

const recentFills = new Map();

function fillKey(tradeId, orderId, qty, rp) {
  return `${tradeId}:${orderId}:${qty}:${rp}`;
}

function parseOrderEvent(o = {}) {
  return {
    symbol: String(o.s || '').toUpperCase(),
    status: String(o.X || '').toUpperCase(),
    execType: String(o.x || '').toUpperCase(),
    orderType: String(o.o || '').toUpperCase(),
    side: String(o.S || '').toUpperCase(),
    lastQty: parseFloat(o.l || 0),
    lastPrice: parseFloat(o.L || 0),
    avgPrice: parseFloat(o.ap || 0),
    realizedPnl: parseFloat(o.rp || 0),
    commission: parseFloat(o.n || 0),
    orderId: o.i != null ? String(o.i) : null,
    isReduceOnly: o.R === true || o.R === 'true',
  };
}

async function findOpenTradeForSymbol(symbol) {
  const db = getSupabase();
  if (!db) return null;
  const { data } = await db
    .from('trades')
    .select('*')
    .eq('symbol', symbol)
    .in('status', ['open', 'partial'])
    .order('opened_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}

function inferPhase(trade, fill, originalQty) {
  const { tp1Qty, tp2Qty } = calculateTPQuantities(originalQty);
  const qty = fill.lastQty;
  if (!qty || qty <= 0) return null;

  const near = (a, b, tol = 0.15) => Math.abs(a - b) <= Math.max(b * tol, 0.0001);

  if (fill.orderType.includes('STOP') || fill.orderType.includes('TRAILING')) {
    return { phase: 'SL', closePct: null, label: 'STOP_LOSS_HIT' };
  }

  if (fill.isReduceOnly || fill.execType === 'TRADE') {
    if (!trade.tp1_hit && near(qty, tp1Qty, 0.2)) {
      return { phase: 'TP1', closePct: 30, label: 'TP1_HIT' };
    }
    if (trade.tp1_hit && !trade.tp2_hit && near(qty, tp2Qty, 0.25)) {
      return { phase: 'TP2', closePct: 40, label: 'TP2_HIT' };
    }
    if (trade.tp1_hit) {
      return { phase: 'RUNNER', closePct: null, label: 'PARTIAL_CLOSE' };
    }
  }

  if (fill.execType === 'TRADE' && !fill.isReduceOnly && !trade.tp1_hit) {
    return { phase: 'ENTRY', closePct: null, label: 'ORDER_FILLED' };
  }

  return { phase: 'RUNNER', closePct: null, label: 'PARTIAL_CLOSE' };
}

export async function handleOrderTradeUpdate(orderPayload) {
  const fill = parseOrderEvent(orderPayload);
  if (!fill.symbol) return { handled: false, reason: 'no_symbol' };
  if (fill.execType !== 'TRADE' && fill.status !== 'FILLED') {
    return { handled: false, reason: 'not_a_fill' };
  }
  if (!fill.lastQty || fill.lastQty <= 0) return { handled: false, reason: 'zero_qty' };

  const trade = await findOpenTradeForSymbol(fill.symbol);
  if (!trade) return { handled: false, reason: 'no_open_trade' };

  const key = fillKey(trade.id, fill.orderId, fill.lastQty, fill.realizedPnl);
  if (recentFills.has(key)) return { handled: true, deduped: true };
  recentFills.set(key, Date.now());

  const originalQty = parseFloat(trade.original_quantity || trade.quantity);
  const inferred = inferPhase(trade, fill, originalQty);
  if (!inferred || inferred.phase === 'ENTRY') {
    await logTradeEvent(trade.id, EVENT_TYPES.ORDER_FILLED, {
      price: fill.lastPrice || fill.avgPrice,
      quantity: fill.lastQty,
      realized_pnl: fill.realizedPnl,
      exchange_order_id: fill.orderId,
      metadata: { source: 'user_stream' },
    });
    return { handled: true, phase: 'ENTRY' };
  }

  const remainQty = Math.max(0, parseFloat(trade.quantity) - fill.lastQty);
  const exitPrice = fill.lastPrice || fill.avgPrice;
  const cumRealized = (parseFloat(trade.exchange_realized_pnl) || 0) + fill.realizedPnl;

  await recordPartialClose(trade.id, {
    phase: inferred.phase,
    closePct: inferred.closePct,
    closedQty: fill.lastQty,
    remainingQty: remainQty,
    exitPrice,
    realizedPnl: fill.realizedPnl,
    fees: fill.commission,
    source: 'fill',
    exchangeTradeId: fill.orderId,
  });

  const updates = {
    quantity: remainQty,
    exchange_qty: remainQty,
    status: remainQty > 0 ? 'partial' : trade.status,
    exchange_realized_pnl: cumRealized,
    pnl: cumRealized,
  };

  if (inferred.phase === 'TP1' && !trade.tp1_hit) {
    updates.tp1_hit = true;
    updates.tp1_hit_at = new Date().toISOString();
    updates.sl_moved_breakeven = true;
    updates.stop_loss = getBreakevenSL(parseFloat(trade.entry_price), trade.direction);
    updates.lifecycle_stage = 'TP1_HIT';
    await auditTpHit(trade, 'tp1', {
      price: exitPrice,
      quantity: fill.lastQty,
      percentage: 30,
      remaining_qty: remainQty,
      realized_pnl: fill.realizedPnl,
    });
    await auditBreakevenMove({ ...trade, ...updates }, {
      oldSl: trade.initial_stop_loss || trade.stop_loss,
      newSl: updates.stop_loss,
      remainQty,
    });
  } else if (inferred.phase === 'TP2' && !trade.tp2_hit) {
    updates.tp2_hit = true;
    updates.tp2_hit_at = new Date().toISOString();
    updates.lifecycle_stage = 'TP2_HIT';
    await auditTpHit(trade, 'tp2', {
      price: exitPrice,
      quantity: fill.lastQty,
      percentage: 40,
      remaining_qty: remainQty,
      realized_pnl: fill.realizedPnl,
    });
  } else if (inferred.phase === 'SL') {
    await logTradeEvent(trade.id, EVENT_TYPES.STOP_LOSS_HIT, {
      price: exitPrice,
      quantity: fill.lastQty,
      realized_pnl: fill.realizedPnl,
      remaining_qty: remainQty,
    });
  }

  await updateTrade(trade.id, updates);
  await updatePerformanceDraft({ ...trade, ...updates }, { gross: cumRealized, fees: fill.commission });

  if (fill.realizedPnl === 0 && cumRealized === 0) {
    await syncTradeRealizedFromExchange({ ...trade, ...updates }).catch(() => {});
  }

  await logEvent('trade', 'tradeFillListener', `${inferred.phase} fill (WS)`, {
    tradeId: trade.id,
    symbol: fill.symbol,
    qty: fill.lastQty,
    rp: fill.realizedPnl,
  });

  return { handled: true, phase: inferred.phase, tradeId: trade.id };
}

export async function syncTradeRealizedFromExchange(trade) {
  const reconciled = await reconcileLegsFromExchange(trade);
  if (!reconciled.ok || reconciled.exchangeTotal == null) return reconciled;
  await updateTrade(trade.id, {
    exchange_realized_pnl: reconciled.exchangeTotal,
    pnl: reconciled.exchangeTotal,
  }).catch(() => {});
  await updatePerformanceDraft(trade, { gross: reconciled.exchangeTotal, fees: reconciled.fees });
  return reconciled;
}
