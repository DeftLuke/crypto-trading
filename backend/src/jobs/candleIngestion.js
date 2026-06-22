/**
 * Candle ingestion — WebSocket live updates + Binance Vision archive backfill.
 * Raw OHLCV stored on disk (Parquet) via research-api — not Supabase. */
import { config } from '../config/index.js';
import { binanceWs } from '../services/binanceWs.js';
import {
  INSTITUTIONAL_MTF,
  ensureMtfCandles,
  upsertCandleBar,
  getMtfCandleStatus,
} from '../services/candleStore.js';
import { logEvent } from '../services/supabase.js';

const WS_TIMEFRAMES = (process.env.CANDLE_WS_TIMEFRAMES || '15m,1h').split(',').map((s) => s.trim()).filter(Boolean);
const BACKFILL_DELAY_MS = parseInt(process.env.CANDLE_BACKFILL_DELAY_MS || '800', 10);
const BACKFILL_CONCURRENCY = parseInt(process.env.CANDLE_BACKFILL_CONCURRENCY || '1', 10);
const USE_MARKET_DATA_QUEUE = process.env.MARKET_DATA_ENABLED !== 'false'
  && process.env.CANDLE_BACKFILL_ENABLED !== 'true'
  && process.env.MARKET_DATA_AUTO_DOWNLOAD !== 'false';

let started = false;
let backfillRunning = false;
const subscribed = new Set();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function watchlistSymbols(extra = []) {
  const set = new Set([
    ...config.topPairs,
    ...(extra || []),
  ].map((s) => String(s || '').toUpperCase()).filter(Boolean));
  return [...set];
}

function subscribeLiveKlines(symbols) {
  for (const symbol of symbols) {
    for (const tf of WS_TIMEFRAMES) {
      const key = `${symbol}:${tf}`;
      if (subscribed.has(key)) continue;
      subscribed.add(key);

      binanceWs.subscribeKline(symbol, tf, async (candle) => {
        if (!candle?.isClosed) return;
        try {
          await upsertCandleBar(symbol, tf, candle);
        } catch (err) {
          console.warn(`[CandleIngest] WS upsert ${symbol} ${tf}: ${err.message}`);
        }
      });
    }
  }
}

async function backfillSymbol(symbol) {
  try {
    const result = await ensureMtfCandles(symbol, INSTITUTIONAL_MTF);
    const failed = Object.entries(result).filter(([, v]) => String(v).startsWith('error'));
    if (failed.length) {
      console.warn(`[CandleIngest] Partial backfill ${symbol}:`, result);
    }
    return result;
  } catch (err) {
    console.warn(`[CandleIngest] Backfill failed ${symbol}: ${err.message}`);
    return { error: err.message };
  }
}

async function runBackfillQueue(symbols) {
  if (backfillRunning) return;
  backfillRunning = true;
  console.log(`[CandleIngest] Backfill starting — ${symbols.length} symbols, TFs=${INSTITUTIONAL_MTF.join(',')}`);

  try {
    for (let i = 0; i < symbols.length; i += BACKFILL_CONCURRENCY) {
      const chunk = symbols.slice(i, i + BACKFILL_CONCURRENCY);
      await Promise.all(chunk.map((sym) => backfillSymbol(sym)));
      await sleep(BACKFILL_DELAY_MS);
    }
    await logEvent('info', 'candleIngestion', 'MTF backfill complete', {
      symbols: symbols.length,
      timeframes: INSTITUTIONAL_MTF,
    });
  } finally {
    backfillRunning = false;
  }
}

export function startCandleIngestion(extraSymbols = []) {
  if (started) return;
  if (process.env.CANDLE_INGESTION_ENABLED === 'false') {
    console.log('[CandleIngest] Disabled (CANDLE_INGESTION_ENABLED=false)');
    return;
  }

  started = true;
  const symbols = watchlistSymbols(extraSymbols);
  subscribeLiveKlines(symbols);

  if (USE_MARKET_DATA_QUEUE) {
    console.log('[CandleIngest] Archive backfill deferred to research-api download queue (WS only here)');
  } else {
    setTimeout(() => {
      runBackfillQueue(symbols).catch((err) => {
        console.error('[CandleIngest] Backfill queue error:', err.message);
      });
    }, 5000);
  }

  console.log(`[CandleIngest] Live WS on ${WS_TIMEFRAMES.join(',')} for ${symbols.length} symbols`);
}

/** Ensure a symbol has MTF data before scanner batch (non-blocking sync if missing). */
export async function prepareSymbolForAnalyze(symbol) {
  const status = await getMtfCandleStatus(symbol);
  if (status.ready) return status;
  await ensureMtfCandles(symbol, INSTITUTIONAL_MTF);
  return getMtfCandleStatus(symbol);
}

/** Filter batch to symbols with sufficient stored candles. */
export async function filterReadySymbols(symbols) {
  const ready = [];
  const pending = [];

  for (const sym of symbols) {
    const status = await getMtfCandleStatus(sym);
    if (status.ready) {
      ready.push(sym);
    } else {
      pending.push(sym);
      if (!USE_MARKET_DATA_QUEUE) {
        ensureMtfCandles(sym, INSTITUTIONAL_MTF).catch(() => {});
      }
    }
  }

  return { ready, pending };
}

export function getCandleIngestionStatus() {
  return {
    started,
    backfillRunning,
    wsTimeframes: WS_TIMEFRAMES,
    mtfTimeframes: INSTITUTIONAL_MTF,
    subscribedStreams: subscribed.size,
    ws: binanceWs.getStatus(),
  };
}
