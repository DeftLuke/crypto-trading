#!/usr/bin/env node
/**
 * Test informal VIP name-only → parse → Institutional SMC v2 → validate.
 *
 * Usage:
 *   node backend/scripts/test-telegram-informal-pipeline.js
 *   node backend/scripts/test-telegram-informal-pipeline.js "Btr long" "Koma Short"
 */
import {
  inferSymbolFromInformalText,
  inferDirectionFromText,
  stripGroupRiskHints,
  enrichTelegramSignalWithSmc,
} from '../src/services/telegramSignalEnrichment.js';
import { ingestExternalSignal } from '../src/services/externalSignalIngestion.js';
import { checkInstitutionalSmcHealth } from '../src/services/institutionalSmcClient.js';

const DEFAULT_CASES = [
  'Btr long',
  'Koma Short',
  'SPX SHORT',
  'MIRA LONG 0.056',
  'Esports short 0.682',
  'Bless long now',
  '#UB Short 0.082',
  'short Agt cmp stoploss 0.0291',
];

const cases = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CASES;

function row(label, value) {
  console.log(`  ${label.padEnd(16)} ${value}`);
}

console.log('\n=== Telegram Informal → Institutional SMC v2 Pipeline ===\n');

const health = await checkInstitutionalSmcHealth();
row('SMC engine', health.ok ? 'online' : `offline — ${health.error || 'unknown'}`);

let passed = 0;
let failed = 0;

for (const raw of cases) {
  console.log(`\n--- "${raw}" ---`);
  const text = stripGroupRiskHints(raw);
  const symbol = inferSymbolFromInformalText(text);
  const direction = inferDirectionFromText(text);
  row('parse symbol', symbol || 'FAIL');
  row('parse direction', direction || 'FAIL');

  if (!symbol || !direction) {
    failed += 1;
    row('result', 'SKIP — could not parse name/direction');
    continue;
  }

  const hint = {
    provider: 'Test VIP',
    symbol,
    side: direction === 'SELL' ? 'SHORT' : 'LONG',
    raw_message: raw,
    timestamp: new Date().toISOString(),
    parser: 'informal-test',
    metadata: { informal_signal: true, informal_format: true, group_title: 'Test VIP' },
  };

  let enriched;
  try {
    enriched = await enrichTelegramSignalWithSmc(hint);
  } catch (err) {
    failed += 1;
    row('result', `ERROR — ${err.message}`);
    continue;
  }

  if (!enriched.enrichment?.ok) {
    failed += 1;
    row('SMC verify', `REJECT — ${enriched.enrichment.reason}`);
    row('inst. score', enriched.enrichment.smc_score ?? enriched.metadata?.institutional_score ?? '-');
    row('mark price', enriched.enrichment.mark_price ?? '-');
    if (enriched.enrichment.setup_direction) {
      row('setup dir', enriched.enrichment.setup_direction);
    }
    continue;
  }

  row('SMC engine', enriched.metadata?.smc_engine || '-');
  row('inst. score', enriched.metadata?.institutional_score ?? enriched.enrichment.smc_score);
  row('mark price', enriched.enrichment.mark_price ?? '-');
  row('entry', enriched.entry_price);
  row('stop loss', enriched.stop_loss);
  row('TP1', enriched.tp1);
  row('TP2', enriched.tp2);
  row('TP3', enriched.tp3);
  row('direction', `${enriched.side} (${enriched.direction})`);

  const validation = await ingestExternalSignal(
    {
      ...hint,
      symbol: enriched.symbol,
      side: enriched.side,
      direction: enriched.direction,
      entry: enriched.entry_price,
      entry_price: enriched.entry_price,
      stop_loss: enriched.stop_loss,
      tp1: enriched.tp1,
      tp2: enriched.tp2,
      tp3: enriched.tp3,
      metadata: enriched.metadata,
    },
    { validateOnly: true, allowStale: true, telegram: true },
  );

  const score = validation.validation?.score ?? 0;
  const minScore = validation.validation?.checks?.find((c) => c.rule === 'validation_score')?.message?.split('/')?.[1] || 50;
  row('validate score', `${score} (min ${minScore})`);
  row('passed', validation.passed ? 'YES — ready for auto-execute' : `NO — ${validation.reason}`);

  if (validation.passed) passed += 1;
  else failed += 1;

  const inst = validation.validation?.institutional;
  if (inst?.setup_direction) {
    row('setup dir', inst.setup_direction);
  }
  if (enriched.metadata?.institutional_explanation) {
    row('SMC summary', enriched.metadata.institutional_explanation.slice(0, 120));
  }
}

console.log(`\n=== Summary: ${passed} passed / ${failed} failed / ${cases.length} total ===\n`);

process.exit(failed > 0 ? 1 : 0);
