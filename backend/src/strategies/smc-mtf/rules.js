import { config } from '../../config/index.js';

/** Mandatory RSI gates — BUY only oversold, SELL only overbought */
export const RSI_RULES = {
  buyMax: parseInt(process.env.RSI_BUY_MAX || '30', 10),
  buyIdeal: parseInt(process.env.RSI_BUY_IDEAL || '25', 10),
  sellMin: parseInt(process.env.RSI_SELL_MIN || '70', 10),
  sellIdeal: parseInt(process.env.RSI_SELL_IDEAL || '80', 10),
};

export function validateMandatoryRSI(direction, rsi) {
  if (rsi === null || rsi === undefined) {
    return { passed: false, reason: 'RSI unavailable — signal blocked' };
  }
  if (direction === 'BUY' || direction === 'long') {
    if (rsi >= RSI_RULES.buyMax) {
      return { passed: false, reason: `RSI ${rsi.toFixed(1)} must be below ${RSI_RULES.buyMax} for BUY` };
    }
    return {
      passed: true,
      reason: rsi < RSI_RULES.buyIdeal
        ? `RSI ${rsi.toFixed(1)} ideal oversold (<${RSI_RULES.buyIdeal})`
        : `RSI ${rsi.toFixed(1)} oversold (<${RSI_RULES.buyMax})`,
      bonus: rsi < RSI_RULES.buyIdeal ? 5 : 0,
    };
  }
  if (direction === 'SELL' || direction === 'short') {
    if (rsi <= RSI_RULES.sellMin) {
      return { passed: false, reason: `RSI ${rsi.toFixed(1)} must be above ${RSI_RULES.sellMin} for SHORT` };
    }
    return {
      passed: true,
      reason: rsi > RSI_RULES.sellIdeal
        ? `RSI ${rsi.toFixed(1)} ideal overbought (>${RSI_RULES.sellIdeal})`
        : `RSI ${rsi.toFixed(1)} overbought (>${RSI_RULES.sellMin})`,
      bonus: rsi > RSI_RULES.sellIdeal ? 5 : 0,
    };
  }
  return { passed: false, reason: 'Unknown direction' };
}

export function buildPatternKey(symbol, direction, mtfStatus) {
  const h1 = mtfStatus?.['1h']?.emaTrend || 'na';
  const m30 = mtfStatus?.['30m']?.smcTrend || mtfStatus?.['30m']?.emaTrend || 'na';
  return `${symbol}:${direction}:${h1}:${m30}`;
}

export const SIGNAL_COOLDOWN_MS = parseInt(process.env.SIGNAL_COOLDOWN_MS || '3600000', 10);
export const SL_TP_REMINDER_COOLDOWN_MS = parseInt(process.env.SL_TP_REMINDER_COOLDOWN_MS || '900000', 10);

export function getScanConfig() {
  return {
    minConfidence: config.strategy.minConfidence,
    volatilityThreshold: config.strategy.volatilityThreshold,
    rsiRules: RSI_RULES,
    signalCooldownMs: SIGNAL_COOLDOWN_MS,
  };
}
