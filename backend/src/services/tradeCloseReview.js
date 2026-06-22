/**
 * Phase 3: Post-trade close review — factors + AI lesson + journal (feeds Phase 4).
 */
import { getSupabase, saveTradeLesson, logEvent } from './supabase.js';
import { generateClosedTradeLesson } from './ollama.js';
import { recordLessonPattern } from './tradeLearner.js';
import { extractLineageFromSignal } from './signalLineage.js';

export function analyzeCloseFactors(trade, signal, context = {}) {
  const entry = parseFloat(trade.entry_price);
  const signalEntry = signal ? parseFloat(signal.entry_price) : entry;
  const slippagePct = signalEntry > 0 ? (Math.abs(entry - signalEntry) / signalEntry) * 100 : 0;
  const levelsAdapted = Boolean(context.levelsAdapted || trade.close_factors?.slippage?.levels_adapted);
  const staleEntry = levelsAdapted || slippagePct > 1.5;

  const openedAt = trade.opened_at ? new Date(trade.opened_at).getTime() : null;
  const closedAt = trade.closed_at ? new Date(trade.closed_at).getTime() : Date.now();
  const signalAt = signal?.created_at ? new Date(signal.created_at).getTime() : null;

  const outcome = (parseFloat(trade.pnl) || 0) > 0 ? 'win'
    : (parseFloat(trade.pnl) || 0) < 0 ? 'loss' : 'breakeven';

  return {
    market_structure: {
      tp1_hit: Boolean(trade.tp1_hit),
      tp2_hit: Boolean(trade.tp2_hit),
      sl_breakeven: Boolean(trade.sl_moved_breakeven),
      sl_locked_1r: Boolean(trade.sl_locked_1r),
      mtf_status: signal?.mtf_status || {},
      direction: trade.direction,
    },
    timing: {
      signal_to_fill_ms: openedAt && signalAt ? openedAt - signalAt : trade.execution_latency_ms ?? null,
      hold_duration_ms: openedAt ? closedAt - openedAt : null,
    },
    slippage: {
      entry_drift_pct: Math.round(slippagePct * 100) / 100,
      signal_entry: signalEntry,
      fill_entry: entry,
      levels_adapted: levelsAdapted,
    },
    stale_entry: staleEntry,
    close_reason: context.reason || trade.close_reason || 'unknown',
    outcome,
    validation_score: signal ? extractLineageFromSignal(signal).validation_score : null,
  };
}

async function fetchSignalForTrade(trade) {
  if (!trade?.signal_id) return null;
  const db = getSupabase();
  if (!db) return null;
  const { data } = await db.from('signals').select('*').eq('id', trade.signal_id).maybeSingle();
  return data;
}

async function writeTradeJournal(trade, signal, closeFactors, lessonText) {
  const db = getSupabase();
  if (!db) return;

  const lineage = signal ? extractLineageFromSignal(signal) : {};
  const journalId = `tj-${trade.id}`;
  const pnl = parseFloat(trade.pnl) || 0;

  try {
    await db.from('trade_journal').upsert({
      journal_id: journalId,
      trade_id: trade.id,
      source: trade.signal_source || lineage.source || 'live',
      symbol: trade.symbol,
      direction: trade.direction,
      strategy_name: trade.strategy_name || lineage.strategy,
      signal_id: trade.signal_id,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      sl: trade.stop_loss,
      tp1: trade.tp1,
      tp2: trade.tp2,
      pnl_usd: pnl,
      pnl_pct: trade.pnl_percent,
      result: closeFactors.outcome,
      market_conditions: closeFactors,
      opened_at: trade.opened_at,
      closed_at: trade.closed_at || new Date().toISOString(),
    }, { onConflict: 'journal_id' });

    await db.from('trade_timeline').insert({
      journal_id: journalId,
      event_type: 'trade_closed',
      detail: {
        close_reason: closeFactors.close_reason,
        r_multiple: trade.r_multiple,
        lesson_preview: lessonText?.slice(0, 300),
        phase: 'phase3_close_review',
      },
    });
  } catch (err) {
    await logEvent('warn', 'tradeCloseReview', `Journal write skipped: ${err.message}`, { tradeId: trade.id });
  }
}

export async function processTradeCloseReview(trade, context = {}) {
  const signal = context.signal || await fetchSignalForTrade(trade);
  const closeFactors = analyzeCloseFactors(trade, signal, context);
  const pnl = parseFloat(trade.pnl) || 0;
  const outcome = closeFactors.outcome;

  const aiLesson = await generateClosedTradeLesson(trade, signal, closeFactors);

  const lessonRow = {
    trade_id: trade.id,
    signal_id: trade.signal_id || signal?.id,
    symbol: trade.symbol,
    direction: trade.direction,
    outcome,
    lesson_type: 'executed',
    setup_description: `${trade.direction} ${trade.symbol} — entry ${trade.entry_price}, exit ${trade.exit_price}`,
    lesson_text: aiLesson.lesson_text,
    embedding: aiLesson.embedding,
    ai_model: aiLesson.ai_model,
    tags: [
      trade.symbol,
      trade.direction,
      outcome,
      closeFactors.close_reason,
      closeFactors.stale_entry ? 'stale_entry' : 'fresh_entry',
    ],
    pnl,
    r_multiple: trade.r_multiple,
    close_factors: closeFactors,
    win_probability: signal?.win_probability ?? null,
  };

  const { data: saved } = await saveTradeLesson(lessonRow);
  if (saved) {
    await recordLessonPattern({
      ...lessonRow,
      id: saved.id,
      mtf_status: signal?.mtf_status || {},
    });
  }

  const db = getSupabase();
  if (db) {
    try {
      await db.from('trades').update({
        close_factors: closeFactors,
        lesson: aiLesson.lesson_text?.slice(0, 500),
      }).eq('id', trade.id);
      if (signal?.id && signal.user_action === 'executed') {
        await db.from('signals').update({ final_outcome: outcome }).eq('id', signal.id);
      }
    } catch {
      /* optional columns may be missing before migration */
    }
  }

  await writeTradeJournal(trade, signal, closeFactors, aiLesson.lesson_text);

  await logEvent('info', 'tradeCloseReview', `Close review: ${trade.symbol} ${outcome}`, {
    tradeId: trade.id,
    signalId: trade.signal_id,
    stale_entry: closeFactors.stale_entry,
    r_multiple: trade.r_multiple,
    ai_model: aiLesson.ai_model,
  });

  return { closeFactors, lesson: lessonRow, ai_model: aiLesson.ai_model };
}
