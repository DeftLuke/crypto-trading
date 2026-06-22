/**
 * Unified trade close — DB persistence, PnL, lessons, signal outcome, notifications.
 */
import {
  getSupabase,
  updateTrade,
  updatePairStats,
  saveTradeLesson,
  logEvent,
} from './supabase.js';
import { TRADE_COLUMNS } from './supabase.js';
import { broadcastTradeEvent } from './wsBroadcast.js';
import { processTradeCloseReview } from './tradeCloseReview.js';
import { getRealizedPnlSince } from './userBinance.js';
import { notifyTradePhase } from './tradeExecution.js';
import {
  auditBreakevenMove,
  auditTpHit,
  recordPartialClose,
  markDesync,
  reopenDesyncedTrade,
} from './tradeEventAudit.js';
import {
  canCloseTradeInDb,
  finalizeTradePerformance,
  reconcileLegsFromExchange,
  updatePerformanceDraft,
} from './tradePerformanceEngine.js';
import { getLivePositionQty } from './tradeProtection.js';

export function computeCloseMetrics(trade, exitPrice, closeQty = null) {
  const entry = parseFloat(trade.entry_price);
  const qty = closeQty != null ? parseFloat(closeQty) : parseFloat(trade.quantity);
  const isLong = trade.direction === 'LONG';
  const incrementalPnl = isLong
    ? (exitPrice - entry) * qty
    : (entry - exitPrice) * qty;
  const pnl = (parseFloat(trade.pnl) || 0) + incrementalPnl;
  const originalQty = parseFloat(trade.original_quantity || trade.quantity) || qty;
  const risk = Math.abs(entry - parseFloat(trade.initial_stop_loss || trade.stop_loss));
  const rMultiple = risk > 0 && originalQty > 0
    ? pnl / (risk * originalQty)
    : 0;
  const outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
  const pnlPercent = entry && originalQty ? (pnl / (entry * originalQty)) * 100 : 0;

  return { pnl, rMultiple, outcome, pnlPercent, incrementalPnl };
}

/** Record TP1/TP2 phase with audit partial row + performance draft. */
export async function recordTradePhasePnl(trade, phase) {
  const originalQty = parseFloat(trade.original_quantity || trade.quantity);
  const remainQty = parseFloat(trade.quantity);
  const closedQty = phase === 'tp1' ? originalQty * 0.3 : phase === 'tp2' ? originalQty * 0.4 : 0;
  const closePct = phase === 'tp1' ? 30 : phase === 'tp2' ? 40 : null;

  const reconciled = await reconcileLegsFromExchange(trade).catch(() => null);
  const incrementalRealized = reconciled?.exchangeTotal != null
    ? reconciled.exchangeTotal - (parseFloat(trade.exchange_realized_pnl) || 0)
    : null;

  await recordPartialClose(trade.id, {
    phase: phase === 'tp2' ? 'TP2' : 'TP1',
    closePct,
    closedQty: closedQty || null,
    remainingQty: remainQty,
    exitPrice: phase === 'tp1' ? trade.tp1 : trade.tp2,
    realizedPnl: incrementalRealized,
    source: reconciled?.exchangeSynced ? 'fill' : 'inferred',
  });

  await auditTpHit(trade, phase, {
    price: phase === 'tp1' ? trade.tp1 : trade.tp2,
    quantity: closedQty,
    percentage: closePct,
    remaining_qty: remainQty,
    realized_pnl: incrementalRealized,
  });

  if (phase === 'tp1') {
    await auditBreakevenMove(trade, {
      oldSl: trade.initial_stop_loss,
      newSl: trade.stop_loss,
      remainQty,
    });
  }

  const realized = (reconciled?.gross ?? parseFloat(trade.exchange_realized_pnl)) || 0;

  await updateTrade(trade.id, {
    exchange_realized_pnl: realized,
    pnl: realized,
    status: 'partial',
  }).catch(() => {});

  await updatePerformanceDraft({ ...trade, tp1_hit: phase === 'tp1' || trade.tp1_hit, tp2_hit: phase === 'tp2' || trade.tp2_hit }, {
    gross: realized,
  });

  await saveTradeLesson({
    trade_id: trade.id,
    symbol: trade.symbol,
    direction: trade.direction,
    outcome: realized >= 0 ? 'win' : 'loss',
    lesson_type: phase === 'tp1' ? 'tp1_hit' : phase === 'tp2' ? 'tp2_hit' : 'partial',
    setup_description: `${trade.direction} ${trade.symbol} — ${phase.toUpperCase()} partial close`,
    lesson_text: `${phase.toUpperCase()}: ${trade.symbol} · booked ${realized >= 0 ? '+' : ''}${realized.toFixed(2)} USDT · runner qty ${trade.quantity}`,
    tags: [trade.symbol, trade.direction, phase, 'partial_close'],
    pnl: realized,
    r_multiple: trade.r_multiple,
  }).catch(() => {});

  broadcastTradeEvent(phase === 'tp1' ? 'tp1_partial' : 'tp2_partial', {
    ...trade,
    pnl: realized,
    exchange_realized_pnl: realized,
    status: 'partial',
  }, { phase, realized, runner_qty: trade.quantity });

  await logEvent('trade', 'tradeClose', `${phase} partial close recorded (audit)`, {
    tradeId: trade.id,
    symbol: trade.symbol,
    realized,
    phase,
  });
}

