import { config } from '../config/index.js';
import { callN8nWebhook } from '../services/n8n.js';
import { formatSignalMessage } from '../strategy/signalEngine.js';
import { saveSignal, logEvent, getPairStats, getSupabase } from '../services/supabase.js';
import { applyLineageToSignal, buildLineage } from '../services/signalLineage.js';
import { sendAlert, sendSignalNotification } from '../services/telegram.js';
import { scheduleSignalOutcomeCheck } from './signalOutcomeTracker.js';
import { notifyWatchlistUsers } from './agentTaskRunner.js';
import { validateSignal, markSignalNotified } from '../services/signalGuard.js';
import { isScannerRunning, setScanProgress, updateScannerStats } from '../services/scannerState.js';
import { postControlSignal, isResearchConfigured } from '../services/researchApi.js';
import { getScannerSymbolUniverse } from '../services/scannerUniverse.js';
import { getLocalControlSettings } from '../services/controlCenter.js';
import { dashboardBroadcast } from '../services/wsBroadcast.js';
import {
  getActiveSignalEngineId,
  SIGNAL_ENGINE_INSTITUTIONAL,
  isLegacySmcMtfEnabled,
} from '../services/signalEngineSelector.js';
import { analyzeInstitutionalBatch, checkInstitutionalSmcHealth } from '../services/institutionalSmcClient.js';
import { mapSetupToSignal } from '../strategies/institutional-smc/index.js';
import { filterReadySymbols } from './candleIngestion.js';

let scanning = false;
let scanInterval = null;

function broadcastScanProgress(extra = {}) {
  const payload = {
    type: 'scanner_progress',
    engine: 'institutional-smc',
    engine_label: 'SMC v2 (Python)',
    progress_pct: extra.scanProgressPct ?? extra.progress_pct ?? 0,
    pairs_scanned: extra.pairsScanned ?? extra.pairs_scanned ?? 0,
    universe_size: extra.universeSize ?? extra.universe_size ?? 0,
    scanning: extra.scanning,
    lastScanAt: extra.lastScanAt,
    signals_found: extra.signalsFound ?? extra.signals_found,
    ...extra,
  };
  dashboardBroadcast(payload);
}

function pushScanProgress(partial) {
  setScanProgress(partial);
  broadcastScanProgress(partial);
}

