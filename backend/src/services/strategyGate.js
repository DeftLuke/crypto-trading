/**
 * Phase 4 hook: backtest gate before live signal generation / trading.
 * Soft mode (default): records gate status in validation; hard mode blocks when BACKTEST_GATE_STRICT=true.
 */
import { getSupabase } from './supabase.js';
import { config } from '../config/index.js';

const DEFAULT_MIN_SCORE = 55;
const DEFAULT_MIN_WIN_RATE = 45;
const DEFAULT_MIN_DAYS = 300;

export async function validateBacktestGate(strategyId, options = {}) {
  const minScore = options.minScore ?? config.strategy?.backtestGateMinScore ?? DEFAULT_MIN_SCORE;
  const minWinRate = options.minWinRate ?? config.strategy?.backtestGateMinWinRate ?? DEFAULT_MIN_WIN_RATE;
  const minDays = options.minDays ?? config.strategy?.backtestGateMinDays ?? DEFAULT_MIN_DAYS;

  const db = getSupabase();
  if (!db) {
    return { passed: true, reason: 'no_database', mode: 'skip' };
  }

  const sid = String(strategyId || 'smc-mtf');

  const { data: runs } = await db
    .from('backtest_runs')
    .select('*')
    .eq('strategy_id', sid)
    .order('score', { ascending: false, nullsFirst: false })
    .limit(25);

  const list = runs || [];

  const qualifies = (run) => {
    if (!run) return false;
    const start = run.start_date ? new Date(run.start_date) : null;
    const end = run.end_date ? new Date(run.end_date) : null;
    const spanDays = start && end ? (end.getTime() - start.getTime()) / 86400000 : 0;
    const score = parseFloat(run.score) || 0;
    const wr = parseFloat(run.win_rate) || 0;
    const trades = parseInt(run.total_trades, 10) || 0;
    return spanDays >= minDays && score >= minScore && wr >= minWinRate && trades >= 10;
  };

  const bestQualified = list.find(qualifies);
  if (bestQualified) {
    return {
      passed: true,
      reason: 'backtest_1y_passed',
      run: bestQualified,
      strategy_id: sid,
      criteria: { minScore, minWinRate, minDays },
    };
  }

  const promoted = list.find((r) => r.promoted);
  if (promoted && (parseFloat(promoted.score) || 0) >= minScore - 10) {
    return {
      passed: true,
      reason: 'promoted_backtest',
      run: promoted,
      strategy_id: sid,
      criteria: { minScore, minWinRate, minDays },
    };
  }

  return {
    passed: false,
    reason: `No ${minDays}d backtest with score≥${minScore}, win≥${minWinRate}% for ${sid}`,
    bestRun: list[0] || null,
    strategy_id: sid,
    criteria: { minScore, minWinRate, minDays },
  };
}

export function applyBacktestGateToScore(baseScore, gateResult) {
  if (!gateResult || gateResult.passed) return baseScore;
  const penalty = config.strategy?.backtestGateStrict ? 100 : 15;
  return Math.max(0, baseScore - penalty);
}

export function isBacktestGateStrict() {
  return config.strategy?.backtestGateStrict === true
    || process.env.BACKTEST_GATE_STRICT === 'true';
}
