/**
 * Local research-platform API when research-api container is offline.
 * Powers E5 backtests, symbol lists, and candle sync via backend Node (16GB heap).
 */
import { randomUUID } from 'crypto';
import { getAllFuturesSymbols } from './binance.js';
import { listStrategies } from '../strategies/registry.js';
import { syncCandlesToDb, getCandleCoverage } from './candleStore.js';
import { getNodeHeapLimitMb } from './systemStats.js';
import { logEvent } from './supabase.js';
import { handleAgentChat, operationsDashboardPayload } from './agentChat.js';

const offlineJobs = new Map();

function parseQuery(path) {
  const idx = path.indexOf('?');
  if (idx < 0) return new URLSearchParams();
  return new URLSearchParams(path.slice(idx + 1));
}

function cleanPath(path) {
  return path.split('?')[0];
}

async function estimateE5Backtest(body = {}) {
  const { estimateBarCount, getWarmupMs } = await import('../strategies/backtestEngine.js');
  const symbols = body.symbols || [];
  const tf = body.timeframe || '15m';
  const startTs = body.start_ts || Date.now() - 365 * 86400000;
  const endTs = body.end_ts || Date.now();
  const warmup = getWarmupMs(tf);
  const barsPerSymbol = estimateBarCount(tf, startTs - warmup, endTs);
  const totalBars = barsPerSymbol * symbols.length;
  const estMinutes = Math.max(1, Math.ceil(totalBars / 4000));
  const heavy = totalBars > 400_000 || symbols.length > 25;

  return {
    symbols: symbols.length,
    timeframe: tf,
    bars_per_symbol: barsPerSymbol,
    total_bars: totalBars,
    estimated_minutes: estMinutes,
    memory_warning: heavy,
    heap_limit_mb: getNodeHeapLimitMb(),
    recommendation: heavy
      ? 'Use ≤15 pairs or shorter date range. Offline mode uses backend Node heap (up to 16 GB).'
      : 'Ready — data loads from Supabase candles DB first.',
    source: 'backend_offline',
  };
}

async function startOfflineBacktest(body = {}) {
  const id = randomUUID();
  const symbols = (body.symbols || ['BTCUSDT']).map((s) => String(s).toUpperCase());
  const tf = body.timeframe || '15m';
  const startTs = body.start_ts || Date.now() - 365 * 86400000;
  const endTs = body.end_ts || Date.now();
  const startDate = new Date(startTs).toISOString().slice(0, 10);
  const endDate = new Date(endTs).toISOString().slice(0, 10);

  offlineJobs.set(id, {
    status: 'running',
    progress_pct: 5,
    symbols,
    results: [],
    started_at: new Date().toISOString(),
  });

  (async () => {
    const { runBacktest } = await import('../strategies/smc-mtf/backtester.js');
    const results = [];
    for (let i = 0; i < symbols.length; i++) {
      const sym = symbols[i];
      const pct = 5 + Math.round((i / symbols.length) * 90);
      offlineJobs.set(id, {
        ...offlineJobs.get(id),
        progress_pct: pct,
        current_symbol: sym,
      });
      try {
        const result = await runBacktest({
          symbol: sym,
          entryTimeframe: tf,
          startDate,
          endDate,
          initialCapital: body.initial_balance || 10000,
          riskPerTrade: body.config?.risk?.risk_pct || 0.01,
        });
        results.push({ symbol: sym, ok: true, ...result });
      } catch (err) {
        results.push({ symbol: sym, ok: false, error: err.message });
        await logEvent('warn', 'researchFallback', `Offline backtest failed ${sym}: ${err.message}`);
      }
    }
    const wins = results.filter((r) => r.ok && (r.netProfitPercent ?? 0) > 0).length;
    offlineJobs.set(id, {
      status: 'completed',
      progress_pct: 100,
      symbols,
      results,
      metrics: {
        pairs: symbols.length,
        completed: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        wins,
      },
      completed_at: new Date().toISOString(),
    });
  })().catch((err) => {
    offlineJobs.set(id, { status: 'failed', progress_pct: 100, error: err.message });
  });

  return {
    backtest_id: id,
    status: 'running',
    progress_pct: 5,
    source: 'backend_offline',
    mode: body.mode || 'e5',
  };
}

