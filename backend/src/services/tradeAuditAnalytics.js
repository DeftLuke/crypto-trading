/**
 * Trade analytics APIs — today, performance, lifecycle, homepage.
 */
import { getSupabase } from './supabase.js';
import { getTradeEvents, getTradePartials } from './tradeEventAudit.js';
import { getLivePositionQty } from './tradeProtection.js';

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function dayBounds(dateStr = null, tzOffsetMin = 0) {
  const offsetMs = tzOffsetMin * 60 * 1000;
  let label = dateStr;
  if (!label) {
    label = new Date(Date.now() + offsetMs).toISOString().slice(0, 10);
  }
  const [y, m, d] = label.split('-').map(Number);
  const startMs = Date.UTC(y, m - 1, d) - offsetMs;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 86400000).toISOString(),
    label,
  };
}

export async function getTradesTodayStats(dateStr = null, tzOffsetMin = 0) {
  const db = getSupabase();
  const { start, end, label } = dayBounds(dateStr, tzOffsetMin);

  if (!db) {
    return { day: label, closed: 0, wins: 0, losses: 0, win_rate: 0, net_profit: 0, exchange_synced_pct: 0 };
  }

  const { data: perfRows } = await db
    .from('trade_performance')
    .select('*')
    .gte('closed_at', start)
    .lt('closed_at', end);

  const rows = perfRows || [];
  if (rows.length === 0) {
    const { data: legacyClosed } = await db
      .from('trades')
      .select('*')
      .gte('closed_at', start)
      .lt('closed_at', end)
      .in('status', ['closed', 'stopped']);
    const legacyRows = legacyClosed || [];
    const wins = legacyRows.filter((t) => parseFloat(t.pnl) > 0).length;
    const losses = legacyRows.filter((t) => parseFloat(t.pnl) < 0).length;
    const net = legacyRows.reduce((s, t) => s + num(t.pnl), 0);
    return {
      day: label,
      closed: legacyRows.length,
      wins,
      losses,
      breakeven: legacyRows.filter((t) => num(t.pnl) === 0).length,
      win_rate: legacyRows.length ? Math.round((wins / legacyRows.length) * 1000) / 10 : 0,
      net_profit: parseFloat(net.toFixed(4)),
      gross_profit: parseFloat(net.toFixed(4)),
      fees: 0,
      exchange_synced_count: 0,
      exchange_synced_pct: 0,
      legacy_pnl_sum: parseFloat(net.toFixed(4)),
      tp1_hits: legacyRows.filter((t) => t.tp1_hit).length,
      tp2_hits: legacyRows.filter((t) => t.tp2_hit).length,
      be_exits: legacyRows.filter((t) => t.sl_moved_breakeven).length,
      source: 'legacy_trades_fallback',
    };
  }

  const wins = rows.filter((r) => r.win === true).length;
  const losses = rows.filter((r) => r.win === false && num(r.net_profit) < 0).length;
  const closed = rows.length;
  const net = rows.reduce((s, r) => s + num(r.net_profit), 0);
  const synced = rows.filter((r) => r.exchange_synced).length;

  const { data: legacy } = await db
    .from('trades')
    .select('pnl')
    .gte('closed_at', start)
    .lt('closed_at', end)
    .in('status', ['closed', 'stopped']);

  return {
    day: label,
    closed,
    wins,
    losses,
    breakeven: rows.filter((r) => num(r.net_profit) === 0).length,
    win_rate: closed ? Math.round((wins / closed) * 1000) / 10 : 0,
    net_profit: parseFloat(net.toFixed(4)),
    gross_profit: parseFloat(rows.reduce((s, r) => s + num(r.gross_profit), 0).toFixed(4)),
    fees: parseFloat(rows.reduce((s, r) => s + num(r.fees), 0).toFixed(4)),
    exchange_synced_count: synced,
    exchange_synced_pct: closed ? Math.round((synced / closed) * 1000) / 10 : 0,
    legacy_pnl_sum: parseFloat((legacy || []).reduce((s, t) => s + num(t.pnl), 0).toFixed(4)),
    tp1_hits: rows.filter((r) => r.tp1_hit).length,
    tp2_hits: rows.filter((r) => r.tp2_hit).length,
    be_exits: rows.filter((r) => r.be_exit).length,
  };
}

