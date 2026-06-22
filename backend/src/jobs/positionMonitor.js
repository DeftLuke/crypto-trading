import {
  getOpenTrades,
  updateTrade,
  logEvent,
} from '../services/supabase.js';
import {
  placeStopMarketOrder,
  placeMarketOrder,
  cancelAllOrders,
  getPositionRisk,
} from '../services/binance.js';
import { getFreshMarkPrice } from '../services/markPrice.js';
import { binanceWs } from '../services/binanceWs.js';
import {
  calculateTPQuantities,
  getBreakevenSL,
  getRunnerStopAfterTP2,
  computeTrailingStop,
} from '../strategy/riskManager.js';
import {
  getActiveApiKeys,
  placeMarketOrderWithCredentials,
  placeStopMarketOrderWithCredentials,
  cancelAllOrdersWithCredentials,
  getPositionRiskWithCredentials,
} from '../services/userBinance.js';
import { notifyTradePhase } from '../services/tradeExecution.js';
import { config } from '../config/index.js';
import { broadcastTradeEvent } from '../services/wsBroadcast.js';
import {
  repositionAfterTP1,
  repositionAfterTP2,
  repositionProtectiveStop,
  verifyExchangeProtection,
  getLivePositionQty,
  ensureTradeProtection,
  isRunnerDust,
  positionNotional,
  DUST_NOTIONAL_USDT,
} from '../services/tradeProtection.js';
import { finalizeTradeClose, reconcileFlatExchangeTrade, recordTradePhasePnl } from '../services/tradeClose.js';
import { markDesync, reopenDesyncedTrade } from '../services/tradeEventAudit.js';
import { getSupabase } from '../services/supabase.js';
import { reconcileLivePosition } from '../services/tradeReconcile.js';
import { fetchExchangeRealizedPnl } from '../services/tradePnl.js';
import { isExchangeBlocked } from '../services/exchangeRateLimit.js';

class PositionMonitor {
  constructor() {
    this.running = false;
    this.interval = null;
    this.inFlight = new Set();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.interval = setInterval(() => this.checkPositions(), 15_000);
    this.orphanTick = 0;
    console.log('[PositionMonitor] Started — checking every 15s');
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
  }

  async checkPositions() {
    if (isExchangeBlocked()) return;

    if (this.orphanTick % 2 === 0) {
      await this.syncDesyncedClosedTrades().catch(() => {});
    }

    const { data: trades } = await getOpenTrades();
    const openSymbols = new Set((trades || []).map((t) => t.symbol));

    for (const trade of trades || []) {
      binanceWs.subscribeMarkPrice(trade.symbol, () => {});
      try {
        await ensureTradeProtection(trade).catch((err) =>
          logEvent('warn', 'positionMonitor', `Protection ensure failed: ${err.message}`, { tradeId: trade.id }),
        );
        await this.syncExchangeClosed(trade);
        const synced = await this.syncTradeFromExchange(trade);
        await this.manageTrade(synced || trade);
      } catch (err) {
        await logEvent('error', 'positionMonitor', err.message, { tradeId: trade.id });
      }
    }

    this.orphanTick += 1;
    if (this.orphanTick % 4 === 0) {
      await this.reconcileOrphanExchangePositions(openSymbols);
    }
  }

  async reconcileOrphanExchangePositions(openSymbols) {
    try {
      const { getCachedPositions, isUserStreamLive } = await import('../services/binanceUserStream.js');
      let positions = [];
      if (isUserStreamLive()) {
        positions = getCachedPositions();
      } else {
        const credentials = await getActiveApiKeys();
        const rows = credentials
          ? await getPositionRiskWithCredentials(credentials)
          : await getPositionRisk();
        positions = (rows || []).map((row) => ({
          symbol: row.symbol,
          quantity: Math.abs(parseFloat(row.positionAmt || 0)),
          notional: Math.abs(parseFloat(row.notional || 0)),
          entry_price: parseFloat(row.entryPrice || 0),
          current_price: parseFloat(row.markPrice || row.entryPrice || 0),
        }));
      }
      for (const row of positions) {
        const symbol = row.symbol;
        if (openSymbols.has(symbol)) continue;
        const qty = row.quantity ?? Math.abs(parseFloat(row.positionAmt || 0));
        if (qty <= 0) continue;
        const notional = positionNotional(row);
        if (notional < DUST_NOTIONAL_USDT && notional < 1) {
          await reconcileLivePosition(symbol);
          continue;
        }
        if (notional < 1) continue;
        await reconcileLivePosition(symbol);
      }
    } catch (err) {
      await logEvent('warn', 'positionMonitor', `Orphan reconcile failed: ${err.message}`);
    }
  }

