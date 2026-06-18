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
} from '../services/binance.js';
import { binanceWs } from '../services/binanceWs.js';
import {
  getBreakevenSL,
  getLocked1RSL,
} from '../strategy/riskManager.js';
import { sendTradeUpdate } from '../services/telegram.js';
import { config } from '../config/index.js';

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
        await this.manageTrade(trade);
      } catch (err) {
        await logEvent('error', 'positionMonitor', err.message, { tradeId: trade.id });
      }
    }
  }

  async manageTrade(trade) {
    if (this.inFlight.has(trade.id)) return;

    const price = binanceWs.getPrice(trade.symbol) || await getMarkPrice(trade.symbol).catch(() => null);
    if (!price) return;

    const entry = parseFloat(trade.entry_price);
    const sl = parseFloat(trade.stop_loss);
    const tp1 = parseFloat(trade.tp1);
    const tp2 = parseFloat(trade.tp2);
    const risk = Math.abs(entry - sl);
    const isLong = trade.direction === 'LONG';

    // Emergency exit: price hit SL level
    if ((isLong && price <= sl) || (!isLong && price >= sl)) {
      await this.withLock(trade.id, () => this.closeTrade(trade, price, 'stopped', 'Stop loss hit'));
      return;
    }

    // TP1 hit — close 30%, move SL to breakeven
    if (!trade.tp1_hit) {
      const tp1Hit = isLong ? price >= tp1 : price <= tp1;
      if (tp1Hit) {
        await this.withLock(trade.id, () => this.handleTP1(trade, price, risk));
        return;
      }
    }

    // TP2 hit — close 40%, lock SL at +1R
    if (trade.tp1_hit && !trade.tp2_hit) {
      const tp2Hit = isLong ? price >= tp2 : price <= tp2;
      if (tp2Hit) {
        await this.withLock(trade.id, () => this.handleTP2(trade, price, risk));
        return;
      }
    }

    // TP3 trailing — move SL progressively
    if (trade.tp2_hit && !trade.tp3_hit) {
      await this.handleTrailing(trade, price, risk);
    }
  }

  async handleTP1(trade, price, risk) {
    const qty = parseFloat(trade.quantity);
    const tp1Qty = roundQty(qty * 0.3);
    const remainQty = roundQty(qty - tp1Qty);
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const realizedPnl = calculatePnl(trade, price, tp1Qty);

    try {
      await placeMarketOrder(trade.symbol, side, tp1Qty, true);
    } catch (err) {
      await logEvent('warn', 'positionMonitor', `TP1 partial close failed: ${err.message}`, { tradeId: trade.id });
      return;
    }

    const breakevenSL = getBreakevenSL(parseFloat(trade.entry_price), trade.direction);

    try {
      await cancelAllOrders(trade.symbol);
      if (remainQty > 0) await placeStopMarketOrder(trade.symbol, side, breakevenSL, remainQty);
    } catch (err) {
      await logEvent('warn', 'positionMonitor', `Breakeven SL failed: ${err.message}`);
    }

    await updateTrade(trade.id, {
      tp1_hit: true,
      sl_moved_breakeven: true,
      stop_loss: breakevenSL,
      quantity: remainQty,
      pnl: (parseFloat(trade.pnl) || 0) + realizedPnl,
      status: 'partial',
    });

    await sendTradeUpdate({ ...trade, tp1_hit: true, quantity: remainQty, pnl: realizedPnl }, `TP1 hit at ${price}. 30% closed. SL moved to breakeven.`);
    await logEvent('trade', 'positionMonitor', 'TP1 hit — breakeven SL', { tradeId: trade.id, price });
  }

  async handleTP2(trade, price, risk) {
    const qty = parseFloat(trade.quantity);
    const tp2Qty = roundQty(qty * (4 / 7));
    const remainQty = roundQty(qty - tp2Qty);
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const realizedPnl = calculatePnl(trade, price, tp2Qty);

    try {
      await placeMarketOrder(trade.symbol, side, tp2Qty, true);
    } catch (err) {
      await logEvent('warn', 'positionMonitor', `TP2 partial close failed: ${err.message}`, { tradeId: trade.id });
      return;
    }

    const lockedSL = getLocked1RSL(parseFloat(trade.entry_price), risk, trade.direction);

    try {
      await cancelAllOrders(trade.symbol);
      if (remainQty > 0) await placeStopMarketOrder(trade.symbol, side, lockedSL, remainQty);
    } catch (err) {
      await logEvent('warn', 'positionMonitor', `Lock 1R SL failed: ${err.message}`);
    }

    await updateTrade(trade.id, {
      tp2_hit: true,
      sl_locked_1r: true,
      stop_loss: lockedSL,
      quantity: remainQty,
      pnl: (parseFloat(trade.pnl) || 0) + realizedPnl,
    });

    await sendTradeUpdate({ ...trade, tp2_hit: true, quantity: remainQty }, `TP2 hit at ${price}. 40% closed. SL locked at +1R.`);
    await logEvent('trade', 'positionMonitor', 'TP2 hit — SL at +1R', { tradeId: trade.id, price });
  }

  async handleTrailing(trade, price, risk) {
    const isLong = trade.direction === 'LONG';
    const trailDistance = risk * 0.5;
    const newSL = isLong ? price - trailDistance : price + trailDistance;
    const currentSL = parseFloat(trade.stop_loss);

    const shouldUpdate = isLong ? newSL > currentSL : newSL < currentSL;

    if (shouldUpdate) {
      const side = isLong ? 'SELL' : 'BUY';
      const tp3Qty = parseFloat(trade.quantity);

      try {
        await cancelAllOrders(trade.symbol);
        await placeStopMarketOrder(trade.symbol, side, newSL, tp3Qty);
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
    const closePnl = isLong
      ? (exitPrice - entry) * qty
      : (entry - exitPrice) * qty;
    const pnl = (parseFloat(trade.pnl) || 0) + closePnl;
    const risk = Math.abs(entry - parseFloat(trade.stop_loss));
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

function roundQty(qty) {
  return parseFloat(Number(qty).toFixed(8));
}

function calculatePnl(trade, price, qty) {
  const entry = parseFloat(trade.entry_price);
  const isLong = trade.direction === 'LONG';
  return isLong ? (price - entry) * qty : (entry - price) * qty;
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