export async function getTradesPerformanceSummary({ from, to, source, symbol, limit = 100 } = {}) {
  const db = getSupabase();
  if (!db) return { rows: [], totals: {} };

  let q = db.from('trade_performance').select('*').order('closed_at', { ascending: false }).limit(limit);
  if (from) q = q.gte('closed_at', from);
  if (to) q = q.lt('closed_at', to);
  if (source) q = q.eq('signal_source', source);
  if (symbol) q = q.eq('symbol', symbol.toUpperCase());

  const { data: rows } = await q;
  const list = rows || [];
  const wins = list.filter((r) => r.win).length;
  const net = list.reduce((s, r) => s + num(r.net_profit), 0);

  return {
    rows: list,
    totals: {
      count: list.length,
      wins,
      losses: list.filter((r) => !r.win && num(r.net_profit) < 0).length,
      net_profit: parseFloat(net.toFixed(4)),
      win_rate: list.length ? Math.round((wins / list.length) * 1000) / 10 : 0,
    },
  };
}

export async function getTradeLifecycle(tradeId) {
  const [{ data: events }, { data: partials }] = await Promise.all([
    getTradeEvents(tradeId),
    getTradePartials(tradeId),
  ]);

  const db = getSupabase();
  let trade = null;
  let perf = null;
  if (db) {
    const tRes = await db.from('trades').select('*').eq('id', tradeId).maybeSingle();
    trade = tRes.data;
    const pRes = await db.from('trade_performance').select('*').eq('trade_id', tradeId).maybeSingle();
    perf = pRes.data;
  }

  const flowStages = ['OPEN', 'SL_SET', 'TP1_SET', 'TP1_HIT', 'BE_SET', 'TP2_HIT', 'RUNNER', 'CLOSED'];
  const reached = new Set((events || []).map((e) => e.event_type));

  return {
    trade,
    performance: perf,
    events: events || [],
    partial_closes: partials || [],
    flow: flowStages.map((stage) => ({
      stage,
      reached: trade?.lifecycle_stage === stage
        || (stage === 'SL_SET' && reached.has('SL_PLACED'))
        || (stage === 'TP1_SET' && reached.has('TP1_PLACED'))
        || (stage === 'TP1_HIT' && (reached.has('TP1_HIT') || reached.has('PARTIAL_CLOSE')))
        || (stage === 'BE_SET' && reached.has('SL_MOVED_BREAKEVEN'))
        || (stage === 'TP2_HIT' && reached.has('TP2_HIT'))
        || (stage === 'CLOSED' && reached.has('TRADE_CLOSED')),
    })),
  };
}

