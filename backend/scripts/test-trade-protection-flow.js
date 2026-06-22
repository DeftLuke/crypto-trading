#!/usr/bin/env node
/**
 * Trade protection tests — open, 30/40/30 scale-out, margin verify, Binance checks.
 *
 *   node scripts/test-trade-protection-flow.js DOGEUSDT --test-full --close
 *   node scripts/test-trade-protection-flow.js DOGEUSDT --test-tp1 --close
 */
import { initUserBinance, getActiveApiKeys } from '../src/services/userBinance.js';
import { getMarkPrice, getSymbolRules, roundPriceToTick, roundToStep } from '../src/services/binance.js';
import {
  verifyExchangeProtection,
  verifyBreakevenStop,
  verifyRunnerStopAtTP1,
  verifyScaleOutQuantities,
  isInitialStopLevel,
  getLivePositionQty,
  repositionAfterTP2,
} from '../src/services/tradeProtection.js';
import { calculateTPQuantities, getRunnerStopAfterTP2 } from '../src/strategy/riskManager.js';
import { sendTradeLifecycle, sendTradeUpdate, sendAlert } from '../src/services/telegram.js';
import { internalApiHeaders, internalApiUrl } from '../src/lib/internalFetch.js';
import { logEvent, updateTrade, getSupabase } from '../src/services/supabase.js';
import { positionMonitor } from '../src/jobs/positionMonitor.js';

const symbol = (process.argv[2] || 'DOGEUSDT').toUpperCase();
const shouldClose = process.argv.includes('--close');
const testTp1 = process.argv.includes('--test-tp1');
const testFull = process.argv.includes('--test-full');

function buildTestLevels(mark, direction, tickSize, tightPct = null) {
  const pct = tightPct ?? (process.argv.includes('--fast') ? 0.0012 : 0.008);
  const risk = mark * pct;
  const isLong = direction === 'LONG';
  const entry = mark;
  const stop_loss = roundPriceToTick(isLong ? entry - risk : entry + risk, tickSize);
  const tp1 = roundPriceToTick(isLong ? entry + risk : entry - risk, tickSize);
  const tp2 = roundPriceToTick(isLong ? entry + risk * 2 : entry - risk * 2, tickSize);
  return { entry, stop_loss, tp1, tp2, risk };
}

function logScaleCheck(label, check) {
  console.log(`\n  [${label}] phase=${check.phase} live=${check.liveQty} (${check.positionPct}% of original)`);
  console.log(`    expected splits: TP1=${check.tp1Qty} TP2=${check.tp2Qty} runner=${check.runnerQty}`);
  if (check.tpQtys?.length) console.log(`    open TP order qtys: ${check.tpQtys.join(', ')}`);
  console.log(`    positionOk=${check.positionOk ? '✓' : '✗'} tp1Order=${check.tp1OrderOk != null ? (check.tp1OrderOk ? '✓' : '✗') : '—'} tp2Order=${check.tp2OrderOk != null ? (check.tp2OrderOk ? '✓' : '✗') : '—'} noTp=${check.noTpOrders != null ? (check.noTpOrders ? '✓' : '✗') : '—'}`);
  console.log(`    ${check.ok ? '✅ PASS' : '❌ FAIL'}`);
}

function logSizing(result, mark) {
  const s = result.sizing || {};
  const t = result.trade || {};
  console.log('\n📐 Default risk sizing (1% equity):');
  console.log(`   Risk amount:   $${(s.riskAmount || t.risk_amount || 0).toFixed(2)} USDT`);
  console.log(`   Notional:      $${(s.notional || t.notional_usdt || 0).toFixed(2)}`);
  console.log(`   Margin:        $${(s.marginUsdt || t.margin_usdt || 0).toFixed(2)}`);
  console.log(`   Leverage:      ${t.leverage || s.leverage || '—'}x`);
  console.log(`   Quantity:      ${t.quantity}`);
  console.log(`   Entry:         ${t.entry_price}`);
  console.log(`   Implied value: $${(parseFloat(t.quantity) * mark).toFixed(2)} @ mark ${mark}`);
}

