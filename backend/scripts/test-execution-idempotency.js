/**
 * Unit tests for execution lock + notional resolution (P0-1 / P0-4).
 * Run: node backend/scripts/test-execution-idempotency.js
 */
import {
  executionLockKey,
  acquireExecutionLock,
  releaseExecutionLock,
  checkExecutionAllowed,
} from '../src/services/executionLock.js';
import { resolveNotionalUsdt } from '../src/services/tradeExecution.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

console.log('\n=== executionLockKey ===');
assert(executionLockKey({ id: 'abc-123', symbol: 'BTCUSDT' }) === 'signal:abc-123', 'signal id key');
assert(executionLockKey({ symbol: 'ethusdt', direction: 'BUY' }) === 'symbol:ETHUSDT:BUY', 'symbol key');

console.log('\n=== in-flight lock ===');
const sig = { id: 'test-lock-1', symbol: 'TESTUSDT', direction: 'BUY', source: 'test' };
const first = await acquireExecutionLock(sig, { source: 'test' });
assert(first.acquired === true, 'first acquire succeeds');
const second = await acquireExecutionLock(sig, { source: 'test' });
assert(second.acquired === false && second.reason === 'execution_in_progress', 'second acquire blocked in-flight');
releaseExecutionLock(first.key);

console.log('\n=== resolveNotionalUsdt ===');
assert(resolveNotionalUsdt({ notional_usdt: 2500 }) === 2500, 'from trade.notional_usdt');
assert(resolveNotionalUsdt({ margin_usdt: 50, leverage: 50 }) === 2500, 'margin × leverage');
assert(resolveNotionalUsdt({ quantity: 100, entry_price: 25 }) === 2500, 'qty × entry');
assert(resolveNotionalUsdt({}, { notional: 1800 }) === 1800, 'from sizing.notional');
const missing = resolveNotionalUsdt({});
assert(missing === null, 'returns null when unknown');

console.log('\n=== checkExecutionAllowed (no DB) ===');
const allowed = await checkExecutionAllowed({ id: 'local-999', symbol: 'ZZZUSDT', direction: 'BUY' });
assert(allowed.allowed === true, 'local signal allowed without DB trade');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
