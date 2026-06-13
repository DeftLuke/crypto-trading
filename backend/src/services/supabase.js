import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index.js';

let supabase = null;

export function getSupabase() {
  if (!supabase) {
    if (!config.supabase.url || !config.supabase.serviceKey) {
      console.warn('[Supabase] Missing credentials — DB operations disabled');
      return null;
    }
    supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[Supabase] Connected to', config.supabase.url);
  }
  return supabase;
}

export async function testConnection() {
  const db = getSupabase();
  if (!db) return { ok: false, error: 'Missing credentials' };

  const { data, error } = await db.from('pair_stats').select('symbol').limit(1);
  if (error) return { ok: false, error: error.message };
  return { ok: true, sample: data };
}

export async function logEvent(level, source, message, metadata = {}) {
  const db = getSupabase();
  if (!db) {
    console.log(`[${level}] ${source}: ${message}`, metadata);
    return;
  }
  await db.from('logs').insert({ level, source, message, metadata });
}

export async function saveSignal(signal) {
  const db = getSupabase();
  if (!db) return { data: signal, error: null };
  return db.from('signals').insert(signal).select().single();
}

export async function saveTrade(trade) {
  const db = getSupabase();
  if (!db) return { data: trade, error: null };
  return db.from('trades').insert(trade).select().single();
}

export async function updateTrade(id, updates) {
  const db = getSupabase();
  if (!db) return { data: null, error: 'No DB' };
  return db.from('trades').update(updates).eq('id', id).select().single();
}

export async function getOpenTrades() {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  return db.from('trades').select('*').in('status', ['open', 'partial']);
}

export async function getTodayTradesCount() {
  const db = getSupabase();
  if (!db) return 0;
  const today = new Date().toISOString().split('T')[0];
  const { count } = await db
    .from('trades')
    .select('*', { count: 'exact', head: true })
    .gte('opened_at', `${today}T00:00:00`);
  return count || 0;
}

export async function getTodayDailyPnl() {
  const db = getSupabase();
  if (!db) return 0;
  const today = new Date().toISOString().split('T')[0];
  const { data } = await db
    .from('trades')
    .select('pnl')
    .gte('closed_at', `${today}T00:00:00`)
    .eq('status', 'closed');
  return (data || []).reduce((sum, t) => sum + (parseFloat(t.pnl) || 0), 0);
}

export async function getSignals(limit = 50) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  return db.from('signals').select('*').order('created_at', { ascending: false }).limit(limit);
}

export async function getTrades(limit = 50) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  return db.from('trades').select('*').order('opened_at', { ascending: false }).limit(limit);
}

export async function getPairStats() {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  return db.from('pair_stats').select('*').order('strategy_score', { ascending: false });
}

export async function updatePairStats(symbol, outcome, rMultiple) {
  const db = getSupabase();
  if (!db) return;

  const { data: existing } = await db.from('pair_stats').select('*').eq('symbol', symbol).single();
  if (!existing) return;

  const wins = existing.wins + (outcome === 'win' ? 1 : 0);
  const losses = existing.losses + (outcome === 'loss' ? 1 : 0);
  const totalTrades = existing.total_trades + 1;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgR = ((existing.avg_r_multiple * existing.total_trades) + rMultiple) / totalTrades;
  const scoreDelta = outcome === 'win' ? 2 : -3;
  const strategyScore = Math.max(0, Math.min(100, existing.strategy_score + scoreDelta));

  await db.from('pair_stats').update({
    wins,
    losses,
    total_trades: totalTrades,
    win_rate: winRate,
    avg_r_multiple: avgR,
    strategy_score: strategyScore,
    last_trade_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('symbol', symbol);
}

export async function saveTradeLesson(lesson) {
  const db = getSupabase();
  if (!db) return;
  return db.from('trade_lessons').insert(lesson);
}

export async function getPerformanceMetrics(days = 30) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  return db.from('performance_metrics').select('*').order('metric_date', { ascending: false }).limit(days);
}

export async function updateSignal(id, updates) {
  const db = getSupabase();
  if (!db) return { data: null, error: 'No DB' };
  return db.from('signals').update(updates).eq('id', id).select().single();
}

export async function getSignalOutcomes(signalId) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  return db.from('signal_outcomes').select('*').eq('signal_id', signalId).order('check_minutes');
}

export async function getTradeLessons(lessonType = null, limit = 30) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  let query = db.from('trade_lessons').select('*').order('created_at', { ascending: false }).limit(limit);
  if (lessonType) query = query.eq('lesson_type', lessonType);
  return query;
}

export async function getLessonStats() {
  const db = getSupabase();
  if (!db) return { skipped: { wins: 0, losses: 0 }, executed: { wins: 0, losses: 0 } };

  const { data: lessons } = await db.from('trade_lessons').select('lesson_type, outcome');
  const stats = {
    skipped: { wins: 0, losses: 0, total: 0 },
    executed: { wins: 0, losses: 0, total: 0 },
    hypothetical: { wins: 0, losses: 0, total: 0 },
  };

  for (const l of lessons || []) {
    const bucket = stats[l.lesson_type] || stats.hypothetical;
    bucket.total++;
    if (l.outcome === 'win') bucket.wins++;
    if (l.outcome === 'loss') bucket.losses++;
  }

  return stats;
}
