import { Router } from 'express';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../config/index.js';
import { broadcastTelegramPipeline, broadcastTradeEvent } from '../services/wsBroadcast.js';
import { generateSignal } from '../strategy/signalEngine.js';
import { validateTradeExecution } from '../strategy/riskManager.js';
import {
  saveSignal,
  saveTrade,
  updateTrade,
  getSignals,
  getTrades,
  getPairStats,
  getPerformanceMetrics,
  getOpenTrades,
  logEvent,
  updateSignal,
  getTradeLessons,
  getLessonStats,
  getSignalOutcomes,
  upsertTelegramSignalSources,
  getTelegramSignalSources,
  updateTelegramSignalSource,
  saveTelegramSignalMessage,
  getTelegramSignalMessageByChatAndId,
  getTelegramSignalMessages,
  supersedeTelegramMessagesForChat,
  supersedeAllTelegramMessagesForChat,
} from '../services/supabase.js';
import {
  recordTelegramMessageAudit,
  getTelegramRawMessages,
  getTelegramRawMessageById,
  getParsedSignalsRaw,
  getTelegramSignalRejections,
  getTelegramGroupMemory,
  upsertTelegramGroupMemory,
} from '../services/telegramAudit.js';
import {
  getKlines,
  parseKlines,
  getUsdtBalance,
  getPositionRisk,
  setLeverage,
  placeMarketOrder,
  placeMarketOrderResilient,
  placeStopMarketOrder,
  placeTakeProfitOrder,
  cancelAllOrders,
  calculateOrderQty,
  resolveOrderSizing,
  resolveRiskBasedOrderSizing,
  setLeverageWithFallback,
  protectionTriggerIssues,
  getMarkPrice,
  getSymbolRules,
  roundPriceToTick,
  isBlockedTradeSymbol,
} from '../services/binance.js';
import { getFreshMarkPrice } from '../services/markPrice.js';
import { attachIndicators } from '../strategy/indicators.js';
import { analyzeSMC } from '../strategy/smc.js';
import { runMTFAnalysis, getMTFBias } from '../strategy/mtfAnalysis.js';
import { positionMonitor } from '../jobs/positionMonitor.js';
import { sendAlert, sendSignalNotification, sendTradeLifecycle, sendTradeUpdate } from '../services/telegram.js';
import { getSupabase } from '../services/supabase.js';
import { checkOllamaHealth } from '../services/ollama.js';
import { checkOpenClawHealth } from '../services/openclaw.js';
import { checkN8nHealth } from '../services/n8n.js';
import { askTradingAgent, buildTradingContext, getLessonsSummary } from '../services/aiAgent.js';
import { askPersonalAssistant } from '../services/personalAssistant.js';
import { scheduleSignalOutcomeCheck } from '../jobs/signalOutcomeTracker.js';
import { extractLineageFromSignal } from '../services/signalLineage.js';
import {
  getSimplePrices,
  getOHLC,
  symbolToCoinId,
  intervalToCgDays,
} from '../services/coingecko.js';
import { getChartSetups } from '../services/chartSetups.js';
import { getScannerState, setScannerRunning } from '../services/scannerState.js';
import { triggerScan } from '../jobs/marketScanner.js';
import { getStrategyStats, getLearnedPatterns } from '../services/tradeLearner.js';
import { getStrategy, listStrategies } from '../strategies/registry.js';
import { listCatalog, getBacktestRankings } from '../services/strategyCatalog.js';
import { getSignalPerformanceReport, getRecentLessons, getSignalPerformanceFeed } from '../services/signalAnalytics.js';
import { isExchangeBlocked, getExchangeBlockInfo, noteExchangeRateLimit } from '../services/exchangeRateLimit.js';
import { findDbTradeForLivePosition, reconcileLivePosition, reconcileAllFlatExchangeTrades } from '../services/tradeReconcile.js';
import { finalizeTradeClose, reconcileFlatExchangeTrade } from '../services/tradeClose.js';
import { resolveTradePnl, resolveClosedTradeSizing, fetchExchangeRealizedPnl } from '../services/tradePnl.js';
import { validateBacktestGate } from '../services/strategyGate.js';
import {
  saveUserApiKeys,
  saveUserTradingMode,
  loadUserCredentials,
  testUserConnection,
  hasApiKeysConfigured,
  getActiveApiKeys,
  getBalanceForUser,
  executeWithCredentials,
  placeMarketOrderWithCredentials,
  placeStopMarketOrderWithCredentials,
  placeTakeProfitOrderWithCredentials,
  cancelAllOrdersWithCredentials,
  getPositionRiskWithCredentials,
  setRuntimeApiKeys,
  setTradingMode,
  setLeverageWithCredentials,
} from '../services/userBinance.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { requireInternalOrAuth, strictRateLimit } from '../middleware/security.js';
import { internalApiHeaders, internalApiUrl } from '../lib/internalFetch.js';
import { getAllFuturesSymbols } from '../services/binance.js';
import {
  pingFreqtrade,
  getFreqtradeStatus,
  getFreqtradeProfit,
  getFreqtradeBalance,
  getFreqtradeTrades,
  getFreqtradeTrade,
  listFreqtradeStrategies,
  getFreqtradeConfig,
  startFreqtradeBot,
  stopFreqtradeBot,
  pauseFreqtradeBot,
  stopBuyFreqtrade,
  reloadFreqtradeConfig,
  getFreqtradeDaily,
  getFreqtradeWeekly,
  getFreqtradeMonthly,
  getFreqtradePerformance,
  getFreqtradeStats,
  getFreqtradeCount,
  getFreqtradeWhitelist,
  getFreqtradeBlacklist,
  addFreqtradeBlacklist,
  deleteFreqtradeBlacklist,
  getFreqtradeLocks,
  addFreqtradeLock,
  deleteFreqtradeLock,
  getFreqtradeLogs,
  getFreqtradeHealth,
  getFreqtradeVersion,
  getFreqtradeSysinfo,
  getFreqtradePairCandles,
  getFreqtradePublicInfo,
  setFreqtradeStrategy,
  forceExitFreqtrade,
  forceEnterFreqtrade,
  cancelFreqtradeOpenOrder,
  deleteFreqtradeTrade,
  reloadFreqtradeTrade,
  getFreqtradeStatsBundle,
} from '../services/freqtrade.js';
import {
  proxyResearch,
  getControlSettings,
  updateControlSettings,
  getControlDashboard,
  startAllControlServices,
  postControlSignal,
  approveControlTrade,
  rejectControlApproval,
  triggerDemoSignal,
  getLatestSignal,
  getPendingApprovals,
} from '../services/researchApi.js';
import {
  isDuneConfigured,
  testDuneConnection,
  runQueryAndWait,
  runSqlAndWait,
  executeQuery,
  executeSql,
  getExecutionResults,
} from '../services/dune.js';
import {
  searchCryptoPairs,
  getTvChart,
  testTradingViewConnection,
  binanceSymbolToTvId,
} from '../services/tradingview.js';
import {
  getWalletScannerStatus,
  refreshWalletsFromDune,
  runFullWalletScan,
  runConsensusScan,
  dailyWalletMaintenance,
  setWalletScannerRunning,
  updateWalletScannerConfig,
  getWalletsList,
  importWalletsFromRows,
  fetchStoreAndImportDune,
  getDuneStoreStatus,
} from '../services/walletScanner/index.js';
import { loadSignals } from '../services/walletScanner/store.js';
import { startWalletScannerJob, stopWalletScannerJob, triggerWalletScan, triggerDailyMaintenance } from '../jobs/walletScannerJob.js';
import { ingestExternalSignal } from '../services/externalSignalIngestion.js';
import {
  placeInitialTradeProtection,
  placeScaleOutTakeProfits,
  verifyExchangeProtection,
  ensureTradeProtection,
} from '../services/tradeProtection.js';
import { calculateTPQuantities } from '../strategy/riskManager.js';
import { computeOpenExposure, computeOpenMargin } from '../services/tradePnl.js';
import { finalizeTradeOpen } from '../services/tradeExecution.js';
import {
  acquireExecutionLock,
  releaseExecutionLock,
  logDuplicateBlocked,
} from '../services/executionLock.js';
import { getCandleCoverage } from '../services/candleStore.js';
import { runPythonBacktest } from '../services/pythonBacktest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function runBacktestIsolated(options) {
  return new Promise((resolve, reject) => {
    const workerPath = join(__dirname, '../jobs/backtestWorker.js');
    const child = fork(workerPath, [], { env: process.env });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('Backtest timed out after 5 minutes. First run may sync candle data — retry or use 1M period.'));
    }, 300000);

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.on('message', (msg) => {
      finish(() => (msg.ok ? resolve(msg.result) : reject(new Error(msg.error || 'Backtest failed'))));
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('exit', (code) => {
      if (!settled && code !== 0) {
        finish(() => reject(new Error(`Backtest process crashed (code ${code}). Often OOM on long periods — use 15m TF or shorter period.`)));
      }
    });
    child.send(options);
  });
}

const router = Router();

function toNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundApiQty(qty) {
  return parseFloat(Number(qty).toFixed(8));
}

function tradeLeverage(trade) {
  return parseInt(trade.leverage || config.telegram?.defaultLeverage || '50', 10);
}

function positionRowToExchangePosition(row) {
  const positionAmt = toNumber(row?.positionAmt);
  if (!row || positionAmt === 0) return null;
  const leverage = parseInt(row.leverage || config.telegram?.defaultLeverage || '50', 10);
  const notional = Math.abs(toNumber(row.notional));
  return {
    symbol: row.symbol,
    quantity: Math.abs(positionAmt),
    direction: positionAmt > 0 ? 'LONG' : 'SHORT',
    entry_price: toNumber(row.entryPrice),
    current_price: toNumber(row.markPrice),
    unrealized_pnl: toNumber(row.unRealizedProfit),
    leverage,
    margin: toNumber(row.isolatedMargin) || (leverage > 0 ? notional / leverage : notional),
    notional,
    liquidation_price: toNumber(row.liquidationPrice),
  };
}

async function getExchangePositionRows(symbol = null) {
  const credentials = await getActiveApiKeys();
  return credentials
    ? getPositionRiskWithCredentials(credentials, symbol)
    : getPositionRisk(symbol);
}

async function getExchangePosition(symbol) {
  try {
    const rows = await getExchangePositionRows(symbol);
    const row = Array.isArray(rows) ? rows.find((p) => p.symbol === symbol) : rows;
    return positionRowToExchangePosition(row);
  } catch {
    return null;
  }
}

let positionsCache = null;
let positionsCacheAt = 0;
const POSITIONS_CACHE_MS = 15_000;

async function listExchangePositions() {
  try {
    const { getCachedPositions, isUserStreamLive } = await import('../services/binanceUserStream.js');
    if (isUserStreamLive()) {
      const live = getCachedPositions();
      positionsCache = live;
      positionsCacheAt = Date.now();
      return live;
    }
  } catch { /* fall through to REST */ }

  if (isExchangeBlocked() && positionsCache) {
    return positionsCache;
  }
  if (positionsCache && Date.now() - positionsCacheAt < POSITIONS_CACHE_MS) {
    return positionsCache;
  }
  try {
    const rows = await getExchangePositionRows();
    const list = (Array.isArray(rows) ? rows : [])
      .map(positionRowToExchangePosition)
      .filter(Boolean);
    positionsCache = list;
    positionsCacheAt = Date.now();
    return list;
  } catch (err) {
    noteExchangeRateLimit(err.message);
    await logEvent('warn', 'exchange.positions', `Position sync failed: ${err.message}`);
    return positionsCache || [];
  }
}

function exchangePositionToTrade(position) {
  return {
    id: `exchange:${position.symbol}`,
    position_id: `exchange:${position.symbol}`,
    exchange_only: true,
    symbol: position.symbol,
    direction: position.direction,
    entry_price: position.entry_price,
    quantity: position.quantity,
    stop_loss: null,
    tp1: null,
    tp2: null,
    tp3: null,
    pnl: 0,
    status: 'open',
    opened_at: null,
  };
}

async function loadActionTrade(tradeId) {
  if (String(tradeId || '').startsWith('exchange:')) {
    const symbol = String(tradeId).slice('exchange:'.length).toUpperCase();
    const live = await getExchangePosition(symbol);
    if (!live) return { trade: null, live: null, persisted: false };
    return { trade: exchangePositionToTrade(live), live, persisted: false };
  }

  const db = getSupabase();
  const { data: trade, error } = await db.from('trades').select('*').eq('id', tradeId).single();
  if (error || !trade) return { trade: null, live: null, persisted: false };
  return { trade, live: await getExchangePosition(trade.symbol), persisted: true };
}

async function enrichTrade(trade, exchangePosition = null) {
  const entry = toNumber(trade.entry_price);
  const isLive = ['open', 'partial'].includes(trade.status);
  const live = exchangePosition || (isLive ? await getExchangePosition(trade.symbol) : null);
  const quantity = isLive ? (live?.quantity || toNumber(trade.quantity)) : toNumber(trade.original_quantity || trade.quantity);
  const leverage = live?.leverage || tradeLeverage(trade);
  let currentPrice = live?.current_price;
  if (!currentPrice && isLive) {
    currentPrice = await getFreshMarkPrice(trade.symbol).catch(() => null);
    if (!currentPrice) currentPrice = await getMarkPrice(trade.symbol).catch(() => entry);
  }
  if (!currentPrice) currentPrice = toNumber(trade.exit_price, entry);
  const direction = trade.direction;

  const pnlBreakdown = await resolveTradePnl(trade, live, currentPrice);
  const closedSizing = !isLive ? resolveClosedTradeSizing(trade) : null;
  const notional = isLive
    ? (live?.notional || currentPrice * toNumber(live?.quantity || trade.quantity))
    : closedSizing.notional;
  const margin = isLive
    ? (live?.margin || (leverage > 0 ? notional / leverage : notional))
    : closedSizing.margin;
  const displayQty = isLive ? toNumber(live?.quantity || trade.quantity) : closedSizing.quantity;
  const runnerMargin = margin;
  const roeBase = isLive && (trade.tp1_hit || trade.tp2_hit) ? runnerMargin : margin;
  const unrealizedOnly = pnlBreakdown.unrealized;

  let protection = null;
  let protectionIssues = [];
  if (isLive) {
    try {
      protection = await verifyExchangeProtection(trade.symbol);
    } catch {
      protection = null;
    }
  }

  let displaySl = toNumber(trade.stop_loss ?? trade.initial_stop_loss);
  let displayTp1 = toNumber(trade.tp1);
  let displayTp2 = toNumber(trade.tp2);
  if (protection?.hasPosition) {
    const slPx = parseFloat(protection.slOrders?.[0]?.triggerPrice);
    if (Number.isFinite(slPx) && slPx > 0) displaySl = slPx;

    const tpOrders = (protection.tpOrders || [])
      .map((o) => ({ price: parseFloat(o.triggerPrice), qty: parseFloat(o.quantity || 0) }))
      .filter((o) => Number.isFinite(o.price) && o.price > 0);
    if (tpOrders.length > 0) {
      const origQty = toNumber(trade.original_quantity || trade.quantity || live?.quantity);
      const { tp1Qty, tp2Qty } = calculateTPQuantities(origQty);
      const matchTp = (targetQty, fallback) => {
        if (!targetQty || tpOrders.length === 0) return fallback;
        const hit = tpOrders.find((o) => o.qty > 0 && Math.abs(o.qty - targetQty) / targetQty <= 0.06);
        return hit?.price ?? fallback;
      };
      if (!trade.tp1_hit) displayTp1 = matchTp(tp1Qty, tpOrders[0]?.price ?? displayTp1);
      else if (!trade.tp2_hit) displayTp2 = matchTp(tp2Qty, tpOrders[0]?.price ?? displayTp2);
    }
    if (protection.slCount < 1) protectionIssues.push('missing_sl');
    const minTp = trade.tp1_hit ? (trade.tp2_hit ? 0 : 1) : 1;
    if (protection.tpCount < minTp) protectionIssues.push('missing_tp');
  } else if (isLive && live?.quantity > 0) {
    protectionIssues.push('unverified');
  }

  const protectionOk = protection?.hasPosition && protection.slCount >= 1
    && protection.tpCount >= (trade.tp1_hit ? (trade.tp2_hit ? 0 : 1) : 1);

  return {
    ...trade,
    entry_price: live?.entry_price || entry,
    quantity: displayQty,
    exchange_quantity: live?.quantity,
    current_price: currentPrice,
    stop_loss: displaySl || trade.stop_loss,
    tp1: displayTp1 || trade.tp1,
    tp2: displayTp2 || trade.tp2,
    realized_pnl: pnlBreakdown.realized,
    unrealized_pnl: isLive ? unrealizedOnly : 0,
    exchange_realized_pnl: pnlBreakdown.exchangeSynced ? pnlBreakdown.realized : trade.exchange_realized_pnl,
    profit_usd: isLive ? pnlBreakdown.total : toNumber(trade.exchange_realized_pnl ?? trade.pnl),
    profit_percent: closedSizing?.profit_percent ?? (entry && displayQty ? (pnlBreakdown.total / (entry * displayQty)) * 100 : 0),
    pnl_usd: isLive ? pnlBreakdown.total : toNumber(trade.exchange_realized_pnl ?? trade.pnl),
    pnl_pct: closedSizing?.profit_percent ?? (entry && displayQty ? (pnlBreakdown.total / (entry * displayQty)) * 100 : 0),
    roe_pct: isLive
      ? (roeBase > 0 ? (unrealizedOnly / roeBase) * 100 : 0)
      : closedSizing.roe_pct,
    leverage,
    notional,
    margin,
    take_profit: trade.tp2_hit ? trade.tp1 : trade.tp1,
    runner_stop: trade.tp2_hit ? trade.stop_loss : null,
    position_id: trade.id,
    strategy_name: 'SMC-MTF',
    protection_ok: protectionOk,
    protection_missing: protectionIssues.length > 0,
    protection_issues: protectionIssues,
    exchange_protection: protection
      ? {
          sl_count: protection.slCount,
          tp_count: protection.tpCount,
          sl_price: protection.slOrders?.[0]?.triggerPrice ?? null,
          tp_prices: (protection.tpOrders || []).map((o) => o.triggerPrice),
          has_position: protection.hasPosition,
        }
      : undefined,
  };
}

