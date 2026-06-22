#!/usr/bin/env node
/**
 * Unit checks for partial-close / dust-runner fixes (MORPHOUSDT-style issues).
 *
 *   node scripts/test-partial-close-flow.js
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  DUST_NOTIONAL_USDT,
  isDustNotional,
  isRunnerDust,
  positionNotional,
} from '../src/services/tradeProtection.js';

const __dir = dirname(fileURLToPath(import.meta.url));
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

console.log('\n══════════════════════════════════════════════════');
console.log(' Partial Close / Dust Runner Tests');
console.log('══════════════════════════════════════════════════\n');

console.log('1) Dust detection');
if (isDustNotional(0.181)) ok('0.181 USDT notional is dust');
else fail('0.181 USDT should be dust');
if (!isDustNotional(5)) ok('$5 notional is not dust');
else fail('$5 should not be dust');
if (isRunnerDust(0.1, 1.86, 2960)) ok('0.1 qty runner vs 2960 original is dust');
else fail('Tiny runner vs large original should be dust');

console.log('\n2) Position monitor — no trail Telegram spam');
const pm = readFileSync(join(__dir, '../src/jobs/positionMonitor.js'), 'utf8');
if (!pm.includes("notifyTradePhase('trail'")) ok('Trail SL updates do not send Telegram');
else fail('positionMonitor still notifies Telegram on trail SL');

if (pm.includes('isRunnerDust')) ok('Position monitor uses isRunnerDust for auto-flatten');
else fail('Missing isRunnerDust in position monitor');

console.log('\n3) Dashboard — dust positions visible when DB-linked');
const routes = readFileSync(join(__dir, '../src/routes/api.js'), 'utf8');
if (routes.includes('openBySymbol.has(position.symbol)) return true')) {
  ok('getMergedOpenTrades keeps DB-linked positions regardless of notional');
} else {
  fail('getMergedOpenTrades should include DB-linked dust positions');
}

if (routes.includes('booked_partial_pnl')) ok('Dashboard exposes booked partial PnL');
else fail('Missing booked_partial_pnl in performance metrics');

console.log('\n4) Partial close recording');
const closeSrc = readFileSync(join(__dir, '../src/services/tradeClose.js'), 'utf8');
if (closeSrc.includes("broadcastTradeEvent(phase === 'tp1' ? 'tp1_partial'")) {
  ok('recordTradePhasePnl broadcasts tp1/tp2 partial events');
} else {
  fail('recordTradePhasePnl should broadcast partial events');
}

console.log(`\nDUST_NOTIONAL_USDT = ${DUST_NOTIONAL_USDT}`);
console.log(`Sample notional 0.1 @ 1.86 = ${positionNotional({ quantity: 0.1, current_price: 1.86 }).toFixed(3)}`);

console.log('\n══════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
