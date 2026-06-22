/**
 * Telegram VIP — Institutional SMC v2 only (no legacy signalEngine.generateSignal).
 */
import { config } from '../config/index.js';
import { analyzeInstitutionalSetup } from './institutionalSmcClient.js';
import { mapSetupToSignal, mapDirection } from '../strategies/institutional-smc/index.js';
import { getMarkPrice } from './binance.js';
import { logEvent } from './supabase.js';

export async function analyzeTelegramWithInstitutionalSmc(symbol, groupDirection = null) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return { ok: false, reason: 'no_symbol' };

  const result = await analyzeInstitutionalSetup(sym);
  if (!result.ok) {
    await logEvent('warn', 'telegramInstitutionalSmc', `Engine offline ${sym}`, {
      error: result.error,
    }).catch(() => {});
    return {
      ok: false,
      reason: result.error || 'institutional_engine_offline',
      offline: result.offline,
      symbol: sym,
    };
  }

  const setup = result.data || {};
  const mapped = mapSetupToSignal(setup, sym);
  const setupDir = mapped.direction || 'IGNORE';
  const groupDir = groupDirection === 'SELL' || groupDirection === 'SHORT' ? 'SELL' : groupDirection === 'BUY' || groupDirection === 'LONG' ? 'BUY' : null;

  let directionAligned = true;
  if (groupDir && setupDir !== 'IGNORE') {
    directionAligned = setupDir === groupDir;
  }

  const confluence = setup.confluence_score ?? mapped.confidence ?? 0;
  const accepted = setup.status === 'accepted' && setupDir !== 'IGNORE';

  return {
    ok: true,
    symbol: sym,
    setup,
    mapped,
    confluence_score: confluence,
    direction: setupDir,
    setup_direction: mapDirection(setup.direction),
    group_direction: groupDir,
    direction_aligned: directionAligned,
    accepted,
    rejection_reasons: setup.rejection_reasons || mapped.failures || [],
    explanation: setup.explanation || mapped.explanation || {},
    mtf_status: mapped.mtf_status || {},
    reasons: mapped.reasons || {},
  };
}

/** Build trade levels from institutional setup when VIP direction matches. */
export function levelsFromInstitutionalAnalysis(analysis, { markPrice = null, groupDirection = null } = {}) {
  if (!analysis?.ok) return null;

  const dir = groupDirection || analysis.direction;
  if (dir === 'IGNORE' || !analysis.direction_aligned) return null;
  if (!analysis.accepted) return null;

  const m = analysis.mapped;
  if (!m.entry_price || !m.stop_loss || !m.tp1) return null;

  return {
    direction: m.direction,
    side: m.direction === 'SELL' ? 'SHORT' : 'LONG',
    entry: parseFloat(m.entry_price),
    stopLoss: parseFloat(m.stop_loss),
    tp1: parseFloat(m.tp1),
    tp2: parseFloat(m.tp2),
    tp3: parseFloat(m.tp3),
    mark_price: markPrice,
    engine: 'institutional-smc-v2',
  };
}

export function telegramInstitutionalMinScore() {
  return parseInt(
    process.env.TELEGRAM_INSTITUTIONAL_MIN_SCORE
      || process.env.TELEGRAM_MIN_VALIDATION_SCORE
      || String(config.institutionalSmc?.minScore ?? 50),
    10,
  );
}

export async function verifyTelegramSignalInstitutional(symbol, groupDirection) {
  const mark = await getMarkPrice(symbol).catch(() => null);
  const analysis = await analyzeTelegramWithInstitutionalSmc(symbol, groupDirection);
  const levels = levelsFromInstitutionalAnalysis(analysis, { markPrice: mark, groupDirection });
  const minScore = telegramInstitutionalMinScore();

  const passed = Boolean(
    analysis.ok
    && analysis.accepted
    && analysis.direction_aligned
    && levels
    && analysis.confluence_score >= minScore,
  );

  return {
    passed,
    analysis,
    levels,
    mark_price: mark,
    min_score: minScore,
    validation_score: analysis.confluence_score ?? 0,
    reject_reason: !analysis.ok
      ? analysis.reason
      : !analysis.direction_aligned
        ? 'direction_mismatch'
        : !analysis.accepted
          ? (analysis.rejection_reasons?.[0] || 'setup_not_accepted')
          : !levels
            ? 'missing_levels'
            : analysis.confluence_score < minScore
              ? `score_below_${minScore}`
              : null,
  };
}