async function enrichTrades(trades = []) {
  // Only hit the exchange for live positions. History/closed-only lists (the
  // common dashboard case) skip the Binance round-trip entirely.
  const hasLive = (trades || []).some((t) => ['open', 'partial'].includes(t.status));
  const positions = hasLive
    ? Object.fromEntries((await listExchangePositions()).map((p) => [p.symbol, p]))
    : {};
  return Promise.all((trades || []).map((trade) => enrichTrade(trade, positions[trade.symbol])));
}

async function getMergedOpenTrades(rawOpen = []) {
  const LIST_MIN_NOTIONAL_USDT = 0.05;
  const allLive = await listExchangePositions();
  const openBySymbol = new Map((rawOpen || []).map((trade) => [trade.symbol, trade]));
  const db = getSupabase();

  const livePositions = allLive.filter((position) => {
    if (position.quantity <= 0) return false;
    if (openBySymbol.has(position.symbol)) return true;
    const notional = position.notional || (position.quantity * (position.current_price || position.entry_price));
    return notional >= LIST_MIN_NOTIONAL_USDT;
  });

  for (const position of allLive) {
    if (openBySymbol.has(position.symbol) || !db) continue;
    let data = null;
    const { data: openRow } = await db
      .from('trades')
      .select('*')
      .eq('symbol', position.symbol)
      .in('status', ['open', 'partial'])
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    data = openRow;
    if (!data) {
      data = await findDbTradeForLivePosition(position.symbol, position.quantity);
    }
    if (data) openBySymbol.set(position.symbol, data);
  }

  const dbEnriched = (await Promise.all([...openBySymbol.entries()].map(async ([symbol, trade]) => {
    let live = livePositions.find((position) => position.symbol === symbol)
      || allLive.find((position) => position.symbol === symbol && position.quantity > 0);
    if (!live || live.quantity <= 0) {
      const { getLivePositionQty } = await import('../services/tradeProtection.js');
      const qty = await getLivePositionQty(symbol);
      if (!qty || qty <= 0) return null;
      const mark = await getFreshMarkPrice(symbol).catch(() => null)
        || await getMarkPrice(symbol).catch(() => parseFloat(trade.entry_price));
      live = {
        symbol,
        quantity: qty,
        entry_price: parseFloat(trade.entry_price),
        current_price: mark,
        notional: qty * (mark || 0),
      };
    }
    return enrichTrade(trade, live);
  }))).filter(Boolean);

  const mergedSymbols = new Set([...openBySymbol.keys()]);
  const exchangeOnly = await Promise.all(livePositions
    .filter((position) => !mergedSymbols.has(position.symbol))
    .map((position) => enrichTrade(exchangePositionToTrade(position), position)));

  return [...dbEnriched, ...exchangeOnly];
}

function computeTradePerformance(trades = []) {
  const closed = trades.filter((t) => !['open', 'partial'].includes(t.status));
  const partial = trades.filter((t) => t.status === 'partial');
  const wins = closed.filter((t) => toNumber(t.pnl ?? t.profit_usd) > 0).length;
  const losses = closed.filter((t) => toNumber(t.pnl ?? t.profit_usd) < 0).length;
  const grossProfit = closed.reduce((sum, t) => sum + Math.max(0, toNumber(t.pnl ?? t.profit_usd)), 0);
  const grossLoss = Math.abs(closed.reduce((sum, t) => sum + Math.min(0, toNumber(t.pnl ?? t.profit_usd)), 0));
  const netProfit = closed.reduce((sum, t) => sum + toNumber(t.pnl ?? t.profit_usd), 0);
  const bookedPartial = partial.reduce(
    (sum, t) => sum + toNumber(t.exchange_realized_pnl ?? t.realized_pnl ?? t.pnl),
    0,
  );
  const total = closed.length;

  return {
    total_trades: total,
    wins,
    losses,
    win_rate: total ? (wins / total) * 100 : 0,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0,
    net_profit: netProfit,
    partial_open: partial.length,
    booked_partial_pnl: bookedPartial,
  };
}

async function buildTradingDashboard() {
  const [{ data: rawTrades }, { data: rawOpen }] = await Promise.all([
    getTrades(1000),
    getOpenTrades(),
  ]);
  const [trades, positions] = await Promise.all([
    enrichTrades(rawTrades || []),
    getMergedOpenTrades(rawOpen || []),
  ]);
  let balance = { total: null, available: null };
  try {
    balance = await getBalanceForUser(null);
  } catch (err) {
    try {
      balance = await getUsdtBalance();
    } catch (fallbackErr) {
      await logEvent('warn', 'dashboard', `Balance fetch failed: ${fallbackErr.message || err.message}`);
    }
  }
  const unrealized = positions.reduce((sum, p) => sum + toNumber(p.unrealized_pnl), 0);
  const perf = computeTradePerformance(trades);
  const walletBalance = balance.total ?? balance.available;

  return {
    accounts: [{
      balance: walletBalance,
      available: balance.available,
      equity: walletBalance != null ? walletBalance + unrealized : null,
      unrealized_pnl: unrealized,
      source: balance.source,
      exchange_unreachable: balance.exchange_unreachable === true,
      exchange_error: balance.error || null,
    }],
    positions,
    trades,
    performance: perf,
    risk: {
      open_positions: positions.length,
      total_exposure: computeOpenExposure(positions),
      total_margin: computeOpenMargin(positions),
      circuit_breaker: false,
      kill_switch: false,
    },
    health: {
      running: true,
      dry_run: config.binance?.demo !== false,
      exchange_connected: balance.exchange_unreachable !== true && walletBalance != null && balance.source !== 'fallback',
      user_stream: await (async () => {
        try {
          const { isUserStreamLive } = await import('../services/binanceUserStream.js');
          return isUserStreamLive();
        } catch {
          return false;
        }
      })(),
      ...getExchangeBlockInfo(),
    },
    execution: {
      fill_rate_pct: trades.length ? 100 : 0,
      avg_latency_ms: null,
    },
  };
}

