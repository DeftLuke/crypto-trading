import { getMarkPrice, getSymbolRules, protectionTriggerIssues, roundPriceToTick } from './binance.js';

function roundLevels(symbol, levels, rules) {
  const tick = rules?.tickSize || 0.0001;
  return {
    entry: roundPriceToTick(levels.entry, tick),
    stop_loss: roundPriceToTick(levels.stop_loss, tick),
    take_profit: (levels.take_profit || []).map((p) => roundPriceToTick(p, tick)),
    tp1: roundPriceToTick(levels.tp1, tick),
    tp2: roundPriceToTick(levels.tp2, tick),
    tp3: roundPriceToTick(levels.tp3, tick),
  };
}

/** Reprice entry/SL/TPs from current mark while keeping original % distances. */
export function repriceSignalLevels(parsed = {}, markPrice, side) {
  const isLong = String(side || parsed.side || 'LONG').toUpperCase() === 'LONG';
  const entry = parseFloat(parsed.entry) || markPrice;
  const sl = parseFloat(parsed.stop_loss);
  const tps = (Array.isArray(parsed.take_profit) ? parsed.take_profit : [])
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v) && v > 0);

  const slPct = Number.isFinite(sl) && entry > 0 ? Math.abs(entry - sl) / entry : 0.03;
  const tpPcts = tps.length
    ? tps.map((tp) => Math.abs(tp - entry) / entry)
    : [0.02, 0.04, 0.06];

  const newEntry = markPrice;
  let newSl;
  let newTps;
  if (isLong) {
    newSl = newEntry * (1 - slPct);
    newTps = tpPcts.map((pct) => newEntry * (1 + pct));
  } else {
    newSl = newEntry * (1 + slPct);
    newTps = tpPcts.map((pct) => newEntry * (1 - pct));
  }

  return {
    side: isLong ? 'LONG' : 'SHORT',
    entry: newEntry,
    stop_loss: newSl,
    take_profit: newTps,
    tp1: newTps[0],
    tp2: newTps[1],
    tp3: newTps[2],
  };
}

function entryDriftPct(entry, markPrice) {
  const e = parseFloat(entry);
  const m = parseFloat(markPrice);
  if (!Number.isFinite(e) || e <= 0 || !Number.isFinite(m)) return 0;
  return Math.abs(m - e) / e;
}

/**
 * Adapt telegram signal levels to current market when price moved or SL/TP triggers are stale.
 * Keeps original risk/reward ratios — does not chase a missed move blindly.
 */
export async function prepareTelegramSignalForExecution(parsed = {}, options = {}) {
  const symbol = String(parsed.symbol || '').toUpperCase();
  if (!symbol) return { ok: false, error: 'Signal has no symbol' };

  const side = String(parsed.side || 'LONG').toUpperCase();
  const direction = side === 'SHORT' ? 'SHORT' : 'LONG';
  const markPrice = await getMarkPrice(symbol);
  const rules = await getSymbolRules(symbol);
  const tps = Array.isArray(parsed.take_profit) ? parsed.take_profit : [];
  const issues = protectionTriggerIssues(direction, markPrice, {
    stopLoss: parsed.stop_loss,
    tp1: tps[0] || parsed.tp1,
    tp2: tps[1] || parsed.tp2,
  });

  const drift = entryDriftPct(parsed.entry, markPrice);
  const shouldAdapt = issues.length > 0 || drift >= (options.driftThreshold ?? 0.004);

  if (!shouldAdapt) {
    return {
      ok: true,
      parsed,
      markPrice,
      levelsAdapted: false,
      adaptReason: null,
      levelIssues: [],
    };
  }

  const repriced = repriceSignalLevels(parsed, markPrice, side);
  const rounded = roundLevels(symbol, repriced, rules);
  const adapted = {
    ...parsed,
    ...rounded,
    side,
    metadata: {
      ...(parsed.metadata || {}),
      levels_adapted_at: new Date().toISOString(),
      levels_adapted: true,
      original_entry: parsed.entry,
      original_stop_loss: parsed.stop_loss,
      adapt_mark_price: markPrice,
      adapt_reason: issues.length ? issues.map((i) => i.message).join('; ') : `Entry drift ${(drift * 100).toFixed(2)}%`,
    },
  };

  const postIssues = protectionTriggerIssues(direction, markPrice, {
    stopLoss: adapted.stop_loss,
    tp1: adapted.take_profit?.[0] || adapted.tp1,
    tp2: adapted.take_profit?.[1] || adapted.tp2,
  });

  return {
    ok: postIssues.length === 0,
    parsed: adapted,
    markPrice,
    levelsAdapted: true,
    adaptReason: adapted.metadata.adapt_reason,
    levelIssues: postIssues,
    error: postIssues.length ? 'Levels still invalid after adapt' : null,
  };
}
