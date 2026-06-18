import { getSupabase } from './supabase.js';
import { getStrategy, listStrategies } from '../strategies/registry.js';

let cachedProductionId = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

/** Composite score for ranking backtests (higher = better). */
export function computeBacktestScore(row = {}) {
  const wr = Number(row.win_rate) || 0;
  const pf = Math.min(Math.max(Number(row.profit_factor) || 0, 0), 4);
  const sharpe = Math.min(Math.max(Number(row.sharpe) || 0, 0), 4);
  const ret = Math.min(Math.max(Number(row.return_pct) || 0, 0), 5000);
  const dd = Math.min(Math.max(Number(row.max_drawdown) || 0, 0), 100);
  const psr = Math.min(Math.max(Number(row.psr) || 0, 0), 100);

  if (wr > 0 || Number(row.total_trades) > 0) {
    return Math.round(wr * 0.3 + (pf / 4) * 25 + (sharpe / 4) * 25 + (ret / 500) * 15 - dd * 0.25, 2);
  }

  return Math.round((ret / 100) + sharpe * 8 + psr * 0.15 - dd * 0.2, 2);
}

export async function ensureStrategyCatalog() {
  const db = getSupabase();
  if (!db) return;

  const natives = listStrategies().filter((s) => s.id !== 'freqtrade');
  for (const s of natives) {
    await db.from('strategy_catalog').upsert({
      id: s.id,
      name: s.name,
      description: s.description || '',
      source: 'native',
      engine: s.engine || 'native',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id', ignoreDuplicates: false });
  }
}

export async function listCatalog() {
  await ensureStrategyCatalog();
  const db = getSupabase();
  if (!db) return listStrategies().map((s) => ({ ...s, status: s.id === 'smc-mtf' ? 'production' : 'draft' }));

  const { data } = await db.from('strategy_catalog').select('*').order('updated_at', { ascending: false });
  return data || [];
}

export async function registerStrategy(entry) {
  const db = getSupabase();
  if (!db) throw new Error('Database not configured');

  const id = String(entry.id || entry.strategy_id).trim().toLowerCase().replace(/\s+/g, '-');
  if (!id) throw new Error('strategy id required');

  const row = {
    id,
    name: entry.name || id,
    description: entry.description || '',
    source: entry.source || 'custom',
    engine: entry.engine || 'external',
    status: entry.status || 'draft',
    external_project_id: entry.external_project_id || entry.qc_project_id || null,
    symbols: entry.symbols || [],
    config_json: entry.config_json || {},
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db.from('strategy_catalog').upsert(row, { onConflict: 'id' }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function saveBacktestResult(payload) {
  const db = getSupabase();
  if (!db) throw new Error('Database not configured');

  const strategyId = payload.strategy_id || payload.strategyId || 'unknown';
  await registerStrategy({
    id: strategyId,
    name: payload.strategy_name || payload.name || strategyId,
    source: payload.source || 'native',
    external_project_id: payload.external_project_id || payload.qc_project_id,
    description: payload.description || '',
    status: 'candidate',
  }).catch(() => {});

  const row = {
    strategy_id: strategyId,
    symbol: payload.symbol || 'MULTI',
    timeframe: payload.timeframe || '—',
    start_date: payload.start_date || payload.startDate || null,
    end_date: payload.end_date || payload.endDate || null,
    total_trades: payload.total_trades ?? payload.totalTrades ?? 0,
    wins: payload.wins ?? 0,
    losses: payload.losses ?? 0,
    win_rate: payload.win_rate ?? payload.winRate ?? 0,
    profit_factor: payload.profit_factor ?? payload.profitFactor ?? 0,
    total_pnl: payload.total_pnl ?? payload.net_profit ?? payload.totalPnl ?? 0,
    max_drawdown: payload.max_drawdown ?? payload.maxDrawdown ?? payload.max_drawdown_pct ?? 0,
    avg_r_multiple: payload.avg_r_multiple ?? payload.avgRMultiple ?? 0,
    source: payload.source || 'native',
    run_name: payload.run_name || payload.name || null,
    return_pct: payload.return_pct ?? payload.returnPct ?? null,
    sharpe: payload.sharpe ?? null,
    psr: payload.psr ?? null,
    external_project_id: payload.external_project_id || payload.qc_project_id || null,
    results: payload.results || payload.raw || {},
  };
  row.score = computeBacktestScore(row);

  const { data, error } = await db.from('backtest_runs').insert(row).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getBacktestRankings(limit = 30) {
  const db = getSupabase();
  if (!db) return [];

  const { data } = await db
    .from('backtest_runs')
    .select('*')
    .order('score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  return data || [];
}

export async function getActiveScannerStrategyId() {
  const fromEnv = process.env.SCANNER_STRATEGY_ID;
  if (fromEnv && getStrategy(fromEnv)) return fromEnv;

  const now = Date.now();
  if (cachedProductionId && now - cacheAt < CACHE_MS) return cachedProductionId;

  const db = getSupabase();
  if (db) {
    const { data } = await db
      .from('strategy_catalog')
      .select('id')
      .eq('status', 'production')
      .eq('engine', 'native')
      .limit(1)
      .maybeSingle();

    if (data?.id && getStrategy(data.id)) {
      cachedProductionId = data.id;
      cacheAt = now;
      return data.id;
    }
  }

  cachedProductionId = 'smc-mtf';
  cacheAt = now;
  return cachedProductionId;
}

export async function promoteStrategy(strategyId, actor = 'dashboard') {
  const db = getSupabase();
  if (!db) throw new Error('Database not configured');

  const id = String(strategyId).trim();
  const native = Boolean(getStrategy(id));

  if (native) {
    await db.from('strategy_catalog').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('status', 'production');
    const { data, error } = await db
      .from('strategy_catalog')
      .upsert({
        id,
        name: getStrategy(id)?.name || id,
        source: 'native',
        engine: 'native',
        status: 'production',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await db.from('backtest_runs').update({ promoted: false }).eq('promoted', true);

    const { data: topRun } = await db
      .from('backtest_runs')
      .select('id')
      .eq('strategy_id', id)
      .order('score', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (topRun?.id) {
      await db.from('backtest_runs').update({ promoted: true }).eq('id', topRun.id);
    }

    cachedProductionId = id;
    cacheAt = Date.now();

    return {
      ok: true,
      strategy_id: id,
      status: 'production',
      message: `${id} is now the live scanner strategy`,
      actor,
    };
  }

  const { data, error } = await db
    .from('strategy_catalog')
    .upsert({
      id,
      status: 'candidate',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw new Error(error.message);

  return {
    ok: true,
    strategy_id: id,
    status: 'candidate',
    message: 'QuantConnect/external strategy saved as candidate. Port logic to a native strategy before live scanner deployment.',
    actor,
  };
}
