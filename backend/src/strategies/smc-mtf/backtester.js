import { getEMATrend, getLatestRSI } from '../../strategy/indicators.js';
import { analyzeSMCForBacktest, checkOBRetest } from '../../strategy/smc.js';
import { validateMandatoryRSI } from './rules.js';
import { calculateLevels } from '../../strategy/signalEngine.js';
import {
  fetchHistoricalCandles,
  resolveDateRange,
  findBarIndexInTimes,
  getWarmupMs,
  getSignalCheckStep,
  computeBacktestStats,
  formatTradeForApi,
  downsampleCandles,
  estimateBarCount,
  PERIOD_PRESETS,
} from '../backtestEngine.js';

const ANALYSIS_WINDOW = 300;
const MIN_BARS = 120;
const MAX_BARS_SOFT = 45000;

function analyzeWindow(candles, index) {
  const start = Math.max(0, index - ANALYSIS_WINDOW + 1);
  const slice = candles.slice(start, index + 1);
  if (slice.length < MIN_BARS) return null;

  const emaTrend = getEMATrend(slice);
  const rsi = getLatestRSI(slice);
  const smc = analyzeSMCForBacktest(slice);
  const price = slice[slice.length - 1].close;

  return {
    emaTrend,
    rsi,
    smc,
    price,
    candle: slice[slice.length - 1],
    time: slice[slice.length - 1].time,
  };
}

/** Step MTF precompute on long series — avoids Node segfault in Docker */
function getPrecomputeStep(candleCount) {
  if (candleCount > 20000) return 4;
  if (candleCount > 8000) return 2;
  return 1;
}

/** MTF timeline — slim SMC fields only */
function precomputeSlimTimeline(candles) {
  const step = getPrecomputeStep(candles.length);
  const timeline = new Array(candles.length);
  let last = null;
  for (let i = MIN_BARS; i < candles.length; i++) {
    if (i % step === 0 || i === candles.length - 1) {
      const a = analyzeWindow(candles, i);
      if (a) {
        last = {
          emaTrend: a.emaTrend,
          rsi: a.rsi,
          smc: {
            trend: a.smc.trend,
            lastCHoCH: a.smc.lastCHoCH,
            activeDemandOB: a.smc.activeDemandOB,
            activeSupplyOB: a.smc.activeSupplyOB,
          },
          time: a.time,
        };
      }
    }
    if (last) timeline[i] = last;
  }
  return timeline;
}

/** Entry timeline — RSI only at signal-check bars (avoids OOM on 5m × 3M) */
function precomputeEntryTimeline(candles, entryInterval, period) {
  const step = getSignalCheckStep(entryInterval, period);
  const timeline = new Array(candles.length);
  for (let i = MIN_BARS; i < candles.length; i += step) {
    const start = Math.max(0, i - ANALYSIS_WINDOW + 1);
    const slice = candles.slice(start, i + 1);
    if (slice.length < MIN_BARS) continue;
    timeline[i] = { rsi: getLatestRSI(slice), time: candles[i].time };
  }
  return timeline;
}

function getCachedAt(timeline, times, time) {
  const idx = findBarIndexInTimes(times, time);
  if (idx < MIN_BARS) return null;
  return timeline[idx];
}

function runSimulation(
  symbol,
  entryCandles,
  times15,
  times30,
  times1h,
  timeline15,
  timeline30,
  timeline1h,
  timelineEntry,
  entryInterval,
  period,
  startTime
) {
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

    const entrySnap = timelineEntry[i];
    if (!entrySnap) {
      i++;
      continue;
    }

    const a1h = getCachedAt(timeline1h, times1h, bar.time);
    const a30 = getCachedAt(timeline30, times30, bar.time);
    const a15 = getCachedAt(timeline15, times15, bar.time);
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

    const obRetest = checkOBRetest([bar], obBlocks, direction);
    if (!obRetest.retested || !obRetest.rejection) {
      i++;
      continue;
    }

    const tradeDir = direction === 'long' ? 'BUY' : 'SELL';
    const rsiCheck = validateMandatoryRSI(tradeDir, entrySnap.rsi);
    if (!rsiCheck.passed) {
      i++;
      continue;
    }

    const levels = calculateLevels(tradeDir, bar.close, obRetest.block);
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

  if (estimatedBars > MAX_BARS_SOFT) {
    throw new Error(
      `Too many bars (~${estimatedBars}). Use 15m+ timeframe or a shorter period (6M / 3M).`
    );
  }

  const entryIs15m = entryTimeframe === '15m';
  let entryCandles;
  let tf15m;

  if (entryIs15m) {
    tf15m = await fetchHistoricalCandles(symbol, '15m', fetchStart, endTime);
    entryCandles = tf15m;
  } else {
    entryCandles = await fetchHistoricalCandles(symbol, entryTimeframe, fetchStart, endTime);
    tf15m = await fetchHistoricalCandles(symbol, '15m', fetchStart, endTime);
  }

  let tf30m = await fetchHistoricalCandles(symbol, '30m', fetchStart, endTime);
  let tf1h = await fetchHistoricalCandles(symbol, '1h', fetchStart - 86400000 * 30, endTime);

  if (entryCandles.length < MIN_BARS + 10) {
    throw new Error(`Insufficient data for ${symbol} (${entryCandles.length} bars)`);
  }

  const times15 = tf15m.map((c) => c.time);
  const times30 = tf30m.map((c) => c.time);
  const times1h = tf1h.map((c) => c.time);

  const timeline1h = precomputeSlimTimeline(tf1h);
  tf1h = null;
  const timeline30 = precomputeSlimTimeline(tf30m);
  tf30m = null;
  const timeline15 = precomputeSlimTimeline(tf15m);
  if (!entryIs15m) tf15m = null;

  const timelineEntry = entryIs15m
    ? timeline15
    : precomputeEntryTimeline(entryCandles, entryTimeframe, resolvedPeriod);

  const rawTrades = runSimulation(
    symbol,
    entryCandles,
    times15,
    times30,
    times1h,
    timeline15,
    timeline30,
    timeline1h,
    timelineEntry,
    entryTimeframe,
    resolvedPeriod,
    startTime
  );

  const stats = computeBacktestStats(rawTrades, { initialCapital, riskPerTrade });

  const periodCandles = entryCandles.filter(
    (c) => c.time * 1000 >= startTime && c.time * 1000 <= endTime
  );
  const chartCandles = downsampleCandles(periodCandles, 1500);

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
