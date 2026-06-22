/**
 * Phase 2: Signal performance reporting — by source, strategy, group.
 * Feeds dashboard analytics and Phase 4 strategy improvement loop.
 */
import { getSupabase } from './supabase.js';
import { extractLineageFromSignal } from './signalLineage.js';

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

function avg(nums) {
  const valid = nums.filter((n) => Number.isFinite(n));
  if (!valid.length) return 0;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 100) / 100;
}

function bucketKey(parts) {
  return parts.filter(Boolean).join('::');
}

export async function getSignalPerformanceReport(options = {}) {
  const days = parseInt(options.days || '90', 10);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const db = getSupabase();
  if (!db) {
    return { ok: false, error: 'Database unavailable', by_source: [], by_strategy: [], by_group: [], summary: {} };
  }

  const [signalsRes, tradesRes, lessonsRes, outcomesRes] = await Promise.all([
    db.from('signals').select('*').gte('created_at', since).in('direction', ['BUY', 'SELL']).order('created_at', { ascending: false }).limit(2000),
    db.from('trades').select('*').gte('opened_at', since).order('opened_at', { ascending: false }).limit(2000),
    db.from('trade_lessons').select('lesson_type, outcome, symbol, close_factors, created_at').gte('created_at', since).limit(2000),
    db.from('signal_outcomes').select('signal_id, outcome, r_multiple, check_minutes').gte('checked_at', since).limit(2000),
  ]);

  const signals = signalsRes.data || [];
  const trades = tradesRes.data || [];
  const lessons = lessonsRes.data || [];
  const outcomes = outcomesRes.data || [];

  const tradesBySignal = new Map();
  for (const t of trades) {
    if (t.signal_id) tradesBySignal.set(t.signal_id, t);
  }

  const outcomesBySignal = new Map();
  for (const o of outcomes) {
    if (!outcomesBySignal.has(o.signal_id)) outcomesBySignal.set(o.signal_id, o);
  }

  const bySource = new Map();
  const byStrategy = new Map();
  const byGroup = new Map();

  const touch = (map, key, init) => {
    if (!map.has(key)) map.set(key, { ...init });
    return map.get(key);
  };

  let totalLatency = [];
  let executedCount = 0;
  let wins = 0;
  let losses = 0;
  let totalR = [];

  for (const signal of signals) {
    const lineage = extractLineageFromSignal(signal);
    const source = signal.signal_source || lineage.source || 'unknown';
    const strategy = signal.strategy_name || lineage.strategy || 'unknown';
    const group = signal.source_group || lineage.group || 'unknown';
    const trade = tradesBySignal.get(signal.id);
    const outcome = outcomesBySignal.get(signal.id);
    const executed = signal.user_action === 'executed' || Boolean(trade);
    const finalOutcome = trade
      ? ((parseFloat(trade.pnl) || 0) > 0 ? 'win' : (parseFloat(trade.pnl) || 0) < 0 ? 'loss' : 'breakeven')
      : (signal.final_outcome || outcome?.outcome || null);

    for (const [map, key] of [[bySource, source], [byStrategy, strategy], [byGroup, group]]) {
      const row = touch(map, key, {
        key,
        signals: 0,
        executed: 0,
        wins: 0,
        losses: 0,
        skipped: 0,
        avg_validation_score: [],
        avg_r: [],
        latency_ms: [],
      });
      row.signals++;
      if (executed) row.executed++;
      else if (signal.user_action === 'skipped') row.skipped++;
      if (lineage.validation_score != null) row.avg_validation_score.push(lineage.validation_score);
      if (finalOutcome === 'win') row.wins++;
      if (finalOutcome === 'loss') row.losses++;
      if (trade?.r_multiple != null) row.avg_r.push(parseFloat(trade.r_multiple));
      else if (outcome?.r_multiple != null) row.avg_r.push(parseFloat(outcome.r_multiple));
      const lat = trade?.execution_latency_ms ?? (
        trade?.opened_at && signal.created_at
          ? new Date(trade.opened_at).getTime() - new Date(signal.created_at).getTime()
          : null
      );
      if (lat != null && lat >= 0) row.latency_ms.push(lat);
    }

    if (trade) {
      executedCount++;
      const pnl = parseFloat(trade.pnl) || 0;
      if (pnl > 0) wins++;
      if (pnl < 0) losses++;
      if (trade.r_multiple != null) totalR.push(parseFloat(trade.r_multiple));
      const lat = trade.execution_latency_ms ?? (
        trade.opened_at && signal.created_at
          ? new Date(trade.opened_at).getTime() - new Date(signal.created_at).getTime()
          : null
      );
      if (lat != null && lat >= 0) totalLatency.push(lat);
    }
  }

  const finalize = (map) => [...map.values()].map((row) => ({
    ...row,
    win_rate: pct(row.wins, row.wins + row.losses),
    execution_rate: pct(row.executed, row.signals),
    avg_validation_score: avg(row.avg_validation_score),
    avg_r: avg(row.avg_r),
    avg_latency_ms: Math.round(avg(row.latency_ms)),
    avg_latency_sec: Math.round(avg(row.latency_ms) / 100) / 10,
  })).sort((a, b) => b.signals - a.signals);

  const lessonStats = {
    executed: { wins: 0, losses: 0 },
    skipped: { wins: 0, losses: 0 },
    hypothetical: { wins: 0, losses: 0 },
  };
  for (const l of lessons) {
    const b = lessonStats[l.lesson_type] || lessonStats.hypothetical;
    if (l.outcome === 'win') b.wins++;
    if (l.outcome === 'loss') b.losses++;
  }

  return {
    ok: true,
    period_days: days,
    since,
    summary: {
      total_signals: signals.length,
      executed_trades: executedCount,
      win_rate: pct(wins, wins + losses),
      avg_r: avg(totalR),
      avg_latency_ms: Math.round(avg(totalLatency)),
      avg_latency_sec: Math.round(avg(totalLatency) / 100) / 10,
      lessons: lessonStats,
    },
    by_source: finalize(bySource),
    by_strategy: finalize(byStrategy),
    by_group: finalize(byGroup),
    phase4_ready: {
      strategies_tracked: byStrategy.size,
      sources_tracked: bySource.size,
      lesson_samples: lessons.length,
    },
  };
}