// Health check
router.get('/health', async (req, res) => {
  const n8n = await checkN8nHealth();
  const dune = isDuneConfigured()
    ? await testDuneConnection()
    : { ok: false, reason: 'not configured' };
  let research = { ok: false, reason: 'not configured' };
  if (config.researchApiUrl) {
    try {
      const r = await fetch(`${config.researchApiUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(5000) });
      research = r.ok ? { ok: true, status: 'connected' } : { ok: false, reason: `HTTP ${r.status}` };
    } catch (err) {
      research = { ok: false, reason: err.message };
    }
  }
  let candleIngestion = { started: false };
  try {
    const { getCandleIngestionStatus } = await import('../jobs/candleIngestion.js');
    candleIngestion = getCandleIngestionStatus();
  } catch { /* */ }
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    n8n: n8n.ok ? 'connected' : n8n.error,
    dune: dune.ok ? 'connected' : dune.reason || 'offline',
    tradingview: (await testTradingViewConnection()).ok ? 'connected' : 'offline',
    research: research.ok ? 'connected' : (research.reason || 'offline'),
    candle_ingestion: candleIngestion.started ? 'running' : 'stopped',
    position_monitor: 'running',
    ...(await import('../services/cache.js').then((m) => m.getCacheStats()).catch(() => ({}))),
  });
});

/** Institutional SMC v2 engine status (Python research-api). */
router.get('/institutional-smc/health', async (req, res) => {
  const { checkInstitutionalSmcHealth, getInstitutionalSmcConfig } = await import('../services/institutionalSmcClient.js');
  const { getSignalEngineStatus } = await import('../services/signalEngineSelector.js');
  const cfg = getInstitutionalSmcConfig();
  const engine = await checkInstitutionalSmcHealth();
  const selector = await getSignalEngineStatus();
  res.json({
    configured: cfg.configured,
    enabled: cfg.enabled,
    engine_version: cfg.engineVersion,
    min_score: cfg.minScore,
    timeframes: cfg.timeframes,
    research_api: engine.ok ? engine.data : { ok: false, error: engine.error, offline: engine.offline },
    phase: engine.ok ? (engine.data?.phase || 'CP6') : 'CP6',
    signal_engine: selector,
  });
});

router.get('/signal-engine/status', async (req, res) => {
  const { cacheGetOrSet } = await import('../services/cache.js');
  const { getSignalEngineStatus } = await import('../services/signalEngineSelector.js');
  const { data, cache } = await cacheGetOrSet('dash:signal-engine', () => getSignalEngineStatus(), { ttlSec: 30, staleSec: 120 });
  res.set('X-Cache', cache);
  res.json(data);
});

router.post('/signal-engine', async (req, res) => {
  const { setSignalEngine } = await import('../services/signalEngineSelector.js');
  const engineId = req.body?.signal_engine;
  if (!engineId) return res.status(400).json({ error: 'signal_engine required (smc-mtf | institutional-smc)' });
  try {
    const settings = await setSignalEngine(engineId, req.body?.actor || 'dashboard');
    const { getSignalEngineStatus } = await import('../services/signalEngineSelector.js');
    res.json({ ok: true, settings, signal_engine: await getSignalEngineStatus() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/institutional-smc/spec', async (req, res) => {
  const { getInstitutionalSmcSpec, getInstitutionalSmcConfig } = await import('../services/institutionalSmcClient.js');
  const cfg = getInstitutionalSmcConfig();
  if (!cfg.configured) {
    return res.status(503).json({ error: 'RESEARCH_API_URL not configured' });
  }
  const spec = await getInstitutionalSmcSpec();
  if (!spec.ok) return res.status(502).json({ error: spec.error, offline: spec.offline });
  res.json(spec.data);
});

/** Live exchange + WebSocket feed status (admin monitoring). */
router.get('/exchange/stream-status', async (req, res) => {
  const block = getExchangeBlockInfo();
  let userStream = { running: false, live: false };
  let publicWs = { connected: false, streams: 0 };
  try {
    const mod = await import('../services/binanceUserStream.js');
    userStream = mod.getUserStreamStatus();
  } catch { /* */ }
  try {
    const { binanceWs } = await import('../services/binanceWs.js');
    publicWs = binanceWs.getStatus();
  } catch { /* */ }

  let restPing = { ok: false, skipped: true, reason: 'rate_limit_cooldown' };
  if (!block.blocked) {
    restPing = { ok: false, skipped: false, reason: null };
    try {
      const credentials = await getActiveApiKeys();
      if (!credentials?.apiKey) {
        restPing = { ok: false, reason: 'no_credentials' };
      } else {
        const result = await testUserConnection(credentials);
        restPing = {
          ok: true,
          mode: result.mode,
          balance: result.total,
          available: result.balance,
        };
      }
    } catch (err) {
      noteExchangeRateLimit(err.message);
      restPing = { ok: false, reason: err.message };
    }
  }

  const positions = userStream.live
    ? (await import('../services/binanceUserStream.js')).getCachedPositions()
    : await listExchangePositions().catch(() => []);

  res.json({
    timestamp: new Date().toISOString(),
    trading_mode: config.binance?.demo !== false ? 'demo' : 'live',
    rate_limit: block,
    rest_ping: restPing,
    user_stream: userStream,
    public_ws: publicWs,
    positions: {
      count: Array.isArray(positions) ? positions.length : 0,
      symbols: (positions || []).map((p) => p.symbol),
    },
    demo_api_up: restPing.ok === true || userStream.live === true,
  });
});

router.post('/exchange/stream-refresh', async (req, res) => {
  try {
    const { refreshUserStreamBootstrap, startUserStream } = await import('../services/binanceUserStream.js');
    if (getExchangeBlockInfo().blocked) {
      return res.status(429).json({ ok: false, ...getExchangeBlockInfo() });
    }
    const boot = await refreshUserStreamBootstrap();
    const start = boot.ok ? boot : await startUserStream();
    res.json({ ok: boot.ok || start.ok, bootstrap: boot, stream: start });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.all('/research/*', async (req, res) => {
  try {
    const path = `/${req.params[0] || ''}${req.url.includes('?') ? `?${req.url.split('?')[1]}` : ''}`;
    const data = await proxyResearch(req.method, path, ['GET', 'HEAD'].includes(req.method) ? undefined : req.body);
    res.json(data);
  } catch (err) {
    if (err.code === 'ESTIMATE_CONFIRM_REQUIRED') {
      return res.status(409).json({
        error: err.message,
        confirm_required: true,
        estimate: err.estimate,
      });
    }
    res.status(502).json({ error: err.message });
  }
});

router.get('/control/settings', async (req, res) => {
  try {
    const { cacheGetOrSet } = await import('../services/cache.js');
    const { getLocalControlSettings } = await import('../services/controlCenter.js');
    const { data, cache } = await cacheGetOrSet('dash:settings', () => getLocalControlSettings(), { ttlSec: 30, staleSec: 120 });
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=60');
    res.set('X-Cache', cache);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/control/settings', async (req, res) => {
  try {
    const { updateLocalControlSettings } = await import('../services/controlCenter.js');
    res.json(await updateLocalControlSettings(req.body || {}, req.body?.actor || 'tradegpt'));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/control/dashboard', async (req, res) => {
  try {
    const { cacheGetOrSet } = await import('../services/cache.js');
    const { getLocalControlDashboard } = await import('../services/controlCenter.js');
    const { data, cache } = await cacheGetOrSet('dash:control', () => getLocalControlDashboard(), { ttlSec: 12, staleSec: 90 });
    res.set('Cache-Control', 'private, max-age=8, stale-while-revalidate=45');
    res.set('X-Cache', cache);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/control/services/start-all', async (req, res) => {
  try {
    res.json(await startAllControlServices());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/control/signal', async (req, res) => {
  try {
    res.json(await postControlSignal(req.body || {}));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/control/approve', async (req, res) => {
  try {
    const { approval_id: approvalId, passcode, position_size_usdt: size } = req.body || {};
    const result = await approveControlTrade(approvalId || 'latest', passcode || '8888', parseFloat(size || 50));
    if (!result.executed) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/control/approvals', async (req, res) => {
  try {
    res.json({ pending: await getPendingApprovals() });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/control/reject', async (req, res) => {
  try {
    res.json(await rejectControlApproval(req.body?.approval_id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/control/emergency/:action', async (req, res) => {
  try {
    const action = req.params.action;
    await logEvent('warn', 'control', `Emergency action: ${action}`, { actor: req.body?.actor || 'dashboard' });
    if (action === 'stop-auto-trading') {
      await updateControlSettings({ auto_trading: false }, 'emergency');
    }
    if (action === 'kill-switch') {
      await updateControlSettings({ auto_trading: false, mode: 'demo' }, 'emergency');
    }
    res.json({ ok: true, action });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/control/audit', async (req, res) => {
  res.json({ count: 0, logs: [] });
});

router.get('/control/journal', async (req, res) => {
  res.json({ count: 0, entries: [] });
});

router.post('/control/services/:id/:action', async (req, res) => {
  res.json({ ok: true, service_id: req.params.id, action: req.params.action });
});

router.post('/control/demo-signal', async (req, res) => {
  try {
    res.json(await triggerDemoSignal(req.body?.symbol || 'BTCUSDT', { force: req.body?.force === true }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/control/trade-latest', async (req, res) => {
  try {
    const signal = await getLatestSignal();
    if (!signal) return res.status(404).json({ error: 'No pending signal found' });
    const size = parseFloat(req.body?.position_size_usdt || req.body?.size || 50);
    const settings = await getControlSettings();
    if (settings?.manual_approval) {
      const pending = await postControlSignal({ ...signal, source: 'manual' });
      if (pending.approval_required) {
        return res.json({
          approval_required: true,
          approval_id: pending.approval_id,
          signal,
          hint: 'Approve with /approve <id> 8888 or POST /control/approve',
        });
      }
    }
    const port = config.port;
    const execRes = await fetch(internalApiUrl('/api/execute'), {
      method: 'POST',
      headers: internalApiHeaders(),
      body: JSON.stringify({ ...signal, position_size_usdt: size }),
    });
    const result = await execRes.json();
    if (!execRes.ok) return res.status(execRes.status).json(result);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// TradingView — crypto search + clean chart candles
router.get('/tradingview/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json({ results: [] });
    const limit = Math.min(parseInt(req.query.limit || '25', 10), 50);
    const results = await searchCryptoPairs(q, { limit });
    res.json({ query: q, results });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/tradingview/chart', async (req, res) => {
  try {
    const symbol = req.query.symbol || req.query.tv || 'BINANCE:BTCUSDT';
    const interval = req.query.interval || '5m';
    const range = Math.min(parseInt(req.query.range || '300', 10), 500);
    const data = await getTvChart(symbol, interval, range);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/tradingview/symbol/:binanceSymbol', (req, res) => {
  const tv = binanceSymbolToTvId(req.params.binanceSymbol);
  res.json({ binanceSymbol: req.params.binanceSymbol.toUpperCase(), tvSymbol: tv });
});

// Get chart data with indicators + SMC overlays (+ CoinGecko fallback)
router.get('/chart/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const interval = req.query.interval || '5m';
    const limit = parseInt(req.query.limit || '500', 10);
    const source = req.query.source || 'binance';

    let candles;
    let dataSource = 'binance';

    try {
      const raw = await getKlines(symbol.toUpperCase(), interval, limit);
      candles = parseKlines(raw);
    } catch (binanceErr) {
      const coinId = symbolToCoinId(symbol);
      if (!coinId) throw binanceErr;
      candles = await getOHLC(coinId, intervalToCgDays(interval));
      dataSource = 'coingecko';
    }

    if (source === 'coingecko' || candles.length < 10) {
      const coinId = symbolToCoinId(symbol);
      if (coinId) {
        try {
          const cgCandles = await getOHLC(coinId, intervalToCgDays(interval));
          if (cgCandles.length >= candles.length) {
            candles = cgCandles;
            dataSource = 'coingecko';
          }
        } catch { /* keep binance */ }
      }
    }

    const indicators = attachIndicators(candles);
    const smc = analyzeSMC(candles);
    const mtf = req.query.mtf !== '0' ? await getMTFBias(symbol.toUpperCase()) : null;

    let cgPrice = null;
    const coinId = symbolToCoinId(symbol);
    if (coinId) {
      try {
        const prices = await getSimplePrices([symbol.toUpperCase()]);
        cgPrice = prices[symbol.toUpperCase()] || null;
      } catch { /* optional */ }
    }

    res.json({ symbol, interval, candles, indicators, smc, mtf, cgPrice, dataSource });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CoinGecko batch prices for dashboard
router.get('/prices/coingecko', async (req, res) => {
  try {
    const symbols = req.query.symbols
      ? req.query.symbols.split(',')
      : config.topPairs;
    const prices = await getSimplePrices(symbols);
    res.json(prices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MTF bias for symbol (dashboard + bot)
router.get('/mtf/:symbol', async (req, res) => {
  try {
    const bias = await getMTFBias(req.params.symbol.toUpperCase());
    res.json(bias);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run MTF analysis for a symbol
router.get('/analyze/:symbol', async (req, res) => {
  try {
    const analysis = await runMTFAnalysis(req.params.symbol.toUpperCase());
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate signal for symbol
router.post('/signal/:symbol', async (req, res) => {
  try {
    const signal = await generateSignal(req.params.symbol.toUpperCase());
    if (signal.direction !== 'IGNORE') {
      const { data } = await saveSignal(signal);
      signal.id = data?.id;
    }
    res.json(signal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get recent signals
router.get('/signals', async (req, res) => {
  const { data, error } = await getSignals(parseInt(req.query.limit || '50', 10));
  if (error) return res.status(500).json({ error });
  res.json(data);
});

router.post('/external-signals/ingest', async (req, res) => {
  try {
    if (config.externalSignals.ingestionKey) {
      const key = req.get('X-Ingestion-Key') || req.body?.ingestion_key;
      if (key !== config.externalSignals.ingestionKey) {
        return res.status(401).json({ error: 'Invalid ingestion key' });
      }
    }

    const result = await ingestExternalSignal(req.body || {});
    if (!result.accepted || !result.passed) {
      return res.status(202).json({
        ok: true,
        accepted: result.accepted,
        passed: result.passed,
        reason: result.reason,
        validation: result.validation,
        signal: result.signal,
      });
    }

    const settings = await getControlSettings();
    const autoTrading = settings?.auto_trading === true;

    if (!autoTrading) {
      await sendSignalNotification(result.signal, result.signal.id);
      return res.json({
        ok: true,
        accepted: true,
        passed: true,
        executed: false,
        notified: true,
        reason: 'auto_trading_off',
        validation: result.validation,
        signal: result.signal,
      });
    }

    const execRes = await fetch(internalApiUrl('/api/execute'), {
      method: 'POST',
      headers: internalApiHeaders(),
      body: JSON.stringify({ ...result.signal, source: 'telegram' }),
    });
    const execution = await execRes.json();
    if (!execRes.ok) {
      await logEvent('warn', 'externalSignalIngestion', `External signal execution blocked: ${execution.error || 'unknown error'}`, {
        signalId: result.signal.id,
        symbol: result.signal.symbol,
        execution,
      });
      return res.status(202).json({
        ok: true,
        accepted: true,
        passed: true,
        executed: false,
        reason: 'execution_blocked',
        execution,
        validation: result.validation,
        signal: result.signal,
      });
    }

    return res.json({
      ok: true,
      accepted: true,
      passed: true,
      executed: true,
      validation: result.validation,
      signal: result.signal,
      execution,
    });
  } catch (err) {
    await logEvent('error', 'externalSignalIngestion', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/sources', async (req, res) => {
  try {
    const followed = req.query.followed === undefined ? null : req.query.followed === 'true';
    const { data, error } = await getTelegramSignalSources({
      followed,
      limit: parseInt(req.query.limit || '500', 10),
    });
    if (error) return res.status(500).json({ error: error.message || error });
    res.json({ sources: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/sources/bulk', async (req, res) => {
  try {
    if (config.externalSignals.ingestionKey) {
      const key = req.get('X-Ingestion-Key') || req.body?.ingestion_key;
      if (key !== config.externalSignals.ingestionKey) {
        return res.status(401).json({ error: 'Invalid ingestion key' });
      }
    }
    const { data, error } = await upsertTelegramSignalSources(req.body?.sources || []);
    if (error) return res.status(500).json({ error: error.message || error });
    res.json({ ok: true, count: data?.length || 0, sources: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/telegram/sources/:id', async (req, res) => {
  try {
    const { data, error } = await updateTelegramSignalSource(req.params.id, req.body || {});
    if (error) return res.status(500).json({ error: error.message || error });
    if (data?.metadata?.format_profile) {
      upsertTelegramGroupMemory(data.id, data.metadata.format_profile, {
        title: data.title,
        username: data.username,
      }).catch(() => {});
    }
    res.json({ ok: true, source: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/sources/:id/learn-format', async (req, res) => {
  try {
    const { data: sources, error: fetchError } = await getTelegramSignalSources({ limit: 1000 });
    if (fetchError) return res.status(500).json({ error: fetchError.message || fetchError });
    const source = (sources || []).find((item) => item.id === req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const metadata = { ...(source.metadata || {}) };
    const profile = { ...(metadata.format_profile || {}) };
    delete profile.learned_at;
    profile.learn_requested_at = new Date().toISOString();
    metadata.format_profile = profile;

    const { data, error } = await updateTelegramSignalSource(req.params.id, { metadata });
    if (error) return res.status(500).json({ error: error.message || error });
    res.json({
      ok: true,
      source: data,
      message: 'Format re-learn queued — ingestion service will scan recent messages on next refresh',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/messages', async (req, res) => {
  try {
    if (config.externalSignals.ingestionKey) {
      const key = req.get('X-Ingestion-Key') || req.body?.ingestion_key;
      if (key !== config.externalSignals.ingestionKey) {
        return res.status(401).json({ error: 'Invalid ingestion key' });
      }
    }
    const body = req.body || {};
    let existing = null;
    if (body.telegram_chat_id != null && body.message_id != null) {
      const { data: prev } = await getTelegramSignalMessageByChatAndId(body.telegram_chat_id, body.message_id);
      existing = prev;
    }
    const { data, error } = await saveTelegramSignalMessage(body);
    if (error) return res.status(500).json({ error: error.message || error });

    recordTelegramMessageAudit(body, data).catch((auditErr) => {
      logEvent('warn', 'telegramAudit', `Audit record failed: ${auditErr.message}`, {
        chatId: body.telegram_chat_id,
        messageId: body.message_id,
      }).catch(() => {});
    });

    const stage = body.api_result?.pipeline_stage
      || (body.parse_status === 'skipped' ? 'received' : body.parse_status === 'parsing' ? 'parsing' : body.api_result?.passed ? 'validated' : 'parsing');
    const isScrape = Boolean(body.api_result?.scrape);
    const isLive = body.api_result?.live === true;
    const prevStage = existing?.api_result?.pipeline_stage;
    const stageChanged = prevStage !== stage;
    const isNew = !existing;
    if (isNew || stageChanged || (isScrape && stage === 'validated')) {
      broadcastTelegramPipeline(data, stage);
    }
    if (data?.parse_status === 'parsed' && data?.id) {
      const { tryAutoExecuteTelegramMessage } = await import('../services/telegramInbox.js');
      tryAutoExecuteTelegramMessage(data.id)
        .then(async (autoResult) => {
          if (autoResult?.ok) return;
          const reason = autoResult?.reason || 'unknown';
          if (reason === 'auto_trading_off' || reason === 'already_executed' || reason === 'manual_approval_required') return;
          await logEvent('info', 'telegramInbox', `Auto-trade not executed: ${reason}`, {
            messageId: data.id,
            symbol: data.parsed_signal?.symbol,
            live: isLive,
            scrape: isScrape,
          });
        })
        .catch((err) =>
          logEvent('warn', 'telegramInbox', `Auto-trade skipped: ${err.message}`, { messageId: data.id })
        );
    }
    res.json({ ok: true, message: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/messages', async (req, res) => {
  try {
    const { data, error } = await getTelegramSignalMessages({
      limit: parseInt(req.query.limit || '100', 10),
      chatId: req.query.chat_id || null,
      parseStatus: req.query.parse_status || null,
    });
    if (error) return res.status(500).json({ error: error.message || error });
    res.json({ messages: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/raw', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const { data, error, count } = await getTelegramRawMessages({
      limit,
      offset,
      sourceId: req.query.source_id || null,
      chatId: req.query.chat_id || null,
      processedStatus: req.query.status || req.query.processed_status || null,
    });
    if (error) return res.status(500).json({ error: error.message || error });
    res.json({ messages: data || [], count: count ?? (data || []).length, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/raw/:id', async (req, res) => {
  try {
    const { data, error } = await getTelegramRawMessageById(req.params.id);
    if (error) return res.status(500).json({ error: error.message || error });
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ message: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/raw/:id/image', async (req, res) => {
  try {
    const { data, error } = await getTelegramRawMessageById(req.params.id);
    if (error || !data?.image_base64) return res.status(404).json({ error: 'Image not found' });
    const mime = data.image_mime || 'image/jpeg';
    const buf = Buffer.from(data.image_base64, 'base64');
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/parsed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const { data, error, count } = await getParsedSignalsRaw({
      limit,
      offset,
      sourceId: req.query.source_id || null,
      chatId: req.query.chat_id || null,
    });
    if (error) return res.status(500).json({ error: error.message || error });
    res.json({ signals: data || [], count: count ?? (data || []).length, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/rejected', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const { data, error, count } = await getTelegramSignalRejections({
      limit,
      offset,
      sourceId: req.query.source_id || null,
      chatId: req.query.chat_id || null,
      rejectStage: req.query.stage || req.query.reject_stage || null,
    });
    if (error) return res.status(500).json({ error: error.message || error });
    res.json({ rejections: data || [], count: count ?? (data || []).length, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/group-memory', async (req, res) => {
  try {
    const { data, error } = await getTelegramGroupMemory({
      sourceId: req.query.source_id || null,
      limit: parseInt(req.query.limit || '50', 10),
    });
    if (error) return res.status(500).json({ error: error.message || error });
    res.json({ groups: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/archive/recent', async (req, res) => {
  try {
    if (config.externalSignals.ingestionKey) {
      const key = req.get('X-Ingestion-Key') || req.body?.ingestion_key;
      if (key !== config.externalSignals.ingestionKey) {
        return res.status(401).json({ error: 'Invalid ingestion key' });
      }
    }
    const limit = Math.min(parseInt(req.body?.limit || '10', 10), 20);
    const sourceId = req.body?.source_id || null;
    const { data: sources, error } = await getTelegramSignalSources({
      followed: sourceId ? null : true,
      limit: 500,
    });
    if (error) return res.status(500).json({ error: error.message || error });
    const targets = (sources || []).filter((s) => !sourceId || s.id === sourceId);
    for (const source of targets) {
      const metadata = { ...(source.metadata || {}), archive_requested_at: new Date().toISOString(), archive_limit: limit };
      await updateTelegramSignalSource(source.id, { metadata });
    }
    res.json({
      ok: true,
      queued: targets.length,
      limit,
      message: 'Optional backfill queued (max 20/msg, 1.5s delay) — live listener archives all new messages automatically',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/inbox', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '200', 10);
    const parseStatus = req.query.status || req.query.parse_status || null;
    const chatId = req.query.chat_id || null;

    const [{ data: messages, error: msgError }, { data: sources, error: srcError }] = await Promise.all([
      getTelegramSignalMessages({
        limit,
        chatId,
        parseStatus: parseStatus === 'all' ? null : parseStatus,
        followedOnly: req.query.followed_only !== 'false',
      }),
      getTelegramSignalSources({ followed: null, limit: 500 }),
    ]);
    if (msgError) return res.status(500).json({ error: msgError.message || msgError });
    if (srcError) return res.status(500).json({ error: srcError.message || srcError });

    const sourceByChatId = new Map((sources || []).map((s) => [Number(s.telegram_chat_id), s]));
    const enrichSource = (row) => {
      if (row.telegram_signal_sources?.title) return row;
      const src = sourceByChatId.get(Number(row.telegram_chat_id));
      if (!src) return row;
      return {
        ...row,
        telegram_signal_sources: {
          title: src.title,
          username: src.username,
          is_followed: src.is_followed,
        },
      };
    };

    const sorted = (messages || [])
      .map(enrichSource)
      .sort((a, b) => {
        const ta = new Date(a.message_date || a.received_at || 0).getTime();
        const tb = new Date(b.message_date || b.received_at || 0).getTime();
        return tb - ta;
      });

    const followedChatIds = new Set(
      (sources || []).filter((s) => s.is_followed).map((s) => Number(s.telegram_chat_id)),
    );
    const followedOnly = req.query.followed_only !== 'false';
    const followedRows = followedOnly
      ? sorted.filter(
          (row) =>
            row.telegram_signal_sources?.is_followed === true
            || followedChatIds.has(Number(row.telegram_chat_id)),
        )
      : sorted;

    const dedupeSignals = req.query.dedupe === 'true';
    const displayRows = dedupeSignals ? dedupeTelegramInbox(followedRows) : followedRows;

    const { getActiveSymbolLocks, symbolBlockForMessage } = await import('../services/telegramInbox.js');
    const symbolLocks = await getActiveSymbolLocks();
    const messagesWithLocks = displayRows.map((row) => ({
      ...row,
      ...symbolBlockForMessage(row, symbolLocks),
    }));

    const { needsRevalidation, revalidateTelegramMessages } = await import('../services/telegramInbox.js');
    if (req.query.revalidate === 'true' || req.query.revalidate_failed === 'true') {
      await revalidateTelegramMessages(messagesWithLocks.filter(needsRevalidation));
      const { data: refreshed } = await getTelegramSignalMessages({
        limit,
        chatId,
        parseStatus: parseStatus === 'all' ? null : parseStatus,
        followedOnly: req.query.followed_only !== 'false',
      });
      const sortedRefreshed = (refreshed || [])
        .map(enrichSource)
        .sort((a, b) => {
          const ta = new Date(a.message_date || a.received_at || 0).getTime();
          const tb = new Date(b.message_date || b.received_at || 0).getTime();
          return tb - ta;
        });
      const followedRefreshed = followedOnly
        ? sortedRefreshed.filter(
            (row) =>
              row.telegram_signal_sources?.is_followed === true
              || followedChatIds.has(Number(row.telegram_chat_id)),
          )
        : sortedRefreshed;
      const displayRefreshed = dedupeSignals ? dedupeTelegramInbox(followedRefreshed) : followedRefreshed;
      messagesWithLocks.length = 0;
      messagesWithLocks.push(...displayRefreshed.map((row) => ({
        ...row,
        ...symbolBlockForMessage(row, symbolLocks),
      })));
    }

    const followedSources = (sources || []).filter((s) => s.is_followed);
    const settings = await getControlSettings().catch(() => ({}));
    const lastLive = messagesWithLocks.find((m) => m.api_result?.live === true);
    const stats = {
      total: messagesWithLocks.length,
      parsed: messagesWithLocks.filter((m) => m.parse_status === 'parsed').length,
      skipped: messagesWithLocks.filter((m) => m.parse_status === 'skipped').length,
      validated: messagesWithLocks.filter((m) => m.api_result?.passed === true || m.api_result?.ready_to_approve).length,
      rejected: messagesWithLocks.filter((m) => m.parse_status === 'parsed' && m.api_result?.passed === false && !m.api_result?.ready_to_approve).length,
      stale: messagesWithLocks.filter((m) => m.api_result?.stale === true || m.api_result?.pipeline_stage === 'stale').length,
      executing: messagesWithLocks.filter((m) => m.api_result?.pipeline_stage === 'executing').length,
      executed: messagesWithLocks.filter((m) => m.api_result?.executed).length,
      failed: messagesWithLocks.filter((m) => m.api_result?.pipeline_stage === 'approve_failed' || m.api_result?.last_error).length,
      approved: messagesWithLocks.filter((m) => m.api_result?.approved || m.api_result?.executed).length,
      symbol_blocked: messagesWithLocks.filter((m) => m.symbol_blocked).length,
      needs_revalidation: messagesWithLocks.filter(needsRevalidation).length,
      live_signals: messagesWithLocks.filter((m) => m.api_result?.live === true).length,
    };

    res.json({
      messages: messagesWithLocks,
      stats,
      sources: sources || [],
      followed_sources: followedSources,
      followed_count: followedSources.length,
      test_mode: config.externalSignals.testMode,
      live_listener: true,
      last_live_at: lastLive?.received_at || lastLive?.message_date || null,
      control: {
        auto_trading: settings?.auto_trading === true,
        manual_approval: settings?.manual_approval === true,
        mode: settings?.mode || 'demo',
      },
      source: 'database',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function latestPerGroupFromDb(rows) {
  const byGroup = new Map();
  for (const row of rows || []) {
    if (row.parse_status === 'superseded') continue;
    const key = String(row.telegram_chat_id);
    const existing = byGroup.get(key);
    const rowTime = new Date(row.message_date || row.received_at || 0).getTime();
    const existingTime = existing ? new Date(existing.message_date || existing.received_at || 0).getTime() : 0;
    if (!existing || rowTime > existingTime) {
      byGroup.set(key, row);
    }
  }
  return [...byGroup.values()].sort((a, b) => {
    const ta = new Date(a.message_date || a.received_at || 0).getTime();
    const tb = new Date(b.message_date || b.received_at || 0).getTime();
    return tb - ta;
  });
}

function dedupeTelegramInbox(rows) {
  return latestPerGroupFromDb(rows.filter((r) => r.parse_status === 'parsed'));
}

router.post('/external-signals/validate', async (req, res) => {
  try {
    if (config.externalSignals.ingestionKey) {
      const key = req.get('X-Ingestion-Key') || req.body?.ingestion_key;
      if (key !== config.externalSignals.ingestionKey) {
        return res.status(401).json({ error: 'Invalid ingestion key' });
      }
    }
    const result = await ingestExternalSignal(req.body || {}, {
      validateOnly: true,
      allowStale: req.body?.allow_stale !== false,
      testMode: req.body?.test_mode === true || config.externalSignals.testMode,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/scrape-recent', async (req, res) => {
  try {
    const scanLimit = parseInt(req.body?.scan_limit || req.body?.limit || '25', 10);
    const latestSignalOnly = req.body?.latest_signal_only !== false;
    const { data: sources, error } = await getTelegramSignalSources({ followed: true, limit: 500 });
    if (error) return res.status(500).json({ error: error.message || error });
    if (!sources?.length) {
      return res.json({ ok: true, queued: 0, message: 'No followed groups — check groups on the Sources tab first' });
    }

    const results = await Promise.all(
      sources.map(async (source) => {
        await supersedeAllTelegramMessagesForChat(source.telegram_chat_id);
        const metadata = {
          ...(source.metadata || {}),
          scrape_requested_at: new Date().toISOString(),
          scrape_limit: scanLimit,
          scrape_latest_signal: latestSignalOnly,
          scrape_progress: {
            status: 'queued',
            total: sources.length,
            completed: 0,
            current: null,
            results: [],
            updated_at: new Date().toISOString(),
          },
        };
        return updateTelegramSignalSource(source.id, { metadata });
      }),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return res.status(500).json({ error: failed.error.message || failed.error });

    res.json({
      ok: true,
      queued: sources.length,
      scan_limit: scanLimit,
      latest_signal_only: latestSignalOnly,
      test_mode: config.externalSignals.testMode,
      message: `One-time sync queued for ${sources.length} groups (25 msgs each) — stored in database`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/scrape-status', async (req, res) => {
  try {
    const { data: sources, error } = await getTelegramSignalSources({ followed: true, limit: 500 });
    if (error) return res.status(500).json({ error: error.message || error });

    const progressRows = (sources || [])
      .map((s) => ({ title: s.title, ...(s.metadata?.scrape_progress || {}) }))
      .filter((p) => p.status);

    const active = progressRows.find((p) => p.status === 'queued' || p.status === 'running')
      || progressRows[0]
      || null;

    const parsedCount = (sources || []).filter((s) => {
      const stats = s.metadata?.last_scrape_stats || {};
      return stats.parsed > 0;
    }).length;

    res.json({
      ok: true,
      active: active
        ? {
            status: active.status,
            total: active.total || sources?.length || 0,
            completed: active.completed || 0,
            current: active.current || null,
            results: active.results || [],
            updated_at: active.updated_at,
            error: active.error,
          }
        : null,
      groups_with_signals: parsedCount,
      followed_count: sources?.length || 0,
      test_mode: config.externalSignals.testMode,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/sources/follow-by-names', async (req, res) => {
  try {
    const names = Array.isArray(req.body?.names) ? req.body.names : [];
    const exclusive = req.body?.exclusive !== false;
    if (!names.length) return res.status(400).json({ error: 'names array required' });

    const { data: allSources, error } = await getTelegramSignalSources({ limit: 500 });
    if (error) return res.status(500).json({ error: error.message || error });

    const normalized = names.map((n) => String(n).toLowerCase().trim());
    const matches = (source) => {
      const title = String(source.title || '').toLowerCase();
      const username = String(source.username || '').toLowerCase();
      return normalized.some((needle) => title.includes(needle) || username.includes(needle) || needle.includes(title.slice(0, 8)));
    };

    const matched = (allSources || []).filter(matches);
    const updates = [];

    if (exclusive) {
      for (const source of allSources || []) {
        const follow = matches(source);
        if (source.is_followed !== follow) {
          updates.push(updateTelegramSignalSource(source.id, { is_followed: follow }));
        }
      }
    } else {
      for (const source of matched) {
        if (!source.is_followed) {
          updates.push(updateTelegramSignalSource(source.id, { is_followed: true }));
        }
      }
    }

    await Promise.all(updates);

    res.json({
      ok: true,
      matched: matched.map((s) => ({ id: s.id, title: s.title, username: s.username })),
      followed_count: exclusive ? matched.length : undefined,
      message: `Following ${matched.length} group(s)${exclusive ? ' (exclusive — others unfollowed)' : ''}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/messages/supersede', async (req, res) => {
  try {
    if (config.externalSignals.ingestionKey) {
      const key = req.get('X-Ingestion-Key') || req.body?.ingestion_key;
      if (key !== config.externalSignals.ingestionKey) {
        return res.status(401).json({ error: 'Invalid ingestion key' });
      }
    }
    const chatId = parseInt(req.body?.telegram_chat_id, 10);
    const keepMessageId = parseInt(req.body?.keep_message_id, 10);
    if (!chatId || !keepMessageId) {
      return res.status(400).json({ error: 'telegram_chat_id and keep_message_id required' });
    }
    const { error } = await supersedeTelegramMessagesForChat(chatId, keepMessageId);
    if (error) return res.status(500).json({ error: error.message || error });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/messages/:id/refresh-for-test', async (req, res) => {
  try {
    const { refreshTelegramSignalForTest } = await import('../services/telegramSignalTest.js');
    const result = await refreshTelegramSignalForTest(req.params.id, {
      useAi: req.body?.use_ai !== false,
    });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/messages/:id/revalidate', async (req, res) => {
  try {
    const { revalidateTelegramMessage } = await import('../services/telegramInbox.js');
    const result = await revalidateTelegramMessage(req.params.id);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/inbox/revalidate', async (req, res) => {
  try {
    const { getTelegramSignalMessages } = await import('../services/supabase.js');
    const { needsRevalidation, revalidateTelegramMessages } = await import('../services/telegramInbox.js');
    const { data: messages } = await getTelegramSignalMessages({
      limit: parseInt(req.body?.limit || '50', 10),
      followedOnly: true,
      parseStatus: 'parsed',
    });
    const results = await revalidateTelegramMessages((messages || []).filter(needsRevalidation));
    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/inbox/reparse-skipped', async (req, res) => {
  try {
    const { getTelegramSignalMessages } = await import('../services/supabase.js');
    const {
      isSkippedInformalCandidate,
      reparseSkippedTelegramMessages,
    } = await import('../services/telegramInformalReparse.js');
    const limit = parseInt(req.body?.limit || '200', 10);
    const { data: messages } = await getTelegramSignalMessages({
      limit,
      followedOnly: true,
      parseStatus: 'skipped',
    });
    const candidates = (messages || []).filter(isSkippedInformalCandidate);
    const results = await reparseSkippedTelegramMessages(candidates);
    const ok = results.filter((r) => r.ok);
    res.json({
      ok: true,
      scanned: (messages || []).length,
      candidates: candidates.length,
      reparsed: ok.length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/messages/:id/approve', async (req, res) => {
  try {
    const { approveTelegramInboxMessage } = await import('../services/telegramInbox.js');
    const result = await approveTelegramInboxMessage(req.params.id, {
      marginUsdt: req.body?.margin_usdt ?? req.body?.position_size_usdt,
      leverage: req.body?.leverage,
    });
    if (!result.ok) {
      return res.status(result.execution ? 422 : 400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/telegram/trade-defaults', async (req, res) => {
  try {
    const { getDefaultTradeParams } = await import('../services/telegramTrade.js');
    res.json(await getDefaultTradeParams({
      entry: req.query.entry,
      stopLoss: req.query.stop_loss || req.query.sl,
      symbol: req.query.symbol,
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get trades (merged open + closed history, or filter by status)
router.get('/trades', async (req, res) => {
  const limit = parseInt(req.query.limit || '500', 10);
  const status = req.query.status || 'all';
  const { data, error } = await getTrades(limit, { status });
  if (error) return res.status(500).json({ error });
  res.json(await enrichTrades(data || []));
});

// Get open trades
router.get('/trades/open', async (req, res) => {
  const { data, error } = await getOpenTrades();
  if (error) return res.status(500).json({ error });
  res.json(await getMergedOpenTrades(data || []));
});

router.get('/trades/today', async (req, res) => {
  try {
    const { getTradesTodayStats, getDailyPerformanceTable } = await import('../services/tradeAuditAnalytics.js');
    const day = req.query.day || null;
    if (req.query.days) {
      const days = parseInt(req.query.days, 10) || 7;
      return res.json({ daily: await getDailyPerformanceTable(days) });
    }
    res.json(await getTradesTodayStats(day));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades/by-day', async (req, res) => {
  try {
    const day = req.query.day;
    if (!day) return res.status(400).json({ error: 'day query required (YYYY-MM-DD)' });
    const tz = parseInt(String(req.query.tz ?? 0), 10) || 0;
    const { cacheGetOrSet } = await import('../services/cache.js');
    const { getTradesByDay } = await import('../services/tradeAuditAnalytics.js');
    const key = `dash:trades:day:${day}:${tz}`;
    const { data, cache } = await cacheGetOrSet(
      key,
      () => getTradesByDay(day, tz),
      { ttlSec: 60, staleSec: 300 },
    );
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
    res.set('X-Cache', cache);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades/performance', async (req, res) => {
  try {
    const { getTradesPerformanceSummary } = await import('../services/tradeAuditAnalytics.js');
    const result = await getTradesPerformanceSummary({
      from: req.query.from || null,
      to: req.query.to || null,
      source: req.query.source || null,
      symbol: req.query.symbol || null,
      limit: parseInt(req.query.limit || '100', 10),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades/home-dashboard', async (req, res) => {
  try {
    const { cacheGetOrSet } = await import('../services/cache.js');
    const { getHomeDashboardPayload } = await import('../services/tradeAuditAnalytics.js');
    const dbOnly = req.query.live !== '1' && req.query.live !== 'true';
    const day = req.query.day || 'today';
    const tz = req.query.tz ?? 0;
    const key = `dash:home:${day}:${tz}:${dbOnly ? 'db' : 'live'}`;
    const { data, cache } = await cacheGetOrSet(key, () => getHomeDashboardPayload({
      day: req.query.day || null,
      tz,
      dbOnly,
    }), { ttlSec: 20, staleSec: 120 });
    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=60');
    res.set('X-Cache', cache);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Single round-trip payload for homepage — trade audit + services + settings. */
router.get('/dashboard/snapshot', async (req, res) => {
  try {
    const { cacheGetOrSet } = await import('../services/cache.js');
    const day = req.query.day || new Date().toISOString().slice(0, 10);
    const tz = parseInt(String(req.query.tz ?? 0), 10) || 0;
    const key = `dashboard:snapshot:${day}:${tz}`;

    const { data, cache } = await cacheGetOrSet(key, async () => {
      const { getHomeDashboardPayload } = await import('../services/tradeAuditAnalytics.js');
      const { getLocalControlServicesLite, getLocalControlSettings } = await import('../services/controlCenter.js');
      const { getSignalEngineStatus } = await import('../services/signalEngineSelector.js');
      const [trade, controlLite, settings, signal_engine] = await Promise.all([
        getHomeDashboardPayload({ day: req.query.day || null, tz, dbOnly: true }),
        getLocalControlServicesLite(),
        getLocalControlSettings(),
        getSignalEngineStatus(),
      ]);
      return {
        trade,
        control: {
          services: controlLite.services,
          scanner: controlLite.scanner,
          mode: controlLite.mode,
        },
        settings,
        signal_engine,
        generated_at: new Date().toISOString(),
      };
    }, { ttlSec: 15, staleSec: 120 });

    res.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=90');
    res.set('X-Cache', cache);
    res.json({ ...data, cache });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/market-data/progress', async (req, res) => {
  try {
    const { cacheGetOrSet } = await import('../services/cache.js');
    const { getMarketDataProgress, isMarketDataConfigured } = await import('../services/marketDataClient.js');
    if (!isMarketDataConfigured()) {
      return res.status(503).json({ error: 'RESEARCH_API_URL not configured' });
    }
    const { data, cache } = await cacheGetOrSet(
      'dash:market-data:progress',
      () => getMarketDataProgress(),
      { ttlSec: 15, staleSec: 60 },
    );
    res.set('X-Cache', cache);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/** Compact archive + live WS candle sync status for home dashboard. */
router.get('/candles/sync-status', async (req, res) => {
  try {
    const { cacheGetOrSet } = await import('../services/cache.js');
    const { getCandleSyncStatus } = await import('../services/candleSyncStatus.js');
    const { data, cache } = await cacheGetOrSet(
      'dash:candles:sync-status',
      () => getCandleSyncStatus(),
      { ttlSec: 15, staleSec: 60 },
    );
    res.set('X-Cache', cache);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades/open/audit', async (req, res) => {
  try {
    const { getOpenTradesAudit } = await import('../services/tradeAuditAnalytics.js');
    const dbOnly = req.query.live !== '1' && req.query.live !== 'true';
    res.json(await getOpenTradesAudit({ dbOnly }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trades/:id/lifecycle', async (req, res) => {
  try {
    const { getTradeLifecycle } = await import('../services/tradeAuditAnalytics.js');
    res.json(await getTradeLifecycle(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Full audit trail for a trade: every execution event + every partial close
 * (TP1/TP2 fills, SL moves, fees). This data was already being recorded — this
 * endpoint exposes it so the dashboard can show a per-trade timeline. */
router.get('/trades/:id/audit', async (req, res) => {
  try {
    const { getTradeEvents, getTradePartials } = await import('../services/tradeEventAudit.js');
    const [eventsRes, partialsRes] = await Promise.all([
      getTradeEvents(req.params.id, parseInt(req.query.limit || '200', 10)),
      getTradePartials(req.params.id),
    ]);
    res.json({
      trade_id: req.params.id,
      events: eventsRes?.data || [],
      partial_closes: partialsRes?.data || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Sync DB with exchange — close open DB records when Binance is flat. */
router.post('/trades/reconcile-flat', async (req, res) => {
  try {
    const result = await reconcileAllFlatExchangeTrades({ skipNotify: req.body?.notify !== true });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Live Binance protection snapshot for a trade (SL/TP algo orders). */
router.get('/trades/:id/protection', async (req, res) => {
  try {
    const trade = await loadActionTrade(req.params.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });
    const verify = await verifyExchangeProtection(trade.symbol);
    res.json({ trade_id: trade.id, symbol: trade.symbol, status: trade.status, verify });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Reconcile closed trade PnL from Binance realized income (fixes partial-close mismatches). */
router.post('/trades/:id/sync-pnl', async (req, res) => {
  try {
    const db = getSupabase();
    if (!db) return res.status(503).json({ error: 'DB unavailable' });
    const { data: trade, error } = await db.from('trades').select('*').eq('id', req.params.id).single();
    if (error || !trade) return res.status(404).json({ error: 'Trade not found' });

    const { getRealizedPnlSince } = await import('../services/userBinance.js');
    const sinceMs = trade.opened_at
      ? new Date(trade.opened_at).getTime() - 120000
      : undefined;
    const exchange = await getRealizedPnlSince(trade.symbol, sinceMs);
    if (exchange?.total == null) {
      return res.status(400).json({ error: exchange?.error || 'Could not fetch Binance realized PnL' });
    }

    const entry = parseFloat(trade.entry_price);
    const originalQty = parseFloat(trade.original_quantity || trade.quantity);
    const risk = Math.abs(entry - parseFloat(trade.initial_stop_loss || trade.stop_loss));
    const pnl = exchange.total;
    const rMultiple = risk > 0 && originalQty > 0 ? pnl / (risk * originalQty) : 0;
    const pnlPercent = entry && originalQty ? (pnl / (entry * originalQty)) * 100 : 0;
    const outcome = pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';

    const { data: updated, error: updateError } = await updateTrade(trade.id, {
      pnl,
      pnl_percent: pnlPercent,
      r_multiple: rMultiple,
      exchange_realized_pnl: pnl,
    });
    if (updateError) return res.status(500).json({ error: updateError.message || updateError });

    res.json({
      success: true,
      outcome,
      pnl,
      exchange_rows: exchange.rows,
      trade: await enrichTrade(updated),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trading/dashboard', async (req, res) => {
  try {
    res.json(await buildTradingDashboard());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/paper/dashboard', async (req, res) => {
  try {
    res.json(await buildTradingDashboard());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/trades/:id/close', async (req, res) => {
  try {
    let { trade, live, persisted } = await loadActionTrade(req.params.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });
    if (!live || live.quantity <= 0) {
      if (persisted && ['open', 'partial'].includes(trade.status)) {
        const reconciled = await reconcileFlatExchangeTrade(trade, null, { skipNotify: false, force: true });
        if (reconciled) {
          return res.json({ success: true, trade: await enrichTrade(reconciled), reconciled: true });
        }
      }
      await logEvent('warn', 'trades.close', 'Close blocked: Binance position could not be verified', {
        tradeId: trade.id,
        symbol: trade.symbol,
      });
      return res.status(409).json({
        error: 'Close blocked: Binance did not return an open position for this symbol. Trade was NOT marked closed.',
        symbol: trade.symbol,
      });
    }
    if (persisted && !['open', 'partial'].includes(trade.status)) {
      const reopened = await findDbTradeForLivePosition(trade.symbol, live.quantity);
      if (reopened) trade = reopened;
    }
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const requestedQty = toNumber(req.body?.quantity || live.quantity);
    const qty = roundApiQty(Math.min(requestedQty, live.quantity));
    const credentials = await getActiveApiKeys();
    if (credentials) {
      await placeMarketOrderWithCredentials(credentials, { symbol: trade.symbol, side, quantity: qty, reduceOnly: true });
      await cancelAllOrdersWithCredentials(credentials, trade.symbol).catch(() => {});
    } else {
      await placeMarketOrder(trade.symbol, side, qty, true);
      await cancelAllOrders(trade.symbol).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 400));
    const exitPrice = await getMarkPrice(trade.symbol);
    const remainQty = roundApiQty(Math.max(0, live.quantity - qty));
    if (!persisted) {
      return res.json({
        success: true,
        closed: remainQty <= 0,
        trade: { ...trade, quantity: remainQty, status: remainQty > 0 ? 'partial' : 'closed' },
      });
    }
    if (remainQty > 0) {
      const exchPnl = await fetchExchangeRealizedPnl(trade).catch(() => null);
      const updates = {
        quantity: remainQty,
        status: 'partial',
        closed_at: null,
        exit_price: null,
        close_reason: null,
      };
      if (exchPnl?.total != null) {
        updates.exchange_realized_pnl = exchPnl.total;
        updates.pnl = exchPnl.total;
      }
      const { data: updated, error: updateError } = await updateTrade(trade.id, updates);
      if (updateError) return res.status(500).json({ error: updateError.message || updateError });
      return res.json({ success: true, trade: await enrichTrade(updated) });
    }
    const closed = await finalizeTradeClose(
      trade,
      {
        exitPrice,
        status: 'closed',
        reason: req.body?.reason || 'Manual close — runner exited',
        skipReview: false,
        force: true,
      },
    );
    if (!closed) return res.status(500).json({ error: 'Failed to persist trade close' });
    return res.json({ success: true, trade: await enrichTrade(closed) });
  } catch (err) {
    await logEvent('error', 'trades.close', err.message, { tradeId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

router.post('/trades/:id/partial', async (req, res) => {
  try {
    const { trade, live, persisted } = await loadActionTrade(req.params.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });
    if (!live || live.quantity <= 0) return res.status(400).json({ error: 'No open Binance position to reduce' });
    const percent = Math.min(Math.max(toNumber(req.body?.percent, 30), 1), 100);
    const qty = roundApiQty(live.quantity * (percent / 100));
    if (qty <= 0) return res.status(400).json({ error: 'Partial quantity is zero' });

    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const credentials = await getActiveApiKeys();
    if (credentials) {
      await placeMarketOrderWithCredentials(credentials, { symbol: trade.symbol, side, quantity: qty, reduceOnly: true });
    } else {
      await placeMarketOrder(trade.symbol, side, qty, true);
    }
    const exitPrice = await getMarkPrice(trade.symbol);
    const realized = trade.direction === 'LONG'
      ? (exitPrice - toNumber(trade.entry_price)) * qty
      : (toNumber(trade.entry_price) - exitPrice) * qty;
    const remainQty = roundApiQty(Math.max(0, live.quantity - qty));
    if (!persisted) {
      return res.json({
        success: true,
        trade: { ...trade, quantity: remainQty, pnl: toNumber(trade.pnl) + realized, status: remainQty > 0 ? 'partial' : 'closed' },
      });
    }
    const updates = {
      quantity: remainQty,
      pnl: toNumber(trade.pnl) + realized,
      status: remainQty > 0 ? 'partial' : 'closed',
      ...(remainQty <= 0 ? {
        exit_price: exitPrice,
        close_reason: 'Manual partial close completed position',
        closed_at: new Date().toISOString(),
      } : {}),
    };
    const { data: updated, error: updateError } = await updateTrade(trade.id, updates);
    if (updateError) return res.status(500).json({ error: updateError.message || updateError });
    res.json({ success: true, trade: await enrichTrade(updated) });
  } catch (err) {
    await logEvent('error', 'trades.partial', err.message, { tradeId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/trades/:id/levels', async (req, res) => {
  try {
    const { trade, live, persisted } = await loadActionTrade(req.params.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    const stopLoss = req.body?.stop_loss != null ? toNumber(req.body.stop_loss) : toNumber(trade.stop_loss);
    const tp1 = req.body?.tp1 != null ? toNumber(req.body.tp1) : trade.tp1;
    const tp2 = req.body?.tp2 != null ? toNumber(req.body.tp2) : trade.tp2;
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const liveQty = live?.quantity || toNumber(trade.quantity);

    if (!stopLoss || stopLoss <= 0) {
      return res.status(400).json({ error: 'Stop loss is required before updating position levels.' });
    }

    const credentials = await getActiveApiKeys();
    if (credentials) {
      await cancelAllOrdersWithCredentials(credentials, trade.symbol).catch(() => {});
    } else {
      await cancelAllOrders(trade.symbol).catch(() => {});
    }
    if (stopLoss > 0 && liveQty > 0) {
      if (credentials) {
        await placeStopMarketOrderWithCredentials(credentials, { symbol: trade.symbol, side, stopPrice: stopLoss, quantity: liveQty });
      } else {
        await placeStopMarketOrder(trade.symbol, side, stopLoss, liveQty);
      }
    }
    if (tp1 && liveQty > 0) {
      const tp1Qty = roundApiQty(liveQty * 0.3);
      if (credentials) {
        await placeTakeProfitOrderWithCredentials(credentials, { symbol: trade.symbol, side, stopPrice: tp1, quantity: tp1Qty }).catch((err) =>
          logEvent('warn', 'trades.levels', `TP1 order failed: ${err.message}`, { tradeId: trade.id })
        );
      } else {
        await placeTakeProfitOrder(trade.symbol, side, tp1, tp1Qty).catch((err) =>
          logEvent('warn', 'trades.levels', `TP1 order failed: ${err.message}`, { tradeId: trade.id })
        );
      }
    }
    if (tp2 && liveQty > 0) {
      const tp2Qty = roundApiQty(liveQty * 0.4);
      if (credentials) {
        await placeTakeProfitOrderWithCredentials(credentials, { symbol: trade.symbol, side, stopPrice: tp2, quantity: tp2Qty }).catch((err) =>
          logEvent('warn', 'trades.levels', `TP2 order failed: ${err.message}`, { tradeId: trade.id })
        );
      } else {
        await placeTakeProfitOrder(trade.symbol, side, tp2, tp2Qty).catch((err) =>
          logEvent('warn', 'trades.levels', `TP2 order failed: ${err.message}`, { tradeId: trade.id })
        );
      }
    }

    if (!persisted) {
      return res.json({
        success: true,
        trade: await enrichTrade({ ...trade, stop_loss: stopLoss, tp1, tp2 }, live),
      });
    }

    const { data: updated, error: updateError } = await updateTrade(trade.id, {
      stop_loss: stopLoss,
      tp1,
      tp2,
      sl_updated_at: new Date().toISOString(),
    });
    if (updateError) return res.status(500).json({ error: updateError.message || updateError });
    res.json({ success: true, trade: await enrichTrade(updated) });
  } catch (err) {
    await logEvent('error', 'trades.levels', err.message, { tradeId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

// Get pair stats
router.get('/pairs/stats', async (req, res) => {
  const { data, error } = await getPairStats();
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Get performance metrics
router.get('/performance', async (req, res) => {
  const { data, error } = await getPerformanceMetrics();
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Get balance (user keys from DB when signed in)
router.get('/balance', optionalAuth, async (req, res) => {
  try {
    const { cacheGetOrSet } = await import('../services/cache.js');
    const userKey = req.user?.id || 'default';
    const { data, cache } = await cacheGetOrSet(`dash:balance:${userKey}`, async () => {
      if (req.user) {
        await loadUserCredentials(req.user.id);
        return getBalanceForUser(req.user.id);
      }
      return getBalanceForUser(null);
    }, { ttlSec: 20, staleSec: 60 });
    res.set('X-Cache', cache);
    res.json(data);
  } catch (err) {
    const fallback = parseFloat(process.env.DEMO_BALANCE_FALLBACK || '5000');
    res.json({
      total: fallback,
      available: fallback,
      source: 'fallback',
      error: err.message,
      exchange_unreachable: true,
    });
  }
});

// Trade protection flow test (internal only)
router.post('/test/trade-flow', requireInternalOrAuth, async (req, res) => {
  try {
    const symbol = (req.body?.symbol || 'DOGEUSDT').toUpperCase();
    const shouldClose = req.body?.close === true;
    const mark = await getMarkPrice(symbol);
    const rules = await getSymbolRules(symbol);
    const riskPct = 0.008;
    const risk = mark * riskPct;
    const stopLoss = roundPriceToTick(mark - risk, rules.tickSize);
    const tp1 = roundPriceToTick(mark + risk, rules.tickSize);
    const tp2 = roundPriceToTick(mark + risk * 2, rules.tickSize);

    await sendAlert(`🧪 Trade flow test starting: ${symbol} LONG @ ${mark}`).catch(() => {});

    const execRes = await fetch(internalApiUrl('/api/execute'), {
      method: 'POST',
      headers: internalApiHeaders(),
      body: JSON.stringify({
        symbol,
        direction: 'BUY',
        stop_loss: stopLoss,
        tp1,
        tp2,
        use_risk_sizing: true,
        manual_approved: true,
        test_levels_refreshed: true,
        source: 'api-test-trade-flow',
      }),
    });
    const execBody = await execRes.json();
    if (!execRes.ok || !execBody.success) {
      return res.status(execRes.status || 500).json({ error: execBody.error || 'Execute failed', details: execBody });
    }

    await new Promise((r) => setTimeout(r, 1200));
    const verify = await verifyExchangeProtection(symbol);

    await sendTradeUpdate(execBody.trade, `Protection check: SL×${verify.slCount} TP×${verify.tpCount} · qty ${verify.positionQty}`).catch(() => {});

    if (shouldClose) {
      const credentials = await getActiveApiKeys();
      const side = 'SELL';
      if (credentials) {
        await cancelAllOrdersWithCredentials(credentials, symbol).catch(() => {});
        const rows = await getPositionRiskWithCredentials(credentials, symbol);
        const qty = Math.abs(parseFloat(rows.find((r) => r.symbol === symbol)?.positionAmt || 0));
        if (qty > 0) await placeMarketOrderWithCredentials(credentials, { symbol, side, quantity: qty, reduceOnly: true });
      } else {
        await cancelAllOrders(symbol).catch(() => {});
        const rows = await getPositionRisk(symbol);
        const row = Array.isArray(rows) ? rows.find((r) => r.symbol === symbol) : rows;
        const qty = Math.abs(parseFloat(row?.positionAmt || 0));
        if (qty > 0) await placeMarketOrder(symbol, side, qty, true);
      }
    }

    res.json({
      success: true,
      trade: execBody.trade,
      orders: { sl: execBody.slOrder, tp1: execBody.tp1Order, tp2: execBody.tp2Order },
      verify,
      protectionOk: verify.hasPosition && verify.slCount >= 1 && verify.tpCount >= 1,
      closed: shouldClose,
    });
  } catch (err) {
    await logEvent('error', 'test.tradeFlow', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/test/sl-workflow-batch', requireInternalOrAuth, async (req, res) => {
  try {
    const symbols = (req.body?.symbols || ['DOGEUSDT', 'XRPUSDT', 'ADAUSDT']).map((s) => String(s).toUpperCase());
    const tight = parseFloat(req.body?.tight || '0.0012');
    const direction = String(req.body?.direction || 'SHORT').toUpperCase();
    const { spawn } = await import('child_process');
    const child = spawn('node', [
      'scripts/test-sl-workflow-batch.js',
      ...symbols,
      '--direction', direction,
      '--tight', String(tight),
      '--cleanup',
      '--max-wait', String(req.body?.max_wait_ms || 480000),
    ], { cwd: process.cwd(), stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    await new Promise((resolve, reject) => {
      child.on('close', (code) => (code === 0 || code === 2 ? resolve() : reject(new Error(`exit ${code}`))));
      child.on('error', reject);
    });
    res.json({ ok: true, output: out.slice(-8000) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Execute trade (called from n8n or Telegram BUY NOW)
router.post('/execute', strictRateLimit(20), optionalAuth, requireInternalOrAuth, async (req, res) => {
  let execLockKey = null;
  try {
    const signal = req.body;
    const requestedPositionSizeUsdt = parseFloat(signal.position_size_usdt || 0);

    const lock = await acquireExecutionLock(signal, { source: signal.source || 'api' });
    if (!lock.acquired) {
      await logDuplicateBlocked(signal, lock, 'execute');
      return res.status(409).json({
        error: 'Duplicate execution blocked',
        reason: lock.reason,
        tradeId: lock.tradeId,
        duplicate: true,
      });
    }
    execLockKey = lock.key;

    const validation = await validateTradeExecution(signal);
    if (!validation.passed) {
      return res.status(400).json({
        error: 'Risk validation failed',
        checks: validation.checks,
      });
    }

    const { validateExecutionGate } = await import('../services/tradeExecutionGate.js');
    const gate = await validateExecutionGate(signal);
    if (!gate.passed) {
      return res.status(400).json({
        error: gate.reason || 'Execution gate blocked',
        checks: gate.checks,
        blocked: true,
      });
    }

    const symbol = signal.symbol;
    if (isBlockedTradeSymbol(symbol)) {
      return res.status(400).json({
        error: `Trade blocked: ${symbol} is a stablecoin pair with negligible price risk — not suitable for risk-based trading`,
      });
    }
    const direction = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
    const side = signal.direction === 'BUY' ? 'BUY' : 'SELL';
    const markPrice = await getMarkPrice(symbol);
    const entryPrice = markPrice;
    const rules = await getSymbolRules(symbol);
    const stopLoss = roundPriceToTick(parseFloat(signal.stop_loss), rules.tickSize);
    const tp1 = roundPriceToTick(parseFloat(signal.tp1), rules.tickSize);
    const tp2 = roundPriceToTick(parseFloat(signal.tp2), rules.tickSize);
    if (!Number.isFinite(stopLoss) || stopLoss <= 0 || !Number.isFinite(tp1) || tp1 <= 0 || !Number.isFinite(tp2) || tp2 <= 0) {
      return res.status(400).json({ error: 'Trade blocked: valid stop_loss, tp1, and tp2 are required before execution' });
    }
    const preferredLeverage = parseInt(
      req.body.leverage || config.telegram?.defaultLeverage || '50',
      10,
    );

    const credentials = await getActiveApiKeys();
    const setLevFn = credentials
      ? (sym, lev) => setLeverageWithCredentials(credentials, sym, lev)
      : (sym, lev) => setLeverage(sym, lev);

    const explicitNotional = parseFloat(signal.notional_usdt || 0)
      || (requestedPositionSizeUsdt > 0 && signal.size_mode === 'notional' ? requestedPositionSizeUsdt : 0);
    const useRiskSizing = signal.use_risk_sizing === true
      || (!explicitNotional && signal.size_mode !== 'notional');

    let accountEquity = validation.balance || 0;
    let availableBalance = validation.balance || 0;
    try {
      const bal = await getBalanceForUser(null);
      accountEquity = parseFloat(bal.total) || parseFloat(bal.available) || accountEquity;
      availableBalance = parseFloat(bal.available) || accountEquity;
    } catch {
      /* use validation balance */
    }
    if (!accountEquity || accountEquity <= 0) {
      return res.status(400).json({ error: 'Account equity unavailable — cannot size trade' });
    }

    const riskPercent = config.strategy.riskPerTrade || 0.01;
    let resolved;

    if (useRiskSizing) {
      resolved = await resolveRiskBasedOrderSizing(symbol, {
        accountEquity,
        availableBalance,
        entryPrice: markPrice,
        stopLossPrice: stopLoss,
        riskPercent,
        preferredLeverage,
        setLeverageFn: setLevFn,
      });
    } else {
      resolved = await resolveOrderSizing(symbol, {
        notionalUsdt: explicitNotional,
        preferredLeverage,
        priceHint: markPrice,
        setLeverageFn: setLevFn,
      });
    }

    let leverage = resolved.leverage;
    let marginUsdt = resolved.marginUsdt;
    let qty = resolved.qty;
    let notional = resolved.notional;

    if (qty <= 0) {
      return res.status(400).json({ error: 'Calculated quantity is zero' });
    }

    const levelIssues = (signal.test_levels_refreshed || signal.levels_adapted || (config.externalSignals.testMode && signal.manual_approved))
      ? []
      : protectionTriggerIssues(direction, markPrice, { stopLoss, tp1, tp2 });
    if (levelIssues.length > 0) {
      return res.status(409).json({
        error: 'Cannot open trade: price has already passed signal levels',
        stale_levels: levelIssues,
        mark_price: markPrice,
        hint: 'Signal is too old or price moved — wait for a fresh signal from the group',
      });
    }

    let order, slOrder, tp1Order, tp2Order;

    if (credentials) {
      const result = await executeWithCredentials(credentials, {
        symbol,
        side,
        quantity: qty,
        stopLoss,
        leverage,
        skipLeverageSet: true,
        skipProtection: true,
      });
      order = result.order;
      leverage = result.leverage || leverage;
      if (result.qty) {
        qty = result.qty;
        notional = qty * markPrice;
        marginUsdt = notional / leverage;
      }
    } else {
      await setLeverageWithFallback(symbol, leverage, setLevFn);
      const placed = await placeMarketOrderResilient(symbol, side, qty, false, {
        leverage,
        setLeverageFn: setLevFn,
        priceHint: markPrice,
      });
      order = placed.order;
      qty = placed.qty;
      leverage = placed.leverage || leverage;
      notional = qty * markPrice;
      marginUsdt = notional / leverage;
      const slSide = side === 'BUY' ? 'SELL' : 'BUY';
      try {
        slOrder = await placeStopMarketOrder(symbol, slSide, stopLoss, null, { closePosition: true });
      } catch (err) {
        await logEvent('error', 'execute', `SL order failed: ${err.message}`, { symbol });
      }
    }

    if (order) {
      ({ slOrder, tp1Order } = await placeInitialTradeProtection(
        { symbol, direction, quantity: qty, stopLoss, tp1 },
        credentials,
      ));
    }

    if (!slOrder) {
      const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
      if (credentials) {
        await cancelAllOrdersWithCredentials(credentials, symbol).catch(() => {});
        await placeMarketOrderWithCredentials(credentials, { symbol, side: closeSide, quantity: qty, reduceOnly: true }).catch((err) =>
          logEvent('error', 'execute', `Emergency close failed after missing protection: ${err.message}`, { symbol, qty })
        );
      } else {
        await cancelAllOrders(symbol).catch(() => {});
        await placeMarketOrder(symbol, closeSide, qty, true).catch((err) =>
          logEvent('error', 'execute', `Emergency close failed after missing protection: ${err.message}`, { symbol, qty })
        );
      }
      return res.status(500).json({
        error: 'Trade protection failed: stop-loss order is required. Position was closed to avoid unmanaged risk.',
        protection: { sl: Boolean(slOrder) },
      });
    }

    const trade = {
      signal_id: signal.id,
      symbol,
      direction,
      entry_price: entryPrice,
      quantity: qty,
      original_quantity: qty,
      initial_stop_loss: stopLoss,
      stop_loss: stopLoss,
      tp1,
      tp2,
      tp3: signal.tp3,
      binance_order_id: order.orderId?.toString(),
      binance_sl_order_id: slOrder?.algoId?.toString() || slOrder?.orderId?.toString() || null,
      risk_amount: resolved.riskAmount || validation.riskAmount,
      leverage,
      notional_usdt: notional,
      margin_usdt: marginUsdt,
      sizing_mode: resolved.sizing_mode || (useRiskSizing ? 'risk_percent' : 'fixed_notional'),
      status: 'open',
      opened_at: new Date().toISOString(),
    };

    if (signal.id) {
      const db = getSupabase();
      const { data: signalRow } = await db?.from('signals').select('*').eq('id', signal.id).maybeSingle() || {};
      if (signalRow) {
        const lineage = extractLineageFromSignal(signalRow);
        const receivedAt = signalRow.created_at || new Date().toISOString();
        const latencyMs = Date.now() - new Date(receivedAt).getTime();
        trade.signal_received_at = receivedAt;
        trade.execution_latency_ms = latencyMs >= 0 ? latencyMs : null;
        trade.signal_source = signal.source || lineage.source;
        trade.strategy_name = signalRow.strategy_name || lineage.strategy;
      }
    } else if (signal.source) {
      trade.signal_source = signal.source;
    }

    const { data: savedTrade, error: saveTradeError } = await saveTrade(trade);
    if (saveTradeError || !savedTrade) {
      const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
      if (credentials) {
        await cancelAllOrdersWithCredentials(credentials, symbol).catch(() => {});
        await placeMarketOrderWithCredentials(credentials, { symbol, side: closeSide, quantity: qty, reduceOnly: true }).catch((err) =>
          logEvent('error', 'execute', `Emergency close failed after DB save failure: ${err.message}`, { symbol, qty })
        );
      } else {
        await cancelAllOrders(symbol).catch(() => {});
        await placeMarketOrder(symbol, closeSide, qty, true).catch((err) =>
          logEvent('error', 'execute', `Emergency close failed after DB save failure: ${err.message}`, { symbol, qty })
        );
      }
      await logEvent('error', 'execute', `Trade DB save failed: ${saveTradeError?.message || saveTradeError || 'unknown error'}`, { symbol });
      return res.status(500).json({
        error: 'Trade opened and protected, but DB save failed. Position was closed to avoid unmanaged risk.',
      });
    }

    if (signal.id) {
      await updateSignal(signal.id, { status: 'accepted', user_action: 'executed' });
      scheduleSignalOutcomeCheck({ id: signal.id, symbol, direction: signal.direction });
    }

    await logEvent('trade', 'execute', `Trade opened: ${direction} ${symbol}`, {
      tradeId: savedTrade?.id,
      qty,
      entry: entryPrice,
      notional,
      leverage,
    });

    broadcastTradeEvent('opened', savedTrade, { margin_usdt: marginUsdt, leverage, notional_usdt: notional });

    const { verify, plan, protectionOk } = await finalizeTradeOpen({
      savedTrade,
      signal,
      sizing: {
        marginUsdt,
        leverage,
        notional,
        riskAmount: resolved.riskAmount || validation.riskAmount,
      },
      slOrder,
      tp1Order,
      tp2Order,
    });

    const { auditTradeOpen } = await import('../services/tradeEventAudit.js');
    await auditTradeOpen(savedTrade, {
      order,
      slOrder,
      tp1Order,
      tp2Order,
      riskPercentage: riskPercent,
    }).catch((err) =>
      logEvent('warn', 'execute', `Trade audit open failed: ${err.message}`, { tradeId: savedTrade?.id }),
    );

    res.json({
      success: true,
      trade: savedTrade,
      protection: { verify, plan, ok: protectionOk },
      sizing: {
        mode: resolved.sizing_mode || (useRiskSizing ? 'risk_percent' : 'fixed_notional'),
        riskAmount: resolved.riskAmount,
        notional,
        marginUsdt,
        leverage,
        riskPercent,
      },
      order,
      slOrder,
      tp1Order,
      tp2Order,
      validation,
    });
  } catch (err) {
    await logEvent('error', 'execute', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    releaseExecutionLock(execLockKey);
  }
});

// Skip signal
router.post('/signal/:id/skip', async (req, res) => {
  await updateSignal(req.params.id, { status: 'skipped', user_action: 'skipped' });
  await logEvent('info', 'signal', `Signal skipped: ${req.params.id}`);
  res.json({ success: true });
});

// Signal performance analytics (Phase 2 → Phase 4)
router.get('/analytics/signals', async (req, res) => {
  try {
    const report = await getSignalPerformanceReport({ days: req.query.days || 90 });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/signals/feed', async (req, res) => {
  try {
    res.json(await getSignalPerformanceFeed({
      days: req.query.days || 90,
      limit: req.query.limit || 100,
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/analytics/lessons/recent', async (req, res) => {
  try {
    const lessons = await getRecentLessons(parseInt(req.query.limit || '30', 10));
    res.json({ lessons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/strategy/backtest-gate/:strategyId', async (req, res) => {
  try {
    const result = await validateBacktestGate(req.params.strategyId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trade lessons — skipped signals
router.get('/lessons/skipped', async (req, res) => {
  const { data, error } = await getTradeLessons('skipped', parseInt(req.query.limit || '30', 10));
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Trade lessons — executed real trades
router.get('/lessons/executed', async (req, res) => {
  const { data, error } = await getTradeLessons('executed', parseInt(req.query.limit || '30', 10));
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// All hypothetical (not acted) lessons
router.get('/lessons/hypothetical', async (req, res) => {
  const { data, error } = await getTradeLessons('hypothetical', parseInt(req.query.limit || '30', 10));
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// Lesson win/loss stats
router.get('/lessons/stats', async (req, res) => {
  const stats = await getLessonStats();
  res.json(stats);
});

// Signal outcomes for a signal
router.get('/signals/:id/outcomes', async (req, res) => {
  const { data, error } = await getSignalOutcomes(req.params.id);
  if (error) return res.status(500).json({ error });
  res.json(data);
});

// n8n → backend: new signal webhook
router.post('/webhook/n8n/signal', async (req, res) => {
  await logEvent('info', 'n8n', 'Signal webhook received', req.body);
  res.json({ received: true });
});

// n8n → backend: trade executed confirmation
router.post('/webhook/n8n/trade', async (req, res) => {
  await logEvent('trade', 'n8n', 'Trade webhook received', req.body);
  res.json({ received: true });
});

// Webhook endpoint for n8n position updates
router.post('/webhook/position-update', async (req, res) => {
  await logEvent('info', 'webhook', 'Position update from n8n', req.body);
  res.json({ received: true });
});

// AI context for gateway/n8n
router.get('/ai/context', async (req, res) => {
  try {
    const context = await buildTradingContext();
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI query — Telegram, dashboard, n8n
router.post('/ai/query', async (req, res) => {
  try {
    const { question, chatId } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });

    const result = chatId
      ? await askPersonalAssistant(chatId, question)
      : await askTradingAgent(question);
    res.json({ answer: result.answer, model: result.model, source: result.source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI lessons endpoints
router.get('/ai/lessons/:type', async (req, res) => {
  const type = req.params.type;
  if (!['wins', 'losses', 'skipped', 'all'].includes(type)) {
    return res.status(400).json({ error: 'type must be wins, losses, skipped, or all' });
  }
  const summary = await getLessonsSummary(type);
  if (typeof summary === 'string') return res.json({ answer: summary });
  res.json(summary);
});

// AI health check
router.get('/ai/health', async (req, res) => {
  const [ollama, context, openclaw] = await Promise.all([
    checkOllamaHealth(),
    buildTradingContext().catch(() => null),
    checkOpenClawHealth(),
  ]);

  let gateway = { ok: false };
  if (config.ai?.gatewayUrl) {
    try {
      const r = await fetch(`${config.ai.gatewayUrl}/health`, { signal: AbortSignal.timeout(5000) });
      gateway = { ok: r.ok, ...(await r.json()) };
    } catch (err) {
      gateway = { ok: false, error: err.message };
    }
  }

  res.json({ ollama, gateway, openclaw, hasContext: !!context });
});
router.post('/telegram/callback', async (req, res) => {
  try {
    const { handleTelegramCallback } = await import('../services/telegramTrade.js');
    const result = await handleTelegramCallback(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/telegram/test-parse', async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages)
      ? req.body.messages
      : req.body?.message
        ? [req.body.message]
        : [];
    if (!messages.length) {
      return res.status(400).json({ error: 'message or messages[] required' });
    }
    const {
      inferSymbolFromInformalText,
      inferDirectionFromText,
      stripGroupRiskHints,
      enrichTelegramSignalWithSmc,
    } = await import('../services/telegramSignalEnrichment.js');
    const { ingestExternalSignal } = await import('../services/externalSignalIngestion.js');
    const { checkInstitutionalSmcHealth } = await import('../services/institutionalSmcClient.js');
    const health = await checkInstitutionalSmcHealth();
    const results = [];

    for (const raw of messages) {
      const text = stripGroupRiskHints(String(raw || ''));
      const symbol = inferSymbolFromInformalText(text);
      const direction = inferDirectionFromText(text);
      const hint = {
        provider: req.body?.group || 'Test VIP',
        symbol,
        side: direction === 'SELL' ? 'SHORT' : 'LONG',
        raw_message: raw,
        timestamp: new Date().toISOString(),
        parser: 'informal-test',
        metadata: { informal_signal: true, group_title: req.body?.group || 'Test VIP' },
      };
      if (!symbol || !direction) {
        results.push({ raw, ok: false, reason: 'parse_failed', symbol, direction });
        continue;
      }
      const enriched = await enrichTelegramSignalWithSmc(hint);
      if (!enriched.enrichment?.ok) {
        results.push({
          raw,
          ok: false,
          symbol,
          direction,
          reason: enriched.enrichment.reason,
          score: enriched.enrichment.smc_score ?? null,
          mark_price: enriched.enrichment.mark_price ?? null,
          engine: enriched.enrichment.engine,
        });
        continue;
      }
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
      results.push({
        raw,
        ok: validation.passed,
        symbol: enriched.symbol,
        side: enriched.side,
        direction: enriched.direction,
        entry: enriched.entry_price,
        stop_loss: enriched.stop_loss,
        tp1: enriched.tp1,
        tp2: enriched.tp2,
        tp3: enriched.tp3,
        score: validation.validation?.score,
        mark_price: enriched.enrichment.mark_price,
        engine: enriched.metadata?.smc_engine,
        institutional: validation.validation?.institutional,
        passed: validation.passed,
        reason: validation.reason,
        checks: validation.validation?.checks,
      });
    }
    res.json({ ok: true, engine_health: health, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/telegram/test', async (req, res) => {
  try {
    await sendAlert('<b>🧪 Telegram Test</b>\n\nYour bot is connected and working correctly.');
    res.json({ success: true, message: 'Test message sent to Telegram' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resend latest pending signal to Telegram
router.post('/telegram/resend-latest', async (req, res) => {
  try {
    const db = getSupabase();
    const { data: signals } = await db
      .from('signals')
      .select('*')
      .eq('status', 'pending')
      .is('telegram_message_id', null)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!signals?.length) {
      return res.json({ success: false, message: 'No pending signals to resend' });
    }

    const signal = signals[0];
    const messageId = await sendSignalNotification(signal, signal.id);
    if (messageId) {
      await db.from('signals').update({ telegram_message_id: messageId, status: 'sent' }).eq('id', signal.id);
    }
    res.json({ success: true, signal: signal.symbol, direction: signal.direction, messageId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Top pairs list (all futures or fallback)
router.get('/pairs', async (req, res) => {
  try {
    const all = req.query.all === 'true';
    if (all) {
      const symbols = await getAllFuturesSymbols();
      return res.json(symbols);
    }
    res.json(config.topPairs);
  } catch {
    res.json(config.topPairs);
  }
});

// Strategy registry
router.get('/strategies', (req, res) => {
  res.json(listStrategies());
});

// Strategy catalog — real strategies + best backtest metrics from DB (replaces dashboard mock data)
router.get('/strategies/catalog', async (req, res) => {
  try {
    const [catalog, rankings] = await Promise.all([
      listCatalog(),
      getBacktestRankings(200),
    ]);

    // Keep the single best (highest score) backtest run per strategy_id.
    const bestByStrategy = new Map();
    for (const run of rankings) {
      const prev = bestByStrategy.get(run.strategy_id);
      if (!prev || (Number(run.score) || 0) > (Number(prev.score) || 0)) {
        bestByStrategy.set(run.strategy_id, run);
      }
    }

    const strategies = catalog.map((s) => {
      const run = bestByStrategy.get(s.id);
      const metrics = run
        ? {
            win_rate: Number(run.win_rate) || 0,
            profit_factor: Number(run.profit_factor) || 0,
            sharpe_ratio: Number(run.sharpe) || 0,
            max_drawdown_pct: Number(run.max_drawdown) || 0,
            total_trades: Number(run.total_trades) || 0,
            return_pct: run.return_pct != null ? Number(run.return_pct) : undefined,
          }
        : undefined;

      return {
        id: s.id,
        name: s.name || s.id,
        status: s.status || 'draft',
        engine: s.engine || 'native',
        source: s.source || 'native',
        rules: Array.isArray(s.rules) ? s.rules : undefined,
        deployment: s.status === 'production' ? 'live' : s.deployment || undefined,
        metrics,
        last_backtest_at: run?.created_at || null,
      };
    });

    res.json({ strategies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/strategies/:id/chart-setups', async (req, res) => {
  try {
    const { symbol, interval = '5m', period = '1m' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol query required' });
    res.json(await getChartSetups(symbol, req.params.id, { interval, period }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Strategy stats dashboard
router.get('/strategy/stats', async (req, res) => {
  try {
    const strategyId = req.query.strategy || 'smc-mtf';
    if (strategyId === 'freqtrade') {
      const ft = await getFreqtradeStatsBundle();
      return res.json({ strategyId: 'freqtrade', ...ft });
    }
    const stats = await getStrategyStats();
    res.json({ strategyId: 'smc-mtf', engine: 'native', ...stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Learned patterns
router.get('/strategy/patterns', async (req, res) => {
  try {
    const patterns = await getLearnedPatterns(parseInt(req.query.limit || '50', 10));
    res.json(patterns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scanner state
router.get('/scanner/status', async (req, res) => {
  const state = await getScannerState();
  const scanIntervalMs = parseInt(process.env.SCAN_INTERVAL_MS || '60000', 10);
  const lastMs = state.lastScanAt ? new Date(state.lastScanAt).getTime() : 0;
  const nextScanInSec = state.isRunning && lastMs
    ? Math.max(0, Math.round((scanIntervalMs - (Date.now() - lastMs)) / 1000))
    : null;

  res.json({
    isRunning: state.isRunning,
    lastScanAt: state.lastScanAt,
    pairsScanned: state.pairsScanned || 0,
    lastSignalSymbol: state.lastSignalSymbol,
    best_score_symbol: state.bestScoreSymbol,
    best_score: state.bestScore ?? 0,
    best_score_direction: state.bestScoreDirection,
    best_score_status: state.bestScoreStatus,
    engine: state.engineId || 'institutional-smc',
    engine_label: state.engineId === 'institutional-smc' ? 'SMC v2 (Python)' : state.engineId,
    universe_size: state.universeSize || 0,
    signals_found: state.signalsFound || 0,
    scanning: Boolean(state.scanning),
    progress_pct: state.scanProgressPct || 0,
    scan_started_at: state.scanStartedAt,
    scan_meta: state.scanMeta,
    scan_interval_sec: Math.round(scanIntervalMs / 1000),
    next_scan_in_sec: nextScanInSec,
  });
});

router.post('/scanner/start', async (req, res) => {
  await setScannerRunning(true);
  triggerScan();
  res.json({ success: true, isRunning: true, ok: true, answer: '🟢 Scanner started.' });
});

router.post('/scanner/stop', async (req, res) => {
  await setScannerRunning(false);
  res.json({ success: true, isRunning: false, ok: true, answer: '🔴 Scanner stopped.' });
});

router.post('/scanner/scan', async (req, res) => {
  try {
    const { runScannerOnce } = await import('../jobs/marketScanner.js');
    const summary = await runScannerOnce();
    res.json({
      success: true,
      notified: Boolean(summary.last_signal),
      message: summary.signals_found
        ? `Found ${summary.signals_found} signal(s); best: ${summary.last_signal}`
        : `No signals in ${summary.pairs_scanned}/${summary.universe_size} pairs (engine: ${summary.engine})`,
      ...summary,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// In-memory backtest job progress (Python engine)
const backtestJobs = new Map();

router.get('/backtest/status/:jobId', (req, res) => {
  const job = backtestJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Backtest strategy — Python 3-phase pipeline (DB → SMC → simulate)
router.post('/backtest', async (req, res) => {
  try {
    const {
      strategyId = 'smc-mtf',
      symbol,
      timeframe,
      startDate,
      endDate,
      period,
      initialCapital,
      riskPerTrade,
      async: runAsync,
    } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: 'symbol required' });
    }

    if (!period && (!startDate || !endDate)) {
      return res.status(400).json({ error: 'period (1y, 6m, 3m, 1m) or startDate+endDate required' });
    }

    const tf = timeframe || '15m';

    const strategy = getStrategy(strategyId);
    if (!strategy?.runBacktest && strategy?.engine === 'freqtrade') {
      return res.status(400).json({
        error: 'Freqtrade backtests run via Freqtrade CLI. Select Freqtrade in Strategy Control to manage the bot.',
      });
    }
    if (!strategy?.runBacktest) {
      return res.status(400).json({ error: `Strategy ${strategyId} not found or no backtest support` });
    }

    const { resolveDateRange, estimateBarCount, getWarmupMs } = await import('../strategies/backtestEngine.js');
    const { startTime, endTime } = resolveDateRange({ period, startDate, endDate });
    const estimatedBars = estimateBarCount(tf, startTime - getWarmupMs(tf), endTime);
    const maxSafeBars = parseInt(process.env.BACKTEST_MAX_SAFE_BARS || '9000', 10);
    if (estimatedBars > maxSafeBars) {
      return res.status(400).json({
        error: `Too many bars (~${estimatedBars.toLocaleString()}). Use 15m entry TF or shorter period (1W/1M).`,
        estimatedBars,
        hint: '5m/3m uses too much memory — switch entry TF to 15m',
      });
    }
    if ((tf === '5m' || tf === '3m') && estimatedBars > 6500) {
      return res.status(400).json({
        error: `${tf} entry on ${period || 'this period'} exceeds memory limits (~${estimatedBars.toLocaleString()} bars). Use 15m entry TF.`,
        estimatedBars,
      });
    }

    const jobId = `bt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    backtestJobs.set(jobId, { status: 'running', progress_pct: 0, phase: 'init', message: 'Starting…' });

    const runJob = async () => {
      const startMs = Date.now();
      try {
        let result;
        try {
          result = await runPythonBacktest(
            {
              symbol: symbol.toUpperCase(),
              timeframe: tf,
              entryTimeframe: tf,
              period,
              startDate,
              endDate,
              initialCapital: initialCapital || 10000,
              riskPerTrade: riskPerTrade || 0.01,
            },
            (pct, phase, message) => {
              backtestJobs.set(jobId, {
                status: 'running',
                progress_pct: pct,
                phase,
                message,
              });
            },
          );
        } catch (pyErr) {
          await logEvent('warn', 'backtest', `Python engine skip: ${pyErr.message}`);
          backtestJobs.set(jobId, {
            status: 'running',
            progress_pct: 25,
            phase: 'backtest',
            message: 'Running strategy simulation…',
          });
          const { runBacktest } = await import('../strategies/smc-mtf/backtester.js');
          result = await runBacktest({
            symbol: symbol.toUpperCase(),
            entryTimeframe: tf,
            startDate,
            endDate,
            period,
            initialCapital: initialCapital || 10000,
            riskPerTrade: riskPerTrade || 0.01,
          });
          result.dataSource = result.dataSource || 'database';
        }

        result.durationMs = Date.now() - startMs;
        result.summary = result.summary || {
          totalTrades: result.totalTrades,
          winRate: result.winRate,
          profitFactor: result.profitFactor,
          maxDrawdown: result.maxDrawdownPercent,
          netProfitPct: result.netProfitPercent,
          averageRR: result.avgRMultiple,
        };

        const db = getSupabase();
        if (db) {
          await db.from('backtest_runs').insert({
            strategy_id: strategyId,
            symbol: result.symbol,
            timeframe: result.entryTimeframe,
            start_date: result.startDate,
            end_date: result.endDate,
            total_trades: result.totalTrades,
            wins: result.wins,
            losses: result.losses,
            win_rate: result.winRate,
            profit_factor: result.profitFactor,
            total_pnl: result.totalPnl,
            avg_r_multiple: result.avgRMultiple,
            max_drawdown: result.maxDrawdownPercent,
            results: {
              trades: result.trades?.slice(-50),
              equityCurve: result.equityCurve?.slice(-100),
              summary: result.summary,
            },
          });
        }

        backtestJobs.set(jobId, {
          status: 'completed',
          progress_pct: 100,
          phase: 'done',
          message: 'Complete',
          result,
        });
        return result;
      } catch (err) {
        backtestJobs.set(jobId, {
          status: 'failed',
          progress_pct: 0,
          phase: 'error',
          error: err.message,
          message: err.message,
        });
        throw err;
      }
    };

    if (runAsync) {
      runJob().catch(() => {});
      return res.json({ jobId, status: 'running', progress_pct: 0 });
    }

    // Poll until complete (same request — frontend can also poll /backtest/status)
    const result = await runJob();
    backtestJobs.delete(jobId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Candle DB coverage for backtest (shows if sync needed)
router.get('/backtest/coverage', async (req, res) => {
  try {
    const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const timeframe = req.query.timeframe || '15m';
    const period = req.query.period || '3m';
    const { resolveDateRange, getWarmupMs } = await import('../strategies/backtestEngine.js');
    const { startTime, endTime } = resolveDateRange({ period });
    const warmup = getWarmupMs(timeframe);
    const coverage = await getCandleCoverage(symbol, timeframe, startTime - warmup, endTime);
    res.json({ period, ...coverage, dataSource: 'database' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estimate backtest size before running
router.get('/backtest/estimate', async (req, res) => {
  try {
    const { period = '1y', timeframe = '5m' } = req.query;
    const { resolveDateRange, estimateBarCount, PERIOD_PRESETS } = await import('../strategies/backtestEngine.js');
    const { startTime, endTime } = resolveDateRange({ period });
    const bars = estimateBarCount(timeframe, startTime, endTime);
    const estSeconds = Math.ceil(bars / 500);
    res.json({
      period,
      timeframe,
      estimatedBars: bars,
      estimatedSeconds: estSeconds,
      periodLabel: PERIOD_PRESETS[period]?.label || period,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backtest history
router.get('/backtest/history', async (req, res) => {
  const db = getSupabase();
  if (!db) return res.json([]);
  const { data } = await db
    .from('backtest_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(parseInt(req.query.limit || '30', 10));
  res.json(data || []);
});

// Binance API key settings
router.get('/settings/api-keys', optionalAuth, async (req, res) => {
  if (req.user) await loadUserCredentials(req.user.id);
  const status = await hasApiKeysConfigured(req.user?.id);
  res.json(status);
});

router.post('/settings/api-keys', requireAuth, async (req, res) => {
  try {
    const { apiKey, apiSecret, mode } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'apiKey and apiSecret required' });
    }

    const tradingMode = mode === 'live' ? 'live' : 'demo';
    const isDemo = tradingMode !== 'live';

    const testResult = await testUserConnection({ apiKey, apiSecret, testnet: isDemo });
    if (!testResult.ok) {
      return res.status(400).json({ error: 'API key validation failed' });
    }

    await saveUserApiKeys(req.user.id, apiKey, apiSecret, tradingMode);

    res.json({
      success: true,
      tradingMode,
      testnet: isDemo,
      balance: testResult.balance,
      demoConfigured: tradingMode === 'demo' || undefined,
      liveConfigured: tradingMode === 'live' || undefined,
      message: `${tradingMode.toUpperCase()} API keys saved to your account`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings/trading-mode', requireAuth, async (req, res) => {
  try {
    const { mode } = req.body;
    if (!mode || !['demo', 'live'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be demo or live' });
    }
    await loadUserCredentials(req.user.id);
    const status = await hasApiKeysConfigured(req.user.id);
    const hasKeys = mode === 'live' ? status.liveConfigured : status.demoConfigured;
    if (!hasKeys) {
      return res.status(400).json({
        error: `No ${mode} API keys saved yet. Add ${mode} keys below first.`,
        needsKeys: mode,
      });
    }
    await saveUserTradingMode(req.user.id, mode);
    const updated = await hasApiKeysConfigured(req.user.id);
    res.json({
      success: true,
      tradingMode: mode,
      testnet: mode === 'demo',
      restUrl: updated.restUrl,
      message: mode === 'live'
        ? 'Live trading enabled — orders use mainnet futures'
        : 'Demo mode enabled — orders use demo-fapi.binance.com',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings/api-keys/test', async (req, res) => {
  try {
    const { apiKey, apiSecret, testnet = true, mode } = req.body;
    const isDemo = mode ? mode !== 'live' : testnet;
    const result = await testUserConnection({ apiKey, apiSecret, testnet: isDemo });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/ai/learn', async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic required' });
    const { agentLearn } = await import('../services/agentLearner.js');
    const result = await agentLearn(topic);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Freqtrade bot (Python) — see freqtrade/README.md ---
router.get('/freqtrade/info', (req, res) => {
  res.json(getFreqtradePublicInfo());
});

router.get('/freqtrade/ping', async (req, res) => {
  res.json(await pingFreqtrade());
});

router.get('/freqtrade/status', async (req, res) => {
  try {
    const [ping, openTrades, profit] = await Promise.all([
      pingFreqtrade(),
      getFreqtradeStatus().catch(() => []),
      getFreqtradeProfit().catch(() => null),
    ]);
    res.json({ ping, openTrades, profit });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/strategies', async (req, res) => {
  try {
    const strategies = await listFreqtradeStrategies();
    res.json({
      strategies,
      folder: 'freqtrade/user_data/strategies/',
      defaults: ['TradeGPT_RSI_Momentum', 'TradeGPT_EMA_Crossover'],
    });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/trades', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    res.json(await getFreqtradeTrades(limit));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/balance', async (req, res) => {
  try {
    res.json(await getFreqtradeBalance());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/daily', async (req, res) => {
  try {
    const days = parseInt(req.query.days || '7', 10);
    res.json(await getFreqtradeDaily(days));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/start', async (req, res) => {
  try {
    res.json(await startFreqtradeBot());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/stop', async (req, res) => {
  try {
    res.json(await stopFreqtradeBot());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/strategy', async (req, res) => {
  try {
    const { strategy } = req.body;
    if (!strategy) return res.status(400).json({ error: 'strategy name required' });
    res.json(await setFreqtradeStrategy(strategy));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/force-exit', async (req, res) => {
  try {
    const { tradeId = 'all', ordertype, amount } = req.body;
    res.json(await forceExitFreqtrade(tradeId, ordertype, amount));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/force-enter', async (req, res) => {
  try {
    const { pair, side, price, ordertype, stakeamount, leverage, enter_tag } = req.body;
    if (!pair) return res.status(400).json({ error: 'pair required' });
    res.json(await forceEnterFreqtrade({ pair, side, price, ordertype, stakeamount, leverage, enter_tag }));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/pause', async (req, res) => {
  try {
    res.json(await pauseFreqtradeBot());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/stopbuy', async (req, res) => {
  try {
    res.json(await stopBuyFreqtrade());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/reload', async (req, res) => {
  try {
    res.json(await reloadFreqtradeConfig());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/config', async (req, res) => {
  try {
    res.json(await getFreqtradeConfig());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/performance', async (req, res) => {
  try {
    res.json(await getFreqtradePerformance());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/stats', async (req, res) => {
  try {
    res.json(await getFreqtradeStats());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/count', async (req, res) => {
  try {
    res.json(await getFreqtradeCount());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/weekly', async (req, res) => {
  try {
    res.json(await getFreqtradeWeekly(parseInt(req.query.days || '4', 10)));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/monthly', async (req, res) => {
  try {
    res.json(await getFreqtradeMonthly(parseInt(req.query.days || '3', 10)));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/whitelist', async (req, res) => {
  try {
    res.json(await getFreqtradeWhitelist());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/blacklist', async (req, res) => {
  try {
    res.json(await getFreqtradeBlacklist());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/blacklist', async (req, res) => {
  try {
    const { pairs } = req.body;
    if (!pairs?.length) return res.status(400).json({ error: 'pairs required' });
    res.json(await addFreqtradeBlacklist(pairs));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.delete('/freqtrade/blacklist', async (req, res) => {
  try {
    const pairs = req.body?.pairs || req.query.pairs;
    const list = Array.isArray(pairs) ? pairs : pairs ? [pairs] : [];
    if (!list.length) return res.status(400).json({ error: 'pairs required' });
    res.json(await deleteFreqtradeBlacklist(list));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/locks', async (req, res) => {
  try {
    res.json(await getFreqtradeLocks());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/locks', async (req, res) => {
  try {
    const { pair, until, side, reason } = req.body;
    if (!pair || !until) return res.status(400).json({ error: 'pair and until required' });
    res.json(await addFreqtradeLock({ pair, until, side, reason }));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.delete('/freqtrade/locks/:id', async (req, res) => {
  try {
    res.json(await deleteFreqtradeLock(req.params.id));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/logs', async (req, res) => {
  try {
    res.json(await getFreqtradeLogs(parseInt(req.query.limit || '100', 10)));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/health', async (req, res) => {
  try {
    res.json(await getFreqtradeHealth());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/version', async (req, res) => {
  try {
    res.json(await getFreqtradeVersion());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/sysinfo', async (req, res) => {
  try {
    res.json(await getFreqtradeSysinfo());
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/candles', async (req, res) => {
  try {
    const { pair, timeframe = '15m', limit = '100' } = req.query;
    if (!pair) return res.status(400).json({ error: 'pair required' });
    res.json(await getFreqtradePairCandles(pair, timeframe, parseInt(limit, 10)));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/freqtrade/trade/:id', async (req, res) => {
  try {
    res.json(await getFreqtradeTrade(req.params.id));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.delete('/freqtrade/trades/:id/open-order', async (req, res) => {
  try {
    res.json(await cancelFreqtradeOpenOrder(req.params.id));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.delete('/freqtrade/trades/:id', async (req, res) => {
  try {
    res.json(await deleteFreqtradeTrade(req.params.id));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/freqtrade/trades/:id/reload', async (req, res) => {
  try {
    res.json(await reloadFreqtradeTrade(req.params.id));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// --- Dune Analytics (on-chain data) ---
router.get('/dune/status', async (req, res) => {
  res.json({
    configured: isDuneConfigured(),
    ...(isDuneConfigured() ? await testDuneConnection() : {}),
  });
});

router.post('/dune/query/:queryId/execute', async (req, res) => {
  try {
    const queryId = parseInt(req.params.queryId, 10);
    const { parameters = {}, wait = true, performance } = req.body || {};
    if (wait) {
      const result = await runQueryAndWait(queryId, parameters, { performance });
      return res.json(result);
    }
    res.json(await executeQuery(queryId, parameters, performance));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/dune/sql', async (req, res) => {
  try {
    const { sql, wait = true, limit, performance } = req.body || {};
    if (!sql) return res.status(400).json({ error: 'sql required' });
    if (wait) {
      const result = await runSqlAndWait(sql, { limit, performance });
      return res.json(result);
    }
    res.json(await executeSql(sql, performance));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/dune/execution/:id/results', async (req, res) => {
  try {
    res.json(await getExecutionResults(req.params.id, parseInt(req.query.limit || '100', 10)));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- Smart Wallet Scanner (Dune + consensus) ---

router.get('/wallet-scanner/status', async (req, res) => {
  try {
    res.json(await getWalletScannerStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/wallet-scanner/wallets', async (req, res) => {
  try {
    res.json(await getWalletsList({
      status: req.query.status,
      qualified: req.query.qualified === 'true' ? true : req.query.qualified === 'false' ? false : undefined,
      limit: parseInt(req.query.limit || '100', 10),
      offset: parseInt(req.query.offset || '0', 10),
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/wallet-scanner/signals', async (req, res) => {
  try {
    const signals = await loadSignals();
    res.json({ signals: signals.slice(0, parseInt(req.query.limit || '50', 10)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/wallet-scanner/start', async (req, res) => {
  try {
    await setWalletScannerRunning(true);
    startWalletScannerJob();
    res.json({ running: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/wallet-scanner/stop', async (req, res) => {
  try {
    await setWalletScannerRunning(false);
    stopWalletScannerJob();
    res.json({ running: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/wallet-scanner/scan', async (req, res) => {
  try {
    const result = await runFullWalletScan(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/wallet-scanner/consensus', async (req, res) => {
  try {
    res.json(await triggerWalletScan());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/wallet-scanner/refresh', async (req, res) => {
  try {
    res.json(await refreshWalletsFromDune(req.body || {}));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/wallet-scanner/daily', async (req, res) => {
  try {
    res.json(await triggerDailyMaintenance());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/wallet-scanner/config', async (req, res) => {
  try {
    res.json(await updateWalletScannerConfig(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/wallet-scanner/import', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!rows?.length) return res.status(400).json({ error: 'rows array required' });
    res.json(await importWalletsFromRows(rows));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/wallet-scanner/dune', async (req, res) => {
  try {
    res.json(await getDuneStoreStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/wallet-scanner/fetch-dune', async (req, res) => {
  try {
    res.json(await fetchStoreAndImportDune(req.body?.queryIds || {}));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/webhook/n8n/wallet-scanner', async (req, res) => {
  try {
    const { action } = req.body || {};
    if (action === 'daily') {
      const report = await triggerDailyMaintenance();
      return res.json({ ok: true, report });
    }
    if (action === 'scan') {
      const result = await triggerWalletScan();
      return res.json({ ok: true, result });
    }
    if (action === 'full') {
      const result = await runFullWalletScan();
      return res.json({ ok: true, result });
    }
    res.json({ ok: true, message: 'received' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
