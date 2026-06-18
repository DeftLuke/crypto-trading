import {
  getOpenTrades,
  updateTrade,
  logEvent,
  updatePairStats,
  saveTradeLesson,
} from '../services/supabase.js';
import {
  placeStopMarketOrder,
  placeMarketOrder,
  cancelAllOrders,
  getMarkPrice,
  getPositionRisk,
} from '../services/binance.js';
import { binanceWs } from '../services/binanceWs.js';
import {
  calculateTPQuantities,
  getBreakevenSL,
  getLocked1RSL,
} from '../strategy/riskManager.js';
import {
  getActiveApiKeys,
  placeMarketOrderWithCredentials,
  placeStopMarketOrderWithCredentials,
  cancelAllOrdersWithCredentials,
  getPositionRiskWithCredentials,
} from '../services/userBinance.js';
import { sendTradeUpdate } from '../services/telegram.js';
import { config } from '../config/index.js';
import { broadcastTradeEvent } from '../services/wsBroadcast.js';

class PositionMonitor {
  constructor() {
    this.running = false;
    this.interval = null;
    this.inFlight = new Set();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.interval = setInterval(() => this.checkPositions(), 5000);
    console.log('[PositionMonitor] Started — checking every 5s');
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
  }

  async checkPositions() {
    const { data: trades } = await getOpenTrades();
    if (!trades?.length) return;

    for (const trade of trades) {
      try {
        await this.syncExchangeClosed(trade);
        const synced = await this.syncTradeFromExchange(trade);
        await this.manageTrade(synced || trade);
      } catch (err) {
        await logEvent('error', 'positionMonitor', err.message, { tradeId: trade.id });
      }
    }
  }

  /** If exchange has no position but DB still open — sync closed state to dashboard. */
  async syncExchangeClosed(trade) {
    if (!['open', 'partial'].includes(trade.status)) return;
    const liveQty = await getLivePositionQty(trade.symbol);
    if (liveQty && liveQty > 0) return;
    const price = binanceWs.getPrice(trade.symbol) || await getMarkPrice(trade.symbol).catch(() => null);
    if (!price) return;
    await logEvent('info', 'positionMonitor', 'Exchange flat — closing DB trade', { tradeId: trade.id, symbol: trade.symbol });
    await this.closeTrade(trade, price, 'closed', 'Exchange position closed (sync)');
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
      updates.sl_moved_breakeven = true;
      updates.stop_loss = getBreakevenSL(entry, trade.direction);
      updates.status = 'partial';
    }

    if (!trade.tp2_hit && pctRemain <= 0.31) {
      updates.tp2_hit = true;
      updates.sl_locked_1r = true;
      updates.stop_loss = getLocked1RSL(entry, risk, trade.direction);
      updates.status = pctRemain > originalQty * 0.01 ? 'partial' : 'closed';
      if (pctRemain <= originalQty * 0.01) {
        updates.closed_at = new Date().toISOString();
        updates.close_reason = 'TP2 hit — runner closed on exchange';
      }
    }

    if (!Object.keys(updates).length) return trade;

