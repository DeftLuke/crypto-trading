#!/usr/bin/env node
/**
 * Test Telegram signal flow: parse hints → SMC enrich → validate (score ≥50).
 * Usage:
 *   node backend/scripts/test-telegram-signal-flow.js
 *   TRADING_API_URL=http://127.0.0.1:3002 node backend/scripts/test-telegram-signal-flow.js
 */
import {
  inferSymbolFromInformalText,
  inferDirectionFromText,
  stripGroupRiskHints,
  enrichTelegramSignalWithSmc,
} from '../src/services/telegramSignalEnrichment.js';
import { ingestExternalSignal } from '../src/services/externalSignalIngestion.js';

const BASE = (process.env.TRADING_API_URL || 'http://127.0.0.1:3002/api').replace(/\/$/, '');

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg, detail = '') {
  console.log(`  ✗ ${msg}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n=== Telegram Signal Flow Tests ===\n');

// Unit: informal parsing
const informal = 'BSB long from here';
const sym = inferSymbolFromInformalText(informal);
const dir = inferDirectionFromText(informal);
if (sym === 'BSBUSDT') ok(`informal symbol: ${sym}`);
else fail('informal symbol', `got ${sym}`);
if (dir === 'BUY') ok(`informal direction: ${dir}`);
else fail('informal direction', `got ${dir}`);

  const stripped = stripGroupRiskHints('BTC long use 3% margin 20x leverage');
  if (!/\d+\s*%/.test(stripped) && !/20x/i.test(stripped) && !/\bmargin\b/i.test(stripped)) ok('group risk hints stripped');
  else fail('risk strip', stripped);

// Integration: enrich + validate (local, no HTTP)
console.log('\n--- SMC enrich + validate (local) ---');
try {
  const hint = {
    provider: 'Test VIP Group',
    symbol: 'BTCUSDT',
    side: 'LONG',
    entry: 0,
    stop_loss: 0,
    raw_message: informal,
    timestamp: new Date().toISOString(),
    metadata: { levels_source: 'group_hint', group_title: 'Test VIP', informal_signal: true },
    confidence: 72,
  };
  const enriched = await enrichTelegramSignalWithSmc(hint);
  if (enriched.enrichment?.ok) {
    ok(`SMC enriched ${enriched.symbol} entry=${enriched.entry_price} sl=${enriched.stop_loss} tp1=${enriched.tp1}`);
  } else {
    fail('SMC enrich', enriched.enrichment?.reason || 'unknown');
  }

  const validation = await ingestExternalSignal(
    {
      ...hint,
      symbol: enriched.symbol || 'BTCUSDT',
      side: enriched.side || 'LONG',
      entry: enriched.entry_price,
      stop_loss: enriched.stop_loss,
      tp1: enriched.tp1,
      tp2: enriched.tp2,
      tp3: enriched.tp3,
      metadata: enriched.metadata,
    },
    { validateOnly: true, allowStale: true, telegram: true },
  );
  const score = validation.validation?.score ?? 0;
  if (validation.passed && score >= 50) {
    ok(`validation passed score=${score} (threshold 50)`);
  } else {
    fail('validation', `passed=${validation.passed} score=${score} reason=${validation.reason}`);
  }
} catch (err) {
  fail('local pipeline', err.message);
}

// HTTP: audit endpoints
console.log('\n--- API audit endpoints ---');
for (const path of ['/telegram/raw?limit=5', '/telegram/parsed?limit=5', '/telegram/rejected?limit=5', '/telegram/group-memory']) {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (res.ok) ok(`GET ${path} → ${res.status}`);
    else fail(`GET ${path}`, `HTTP ${res.status}`);
  } catch (err) {
    fail(`GET ${path}`, err.message);
  }
}

console.log('\nDone.\n');
