import { config } from '../config/index.js';
import { generateSignal } from '../strategy/signalEngine.js';
import { getPairStats, logEvent, saveSignal } from './supabase.js';

async function generateSignalSafe(external) {
  try {
    return await generateSignal(external.symbol);
  } catch (err) {
    await logEvent('warn', 'externalSignalIngestion', `SMC analysis skipped: ${err.message}`, {
      symbol: external.symbol,
    });
    return {
      symbol: external.symbol,
      direction: external.direction,
      confidence: 55,
      reasons: {
        volatility: { status: 'pass', detail: 'Exchange analysis skipped' },
      },
    };
  }
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSide(side) {
  const value = String(side || '').toUpperCase();
  if (value === 'LONG' || value === 'BUY') return { side: 'LONG', direction: 'BUY' };
  if (value === 'SHORT' || value === 'SELL') return { side: 'SHORT', direction: 'SELL' };
  return { side: '', direction: '' };
}

function normalizeExternalPayload(payload = {}) {
  const tps = Array.isArray(payload.take_profit)
    ? payload.take_profit
    : [payload.tp1, payload.tp2, payload.tp3].filter((v) => v !== undefined && v !== null);
  const { side, direction } = normalizeSide(payload.side || payload.direction);
  return {
    provider: String(payload.provider || 'unknown_provider'),
    symbol: String(payload.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    side,
    direction,
    entry_price: toNumber(payload.entry ?? payload.entry_price),
    stop_loss: toNumber(payload.stop_loss ?? payload.sl),
    tp1: toNumber(tps[0]),
    tp2: toNumber(tps[1]),
    tp3: toNumber(tps[2]),
    raw_message: String(payload.raw_message || ''),
    parser: String(payload.parser || 'unknown'),
    provider_message_id: payload.provider_message_id || null,
    source_chat_id: payload.source_chat_id || null,
    timestamp: payload.timestamp || new Date().toISOString(),
    external_confidence: toNumber(payload.confidence),
    metadata: payload.metadata || {},
  };
}

function validateShape(signal) {
  const checks = [];
  const require = (rule, passed, message) => {
    checks.push({ rule, passed, message });
    return passed;
  };

  require('symbol', /^[A-Z0-9]{2,20}USDT$/.test(signal.symbol), 'USDT futures symbol required');
  require('side', signal.direction === 'BUY' || signal.direction === 'SELL', 'side must be LONG or SHORT');
  require('entry', signal.entry_price > 0, 'entry must be positive');
  require('stop_loss', signal.stop_loss > 0, 'stop_loss must be positive');
  require('tp1', signal.tp1 > 0, 'tp1 must be positive');
  require('tp2', signal.tp2 > 0, 'tp2 must be positive');

  if (signal.direction === 'BUY') {
    require('level_geometry', signal.stop_loss < signal.entry_price && signal.tp1 > signal.entry_price && signal.tp2 > signal.entry_price, 'LONG requires SL below entry and TPs above entry');
  } else if (signal.direction === 'SELL') {
    require('level_geometry', signal.stop_loss > signal.entry_price && signal.tp1 < signal.entry_price && signal.tp2 < signal.entry_price, 'SHORT requires SL above entry and TPs below entry');
  }

  return { passed: checks.every((check) => check.passed), checks };
}

function validateFreshness(timestamp) {
  const maxAgeMinutes = config.externalSignals.maxSignalAgeMinutes || 15;
  const signalTime = new Date(timestamp).getTime();
  if (!Number.isFinite(signalTime)) {
    return {
      passed: false,
      ageMinutes: null,
      message: 'Invalid signal timestamp',
    };
  }
  const ageMs = Date.now() - signalTime;
  const ageMinutes = Math.round(ageMs / 60000);
  const passed = ageMs >= 0 && ageMs <= maxAgeMinutes * 60 * 1000;
  return {
    passed,
    ageMinutes,
    message: passed
      ? `Signal age ${ageMinutes}m within ${maxAgeMinutes}m limit`
      : `Signal too old (${ageMinutes}m) — max ${maxAgeMinutes}m`,
  };
}

function scoreHistoricalPerformance(pairStats, symbol) {
  const stats = (pairStats || []).find((item) => item.symbol === symbol);
  if (!stats) return { score: 50, stats: null };
  const winRate = parseFloat(stats.win_rate || 0);
  const strategyScore = parseFloat(stats.strategy_score || 0);
  return {
    score: Math.round((winRate + strategyScore) / 2),
    stats: {
      win_rate: winRate,
      strategy_score: strategyScore,
      total_trades: stats.total_trades || 0,
    },
  };
}

function scoreTelegramValidation(generated, external, historical, aiConfidence) {
  const smcConfidence = generated.confidence || 0;
  const aiScore = Math.min(aiConfidence || 55, 100);
  const directionBonus = generated.direction === external.direction && generated.direction !== 'IGNORE' ? 10 : 0;
  const volatilityPenalty = generated.reasons?.volatility?.status === 'fail';

  if (volatilityPenalty) return 0;

  return Math.round(
    smcConfidence * 0.40
    + historical.score * 0.25
    + aiScore * 0.25
    + directionBonus
  );
}

export async function ingestExternalSignal(payload = {}, options = {}) {
  const validateOnly = options.validateOnly === true;
  const allowStale = options.allowStale === true;
  const testMode = options.testMode === true || config.externalSignals.testMode === true;
  const skipScoreGate = options.skipScoreGate === true || testMode;

  const external = normalizeExternalPayload(payload);
  const shape = validateShape(external);
  if (!shape.passed) {
    await logEvent('warn', 'externalSignalIngestion', 'External signal rejected by shape validation', {
      provider: external.provider,
      symbol: external.symbol,
      checks: shape.checks,
    });
    return { accepted: false, passed: false, reason: 'shape_validation_failed', checks: shape.checks, signal: external };
  }

  const freshness = validateFreshness(external.timestamp);
  const freshnessOk = freshness.passed || allowStale || testMode;
  if (!freshness.passed && !allowStale && !testMode) {
    await logEvent('warn', 'externalSignalIngestion', 'Stale Telegram signal rejected', {
      provider: external.provider,
      symbol: external.symbol,
      ageMinutes: freshness.ageMinutes,
    });
    return {
      accepted: false,
      passed: false,
      reason: 'signal_too_old',
      checks: [{ rule: 'freshness', passed: false, message: freshness.message }],
      signal: external,
    };
  }

  const generated = await generateSignalSafe(external);
  const { data: pairStats } = await getPairStats();
  const historical = scoreHistoricalPerformance(pairStats, external.symbol);
  const aiConfidence = external.external_confidence ?? null;
  const validationScore = scoreTelegramValidation(generated, external, historical, aiConfidence);
  const minScore = config.externalSignals.minValidationScore;
  const scorePassed = skipScoreGate || validationScore >= minScore;

  const signalTime = new Date(external.timestamp);
  const maxAgeMinutes = config.externalSignals.maxSignalAgeMinutes || 15;
  const expiresAt = new Date(signalTime.getTime() + maxAgeMinutes * 60 * 1000).toISOString();

  const validation = {
    score: validationScore,
    checks: [
      ...shape.checks,
      {
        rule: 'freshness',
        passed: freshnessOk,
        message: testMode && !freshness.passed
          ? `Test mode — age ${freshness.ageMinutes}m (freshness skipped)`
          : freshness.message,
      },
      {
        rule: 'validation_score',
        passed: scorePassed,
        message: skipScoreGate ? `Test mode — score ${validationScore} (gate skipped)` : `Score ${validationScore}/${minScore}`,
      },
      { rule: 'volatility', passed: generated.reasons?.volatility?.status !== 'fail', message: generated.reasons?.volatility?.detail || 'Volatility check' },
      { rule: 'ema_gate', passed: true, message: 'Skipped for Telegram VIP signal' },
      { rule: 'rsi_gate', passed: true, message: 'Skipped for Telegram VIP signal' },
      { rule: 'ob_gate', passed: true, message: 'Skipped for Telegram VIP signal' },
    ],
    historical,
  };

  const tradePassed = scorePassed && freshnessOk;

  if (validateOnly) {
    return {
      accepted: true,
      passed: tradePassed,
      reason: tradePassed ? 'validation_passed' : (freshnessOk ? 'validation_failed' : 'signal_too_old'),
      validate_only: true,
      stale: !freshness.passed,
      test_mode: testMode,
      ready_to_approve: tradePassed,
      signal: {
        symbol: external.symbol,
        direction: external.direction,
        side: external.side,
        entry: external.entry_price,
        stop_loss: external.stop_loss,
        tp1: external.tp1,
        tp2: external.tp2,
        tp3: external.tp3,
        confidence: validationScore,
        parser: external.parser,
        metadata: payload.metadata || {},
      },
      validation,
    };
  }

  if (!freshnessOk && !testMode) {
    return {
      accepted: false,
      passed: false,
      reason: 'signal_too_old',
      checks: [{ rule: 'freshness', passed: false, message: freshness.message }],
      signal: external,
    };
  }

  const signal = {
    id: payload.id || payload.signal_id,
    source: 'telegram',
    symbol: external.symbol,
    direction: external.direction,
    confidence: validationScore,
    entry_price: external.entry_price,
    stop_loss: external.stop_loss,
    tp1: external.tp1,
    tp2: external.tp2,
    tp3: external.tp3,
    timeframe_entry: generated.timeframe_entry || '5m',
    strategy_name: 'telegram-vip-smc-validation',
    status: scorePassed ? 'pending' : 'rejected',
    expires_at: expiresAt,
    reasons: {
      ...(generated.reasons || {}),
      orderBlock: { status: 'pass', detail: 'Telegram VIP signal — OB gate skipped' },
      rsi: { status: 'pass', detail: 'Telegram VIP signal — RSI gate skipped' },
      rsiMandatory: { status: 'pass', detail: 'Telegram VIP signal — RSI gate skipped' },
      ema: { ...(generated.reasons?.ema || {}), status: 'pass', detail: 'Telegram VIP signal — EMA gate skipped' },
      external_provider: {
        provider: external.provider,
        parser: external.parser,
        raw_message: external.raw_message,
        timestamp: external.timestamp,
        provider_message_id: external.provider_message_id,
        source_chat_id: external.source_chat_id,
      },
      validation: {
        status: scorePassed ? 'pass' : 'fail',
        score: validationScore,
        test_mode: testMode,
        ai_confidence: aiConfidence,
        smc_confidence: generated.confidence || 0,
        smc_direction: generated.direction,
        requested_direction: external.direction,
        signal_age_minutes: freshness.ageMinutes,
        historical,
        telegram_validation: true,
      },
    },
    mtf_status: generated.mtf_status || {},
  };

  const { data: savedSignal, error } = await saveSignal(signal);
  if (error) {
    await logEvent('error', 'externalSignalIngestion', `Failed to save external signal: ${error.message || error}`, {
      provider: external.provider,
      symbol: external.symbol,
    });
    return { accepted: false, passed: false, reason: 'save_failed', error, signal };
  }

  await logEvent(scorePassed ? 'info' : 'warn', 'externalSignalIngestion', `Telegram signal ${scorePassed ? 'passed' : 'rejected'} validation`, {
    signalId: savedSignal?.id,
    provider: external.provider,
    symbol: external.symbol,
    validationScore,
    ageMinutes: freshness.ageMinutes,
  });

  return {
    accepted: true,
    passed: scorePassed,
    reason: scorePassed ? 'validation_passed' : 'validation_failed',
    signal: { ...signal, id: savedSignal?.id },
    saved_signal: savedSignal,
    validation,
  };
}
