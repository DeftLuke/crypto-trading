/**
 * Market data client — local Parquet via research-api (Binance Vision archives).
 * Raw OHLCV is NOT stored in Supabase (500 MB free tier limit).
 */
import { config } from '../config/index.js';

function baseUrl() {
  return (config.researchApiUrl || config.institutionalSmc?.researchApiUrl || '').replace(/\/$/, '');
}

export function isMarketDataConfigured() {
  return Boolean(baseUrl());
}

async function mdFetch(path, opts = {}) {
  const base = baseUrl();
  if (!base) throw new Error('RESEARCH_API_URL not configured for market data');
  const res = await fetch(`${base}/api/v1/market-data${path}`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    signal: opts.signal || AbortSignal.timeout(parseInt(process.env.MARKET_DATA_TIMEOUT_MS || '120000', 10)),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    throw new Error(data.detail || data.error || data.message || `HTTP ${res.status}`);
  }
  return data;
}

export async function getMtfMarketDataStatus(symbol, timeframes) {
  return mdFetch('/status/mtf', {
    method: 'POST',
    body: JSON.stringify({ symbol: symbol.toUpperCase(), timeframes }),
  });
}

export async function ensureMarketData(symbol, timeframes, { monthsBack } = {}) {
  return mdFetch('/ensure', {
    method: 'POST',
    body: JSON.stringify({
      symbol: symbol.toUpperCase(),
      timeframes,
      months_back: monthsBack ?? null,
    }),
  });
}

export async function appendMarketDataBar(symbol, timeframe, candle) {
  return mdFetch('/candles/append', {
    method: 'POST',
    body: JSON.stringify({
      symbol: symbol.toUpperCase(),
      timeframe,
      ts: candle.time * 1000,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }),
  });
}

export async function getMarketDataHealth() {
  return mdFetch('/health');
}

export async function getMarketDataProgress() {
  return mdFetch('/jobs/progress');
}

/** Top N USDT perpetuals in the market-data download universe (default 200). */
export async function getMarketDataUniverse(limit = 200) {
  const n = Math.max(1, parseInt(String(limit), 10) || 200);
  return mdFetch(`/universe?limit=${n}`);
}

/** Symbols from phased download queue (downloaded OHLCV cohort). */
export async function getDownloadQueueSymbols(limit = 200) {
  const progress = await getMarketDataProgress();
  const symbols = [];
  const seen = new Set();

  for (const phase of progress.phases || []) {
    for (const sym of phase.symbols || []) {
      const s = String(sym).toUpperCase();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      symbols.push(s);
    }
    for (const [sym, sp] of Object.entries(phase.symbol_progress || {})) {
      const s = String(sym).toUpperCase();
      if (!s || seen.has(s)) continue;
      if (sp?.status === 'complete' || (sp?.overall_pct ?? 0) >= 99) {
        seen.add(s);
        symbols.push(s);
      }
    }
  }

  const n = Math.max(1, parseInt(String(limit), 10) || 200);
  return {
    symbols: symbols.slice(0, n),
    count: Math.min(symbols.length, n),
    target_size: progress.universe_size || n,
    source: 'download_queue',
    global_status: progress.global_status,
    global_pct: progress.global_pct,
  };
}
