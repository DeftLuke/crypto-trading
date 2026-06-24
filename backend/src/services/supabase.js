import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
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
      global: { fetch },
      realtime: { transport: ws },
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

const SIGNAL_COLUMNS = [
  'symbol', 'direction', 'confidence', 'entry_price', 'stop_loss',
  'tp1', 'tp2', 'tp3', 'reasons', 'mtf_status', 'timeframe_entry', 'status', 'expires_at',
  'signal_source', 'strategy_name', 'source_group', 'validation_score',
];

function toSignalRow(signal) {
  const row = {};
  for (const col of SIGNAL_COLUMNS) {
    if (signal[col] !== undefined && signal[col] !== null) row[col] = signal[col];
  }
  if (row.reasons == null) row.reasons = signal.reasons || {};
  if (row.mtf_status == null) row.mtf_status = signal.mtf_status || {};
  if (!row.timeframe_entry) row.timeframe_entry = signal.timeframe_entry || '5m';
  if (!row.status) row.status = signal.status || 'pending';
  return row;
}

export async function saveSignal(signal) {
  const db = getSupabase();
  if (!db) return { data: { ...signal, id: `local-${Date.now()}` }, error: null };
  return db.from('signals').insert(toSignalRow(signal)).select().single();
}

const CORE_TRADE_COLUMNS = [
  'signal_id', 'symbol', 'direction', 'entry_price', 'quantity',
  'stop_loss', 'tp1', 'tp2', 'tp3', 'binance_order_id', 'binance_sl_order_id',
  'risk_amount', 'status',
];

function isMissingColumnError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('unknown'));
}

export async function saveTrade(trade) {
  const db = getSupabase();
  if (!db) return { data: trade, error: null };
  const row = toTradeRow(trade);
  let result = await db.from('trades').insert(row).select().single();
  if (result.error && isMissingColumnError(result.error)) {
    const core = {};
    for (const col of CORE_TRADE_COLUMNS) {
      if (row[col] !== undefined && row[col] !== null) core[col] = row[col];
    }
    if (row.initial_stop_loss != null && core.stop_loss == null) core.stop_loss = row.initial_stop_loss;
    result = await db.from('trades').insert(core).select().single();
  }
  return result;
}

export const TRADE_COLUMNS = [
  'signal_id', 'symbol', 'direction', 'entry_price', 'quantity', 'original_quantity',
  'stop_loss', 'initial_stop_loss', 'tp1', 'tp2', 'tp3',
  'tp1_hit', 'tp2_hit', 'tp3_hit', 'sl_moved_breakeven', 'sl_locked_1r',
  'exit_price', 'pnl', 'pnl_percent', 'r_multiple', 'status', 'close_reason',
  'binance_order_id', 'binance_sl_order_id', 'risk_amount', 'leverage',
  'notional_usdt', 'margin_usdt', 'sizing_mode', 'lesson', 'opened_at', 'closed_at',
  'tp1_hit_at', 'tp2_hit_at', 'sl_updated_at', 'exchange_realized_pnl',
  'peak_price', 'last_mark_price', 'last_mark_at',
  'signal_received_at', 'execution_latency_ms', 'signal_source', 'strategy_name', 'close_factors',
  'exchange', 'risk_percentage', 'lifecycle_stage', 'exchange_qty', 'db_exchange_sync_ok', 'protection_verified_at',
];

function toTradeRow(trade) {
  const row = {};
  for (const col of TRADE_COLUMNS) {
    if (trade[col] !== undefined && trade[col] !== null) row[col] = trade[col];
  }
  return row;
}