export async function getOpenTradesAudit({ dbOnly = false } = {}) {
  const db = getSupabase();
  if (!db) return { trades: [], lifecycle_counts: {}, total: 0 };

  const { data: open } = await db.from('trades').select('*').in('status', ['open', 'partial']);
  const trades = [];

  for (const t of open || []) {
    let liveQty = null;
    if (!dbOnly) {
      liveQty = await getLivePositionQty(t.symbol).catch(() => null);

      if (liveQty === 0) {
        const { reconcileFlatExchangeTrade } = await import('./tradeClose.js');
        const closed = await reconcileFlatExchangeTrade(t, null, { skipNotify: true }).catch(() => null);
        if (closed) continue;
      }
    }

    const original = num(t.original_quantity || t.quantity, 1);
    const dbQty = num(t.quantity);
    const pctRemain = dbOnly
      ? (original > 0 ? (dbQty / original) * 100 : null)
      : (liveQty != null && original > 0 ? (liveQty / original) * 100 : null);
    const syncOk = dbOnly
      ? t.db_exchange_sync_ok !== false
      : t.db_exchange_sync_ok !== false
        && !(t.status === 'closed' && liveQty > 0)
        && (liveQty == null || Math.abs(liveQty - dbQty) <= original * 0.05);

    trades.push({
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      status: t.status,
      lifecycle_stage: t.lifecycle_stage || 'OPEN',
      pct_remaining: pctRemain != null ? parseFloat(pctRemain.toFixed(1)) : null,
      sl_order: Boolean(t.binance_sl_order_id),
      tp1_hit: t.tp1_hit,
      tp2_hit: t.tp2_hit,
      sl_moved_breakeven: t.sl_moved_breakeven,
      db_exchange_sync_ok: syncOk,
      source: t.signal_source,
    });
  }

  return {
    trades,
    total: trades.length,
    lifecycle_counts: {
      open: trades.filter((x) => !x.tp1_hit).length,
      after_tp1: trades.filter((x) => x.tp1_hit && !x.tp2_hit).length,
      after_tp2: trades.filter((x) => x.tp2_hit).length,
      desync: trades.filter((x) => !x.db_exchange_sync_ok).length,
    },
  };
}

function aggregateDayStats(label, perfRows, legacyRows) {
  if (perfRows.length > 0) {
    const wins = perfRows.filter((r) => r.win === true).length;
    const losses = perfRows.filter((r) => r.win === false && num(r.net_profit) < 0).length;
    const closed = perfRows.length;
    const net = perfRows.reduce((s, r) => s + num(r.net_profit), 0);
    const synced = perfRows.filter((r) => r.exchange_synced).length;
    return {
      day: label,
      closed,
      wins,
      losses,
      breakeven: perfRows.filter((r) => num(r.net_profit) === 0).length,
      win_rate: closed ? Math.round((wins / closed) * 1000) / 10 : 0,
      net_profit: parseFloat(net.toFixed(4)),
      gross_profit: parseFloat(perfRows.reduce((s, r) => s + num(r.gross_profit), 0).toFixed(4)),
      fees: parseFloat(perfRows.reduce((s, r) => s + num(r.fees), 0).toFixed(4)),
      exchange_synced_count: synced,
      exchange_synced_pct: closed ? Math.round((synced / closed) * 1000) / 10 : 0,
      legacy_pnl_sum: parseFloat(legacyRows.reduce((s, t) => s + num(t.pnl), 0).toFixed(4)),
      tp1_hits: perfRows.filter((r) => r.tp1_hit).length,
      tp2_hits: perfRows.filter((r) => r.tp2_hit).length,
      be_exits: perfRows.filter((r) => r.be_exit).length,
    };
  }

  const wins = legacyRows.filter((t) => num(t.pnl) > 0).length;
  const losses = legacyRows.filter((t) => num(t.pnl) < 0).length;
  const net = legacyRows.reduce((s, t) => s + num(t.pnl), 0);
  return {
    day: label,
    closed: legacyRows.length,
    wins,
    losses,
    breakeven: legacyRows.filter((t) => num(t.pnl) === 0).length,
    win_rate: legacyRows.length ? Math.round((wins / legacyRows.length) * 1000) / 10 : 0,
    net_profit: parseFloat(net.toFixed(4)),
    gross_profit: parseFloat(net.toFixed(4)),
    fees: 0,
    exchange_synced_count: 0,
    exchange_synced_pct: 0,
    legacy_pnl_sum: parseFloat(net.toFixed(4)),
    tp1_hits: legacyRows.filter((t) => t.tp1_hit).length,
    tp2_hits: legacyRows.filter((t) => t.tp2_hit).length,
    be_exits: legacyRows.filter((t) => t.sl_moved_breakeven).length,
    source: legacyRows.length ? 'legacy_trades_fallback' : undefined,
  };
}