async function partialClose(symbol, direction, qty) {
  const credentials = await getActiveApiKeys();
  const side = direction === 'LONG' ? 'SELL' : 'BUY';
  const { placeMarketOrderWithCredentials } = await import('../src/services/userBinance.js');
  const { placeMarketOrder } = await import('../src/services/binance.js');
  if (credentials) {
    await placeMarketOrderWithCredentials(credentials, { symbol, side, quantity: qty, reduceOnly: true });
  } else {
    await placeMarketOrder(symbol, side, qty, true);
  }
}

async function closePosition(symbol, direction) {
  const credentials = await getActiveApiKeys();
  const { cancelAllOrdersWithCredentials, placeMarketOrderWithCredentials, getPositionRiskWithCredentials } = await import('../src/services/userBinance.js');
  const { cancelAllOrders, placeMarketOrder, getPositionRisk } = await import('../src/services/binance.js');
  const side = direction === 'LONG' ? 'SELL' : 'BUY';

  if (credentials) {
    await cancelAllOrdersWithCredentials(credentials, symbol).catch(() => {});
    const rows = await getPositionRiskWithCredentials(credentials, symbol);
    const row = rows.find((r) => r.symbol === symbol);
    const qty = Math.abs(parseFloat(row?.positionAmt || 0));
    if (qty > 0) {
      await placeMarketOrderWithCredentials(credentials, { symbol, side, quantity: qty, reduceOnly: true });
    }
  } else {
    await cancelAllOrders(symbol).catch(() => {});
    const rows = await getPositionRisk(symbol);
    const row = Array.isArray(rows) ? rows.find((r) => r.symbol === symbol) : rows;
    const qty = Math.abs(parseFloat(row?.positionAmt || 0));
    if (qty > 0) await placeMarketOrder(symbol, side, qty, true);
  }
}

async function closeStaleDbTrades(symbol) {
  const db = getSupabase();
  if (!db) return;
  const { data: rows } = await db.from('trades').select('id').eq('symbol', symbol).in('status', ['open', 'partial']);
  for (const row of rows || []) {
    await updateTrade(row.id, {
      status: 'closed',
      close_reason: 'Test cleanup — stale open trade',
      closed_at: new Date().toISOString(),
    }).catch(() => {});
  }
  if (rows?.length) console.log(`Cleaned ${rows.length} stale DB trade(s) for ${symbol}`);
}

async function fetchTradeFromDb(tradeId) {
  const db = getSupabase();
  if (!db || !tradeId) return null;
  const { data } = await db.from('trades').select('*').eq('id', tradeId).maybeSingle();
  return data;
}

async function runMonitor() {
  await positionMonitor.checkPositions();
  await new Promise((r) => setTimeout(r, 2500));
}

async function verifyBreakevenWithRetry(entry, direction, rules, attempts = 4) {
  for (let i = 0; i < attempts; i += 1) {
    const check = await verifyBreakevenStop(symbol, entry, direction, rules.tickSize);
    if (check.ok || check.trigger != null) return check;
    await runMonitor();
  }
  return verifyBreakevenStop(symbol, entry, direction, rules.tickSize);
}

