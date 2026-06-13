import { EMA, RSI } from 'technicalindicators';

export function calculateEMA(candles, period) {
  if (candles.length < period) return [];
  const closes = candles.map((c) => c.close);
  const values = EMA.calculate({ period, values: closes });
  return values.map((value, i) => ({
    time: candles[i + period - 1].time,
    value,
  }));
}

export function calculateRSI(candles, period = 14) {
  if (candles.length < period + 1) return [];
  const closes = candles.map((c) => c.close);
  const values = RSI.calculate({ period, values: closes });
  return values.map((value, i) => ({
    time: candles[i + period].time,
    value,
  }));
}

export function getLatestEMA(candles, period) {
  const ema = calculateEMA(candles, period);
  return ema.length > 0 ? ema[ema.length - 1].value : null;
}

export function getLatestRSI(candles, period = 14) {
  const rsi = calculateRSI(candles, period);
  return rsi.length > 0 ? rsi[rsi.length - 1].value : null;
}

export function getEMATrend(candles) {
  const price = candles[candles.length - 1].close;
  const ema100 = getLatestEMA(candles, 100);
  if (!ema100) return 'neutral';
  return price > ema100 ? 'bullish' : 'bearish';
}

export function getRSIZone(rsi) {
  if (rsi === null) return { zone: 'unknown', allowed: false };
  if (rsi < 25) return { zone: 'oversold', allowed: true, bias: 'long' };
  if (rsi > 80) return { zone: 'overbought', allowed: true, bias: 'short' };
  return { zone: 'normal', allowed: true, bias: 'neutral' };
}

export function isRejectionCandle(candle, direction) {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  if (range === 0) return false;

  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  if (direction === 'long') {
    return lowerWick > body * 1.5 && candle.close > candle.open;
  }
  return upperWick > body * 1.5 && candle.close < candle.open;
}

export function attachIndicators(candles) {
  const ema9 = calculateEMA(candles, 9);
  const ema21 = calculateEMA(candles, 21);
  const ema100 = calculateEMA(candles, 100);
  const rsi = calculateRSI(candles, 14);

  return { ema9, ema21, ema100, rsi };
}
