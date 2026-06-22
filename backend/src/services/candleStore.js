/**
 * OHLCV access — institutional path uses local Parquet via research-api (Binance Vision).
 * Legacy Supabase/REST path kept for backtests when MARKET_DATA_ENABLED=false.
 */
import { config } from '../config/index.js';
import { getSupabase, logEvent } from './supabase.js';
import { getKlines, parseKlines } from './binance.js';
import {
  isMarketDataConfigured,
  getMtfMarketDataStatus,
  ensureMarketData,
  appendMarketDataBar,
} from './marketDataClient.js';
const TF_MAP = { '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d' };

export const INSTITUTIONAL_MTF = ['1d', '4h', '1h', '15m'];

export const INSTITUTIONAL_MIN_BARS = {
  '1d': 120,
  '4h': 200,
  '1h': 300,
  '15m': 400,
};

const USE_MARKET_DATA = process.env.MARKET_DATA_ENABLED !== 'false';

const EXCHANGE = 'binance';
const PAGE_SIZE = 1000;
const UPSERT_BATCH = 500;

function intervalToMs(interval) {
  const map = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000,
  };
  return map[interval] || 300000;
}

function normalizeTf(interval) {
  return TF_MAP[interval] || interval;
}

function dbRowToCandle(row) {
  const tsMs = Number(row.ts);
  return {
    time: Math.floor(tsMs / 1000),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

function candleToDbRow(symbol, timeframe, candle) {
  return {
    exchange: EXCHANGE,
    symbol: symbol.toUpperCase(),
    timeframe: normalizeTf(timeframe),
    ts: candle.time * 1000,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

async function loadPageFromDb(db, symbol, timeframe, startMs, endMs, offset) {
  const { data, error } = await db
    .from('candles')
    .select('ts, open, high, low, close, volume')
    .eq('exchange', EXCHANGE)
    .eq('symbol', symbol.toUpperCase())
    .eq('timeframe', normalizeTf(timeframe))
    .gte('ts', startMs)
    .lte('ts', endMs)
    .order('ts', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) throw new Error(`Candle DB read failed: ${error.message}`);
  return data || [];
}

export async function loadCandlesFromDb(symbol, timeframe, startMs, endMs) {
  const db = getSupabase();
  if (!db) return [];

  const all = [];
  let offset = 0;
  while (true) {
    const page = await loadPageFromDb(db, symbol, timeframe, startMs, endMs, offset);
    if (!page.length) break;
    all.push(...page.map(dbRowToCandle));
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

async function upsertCandles(rows) {
  const db = getSupabase();
  if (!db || !rows.length) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await db
      .from('candles')
      .upsert(batch, { onConflict: 'exchange,symbol,timeframe,ts', ignoreDuplicates: true });
    if (error) throw new Error(`Candle DB write failed: ${error.message}`);
    inserted += batch.length;
  }
  return inserted;
}

async function updateMarketMetadata(symbol, timeframe, candles) {
  const db = getSupabase();
  if (!db || !candles.length) return;

  const tf = normalizeTf(timeframe);
  const sym = symbol.toUpperCase();
  const firstTs = candles[0].time * 1000;
  const lastTs = candles[candles.length - 1].time * 1000;

  const { count } = await db
    .from('candles')
    .select('*', { count: 'exact', head: true })
    .eq('exchange', EXCHANGE)
    .eq('symbol', sym)
    .eq('timeframe', tf);

  await db.from('market_metadata').upsert({
    exchange: EXCHANGE,
    symbol: sym,
    timeframe: tf,
    first_ts: firstTs,
    last_ts: lastTs,
    candle_count: count || candles.length,
    last_sync_at: new Date().toISOString(),
    parquet_path: `supabase://${sym}/${tf}`,
  }, { onConflict: 'exchange,symbol,timeframe' });
}

async function syncViaResearchApi(symbol, timeframe, full = false) {
  const base = (config.researchApiUrl || '').replace(/\/$/, '');
  if (!base) return false;

  try {
    const res = await fetch(`${base}/sync/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        exchange: EXCHANGE,
        symbol: symbol.toUpperCase(),
        timeframe: normalizeTf(timeframe),
        full,
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return false;
    await logEvent('info', 'candleStore', `Research sync triggered for ${symbol} ${timeframe}`, { full });
    return true;
  } catch {
    return false;
  }
}

async function downloadFromBinance(symbol, timeframe, startMs, endMs) {
  const tf = normalizeTf(timeframe);
  const intervalMs = intervalToMs(tf);
  const limit = 1500;
  const maxBars = parseInt(process.env.BACKTEST_MAX_BARS || '120000', 10);
  const all = [];
  let start = startMs;

  try {
    while (start < endMs && all.length < maxBars) {
      const raw = await getKlines(symbol.toUpperCase(), tf, limit, start);
      if (!raw?.length) break;

      const batch = parseKlines(raw);
      all.push(...batch);

      const lastTime = raw[raw.length - 1][0];
      if (lastTime >= endMs || raw.length < limit) break;
      start = lastTime + intervalMs;

      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (err) {
    if (all.length > 0) {
      console.warn(`[CandleStore] Partial download ${symbol} ${tf}: ${err.message}`);
      return dedupeCandles(all, startMs, endMs);
    }
    if (String(err.message).includes('Too many requests')) {
      throw new Error(
        'Binance rate limit during candle sync. Wait 2–3 minutes and retry — after first sync, backtests read from DB only.',
      );
    }
    throw err;
  }

  return dedupeCandles(all, startMs, endMs);
}

function dedupeCandles(all, startMs, endMs) {
  const unique = new Map();
  for (const c of all) {
    const tsMs = c.time * 1000;
    if (tsMs >= startMs && tsMs <= endMs) unique.set(c.time, c);
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

export async function syncCandlesToDb(symbol, timeframe, startMs, endMs, { full = false } = {}) {
  const sym = symbol.toUpperCase();
  const tf = normalizeTf(timeframe);

  const viaResearch = await syncViaResearchApi(sym, tf, full);
  if (viaResearch) {
    await new Promise((r) => setTimeout(r, 2000));
    const loaded = await loadCandlesFromDb(sym, tf, startMs, endMs);
    if (loaded.length > 0) return loaded;
  }

  console.log(`[CandleStore] Downloading ${sym} ${tf} → DB (${new Date(startMs).toISOString()} … ${new Date(endMs).toISOString()})`);
  const candles = await downloadFromBinance(sym, tf, startMs, endMs);
  if (!candles.length) {
    throw new Error(`No candle data returned for ${sym} ${tf}`);
  }

  const rows = candles.map((c) => candleToDbRow(sym, tf, c));
  await upsertCandles(rows);
  await updateMarketMetadata(sym, tf, candles);
  await logEvent('info', 'candleStore', `Synced ${candles.length} candles`, { symbol: sym, timeframe: tf });

  return candles;
}

function expectedBarCount(timeframe, startMs, endMs) {
  return Math.ceil((endMs - startMs) / intervalToMs(normalizeTf(timeframe)));
}

/**
 * Load OHLCV for backtest — DB first, one-time sync if coverage is low.
 */
export async function fetchHistoricalCandlesFromStore(symbol, timeframe, startTime, endTime) {
  const sym = symbol.toUpperCase();
  const tf = normalizeTf(timeframe);
  const startMs = startTime;
  const endMs = endTime;
  const expected = expectedBarCount(tf, startMs, endMs);
  const minRequired = Math.max(50, Math.floor(expected * 0.85));

  let candles = await loadCandlesFromDb(sym, tf, startMs, endMs);

  if (candles.length < minRequired) {
    const full = candles.length === 0;
    candles = await syncCandlesToDb(sym, tf, startMs, endMs, { full });
    if (candles.length < minRequired) {
      candles = await loadCandlesFromDb(sym, tf, startMs, endMs);
    }
  }

  if (candles.length < 50) {
    throw new Error(
      `Insufficient ${sym} ${tf} data in DB (${candles.length} bars, need ~${minRequired}). ` +
      'Candle sync failed or period too long — try 1M or check Binance connectivity.',
    );
  }

  console.log(`[CandleStore] ${sym} ${tf}: ${candles.length} bars from DB (expected ~${expected})`);
  return candles;
}

export async function getCandleCoverage(symbol, timeframe, startTime, endTime) {
  const sym = symbol.toUpperCase();
  const tf = normalizeTf(timeframe);
  const expected = expectedBarCount(tf, startTime, endTime);
  const candles = await loadCandlesFromDb(sym, tf, startTime, endTime);
  return {
    symbol: sym,
    timeframe: tf,
    barsInDb: candles.length,
    expectedBars: expected,
    coveragePct: expected > 0 ? Math.round((candles.length / expected) * 100) : 0,
    sufficient: candles.length >= Math.max(50, Math.floor(expected * 0.85)),
  };
}

/** Last N bars from Supabase (newest window for SMC analyze). */
export async function loadRecentCandlesFromDb(symbol, timeframe, limit = 500) {
  const db = getSupabase();
  if (!db) return [];

  const sym = symbol.toUpperCase();
  const tf = normalizeTf(timeframe);
  const { data, error } = await db
    .from('candles')
    .select('ts, open, high, low, close, volume')
    .eq('exchange', EXCHANGE)
    .eq('symbol', sym)
    .eq('timeframe', tf)
    .order('ts', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Candle DB read failed: ${error.message}`);
  if (!data?.length) return [];

  return data
    .slice()
    .reverse()
    .map((row) => dbRowToCandle(row));
}

/** Single closed bar from WebSocket → local Parquet (not Supabase). */
export async function upsertCandleBar(symbol, timeframe, candle) {
  if (USE_MARKET_DATA && isMarketDataConfigured()) {
    await appendMarketDataBar(symbol, timeframe, candle);
    return;
  }
  const row = candleToDbRow(symbol, timeframe, candle);
  await upsertCandles([row]);
}

/** Freshness for institutional MTF — reads local Parquet status via research-api. */
export async function getMtfCandleStatus(symbol, timeframes = INSTITUTIONAL_MTF) {
  const sym = symbol.toUpperCase();
  if (USE_MARKET_DATA && isMarketDataConfigured()) {
    try {
      return await getMtfMarketDataStatus(sym, timeframes);
    } catch (err) {
      console.warn(`[CandleStore] Market data status failed ${sym}: ${err.message}`);
      return { symbol: sym, ready: false, timeframes: {}, error: err.message };
    }
  }

  const byTf = {};
  let ready = true;
  for (const tf of timeframes) {
    const minBars = INSTITUTIONAL_MIN_BARS[tf] || 100;
    const bars = await loadRecentCandlesFromDb(sym, tf, minBars + 5);
    const lastTs = bars.length ? bars[bars.length - 1].time * 1000 : null;
    const maxAge = intervalToMs(tf) * 3;
    const fresh = lastTs != null && (Date.now() - lastTs) < maxAge;
    const sufficient = bars.length >= minBars;
    byTf[tf] = { bars: bars.length, minBars, fresh, sufficient, lastTs };
    if (!sufficient || !fresh) ready = false;
  }
  return { symbol: sym, ready, timeframes: byTf };
}

/**
 * Backfill MTF via Binance Vision archives (preferred) or legacy REST→Supabase.
 */
export async function ensureMtfCandles(symbol, timeframes = INSTITUTIONAL_MTF) {
  const sym = symbol.toUpperCase();

  if (USE_MARKET_DATA && isMarketDataConfigured()) {
    try {
      const result = await ensureMarketData(sym, timeframes);
      await logEvent('info', 'candleStore', `Archive ensure ${sym}`, { timeframes });
      const out = {};
      for (const tf of timeframes) {
        const r = result.results?.[tf];
        out[tf] = r?.action === 'ok' ? 'ok' : (r?.download ? 'archived' : 'pending');
      }
      return out;
    } catch (err) {
      await logEvent('warn', 'candleStore', `Archive ensure failed ${sym}`, { error: err.message });
      const out = {};
      for (const tf of timeframes) out[tf] = `error:${err.message}`;
      return out;
    }
  }

  const now = Date.now();
  const results = {};
  for (const tf of timeframes) {
    const minBars = INSTITUTIONAL_MIN_BARS[tf] || 100;
    const existing = await loadRecentCandlesFromDb(sym, tf, minBars + 5);
    const lastTs = existing.length ? existing[existing.length - 1].time * 1000 : null;
    const fresh = lastTs != null && (Date.now() - lastTs) < intervalToMs(tf) * 3;

    if (existing.length >= minBars && fresh) {
      results[tf] = 'ok';
      continue;
    }

    const startMs = now - Math.ceil(minBars * intervalToMs(tf) * 1.15);
    try {
      await syncCandlesToDb(sym, tf, startMs, now, { full: existing.length === 0 });
      results[tf] = 'synced';
      await logEvent('info', 'candleStore', `MTF synced ${sym} ${tf}`, { minBars });
    } catch (err) {
      results[tf] = `error:${err.message}`;
      await logEvent('warn', 'candleStore', `MTF sync failed ${sym} ${tf}`, { error: err.message });
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return results;
}
