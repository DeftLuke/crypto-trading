import { config } from '../config/index.js';
import { generateSignal, formatSignalMessage } from '../strategy/signalEngine.js';
import { saveSignal, logEvent, getPairStats, getSupabase } from '../services/supabase.js';
import { sendSignalNotification } from '../services/telegram.js';
import { binanceWs } from '../services/binanceWs.js';
import { scheduleSignalOutcomeCheck } from './signalOutcomeTracker.js';

let scanning = false;

export async function scanMarkets() {
  if (scanning) return;
  scanning = true;

  console.log(`[Scanner] Scanning ${config.topPairs.length} pairs...`);

  try {
    const { data: pairStats } = await getPairStats();
    const scoreMap = {};
    for (const ps of pairStats || []) {
      scoreMap[ps.symbol] = ps.strategy_score;
    }

    const sortedPairs = [...config.topPairs].sort(
      (a, b) => (scoreMap[b] || 50) - (scoreMap[a] || 50)
    );

    for (const symbol of sortedPairs) {
      try {
        binanceWs.subscribeMarkPrice(symbol, () => {});

        const signal = await generateSignal(symbol);

        if (signal.direction !== 'IGNORE') {
          console.log(`[Scanner] Signal found: ${symbol} ${signal.direction} (${signal.confidence}%)`);

          const { data: saved, error: saveError } = await saveSignal(signal);

          if (saveError) {
            console.error(`[Scanner] Failed to save signal: ${saveError.message || saveError}`);
          }

          const signalId = saved?.id || `local-${Date.now()}`;

          try {
            const messageId = await sendSignalNotification(signal, signalId);
            if (messageId && saved?.id) {
              const db = getSupabase();
              await db?.from('signals').update({ telegram_message_id: messageId, status: 'sent' }).eq('id', saved.id);
            }
          } catch (tgErr) {
            console.error(`[Scanner] Telegram notify failed: ${tgErr.message}`);
            await logEvent('error', 'telegram', tgErr.message, { symbol, signalId });
          }

          if (saved && config.n8n.signalWebhook) {
            await fetch(config.n8n.signalWebhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...signal, id: signalId }),
            }).catch(() => {});
          }

          await logEvent('signal', 'scanner', formatSignalMessage(signal), {
            symbol,
            confidence: signal.confidence,
          });

          if (saved?.id) {
            scheduleSignalOutcomeCheck(saved);
          }

          // Only notify one high-quality signal per scan cycle
          break;
        }
      } catch (err) {
        await logEvent('error', 'scanner', `${symbol}: ${err.message}`);
      }
    }
  } finally {
    scanning = false;
  }
}

export function startScanner() {
  scanMarkets();
  setInterval(scanMarkets, config.strategy.scanIntervalMs);
  console.log(`[Scanner] Started — interval ${config.strategy.scanIntervalMs}ms`);
}