    await updateTrade(trade.id, updates);
    return { ...trade, ...updates };
  }

  async manageTrade(trade) {
    if (this.inFlight.has(trade.id)) return;

    const price = binanceWs.getPrice(trade.symbol) || await getMarkPrice(trade.symbol).catch(() => null);
    if (!price) return;

    const entry = parseFloat(trade.entry_price);
    const sl = parseFloat(trade.stop_loss);
    const tp1 = parseFloat(trade.tp1);
    const tp2 = parseFloat(trade.tp2);
    const originalQty = parseFloat(trade.original_quantity || trade.quantity);
    const risk = Math.abs(entry - parseFloat(trade.initial_stop_loss || trade.stop_loss));
    const isLong = trade.direction === 'LONG';

    if ((isLong && price <= sl) || (!isLong && price >= sl)) {
      await this.withLock(trade.id, () => this.closeTrade(trade, price, 'stopped', 'Stop loss hit'));
      return;
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
    const liveQty = await getLivePositionQty(trade.symbol);
    const expectedAfter = remainQty;

    if (liveQty && liveQty > expectedAfter * 1.02) {
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
      } catch (err) {
        await logEvent('warn', 'positionMonitor', `TP1 partial close failed: ${err.message}`, { tradeId: trade.id });
        return;
      }
    }

    const breakevenSL = getBreakevenSL(parseFloat(trade.entry_price), trade.direction);
    const actualRemain = await getLivePositionQty(trade.symbol) || remainQty;

    try {
      const credentials = await getActiveApiKeys();
      if (credentials) {
        await cancelAllOrdersWithCredentials(credentials, trade.symbol);
        if (actualRemain > 0) {
          await placeStopMarketOrderWithCredentials(credentials, {
            symbol: trade.symbol,
            side,
            stopPrice: breakevenSL,
            quantity: actualRemain,
          });
        }
      } else {
        await cancelAllOrders(trade.symbol);
        if (actualRemain > 0) await placeStopMarketOrder(trade.symbol, side, breakevenSL, actualRemain);
      }
    } catch (err) {
      await logEvent('warn', 'positionMonitor', `Breakeven SL failed: ${err.message}`);
      return;
    }

    await updateTrade(trade.id, {
      tp1_hit: true,
      sl_moved_breakeven: true,
      stop_loss: breakevenSL,
      quantity: actualRemain,
      pnl: (parseFloat(trade.pnl) || 0) + realizedPnl,
      status: 'partial',
    });

    await sendTradeUpdate({ ...trade, tp1_hit: true, quantity: actualRemain }, `TP1 hit at ${price}. 30% closed. SL moved to breakeven.`);
    await logEvent('trade', 'positionMonitor', 'TP1 hit — breakeven SL', { tradeId: trade.id, price });
    broadcastTradeEvent('tp1_partial', { ...trade, quantity: actualRemain, pnl: (parseFloat(trade.pnl) || 0) + realizedPnl });
  }

  async handleTP2(trade, price, risk, originalQty) {
    const { tp2Qty } = calculateTPQuantities(originalQty);
    const remainQty = roundQty(originalQty - tp1QtyFromOriginal(originalQty) - tp2Qty);
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const realizedPnl = calculatePnl(trade, price, tp2Qty);
    const liveQty = await getLivePositionQty(trade.symbol);
    const expectedAfter = remainQty;

    if (liveQty && liveQty > expectedAfter * 1.02) {
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
      } catch (err) {
        await logEvent('warn', 'positionMonitor', `TP2 partial close failed: ${err.message}`, { tradeId: trade.id });
        return;
      }
    }

    const lockedSL = getLocked1RSL(parseFloat(trade.entry_price), risk, trade.direction);
    const actualRemain = await getLivePositionQty(trade.symbol) || remainQty;

    try {
      const credentials = await getActiveApiKeys();
      if (credentials) {
        await cancelAllOrdersWithCredentials(credentials, trade.symbol);
        if (actualRemain > 0) {
          await placeStopMarketOrderWithCredentials(credentials, {
            symbol: trade.symbol,
            side,
            stopPrice: lockedSL,
            quantity: actualRemain,
          });
        }
      } else {
        await cancelAllOrders(trade.symbol);
        if (actualRemain > 0) await placeStopMarketOrder(trade.symbol, side, lockedSL, actualRemain);
      }
    } catch (err) {
      await logEvent('warn', 'positionMonitor', `Lock 1R SL failed: ${err.message}`);
      return;
    }

    await updateTrade(trade.id, {
      tp2_hit: true,
      sl_locked_1r: true,
      stop_loss: lockedSL,
      quantity: actualRemain,
      pnl: (parseFloat(trade.pnl) || 0) + realizedPnl,
      status: actualRemain > 0 ? 'partial' : 'closed',
      ...(actualRemain <= 0 ? {
        exit_price: price,
        closed_at: new Date().toISOString(),
        close_reason: 'TP2 hit — position fully closed',
      } : {}),
    });

    await sendTradeUpdate({ ...trade, tp2_hit: true, quantity: actualRemain }, `TP2 hit at ${price}. 40% closed. SL locked at +1R. Runner ${actualRemain > 0 ? '30%' : '0%'}.`);
    await logEvent('trade', 'positionMonitor', 'TP2 hit — SL at +1R', { tradeId: trade.id, price, remainQty: actualRemain });
    broadcastTradeEvent(actualRemain > 0 ? 'tp2_partial' : 'tp2_closed', { ...trade, quantity: actualRemain, pnl: (parseFloat(trade.pnl) || 0) + realizedPnl });
  }

  async handleTrailing(trade, price, risk) {
    const isLong = trade.direction === 'LONG';
    const trailDistance = risk * 0.5;
    const newSL = isLong ? price - trailDistance : price + trailDistance;
    const currentSL = parseFloat(trade.stop_loss);

    const shouldUpdate = isLong ? newSL > currentSL : newSL < currentSL;

    if (shouldUpdate) {
      const side = isLong ? 'SELL' : 'BUY';
      const runnerQty = parseFloat(trade.quantity);

      try {
        const credentials = await getActiveApiKeys();
        if (credentials) {
          await cancelAllOrdersWithCredentials(credentials, trade.symbol);
          await placeStopMarketOrderWithCredentials(credentials, {
            symbol: trade.symbol,
            side,
            stopPrice: newSL,
            quantity: runnerQty,
          });
        } else {
          await cancelAllOrders(trade.symbol);
          await placeStopMarketOrder(trade.symbol, side, newSL, runnerQty);
        }
        await updateTrade(trade.id, { stop_loss: newSL });
      } catch (err) {
        await logEvent('warn', 'positionMonitor', `Trail SL failed: ${err.message}`);
      }
    }
  }

  async closeTrade(trade, exitPrice, status, reason) {
    const entry = parseFloat(trade.entry_price);
    const qty = parseFloat(trade.quantity);
    const isLong = trade.direction === 'LONG';
    const side = isLong ? 'SELL' : 'BUY';
    const liveQty = await getLivePositionQty(trade.symbol);

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

        const remainingQty = await getLivePositionQty(trade.symbol);
        if (remainingQty && remainingQty > liveQty * 0.001) {
          await logEvent('warn', 'positionMonitor', `Close verification failed: ${remainingQty} ${trade.symbol} still open`, {
            tradeId: trade.id,
            symbol: trade.symbol,
            attemptedQty: liveQty,
            remainingQty,
          });
          return;
        }
      } catch (err) {
        await logEvent('warn', 'positionMonitor', `Exchange close failed: ${err.message}`, {
          tradeId: trade.id,
          symbol: trade.symbol,
          qty: liveQty,
        });
        return;
      }
    }

    const closePnl = isLong
      ? (exitPrice - entry) * qty
      : (entry - exitPrice) * qty;
    const pnl = (parseFloat(trade.pnl) || 0) + closePnl;
    const risk = Math.abs(entry - parseFloat(trade.initial_stop_loss || trade.stop_loss));
    const rMultiple = risk > 0 ? pnl / (risk * qty) : 0;
    const outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';

    await updateTrade(trade.id, {
      status,
      exit_price: exitPrice,
      pnl,
      pnl_percent: (pnl / (entry * qty)) * 100,
      r_multiple: rMultiple,
      close_reason: reason,
      closed_at: new Date().toISOString(),
    });

    await updatePairStats(trade.symbol, outcome, rMultiple);

    const lesson = buildTradeLesson(trade, exitPrice, pnl, outcome, reason);
    const lessonData = {
      trade_id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      outcome,
      lesson_type: 'executed',
      setup_description: `${trade.direction} on ${trade.symbol} — entry ${entry}, SL ${trade.stop_loss}`,
      lesson_text: lesson,
      tags: [trade.symbol, trade.direction, outcome, reason],
      pnl,
      r_multiple: rMultiple,
    };
    await saveTradeLesson(lessonData);

    const { learnFromTrade } = await import('../services/tradeLearner.js');
    await learnFromTrade({ ...trade, pnl, exit_price: exitPrice, r_multiple: rMultiple }, lesson);

    const { sendTradeLifecycle } = await import('../services/telegram.js');
    await sendTradeLifecycle('trade.closed', {
      trade: { ...trade, pnl, status, exit_price: exitPrice },
      message: `Closed: ${reason}. ${rMultiple.toFixed(2)}R`,
    });

    await logEvent('trade', 'positionMonitor', `Trade closed: ${reason}`, {
      tradeId: trade.id,
      pnl,
      rMultiple,
      outcome,
    });
    broadcastTradeEvent('closed', { ...trade, pnl, status, exit_price: exitPrice, close_reason: reason });
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