async function runTp1Phase(trade, levels, rules, direction) {
  console.log('\n═══ PHASE 1: TP1 (30% close) → Breakeven SL ═══');
  const entry = parseFloat(trade.entry_price);
  const originalQty = parseFloat(trade.original_quantity || trade.quantity);
  const { tp1Qty: rawTp1 } = calculateTPQuantities(originalQty);
  const tp1Qty = roundToStep(rawTp1, rules.stepSize);

  const before = await verifyExchangeProtection(symbol);
  const slBefore = before.slOrders[0];
  if (!slBefore || !isInitialStopLevel(slBefore.triggerPrice, entry, levels.stop_loss, direction)) {
    return { ok: false, reason: 'Initial SL not correct before TP1' };
  }

  console.log(`Closing ${tp1Qty} (30%)…`);
  await partialClose(symbol, direction, tp1Qty);
  await new Promise((r) => setTimeout(r, 1500));

  let liveQty = await getLivePositionQty(symbol);
  const expectedAfterTp1 = roundToStep(originalQty - tp1Qty, rules.stepSize);
  console.log(`  Qty immediately after partial: ${liveQty} (expect ~${expectedAfterTp1})`);
  if (!liveQty || liveQty < expectedAfterTp1 * 0.95) {
    return { ok: false, reason: `Position over-closed after TP1 sim: ${liveQty} vs ~${expectedAfterTp1}` };
  }

  await runMonitor();

  let liveQtyCheck = await getLivePositionQty(symbol);
  let verify = await verifyExchangeProtection(symbol);
  let scale = verifyScaleOutQuantities({
    originalQty,
    liveQty: liveQtyCheck,
    tpOrders: verify.tpOrders,
    phase: 'after_tp1',
    rules,
  });
  let beCheck = await verifyBreakevenWithRetry(entry, direction, rules);

  for (let i = 0; i < 3 && (!scale.ok || !beCheck.ok); i += 1) {
    await runMonitor();
    liveQtyCheck = await getLivePositionQty(symbol);
    verify = await verifyExchangeProtection(symbol);
    scale = verifyScaleOutQuantities({
      originalQty,
      liveQty: liveQtyCheck,
      tpOrders: verify.tpOrders,
      phase: 'after_tp1',
      rules,
    });
    beCheck = await verifyBreakevenWithRetry(entry, direction, rules);
  }

  logScaleCheck('After TP1', scale);
  console.log(`  SL breakeven: trigger=${beCheck.trigger} expected≈${beCheck.expected?.toFixed(5)} ${beCheck.ok ? '✓' : '✗'}`);

  const dbTrade = await fetchTradeFromDb(trade.id);
  const dbOk = dbTrade?.tp1_hit && dbTrade?.sl_moved_breakeven;
  console.log(`  DB: tp1_hit=${dbTrade?.tp1_hit} sl_be=${dbTrade?.sl_moved_breakeven} qty=${dbTrade?.quantity}`);

  const ok = scale.ok && beCheck.ok && dbOk;
  await sendTradeUpdate({ ...trade, ...dbTrade }, `${ok ? '✅' : '⚠️'} TP1 (30%): qty ${liveQtyCheck} · SL→BE ${beCheck.trigger}`).catch(() => {});
  return { ok, scale, beCheck, dbTrade, liveQty: liveQtyCheck, originalQty, tp1Qty };
}

