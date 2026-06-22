/**
 * Compact OHLCV status — archive backfill progress + live WS candle sync health.
 */
import {
  getMarketDataProgress,
  getMtfMarketDataStatus,
  isMarketDataConfigured,
} from './marketDataClient.js';

const SAMPLE_SYMBOLS = (process.env.CANDLE_SYNC_SAMPLE_SYMBOLS || 'BTCUSDT,ETHUSDT')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const LIVE_TFS = (process.env.CANDLE_WS_TIMEFRAMES || '15m,1h')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function countArchiveReady(progress) {
  let ready = 0;
  let total = 0;
  for (const phase of progress?.phases || []) {
    for (const sp of Object.values(phase.symbol_progress || {})) {
      total += 1;
      if (sp?.status === 'complete' || sp?.status === 'skipped' || (sp?.overall_pct ?? 0) >= 99) {
        ready += 1;
      }
    }
  }
  return { ready, total: total || progress?.universe_size || 0 };
}

function sanitizeLastError(err) {
  const msg = String(err || '').trim();
  if (!msg) return '';
  if (/BSBUSDT/i.test(msg) && /context manager|404|no_archives|blacklist/i.test(msg)) return '';
  return msg;
}

export async function getCandleSyncStatus() {
  const { getCandleIngestionStatus } = await import('../jobs/candleIngestion.js');
  const ingestion = getCandleIngestionStatus();
  const ws = ingestion.ws || {};

  let archives = {
    configured: isMarketDataConfigured(),
    global_pct: 0,
    global_status: 'idle',
    current_phase: 0,
    total_phases: 0,
    universe_size: 0,
    ready_symbols: 0,
    total_symbols: 0,
    paused: false,
    auto_download: false,
    last_error: '',
  };

  if (archives.configured) {
    try {
      const progress = await getMarketDataProgress();
      const counts = countArchiveReady(progress);
      archives = {
        configured: true,
        global_pct: progress.global_pct ?? 0,
        global_status: progress.global_status || 'idle',
        current_phase: progress.current_phase ?? 0,
        total_phases: progress.total_phases ?? 0,
        universe_size: progress.universe_size ?? counts.total,
        ready_symbols: counts.ready,
        total_symbols: counts.total,
        paused: Boolean(progress.paused),
        auto_download: Boolean(progress.auto_download),
        last_error: sanitizeLastError(progress.last_error),
      };
    } catch (err) {
      archives.last_error = err.message;
      archives.global_status = 'error';
    }
  }

  const live = {
    started: Boolean(ingestion.started),
    ws_connected: Boolean(ws.connected),
    ws_streams: ws.streams ?? 0,
    subscribed: ingestion.subscribedStreams ?? 0,
    ws_timeframes: ingestion.wsTimeframes || LIVE_TFS,
    sample_symbols: SAMPLE_SYMBOLS,
    fresh_pairs: 0,
    checked_pairs: 0,
    ok: false,
    message: '',
  };

  if (!live.started) {
    live.message = 'Candle ingestion not started';
  } else if (!live.ws_connected) {
    live.message = 'WebSocket reconnecting — live candles paused';
  } else if (!archives.configured) {
    live.ok = true;
    live.message = 'WS connected (market-data API not configured)';
  } else {
    let apiErrors = 0;
    for (const symbol of SAMPLE_SYMBOLS) {
      try {
        const st = await getMtfMarketDataStatus(symbol, LIVE_TFS);
        for (const tf of LIVE_TFS) {
          live.checked_pairs += 1;
          if (st?.timeframes?.[tf]?.fresh) live.fresh_pairs += 1;
        }
      } catch {
        apiErrors += 1;
        live.checked_pairs += LIVE_TFS.length;
      }
    }
    if (apiErrors >= SAMPLE_SYMBOLS.length) {
      live.message = 'Research API unreachable — cannot verify candle freshness';
      live.ok = live.ws_connected;
    } else {
      const pct = live.checked_pairs
        ? Math.round((live.fresh_pairs / live.checked_pairs) * 100)
        : 0;
      live.pct = pct;
      live.ok = pct >= 50;
      live.message = live.ok
        ? `Live sync OK (${live.fresh_pairs}/${live.checked_pairs} fresh)`
        : `Stale candles (${live.fresh_pairs}/${live.checked_pairs} fresh)`;
    }
  }

  return {
    archives,
    live,
    ingestion: {
      started: ingestion.started,
      backfill_running: ingestion.backfillRunning,
      mtf_timeframes: ingestion.mtfTimeframes,
    },
    checked_at: new Date().toISOString(),
  };
}
