import { getSupabase, saveTradeLesson } from './supabase.js';
import { buildPatternKey } from '../strategies/smc-mtf/rules.js';

export async function recordLessonPattern(lesson) {
  const db = getSupabase();
  if (!db) return;

  const patternKey = lesson.pattern_key || buildPatternKey(
    lesson.symbol,
    lesson.direction === 'LONG' ? 'BUY' : lesson.direction === 'SHORT' ? 'SELL' : lesson.direction,
    lesson.mtf_status || {}
  );

  const isLoss = lesson.outcome === 'loss';
  const isWin = lesson.outcome === 'win';

  const { data: existing } = await db
    .from('learned_patterns')
    .select('*')
    .eq('pattern_key', patternKey)
    .single();

  if (existing) {
    const lossCount = existing.loss_count + (isLoss ? 1 : 0);
    const winCount = existing.win_count + (isWin ? 1 : 0);
    const patternType = lossCount >= 3 && winCount < lossCount ? 'avoid' : existing.pattern_type;
    const penalty = patternType === 'avoid' ? Math.min(40, lossCount * 8) : 0;

    await db.from('learned_patterns').update({
      loss_count: lossCount,
      win_count: winCount,
      pattern_type: patternType,
      confidence_penalty: penalty,
      reason: lesson.lesson_text?.slice(0, 200) || existing.reason,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
  } else if (isLoss) {
    await db.from('learned_patterns').insert({
      pattern_key: patternKey,
      pattern_type: 'avoid',
      symbol: lesson.symbol,
      direction: lesson.direction,
      loss_count: 1,
      win_count: 0,
      confidence_penalty: 8,
      reason: lesson.lesson_text?.slice(0, 200) || 'Loss recorded',
      source_lesson_id: lesson.id,
    });
  } else if (isWin) {
    await db.from('learned_patterns').insert({
      pattern_key: patternKey,
      pattern_type: 'favor',
      symbol: lesson.symbol,
      direction: lesson.direction,
      loss_count: 0,
      win_count: 1,
      confidence_penalty: 0,
      reason: 'Profitable pattern',
      source_lesson_id: lesson.id,
    });
  }
}

export async function learnFromTrade(trade, lessonText) {
  const outcome = trade.pnl >= 0 ? 'win' : 'loss';
  const lesson = {
    trade_id: trade.id,
    signal_id: trade.signal_id,
    symbol: trade.symbol,
    direction: trade.direction,
    outcome,
    lesson_type: 'executed',
    lesson_text: lessonText,
    entry_price: trade.entry_price,
    exit_price: trade.exit_price,
    pnl: trade.pnl,
    r_multiple: trade.r_multiple,
  };

  const { data } = await saveTradeLesson(lesson);
  if (data) await recordLessonPattern({ ...lesson, id: data.id });
  return lesson;
}

export async function getLearnedPatterns(limit = 50) {
  const db = getSupabase();
  if (!db) return [];
  const { data } = await db
    .from('learned_patterns')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function getStrategyStats() {
  const db = getSupabase();
  if (!db) return null;

  const [tradesRes, lessonsRes, patternsRes, backtestsRes, signalsRes] = await Promise.all([
    db.from('trades').select('status, pnl, r_multiple'),
    db.from('trade_lessons').select('lesson_type, outcome'),
    db.from('learned_patterns').select('pattern_type, loss_count, win_count'),
    db.from('backtest_runs').select('*').order('created_at', { ascending: false }).limit(10),
    db.from('signals').select('status, direction'),
  ]);

  const trades = tradesRes.data || [];
  const closed = trades.filter((t) => t.status === 'closed');
  const wins = closed.filter((t) => (t.pnl || 0) > 0).length;
  const losses = closed.filter((t) => (t.pnl || 0) < 0).length;
  const totalPnl = closed.reduce((s, t) => s + (parseFloat(t.pnl) || 0), 0);

  const lessons = lessonsRes.data || [];
  const lessonStats = {
    skipped: { wins: 0, losses: 0 },
    executed: { wins: 0, losses: 0 },
    hypothetical: { wins: 0, losses: 0 },
  };
  for (const l of lessons) {
    const bucket = lessonStats[l.lesson_type] || lessonStats.hypothetical;
    if (l.outcome === 'win') bucket.wins++;
    if (l.outcome === 'loss') bucket.losses++;
  }

  const patterns = patternsRes.data || [];
  const avoidPatterns = patterns.filter((p) => p.pattern_type === 'avoid').length;
  const favorPatterns = patterns.filter((p) => p.pattern_type === 'favor').length;

  return {
    trades: {
      total: trades.length,
      open: trades.filter((t) => t.status === 'open' || t.status === 'partial').length,
      closed: closed.length,
      wins,
      losses,
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : 0,
      totalPnl,
      profitLossRatio: losses > 0 ? wins / losses : wins > 0 ? wins : 0,
    },
    lessons: lessonStats,
    patterns: { avoid: avoidPatterns, favor: favorPatterns, total: patterns.length },
    recentBacktests: backtestsRes.data || [],
    signals: {
      total: (signalsRes.data || []).length,
      pending: (signalsRes.data || []).filter((s) => s.status === 'pending' || s.status === 'sent').length,
    },
  };
}