async function runTp2Phase(trade, levels, rules, direction, originalQty) {
  console.log('\n═══ PHASE 2: TP2 (40% close) → SL at TP1 ═══');
  const entry = parseFloat(trade.entry_price);
  const { tp2Qty: rawTp2 } = calculateTPQuantities(originalQty);
  const tp2Qty = roundToStep(rawTp2, rules.stepSize);

  console.log(`Closing ${tp2Qty} (40% of original)…`);
  await partialClose(symbol, direction, tp2Qty);
  await new Promise((r) => setTimeout(r, 1500));

  let liveQty = await getLivePositionQty(symbol);
  const { tp1Qty: rawTp1b } = calculateTPQuantities(originalQty);
  const tp1QtyB = roundToStep(rawTp1b, rules.stepSize);
  const expectedRunner = roundToStep(originalQty - tp1QtyB - tp2Qty, rules.stepSize);
  console.log(`  Qty after TP2 partial: ${liveQty} (expect ~${expectedRunner} runner)`);
  if (!liveQty || liveQty < expectedRunner * 0.95) {
    return { ok: false, reason: `Runner over-closed after TP2 sim: ${liveQty} vs ~${expectedRunner}` };
  }

  const mark = await getMarkPrice(symbol);
  const runnerSL = getRunnerStopAfterTP2(levels.tp1, direction, { markPrice: mark, entryPrice: entry });
  console.log(`  Placing runner SL @ ${runnerSL} on ${liveQty}…`);
  const slOk = await repositionAfterTP2({
    symbol,
    direction,
    remainQty: liveQty,
    stopPrice: runnerSL,
    tp1: levels.tp1,
    entryPrice: entry,
  });
  console.log(`  Runner SL placed: ${slOk ? '✓' : '✗'}`);

  await runMonitor();

  liveQty = await getLivePositionQty(symbol);
  console.log(`  Runner qty after reposition: ${liveQty} (expect ~${expectedRunner})`);
  if (!liveQty || liveQty < expectedRunner * 0.95) {
    return { ok: false, reason: `Runner lost after SL reposition: ${liveQty}` };
  }

  const verify = await verifyExchangeProtection(symbol);
  const scale = verifyScaleOutQuantities({
    originalQty,
    liveQty,
    tpOrders: verify.tpOrders,
    phase: 'after_tp2',
    rules,
  });
  logScaleCheck('After TP2 (30% runner)', scale);

  let tp1Check = await verifyRunnerStopAtTP1(symbol, levels.tp1, direction, rules.tickSize, entry);
  for (let i = 0; i < 3 && !tp1Check.ok; i += 1) {
    await runMonitor();
    liveQty = await getLivePositionQty(symbol);
    tp1Check = await verifyRunnerStopAtTP1(symbol, levels.tp1, direction, rules.tickSize, entry);
  }
  console.log(`  Runner SL (${tp1Check.mode}): trigger=${tp1Check.trigger} ${tp1Check.ok ? '✓' : '✗'}`);

  const dbTrade = await fetchTradeFromDb(trade.id);
  const runnerQtyOk = dbTrade?.quantity >= roundToStep(originalQty * 0.28, rules.stepSize);
  const dbOk = dbTrade?.tp2_hit && dbTrade?.sl_locked_1r && runnerQtyOk;
  console.log(`  DB: tp2_hit=${dbTrade?.tp2_hit} sl_locked=${dbTrade?.sl_locked_1r} qty=${dbTrade?.quantity} status=${dbTrade?.status}`);

  const ok = scale.ok && tp1Check.ok && dbOk && slOk;
  await sendTradeUpdate({ ...trade, ...dbTrade }, `${ok ? '✅' : '⚠️'} TP2 (40%): runner ${liveQty} (~30%) · SL→TP1 ${tp1Check.trigger}`).catch(() => {});
  return { ok, scale, tp1Check, dbTrade, liveQty };
}

async function runFullScaleOutTest(trade, levels, rules, direction, result) {
  const originalQty = parseFloat(trade.original_quantity || trade.quantity);
  const openVerify = await verifyExchangeProtection(symbol);

  console.log('\n═══ PHASE 0: Open (100%) — margin & order sizes ═══');
  logSizing(result, openVerify.markPrice);

  const openScale = verifyScaleOutQuantities({
    originalQty,
    liveQty: openVerify.positionQty,
    tpOrders: openVerify.tpOrders,
    phase: 'open',
    rules,
  });
  logScaleCheck('At open', openScale);

  const tp1 = await runTp1Phase(trade, levels, rules, direction);
  if (!tp1.ok) return { ok: false, phase: 'tp1', tp1, openScale };

  const tp2 = await runTp2Phase(trade, levels, rules, direction, originalQty);
  if (!tp2.ok) return { ok: false, phase: 'tp2', tp1, tp2, openScale };

  console.log('\n═══ SUMMARY: 30% / 40% / 30% scale-out ═══');
  console.log(`  Original qty:  ${originalQty} (100%)`);
  console.log(`  After TP1:     ${tp1.liveQty} (~70%)`);
  console.log(`  After TP2:     ${tp2.liveQty} (~30% runner)`);
  console.log(`  Margin at open: $${(result.trade?.margin_usdt || result.sizing?.marginUsdt || 0).toFixed(2)}`);
  console.log('  ✅ All scale-out phases verified on Binance + DB');

  await sendAlert(
    `✅ <b>Full scale-out test OK</b>\n${symbol}\n` +
    `100%→${originalQty} · 70%→${tp1.liveQty} · 30%→${tp2.liveQty}\n` +
    `Margin $${(result.trade?.margin_usdt || 0).toFixed(2)} · ${result.trade?.leverage}x`,
  ).catch(() => {});

  return { ok: true, openScale, tp1, tp2 };
}

