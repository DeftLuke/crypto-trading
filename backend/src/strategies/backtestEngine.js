import { getKlines, parseKlines } from '../services/binance.js';

const TF_MAP = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d' };

export const PERIOD_PRESETS = {
  '1y': { days: 365, label: '1 Year' },
  '6m': { days: 180, label: '6 Months' },
  '3m': { days: 90, label: '3 Months' },
  '1m': { days: 30, label: '1 Month' },
  '1w': { days: 7, label: '1 Week' },
};

export function resolveDateRange({ period, startDate, endDate }) {
  const end = endDate ? new Date(endDate) : new Date();
  end.setHours(23, 59, 59, 999);

  if (period && PERIOD_PRESETS[period]) {
    const start = new Date(end.getTime() - PERIOD_PRESETS[period].days * 86400000);
    return { startTime: start.getTime(), endTime: end.getTime(), period };
  }

  const start = startDate ? new Date(startDate) : new Date(end.getTime() - 90 * 86400000);
  start.setHours(0, 0, 0, 0);
  return { startTime: start.getTime(), endTime: end.getTime(), period: 'custom' };
}

export function intervalToMs(interval) {
  const map = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000,
  };
  return map[interval] || 300000;
}

export function estimateBarCount(interval, startTime, endTime) {
  const ms = endTime - startTime;
  return Math.ceil(ms / intervalToMs(interval));
}

/** Warm-up bars needed before start for EMA100 / SMC */
export function getWarmupMs(interval) {
  const bars = 500;
  return bars * intervalToMs(interval);
}

export async function fetchHistoricalCandles(symbol, interval, startTime, endTime) {
  const all = [];
  let start = startTime;
  const limit = 1500;
  const intervalMs = intervalToMs(interval);
  const maxBars = parseInt(process.env.BACKTEST_MAX_BARS || '120000', 10);

  while (start < endTime && all.length < maxBars) {
    const raw = await getKlines(symbol, TF_MAP[interval] || interval, limit, start);
    if (!raw?.length) break;

    const batch = parseKlines(raw);
    all.push(...batch);

    const lastTime = raw[raw.length - 1][0];
    if (lastTime >= endTime || raw.length < limit) break;
    start = lastTime + intervalMs;
  }

  const unique = new Map();
  for (const c of all) {
    if (c.time * 1000 >= startTime && c.time * 1000 <= endTime) {
      unique.set(c.time, c);
    }
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

export function findBarIndexInTimes(times, time) {
  if (!times?.length) return -1;
  let lo = 0;
  let hi = times.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (times[mid] <= time) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

export function downsampleCandles(candles, maxPoints = 2000) {
  if (candles.length <= maxPoints) return candles;
  const step = Math.ceil(candles.length / maxPoints);
  const out = [];
  for (let i = 0; i < candles.length; i += step) out.push(candles[i]);
  if (out[out.length - 1] !== candles[candles.length - 1]) {
    out.push(candles[candles.length - 1]);
  }
  return out;
}

export function getSignalCheckStep(entryInterval, period) {
  if (entryInterval === '3m') return period === '1y' ? 12 : 6;
  if (entryInterval === '5m') return period === '1y' ? 12 : 3;
  if (entryInterval === '15m') return period === '1y' || period === '6m' ? 4 : 2;
  return 1;
}

export function computeBacktestStats(trades, options = {}) {
  const initialCapital = options.initialCapital || 10000;
  const riskPerTrade = options.riskPerTrade || 0.01;

  const closed = trades.filter((t) => !t.open);
  const wins = closed.filter((t) => t.outcome === 'win');
  const losses = closed.filter((t) => t.outcome === 'loss');

  const equityCurve = buildEquityCurve(closed, initialCapital, riskPerTrade);
  const maxDrawdown = computeMaxDrawdown(equityCurve);
  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : initialCapital;
  const netProfit = finalEquity - initialCapital;

  const grossProfit = closed.filter((t) => (t.pnlDollar || 0) > 0).reduce((s, t) => s + t.pnlDollar, 0);
  const grossLoss = Math.abs(closed.filter((t) => (t.pnlDollar || 0) < 0).reduce((s, t) => s + t.pnlDollar, 0));

  const avgWin = wins.length ? wins.reduce((s, t) => s + (t.pnlDollar || 0), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + (t.pnlDollar || 0), 0) / losses.length : 0;
  const largestWin = wins.length ? Math.max(...wins.map((t) => t.pnlDollar || 0)) : 0;
  const largestLoss = losses.length ? Math.min(...losses.map((t) => t.pnlDollar || 0)) : 0;

  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let streakW = 0;
  let streakL = 0;
  for (const t of closed) {
    if (t.outcome === 'win') {
      streakW++;
      streakL = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, streakW);
    } else if (t.outcome === 'loss') {
      streakL++;
      streakW = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, streakL);
    }
  }

  const avgR = closed.length
    ? closed.reduce((s, t) => s + (t.rMultiple || 0), 0) / closed.length
    : 0;

  return {
    initialCapital,
    netProfit,
    netProfitPercent: (netProfit / initialCapital) * 100,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0,
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    avgWin,
    avgLoss,
    avgWinLossRatio: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? 999 : 0,
    largestWin,
    largestLoss,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    maxDrawdown,
    maxDrawdownPercent: maxDrawdown.percent,
    avgRMultiple: avgR,
    finalEquity: initialCapital + netProfit,
    equityCurve,
  };
}

function buildEquityCurve(trades, initialCapital, riskPerTrade) {
  const curve = [];
  let equity = initialCapital;

  if (trades.length === 0) {
    return [{ time: Math.floor(Date.now() / 1000), equity }];
  }

  const firstTime = trades[0].entryTime;
  curve.push({ time: firstTime, equity });

  for (const t of trades) {
    const riskAmount = equity * riskPerTrade;
    const pnlDollar = (t.rMultiple || 0) * riskAmount;
    t.pnlDollar = pnlDollar;
    equity += pnlDollar;
    curve.push({ time: t.exitTime, equity: parseFloat(equity.toFixed(2)) });
  }

  return curve;
}

function computeMaxDrawdown(curve) {
  if (!curve?.length) return { value: 0, percent: 0 };
  let peak = curve[0].equity;
  let maxDd = 0;
  let maxDdPct = 0;

  for (const point of curve) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak - point.equity;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }

  return { value: maxDd, percent: maxDdPct };
}

export function formatTradeForApi(t) {
  return {
    direction: t.direction,
    entry: t.entry,
    exit: t.exit,
    stopLoss: t.stopLoss,
    tp2: t.tp2,
    outcome: t.outcome,
    rMultiple: t.rMultiple,
    pnl: t.pnl,
    pnlDollar: t.pnlDollar,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    entryDate: new Date(t.entryTime * 1000).toISOString(),
    exitDate: new Date(t.exitTime * 1000).toISOString(),
    open: t.open || false,
  };
}