async function resolveClosePnl(trade, exitPrice) {
  const sinceMs = trade.opened_at
    ? new Date(trade.opened_at).getTime() - 120000
    : Date.now() - 7 * 24 * 60 * 60 * 1000;
  const exchange = await getRealizedPnlSince(trade.symbol, sinceMs);
  if (exchange?.total != null && Number.isFinite(exchange.total)) {
    const entry = parseFloat(trade.entry_price);
    const originalQty = parseFloat(trade.original_quantity || trade.quantity) || parseFloat(trade.quantity);
    const risk = Math.abs(entry - parseFloat(trade.initial_stop_loss || trade.stop_loss));
    const pnl = exchange.total;
    const rMultiple = risk > 0 && originalQty > 0 ? pnl / (risk * originalQty) : 0;
    const outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
    const pnlPercent = entry && originalQty ? (pnl / (entry * originalQty)) * 100 : 0;
    return { pnl, rMultiple, outcome, pnlPercent, exchangeRealized: true };
  }
  return { ...computeCloseMetrics(trade, exitPrice), exchangeRealized: false };
}

function isMissingColumnError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('unknown'));
}

async function safeUpdateTrade(id, updates) {
  let result = await updateTrade(id, updates);
  if (result.error && isMissingColumnError(result.error)) {
    const row = {};
    for (const col of TRADE_COLUMNS) {
      if (updates[col] !== undefined && updates[col] !== null) row[col] = updates[col];
    }
    result = await updateTrade(id, row);
  }
  return result;
}

function buildTradeLesson(trade, exitPrice, pnl, outcome, reason) {
  return `${outcome.toUpperCase()}: ${trade.symbol} ${trade.direction} closed at ${exitPrice}. ` +
    `PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT. Reason: ${reason}.`;
}