  /** Re-open trades wrongly marked closed while exchange still has qty. */
  async syncDesyncedClosedTrades() {
    const db = getSupabase();
    if (!db) return;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: closed } = await db
      .from('trades')
      .select('*')
      .in('status', ['closed', 'stopped'])
      .gte('closed_at', since)
      .order('closed_at', { ascending: false })
      .limit(30);
    for (const trade of closed || []) {
      const liveQty = await getLivePositionQty(trade.symbol).catch(() => null);
      if (liveQty == null || liveQty <= 0) continue;
      await markDesync(trade, 'db_closed_exchange_open', liveQty);
      await reopenDesyncedTrade(trade, liveQty);
      await logEvent('warn', 'positionMonitor', 'Reopened desynced closed trade', {
        tradeId: trade.id,
        symbol: trade.symbol,
        liveQty,
      });
    }
  }

  /** If exchange has no position but DB still open — sync closed state to dashboard. */
  async syncExchangeClosed(trade) {
    if (!['open', 'partial'].includes(trade.status)) return;
    const liveQty = await getLivePositionQty(trade.symbol);
    if (liveQty == null) return;
    if (liveQty > 0) return;
    const price = await getFreshMarkPrice(trade.symbol);
    if (!price) return;
    await logEvent('info', 'positionMonitor', 'Exchange flat — closing DB trade', { tradeId: trade.id, symbol: trade.symbol });
    await reconcileFlatExchangeTrade(trade, price);
  }

  /** Infer TP hits from live exchange quantity vs original size. */
  async syncTradeFromExchange(trade) {
    const liveQty = await getLivePositionQty(trade.symbol);
    if (!liveQty || liveQty <= 0) return trade;

    const originalQty = parseFloat(trade.original_quantity || trade.quantity);
    if (!originalQty || originalQty <= 0) return trade;

    const entry = parseFloat(trade.entry_price);
    const initialSl = parseFloat(trade.initial_stop_loss || trade.stop_loss);
    const risk = Math.abs(entry - initialSl);
    const pctRemain = liveQty / originalQty;
    const updates = {};

    if (Math.abs(liveQty - parseFloat(trade.quantity)) > originalQty * 0.001) {
      updates.quantity = liveQty;
    }

    if (!trade.tp1_hit && pctRemain <= 0.71) {
      updates.tp1_hit = true;
      updates.tp1_hit_at = new Date().toISOString();
      updates.sl_moved_breakeven = true;
      updates.stop_loss = getBreakevenSL(entry, trade.direction);
      updates.status = 'partial';
    }

    if (!trade.tp2_hit && pctRemain <= 0.31) {
      const mark = await getFreshMarkPrice(trade.symbol) || entry;
      updates.tp2_hit = true;
      updates.tp2_hit_at = new Date().toISOString();
      updates.sl_locked_1r = true;
      updates.stop_loss = getRunnerStopAfterTP2(trade.tp1, trade.direction, {
        markPrice: mark,
        entryPrice: entry,
      });
      updates.status = 'partial';
    }

    if (Object.keys(updates).length && (updates.tp1_hit || updates.tp2_hit)) {
      const exchPnl = await fetchExchangeRealizedPnl({ ...trade, ...updates }).catch(() => null);
      if (exchPnl?.total != null) {
        updates.exchange_realized_pnl = exchPnl.total;
        updates.pnl = exchPnl.total;
      }
    }

    if (!Object.keys(updates).length) return trade;

    if (updates.tp1_hit && !trade.tp1_hit) {
      const { slOk } = await repositionAfterTP1({
        symbol: trade.symbol,
        direction: trade.direction,
        originalQty,
        remainQty: liveQty,
        stopPrice: updates.stop_loss,
        tp2: trade.tp2,
      });
      if (!slOk) {
        delete updates.tp1_hit;
        delete updates.tp1_hit_at;
        delete updates.sl_moved_breakeven;
        delete updates.stop_loss;
        delete updates.status;
        delete updates.pnl;
      }
    }
    if (updates.tp2_hit && !trade.tp2_hit) {
      await repositionAfterTP2({
        symbol: trade.symbol,
        direction: trade.direction,
        remainQty: liveQty,
        stopPrice: updates.stop_loss,
        tp1: trade.tp1,
        entryPrice: entry,
      });
    }

    await updateTrade(trade.id, updates);
    const merged = { ...trade, ...updates };

    const stillOpen = await getLivePositionQty(trade.symbol);
    if (stillOpen != null && stillOpen <= 0 && !trade.closed_at) {
      const exitPrice = await getFreshMarkPrice(trade.symbol) || entry;
      await finalizeTradeClose(merged, {
        exitPrice,
        status: 'closed',
        reason: 'Exchange flat — synced close',
      });
    } else if (updates.tp1_hit && !trade.tp1_hit) {
      await recordTradePhasePnl(merged, 'tp1');
    } else if (updates.tp2_hit && !trade.tp2_hit) {
      await recordTradePhasePnl(merged, 'tp2');
    }

    if (updates.tp1_hit && !trade.tp1_hit) {
      await notifyTradePhase('tp1', merged, {
        quantity: liveQty,
        stopLoss: updates.stop_loss,
        hitAt: updates.tp1_hit_at,
      });
      broadcastTradeEvent('tp1_partial', merged);
    }
    if (updates.tp2_hit && !trade.tp2_hit) {
      if (updates.status !== 'closed') {
        await notifyTradePhase('tp2', merged, {
          quantity: liveQty,
          stopLoss: updates.stop_loss,
          hitAt: updates.tp2_hit_at,
        });
      }
      broadcastTradeEvent(updates.status === 'closed' ? 'tp2_closed' : 'tp2_partial', merged);
    }
    return merged;
  }

  async manageTrade(trade) {
    if (this.inFlight.has(trade.id)) return;

    const price = await getFreshMarkPrice(trade.symbol);
    if (!price) return;

    const entry = parseFloat(trade.entry_price);
    const sl = parseFloat(trade.stop_loss);
    const tp1 = parseFloat(trade.tp1);
    const tp2 = parseFloat(trade.tp2);
    const originalQty = parseFloat(trade.original_quantity || trade.quantity);
    const risk = Math.abs(entry - parseFloat(trade.initial_stop_loss || trade.stop_loss));
    const isLong = trade.direction === 'LONG';
    const liveQty = await getLivePositionQty(trade.symbol);
    if (!liveQty || liveQty <= 0) return;

    if (trade.tp2_hit && isRunnerDust(liveQty, price, originalQty)) {
      await this.withLock(trade.id, () => this.closeTrade(
        trade,
        price,
        'closed',
        'Runner dust closed — below min notional after TP2',
      ));
      return;
    }

    if (!trade.tp2_hit) {
      if ((isLong && price <= sl) || (!isLong && price >= sl)) {
        const reason = trade.tp1_hit ? 'Stop loss hit' : 'Stop loss hit';
        await this.withLock(trade.id, () => this.closeTrade(trade, price, 'stopped', reason));
        return;
      }
    }

    if (trade.tp2_hit && !trade.tp3_hit) {
      if ((isLong && price <= sl) || (!isLong && price >= sl)) {
        await this.withLock(trade.id, () => this.closeTrade(trade, price, 'closed', 'Runner trailing SL hit'));
        return;
      }
    }

    if (!trade.tp1_hit) {
      const tp1Hit = isLong ? price >= tp1 : price <= tp1;
      if (tp1Hit) {
        await this.withLock(trade.id, () => this.handleTP1(trade, price, risk, originalQty));
        return;
      }
    }

    if (trade.tp1_hit && !trade.tp2_hit) {
      const tp2Hit = isLong ? price >= tp2 : price <= tp2;
      if (tp2Hit) {
        await this.withLock(trade.id, () => this.handleTP2(trade, price, risk, originalQty));
        return;
      }
    }

    if (trade.tp2_hit && !trade.tp3_hit) {
      await this.handleTrailing(trade, price, risk);
    }
  }

  async handleTP1(trade, price, risk, originalQty) {
    const { tp1Qty } = calculateTPQuantities(originalQty);
    const remainQty = roundQty(originalQty - tp1Qty);
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const realizedPnl = calculatePnl(trade, price, tp1Qty);
    let liveQty = await getLivePositionQty(trade.symbol);
    const expectedAfter = remainQty;
    const alreadyPartial = liveQty && liveQty <= expectedAfter * 1.02;

    const verify = await verifyExchangeProtection(trade.symbol);
    const hasExchangeTp = (verify?.tpCount ?? 0) >= 1;

    if (hasExchangeTp && !alreadyPartial) {
      await logEvent('info', 'positionMonitor', 'TP1 price reached — awaiting exchange TP fill', {
        tradeId: trade.id,
        symbol: trade.symbol,
        liveQty,
        expectedAfter,
      });
      return;
    }

    if (!alreadyPartial && !hasExchangeTp && liveQty && liveQty > expectedAfter * 1.02) {
      try {
        const credentials = await getActiveApiKeys();
        const closeQty = roundQty(Math.min(tp1Qty, liveQty - expectedAfter));
        if (closeQty > 0) {
          if (credentials) {
            await placeMarketOrderWithCredentials(credentials, {
              symbol: trade.symbol,
              side,
              quantity: closeQty,
              reduceOnly: true,
            });
          } else {
            await placeMarketOrder(trade.symbol, side, closeQty, true);
          }
        }
        liveQty = await getLivePositionQty(trade.symbol);
      } catch (err) {
        liveQty = await getLivePositionQty(trade.symbol);
        if (liveQty && liveQty > expectedAfter * 1.02) {
          await logEvent('warn', 'positionMonitor', `TP1 partial close failed: ${err.message}`, { tradeId: trade.id });
          return;
        }
        await logEvent('warn', 'positionMonitor', `TP1 partial close failed but exchange qty reduced: ${err.message}`, { tradeId: trade.id });
      }
    }

    liveQty = await getLivePositionQty(trade.symbol);
    if (liveQty && liveQty > expectedAfter * 1.02) {
      return;
    }

    const breakevenSL = getBreakevenSL(parseFloat(trade.entry_price), trade.direction);
    const actualRemain = liveQty || remainQty;

    const { slOk } = await repositionAfterTP1({
      symbol: trade.symbol,
      direction: trade.direction,
      originalQty,
      remainQty: actualRemain,
      stopPrice: breakevenSL,
      tp2: trade.tp2,
    });
    if (!slOk) {
      await logEvent('warn', 'positionMonitor', 'Breakeven SL failed — TP1 not recorded', { tradeId: trade.id });
      return;
    }

    await updateTrade(trade.id, {
      tp1_hit: true,
      tp1_hit_at: new Date().toISOString(),
      sl_moved_breakeven: true,
      stop_loss: breakevenSL,
      quantity: actualRemain,
      status: 'partial',
    });

    const merged = { ...trade, quantity: actualRemain, stop_loss: breakevenSL, tp1_hit: true, status: 'partial' };
    await recordTradePhasePnl(merged, 'tp1');

    await notifyTradePhase('tp1', merged, {
      quantity: actualRemain,
      stopLoss: breakevenSL,
      hitAt: new Date().toISOString(),
    });
    await logEvent('trade', 'positionMonitor', 'TP1 hit — breakeven SL', { tradeId: trade.id, price });
    broadcastTradeEvent('tp1_partial', merged);
  }

  async handleTP2(trade, price, risk, originalQty) {
    const { tp2Qty } = calculateTPQuantities(originalQty);
    const remainQty = roundQty(originalQty - tp1QtyFromOriginal(originalQty) - tp2Qty);
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const realizedPnl = calculatePnl(trade, price, tp2Qty);
    let liveQty = await getLivePositionQty(trade.symbol);
    const expectedAfter = remainQty;
    const alreadyPartial = liveQty && liveQty <= expectedAfter * 1.02;

    const verify = await verifyExchangeProtection(trade.symbol);
    const hasExchangeTp = (verify?.tpCount ?? 0) >= 1;

    if (hasExchangeTp && !alreadyPartial) {
      await logEvent('info', 'positionMonitor', 'TP2 price reached — awaiting exchange TP fill', {
        tradeId: trade.id,
        symbol: trade.symbol,
        liveQty,
        expectedAfter,
      });
      return;
    }

    if (!alreadyPartial && !hasExchangeTp && liveQty && liveQty > expectedAfter * 1.02) {
      try {
        const credentials = await getActiveApiKeys();
        const closeQty = roundQty(Math.min(tp2Qty, liveQty - expectedAfter));
        if (closeQty > 0) {
          if (credentials) {
            await placeMarketOrderWithCredentials(credentials, {
              symbol: trade.symbol,
              side,
              quantity: closeQty,
              reduceOnly: true,
            });
          } else {
            await placeMarketOrder(trade.symbol, side, closeQty, true);
          }
        }
        liveQty = await getLivePositionQty(trade.symbol);
      } catch (err) {
        liveQty = await getLivePositionQty(trade.symbol);
        if (liveQty && liveQty > expectedAfter * 1.02) {
          await logEvent('warn', 'positionMonitor', `TP2 partial close failed: ${err.message}`, { tradeId: trade.id });
          return;
        }
        await logEvent('warn', 'positionMonitor', `TP2 partial close failed but exchange qty reduced: ${err.message}`, { tradeId: trade.id });
      }
    }

    liveQty = await getLivePositionQty(trade.symbol);
    if (liveQty && liveQty > expectedAfter * 1.02) {
      return;
    }

    const lockedSL = getRunnerStopAfterTP2(trade.tp1, trade.direction, {
      markPrice: price,
      entryPrice: parseFloat(trade.entry_price),
    });
    const actualRemain = liveQty || remainQty;

    const slOk = await repositionAfterTP2({
      symbol: trade.symbol,
      direction: trade.direction,
      remainQty: actualRemain,
      stopPrice: lockedSL,
      tp1: trade.tp1,
      entryPrice: parseFloat(trade.entry_price),
    });
    if (!slOk) {
      await logEvent('warn', 'positionMonitor', 'Lock 1R SL failed — TP2 not recorded', { tradeId: trade.id });
      return;
    }

    if (actualRemain <= 0) {
      await updateTrade(trade.id, {
        tp2_hit: true,
        tp2_hit_at: new Date().toISOString(),
        sl_locked_1r: true,
        stop_loss: lockedSL,
        quantity: 0,
        status: 'partial',
      });
      await finalizeTradeClose(
        { ...trade, tp2_hit: true, sl_locked_1r: true, stop_loss: lockedSL },
        { exitPrice: price, status: 'closed', reason: 'TP2 hit — position fully closed', force: true },
      );
    } else {
      await updateTrade(trade.id, {
        tp2_hit: true,
        tp2_hit_at: new Date().toISOString(),
        sl_locked_1r: true,
        stop_loss: lockedSL,
        quantity: actualRemain,
        status: 'partial',
      });
      const merged = { ...trade, tp2_hit: true, quantity: actualRemain, stop_loss: lockedSL, status: 'partial' };
      await recordTradePhasePnl(merged, 'tp2');
      await notifyTradePhase('tp2', merged, {
        quantity: actualRemain,
        stopLoss: lockedSL,
        hitAt: new Date().toISOString(),
      });
      await logEvent('trade', 'positionMonitor', 'TP2 hit — SL at TP1, trailing runner', { tradeId: trade.id, price, remainQty: actualRemain });
      broadcastTradeEvent('tp2_partial', merged);
    }
  }

  async handleTrailing(trade, price, risk) {
    const isLong = trade.direction === 'LONG';
    const floorSL = getRunnerStopAfterTP2(trade.tp1, trade.direction, {
      markPrice: price,
      entryPrice: parseFloat(trade.entry_price),
    });
    const prevPeak = parseFloat(trade.peak_price || trade.entry_price);
    const peak = isLong ? Math.max(prevPeak, price) : Math.min(prevPeak, price);
    const currentSL = parseFloat(trade.stop_loss);
    const newSL = computeTrailingStop({
      direction: trade.direction,
      peakPrice: peak,
      currentSL,
      risk,
      floorSL,
      trailFraction: 0.4,
    });

    const shouldUpdate = isLong
      ? newSL > currentSL + currentSL * 0.001
      : newSL < currentSL - currentSL * 0.001;
    const peakChanged = peak !== prevPeak;

    if (!shouldUpdate && !peakChanged) return;

    const runnerQty = parseFloat(trade.quantity);

    if (isRunnerDust(runnerQty, price, trade.original_quantity || trade.quantity)) {
      await this.closeTrade(trade, price, 'closed', 'Runner dust closed — trailing skipped');
      return;
    }

    if (shouldUpdate) {
      try {
        const slOk = await repositionProtectiveStop({
          symbol: trade.symbol,
          direction: trade.direction,
          stopPrice: newSL,
          quantity: runnerQty,
        });
        if (!slOk) throw new Error('Trail SL reposition failed');
        await updateTrade(trade.id, { stop_loss: newSL, peak_price: peak, sl_updated_at: new Date().toISOString() });
        await logEvent('info', 'positionMonitor', `Trail SL → ${newSL}`, { tradeId: trade.id, peak });
      } catch (err) {
        await logEvent('warn', 'positionMonitor', `Trail SL failed: ${err.message}`);
      }
    } else if (peakChanged) {
      await updateTrade(trade.id, { peak_price: peak });
    }
  }

  async closeTrade(trade, exitPrice, status, reason) {
    const entry = parseFloat(trade.entry_price);
    const qty = parseFloat(trade.quantity);
    const isLong = trade.direction === 'LONG';
    const side = isLong ? 'SELL' : 'BUY';
    let liveQty = await getLivePositionQty(trade.symbol);

    if (liveQty && liveQty > 0) {
      try {
        const credentials = await getActiveApiKeys();
        if (credentials) {
          await cancelAllOrdersWithCredentials(credentials, trade.symbol).catch(() => {});
          await placeMarketOrderWithCredentials(credentials, {
            symbol: trade.symbol,
            side,
            quantity: liveQty,
            reduceOnly: true,
          });
        } else {
          await cancelAllOrders(trade.symbol).catch(() => {});
          await placeMarketOrder(trade.symbol, side, liveQty, true);
        }

        liveQty = await getLivePositionQty(trade.symbol);
        if (liveQty && liveQty > qty * 0.001) {
          await logEvent('warn', 'positionMonitor', `Close verification: ${liveQty} ${trade.symbol} still open after close attempt`, {
            tradeId: trade.id,
            symbol: trade.symbol,
            attemptedQty: qty,
            remainingQty: liveQty,
          });
          return;
        }
      } catch (err) {
        liveQty = await getLivePositionQty(trade.symbol);
        if (liveQty && liveQty > qty * 0.001) {
          await logEvent('warn', 'positionMonitor', `Exchange close failed: ${err.message}`, {
            tradeId: trade.id,
            symbol: trade.symbol,
            qty,
          });
          return;
        }
      }
    }

    await finalizeTradeClose(trade, { exitPrice, status, reason, force: true });
  }

  async withLock(tradeId, fn) {
    if (this.inFlight.has(tradeId)) return;
    this.inFlight.add(tradeId);
    try {
      await fn();
    } finally {
      this.inFlight.delete(tradeId);
    }
  }
}

function tp1QtyFromOriginal(originalQty) {
  return parseFloat((originalQty * 0.30).toFixed(8));
}

function tp2QtyFromOriginal(originalQty) {
  return parseFloat((originalQty * 0.40).toFixed(8));
}

function roundQty(qty) {
  return parseFloat(Number(qty).toFixed(8));
}

function calculatePnl(trade, price, qty) {
  const entry = parseFloat(trade.entry_price);
  const isLong = trade.direction === 'LONG';
  return isLong ? (price - entry) * qty : (entry - price) * qty;
}

export const positionMonitor = new PositionMonitor();
