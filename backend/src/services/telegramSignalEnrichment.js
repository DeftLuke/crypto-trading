/**
 * Enrich VIP Telegram hints — Institutional SMC v2 verify + best setup levels.
 * Legacy signalEngine.generateSignal is NOT used on this path.
 */
import {
  inferSymbolFromInformalText,
  inferDirectionFromText,
  stripGroupRiskHints,
} from './telegramSignalEnrichmentHelpers.js';
import {
  analyzeTelegramWithInstitutionalSmc,
  levelsFromInstitutionalAnalysis,
  telegramInstitutionalMinScore,
} from './telegramInstitutionalSmc.js';
import { getMarkPrice } from './binance.js';
import { logEvent } from './supabase.js';

export {
  stripGroupRiskHints,
  inferSymbolFromInformalText,
  inferDirectionFromText,
  isTelegramExternalSignal,
  needsSmcEnrichment,
} from './telegramSignalEnrichmentHelpers.js';

function sideFromDirection(direction) {
  return direction === 'SELL' ? 'SHORT' : 'LONG';
}

export async function enrichTelegramSignalWithSmc(external = {}, options = {}) {
  const rawText = stripGroupRiskHints(external.raw_message || '');
  let symbol = external.symbol;
  if (!symbol || !/USDT$/.test(symbol)) {
    symbol = inferSymbolFromInformalText(rawText, external.metadata?.group_title || '');
  }
  if (!symbol) {
    return { ...external, enrichment: { ok: false, reason: 'no_symbol' } };
  }

  const groupDirection = inferDirectionFromText(rawText, external.side);
  if (!groupDirection) {
    return {
      ...external,
      symbol,
      enrichment: { ok: false, reason: 'no_direction', engine: 'institutional-smc-v2' },
    };
  }

  const mark = await getMarkPrice(symbol).catch(() => null);
  const analysis = await analyzeTelegramWithInstitutionalSmc(symbol, groupDirection);

  if (!analysis.ok) {
    return {
      ...external,
      symbol,
      direction: groupDirection,
      enrichment: {
        ok: false,
        reason: analysis.reason || 'institutional_engine_offline',
        engine: 'institutional-smc-v2',
        offline: analysis.offline,
        mark_price: mark,
      },
    };
  }

  const minScore = telegramInstitutionalMinScore();
  const levels = levelsFromInstitutionalAnalysis(analysis, { markPrice: mark, groupDirection });

  if (!analysis.direction_aligned) {
    return {
      ...external,
      symbol,
      direction: groupDirection,
      metadata: {
        ...(external.metadata || {}),
        smc_engine: 'institutional-smc-v2',
        institutional_score: analysis.confluence_score,
        direction_aligned: false,
        setup_direction: analysis.setup_direction,
        group_direction: groupDirection,
      },
      enrichment: {
        ok: false,
        reason: 'direction_mismatch',
        smc_score: analysis.confluence_score,
        setup_direction: analysis.setup_direction,
        group_direction: groupDirection,
        mark_price: mark,
        engine: 'institutional-smc-v2',
      },
    };
  }

  if (!analysis.accepted || !levels) {
    await logEvent('warn', 'telegramEnrichment', `Institutional reject ${symbol}`, {
      score: analysis.confluence_score,
      reasons: analysis.rejection_reasons,
    }).catch(() => {});
    return {
      ...external,
      symbol,
      direction: groupDirection,
      metadata: {
        ...(external.metadata || {}),
        smc_engine: 'institutional-smc-v2',
        institutional_score: analysis.confluence_score,
        rejection_reasons: analysis.rejection_reasons,
        direction_aligned: true,
      },
      enrichment: {
        ok: false,
        reason: analysis.rejection_reasons?.[0] || 'setup_not_accepted',
        smc_score: analysis.confluence_score,
        min_score: minScore,
        mark_price: mark,
        engine: 'institutional-smc-v2',
        mtf_status: analysis.mtf_status,
      },
    };
  }

  const side = sideFromDirection(levels.direction);
  const enriched = {
    ...external,
    provider: external.provider || 'telegram_vip',
    symbol,
    side,
    direction: levels.direction,
    entry_price: levels.entry,
    stop_loss: levels.stopLoss,
    tp1: levels.tp1,
    tp2: levels.tp2,
    tp3: levels.tp3,
    metadata: {
      ...(external.metadata || {}),
      smc_enriched: true,
      smc_confidence: analysis.confluence_score,
      institutional_score: analysis.confluence_score,
      smc_engine: 'institutional-smc-v2',
      group_direction: groupDirection,
      direction_aligned: true,
      group_risk_ignored: true,
      levels_source: 'institutional_smc_v2',
      informal_signal: Boolean(inferSymbolFromInformalText(rawText)),
      mtf_status: analysis.mtf_status,
      confluence_breakdown: analysis.setup?.confluence_breakdown,
      institutional_explanation: analysis.explanation?.human_summary,
    },
    enrichment: {
      ok: true,
      smc_score: analysis.confluence_score,
      min_score: minScore,
      used_group_direction: true,
      mark_price: mark,
      engine: 'institutional-smc-v2',
      passed_threshold: analysis.confluence_score >= minScore,
    },
  };

  return enriched;
}

export function telegramMinValidationScore() {
  return telegramInstitutionalMinScore();
}
