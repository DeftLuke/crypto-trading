/**
 * PnL from partial legs + Binance userTrades.
 */
import { getSupabase, logEvent } from './supabase.js';
import { getRealizedPnlSince } from './userBinance.js';
import { auditTradeClosed, recordPartialClose } from './tradeEventAudit.js';

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function sumPartialLegs(tradeId) {
  const db = getSupabase();
  if (!db) return { gross: 0, fees: 0, legs: [] };

  const { data: legs } = await db
    .from('trade_partial_closes')
    .select('*')
    .eq('trade_id', tradeId)
    .order('created_at', { ascending: true });

  const rows = legs || [];
  return {
    gross: rows.reduce((s, r) => s + num(r.realized_pnl), 0),
    fees: rows.reduce((s, r) => s + num(r.fees), 0),
    legs: rows,
  };
}

export async function reconcileLegsFromExchange(trade) {
  if (!trade?.id || !trade?.opened_at) {
    return { ok: false, reason: 'no_trade', partials: { gross: 0, fees: 0, legs: [] } };
  }

  const sinceMs = new Date(trade.opened_at).getTime() - 120000;
  const exchange = await getRealizedPnlSince(trade.symbol, sinceMs).catch(() => null);
  const partials = await sumPartialLegs(trade.id);

  if (exchange?.total == null) {
    return { ok: false, reason: 'exchange_unavailable', ...partials, exchangeSynced: false };
  }

  if (partials.legs.length === 0 && exchange.total !== 0) {
    await recordPartialClose(trade.id, {
      phase: 'RUNNER',
      closePct: 100,
      closedQty: trade.original_quantity || trade.quantity,
      remainingQty: 0,
      exitPrice: trade.exit_price,
      realizedPnl: exchange.total,
      source: exchange.source === 'userTrades' ? 'fill' : 'inferred',
    });
    partials.gross = exchange.total;
  }

  return {
    ok: true,
    exchangeTotal: exchange.total,
    exchangeSource: exchange.source,
    gross: partials.legs.length ? partials.gross : exchange.total,
    fees: partials.fees,
    legs: partials.legs,
    exchangeSynced: true,
  };
}

export async function updatePerformanceDraft(trade, { gross, fees = 0, funding = 0 } = {}) {
  const db = getSupabase();
  if (!db || !trade?.id) return null;

  const net = num(gross) - num(fees) - num(funding);
  const margin = num(trade.margin_usdt);
  const row = {
    gross_profit: num(gross),
    fees: num(fees),
    funding: num(funding),
    net_profit: net,
    roi_pct: margin > 0 ? (net / margin) * 100 : null,
    tp1_hit: Boolean(trade.tp1_hit),
    tp2_hit: Boolean(trade.tp2_hit),
    tp3_hit: Boolean(trade.tp3_hit),
    be_exit: Boolean(trade.sl_moved_breakeven),
    updated_at: new Date().toISOString(),
  };

  await db.from('trade_performance').upsert({
    trade_id: trade.id,
    symbol: trade.symbol,
    direction: trade.direction,
    signal_source: trade.signal_source,
    strategy_name: trade.strategy_name,
    opened_at: trade.opened_at,
    ...row,
  }, { onConflict: 'trade_id' });

  return row;
}

export async function finalizeTradePerformance(trade, { exitPrice, reason = 'closed' } = {}) {
  const reconciled = await reconcileLegsFromExchange(trade);
  let gross = reconciled.gross ?? 0;
  let fees = reconciled.fees ?? 0;
  let exchangeSynced = reconciled.exchangeSynced === true;

  if (reconciled.exchangeTotal != null) {
    gross = reconciled.exchangeTotal;
    exchangeSynced = reconciled.ok;
  } else if (!reconciled.legs?.length && exitPrice) {
    const entry = num(trade.entry_price);
    const qty = num(trade.original_quantity || trade.quantity);
    gross = trade.direction === 'LONG'
      ? (num(exitPrice) - entry) * qty
      : (entry - num(exitPrice)) * qty;
    exchangeSynced = false;
  }

  const net = gross - fees;
  const margin = num(trade.margin_usdt);
  const win = net > 0;
  const closedAt = new Date().toISOString();

  const db = getSupabase();
  if (!db) return { net_profit: net, win, exchangeSynced };

  const perfRow = {
    trade_id: trade.id,
    symbol: trade.symbol,
    direction: trade.direction,
    signal_source: trade.signal_source,
    strategy_name: trade.strategy_name,
    gross_profit: gross,
    fees,
    funding: 0,
    net_profit: net,
    roi_pct: margin > 0 ? (net / margin) * 100 : null,
    win,
    tp1_hit: Boolean(trade.tp1_hit),
    tp2_hit: Boolean(trade.tp2_hit),
    tp3_hit: Boolean(trade.tp3_hit),
    be_exit: Boolean(trade.sl_moved_breakeven),
    sl_exit: /stop|sl/i.test(reason),
    exchange_synced: exchangeSynced,
    opened_at: trade.opened_at,
    closed_at: closedAt,
    updated_at: closedAt,
  };

  const { data: perf } = await db.from('trade_performance').upsert(perfRow, { onConflict: 'trade_id' }).select().single();

  await auditTradeClosed(trade, { exitPrice, realized_pnl: net, reason });

  await db.from('trade_learning_dataset').upsert({
    trade_id: trade.id,
    performance_id: perf?.id,
    payload: {
      signal_source: trade.signal_source,
      strategy_name: trade.strategy_name,
      symbol: trade.symbol,
      direction: trade.direction,
      entry: num(trade.entry_price),
      tp1_hit: Boolean(trade.tp1_hit),
      tp2_hit: Boolean(trade.tp2_hit),
      final_result: win ? 'WIN' : net < 0 ? 'LOSS' : 'BREAKEVEN',
      profit: net,
      exchange_synced: exchangeSynced,
      close_reason: reason,
    },
  }, { onConflict: 'trade_id' });

  await logEvent('trade', 'tradePerformance', 'Performance finalized', {
    tradeId: trade.id,
    symbol: trade.symbol,
    net,
    win,
    exchangeSynced,
  });

  return { ...perfRow, performance_id: perf?.id };
}

export async function canCloseTradeInDb(trade, liveQty) {
  if (liveQty == null) return { allowed: false, reason: 'exchange_qty_unknown' };
  if (liveQty > 0) return { allowed: false, reason: 'exchange_still_open', liveQty };

  const { legs } = await sumPartialLegs(trade.id);
  let reconciled = { ok: legs.length > 0 };
  if ((trade.tp1_hit || trade.tp2_hit) && legs.length === 0) {
    reconciled = await reconcileLegsFromExchange(trade).catch(() => ({ ok: false }));
  }

  // Exchange confirmed flat — close DB even if partial legs were not recorded (ghost partial fix).
  return { allowed: true, reconciled, legs };
}
