/**
 * Re-link exchange positions to DB when records were closed incorrectly.
 */
import { getSupabase, updateTrade, logEvent, getOpenTrades } from './supabase.js';
import { getLivePositionQty, verifyExchangeProtection } from './tradeProtection.js';
import { attemptTradeRecovery } from './tradeRecovery.js';
import { reconcileFlatExchangeTrade } from './tradeClose.js';

export async function findDbTradeForLivePosition(symbol, liveQty = null) {
  const db = getSupabase();
  if (!db || !symbol) return null;

  const qty = liveQty ?? await getLivePositionQty(symbol);
  if (!qty || qty <= 0) return null;

  const { data: open } = await db
    .from('trades')
    .select('*')
    .eq('symbol', symbol)
    .in('status', ['open', 'partial'])
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) return open;

  const { data: recent } = await db
    .from('trades')
    .select('*')
    .eq('symbol', symbol)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!recent || recent.status !== 'closed') return null;

  const originalQty = parseFloat(recent.original_quantity || recent.quantity);
  const pctRemain = originalQty > 0 ? qty / originalQty : 1;
  const updates = {
    status: recent.tp2_hit ? 'partial' : recent.tp1_hit ? 'partial' : 'open',
    quantity: qty,
    closed_at: null,
    exit_price: null,
    exit_reason: null,
    close_reason: null,
  };
  if (pctRemain <= 0.71 && !recent.tp1_hit) {
    updates.tp1_hit = true;
    updates.tp1_hit_at = recent.tp1_hit_at || new Date().toISOString();
    updates.sl_moved_breakeven = true;
    updates.status = 'partial';
  }
  if (pctRemain <= 0.31 && !recent.tp2_hit && recent.tp1_hit) {
    updates.tp2_hit = true;
    updates.tp2_hit_at = recent.tp2_hit_at || new Date().toISOString();
    updates.status = 'partial';
  }

  await updateTrade(recent.id, updates);
  await logEvent('info', 'tradeReconcile', `Reopened DB trade for live ${symbol} position`, {
    tradeId: recent.id,
    liveQty,
    originalQty,
    previousStatus: recent.status,
  });

  return { ...recent, ...updates };
}

export async function reconcileLivePosition(symbol) {
  const verify = await verifyExchangeProtection(symbol);
  if (!verify?.hasPosition) return null;

  const trade = await findDbTradeForLivePosition(symbol, verify.positionQty);
  if (!trade) return null;

  const issues = [];
  if (verify.slCount < 1) issues.push('missing_exchange_sl');
  if (!trade.tp2_hit && verify.tpCount < 1) issues.push('missing_exchange_tp');

  if (issues.length > 0) {
    await attemptTradeRecovery(trade, issues).catch((err) =>
      logEvent('warn', 'tradeReconcile', `Recovery after reopen failed: ${err.message}`, { symbol }),
    );
  }

  return trade;
}

/** Close DB open trades when Binance has no position (clean slate after manual closes). */
export async function reconcileAllFlatExchangeTrades({ skipNotify = true } = {}) {
  const { data: openTrades } = await getOpenTrades();
  const closed = [];

  for (const trade of openTrades || []) {
    if (!trade?.symbol) continue;
    const qty = await getLivePositionQty(trade.symbol);
    if (qty == null || qty > 0) continue;
    const result = await reconcileFlatExchangeTrade(trade, null, { skipNotify });
    if (result) {
      closed.push({ id: trade.id, symbol: trade.symbol, pnl: result.pnl });
      await logEvent('info', 'tradeReconcile', `Closed orphan DB trade (exchange flat): ${trade.symbol}`, {
        tradeId: trade.id,
      });
    }
  }

  return { closed: closed.length, trades: closed };
}
