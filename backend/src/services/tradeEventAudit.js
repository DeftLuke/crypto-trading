/**
 * Trade Execution Audit Layer — append-only event logger.
 */
import { config } from '../config/index.js';
import { getSupabase, logEvent, updateTrade } from './supabase.js';

export const EVENT_TYPES = Object.freeze({
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_FILLED: 'ORDER_FILLED',
  SL_PLACED: 'SL_PLACED',
  TP1_PLACED: 'TP1_PLACED',
  TP2_PLACED: 'TP2_PLACED',
  TP3_PLACED: 'TP3_PLACED',
  TP1_HIT: 'TP1_HIT',
  TP2_HIT: 'TP2_HIT',
  TP3_HIT: 'TP3_HIT',
  PARTIAL_CLOSE: 'PARTIAL_CLOSE',
  SL_MOVED_BREAKEVEN: 'SL_MOVED_BREAKEVEN',
  STOP_LOSS_HIT: 'STOP_LOSS_HIT',
  MANUAL_CLOSE: 'MANUAL_CLOSE',
  LIQUIDATION: 'LIQUIDATION',
  TRADE_CLOSED: 'TRADE_CLOSED',
  EXECUTION_BLOCKED: 'EXECUTION_BLOCKED',
  SL_REPAIRED: 'SL_REPAIRED',
  TP_REPAIRED: 'TP_REPAIRED',
  SYNC_DESYNC: 'SYNC_DESYNC',
  SYNC_REOPENED: 'SYNC_REOPENED',
});

export const LIFECYCLE_STAGES = Object.freeze({
  OPEN: 'OPEN',
  SL_SET: 'SL_SET',
  TP1_SET: 'TP1_SET',
  TP1_HIT: 'TP1_HIT',
  BE_SET: 'BE_SET',
  TP2_HIT: 'TP2_HIT',
  RUNNER: 'RUNNER',
  CLOSED: 'CLOSED',
});

const STAGE_FOR_EVENT = {
  [EVENT_TYPES.ORDER_FILLED]: 'OPEN',
  [EVENT_TYPES.SL_PLACED]: 'SL_SET',
  [EVENT_TYPES.TP1_PLACED]: 'TP1_SET',
  [EVENT_TYPES.TP1_HIT]: 'TP1_HIT',
  [EVENT_TYPES.PARTIAL_CLOSE]: 'TP1_HIT',
  [EVENT_TYPES.SL_MOVED_BREAKEVEN]: 'BE_SET',
  [EVENT_TYPES.TP2_HIT]: 'TP2_HIT',
  [EVENT_TYPES.TP3_HIT]: 'RUNNER',
  [EVENT_TYPES.TRADE_CLOSED]: 'CLOSED',
};

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export async function logTradeEvent(tradeId, eventType, fields = {}) {
  if (!tradeId || !eventType) return { data: null, error: 'missing tradeId or eventType' };

  const row = {
    trade_id: tradeId,
    event_type: eventType,
    price: num(fields.price),
    quantity: num(fields.quantity),
    percentage: num(fields.percentage),
    realized_pnl: num(fields.realized_pnl),
    fees: num(fields.fees) ?? 0,
    funding: num(fields.funding) ?? 0,
    old_sl: num(fields.old_sl),
    new_sl: num(fields.new_sl),
    remaining_qty: num(fields.remaining_qty),
    exchange_order_id: fields.exchange_order_id ? String(fields.exchange_order_id) : null,
    exchange_response: fields.exchange_response || {},
    metadata: fields.metadata || {},
  };

  const db = getSupabase();
  if (!db) {
    await logEvent('info', 'tradeEventAudit', `${eventType} (no DB)`, { tradeId });
    return { data: { id: `local-${Date.now()}`, ...row }, error: null };
  }

  const { data, error } = await db.from('trade_execution_events').insert(row).select().single();
  if (error) {
    await logEvent('warn', 'tradeEventAudit', `Event insert failed: ${error.message}`, { tradeId, eventType });
    return { data: null, error };
  }

  const stage = STAGE_FOR_EVENT[eventType];
  if (stage) {
    await updateTrade(tradeId, {
      lifecycle_stage: stage,
      ...(fields.remaining_qty != null ? { exchange_qty: fields.remaining_qty } : {}),
      ...(fields.protection_verified ? { protection_verified_at: new Date().toISOString(), db_exchange_sync_ok: true } : {}),
    }).catch(() => {});
  }

  return { data, error: null };
}

export async function recordPartialClose(tradeId, fields = {}) {
  const row = {
    trade_id: tradeId,
    phase: String(fields.phase || 'TP1').toUpperCase(),
    close_pct: num(fields.closePct),
    closed_qty: num(fields.closedQty),
    remaining_qty: num(fields.remainingQty),
    exit_price: num(fields.exitPrice),
    realized_pnl: num(fields.realizedPnl) ?? 0,
    fees: num(fields.fees) ?? 0,
    source: fields.source || 'inferred',
    exchange_trade_id: fields.exchangeTradeId ? String(fields.exchangeTradeId) : null,
  };

  const db = getSupabase();
  if (!db) return { data: row, error: null };

  const { data, error } = await db.from('trade_partial_closes').insert(row).select().single();
  if (error) {
    await logEvent('warn', 'tradeEventAudit', `Partial close insert failed: ${error.message}`, { tradeId });
    return { data: null, error };
  }

  await logTradeEvent(tradeId, EVENT_TYPES.PARTIAL_CLOSE, {
    price: fields.exitPrice,
    quantity: fields.closedQty,
    percentage: fields.closePct,
    realized_pnl: fields.realizedPnl,
    fees: fields.fees,
    remaining_qty: fields.remainingQty,
    metadata: { phase: row.phase, source: row.source },
  });

  return { data, error: null };
}