export async function scanMarkets() {
  if (!isScannerRunning()) return;
  if (scanning) return;
  scanning = true;

  const startTime = Date.now();
  let pairsScanned = 0;
  let signalsFound = 0;
  let bestSignal = null;
  let engineId = 'smc-mtf';
  let scanMeta = {};

  try {
    engineId = await getActiveSignalEngineId();

    if (engineId !== SIGNAL_ENGINE_INSTITUTIONAL) {
      if (!isLegacySmcMtfEnabled()) {
        console.warn('[Scanner] Legacy smc-mtf disabled — only institutional-smc v2 runs');
        return;
      }
    }

    if (engineId === SIGNAL_ENGINE_INSTITUTIONAL) {
      const health = await checkInstitutionalSmcHealth();
      if (!health.ok) {
        console.warn(`[Scanner] Institutional engine offline: ${health.error}`);
        await logEvent('warn', 'scanner', 'Institutional SMC offline — scan skipped', { error: health.error });
        return;
      }
    } else {
      console.warn('[Scanner] Legacy smc-mtf scan skipped — set SIGNAL_ENGINE=institutional-smc');
      return;
    }

    const { symbols: universeSymbols, meta: universeMeta } = await getScannerSymbolUniverse(engineId);
    scanMeta = universeMeta;
    let symbols = universeSymbols;

    const { data: pairStats } = await getPairStats();
    const scoreMap = {};
    for (const ps of pairStats || []) {
      scoreMap[ps.symbol] = ps.strategy_score;
    }

    const sortedPairs = [...symbols].sort(
      (a, b) => (scoreMap[b] || 50) - (scoreMap[a] || 50),
    );

    if (!sortedPairs.length) {
      console.warn('[Scanner] Empty symbol universe');
      await logEvent('warn', 'scanner', 'Scan skipped — empty symbol universe', scanMeta);
      return;
    }

    console.log(
      `[Scanner] Engine=${engineId} · universe=${sortedPairs.length} pairs`
      + (scanMeta.source ? ` (${scanMeta.source}, ready=${scanMeta.ready ?? 'n/a'})` : ''),
    );

    pushScanProgress({
      scanning: true,
      scanProgressPct: 0,
      scanStartedAt: new Date().toISOString(),
      engineId,
      universeSize: sortedPairs.length,
      pairsScanned: 0,
      scanMeta,
    });

    const batchSize = config.institutionalSmc?.batchSize || 25;
    let topScore = { symbol: null, score: 0, direction: null, status: null };

    for (let i = 0; i < sortedPairs.length; i += batchSize) {
      if (!isScannerRunning()) break;

      const batch = sortedPairs.slice(i, i + batchSize);
      let batchSignals = [];

      const { ready, pending } = await filterReadySymbols(batch);
      if (pending.length) {
        console.log(`[Scanner] ${pending.length} symbols awaiting OHLCV — skipping batch slice`);
      }
      if (!ready.length) {
        pairsScanned += batch.length;
        continue;
      }
      const batchResult = await analyzeInstitutionalBatch(ready);
      if (!batchResult.ok) {
        console.warn(`[Scanner] Batch analyze failed: ${batchResult.error}`);
        break;
      }
      const results = batchResult.data?.results || [];
      batchSignals = results.map((setup) => mapSetupToSignal(setup, setup.symbol));
      pairsScanned += ready.length;

      for (const setup of results) {
        const score = Number(setup?.confluence_score ?? 0);
        if (score > topScore.score) {
          topScore = {
            symbol: setup.symbol || setup?.explanation?.symbol,
            score: Math.round(score * 10) / 10,
            direction: setup.direction || null,
            status: setup.status || null,
          };
        }
      }

      const pct = sortedPairs.length
        ? Math.min(99, Math.round((pairsScanned / sortedPairs.length) * 100))
        : 0;
      pushScanProgress({
        scanning: true,
        scanProgressPct: pct,
        pairsScanned,
        universeSize: sortedPairs.length,
        engineId,
      });

      for (const signal of batchSignals) {
        if (!signal || signal.direction === 'IGNORE') continue;
        signalsFound++;
        if (!bestSignal || signal.confidence > bestSignal.confidence) {
          bestSignal = signal;
        }
      }

      const exitThreshold = 85;
      if (bestSignal && bestSignal.confidence >= exitThreshold) break;
    }

    if (bestSignal) {
      const guard = await validateSignal(bestSignal);
      if (!guard.allowed) {
        console.log(`[Scanner] Best signal blocked: ${bestSignal.symbol} — ${guard.reason}`);
      } else {
        await notifySignal(bestSignal, engineId);
      }
    }

    await updateScannerStats({
      lastScanAt: new Date().toISOString(),
      pairsScanned,
      lastSignalSymbol: bestSignal?.symbol || null,
      bestScoreSymbol: topScore.symbol,
      bestScore: topScore.score,
      bestScoreDirection: topScore.direction,
      bestScoreStatus: topScore.status,
      engineId,
      universeSize: sortedPairs.length,
      signalsFound,
      scanMeta,
      scanning: false,
      scanProgressPct: 100,
      scanStartedAt: null,
    });

    pushScanProgress({
      scanning: false,
      scanProgressPct: 100,
      pairsScanned,
      universeSize: sortedPairs.length,
      engineId,
      signalsFound,
      bestScoreSymbol: topScore.symbol,
      bestScore: topScore.score,
      bestScoreDirection: topScore.direction,
      bestScoreStatus: topScore.status,
      lastScanAt: new Date().toISOString(),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[Scanner] Complete (${engineId}): ${pairsScanned}/${sortedPairs.length} pairs in ${elapsed}s. `
      + `Signals: ${signalsFound}. Best: ${bestSignal?.symbol || 'none'} (${bestSignal?.confidence || 0}%). `
      + `Top score: ${topScore.symbol || 'none'} (${topScore.score})`,
    );
  } finally {
    scanning = false;
    setScanProgress({ scanning: false });
  }
}

async function notifySignal(signal, engineId = signal.strategy_id || 'smc-mtf') {
  const strategyName = signal.strategy_name || signal.strategy_id || engineId;
  console.log(`[Scanner] Signal: ${signal.symbol} ${signal.direction} (${signal.confidence}%) via ${strategyName}`);

  const lineage = buildLineage(
    { scanner: true, strategy_id: strategyName },
    { source: 'scanner', strategyName },
  );
  const taggedSignal = applyLineageToSignal(
    { ...signal, validation_score: signal.confidence, strategy_name: strategyName },
    lineage,
  );

  const { data: saved, error: saveError } = await saveSignal(taggedSignal);

  if (saveError) {
    console.error(`[Scanner] Failed to save signal: ${saveError.message || saveError}`);
  }

  const signalId = saved?.id || `local-${Date.now()}`;
  markSignalNotified(signal);

  try {
    const messageId = await sendSignalNotification(taggedSignal, signalId);
    if (messageId && saved?.id) {
      const db = getSupabase();
      await db?.from('signals').update({ telegram_message_id: messageId, status: 'sent' }).eq('id', saved.id);
    }
  } catch (tgErr) {
    console.error(`[Scanner] Telegram notify failed: ${tgErr.message}`);
    await logEvent('error', 'telegram', tgErr.message, { symbol: signal.symbol, signalId });
  }

  if (saved && config.telegram.delivery !== 'n8n' && config.n8n.signalWebhook) {
    await callN8nWebhook(config.n8n.signalWebhook, { ...taggedSignal, id: signalId });
  }

  if (isResearchConfigured()) {
    try {
      const result = await postControlSignal({ ...taggedSignal, id: signalId, source: 'scanner' });
      if (result?.approval_required) {
        await logEvent('trade', 'control-center', 'Manual approval requested', {
          symbol: signal.symbol,
          signalId,
          approval_id: result.approval_id,
        });
      } else if (result?.executed) {
        await logEvent('trade', 'control-center', 'Auto-trade executed by scanner', {
          symbol: signal.symbol,
          signalId,
          tradeId: result.trade?.id,
        });
      } else if (result?.duplicate) {
        await logEvent('warn', 'control-center', `Scanner duplicate blocked: ${result.reason}`, {
          symbol: signal.symbol,
          signalId,
        });
      } else if (result?.reason === 'auto_trading_off') {
        await logEvent('signal', 'control-center', 'Signal notified (auto-trade off)', {
          symbol: signal.symbol,
          signalId,
        });
      }
    } catch (err) {
      console.error(`[Scanner] Control Center submit failed: ${err.message}`);
      await sendAlert(`⚠️ <b>Pipeline failed</b>\n${signal.symbol}: ${err.message}`);
      await logEvent('error', 'control-center', err.message, { symbol: signal.symbol, signalId });
    }
  }

  await logEvent('signal', 'scanner', formatSignalMessage(taggedSignal), {
    symbol: signal.symbol,
    confidence: signal.confidence,
    engine: strategyName,
  });

  if (saved?.id) {
    scheduleSignalOutcomeCheck(saved);
  }

  await notifyWatchlistUsers(signal.symbol, { ...taggedSignal, id: signalId });
}

export function startScanner() {
  if (scanInterval) return;
  scanInterval = setInterval(scanMarkets, config.strategy.scanIntervalMs);
  console.log(`[Scanner] Scheduler started — interval ${config.strategy.scanIntervalMs}ms (auto ON at boot)`);
}

export function stopScannerScheduler() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

export async function triggerScan() {
  return scanMarkets();
}

/** Manual scan with summary — for dashboard / ops checks. */
export async function runScannerOnce() {
  if (scanning) {
    for (let i = 0; i < 600 && scanning; i++) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await scanMarkets();
  const settings = await getLocalControlSettings().catch(() => ({}));
  const { getScannerState } = await import('../services/scannerState.js');
  const state = await getScannerState();
  return {
    engine: state.engineId || settings.signal_engine || 'institutional-smc',
    pairs_scanned: state.pairsScanned,
    universe_size: state.universeSize,
    signals_found: state.signalsFound,
    last_signal: state.lastSignalSymbol,
    scan_meta: state.scanMeta,
    last_scan_at: state.lastScanAt,
  };
}
