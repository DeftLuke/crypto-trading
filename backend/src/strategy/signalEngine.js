import { config } from '../config/index.js';
import { runMTFAnalysis } from './mtfAnalysis.js';

export function calculateConfidence(analysis) {
  if (!analysis.valid) {
    return {
      confidence: 0,
      reasons: {},
      direction: 'IGNORE',
    };
  }

  let score = 0;
  const reasons = {};

  const { analysis: data, mtf, obRetest, volatility } = analysis;
  const direction = analysis.direction;

  // EMA trend alignment (20 pts)
  if (data.tf1h.emaTrend === (direction === 'BUY' ? 'bullish' : 'bearish')) {
    score += 20;
    reasons.ema = { score: 20, status: 'pass', detail: `Price ${direction === 'BUY' ? '>' : '<'} EMA100 on 1H` };
  } else {
    reasons.ema = { score: 0, status: 'fail', detail: 'EMA trend mismatch' };
  }

  // RSI filter (15 pts)
  const rsi = data.entryTf?.rsi;
  const rsiZone = data.entryTf?.rsiZone;
  if (direction === 'BUY' && rsi < 25) {
    score += 15;
    reasons.rsi = { score: 15, status: 'pass', detail: `RSI oversold (${rsi?.toFixed(1)})` };
  } else if (direction === 'SELL' && rsi > 80) {
    score += 15;
    reasons.rsi = { score: 15, status: 'pass', detail: `RSI overbought (${rsi?.toFixed(1)})` };
  } else if (rsiZone?.zone === 'normal' && obRetest.rejection) {
    score += 10;
    reasons.rsi = { score: 10, status: 'pass', detail: `RSI normal (${rsi?.toFixed(1)}) with OB confirm` };
  } else {
    reasons.rsi = { score: 0, status: 'neutral', detail: `RSI ${rsi?.toFixed(1)} — needs confirmation` };
  }

  // SMC structure (25 pts)
  const smc1h = data.tf1h.smc;
  if (smc1h.lastBOS?.direction === (direction === 'BUY' ? 'bullish' : 'bearish')) {
    score += 15;
    reasons.smc = { score: 15, status: 'pass', detail: `BOS ${smc1h.lastBOS.direction} on 1H` };
  } else if (smc1h.trend === (direction === 'BUY' ? 'bullish' : 'bearish')) {
    score += 10;
    reasons.smc = { score: 10, status: 'pass', detail: `SMC trend ${smc1h.trend} on 1H` };
  } else {
    reasons.smc = { score: 0, status: 'fail', detail: 'SMC structure weak' };
  }

  if (data.tf30m.smc.trend === smc1h.trend) {
    score += 10;
    reasons.smc.score += 10;
    reasons.smc.detail += ' + 30M aligned';
  }

  // Order Block retest (25 pts)
  if (obRetest.retested && obRetest.rejection) {
    score += 25;
    reasons.orderBlock = {
      score: 25,
      status: 'pass',
      detail: `OB retest + rejection on ${data.entryTf?.timeframe}`,
      block: obRetest.block,
    };
  } else if (obRetest.retested) {
    score += 10;
    reasons.orderBlock = { score: 10, status: 'partial', detail: 'OB retest without rejection' };
  } else {
    reasons.orderBlock = { score: 0, status: 'fail', detail: 'No OB retest' };
  }

  // Liquidity sweep bonus (10 pts)
  const sweeps = data.entryTf?.smc.sweeps || [];
  const relevantSweep = sweeps.find((s) =>
    (direction === 'BUY' && s.type === 'bullish_sweep') ||
    (direction === 'SELL' && s.type === 'bearish_sweep')
  );
  if (relevantSweep) {
    score += 10;
    reasons.liquidity = { score: 10, status: 'pass', detail: relevantSweep.description };
  } else {
    reasons.liquidity = { score: 0, status: 'neutral', detail: 'No liquidity sweep detected' };
  }

  // Volatility filter (5 pts)
  if (volatility.safe) {
    score += 5;
    reasons.volatility = { score: 5, status: 'pass', detail: `${volatility.dailyChange.toFixed(1)}% daily change` };
  } else {
    reasons.volatility = { score: 0, status: 'fail', detail: 'High volatility — blocked' };
    return { confidence: 0, reasons, direction: 'IGNORE' };
  }

  return { confidence: Math.min(100, score), reasons, direction };
}