export async function getRecentLessons(limit = 30) {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('trade_lessons')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

/** Per-signal performance rows for dashboard (source, execution, trade link, PnL). */
export async function getSignalPerformanceFeed(options = {}) {
  const days = parseInt(options.days || '90', 10);
  const limit = parseInt(options.limit || '100', 10);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const db = getSupabase();
  if (!db) return { ok: false, signals: [] };

  const [signalsRes, tradesRes, outcomesRes] = await Promise.all([
    db.from('signals').select('*').gte('created_at', since).in('direction', ['BUY', 'SELL'])
      .order('created_at', { ascending: false }).limit(limit),
    db.from('trades').select('id, signal_id, symbol, direction, status, pnl, r_multiple, opened_at, closed_at, notional_usdt, margin_usdt, leverage')
      .gte('opened_at', since).limit(2000),
    db.from('signal_outcomes').select('signal_id, outcome, r_multiple, check_minutes').gte('checked_at', since).limit(2000),
  ]);

  const tradesBySignal = new Map();
  for (const t of tradesRes.data || []) {
    if (t.signal_id) tradesBySignal.set(t.signal_id, t);
  }
  const outcomesBySignal = new Map();
  for (const o of outcomesRes.data || []) {
    if (!outcomesBySignal.has(o.signal_id)) outcomesBySignal.set(o.signal_id, o);
  }

  const signals = (signalsRes.data || []).map((signal) => {
    const lineage = extractLineageFromSignal(signal);
    const trade = tradesBySignal.get(signal.id);
    const outcome = outcomesBySignal.get(signal.id);
    const executed = signal.user_action === 'executed' || Boolean(trade);
    const pnl = trade ? parseFloat(trade.pnl) || 0 : null;
    const finalOutcome = trade
      ? (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : trade.status === 'open' || trade.status === 'partial' ? 'open' : 'breakeven')
      : (signal.final_outcome || outcome?.outcome || null);

    return {
      id: signal.id,
      symbol: signal.symbol,
      direction: signal.direction,
      confidence: signal.confidence,
      strategy_name: signal.strategy_name || lineage.strategy,
      source: signal.signal_source || lineage.source || 'unknown',
      source_group: signal.source_group || lineage.group || null,
      status: signal.status,
      user_action: signal.user_action,
      executed,
      execution_status: executed
        ? (trade?.status === 'open' || trade?.status === 'partial' ? 'open' : 'closed')
        : (signal.user_action === 'skipped' ? 'skipped' : 'not_traded'),
      final_outcome: finalOutcome,
      trade_id: trade?.id || null,
      trade_status: trade?.status || null,
      pnl,
      r_multiple: trade?.r_multiple != null ? parseFloat(trade.r_multiple) : outcome?.r_multiple,
      notional_usdt: trade?.notional_usdt,
      margin_usdt: trade?.margin_usdt,
      leverage: trade?.leverage,
      created_at: signal.created_at,
      opened_at: trade?.opened_at,
      closed_at: trade?.closed_at,
      tp1: signal.tp1,
      tp2: signal.tp2,
      stop_loss: signal.stop_loss,
    };
  });

  return { ok: true, period_days: days, count: signals.length, signals };
}