function rowInDayBounds(isoTs, start, end) {
  if (!isoTs) return false;
  const t = new Date(isoTs).getTime();
  return t >= new Date(start).getTime() && t < new Date(end).getTime();
}

export async function getDailyPerformanceTable(days = 7, tzOffsetMin = 0) {
  const db = getSupabase();
  if (!db) {
    return Array.from({ length: days }, (_, i) => ({
      day: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
      closed: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      net_profit: 0,
      exchange_synced_pct: 0,
    }));
  }

  const dayWindows = [];
  const now = new Date();
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const label = d.toISOString().slice(0, 10);
    const bounds = dayBounds(label, tzOffsetMin);
    dayWindows.push({ label, ...bounds });
  }

  const rangeStart = dayWindows[dayWindows.length - 1].start;
  const rangeEnd = dayWindows[0].end;

  const [{ data: perfRows }, { data: legacyRows }] = await Promise.all([
    db.from('trade_performance').select('*').gte('closed_at', rangeStart).lt('closed_at', rangeEnd),
    db.from('trades').select('*').gte('closed_at', rangeStart).lt('closed_at', rangeEnd).in('status', ['closed', 'stopped']),
  ]);

  const perf = perfRows || [];
  const legacy = legacyRows || [];
  const perfDaysWithData = new Set(perf.map((r) => {
    for (const w of dayWindows) {
      if (rowInDayBounds(r.closed_at, w.start, w.end)) return w.label;
    }
    return null;
  }).filter(Boolean));

  return dayWindows.map(({ label, start, end }) => {
    const dayPerf = perf.filter((r) => rowInDayBounds(r.closed_at, start, end));
    const dayLegacy = perfDaysWithData.has(label)
      ? []
      : legacy.filter((t) => rowInDayBounds(t.closed_at, start, end));
    return aggregateDayStats(label, dayPerf, dayLegacy);
  });
}

export async function getHomeDashboardPayload({ day = null, tz = 0, dbOnly = true } = {}) {
  const tzOffsetMin = parseInt(String(tz), 10) || 0;
  const [daily, openAudit] = await Promise.all([
    getDailyPerformanceTable(7, tzOffsetMin),
    getOpenTradesAudit({ dbOnly }),
  ]);

  const todayLabel = day || dayBounds(null, tzOffsetMin).label;
  const todayFromDaily = daily.find((row) => row.day === todayLabel);
  const today = todayFromDaily || await getTradesTodayStats(day, tzOffsetMin);

  return { today, daily, open: openAudit, generated_at: new Date().toISOString(), db_only: dbOnly };
}

function formatPerfTrade(perf, trade = null) {
  const t = trade || {};
  return {
    id: perf.trade_id || t.id,
    trade_id: perf.trade_id || t.id,
    symbol: perf.symbol || t.symbol,
    direction: perf.direction || t.direction,
    signal_source: perf.signal_source || t.signal_source || null,
    strategy_name: perf.strategy_name || t.strategy_name || null,
    entry_price: t.entry_price != null ? num(t.entry_price) : null,
    exit_price: t.exit_price != null ? num(t.exit_price) : null,
    stop_loss: t.stop_loss != null ? num(t.stop_loss) : null,
    tp1: t.tp1 != null ? num(t.tp1) : null,
    tp2: t.tp2 != null ? num(t.tp2) : null,
    tp3: t.tp3 != null ? num(t.tp3) : null,
    quantity: t.quantity != null ? num(t.quantity) : null,
    gross_profit: num(perf.gross_profit),
    fees: num(perf.fees),
    funding: num(perf.funding),
    net_profit: num(perf.net_profit),
    legacy_pnl: t.pnl != null ? num(t.pnl) : null,
    roi_pct: perf.roi_pct != null ? num(perf.roi_pct) : (t.pnl_percent != null ? num(t.pnl_percent) : null),
    r_multiple: t.r_multiple != null ? num(t.r_multiple) : null,
    win: perf.win === true,
    tp1_hit: perf.tp1_hit || t.tp1_hit,
    tp2_hit: perf.tp2_hit || t.tp2_hit,
    tp3_hit: perf.tp3_hit || t.tp3_hit,
    be_exit: perf.be_exit || t.sl_moved_breakeven,
    sl_exit: perf.sl_exit,
    exchange_synced: perf.exchange_synced === true,
    lifecycle_stage: t.lifecycle_stage || null,
    close_reason: t.close_reason || null,
    status: t.status || 'closed',
    opened_at: perf.opened_at || t.opened_at,
    closed_at: perf.closed_at || t.closed_at,
    source: 'trade_performance',
  };
}

