/**
 * Emergency SL/TP recovery when protection is missing on DB or Binance.
 */
import { getSupabase, updateTrade, logEvent } from './supabase.js';
import { getMarkPrice, roundPriceToTick, getSymbolRules, cancelAllOrders, placeMarketOrder } from './binance.js';
import {
  getActiveApiKeys,
  placeMarketOrderWithCredentials,
  cancelAllOrdersWithCredentials,
} from './userBinance.js';
import {
  placeScaleOutTakeProfits,
  repositionAfterTP1,
  repositionAfterTP2,
  repositionProtectiveStop,
  verifyExchangeProtection,
  ensureTradeProtection,
} from './tradeProtection.js';
import { reconcileFlatExchangeTrade } from './tradeClose.js';
import { getBreakevenSL } from '../strategy/riskManager.js';
import { sendAlert } from './telegram.js';
import { config } from '../config/index.js';

const recoveryInFlight = new Set();

async function loadSignalForTrade(trade) {
  const db = getSupabase();
  if (!db || !trade.signal_id) return null;
  const { data } = await db.from('signals').select('*').eq('id', trade.signal_id).maybeSingle();
  return data;
}

function resolveLevels(trade, signal, markPrice) {
  const sl = parseFloat(trade.stop_loss ?? trade.initial_stop_loss ?? signal?.stop_loss);
  let tp1 = parseFloat(trade.tp1 ?? signal?.tp1);
  let tp2 = parseFloat(trade.tp2 ?? signal?.tp2);
  const entry = parseFloat(trade.entry_price ?? signal?.entry_price ?? markPrice);
  const direction = trade.direction === 'SHORT' ? 'SHORT' : 'LONG';

  if (!Number.isFinite(sl) || sl <= 0) {
    const buffer = entry * 0.01;
    return {
      stopLoss: direction === 'LONG' ? entry - buffer : entry + buffer,
      tp1: direction === 'LONG' ? entry + buffer : entry - buffer,
      tp2: direction === 'LONG' ? entry + buffer * 2 : entry - buffer * 2,
      emergency: true,
    };
  }

  if (!Number.isFinite(tp1) || tp1 <= 0) {
    const risk = Math.abs(entry - sl);
    tp1 = direction === 'LONG' ? entry + risk : entry - risk;
  }
  if (!Number.isFinite(tp2) || tp2 <= 0) {
    const risk = Math.abs(entry - sl);
    tp2 = direction === 'LONG' ? entry + risk * 2 : entry - risk * 2;
  }

  return { stopLoss: sl, tp1, tp2, emergency: false };
}

function isTradeProtected(trade, verify) {
  if (!verify?.hasPosition) return false;
  if (verify.slCount < 1) return false;
  if (trade.tp2_hit) return true;
  if (trade.tp1_hit) return verify.tpCount >= 1;
  return verify.tpCount >= 1;
}

async function emergencyClose(trade, reason) {
  const credentials = await getActiveApiKeys();
  const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
  const qty = parseFloat(trade.quantity);
  if (!qty || qty <= 0) return { ok: false, reason: 'invalid_qty' };

  if (credentials) {
    await cancelAllOrdersWithCredentials(credentials, trade.symbol).catch(() => {});
    await placeMarketOrderWithCredentials(credentials, {
      symbol: trade.symbol,
      side,
      quantity: qty,
      reduceOnly: true,
    });
  } else {
    await cancelAllOrders(trade.symbol).catch(() => {});
    await placeMarketOrder(trade.symbol, side, qty, true);
  }

  await updateTrade(trade.id, {
    status: 'closed',
    closed_at: new Date().toISOString(),
    exit_reason: `emergency_close:${reason}`,
  });

  await sendAlert(
    `🛑 <b>Emergency Close</b>\n${trade.symbol} — could not restore SL/TP\nReason: ${reason}`,
  ).catch(() => {});

  return { ok: true, action: 'emergency_close', reason };
}

