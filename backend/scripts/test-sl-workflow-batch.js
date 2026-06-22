#!/usr/bin/env node
/**
 * Batch SL-moving workflow test — tight TP/SL so levels hit from live price quickly.
 *
 *   node scripts/test-sl-workflow-batch.js DOGEUSDT XRPUSDT ADAUSDT --tight 0.0012
 *   node scripts/test-sl-workflow-batch.js --symbols DOGE,XRP,ADA --direction SHORT --cleanup
 */
import { initUserBinance, getActiveApiKeys } from '../src/services/userBinance.js';
import { getMarkPrice, getSymbolRules, roundPriceToTick } from '../src/services/binance.js';
import {
  verifyExchangeProtection,
  verifyBreakevenStop,
  verifyRunnerStopAtTP1,
  getLivePositionQty,
} from '../src/services/tradeProtection.js';
import { getBreakevenSL } from '../src/strategy/riskManager.js';
import { internalApiHeaders, internalApiUrl } from '../src/lib/internalFetch.js';
import { getSupabase, updateTrade } from '../src/services/supabase.js';
import { positionMonitor } from '../src/jobs/positionMonitor.js';
import { sendAlert } from '../src/services/telegram.js';

const args = process.argv.slice(2);
const tightPct = parseFloat(args.find((a, i) => args[i - 1] === '--tight') || '0.0012');
const directionArg = (args.find((a, i) => args[i - 1] === '--direction') || 'SHORT').toUpperCase();
const shouldCleanup = args.includes('--cleanup');
const pollMs = parseInt(args.find((a, i) => args[i - 1] === '--poll') || '8000', 10);
const maxWaitMs = parseInt(args.find((a, i) => args[i - 1] === '--max-wait') || '900000', 10);

function parseSymbols(argv) {
  const fromFlag = argv.find((a, i) => argv[i - 1] === '--symbols');
  if (fromFlag) {
    return fromFlag.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
      .map((s) => (s.endsWith('USDT') ? s : `${s}USDT`))
      .filter(isValidSymbol);
  }
  const skip = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) skip.add(i + 1);
  }
  return argv
    .filter((a, i) => !a.startsWith('--') && !skip.has(i) && !['SHORT', 'LONG', 'BUY', 'SELL'].includes(a.toUpperCase()))
    .map((s) => s.toUpperCase())
    .map((s) => (s.endsWith('USDT') ? s : `${s}USDT`))
    .filter(isValidSymbol);
}

function isValidSymbol(s) {
  return /^[A-Z0-9]{2,20}USDT$/.test(s) && !/^\d+USDT$/.test(s);
}

const symbols = parseSymbols(args);
if (symbols.length === 0) {
  symbols.push('DOGEUSDT', 'XRPUSDT', 'ADAUSDT', 'TRXUSDT', 'LINKUSDT');
}

export function buildFastTestLevels(mark, direction, tickSize, pct = tightPct) {
  const risk = mark * pct;
  const isLong = direction === 'LONG';
  const entry = mark;
  const stop_loss = roundPriceToTick(isLong ? entry - risk : entry + risk, tickSize);
  const tp1 = roundPriceToTick(isLong ? entry + risk : entry - risk, tickSize);
  const tp2 = roundPriceToTick(isLong ? entry + risk * 2 : entry - risk * 2, tickSize);
  const tp3 = roundPriceToTick(isLong ? entry + risk * 3 : entry - risk * 3, tickSize);
  return { entry, stop_loss, tp1, tp2, tp3, risk, tightPct: pct };
}

async function fetchTrade(tradeId) {
  const db = getSupabase();
  if (!db || !tradeId) return null;
  const { data } = await db.from('trades').select('*').eq('id', tradeId).maybeSingle();
  return data;
}

async function closeSymbolPosition(symbol, direction) {
  const credentials = await getActiveApiKeys();
  const side = direction === 'LONG' ? 'SELL' : 'BUY';
  const { cancelAllOrdersWithCredentials, placeMarketOrderWithCredentials, getPositionRiskWithCredentials } = await import('../src/services/userBinance.js');
  if (!credentials) return;
  await cancelAllOrdersWithCredentials(credentials, symbol).catch(() => {});
  const rows = await getPositionRiskWithCredentials(credentials, symbol);
  const row = (Array.isArray(rows) ? rows : []).find((r) => r.symbol === symbol);
  const qty = Math.abs(parseFloat(row?.positionAmt || 0));
  if (qty > 0) {
    await placeMarketOrderWithCredentials(credentials, { symbol, side, quantity: qty, reduceOnly: true });
  }
  const db = getSupabase();
  if (db) {
    const { data: open } = await db.from('trades').select('id').eq('symbol', symbol).in('status', ['open', 'partial']);
    for (const t of open || []) {
      await updateTrade(t.id, {
        status: 'closed',
        close_reason: 'SL workflow test cleanup',
        closed_at: new Date().toISOString(),
      }).catch(() => {});
    }
  }
}