function formatUtc(iso) {
  if (!iso) return '—';
  return `${new Date(iso).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/**
 * Persist closed trade to DB and run post-close pipeline.
 * @returns {Promise<object|null>} Updated trade row
 */
export async function finalizeTradeClose(trade, {
  exitPrice,
  status = 'closed',
  reason = 'closed',
  skipReview = false,
  skipNotify = false,
  force = false,
} = {}) {
  if (!trade?.id || !Number.isFinite(parseFloat(exitPrice))) {
    await logEvent('warn', 'tradeClose', 'finalizeTradeClose skipped — missing trade or exit price', {
      tradeId: trade?.id,
      exitPrice,
    });
    return null;
  }

  if (!force && ['closed', 'stopped'].includes(trade.status) && trade.closed_at) {
    return trade;
  }

  const { pnl, rMultiple, outcome, pnlPercent, exchangeRealized } = await resolveClosePnl(trade, exitPrice);
  const perf = await finalizeTradePerformance(trade, { exitPrice, reason }).catch(() => null);
  const finalPnl = perf?.net_profit != null ? perf.net_profit : pnl;
  const finalOutcome = perf?.win != null ? (perf.win ? 'win' : perf.net_profit < 0 ? 'loss' : 'breakeven') : outcome;
  const closedAt = new Date().toISOString();

  const updates = {
    status,
    exit_price: exitPrice,
    pnl: finalPnl,
    pnl_percent: pnlPercent,
    r_multiple: rMultiple,
    close_reason: reason,
    closed_at: closedAt,
    quantity: 0,
    exchange_qty: 0,
    lifecycle_stage: 'CLOSED',
    db_exchange_sync_ok: true,
  };
  if (exchangeRealized || perf?.exchange_synced) updates.exchange_realized_pnl = finalPnl;

  const { data: updated, error } = await safeUpdateTrade(trade.id, updates);
  if (error) {
    await logEvent('error', 'tradeClose', `Failed to persist close: ${error.message || error}`, {
      tradeId: trade.id,
      symbol: trade.symbol,
    });
    return null;
  }

  const closedTrade = { ...trade, ...updates, ...(updated || {}) };

  await updatePairStats(trade.symbol, finalOutcome, rMultiple).catch(() => {});

  const lessonText = buildTradeLesson(trade, exitPrice, finalPnl, finalOutcome, reason);
  await saveTradeLesson({
    trade_id: trade.id,
    symbol: trade.symbol,
    direction: trade.direction,
    outcome: finalOutcome,
    lesson_type: 'executed',
    setup_description: `${trade.direction} on ${trade.symbol} — entry ${trade.entry_price}, SL ${trade.stop_loss}`,
    lesson_text: lessonText,
    tags: [trade.symbol, trade.direction, finalOutcome, reason],
    pnl: finalPnl,
    r_multiple: rMultiple,
  }).catch(() => {});

  if (!skipReview) {
    processTradeCloseReview(closedTrade, { reason }).catch((err) =>
      logEvent('warn', 'tradeClose', `Close review failed: ${err.message}`, { tradeId: trade.id }),
    );
  }

  if (trade.signal_id) {
    const db = getSupabase();
    await db?.from('signals').update({
      final_outcome: finalOutcome,
      status: 'closed',
    }).eq('id', trade.signal_id).catch(() => {});
  }

  if (!skipNotify) {
    const { sendTradeLifecycle } = await import('./telegram.js');
    await sendTradeLifecycle('trade.closed', {
      trade: closedTrade,
      message: `✅ <b>Trade Closed</b> — ${trade.symbol}\n` +
        `PnL: <code>${finalPnl >= 0 ? '+' : ''}${finalPnl.toFixed(2)} USDT</code> · ${rMultiple.toFixed(2)}R\n` +
        `Reason: ${reason}\n` +
        `Opened: ${formatUtc(trade.opened_at)}\nClosed: ${formatUtc(closedAt)}` +
        (exchangeRealized ? '\n<i>PnL from Binance realized income</i>' : ''),
    }).catch(() => {});
    broadcastTradeEvent('closed', closedTrade);
  }

  await logEvent('trade', 'tradeClose', `Trade closed: ${reason}`, {
    tradeId: trade.id,
    symbol: trade.symbol,
    pnl: finalPnl,
    rMultiple,
    outcome: finalOutcome,
    exchangeRealized,
  });

  const { cacheInvalidatePrefix } = await import('./cache.js');
  await cacheInvalidatePrefix('dashboard:').catch(() => {});
  await cacheInvalidatePrefix('dash:').catch(() => {});

  return closedTrade;
}

/** Close DB only when exchange flat AND legs reconciled (audit layer). */
export async function reconcileFlatExchangeTrade(trade, exitPriceHint = null, { skipNotify = false, force = false } = {}) {
  const liveQty = await getLivePositionQty(trade.symbol).catch(() => null);

  if (['closed', 'stopped'].includes(trade.status) && liveQty > 0) {
    await markDesync(trade, 'db_closed_exchange_open', liveQty);
    await reopenDesyncedTrade(trade, liveQty);
    return trade;
  }

  if (!force) {
    const gate = await canCloseTradeInDb(trade, liveQty ?? 0);
    if (!gate.allowed) {
      await logEvent('info', 'tradeClose', `Reconcile deferred: ${gate.reason}`, {
        tradeId: trade.id,
        symbol: trade.symbol,
        liveQty,
      });
      if (gate.reason === 'exchange_still_open' && liveQty > 0) {
        await updateTrade(trade.id, {
          quantity: liveQty,
          exchange_qty: liveQty,
          status: trade.tp1_hit || trade.tp2_hit ? 'partial' : 'open',
          db_exchange_sync_ok: true,
        }).catch(() => {});
      }
      return null;
    }
  }

  const { getMarkPrice } = await import('./binance.js');
  const exitPrice = exitPriceHint
    || parseFloat(trade.exit_price)
    || await getMarkPrice(trade.symbol).catch(() => parseFloat(trade.entry_price));

  return finalizeTradeClose(trade, {
    exitPrice,
    status: 'closed',
    reason: 'Exchange flat — synced close',
    skipNotify,
    force: true,
  });
}