async function syncBatch(body = {}) {
  const symbols = (body.symbols || []).slice(0, 50);
  const timeframes = body.timeframes || ['15m'];
  const endMs = Date.now();
  const startMs = endMs - 365 * 86400000;
  let started = 0;
  let failed = 0;

  for (const sym of symbols) {
    for (const tf of timeframes) {
      try {
        await syncCandlesToDb(sym, tf, startMs, endMs, { full: Boolean(body.full) });
        started++;
      } catch {
        failed++;
      }
    }
  }

  return { started, failed, symbols, timeframes, source: 'backend_offline' };
}

export async function handleResearchFallback(method, path, body) {
  const p = cleanPath(path);
  const q = parseQuery(path);

  if (method === 'GET' && p === '/health') {
    return {
      status: 'ok',
      source: 'backend_offline',
      checks: { database: 'via_trading_api', redis: 'skipped', parquet: 'supabase_candles' },
    };
  }

  if (method === 'GET' && p === '/symbols/futures/top') {
    const limit = parseInt(q.get('limit') || '50', 10);
    const all = await getAllFuturesSymbols();
    const symbols = all.slice(0, limit);
    return { symbols, count: symbols.length, source: 'binance' };
  }

  if (method === 'GET' && p === '/strategies/registry') {
    const native = listStrategies().map((s) => ({
      id: s.id,
      name: s.name,
      version: '1',
      engine: s.engine || 'native',
      description: s.description || '',
    }));
    return {
      strategies: [
        { id: 'E5_INSTITUTIONAL_V1', name: 'E5 Institutional (SMC-MTF offline)', version: '1', engine: 'smc-mtf', description: 'Runs via backend when research-api offline' },
        ...native,
      ],
    };
  }

  if (method === 'POST' && p === '/sync/batch') {
    return syncBatch(body);
  }

  if (method === 'POST' && p === '/backtest/estimate') {
    return estimateE5Backtest(body);
  }

  if (method === 'POST' && p === '/backtest/start') {
    const est = await estimateE5Backtest(body);
    if (est.memory_warning && !body.force) {
      const err = new Error('Backtest estimate exceeds safe offline limits — confirm in dashboard or set force:true');
      err.code = 'ESTIMATE_CONFIRM_REQUIRED';
      err.estimate = est;
      throw err;
    }
    return startOfflineBacktest(body);
  }

  if (method === 'GET' && p === '/backtest/status') {
    const id = q.get('backtest_id');
    const job = offlineJobs.get(id);
    if (!job) return { backtest_id: id, status: 'unknown', progress_pct: 0 };
    return { backtest_id: id, ...job };
  }

  if (method === 'GET' && p === '/backtest/results') {
    const id = q.get('backtest_id');
    const job = offlineJobs.get(id);
    if (!job) throw new Error('Backtest not found');
    return { backtest_id: id, status: job.status, metrics: job.metrics, results: job.results };
  }

  if (method === 'GET' && p === '/dataset/status') {
    const sym = (q.get('symbol') || 'BTCUSDT').toUpperCase();
    const tf = q.get('timeframe') || '15m';
    const endMs = Date.now();
    const startMs = endMs - 365 * 86400000;
    const coverage = await getCandleCoverage(sym, tf, startMs, endMs);
    return { coverage, source: 'supabase' };
  }

  if (method === 'POST' && p === '/agent/chat') {
    return handleAgentChat(body);
  }

  if (method === 'GET' && p === '/operations/dashboard') {
    return operationsDashboardPayload();
  }

  throw new Error(`Research offline fallback: ${method} ${p} not implemented`);
}