async function ensurePerformanceDraft(trade) {
  const db = getSupabase();
  if (!db || !trade?.id) return;
  const { data: existing } = await db.from('trade_performance').select('id').eq('trade_id', trade.id).maybeSingle();
  if (existing) return;
  await db.from('trade_performance').insert({
    trade_id: trade.id,
    symbol: trade.symbol,
    direction: trade.direction,
    signal_source: trade.signal_source || null,
    strategy_name: trade.strategy_name || null,
    opened_at: trade.opened_at || new Date().toISOString(),
    exchange_synced: false,
  });
}

export async function auditTradeOpen(savedTrade, { order, slOrder, tp1Order, tp2Order, riskPercentage = null } = {}) {
  if (!savedTrade?.id) return;

  const ex = config.trading?.mode === 'live' ? 'binance_live' : 'binance_demo';
  await updateTrade(savedTrade.id, {
    exchange: ex,
    risk_percentage: riskPercentage,
    lifecycle_stage: 'OPEN',
    exchange_qty: savedTrade.quantity,
    db_exchange_sync_ok: true,
  }).catch(() => {});

  await ensurePerformanceDraft(savedTrade);

  await logTradeEvent(savedTrade.id, EVENT_TYPES.ORDER_CREATED, {
    metadata: { symbol: savedTrade.symbol, direction: savedTrade.direction },
  });
  await logTradeEvent(savedTrade.id, EVENT_TYPES.ORDER_FILLED, {
    price: savedTrade.entry_price,
    quantity: savedTrade.quantity,
    exchange_order_id: order?.orderId,
    exchange_response: order || {},
  });
  if (slOrder) {
    await logTradeEvent(savedTrade.id, EVENT_TYPES.SL_PLACED, {
      price: savedTrade.stop_loss,
      exchange_order_id: slOrder?.algoId || slOrder?.orderId,
      exchange_response: slOrder || {},
      protection_verified: true,
    });
  }
  if (tp1Order) {
    await logTradeEvent(savedTrade.id, EVENT_TYPES.TP1_PLACED, {
      price: savedTrade.tp1,
      percentage: 30,
      exchange_order_id: tp1Order?.algoId || tp1Order?.orderId,
      exchange_response: tp1Order || {},
    });
  }
  if (tp2Order) {
    await logTradeEvent(savedTrade.id, EVENT_TYPES.TP2_PLACED, {
      price: savedTrade.tp2,
      percentage: 40,
      exchange_order_id: tp2Order?.algoId || tp2Order?.orderId,
      exchange_response: tp2Order || {},
    });
  }
}

export async function auditBreakevenMove(trade, { oldSl, newSl, remainQty } = {}) {
  await logTradeEvent(trade.id, EVENT_TYPES.SL_MOVED_BREAKEVEN, {
    old_sl: oldSl ?? trade.initial_stop_loss ?? trade.stop_loss,
    new_sl: newSl ?? trade.stop_loss,
    remaining_qty: remainQty ?? trade.quantity,
  });
}

export async function auditTpHit(trade, phase, fields = {}) {
  const type = phase === 'tp2' ? EVENT_TYPES.TP2_HIT
    : phase === 'tp3' ? EVENT_TYPES.TP3_HIT
      : EVENT_TYPES.TP1_HIT;
  await logTradeEvent(trade.id, type, fields);
}

export async function auditTradeClosed(trade, fields = {}) {
  await logTradeEvent(trade.id, EVENT_TYPES.TRADE_CLOSED, {
    price: fields.exitPrice,
    quantity: fields.quantity ?? 0,
    realized_pnl: fields.realized_pnl,
    remaining_qty: 0,
    metadata: { reason: fields.reason },
  });
  await updateTrade(trade.id, {
    lifecycle_stage: 'CLOSED',
    exchange_qty: 0,
    db_exchange_sync_ok: true,
  }).catch(() => {});
}

export async function getTradeEvents(tradeId, limit = 200) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  return db.from('trade_execution_events').select('*').eq('trade_id', tradeId).order('created_at', { ascending: true }).limit(limit);
}

export async function getTradePartials(tradeId) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  return db.from('trade_partial_closes').select('*').eq('trade_id', tradeId).order('created_at', { ascending: true });
}

export async function markDesync(trade, reason, liveQty = null) {
  await updateTrade(trade.id, {
    db_exchange_sync_ok: false,
    ...(liveQty != null ? { exchange_qty: liveQty, status: liveQty > 0 ? 'partial' : trade.status } : {}),
  }).catch(() => {});
  await logTradeEvent(trade.id, EVENT_TYPES.SYNC_DESYNC, {
    remaining_qty: liveQty,
    metadata: { reason },
  });
}

export async function reopenDesyncedTrade(trade, liveQty) {
  await updateTrade(trade.id, {
    status: liveQty > 0 ? 'partial' : 'open',
    closed_at: null,
    exit_price: null,
    quantity: liveQty,
    exchange_qty: liveQty,
    db_exchange_sync_ok: true,
    lifecycle_stage: trade.tp2_hit ? 'TP2_HIT' : trade.tp1_hit ? 'TP1_HIT' : 'SL_SET',
  }).catch(() => {});
  await logTradeEvent(trade.id, EVENT_TYPES.SYNC_REOPENED, {
    remaining_qty: liveQty,
    metadata: { previous_status: trade.status },
  });
}