function formatLegacyTrade(t) {
  const pnl = num(t.pnl);
  return {
    id: t.id,
    trade_id: t.id,
    symbol: t.symbol,
    direction: t.direction,
    signal_source: t.signal_source || null,
    strategy_name: t.strategy_name || null,
    entry_price: num(t.entry_price),
    exit_price: t.exit_price != null ? num(t.exit_price) : null,
    stop_loss: num(t.stop_loss),
    tp1: t.tp1 != null ? num(t.tp1) : null,
    tp2: t.tp2 != null ? num(t.tp2) : null,
    tp3: t.tp3 != null ? num(t.tp3) : null,
    quantity: num(t.quantity),
    gross_profit: pnl,
    fees: 0,
    funding: 0,
    net_profit: pnl,
    legacy_pnl: pnl,
    roi_pct: t.pnl_percent != null ? num(t.pnl_percent) : null,
    r_multiple: t.r_multiple != null ? num(t.r_multiple) : null,
    win: pnl > 0,
    tp1_hit: t.tp1_hit,
    tp2_hit: t.tp2_hit,
    tp3_hit: t.tp3_hit,
    be_exit: t.sl_moved_breakeven,
    sl_exit: t.status === 'stopped',
    exchange_synced: false,
    lifecycle_stage: t.lifecycle_stage || null,
    close_reason: t.close_reason || null,
    status: t.status,
    opened_at: t.opened_at,
    closed_at: t.closed_at,
    source: 'legacy_trades',
  };
}

/** All closed trades for one calendar day (DB only — no Binance). */
export async function getTradesByDay(dateStr, tzOffsetMin = 0) {
  const db = getSupabase();
  const { start, end, label } = dayBounds(dateStr, tzOffsetMin);
  const summary = await getTradesTodayStats(dateStr, tzOffsetMin);

  if (!db) {
    return { day: label, summary, trades: [], count: 0 };
  }

  const { data: perfRows } = await db
    .from('trade_performance')
    .select('*')
    .gte('closed_at', start)
    .lt('closed_at', end)
    .order('closed_at', { ascending: false });

  const perf = perfRows || [];
  if (perf.length > 0) {
    const ids = perf.map((r) => r.trade_id).filter(Boolean);
    const { data: tradeRows } = ids.length
      ? await db.from('trades').select('*').in('id', ids)
      : { data: [] };
    const byId = new Map((tradeRows || []).map((t) => [t.id, t]));
    return {
      day: label,
      summary,
      count: perf.length,
      trades: perf.map((p) => formatPerfTrade(p, byId.get(p.trade_id))),
    };
  }

  const { data: legacyRows } = await db
    .from('trades')
    .select('*')
    .gte('closed_at', start)
    .lt('closed_at', end)
    .in('status', ['closed', 'stopped'])
    .order('closed_at', { ascending: false });

  const legacy = legacyRows || [];
  return {
    day: label,
    summary,
    count: legacy.length,
    trades: legacy.map(formatLegacyTrade),
    source: legacy.length ? 'legacy_trades_fallback' : undefined,
  };
}