export async function updateTrade(id, updates) {
  const db = getSupabase();
  if (!db) return { data: null, error: 'No DB' };
  let result = await db.from('trades').update(updates).eq('id', id).select().single();
  // If a column hasn't been migrated yet (e.g. peak_price), don't lose the whole
  // update — strip unknown columns and retry so SL/TP state still persists.
  if (result.error && isMissingColumnError(result.error)) {
    const known = {};
    for (const col of TRADE_COLUMNS) {
      if (updates[col] !== undefined) known[col] = updates[col];
    }
    result = await db.from('trades').update(known).eq('id', id).select().single();
  }
  return result;
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

export async function getTrades(limit = 500, options = {}) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };

  const status = options.status || 'all';
  if (status === 'closed') {
    return getClosedTrades(limit);
  }
  if (status === 'open') {
    return getOpenTrades();
  }

  // Only fetch `limit` from each source — the merge below slices to `limit`
  // anyway, so pulling 500 closed rows for a 20-row dashboard was wasted I/O.
  const [closedRes, recentRes] = await Promise.all([
    getClosedTrades(limit),
    db.from('trades').select('*').order('opened_at', { ascending: false }).limit(limit),
  ]);

  const byId = new Map();
  for (const t of [...(recentRes.data || []), ...(closedRes.data || [])]) {
    byId.set(t.id, t);
  }
  const merged = [...byId.values()].sort((a, b) => {
    const ta = new Date(a.closed_at || a.opened_at || 0).getTime();
    const tb = new Date(b.closed_at || b.opened_at || 0).getTime();
    return tb - ta;
  });
  return { data: merged.slice(0, limit), error: closedRes.error || recentRes.error };
}

export async function getClosedTrades(limit = 500) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  return db
    .from('trades')
    .select('*')
    .in('status', ['closed', 'stopped'])
    .order('closed_at', { ascending: false, nullsFirst: false })
    .limit(limit);
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
  if (!db) return { data: null, error: null };
  return db.from('trade_lessons').insert(lesson).select().single();
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

export async function upsertTelegramSignalSources(sources = []) {
  const db = getSupabase();
  if (!db) return { data: sources, error: null };
  const rows = sources.map((source) => ({
    telegram_chat_id: source.telegram_chat_id,
    title: source.title,
    username: source.username || null,
    source_type: source.source_type || 'unknown',
    provider_id: source.provider_id || source.username || String(source.telegram_chat_id),
    parser: source.parser || 'generic',
    can_read: source.can_read !== false,
    last_message_id: source.last_message_id || null,
    last_synced_at: new Date().toISOString(),
    metadata: source.metadata || {},
  }));
  return db
    .from('telegram_signal_sources')
    .upsert(rows, { onConflict: 'telegram_chat_id', ignoreDuplicates: false })
    .select('*');
}

export async function getTelegramSignalSources({ followed = null, limit = 500 } = {}) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  let query = db
    .from('telegram_signal_sources')
    .select('*')
    .order('is_followed', { ascending: false })
    .order('title', { ascending: true })
    .limit(limit);
  if (followed !== null) query = query.eq('is_followed', followed);
  return query;
}

export async function updateTelegramSignalSource(id, updates = {}) {
  const db = getSupabase();
  if (!db) return { data: { id, ...updates }, error: null };
  const allowed = {};
  for (const key of ['is_followed', 'provider_id', 'parser', 'can_read', 'metadata']) {
    if (updates[key] !== undefined) allowed[key] = updates[key];
  }
  if (updates.metadata !== undefined) {
    const { data: existing } = await db
      .from('telegram_signal_sources')
      .select('metadata')
      .eq('id', id)
      .single();
    allowed.metadata = { ...(existing?.metadata || {}), ...updates.metadata };
  }
  allowed.updated_at = new Date().toISOString();
  return db.from('telegram_signal_sources').update(allowed).eq('id', id).select('*').single();
}

export async function getTelegramSignalMessageByChatAndId(telegramChatId, messageId) {
  const db = getSupabase();
  if (!db) return { data: null, error: null };
  return db
    .from('telegram_signal_messages')
    .select('id, parse_status, api_result')
    .eq('telegram_chat_id', telegramChatId)
    .eq('message_id', messageId)
    .maybeSingle();
}

