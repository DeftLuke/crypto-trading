/** Shared Telegram text helpers (no SMC engine calls). */
const GROUP_RISK_RE = /\b\d+\s*%|\b\d+\s*x|\b\d+x|\bx\d+|\bleverage\s*\d+|\bmargin\s*\d+|\brisk\s*\d+\s*%|\buse\s+\d+\s*%/gi;
const INFORMAL_SYMBOL_RE = /#?\s*([A-Z0-9]{2,12})\b/i;
const DIRECTION_RE = /\b(long|short|buy|sell)\b/i;
const FROM_HERE_RE = /\b(from here|buy here|buy zone|bounce from|entry here|long here|short here)\b/i;

export function stripGroupRiskHints(text = '') {
  return String(text)
    .replace(GROUP_RISK_RE, '[risk-hint-ignored]')
    .replace(/\b(leverage|margin)\b/gi, '[risk-hint-ignored]')
    .trim();
}

export function isTelegramExternalSignal(external = {}) {
  const p = String(external.provider || '').toLowerCase();
  const parser = String(external.parser || '').toLowerCase();
  return p.includes('telegram') || parser.includes('ai') || parser.includes('rule') || parser.includes('informal')
    || external.metadata?.group_title || external.source_chat_id;
}

export function inferSymbolFromInformalText(text = '', hint = '') {
  const combined = `${text} ${hint}`.trim();
  if (!combined) return null;
  const symMatch = combined.match(/\b([A-Z0-9]{2,12})USDT\b/i);
  if (symMatch) return symMatch[1].toUpperCase() + 'USDT';
  const hashMatch = combined.match(/#\s*([A-Z0-9]{2,12})\b/i);
  if (hashMatch) return hashMatch[1].toUpperCase() + 'USDT';
  const beforeDir = combined.match(/\b([A-Za-z][A-Za-z0-9]{1,11})\s+(long|short|buy|sell)\b/i);
  if (beforeDir) return beforeDir[1].toUpperCase() + 'USDT';
  const afterDir = combined.match(/\b(short|long|buy|sell)\s+([A-Za-z][A-Za-z0-9]{1,11})\b/i);
  if (afterDir) return afterDir[2].toUpperCase() + 'USDT';
  const informal = combined.match(INFORMAL_SYMBOL_RE);
  if (informal && DIRECTION_RE.test(combined)) {
    return informal[1].toUpperCase() + 'USDT';
  }
  return null;
}

export function inferDirectionFromText(text = '', side = '') {
  const s = String(side || '').toUpperCase();
  if (s === 'LONG' || s === 'SHORT') return s === 'SHORT' ? 'SELL' : 'BUY';
  const t = String(text || '').toLowerCase();
  if (/\b(short|sell)\b/.test(t)) return 'SELL';
  if (/\b(long|buy)\b/.test(t) || FROM_HERE_RE.test(t)) return 'BUY';
  return null;
}

export function needsSmcEnrichment(external = {}) {
  const entry = parseFloat(external.entry_price);
  const sl = parseFloat(external.stop_loss);
  const tp1 = parseFloat(external.tp1);
  const meta = external.metadata || {};
  if (meta.smc_enriched && meta.smc_engine === 'institutional-smc-v2') return false;
  if (!Number.isFinite(entry) || entry <= 0) return true;
  if (!Number.isFinite(sl) || sl <= 0) return true;
  if (!Number.isFinite(tp1) || tp1 <= 0) return true;
  if (!Number.isFinite(parseFloat(external.tp2)) || parseFloat(external.tp2) <= 0) return true;
  if (meta.levels_source === 'group_hint' || meta.levels_source === 'inferred') return true;
  return false;
}
