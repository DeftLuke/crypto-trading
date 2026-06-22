import { getSupabase } from './supabase.js';
import { SIGNAL_COOLDOWN_MS, buildPatternKey } from '../strategies/smc-mtf/rules.js';

const recentNotifications = new Map();

export async function hasRecentSignal(symbol, direction) {
  const db = getSupabase();
  if (!db) return false;

  const since = new Date(Date.now() - SIGNAL_COOLDOWN_MS).toISOString();

  const { data } = await db
    .from('signals')
    .select('id, direction, status, created_at')
    .eq('symbol', symbol)
    .eq('direction', direction)
    .gte('created_at', since)
    .not('status', 'eq', 'skipped')
    .limit(1);

  return data?.length > 0;
}

export async function hasActivePendingSignal(symbol, direction) {
  const db = getSupabase();
  if (!db) return false;

  const { data } = await db
    .from('signals')
    .select('id, expires_at')
    .eq('symbol', symbol)
    .eq('direction', direction)
    .in('status', ['pending', 'sent', 'accepted'])
    .gte('expires_at', new Date().toISOString())
    .limit(1);

  return data?.length > 0;
}

export async function shouldNotifySignal(signal) {
  if (!signal || signal.direction === 'IGNORE') return { allowed: false, reason: 'IGNORE signal' };

  const key = `${signal.symbol}:${signal.direction}`;
  const lastNotify = recentNotifications.get(key);
  if (lastNotify && Date.now() - lastNotify < SIGNAL_COOLDOWN_MS) {
    return { allowed: false, reason: `Cooldown active for ${signal.symbol} ${signal.direction}` };
  }

  if (await hasRecentSignal(signal.symbol, signal.direction)) {
    return { allowed: false, reason: `Recent signal exists for ${signal.symbol} ${signal.direction}` };
  }

  if (await hasActivePendingSignal(signal.symbol, signal.direction)) {
    return { allowed: false, reason: `Active pending signal for ${signal.symbol}` };
  }

  return { allowed: true };
}

export function markSignalNotified(signal) {
  const key = `${signal.symbol}:${signal.direction}`;
  recentNotifications.set(key, Date.now());
}

export async function getPatternPenalty(patternKey) {
  const db = getSupabase();
  if (!db || !patternKey) return 0;

  const { data } = await db
    .from('learned_patterns')
    .select('pattern_type, confidence_penalty, loss_count')
    .eq('pattern_key', patternKey)
    .single();

  if (!data) return 0;
  if (data.pattern_type === 'avoid') return data.confidence_penalty || Math.min(30, data.loss_count * 5);
  return 0;
}

export async function validateAgainstLessons(signal) {
  let patternKey = signal.pattern_key;
  if (!patternKey) {
    if (signal.strategy_id === 'institutional-smc' || signal.strategy_name === 'institutional-smc') {
      const { buildInstitutionalPatternKey } = await import('../strategies/institutional-smc/rules.js');
      patternKey = buildInstitutionalPatternKey(signal.symbol, signal.direction, signal.explanation || signal.reasons);
    } else {
      patternKey = buildPatternKey(signal.symbol, signal.direction, signal.mtf_status);
    }
  }
  const penalty = await getPatternPenalty(patternKey);

  if (penalty >= 25) {
    return {
      allowed: false,
      reason: `Pattern blocked by lessons: ${patternKey} (penalty ${penalty})`,
      penalty,
    };
  }

  return { allowed: true, penalty, patternKey };
}

export async function validateSignal(signal) {
  const notifyCheck = await shouldNotifySignal(signal);
  if (!notifyCheck.allowed) return notifyCheck;

  const lessonCheck = await validateAgainstLessons(signal);
  if (!lessonCheck.allowed) return lessonCheck;

  return { allowed: true, penalty: lessonCheck.penalty || 0 };
}