export function calculateLevels(direction, entryPrice, obBlock) {
  const obLow = obBlock?.low || entryPrice * 0.995;
  const obHigh = obBlock?.high || entryPrice * 1.005;

  let stopLoss, risk;

  if (direction === 'BUY') {
    stopLoss = obLow * 0.999;
    risk = entryPrice - stopLoss;
  } else {
    stopLoss = obHigh * 1.001;
    risk = stopLoss - entryPrice;
  }

  if (risk <= 0) risk = entryPrice * 0.005;

  const tp1 = direction === 'BUY' ? entryPrice + risk : entryPrice - risk;
  const tp2 = direction === 'BUY' ? entryPrice + risk * 2 : entryPrice - risk * 2;
  const tp3 = direction === 'BUY' ? entryPrice + risk * 3 : entryPrice - risk * 3;

  return {
    entry: entryPrice,
    stopLoss: parseFloat(stopLoss.toFixed(6)),
    tp1: parseFloat(tp1.toFixed(6)),
    tp2: parseFloat(tp2.toFixed(6)),
    tp3: parseFloat(tp3.toFixed(6)),
    riskAmount: parseFloat(risk.toFixed(6)),
  };
}

export async function generateSignal(symbol) {
  const analysis = await runMTFAnalysis(symbol);
  const { confidence, reasons, direction } = calculateConfidence(analysis);

  if (!analysis.valid || direction === 'IGNORE' || !direction || confidence < config.strategy.minConfidence) {
    return {
      symbol,
      direction: 'IGNORE',
      confidence,
      reasons,
      mtf_status: analysis.mtf,
      failures: analysis.failures,
      message: confidence < config.strategy.minConfidence
        ? `Confidence ${confidence} below minimum ${config.strategy.minConfidence}`
        : analysis.failures?.join('; ') || 'No valid setup',
    };
  }

  const entryPrice = analysis.analysis.entryTf.price;
  const obBlock = analysis.obRetest.block;
  const levels = calculateLevels(direction, entryPrice, obBlock);

  return {
    symbol,
    direction,
    confidence,
    entry_price: levels.entry,
    stop_loss: levels.stopLoss,
    tp1: levels.tp1,
    tp2: levels.tp2,
    tp3: levels.tp3,
    reasons,
    mtf_status: analysis.mtf,
    timeframe_entry: analysis.analysis.entryTf?.timeframe || '5m',
    status: 'pending',
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

export function formatSignalMessage(signal) {
  const emoji = signal.direction === 'BUY' ? '🟢' : signal.direction === 'SELL' ? '🔴' : '⚪';
  const r = signal.reasons || {};

  let breakdown = '';
  for (const [key, val] of Object.entries(r)) {
    const icon = val.status === 'pass' ? '✓' : val.status === 'fail' ? '✗' : '~';
    breakdown += `• ${key.toUpperCase()}: ${val.detail} ${icon}\n`;
  }

  const mtf = signal.mtf_status || {};
  const mtfLine = `MTF: 1H${mtf['1h']?.emaTrend === 'bullish' ? '✓' : mtf['1h']?.emaTrend === 'bearish' ? '✓' : '✗'} → 30M✓ → 15M OB✓ → ${signal.timeframe_entry || '5m'} entry✓`;

  return `${emoji} SIGNAL — ${signal.symbol}
Direction: ${signal.direction}
Confidence: ${signal.confidence}/100

📊 Breakdown:
${breakdown}
Entry: ${signal.entry_price}
SL: ${signal.stop_loss}
TP1: ${signal.tp1} (1R — 30%)
TP2: ${signal.tp2} (2R — 40%)
TP3: ${signal.tp3} (trailing)

${mtfLine}`;
}