async function main() {
  const mode = testFull ? 'FULL 30/40/30' : testTp1 ? 'TP1 breakeven' : 'open only';
  console.log(`\n=== Trade Protection Test: ${symbol} (${mode}) ===\n`);
  await initUserBinance();
  await closeStaleDbTrades(symbol);

  const mark = await getMarkPrice(symbol);
  const rules = await getSymbolRules(symbol);
  const direction = 'LONG';
  const levels = buildTestLevels(mark, direction, rules.tickSize);

  console.log('Mark:', mark, '| Levels:', levels);

  await sendAlert(`🧪 <b>Trade Flow Test</b> (${mode})\n${symbol} · mark <code>${mark}</code>`).catch(() => {});

  const res = await fetch(internalApiUrl('/api/execute'), {
    method: 'POST',
    headers: internalApiHeaders(),
    body: JSON.stringify({
      symbol,
      direction: 'BUY',
      stop_loss: levels.stop_loss,
      tp1: levels.tp1,
      tp2: levels.tp2,
      use_risk_sizing: true,
      manual_approved: true,
      test_levels_refreshed: true,
      source: 'trade-flow-test',
    }),
  });
  const result = await res.json();

  if (!res.ok || !result.success) {
    console.error('Execute failed:', result);
    await sendAlert(`❌ Test failed: ${result.error || 'execute error'}`).catch(() => {});
    process.exit(1);
  }

  const trade = result.trade;
  console.log('\n✅ Opened:', trade.id, '| qty', trade.quantity);

  await new Promise((r) => setTimeout(r, 1500));

  let protectionOk = true;
  let fullResult = null;

  if (testFull) {
    fullResult = await runFullScaleOutTest(trade, levels, rules, direction, result);
    protectionOk = fullResult.ok;
  } else if (testTp1) {
    const tp1 = await runTp1Phase(trade, levels, rules, direction);
    protectionOk = tp1.ok;
  } else {
    const verify = await verifyExchangeProtection(symbol);
    logSizing(result, verify.markPrice);
    protectionOk = verify.hasPosition && verify.slCount >= 1 && verify.tpCount >= 2;
  }

  await logEvent('info', 'tradeFlowTest', mode, { symbol, tradeId: trade.id, protectionOk, fullResult });

  if (shouldClose || testFull || testTp1) {
    console.log('\nClosing remainder…');
    await closePosition(symbol, direction);
    if (trade?.id) {
      await updateTrade(trade.id, {
        status: 'closed',
        close_reason: 'Trade flow test cleanup',
        closed_at: new Date().toISOString(),
      }).catch(() => {});
    }
    await sendTradeLifecycle('trade.closed', { trade, message: 'Test cleanup' }).catch(() => {});
  }

  console.log(protectionOk ? '\n✅ ALL CHECKS PASSED' : '\n❌ TEST FAILED');
  process.exit(protectionOk ? 0 : 2);
}

main().catch(async (err) => {
  console.error(err);
  await sendAlert(`❌ Test error: ${err.message}`).catch(() => {});
  try {
    await closePosition(process.argv[2] || 'DOGEUSDT', 'LONG');
  } catch { /* ignore */ }
  process.exit(1);
});
