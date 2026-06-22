/**
 * Scanner symbol universe — institutional v2 scans only market-data coins (default 200),
 * not all 500+ Binance USDT perpetuals.
 */
import { getMarketDataUniverse, getDownloadQueueSymbols, isMarketDataConfigured } from './marketDataClient.js';
import { SIGNAL_ENGINE_INSTITUTIONAL } from './signalEngineSelector.js';

const CACHE_TTL_MS = parseInt(process.env.SCANNER_UNIVERSE_CACHE_MS || '300000', 10);
let cache = { key: '', symbols: [], meta: {}, fetchedAt: 0 };

export function scannerMaxPairs(engineId = SIGNAL_ENGINE_INSTITUTIONAL) {
  const defaultLimit = 200;
  return parseInt(
    process.env.SCANNER_MAX_PAIRS || process.env.MARKET_DATA_UNIVERSE_SIZE || String(defaultLimit),
    10,
  );
}

/**
 * Resolve ranked scan list for the active engine.
 * Institutional: top-N market-data universe (downloaded OHLCV cohort).
 * Readiness is checked per batch inside marketScanner (lightweight).
 */
export async function getScannerSymbolUniverse(engineId) {
  const limit = scannerMaxPairs(engineId);
  const cacheKey = `${engineId}:${limit}`;
  const now = Date.now();

  if (cache.key === cacheKey && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { symbols: [...cache.symbols], meta: { ...cache.meta, cached: true } };
  }

  let symbols = [];
  let meta = { limit, engine: engineId, source: 'unknown' };

  if (engineId === SIGNAL_ENGINE_INSTITUTIONAL) {
    if (isMarketDataConfigured()) {
      try {
        const queued = await getDownloadQueueSymbols(limit);
        if ((queued.symbols || []).length >= 10) {
          symbols = queued.symbols;
          meta = {
            limit,
            engine: engineId,
            source: queued.source || 'download_queue',
            target_size: queued.target_size || limit,
            count: symbols.length,
            global_status: queued.global_status,
            global_pct: queued.global_pct,
          };
        } else {
          const uni = await getMarketDataUniverse(limit);
          symbols = (uni.symbols || []).map((s) => String(s).toUpperCase()).filter(Boolean);
          meta = {
            limit,
            engine: engineId,
            source: 'market_data_universe',
            target_size: uni.target_size || limit,
            count: symbols.length,
          };
        }
      } catch (err) {
        console.warn(`[ScannerUniverse] Market data universe failed: ${err.message}`);
        symbols = [];
        meta = { limit, engine: engineId, source: 'unavailable', error: err.message };
      }
    } else {
      symbols = [];
      meta = { limit, engine: engineId, source: 'research_api_not_configured' };
    }
  } else {
    symbols = [];
    meta = { limit, engine: engineId, source: 'legacy_engine_disabled' };
  }

  cache = { key: cacheKey, symbols, meta, fetchedAt: now };
  return { symbols: [...symbols], meta };
}

export function clearScannerUniverseCache() {
  cache = { key: '', symbols: [], meta: {}, fetchedAt: 0 };
}
