import { getKlines, parseKlines, get24hrTicker } from '../services/binance.js';
import { getEMATrend, getLatestRSI, getRSIZone } from './indicators.js';
import { analyzeSMC, checkOBRetest } from './smc.js';
import { config } from '../config/index.js';

const TF_MAP = {
  '1h': '1h',
  '30m': '30m',
  '15m': '15m',
  '5m': '5m',
  '3m': '3m',
};

export async function fetchCandles(symbol, timeframe, limit = 500) {
  const interval = TF_MAP[timeframe] || timeframe;
  const raw = await getKlines(symbol, interval, limit);
  return parseKlines(raw);
}

export async function checkVolatility(symbol) {
  try {
    const ticker = await get24hrTicker(symbol);
    const change = Math.abs(parseFloat(ticker.priceChangePercent)) / 100;
    return {
      dailyChange: parseFloat(ticker.priceChangePercent),
      exceedsThreshold: change > config.strategy.volatilityThreshold,
      safe: change <= config.strategy.volatilityThreshold,
    };
  } catch {
    return { dailyChange: 0, exceedsThreshold: false, safe: true };
  }
}

export async function analyzeTimeframe(symbol, timeframe) {
  const candles = await fetchCandles(symbol, timeframe);
  const emaTrend = getEMATrend(candles);
  const rsi = getLatestRSI(candles);
  const rsiZone = getRSIZone(rsi);
  const smc = analyzeSMC(candles);

  return {
    timeframe,
    candles,
    emaTrend,
    rsi,
    rsiZone,
    smc,
    price: candles[candles.length - 1].close,
  };
}

export async function runMTFAnalysis(symbol) {
  const volatility = await checkVolatility(symbol);

  if (volatility.exceedsThreshold) {
    return {
      symbol,
      valid: false,
      direction: 'IGNORE',
      reason: `Volatility filter: ${volatility.dailyChange.toFixed(1)}% daily change exceeds ±30%`,
      volatility,
      mtf: {},
    };
  }

  const tf1h = await analyzeTimeframe(symbol, config.timeframes.trend);
  const tf30m = await analyzeTimeframe(symbol, config.timeframes.confirm);
  const tf15m = await analyzeTimeframe(symbol, config.timeframes.obCheck);

  let entryTf = null;
  for (const tf of config.timeframes.entry) {
    entryTf = await analyzeTimeframe(symbol, tf);
    break;
  }

  const mtf = {
    '1h': summarizeTF(tf1h),
    '30m': summarizeTF(tf30m),
    '15m': summarizeTF(tf15m),
    entry: summarizeTF(entryTf),
  };

  let direction = null;
  const failures = [];

  if (tf1h.emaTrend === 'bullish' && tf1h.smc.trend !== 'bearish') {
    direction = 'long';
  } else if (tf1h.emaTrend === 'bearish' && tf1h.smc.trend !== 'bullish') {
    direction = 'short';
  } else {
    failures.push('1H trend not clear');
  }

  if (direction === 'long' && tf30m.smc.lastCHoCH?.direction === 'bearish') {
    failures.push('30M bearish CHoCH against long');
    direction = null;
  }
  if (direction === 'short' && tf30m.smc.lastCHoCH?.direction === 'bullish') {
    failures.push('30M bullish CHoCH against short');
    direction = null;
  }

  const obBlocks = direction === 'long'
    ? tf15m.smc.activeDemandOB
    : direction === 'short'
      ? tf15m.smc.activeSupplyOB
      : [];

  if (direction && obBlocks.length === 0) {
    failures.push('15M: No active Order Block in trade direction');
    direction = null;
  }

  let obRetest = { retested: false, rejection: false, block: null };
  if (direction && entryTf) {
    obRetest = checkOBRetest(entryTf.candles, obBlocks, direction);
    if (!obRetest.retested) {
      failures.push(`${entryTf.timeframe}: OB retest not detected`);
    } else if (!obRetest.rejection) {
      failures.push(`${entryTf.timeframe}: OB retest without rejection confirmation`);
    }
  }

  const valid = direction !== null && obRetest.retested && obRetest.rejection;

  return {
    symbol,
    valid,
    direction: valid ? (direction === 'long' ? 'BUY' : 'SELL') : 'IGNORE',
    volatility,
    mtf,
    obRetest,
    failures,
    analysis: { tf1h, tf30m, tf15m, entryTf },
  };
}

function summarizeTF(tf) {
  if (!tf) return null;
  return {
    timeframe: tf.timeframe,
    price: tf.price,
    emaTrend: tf.emaTrend,
    rsi: tf.rsi,
    rsiZone: tf.rsiZone.zone,
    smcTrend: tf.smc.trend,
    lastBOS: tf.smc.lastBOS,
    lastCHoCH: tf.smc.lastCHoCH,
    orderBlockCount: tf.smc.orderBlocks.filter((b) => !b.mitigated).length,
    sweeps: tf.smc.sweeps.length,
  };
}

export async function scanAllPairs() {
  const results = [];
  for (const symbol of config.topPairs) {
    try {
      const analysis = await runMTFAnalysis(symbol);
      results.push(analysis);
    } catch (err) {
      results.push({ symbol, valid: false, direction: 'IGNORE', error: err.message });
    }
  }
  return results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}
