/**
 * SMC + Multi-Timeframe Strategy
 * Based on pinscript.txt (Smart Money Algo Pro E5 - CHADBULL)
 * MTF flow: 1H trend → 30M confirm → 15M OB → 5M/3M entry
 */
import { runMTFAnalysis } from '../../strategy/mtfAnalysis.js';
import { calculateConfidence, calculateLevels, formatSignalMessage } from '../../strategy/signalEngine.js';
import { validateMandatoryRSI, buildPatternKey, getScanConfig, RSI_RULES } from './rules.js';
import { runBacktest } from './backtester.js';

export const name = 'Smart Money Algo Pro (SMC MTF)';
export const description = 'Port of pinscript Smart Money Algo Pro E5 — MTF SMC with RSI gates, order blocks, and entry/SL/TP setups.';
export const timeframes = ['1h', '30m', '15m', '5m', '3m'];

export async function analyze(symbol) {
  return runMTFAnalysis(symbol);
}

export async function generateSignal(symbol, lessonPenalty = 0) {
  const analysis = await runMTFAnalysis(symbol);

  if (!analysis.valid || analysis.direction === 'IGNORE') {
    return {
      symbol,
      direction: 'IGNORE',
      confidence: 0,
      failures: analysis.failures,
      mtf_status: analysis.mtf,
      strategy_id: 'smc-mtf',
      message: analysis.failures?.join('; ') || 'No valid setup',
    };
  }

  const entryRsi = analysis.analysis?.entryTf?.rsi;
  const rsiCheck = validateMandatoryRSI(analysis.direction, entryRsi);
  if (!rsiCheck.passed) {
    return {
      symbol,
      direction: 'IGNORE',
      confidence: 0,
      failures: [rsiCheck.reason],
      mtf_status: analysis.mtf,
      strategy_id: 'smc-mtf',
      message: rsiCheck.reason,
    };
  }

  const { confidence, reasons, direction } = calculateConfidence(analysis);
  let adjustedConfidence = confidence + (rsiCheck.bonus || 0) - lessonPenalty;

  if (direction === 'IGNORE' || adjustedConfidence < getScanConfig().minConfidence) {
    return {
      symbol,
      direction: 'IGNORE',
      confidence: adjustedConfidence,
      reasons,
      mtf_status: analysis.mtf,
      strategy_id: 'smc-mtf',
      message: `Confidence ${adjustedConfidence} below minimum`,
    };
  }

  const entryPrice = analysis.analysis.entryTf.price;
  const obBlock = analysis.obRetest.block;
  const levels = calculateLevels(direction, entryPrice, obBlock);

  return {
    symbol,
    direction,
    confidence: Math.min(100, adjustedConfidence),
    entry_price: levels.entry,
    stop_loss: levels.stopLoss,
    tp1: levels.tp1,
    tp2: levels.tp2,
    tp3: levels.tp3,
    reasons: {
      ...reasons,
      rsiMandatory: { score: rsiCheck.bonus || 10, status: 'pass', detail: rsiCheck.reason },
    },
    mtf_status: analysis.mtf,
    timeframe_entry: analysis.analysis.entryTf?.timeframe || '5m',
    status: 'pending',
    strategy_id: 'smc-mtf',
    pattern_key: buildPatternKey(symbol, direction, analysis.mtf),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

export { runBacktest, RSI_RULES, validateMandatoryRSI };

export default {
  id: 'smc-mtf',
  name,
  description,
  timeframes,
  analyze,
  generateSignal,
  runBacktest,
  formatSignalMessage,
};
