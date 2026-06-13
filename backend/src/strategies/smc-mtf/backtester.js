import { getEMATrend, getLatestRSI } from '../../strategy/indicators.js';
import { analyzeSMC, checkOBRetest } from '../../strategy/smc.js';
import { validateMandatoryRSI } from './rules.js';
import { calculateLevels } from '../../strategy/signalEngine.js';
import {
  fetchHistoricalCandles,
  resolveDateRange,
  findBarIndexAtOrBefore,
  intervalToMs,
  getWarmupMs,
  getSignalCheckStep,
  computeBacktestStats,
  formatTradeForApi,
  downsampleCandles,
  estimateBarCount,
  PERIOD_PRESETS,
} from '../backtestEngine.js';

const ANALYSIS_WINDOW = 400;
const MIN_BARS = 120;

function analyzeWindow(candles, index) {
  const start = Math.max(0, index - ANALYSIS_WINDOW + 1);
  const slice = candles.slice(start, index + 1);
  if (slice.length < MIN_BARS) return null;

  const emaTrend = getEMATrend(slice);
  const rsi = getLatestRSI(slice);
  const smc = analyzeSMC(slice);
  const price = slice[slice.length - 1].close;

  return {
    emaTrend,
    rsi,
    smc,
    price,
    candle: slice[slice.length - 1],
    candles: slice,
    time: slice[slice.length - 1].time,
  };
}

function precomputeTimeline(candles) {
  const timeline = new Array(candles.length);
  for (let i = MIN_BARS; i < candles.length; i++) {
    timeline[i] = analyzeWindow(candles, i);
  }
  return timeline;
}

function getCachedAt(timeline, candles, time) {
  const idx = findBarIndexAtOrBefore(candles, time);
  if (idx < MIN_BARS) return null;
  return timeline[idx];
}

