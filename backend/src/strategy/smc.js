/**
 * Smart Money Concepts — ported from Pine Script logic
 * BOS, CHoCH, Order Blocks, Liquidity Sweeps
 */

const SWING_LENGTH = 10;

export function findSwingPoints(candles, length = SWING_LENGTH) {
  const swings = { highs: [], lows: [] };

  for (let i = length; i < candles.length - length; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= length; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) {
        isHigh = false;
      }
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) {
        isLow = false;
      }
    }

    if (isHigh) {
      swings.highs.push({ index: i, price: candles[i].high, time: candles[i].time });
    }
    if (isLow) {
      swings.lows.push({ index: i, price: candles[i].low, time: candles[i].time });
    }
  }

  return swings;
}

export function detectMarketStructure(candles) {
  const swings = findSwingPoints(candles);
  const events = [];
  let trend = 'neutral';

  if (swings.highs.length < 2 || swings.lows.length < 2) {
    return { trend, events, lastBOS: null, lastCHoCH: null, swings };
  }

  const recentHighs = swings.highs.slice(-3);
  const recentLows = swings.lows.slice(-3);
  const price = candles[candles.length - 1].close;

  const higherHighs = recentHighs.length >= 2 &&
    recentHighs[recentHighs.length - 1].price > recentHighs[recentHighs.length - 2].price;
  const higherLows = recentLows.length >= 2 &&
    recentLows[recentLows.length - 1].price > recentLows[recentLows.length - 2].price;
  const lowerHighs = recentHighs.length >= 2 &&
    recentHighs[recentHighs.length - 1].price < recentHighs[recentHighs.length - 2].price;
  const lowerLows = recentLows.length >= 2 &&
    recentLows[recentLows.length - 1].price < recentLows[recentLows.length - 2].price;

  if (higherHighs && higherLows) trend = 'bullish';
  else if (lowerHighs && lowerLows) trend = 'bearish';

  let lastBOS = null;
  let lastCHoCH = null;

  if (trend === 'bullish' && price > recentHighs[recentHighs.length - 1]?.price) {
    lastBOS = { type: 'BOS', direction: 'bullish', price: recentHighs[recentHighs.length - 1].price };
    events.push(lastBOS);
  } else if (trend === 'bearish' && price < recentLows[recentLows.length - 1]?.price) {
    lastBOS = { type: 'BOS', direction: 'bearish', price: recentLows[recentLows.length - 1].price };
    events.push(lastBOS);
  }

  if (trend === 'bullish' && lowerLows) {
    lastCHoCH = { type: 'CHoCH', direction: 'bearish', price: recentLows[recentLows.length - 1].price };
    events.push(lastCHoCH);
  } else if (trend === 'bearish' && higherHighs) {
    lastCHoCH = { type: 'CHoCH', direction: 'bullish', price: recentHighs[recentHighs.length - 1].price };
    events.push(lastCHoCH);
  }

  return { trend, events, lastBOS, lastCHoCH, swings };
}

export function detectOrderBlocks(candles, maxBlocks = 8) {
  const blocks = [];
  const lookback = Math.min(candles.length - 1, 200);

  for (let i = candles.length - lookback; i < candles.length - 1; i++) {
    const curr = candles[i];
    const next = candles[i + 1];

    const bullishMove = next.close > curr.high;
    const bearishMove = next.close < curr.low;

    if (bullishMove) {
      blocks.push({
        type: 'demand',
        high: curr.high,
        low: curr.low,
        time: curr.time,
        index: i,
        mitigated: false,
        tested: false,
      });
    }

    if (bearishMove) {
      blocks.push({
        type: 'supply',
        high: curr.high,
        low: curr.low,
        time: curr.time,
        index: i,
        mitigated: false,
        tested: false,
      });
    }
  }

  const price = candles[candles.length - 1].close;

  for (const block of blocks) {
    if (block.type === 'demand' && price < block.low) {
      block.mitigated = true;
    }
    if (block.type === 'supply' && price > block.high) {
      block.mitigated = true;
    }
  }

  const active = blocks
    .filter((b) => !b.mitigated)
    .slice(-maxBlocks);

  return active;
}