function roundQty(qty) {
  return parseFloat(Number(qty).toFixed(8));
}

function calculatePnl(trade, price, qty) {
  const entry = parseFloat(trade.entry_price);
  const isLong = trade.direction === 'LONG';
  return isLong ? (price - entry) * qty : (entry - price) * qty;
}

async function getLivePositionQty(symbol) {
  try {
    const credentials = await getActiveApiKeys();
    const rows = credentials
      ? await getPositionRiskWithCredentials(credentials, symbol)
      : await getPositionRisk(symbol);
    const row = Array.isArray(rows) ? rows.find((p) => p.symbol === symbol) : rows;
    return Math.abs(parseFloat(row?.positionAmt || 0));
  } catch {
    return null;
  }
}

function buildTradeLesson(trade, exitPrice, pnl, outcome, reason) {
  return `Trade on ${trade.symbol} ${trade.direction}: ${outcome.toUpperCase()}.
Entry: ${trade.entry_price}, Exit: ${exitPrice}, PnL: ${pnl.toFixed(2)} USDT.
Close reason: ${reason}.
TP1: ${trade.tp1_hit ? 'hit' : 'missed'}, TP2: ${trade.tp2_hit ? 'hit' : 'missed'}.
Lesson: ${outcome === 'win'
    ? 'Setup validated — similar conditions may repeat on this pair.'
    : 'Review OB retest quality and MTF alignment before re-entering this pair.'}`;
}

export const positionMonitor = new PositionMonitor();