export async function saveTelegramSignalMessage(message = {}) {
  const db = getSupabase();
  if (!db) return { data: message, error: null };
  const row = {
    source_id: message.source_id || null,
    telegram_chat_id: message.telegram_chat_id,
    message_id: message.message_id,
    raw_message: message.raw_message,
    parsed_signal: message.parsed_signal || null,
    parse_status: message.parse_status || 'unparsed',
    api_result: message.api_result || {},
    message_date: message.message_date || null,
    received_at: message.received_at || new Date().toISOString(),
  };
  return db
    .from('telegram_signal_messages')
    .upsert(row, { onConflict: 'telegram_chat_id,message_id', ignoreDuplicates: false })
    .select('*')
    .single();
}

export async function getTelegramSignalMessages({ limit = 100, chatId = null, parseStatus = null, followedOnly = false } = {}) {
  const db = getSupabase();
  if (!db) return { data: [], error: null };
  let query = db
    .from('telegram_signal_messages')
    .select('*, telegram_signal_sources(title, username, is_followed)')
    .order('message_date', { ascending: false, nullsFirst: false })
    .order('received_at', { ascending: false })
    .limit(limit);
  if (chatId) query = query.eq('telegram_chat_id', chatId);
  if (parseStatus) query = query.eq('parse_status', parseStatus);
  else query = query.neq('parse_status', 'superseded');
  const result = await query;
  if (followedOnly && result.data) {
    const { data: followedSources } = await getTelegramSignalSources({ followed: true, limit: 500 });
    const followedChatIds = new Set(
      (followedSources || []).map((s) => Number(s.telegram_chat_id)),
    );
    result.data = result.data.filter(
      (row) =>
        row.telegram_signal_sources?.is_followed === true
        || followedChatIds.has(Number(row.telegram_chat_id)),
    );
  }
  return result;
}

export async function supersedeAllTelegramMessagesForChat(telegramChatId) {
  const db = getSupabase();
  if (!db) return { error: null };
  const { data: rows } = await db
    .from('telegram_signal_messages')
    .select('id, api_result')
    .eq('telegram_chat_id', telegramChatId)
    .eq('parse_status', 'parsed');
  if (!rows?.length) return { error: null };
  const updates = rows
    .filter((row) => !row.api_result?.executed)
    .map((row) =>
      db
        .from('telegram_signal_messages')
        .update({ parse_status: 'superseded' })
        .eq('id', row.id)
    );
  await Promise.all(updates);
  return { error: null };
}

export async function supersedeTelegramMessagesForChat(telegramChatId, keepMessageId) {
  const db = getSupabase();
  if (!db) return { error: null };
  const { data: rows } = await db
    .from('telegram_signal_messages')
    .select('id, message_id, api_result')
    .eq('telegram_chat_id', telegramChatId)
    .eq('parse_status', 'parsed');
  if (!rows?.length) return { error: null };
  const updates = rows
    .filter((row) => row.message_id !== keepMessageId && !row.api_result?.executed)
    .map((row) =>
      db
        .from('telegram_signal_messages')
        .update({ parse_status: 'superseded' })
        .eq('id', row.id)
    );
  await Promise.all(updates);
  return { error: null };
}

export async function updateTelegramSignalMessage(id, patch) {
  const db = getSupabase();
  if (!db) return { data: null, error: new Error('Database unavailable') };
  const allowed = {};
  if (patch.api_result !== undefined) allowed.api_result = patch.api_result;
  if (patch.parse_status !== undefined) allowed.parse_status = patch.parse_status;
  if (patch.parsed_signal !== undefined) allowed.parsed_signal = patch.parsed_signal;
  if (patch.signal_id !== undefined) allowed.signal_id = patch.signal_id;
  return db.from('telegram_signal_messages').update(allowed).eq('id', id).select('*').single();
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
