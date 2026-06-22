/**
 * Institutional SMC v2 — scanner strategy adapter (Python research-api).
 * Replaces smc-mtf validation when signal_engine = institutional-smc.
 */
import { config } from '../../config/index.js';
import { analyzeInstitutionalSetup } from '../../services/institutionalSmcClient.js';
import { calculateLevels } from '../../strategy/signalEngine.js';
import { buildInstitutionalPatternKey } from './rules.js';

export const name = 'Institutional SMC v2';
export const description = 'Python canonical engine — MTF 1D/4H/1H/15M, confluence ≥80, full explainability.';
export const timeframes = ['1d', '4h', '1h', '15m'];
export const engine = 'python';

export function mapDirection(pythonDirection) {
  if (pythonDirection === 'LONG') return 'BUY';
  if (pythonDirection === 'SHORT') return 'SELL';
  return 'IGNORE';
}

export function buildReasonsFromSetup(setup) {
  const explanation = setup?.explanation || {};
  const breakdown = setup?.confluence_breakdown || explanation.confluence || {};
  const reasons = {};

  const labels = {
    market_structure: 'Market Structure',
    liquidity_sweep: 'Liquidity Sweep',
    order_block: 'Order Block',
    fvg: 'FVG',
    premium_discount: 'Premium/Discount',
    displacement: 'Displacement',
    volume_oi: 'Volume/OI',
    ema_alignment: 'EMA Alignment',
    rsi_macd: 'RSI/MACD',
    volatility: 'Volatility',
  };

  for (const [key, label] of Object.entries(labels)) {
    const raw = typeof breakdown[key] === 'number' ? breakdown[key] : 0;
    reasons[key] = {
      score: Math.round(raw * 10) / 10,
      status: raw >= 5 ? 'pass' : raw >= 2 ? 'partial' : 'fail',
      detail: `${label}: ${raw.toFixed(1)} pts`,
    };
  }

  const filters = explanation.filters || [];
  const failed = filters.filter((f) => f.status === 'fail');
  reasons.validation = {
    score: failed.length === 0 ? 10 : 0,
    status: failed.length === 0 ? 'pass' : 'fail',
    detail: failed.length
      ? failed.map((f) => `${f.name}: ${f.reason}`).join('; ')
      : 'All validation filters passed',
  };

  reasons.engine = {
    score: setup?.confluence_score || 0,
    status: setup?.status === 'accepted' ? 'pass' : 'fail',
    detail: explanation.human_summary || `Score ${setup?.confluence_score ?? 0}/100`,
  };

  return reasons;
}

export function extractObBlock(explanation) {
  const ob =
    explanation?.order_block?.entry?.last_active
    || explanation?.order_block?.setup?.last_active;
  if (!ob || ob.high == null || ob.low == null) return null;
  return { high: ob.high, low: ob.low };
}

export function buildMtfStatus(explanation) {
  const mtf = explanation?.market_structure?.mtf || {};
  const out = {};
  for (const [role, snap] of Object.entries(mtf)) {
    if (!snap || typeof snap !== 'object') continue;
    out[snap.timeframe || role] = {
      structure_state: snap.structure_state,
      trend: snap.trend,
      status: snap.status || 'pass',
    };
  }
  out.aligned = explanation?.market_structure?.htf_aligned ?? false;
  return out;
}

export function mapSetupToSignal(setup, symbol) {
  const sym = String(symbol || setup?.symbol || '').toUpperCase();
  const minScore = config.institutionalSmc?.minScore ?? 80;

  if (!setup || setup.status !== 'accepted' || setup.direction === 'IGNORE') {
    return {
      symbol: sym,
      direction: 'IGNORE',
      confidence: setup?.confluence_score ?? 0,
      failures: setup?.rejection_reasons || ['Setup not accepted'],
      rejection_codes: setup?.rejection_codes || [],
      strategy_id: 'institutional-smc',
      engine_version: setup?.engine_version || 'v2',
      message: setup?.rejection_reasons?.[0] || 'Rejected by institutional gate',
    };
  }

  if ((setup.confluence_score ?? 0) < minScore) {
    return {
      symbol: sym,
      direction: 'IGNORE',
      confidence: setup.confluence_score ?? 0,
      failures: [`Score ${setup.confluence_score} below minimum ${minScore}`],
      strategy_id: 'institutional-smc',
      message: `Below min score ${minScore}`,
    };
  }

  const direction = mapDirection(setup.direction);
  const explanation = setup.explanation || {};
  const entryPrice = setup.entry_price ?? explanation?.displacement?.entry?.last_close;
  const obBlock = extractObBlock(explanation);

  let levels;
  if (setup.entry_price && setup.stop_loss) {
    levels = {
      entry: setup.entry_price,
      stopLoss: setup.stop_loss,
      tp1: setup.tp1,
      tp2: setup.tp2,
      tp3: setup.tp3,
    };
  } else if (entryPrice) {
    levels = calculateLevels(direction, entryPrice, obBlock);
  } else {
    return {
      symbol: sym,
      direction: 'IGNORE',
      confidence: setup.confluence_score ?? 0,
      failures: ['Missing entry price for level calculation'],
      strategy_id: 'institutional-smc',
    };
  }

  return {
    symbol: sym,
    direction,
    confidence: Math.min(100, Math.round(setup.confluence_score ?? 0)),
    entry_price: levels.entry,
    stop_loss: levels.stopLoss,
    tp1: levels.tp1,
    tp2: levels.tp2,
    tp3: levels.tp3,
    reasons: buildReasonsFromSetup(setup),
    mtf_status: buildMtfStatus(explanation),
    timeframe_entry: '15m',
    status: 'pending',
    strategy_id: 'institutional-smc',
    strategy_name: 'institutional-smc',
    engine_version: setup.engine_version || 'v2',
    confluence_breakdown: setup.confluence_breakdown,
    explanation,
    pattern_key: buildInstitutionalPatternKey(sym, direction, explanation),
    signal_source: 'scanner',
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

export async function generateSignal(symbol) {
  const sym = String(symbol || '').toUpperCase();
  const result = await analyzeInstitutionalSetup(sym);
  if (!result.ok) {
    return {
      symbol: sym,
      direction: 'IGNORE',
      confidence: 0,
      failures: [result.error || 'Institutional engine offline'],
      strategy_id: 'institutional-smc',
      message: result.error || 'Engine offline',
    };
  }
  return mapSetupToSignal(result.data, sym);
}

export async function analyze(symbol) {
  const result = await analyzeInstitutionalSetup(String(symbol).toUpperCase());
  return result.ok ? result.data : { error: result.error, offline: result.offline };
}

export default {
  id: 'institutional-smc',
  name,
  description,
  timeframes,
  engine,
  analyze,
  generateSignal,
};
