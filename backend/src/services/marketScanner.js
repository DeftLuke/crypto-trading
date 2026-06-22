import { config } from '../config/index.js';
import { callN8nWebhook } from '../services/n8n.js';
import { formatSignalMessage } from '../strategy/signalEngine.js';
import { saveSignal, logEvent, getPairStats, getSupabase } from '../services/supabase.js';
import { sendAlert, sendSignalNotification } from '../services/telegram.js';
import { scheduleSignalOutcomeCheck } from './signalOutcomeTracker.js';
import { notifyWatchlistUsers } from './agentTaskRunner.js';
import { getStrategy } from '../strategies/registry.js';
import { validateSignal, markSignalNotified } from '../services/signalGuard.js';
import { isScannerRunning, updateScannerStats } from '../services/scannerState.js';
import { getAllFuturesSymbols } from '../services/binance.js';
import { postControlSignal, isResearchConfigured } from '../services/researchApi.js';

let scanning = false;
let scanInterval = null;
const strategy = getStrategy('smc-mtf');

export async function scanMarkets() {
  if (!isScannerRunning()) return;
  if (scanning) return;
  scanning = true;

  const startTime = Date.now();
  let pairsScanned = 0;
  let bestSignal = null;

  try {
    let symbols;
    try {
      symbols = await getAllFuturesSymbols(parseInt(process.env.MIN_PAIR_VOLUME || '500000', 10));
    } catch {
      symbols = config.topPairs;
    }

    const { data: pairStats } = await getPairStats();
    const scoreMap = {};
    for (const ps of pairStats || []) {
      scoreMap[ps.symbol] = ps.strategy_score;
    }

    const sortedPairs = [...symbols].sort(
      (a, b) => (scoreMap[b] || 50) - (scoreMap[a] || 50)
    );

    console.log(`[Scanner] Scanning ${sortedPairs.length} pairs for best setup...`);

    const batchSize = parseInt(process.env.SCAN_BATCH_SIZE || '10', 10);
    for (let i = 0; i < sortedPairs.length; i += batchSize) {
      if (!isScannerRunning()) break;

      const batch = sortedPairs.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          const signal = await strategy.generateSignal(symbol);
          return signal;
        })
      );

      for (const result of results) {
        pairsScanned++;
        if (result.status !== 'fulfilled') continue;
        const signal = result.value;
        if (signal.direction === 'IGNORE') continue;

        if (!bestSignal || signal.confidence > bestSignal.confidence) {
          bestSignal = signal;
        }
      }

      if (bestSignal && bestSignal.confidence >= 85) break;
    }

    if (bestSignal) {
      const guard = await validateSignal(bestSignal);
      if (!guard.allowed) {
        console.log(`[Scanner] Best signal blocked: ${bestSignal.symbol} — ${guard.reason}`);
      } else {
        await notifySignal(bestSignal);
      }
    }

    await updateScannerStats({
      lastScanAt: new Date().toISOString(),
      pairsScanned,
      lastSignalSymbol: bestSignal?.symbol || null,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Scanner] Scan complete: ${pairsScanned} pairs in ${elapsed}s. Best: ${bestSignal?.symbol || 'none'} (${bestSignal?.confidence || 0}%)`);
  } finally {
    scanning = false;
  }
}

async function notifySignal(signal) {
  console.log(`[Scanner] Signal: ${signal.symbol} ${signal.direction} (${signal.confidence}%)`);

  const { data: saved, error: saveError } = await saveSignal(signal);

  if (saveError) {
    console.error(`[Scanner] Failed to save signal: ${saveError.message || saveError}`);
  }

  const signalId = saved?.id || `local-${Date.now()}`;
  markSignalNotified(signal);

  try {
    const messageId = await sendSignalNotification(signal, signalId);
    if (messageId && saved?.id) {
      const db = getSupabase();
      await db?.from('signals').update({ telegram_message_id: messageId, status: 'sent' }).eq('id', saved.id);
    }
  } catch (tgErr) {
    console.error(`[Scanner] Telegram notify failed: ${tgErr.message}`);
    await logEvent('error', 'telegram', tgErr.message, { symbol: signal.symbol, signalId });
  }

  if (saved && config.telegram.delivery !== 'n8n' && config.n8n.signalWebhook) {
    await callN8nWebhook(config.n8n.signalWebhook, { ...signal, id: signalId });
  }

  if (isResearchConfigured()) {
    try {
      const result = await postControlSignal({ ...signal, id: signalId, source: 'scanner' });
      if (result?.approval_required) {
        await logEvent('trade', 'control-center', 'Manual approval requested', {
          symbol: signal.symbol,
          signalId,
          approval_id: result.approval_id,
        });
      } else if (result?.executed) {
        const { sendTradeLifecycle } = await import('../services/telegram.js');
        await sendTradeLifecycle('trade.activated', {
          message: 'Auto-trade executed by scanner',
          signal,
          trade: result.trade,
          margin_usdt: result.trade?.risk_amount,
          leverage: result.trade?.leverage || leverage,
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

  await logEvent('signal', 'scanner', formatSignalMessage(signal), {
    symbol: signal.symbol,
    confidence: signal.confidence,
  });

  if (saved?.id) {
    scheduleSignalOutcomeCheck(saved);
  }

  await notifyWatchlistUsers(signal.symbol, { ...signal, id: signalId });
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