export async function attemptTradeRecovery(trade, issues = []) {
  if (!trade?.id || recoveryInFlight.has(trade.id)) {
    return { ok: false, reason: 'recovery_in_progress_or_invalid' };
  }
  recoveryInFlight.add(trade.id);

  try {
    const verify = await verifyExchangeProtection(trade.symbol);
    if (!verify?.hasPosition && issues.includes('orphan_db_trade_no_exchange_position')) {
      await reconcileFlatExchangeTrade(trade, null, { skipNotify: true });
      return { ok: true, action: 'closed_orphan_db_record' };
    }

    if (!verify?.hasPosition) {
      return { ok: false, reason: 'no_exchange_position' };
    }

    const signal = await loadSignalForTrade(trade);
    const markPrice = await getMarkPrice(trade.symbol);
    const rules = await getSymbolRules(trade.symbol);
    const { stopLoss, tp1, tp2, emergency } = resolveLevels(trade, signal, markPrice);
    const sl = roundPriceToTick(stopLoss, rules.tickSize);
    const tp1Px = roundPriceToTick(tp1, rules.tickSize);
    const tp2Px = roundPriceToTick(tp2, rules.tickSize);
    const credentials = await getActiveApiKeys();
    const originalQty = parseFloat(trade.original_quantity || trade.quantity);
    const liveQty = verify.positionQty || parseFloat(trade.quantity);
    const direction = trade.direction === 'SHORT' ? 'SHORT' : 'LONG';

    const needsExchangeSl = issues.includes('missing_exchange_sl') || verify.slCount < 1;
    const needsExchangeTp = issues.includes('missing_exchange_tp') || verify.tpCount < 1;
    const needsDbPatch = issues.some((i) => i.startsWith('missing_db_'));

    if (needsExchangeSl || needsExchangeTp) {
      await ensureTradeProtection(trade, credentials);
      const afterEnsure = await verifyExchangeProtection(trade.symbol, credentials);
      if (afterEnsure.slCount >= 1 && (afterEnsure.tpCount >= 1 || trade.tp2_hit)) {
        if (needsDbPatch) {
          await updateTrade(trade.id, {
            stop_loss: sl,
            initial_stop_loss: trade.initial_stop_loss || sl,
            tp1: tp1Px,
            tp2: tp2Px,
            quantity: liveQty,
          });
        }
        return { ok: true, action: 'protection_restored' };
      }
    }

    if (trade.tp2_hit) {
      if (needsExchangeSl) {
        await repositionAfterTP2(
          {
            symbol: trade.symbol,
            direction,
            remainQty: liveQty,
            stopPrice: sl,
            tp1: tp1Px,
            entryPrice: parseFloat(trade.entry_price),
          },
          credentials,
        );
      }
    } else if (trade.tp1_hit) {
      const stopPrice = trade.sl_moved_breakeven
        ? getBreakevenSL(parseFloat(trade.entry_price) || markPrice, direction)
        : sl;
      if (needsExchangeSl || needsExchangeTp) {
        await repositionAfterTP1(
          {
            symbol: trade.symbol,
            direction,
            originalQty,
            remainQty: liveQty,
            stopPrice,
            tp2: tp2Px,
          },
          credentials,
        );
      }
    } else {
      if (needsExchangeSl) {
        const effectiveSl = emergency
          ? getBreakevenSL(parseFloat(trade.entry_price) || markPrice, direction)
          : sl;
        await repositionProtectiveStop(
          { symbol: trade.symbol, direction, stopPrice: effectiveSl, quantity: liveQty },
          credentials,
        );
      }
      if (needsExchangeTp) {
        await placeScaleOutTakeProfits(
          { symbol: trade.symbol, direction, quantity: originalQty, tp1: tp1Px, tp2: tp2Px },
          credentials,
        );
      }
    }

    if (needsDbPatch || needsExchangeSl || needsExchangeTp) {
      await updateTrade(trade.id, {
        stop_loss: sl,
        initial_stop_loss: trade.initial_stop_loss || sl,
        tp1: tp1Px,
        tp2: tp2Px,
        quantity: liveQty,
      });
    }

    const after = await verifyExchangeProtection(trade.symbol);
    const protectedOk = isTradeProtected(trade, after);

    await logEvent(
      protectedOk ? 'info' : 'warn',
      'tradeRecovery',
      protectedOk ? `Recovered protection: ${trade.symbol}` : `Partial recovery: ${trade.symbol}`,
      { tradeId: trade.id, issues, after, emergency, phase: trade.tp2_hit ? 'runner' : trade.tp1_hit ? 'after_tp1' : 'open' },
    );

    if (!protectedOk && config.tradeSafety?.emergencyCloseOnFailure !== false) {
      return emergencyClose(trade, 'recovery_incomplete');
    }

    if (protectedOk) {
      await sendAlert(
        `✅ <b>Protection Restored</b>\n${trade.symbol}\n` +
        `SL: <code>${sl}</code> · TP1: <code>${tp1Px}</code> · TP2: <code>${tp2Px}</code>`,
      ).catch(() => {});
    }

    return { ok: protectedOk, action: 'recovered', verify: after, emergency };
  } finally {
    recoveryInFlight.delete(trade.id);
  }
}
