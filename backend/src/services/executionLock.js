/**
 * Prevents duplicate trade opens for the same signal or symbol.
 * In-memory in-flight locks + Supabase checks for open trades / executed signals.
 */
import { getOpenTrades, getSupabase, logEvent } from './supabase.js';

const inFlight = new Map();

function normalizeSymbol(symbol) {
  return String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function executionLockKey(signal = {}) {
  const signalId = signal.id || signal.signal_id;
  if (signalId && !String(signalId).startsWith('local-')) {
    return `signal:${signalId}`;
  }
  const sym = normalizeSymbol(signal.symbol);
  const dir = signal.direction === 'SELL' ? 'SELL' : signal.direction === 'BUY' ? 'BUY' : 'ANY';
  return sym ? `symbol:${sym}:${dir}` : `anon:${Date.now()}`;
}

/** Read-only duplicate checks (no lock acquired). */
export async function checkExecutionAllowed(signal = {}) {
  const signalId = signal.id || signal.signal_id;
  const symbol = normalizeSymbol(signal.symbol);
  const db = getSupabase();

  if (signalId && db && !String(signalId).startsWith('local-')) {
    const { data: bySignal } = await db
      .from('trades')
      .select('id, status, symbol, notional_usdt')
      .eq('signal_id', signalId)
      .in('status', ['open', 'partial'])
      .maybeSingle();
    if (bySignal) {
      return {
        allowed: false,
        reason: 'signal_already_has_open_trade',
        tradeId: bySignal.id,
        symbol: bySignal.symbol,
      };
    }

    const { data: sigRow } = await db
      .from('signals')
      .select('status, user_action')
      .eq('id', signalId)
      .maybeSingle();
    if (sigRow?.user_action === 'executed' || sigRow?.status === 'accepted') {
      const { data: anyTrade } = await db
        .from('trades')
        .select('id, status')
        .eq('signal_id', signalId)
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (anyTrade) {
        return {
          allowed: false,
          reason: 'signal_already_executed',
          tradeId: anyTrade.id,
          tradeStatus: anyTrade.status,
        };
      }
    }
  }

  if (symbol) {
    const { data: openTrades } = await getOpenTrades();
    const conflict = (openTrades || []).find((t) => normalizeSymbol(t.symbol) === symbol);
    if (conflict) {
      return {
        allowed: false,
        reason: 'symbol_has_open_position',
        tradeId: conflict.id,
        symbol: conflict.symbol,
      };
    }
  }

  return { allowed: true };
}

/** Acquire in-flight lock; returns { acquired, key, reason? }. */
export async function acquireExecutionLock(signal = {}, meta = {}) {
  const pre = await checkExecutionAllowed(signal);
  if (!pre.allowed) {
    return { acquired: false, ...pre };
  }

  const key = executionLockKey(signal);
  if (inFlight.has(key)) {
    return {
      acquired: false,
      reason: 'execution_in_progress',
      key,
      inFlightSince: inFlight.get(key)?.startedAt,
    };
  }

  inFlight.set(key, {
    startedAt: Date.now(),
    signalId: signal.id || signal.signal_id,
    symbol: normalizeSymbol(signal.symbol),
    source: meta.source || signal.source || 'unknown',
  });

  return { acquired: true, key };
}

export function releaseExecutionLock(key) {
  if (key) inFlight.delete(key);
}

export async function logDuplicateBlocked(signal, result, source = 'execute') {
  await logEvent('warn', source, `Duplicate execution blocked: ${result.reason}`, {
    symbol: signal.symbol,
    signalId: signal.id || signal.signal_id,
    reason: result.reason,
    tradeId: result.tradeId,
    source: signal.source,
  });
}