export function checkOBRetest(candles, orderBlocks, direction) {
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];

  for (const ob of orderBlocks) {
    if (direction === 'long' && ob.type === 'demand') {
      const touched = lastCandle.low <= ob.high && lastCandle.low >= ob.low;
      const rejected = lastCandle.close > ob.high && lastCandle.close > lastCandle.open;
      if (touched && rejected) {
        ob.tested = true;
        return { retested: true, block: ob, rejection: true };
      }
      if (touched) {
        return { retested: true, block: ob, rejection: false };
      }
    }

    if (direction === 'short' && ob.type === 'supply') {
      const touched = lastCandle.high >= ob.low && lastCandle.high <= ob.high;
      const rejected = lastCandle.close < ob.low && lastCandle.close < lastCandle.open;
      if (touched && rejected) {
        ob.tested = true;
        return { retested: true, block: ob, rejection: true };
      }
      if (touched) {
        return { retested: true, block: ob, rejection: false };
      }
    }
  }

  return { retested: false, block: null, rejection: false };
}

export function detectLiquiditySweeps(candles, swings) {
  const sweeps = [];
  if (!swings?.highs || !swings?.lows) return sweeps;
  const recent = candles.slice(-5);

  for (const swingHigh of swings.highs.slice(-3)) {
    for (const candle of recent) {
      if (candle.high > swingHigh.price && candle.close < swingHigh.price) {
        sweeps.push({
          type: 'bearish_sweep',
          level: swingHigh.price,
          time: candle.time,
          description: 'Liquidity sweep above swing high — bearish',
        });
      }
    }
  }

  for (const swingLow of swings.lows.slice(-3)) {
    for (const candle of recent) {
      if (candle.low < swingLow.price && candle.close > swingLow.price) {
        sweeps.push({
          type: 'bullish_sweep',
          level: swingLow.price,
          time: candle.time,
          description: 'Liquidity sweep below swing low — bullish',
        });
      }
    }
  }

  return sweeps;
}

/** Fair Value Gap zones */
function detectFVG(candles) {
  const gaps = [];
  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c2 = candles[i];
    if (c2.low > c0.high) {
      gaps.push({ type: 'bullish_fvg', high: c2.low, low: c0.high, time: candles[i - 1].time, label: 'FVG' });
    }
    if (c2.high < c0.low) {
      gaps.push({ type: 'bearish_fvg', high: c0.low, low: c2.high, time: candles[i - 1].time, label: 'FVG' });
    }
  }
  return gaps.slice(-8);
}

/** Active OB zones where price is retesting now. */
function findRetestZones(candles, orderBlocks) {
  const last = candles[candles.length - 1];
  if (!last) return [];
  return orderBlocks
    .filter((ob) => !ob.mitigated)
    .filter((ob) => last.low <= ob.high && last.high >= ob.low)
    .map((ob) => ({
      type: ob.type === 'demand' ? 'ob_retest_demand' : 'ob_retest_supply',
      high: ob.high,
      low: ob.low,
      time: ob.time,
      label: ob.type === 'demand' ? 'OB Retest (Demand)' : 'OB Retest (Supply)',
    }));
}

/** Inducement (IDM) — minor swing before the active OB. */
function findIDMZones(candles, swings, orderBlocks) {
  const zones = [];
  for (const ob of orderBlocks.filter((b) => !b.mitigated).slice(-3)) {
    const pool = ob.type === 'demand' ? swings.lows : swings.highs;
    const before = pool.filter((s) => s.index < ob.index).slice(-2);
    if (before.length >= 1) {
      const pt = before[before.length - 1];
      zones.push({
        type: 'idm',
        price: pt.price,
        time: pt.time,
        side: ob.type,
        label: 'IDM / Liquidity',
      });
    }
  }
  return zones;
}

export function analyzeSMC(candles) {
  const structure = detectMarketStructure(candles);
  const orderBlocks = detectOrderBlocks(candles);
  const sweeps = detectLiquiditySweeps(candles, structure.swings);
  const retestZones = findRetestZones(candles, orderBlocks);
  const idmZones = findIDMZones(candles, structure.swings, orderBlocks);
  const fvgZones = detectFVG(candles);

  return {
    ...structure,
    orderBlocks,
    sweeps,
    retestZones,
    idmZones,
    fvgZones,
    activeDemandOB: orderBlocks.filter((b) => b.type === 'demand'),
    activeSupplyOB: orderBlocks.filter((b) => b.type === 'supply'),
  };
}

/** Lighter SMC for backtest precompute — skips FVG/IDM/sweeps zones */
export function analyzeSMCForBacktest(candles) {
  const structure = detectMarketStructure(candles);
  const orderBlocks = detectOrderBlocks(candles);
  return {
    trend: structure.trend,
    lastCHoCH: structure.lastCHoCH,
    activeDemandOB: orderBlocks.filter((b) => b.type === 'demand'),
    activeSupplyOB: orderBlocks.filter((b) => b.type === 'supply'),
  };
}
