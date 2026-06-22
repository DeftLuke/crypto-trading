/**
 * Pre-execute safety gate — block before market order if symbol/levels invalid.
 */
import { getExchangeInfo, getSymbolRules, getMarkPrice } from './binance.js';
import { logEvent } from './supabase.js';
import { logTradeEvent, EVENT_TYPES } from './tradeEventAudit.js';

let symbolStatusCache = null;
let cacheAt = 0;
const CACHE_MS = 5 * 60 * 1000;

async function loadSymbolStatus() {
  if (symbolStatusCache && Date.now() - cacheAt < CACHE_MS) return symbolStatusCache;
  const info = await getExchangeInfo();
  symbolStatusCache = {};
  for (const s of info.symbols || []) {
    symbolStatusCache[s.symbol] = {
      status: s.status,
      contractType: s.contractType,
      quoteAsset: s.quoteAsset,
    };
  }
  cacheAt = Date.now();
  return symbolStatusCache;
}

export async function isSymbolTradable(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!/^[A-Z0-9]{2,20}USDT$/.test(sym)) {
    return { ok: false, reason: 'Invalid symbol format' };
  }
  try {
    const map = await loadSymbolStatus();
    const row = map[sym];
    if (!row) return { ok: false, reason: `Symbol ${sym} not listed on Binance futures` };
    if (row.status !== 'TRADING') return { ok: false, reason: `Symbol ${sym} status=${row.status}` };
    if (row.contractType && row.contractType !== 'PERPETUAL') {
      return { ok: false, reason: `Symbol ${sym} is not a USDT perpetual` };
    }
    return { ok: true, symbol: sym };
  } catch (err) {
    return { ok: false, reason: err.message || 'exchangeInfo unavailable' };
  }
}

export async function validateExecutionGate(signal = {}, { tradeId = null } = {}) {
  const checks = [];
  const symbol = String(signal.symbol || '').toUpperCase();

  const tradable = await isSymbolTradable(symbol);
  checks.push({ rule: 'symbol_tradable', passed: tradable.ok, message: tradable.ok ? symbol : tradable.reason });
  if (!tradable.ok) {
    if (tradeId) {
      await logTradeEvent(tradeId, EVENT_TYPES.EXECUTION_BLOCKED, { metadata: { reason: tradable.reason, symbol } });
    }
    return { passed: false, checks, reason: tradable.reason };
  }

  let rules;
  try {
    rules = await getSymbolRules(symbol);
    const mark = await getMarkPrice(symbol);
    checks.push({ rule: 'mark_price', passed: Number.isFinite(mark) && mark > 0, message: mark ? `mark ${mark}` : 'no mark price' });
  } catch (err) {
    checks.push({ rule: 'mark_price', passed: false, message: err.message });
    return { passed: false, checks, reason: err.message };
  }

  const sl = parseFloat(signal.stop_loss);
  const tp1 = parseFloat(signal.tp1);
  const tp2 = parseFloat(signal.tp2);
  const entry = parseFloat(signal.entry_price) || null;

  checks.push({
    rule: 'stop_loss',
    passed: Number.isFinite(sl) && sl > 0,
    message: Number.isFinite(sl) && sl > 0 ? `SL ${sl}` : 'stop_loss required',
  });
  checks.push({
    rule: 'tp1',
    passed: Number.isFinite(tp1) && tp1 > 0,
    message: Number.isFinite(tp1) && tp1 > 0 ? `TP1 ${tp1}` : 'tp1 required',
  });
  checks.push({
    rule: 'tp2',
    passed: Number.isFinite(tp2) && tp2 > 0,
    message: Number.isFinite(tp2) && tp2 > 0 ? `TP2 ${tp2}` : 'tp2 required',
  });

  const direction = signal.direction === 'SELL' || signal.direction === 'SHORT' ? 'SHORT' : 'LONG';
  if (entry && Number.isFinite(sl) && Number.isFinite(tp1)) {
    const geomOk = direction === 'LONG'
      ? sl < entry && tp1 > entry
      : sl > entry && tp1 < entry;
    checks.push({
      rule: 'level_geometry',
      passed: geomOk,
      message: geomOk ? 'SL/TP geometry OK' : 'SL/TP geometry invalid for direction',
    });
  }

  const failed = checks.find((c) => !c.passed);
  if (failed) {
    const reason = failed.message || failed.rule;
    if (tradeId) {
      await logTradeEvent(tradeId, EVENT_TYPES.EXECUTION_BLOCKED, { metadata: { reason, checks } });
    }
    await logEvent('warn', 'executionGate', `Blocked: ${reason}`, { symbol });
    return { passed: false, checks, reason };
  }

  return { passed: true, checks, rules };
}
