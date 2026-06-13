import { getKlines, parseKlines } from '../services/binance.js';
import {
  getSupabase,
  logEvent,
  saveTradeLesson,
  updatePairStats,
} from '../services/supabase.js';
import { generateTradeLesson } from '../services/ollama.js';
import { config } from '../config/index.js';
import { sendAlert } from '../services/telegram.js';

const pendingChecks = new Map();

export function scheduleSignalOutcomeCheck(signal) {
  if (!signal?.id || signal.direction === 'IGNORE') return;

  for (const minutes of [15, 20]) {
    const key = `${signal.id}:${minutes}`;
    if (pendingChecks.has(key)) continue;

    const timeout = setTimeout(async () => {
      pendingChecks.delete(key);
      await evaluateSignalOutcome(signal.id, minutes);
    }, minutes * 60 * 1000);

    pendingChecks.set(key, timeout);
    console.log(`[OutcomeTracker] Scheduled ${minutes}min check for ${signal.symbol} (${signal.id})`);
  }
}

export async function evaluateSignalOutcome(signalId, checkMinutes) {
  const db = getSupabase();
  if (!db) return;

  const { data: signal, error } = await db.from('signals').select('*').eq('id', signalId).single();
  if (error || !signal) return;

  try {
    const interval = signal.timeframe_entry || '5m';
    const raw = await getKlines(signal.symbol, interval, 50);
    const candles = parseKlines(raw);

    const signalTime = new Date(signal.created_at).getTime() / 1000;
    const relevantCandles = candles.filter((c) => c.time >= signalTime - 60);

    const result = simulateOutcome(signal, relevantCandles);
    const currentPrice = candles[candles.length - 1]?.close;
    const winProbability = calculateWinProbability(signal, result);

    await db.from('signal_outcomes').upsert({
      signal_id: signalId,
      check_minutes: checkMinutes,
      price_at_check: currentPrice,
      outcome: result.outcome,
      hit_tp1: result.hitTp1,
      hit_sl: result.hitSl,
      max_favorable: result.maxFavorable,
      max_adverse: result.maxAdverse,
      r_multiple: result.rMultiple,
      win_probability: winProbability,
      checked_at: new Date().toISOString(),
    }, { onConflict: 'signal_id,check_minutes' });

    if (checkMinutes === 20) {
      await db.from('signals').update({
        final_outcome: result.outcome,
        win_probability: winProbability,
        outcome_checked_at: new Date().toISOString(),
      }).eq('id', signalId);

      const lessonType = signal.user_action === 'executed' ? 'executed'
        : signal.user_action === 'skipped' ? 'skipped' : 'hypothetical';

      const aiLesson = await generateTradeLesson(signal, result.outcome, {
        checkMinutes,
        priceAtCheck: currentPrice,
        hitTp1: result.hitTp1,
        hitSl: result.hitSl,
        rMultiple: result.rMultiple,
        maxFavorable: result.maxFavorable,
      }, lessonType);

      await saveTradeLesson({
        signal_id: signalId,
        symbol: signal.symbol,
        direction: signal.direction,
        outcome: result.outcome,
        lesson_type: lessonType,
        setup_description: `${signal.direction} ${signal.symbol} @ ${signal.entry_price} — confidence ${signal.confidence}% — user: ${signal.user_action}`,
        lesson_text: aiLesson.lesson_text,
        embedding: aiLesson.embedding,
        ai_model: aiLesson.ai_model,
        win_probability: winProbability,
        tags: [signal.symbol, signal.direction, result.outcome, lessonType, signal.user_action],
      });

      if (signal.user_action !== 'executed') {
        await updatePairStats(signal.symbol, result.outcome, result.rMultiple || 0);
      }

      const emoji = result.outcome === 'win' ? '✅' : result.outcome === 'loss' ? '❌' : '⚪';
      const actionLabel = signal.user_action === 'skipped' ? 'SKIPPED' : signal.user_action === 'executed' ? 'TRADED' : 'NOT ACTED';

      await sendAlert(
        `${emoji} <b>Signal Review — ${signal.symbol}</b>\n\n` +
        `Action: ${actionLabel}\n` +
        `Direction: ${signal.direction}\n` +
        `Outcome (20min): <b>${result.outcome.toUpperCase()}</b>\n` +
        `Win probability: <b>${winProbability}%</b>\n` +
        `Entry: ${signal.entry_price} → Now: ${currentPrice}\n` +
        `${result.hitTp1 ? '✅ Would hit TP1' : result.hitSl ? '🛑 Would hit SL' : '⏳ No clear hit'}\n\n` +
        `<i>${aiLesson.lesson_text.slice(0, 300)}...</i>`
      );

      await logEvent('info', 'outcomeTracker', `Signal ${signalId} outcome: ${result.outcome}`, {
        symbol: signal.symbol,
        user_action: signal.user_action,
        winProbability,
      });
    }

    console.log(`[OutcomeTracker] ${signal.symbol} @ ${checkMinutes}min: ${result.outcome} (${winProbability}% win prob)`);
  } catch (err) {
    console.error(`[OutcomeTracker] Failed for ${signalId}:`, err.message);
    await logEvent('error', 'outcomeTracker', err.message, { signalId, checkMinutes });
  }
}

function simulateOutcome(signal, candles) {
  const entry = parseFloat(signal.entry_price);
  const sl = parseFloat(signal.stop_loss);
  const tp1 = parseFloat(signal.tp1);
  const isLong = signal.direction === 'BUY';
  const risk = Math.abs(entry - sl);

  let hitTp1 = false;
  let hitSl = false;
  let maxFavorable = 0;
  let maxAdverse = 0;
  let outcome = 'inconclusive';

  for (const c of candles) {
    if (isLong) {
      maxFavorable = Math.max(maxFavorable, c.high - entry);
      maxAdverse = Math.max(maxAdverse, entry - c.low);
      if (c.low <= sl) { hitSl = true; break; }
      if (c.high >= tp1) { hitTp1 = true; break; }
    } else {
      maxFavorable = Math.max(maxFavorable, entry - c.low);
      maxAdverse = Math.max(maxAdverse, c.high - entry);
      if (c.high >= sl) { hitSl = true; break; }
      if (c.low <= tp1) { hitTp1 = true; break; }
    }
  }

  if (hitTp1 && !hitSl) outcome = 'win';
  else if (hitSl) outcome = 'loss';
  else if (maxFavorable > risk * 0.5) outcome = 'breakeven';

  const rMultiple = risk > 0 ? maxFavorable / risk : 0;

  return { outcome, hitTp1, hitSl, maxFavorable, maxAdverse, rMultiple };
}

function calculateWinProbability(signal, result) {
  let prob = signal.confidence || 50;

  if (result.outcome === 'win') prob = Math.min(95, prob + 10);
  else if (result.outcome === 'loss') prob = Math.max(5, prob - 15);
  else if (result.outcome === 'breakeven') prob = Math.max(10, prob - 5);

  if (result.hitTp1) prob = Math.min(98, prob + 8);
  if (result.hitSl) prob = Math.max(5, prob - 20);

  return Math.round(prob);
}

export function startOutcomeTrackerRecovery() {
  setInterval(async () => {
    const db = getSupabase();
    if (!db) return;

    const cutoff = new Date(Date.now() - 25 * 60 * 1000).toISOString();
    const { data: signals } = await db
      .from('signals')
      .select('*')
      .in('direction', ['BUY', 'SELL'])
      .is('final_outcome', null)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .lte('created_at', cutoff);

    for (const signal of signals || []) {
      await evaluateSignalOutcome(signal.id, 20);
    }
  }, 5 * 60 * 1000);
}