async function openTestTrade(symbol, direction, levels) {
  const apiDirection = direction === 'LONG' ? 'BUY' : 'SELL';
  const res = await fetch(internalApiUrl('/api/execute'), {
    method: 'POST',
    headers: internalApiHeaders(),
    body: JSON.stringify({
      symbol,
      direction: apiDirection,
      stop_loss: levels.stop_loss,
      tp1: levels.tp1,
      tp2: levels.tp2,
      tp3: levels.tp3,
      use_risk_sizing: true,
      manual_approved: true,
      test_levels_refreshed: true,
      source: 'sl-workflow-batch-test',
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Execute failed ${res.status}`);
  }
  return body;
}

async function runMonitorTick() {
  await positionMonitor.checkPositions();
}

function phaseLabel(trade) {
  if (!trade || trade.status === 'closed') return 'closed';
  if (trade.tp2_hit) return 'runner/trail';
  if (trade.tp1_hit) return 'after_tp1';
  return 'open';
}

async function waitForPhases(symbol, tradeId, direction, levels, rules) {
  const started = Date.now();
  const seen = { open: false, tp1: false, tp2: false, closed: false };
  const checks = { tp1Sl: null, tp2Sl: null };
  let lastTrade = null;

  while (Date.now() - started < maxWaitMs) {
    await runMonitorTick();
    await new Promise((r) => setTimeout(r, pollMs));

    const trade = await fetchTrade(tradeId);
    lastTrade = trade;
    if (!trade) break;

    const mark = await getMarkPrice(symbol);
    const verify = await verifyExchangeProtection(symbol);
    const liveQty = await getLivePositionQty(symbol);
    const phase = phaseLabel(trade);

    console.log(
      `  [${symbol}] mark=${mark} phase=${phase} qty=${liveQty} ` +
      `tp1=${trade.tp1_hit} tp2=${trade.tp2_hit} SL=${trade.stop_loss} ` +
      `ex SL×${verify.slCount} TP×${verify.tpCount}`,
    );

    if (!seen.open && verify.slCount >= 1 && verify.tpCount >= 1) {
      seen.open = true;
      console.log(`  ✅ ${symbol} OPEN — SL + TP1 on exchange`);
    }

    if (trade.tp1_hit && !seen.tp1) {
      seen.tp1 = true;
      const be = await verifyBreakevenStop(symbol, trade.entry_price, direction, rules.tickSize);
      checks.tp1Sl = be;
      console.log(
        `  ✅ ${symbol} TP1 HIT — DB qty=${trade.quantity} SL→BE trigger=${be.trigger} ok=${be.ok}`,
      );
    }

    if (trade.tp2_hit && !seen.tp2) {
      seen.tp2 = true;
      const runner = await verifyRunnerStopAtTP1(symbol, levels.tp1, direction, rules.tickSize, trade.entry_price);
      checks.tp2Sl = runner;
      console.log(
        `  ✅ ${symbol} TP2 HIT — runner qty=${trade.quantity} SL mode=${runner.mode} ok=${runner.ok}`,
      );
    }

    if (trade.status === 'closed' && !seen.closed) {
      seen.closed = true;
      console.log(`  ✅ ${symbol} CLOSED — pnl=${trade.pnl} reason=${trade.close_reason}`);
      break;
    }

    if (seen.tp2 && trade.tp2_hit && verify.slCount >= 1 && verify.tpCount === 0) {
      console.log(`  ✅ ${symbol} RUNNER phase — trailing active, SL on exchange`);
      if (shouldCleanup) break;
    }
  }

  return { trade: lastTrade, seen, checks, elapsedMs: Date.now() - started };
}

async function testSymbol(symbol, direction) {
  console.log(`\n${'='.repeat(60)}\n  ${symbol} ${direction} (tight ${(tightPct * 100).toFixed(2)}%)\n${'='.repeat(60)}`);

  await closeSymbolPosition(symbol, direction);

  const mark = await getMarkPrice(symbol);
  const rules = await getSymbolRules(symbol);
  const levels = buildFastTestLevels(mark, direction, rules.tickSize, tightPct);

  console.log(`  Mark ${mark} | SL ${levels.stop_loss} | TP1 ${levels.tp1} | TP2 ${levels.tp2}`);
  console.log(`  Distances: SL ${((Math.abs(levels.stop_loss - mark) / mark) * 100).toFixed(3)}% TP1 ${((Math.abs(levels.tp1 - mark) / mark) * 100).toFixed(3)}%`);

  const result = await openTestTrade(symbol, direction, levels);
  const trade = result.trade;
  console.log(`  Opened trade ${trade.id} qty=${trade.quantity} margin=$${Number(trade.margin_usdt).toFixed(2)}`);

  await new Promise((r) => setTimeout(r, 2000));
  await runMonitorTick();
  await new Promise((r) => setTimeout(r, 1500));
  let openVerify = await verifyExchangeProtection(symbol);
  if (!openVerify.slCount && openVerify.tpCount) {
    await runMonitorTick();
    await new Promise((r) => setTimeout(r, 1000));
    openVerify = await verifyExchangeProtection(symbol);
  }
  const openOk = openVerify.hasPosition && openVerify.slCount >= 1 && openVerify.tpCount >= 1;
  console.log(`  Protection at open: SL×${openVerify.slCount} TP×${openVerify.tpCount} ${openOk ? '✅' : '❌'}`);

  if (!openOk) {
    return { symbol, ok: false, phase: 'open', error: 'Missing SL or TP1 at open', trade };
  }

  const wait = await waitForPhases(symbol, trade.id, direction, levels, rules);

  if (shouldCleanup && wait.trade?.status !== 'closed') {
    console.log(`  Cleaning up ${symbol}…`);
    await closeSymbolPosition(symbol, direction);
    if (wait.trade?.id) {
      await updateTrade(wait.trade.id, {
        status: 'closed',
        close_reason: 'SL workflow batch test cleanup',
        closed_at: new Date().toISOString(),
      }).catch(() => {});
    }
  }

  const ok = wait.seen.open && wait.seen.tp1 && (wait.checks.tp1Sl?.ok !== false);
  const partial = wait.seen.open && wait.seen.tp1;
  return {
    symbol,
    ok,
    partial,
    openOk,
    seen: wait.seen,
    checks: wait.checks,
    trade: wait.trade,
    elapsedMs: wait.elapsedMs,
    levels,
  };
}

async function main() {
  console.log(`\n🧪 SL Workflow Batch Test — ${symbols.length} pairs, ${directionArg}, tight ${(tightPct * 100).toFixed(2)}%\n`);
  await initUserBinance();
  await sendAlert(
    `🧪 <b>SL workflow batch test</b>\n${symbols.join(', ')}\n${directionArg} · tight ${(tightPct * 100).toFixed(2)}%`,
  ).catch(() => {});

  const results = [];
  for (const symbol of symbols) {
    try {
      results.push(await testSymbol(symbol, directionArg));
    } catch (err) {
      console.error(`  ❌ ${symbol} failed:`, err.message);
      results.push({ symbol, ok: false, error: err.message });
    }
  }

  console.log(`\n${'='.repeat(60)}\n  SUMMARY\n${'='.repeat(60)}`);
  for (const r of results) {
    const status = r.ok ? '✅ PASS' : r.seen?.tp1 ? '⚠️ PARTIAL' : '❌ FAIL';
    console.log(`  ${status} ${r.symbol} — open=${r.seen?.open ?? r.openOk} tp1=${r.seen?.tp1 ?? false} tp2=${r.seen?.tp2 ?? false} ${r.error || ''}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const tp1Hits = results.filter((r) => r.seen?.tp1).length;
  await sendAlert(
    `🧪 <b>SL batch test done</b>\n${passed}/${results.length} full pass · ${tp1Hits}/${results.length} TP1+SL move\n` +
    results.map((r) => `${r.ok ? '✅' : r.partial ? '⚠️' : '❌'} ${r.symbol}${r.seen?.tp1 ? ' TP1✓' : ''}`).join('\n'),
  ).catch(() => {});

  process.exit(passed >= Math.min(3, Math.ceil(results.length * 0.6)) ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