function runSimulation(symbol, entryCandles, tf15m, tf30m, tf1h, timeline15, timeline30, timeline1h, entryInterval, period, startTime) {
  const trades = [];
  let inTrade = null;
  const step = getSignalCheckStep(entryInterval, period);
  let i = MIN_BARS;

  while (i < entryCandles.length) {
    const bar = entryCandles[i];

    if (inTrade) {
      const hitSL = inTrade.direction === 'BUY'
        ? bar.low <= inTrade.stopLoss
        : bar.high >= inTrade.stopLoss;
      const hitTP = inTrade.direction === 'BUY'
        ? bar.high >= inTrade.tp2
        : bar.low <= inTrade.tp2;

      if (hitSL || hitTP) {
        const exitPrice = hitSL ? inTrade.stopLoss : inTrade.tp2;
        const pnl = inTrade.direction === 'BUY'
          ? exitPrice - inTrade.entry
          : inTrade.entry - exitPrice;
        const rMultiple = inTrade.risk > 0 ? pnl / inTrade.risk : 0;
        trades.push({
          symbol,
          direction: inTrade.direction,
          entry: inTrade.entry,
          exit: exitPrice,
          stopLoss: inTrade.stopLoss,
          tp2: inTrade.tp2,
          outcome: hitSL ? 'loss' : 'win',
          rMultiple,
          pnl,
          entryTime: inTrade.entryTime,
          exitTime: bar.time,
        });
        inTrade = null;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (bar.time * 1000 < startTime) {
      i++;
      continue;
    }

    if (i % step !== 0) {
      i++;
      continue;
    }

    const entry = analyzeWindow(entryCandles, i);
    if (!entry) {
      i++;
      continue;
    }

    const a1h = getCachedAt(timeline1h, tf1h, bar.time);
    const a30 = getCachedAt(timeline30, tf30m, bar.time);
    const a15 = getCachedAt(timeline15, tf15m, bar.time);
    if (!a1h || !a30 || !a15) {
      i++;
      continue;
    }

    let direction = null;
    if (a1h.emaTrend === 'bullish' && a1h.smc.trend !== 'bearish') direction = 'long';
    else if (a1h.emaTrend === 'bearish' && a1h.smc.trend !== 'bullish') direction = 'short';

    if (!direction) {
      i++;
      continue;
    }

    if (direction === 'long' && a30.smc.lastCHoCH?.direction === 'bearish') {
      i++;
      continue;
    }
    if (direction === 'short' && a30.smc.lastCHoCH?.direction === 'bullish') {
      i++;
      continue;
    }

    const obBlocks = direction === 'long' ? a15.smc.activeDemandOB : a15.smc.activeSupplyOB;
    if (!obBlocks?.length) {
      i++;
      continue;
    }

    const obRetest = checkOBRetest(entry.candles, obBlocks, direction);
    if (!obRetest.retested || !obRetest.rejection) {
      i++;
      continue;
    }

    const tradeDir = direction === 'long' ? 'BUY' : 'SELL';
    const rsiCheck = validateMandatoryRSI(tradeDir, entry.rsi);
    if (!rsiCheck.passed) {
      i++;
      continue;
    }

    const levels = calculateLevels(tradeDir, entry.price, obRetest.block);
    inTrade = {
      direction: tradeDir,
      entry: levels.entry,
      stopLoss: levels.stopLoss,
      tp2: levels.tp2,
      risk: levels.riskAmount,
      entryTime: bar.time,
    };
    i++;
  }

  if (inTrade) {
    const last = entryCandles[entryCandles.length - 1];
    const pnl = inTrade.direction === 'BUY'
      ? last.close - inTrade.entry
      : inTrade.entry - last.close;
    trades.push({
      symbol,
      direction: inTrade.direction,
      entry: inTrade.entry,
      exit: last.close,
      stopLoss: inTrade.stopLoss,
      tp2: inTrade.tp2,
      outcome: pnl >= 0 ? 'win' : 'loss',
      rMultiple: inTrade.risk > 0 ? pnl / inTrade.risk : 0,
      pnl,
      entryTime: inTrade.entryTime,
      exitTime: last.time,
      open: true,
    });
  }

  return trades;
}

export async function runBacktest(options) {
  const {
    symbol,
    entryTimeframe = '5m',
    startDate,
    endDate,
    period,
    initialCapital = 10000,
    riskPerTrade = 0.01,
  } = options;

  const { startTime, endTime, period: resolvedPeriod } = resolveDateRange({
    period,
    startDate,
    endDate,
  });

  const warmup = getWarmupMs(entryTimeframe);
  const fetchStart = startTime - warmup;
  const estimatedBars = estimateBarCount(entryTimeframe, startTime, endTime);

  const [entryCandles, tf15m, tf1h, tf30m] = await Promise.all([
    fetchHistoricalCandles(symbol, entryTimeframe, fetchStart, endTime),
    fetchHistoricalCandles(symbol, '15m', fetchStart, endTime),
    fetchHistoricalCandles(symbol, '1h', fetchStart - 86400000 * 30, endTime),
    fetchHistoricalCandles(symbol, '30m', fetchStart, endTime),
  ]);

  if (entryCandles.length < MIN_BARS + 10) {
    throw new Error(`Insufficient data for ${symbol} (${entryCandles.length} bars)`);
  }

  const timeline15 = precomputeTimeline(tf15m);
  const timeline30 = precomputeTimeline(tf30m);
  const timeline1h = precomputeTimeline(tf1h);

  const rawTrades = runSimulation(
    symbol,
    entryCandles,
    tf15m,
    tf30m,
    tf1h,
    timeline15,
    timeline30,
    timeline1h,
    entryTimeframe,
    resolvedPeriod,
    startTime
  );

  const stats = computeBacktestStats(rawTrades, { initialCapital, riskPerTrade });

  const periodCandles = entryCandles.filter(
    (c) => c.time * 1000 >= startTime && c.time * 1000 <= endTime
  );
  const chartCandles = downsampleCandles(periodCandles, 2000);

  return {
    symbol,
    strategyId: 'smc-mtf',
    entryTimeframe,
    period: resolvedPeriod,
    startDate: new Date(startTime).toISOString(),
    endDate: new Date(endTime).toISOString(),
    barsAnalyzed: periodCandles.length,
    estimatedBars,
    totalTrades: stats.totalTrades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate,
    profitFactor: stats.profitFactor,
    totalPnl: stats.netProfit,
    avgRMultiple: stats.avgRMultiple,
    ...stats,
    trades: rawTrades.map(formatTradeForApi),
    chartCandles,
  };
}

export { PERIOD_PRESETS };
