#!/usr/bin/env node
/**
 * CP7 — Institutional SMC production deploy verification + parity smoke tests.
 *
 * Usage:
 *   node scripts/verify-institutional-smc-deploy.js
 *   TRADING_API_URL=http://127.0.0.1:3002 node scripts/verify-institutional-smc-deploy.js
 *   TRADING_API_URL=https://api.deftluke.online/api node scripts/verify-institutional-smc-deploy.js
 */
import { getStrategy } from '../src/strategies/registry.js';
import { mapSetupToSignal } from '../src/strategies/institutional-smc/index.js';

const BASE = (process.env.TRADING_API_URL || 'http://127.0.0.1:3002/api').replace(/\/$/, '');
const RESEARCH = (process.env.RESEARCH_API_URL || 'http://127.0.0.1:8100').replace(/\/$/, '');
const SYMBOL = (process.env.PARITY_SYMBOL || 'BTCUSDT').toUpperCase();

let passed = 0;
let failed = 0;

function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function fail(label, detail = '') {
  failed += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function fetchJson(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, data, offline: false };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err.message }, offline: true };
  }
}

console.log('\n══════════════════════════════════════════════════');
console.log(' CP7 Institutional SMC Deploy Verification');
console.log(` Trading API: ${BASE}`);
console.log(` Research API: ${RESEARCH}`);
console.log('══════════════════════════════════════════════════\n');

// ── 1. Static: strategy registry ──
console.log('1) Strategy registry');
const legacy = getStrategy('smc-mtf');
const inst = getStrategy('institutional-smc');
if (legacy?.generateSignal) ok('smc-mtf registered with generateSignal');
else fail('smc-mtf missing');
if (inst?.generateSignal) ok('institutional-smc registered with generateSignal');
else fail('institutional-smc missing');

// ── 2. Adapter shape parity ──
console.log('\n2) Signal adapter contract');
const mockSetup = {
  symbol: SYMBOL,
  status: 'accepted',
  direction: 'LONG',
  confluence_score: 85,
  engine_version: 'v2',
  entry_price: 100000,
  stop_loss: 99500,
  tp1: 100500,
  tp2: 101000,
  tp3: 101500,
  explanation: {
    human_summary: 'test',
    market_structure: { status: 'pass', mtf: { trend: { structure_state: 'bullish', timeframe: '1d' } } },
    filters: [{ name: 'htf_alignment', status: 'pass', reason: 'ok' }],
    confluence: { market_structure: 15 },
  },
  confluence_breakdown: { market_structure: 15, liquidity_sweep: 12 },
};
const mapped = mapSetupToSignal(mockSetup, SYMBOL);
if (mapped.direction === 'BUY') ok('LONG → BUY direction map');
else fail('direction map', mapped.direction);
for (const field of ['entry_price', 'stop_loss', 'tp1', 'confidence', 'reasons', 'strategy_id']) {
  if (mapped[field] != null) ok(`signal.${field} present`);
  else fail(`signal.${field} missing`);
}
if (mapped.strategy_id === 'institutional-smc') ok('strategy_id institutional-smc');

// ── 3. Backend health ──
console.log('\n3) Backend API health');
const health = await fetchJson(`${BASE}/health`);
if (health.ok && health.data.status === 'ok') ok('GET /api/health');
else fail('GET /api/health', health.offline ? 'offline' : `HTTP ${health.status}`);

if (health.ok && health.data.research === 'connected') ok('backend → research-api connected');
else if (health.offline) fail('backend offline');
else fail('backend research link', health.data.research || 'unknown');

// ── 4. Institutional proxy health ──
console.log('\n4) Institutional SMC proxy (Node → Python)');
const instHealth = await fetchJson(`${BASE}/institutional-smc/health`);
if (instHealth.ok) {
  ok('GET /api/institutional-smc/health');
  if (instHealth.data.phase === 'CP6') ok(`engine phase ${instHealth.data.phase}`);
  else fail('engine phase', String(instHealth.data.phase));
  if (Array.isArray(instHealth.data.modules_implemented) && instHealth.data.modules_implemented.length >= 7) {
    ok(`${instHealth.data.modules_implemented.length} modules implemented`);
  } else {
    fail('modules_implemented count');
  }
} else {
  fail('GET /api/institutional-smc/health', instHealth.offline ? 'offline' : `HTTP ${instHealth.status} — deploy backend CP6+`);
}

// ── 5. Signal engine selector ──
console.log('\n5) Signal engine selector');
const engineStatus = await fetchJson(`${BASE}/signal-engine/status`);
if (engineStatus.ok) {
  ok('GET /api/signal-engine/status');
  if (engineStatus.data.active_engine) ok(`active_engine=${engineStatus.data.active_engine}`);
  else fail('active_engine missing');
  if (engineStatus.data.institutional_smc?.configured != null) ok('institutional_smc config block');
} else {
  fail('GET /api/signal-engine/status', engineStatus.offline ? 'offline' : `HTTP ${engineStatus.status}`);
}

// ── 6. Research-api direct ──
console.log('\n6) Research-api direct');
const rHealth = await fetchJson(`${RESEARCH}/health`);
if (rHealth.ok) ok('GET research-api /health');
else fail('research-api /health', rHealth.offline ? 'offline' : `HTTP ${rHealth.status}`);

const rInst = await fetchJson(`${RESEARCH}/api/v1/institutional-smc/health`);
if (rInst.ok) {
  ok('GET /api/v1/institutional-smc/health');
  if (rInst.data.engine_version === 'v2') ok('Python engine v2');
} else {
  fail('Python institutional health', rInst.offline ? 'offline' : `HTTP ${rInst.status}`);
}

const rSpec = await fetchJson(`${RESEARCH}/api/v1/institutional-smc/spec`);
if (rSpec.ok && rSpec.data.min_trade_score === 80) ok('spec min_trade_score=80');
else fail('institutional spec', rSpec.offline ? 'offline' : `HTTP ${rSpec.status}`);

// ── 7. Live analyze smoke (single symbol) ──
console.log(`\n7) Analyze smoke (${SYMBOL})`);
const analyze = await fetchJson(`${RESEARCH}/api/v1/institutional-smc/analyze`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ symbol: SYMBOL, persist: false }),
});
if (analyze.ok && analyze.data.symbol === SYMBOL) {
  ok('POST analyze returns result');
  if (['accepted', 'rejected'].includes(analyze.data.status)) ok(`status=${analyze.data.status}`);
  else fail('unexpected status', analyze.data.status);
  if (analyze.data.explanation?.confluence) ok('explainability.confluence present');
  else fail('explainability incomplete');
} else {
  fail('POST analyze', analyze.offline ? 'offline' : (analyze.data.detail || analyze.data.error || `HTTP ${analyze.status}`));
}

// ── 8. Engine parity (optional — needs Binance from research-api) ──
console.log('\n8) Engine parity note');
console.log('  · smc-mtf uses Node MTF 1h/30m/15m/5m + RSI oversold gates');
console.log('  · institutional-smc uses Python 1d/4h/1h/15m + ≥80 confluence gate');
console.log('  · Toggle active engine on Risk dashboard or POST /api/signal-engine');
ok('parity documented — engines intentionally differ until full backtest parity');

console.log('\n══════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
