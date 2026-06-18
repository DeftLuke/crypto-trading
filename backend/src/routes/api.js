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
} from '../services/binance.js';
import { attachIndicators } from '../strategy/indicators.js';
import { analyzeSMC } from '../strategy/smc.js';
import { runMTFAnalysis, getMTFBias } from '../strategy/mtfAnalysis.js';
import { positionMonitor } from '../jobs/positionMonitor.js';
import { sendAlert, sendSignalNotification } from '../services/telegram.js';
import { getSupabase } from '../services/supabase.js';
import { checkOllamaHealth } from '../services/ollama.js';
import { checkN8nHealth } from '../services/n8n.js';
import { askTradingAgent, buildTradingContext, getLessonsSummary } from '../services/aiAgent.js';
import { askPersonalAssistant } from '../services/personalAssistant.js';
import { scheduleSignalOutcomeCheck } from '../jobs/signalOutcomeTracker.js';
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
      reject(new Error('Backtest timed out after 3 minutes. Try 15m timeframe or 1M period.'));
    }, 180000);

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
        finish(() => reject(new Error('Backtest process crashed. Use 15m entry TF for 3M+ periods.')));
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

async function listExchangePositions() {
  try {
    const rows = await getExchangePositionRows();
    return (Array.isArray(rows) ? rows : [])
      .map(positionRowToExchangePosition)
      .filter(Boolean);
  } catch (err) {
    await logEvent('warn', 'exchange.positions', `Position sync failed: ${err.message}`);
    return [];
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
  const live = exchangePosition || (['open', 'partial'].includes(trade.status) ? await getExchangePosition(trade.symbol) : null);
  const quantity = live?.quantity || toNumber(trade.quantity);
  const leverage = live?.leverage || tradeLeverage(trade);
  const currentPrice = live?.current_price || (['open', 'partial'].includes(trade.status)
    ? await getMarkPrice(trade.symbol).catch(() => entry)
    : toNumber(trade.exit_price, entry));
  const direction = trade.direction;
  const unrealized = live?.unrealized_pnl ?? (direction === 'LONG'
    ? (currentPrice - entry) * quantity
    : (entry - currentPrice) * quantity);
  const realized = toNumber(trade.pnl);
  const notional = live?.notional || currentPrice * quantity;
  const margin = live?.margin || (leverage > 0 ? notional / leverage : notional);
  const totalPnl = ['open', 'partial'].includes(trade.status) ? realized + unrealized : realized;

  return {
    ...trade,
    entry_price: live?.entry_price || entry,
    quantity,
    exchange_quantity: live?.quantity,
    current_price: currentPrice,
    unrealized_pnl: ['open', 'partial'].includes(trade.status) ? unrealized : 0,
    profit_usd: totalPnl,
    profit_percent: entry && quantity ? (totalPnl / (entry * quantity)) * 100 : 0,
    pnl_usd: totalPnl,
    pnl_pct: entry && quantity ? (totalPnl / (entry * quantity)) * 100 : 0,
    roe_pct: margin > 0 ? (totalPnl / margin) * 100 : 0,
    leverage,
    notional,
    margin,
    take_profit: trade.tp1,
    position_id: trade.id,
    strategy_name: 'SMC-MTF',
  };
}

async function enrichTrades(trades = []) {
  const livePositions = await listExchangePositions();
  const positions = Object.fromEntries(livePositions.map((p) => [p.symbol, p]));
  return Promise.all((trades || []).map((trade) => enrichTrade(trade, positions[trade.symbol])));
}

async function getMergedOpenTrades(rawOpen = []) {
  const livePositions = await listExchangePositions();
  const dbSymbols = new Set((rawOpen || []).map((trade) => trade.symbol));
  const dbEnriched = (await Promise.all((rawOpen || []).map(async (trade) => {
    const live = livePositions.find((position) => position.symbol === trade.symbol);
    if (!live || live.quantity <= 0) return null;
    return enrichTrade(trade, live);
  }))).filter(Boolean);
  const exchangeOnly = await Promise.all(livePositions
    .filter((position) => !dbSymbols.has(position.symbol))
    .map((position) => enrichTrade(exchangePositionToTrade(position), position)));
  return [...dbEnriched, ...exchangeOnly];
}

function computeTradePerformance(trades = []) {
  const closed = trades.filter((t) => !['open', 'partial'].includes(t.status));
  const wins = closed.filter((t) => toNumber(t.pnl ?? t.profit_usd) > 0).length;
  const losses = closed.filter((t) => toNumber(t.pnl ?? t.profit_usd) < 0).length;
  const grossProfit = closed.reduce((sum, t) => sum + Math.max(0, toNumber(t.pnl ?? t.profit_usd)), 0);
  const grossLoss = Math.abs(closed.reduce((sum, t) => sum + Math.min(0, toNumber(t.pnl ?? t.profit_usd)), 0));
  const netProfit = closed.reduce((sum, t) => sum + toNumber(t.pnl ?? t.profit_usd), 0);
  const total = closed.length;

  return {
    total_trades: total,
    wins,
    losses,
    win_rate: total ? (wins / total) * 100 : 0,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0,
    net_profit: netProfit,
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
    }],
    positions,
    trades,
    performance: perf,
    risk: {
      open_positions: positions.length,
      circuit_breaker: false,
      kill_switch: false,
    },
    health: {
      running: true,
      dry_run: config.binance?.demo !== false,
      exchange_connected: walletBalance != null,
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
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    n8n: n8n.ok ? 'connected' : n8n.error,
    dune: dune.ok ? 'connected' : dune.reason || 'offline',
    tradingview: (await testTradingViewConnection()).ok ? 'connected' : 'offline',
    research: research.ok ? 'connected' : (research.reason || 'offline'),
    position_monitor: 'running',
  });
});

router.all('/research/*', async (req, res) => {
  try {
    const path = `/${req.params[0] || ''}${req.url.includes('?') ? `?${req.url.split('?')[1]}` : ''}`;
    const data = await proxyResearch(req.method, path, ['GET', 'HEAD'].includes(req.method) ? undefined : req.body);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/control/settings', async (req, res) => {
  try {
    res.json(await getControlSettings());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/control/settings', async (req, res) => {
  try {
    res.json(await updateControlSettings(req.body || {}, req.body?.actor || 'tradegpt'));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/control/dashboard', async (req, res) => {
  try {
    res.json(await getControlDashboard());
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
    const stage = body.api_result?.pipeline_stage
      || (body.parse_status === 'skipped' ? 'received' : body.api_result?.passed ? 'validated' : 'parsing');
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

    const sorted = (messages || []).sort((a, b) => {
      const ta = new Date(a.message_date || a.received_at || 0).getTime();
      const tb = new Date(b.message_date || b.received_at || 0).getTime();
      return tb - ta;
    });

    const dedupeSignals = req.query.dedupe === 'true';
    const displayRows = dedupeSignals ? dedupeTelegramInbox(sorted) : sorted;

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
      const sortedRefreshed = (refreshed || []).sort((a, b) => {
        const ta = new Date(a.message_date || a.received_at || 0).getTime();
        const tb = new Date(b.message_date || b.received_at || 0).getTime();
        return tb - ta;
      });
      const displayRefreshed = dedupeSignals ? dedupeTelegramInbox(sortedRefreshed) : sortedRefreshed;
      messagesWithLocks.length = 0;
      messagesWithLocks.push(...displayRefreshed.map((row) => ({
        ...row,
        ...symbolBlockForMessage(row, symbolLocks),
      })));
    }

    const followedSources = (sources || []).filter((s) => s.is_followed);
    const stats = {
      total: messagesWithLocks.length,
      parsed: messagesWithLocks.filter((m) => m.parse_status === 'parsed').length,
      skipped: messagesWithLocks.filter((m) => m.parse_status === 'skipped').length,
      validated: messagesWithLocks.filter((m) => m.api_result?.passed === true || m.api_result?.ready_to_approve).length,
      rejected: messagesWithLocks.filter((m) => m.parse_status === 'parsed' && m.api_result?.passed === false && !m.api_result?.ready_to_approve).length,
      stale: messagesWithLocks.filter((m) => m.api_result?.stale === true).length,
      approved: messagesWithLocks.filter((m) => m.api_result?.approved || m.api_result?.executed).length,
      symbol_blocked: messagesWithLocks.filter((m) => m.symbol_blocked).length,
      needs_revalidation: messagesWithLocks.filter(needsRevalidation).length,
    };

    res.json({
      messages: messagesWithLocks,
      stats,
      sources: sources || [],
      followed_sources: followedSources,
      followed_count: followedSources.length,
      test_mode: config.externalSignals.testMode,
      live_listener: true,
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

// Get trades
router.get('/trades', async (req, res) => {
  const { data, error } = await getTrades(parseInt(req.query.limit || '50', 10));
  if (error) return res.status(500).json({ error });
  res.json(await enrichTrades(data || []));
});

// Get open trades
router.get('/trades/open', async (req, res) => {
  const { data, error } = await getOpenTrades();
  if (error) return res.status(500).json({ error });
  res.json(await getMergedOpenTrades(data || []));
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
    const { trade, live, persisted } = await loadActionTrade(req.params.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });
    if (!live || live.quantity <= 0) {
      await logEvent('warn', 'trades.close', 'Close blocked: Binance position could not be verified', {
        tradeId: trade.id,
        symbol: trade.symbol,
      });
      return res.status(409).json({
        error: 'Close blocked: Binance did not return an open position for this symbol. Trade was NOT marked closed.',
        symbol: trade.symbol,
      });
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
    const exitPrice = await getMarkPrice(trade.symbol);
    const pnl = toNumber(trade.pnl) + (trade.direction === 'LONG'
      ? (exitPrice - toNumber(trade.entry_price)) * qty
      : (toNumber(trade.entry_price) - exitPrice) * qty);
    const remainQty = roundApiQty(Math.max(0, live.quantity - qty));
    if (!persisted) {
      return res.json({
        success: true,
        closed: remainQty <= 0,
        trade: { ...trade, quantity: remainQty, pnl, status: remainQty > 0 ? 'partial' : 'closed' },
      });
    }
    const updates = remainQty > 0
      ? { quantity: remainQty, pnl, status: 'partial' }
      : {
          status: 'closed',
          exit_price: exitPrice,
          pnl,
          pnl_percent: toNumber(trade.entry_price) && toNumber(trade.quantity)
            ? (pnl / (toNumber(trade.entry_price) * toNumber(trade.quantity))) * 100
            : 0,
          close_reason: req.body?.reason || 'Manual close',
          closed_at: new Date().toISOString(),
        };
    const { data: updated, error: updateError } = await updateTrade(trade.id, updates);
    if (updateError) return res.status(500).json({ error: updateError.message || updateError });
    res.json({ success: true, trade: await enrichTrade(updated) });
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
    if (req.user) {
      await loadUserCredentials(req.user.id);
      const balance = await getBalanceForUser(req.user.id);
      return res.json(balance);
    }
    const balance = await getBalanceForUser(null);
    res.json(balance);
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

// Execute trade (called from n8n or Telegram BUY NOW)
router.post('/execute', strictRateLimit(20), optionalAuth, requireInternalOrAuth, async (req, res) => {
  try {
    const signal = req.body;
    const requestedPositionSizeUsdt = parseFloat(signal.position_size_usdt || 0);

    const validation = await validateTradeExecution(signal);
    if (!validation.passed) {
      return res.status(400).json({
        error: 'Risk validation failed',
        checks: validation.checks,
      });
    }

    const symbol = signal.symbol;
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
      });
      order = result.order;
      slOrder = result.slOrder;
      leverage = result.leverage || leverage;
      if (result.qty) {
        qty = result.qty;
        notional = qty * markPrice;
        marginUsdt = notional / leverage;
      }
      tp1Order = null;
      tp2Order = null;
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
        slOrder = await placeStopMarketOrder(symbol, slSide, stopLoss, qty, { closePosition: true });
      } catch (err) {
        await logEvent('error', 'execute', `SL order failed: ${err.message}`, { symbol });
      }
      tp1Order = true;
      tp2Order = true;
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
      binance_sl_order_id: slOrder?.orderId?.toString(),
      risk_amount: resolved.riskAmount || validation.riskAmount,
      leverage,
      notional_usdt: notional,
      margin_usdt: marginUsdt,
      sizing_mode: resolved.sizing_mode || (useRiskSizing ? 'risk_percent' : 'fixed_notional'),
      status: 'open',
    };

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
    }

    await logEvent('trade', 'execute', `Trade opened: ${direction} ${symbol}`, {
      tradeId: savedTrade?.id,
      qty,
      entry: entryPrice,
      notional,
      leverage,
    });

    broadcastTradeEvent('opened', savedTrade, { margin_usdt: marginUsdt, leverage, notional_usdt: notional });

    res.json({
      success: true,
      trade: savedTrade,
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
  }
});

// Skip signal
router.post('/signal/:id/skip', async (req, res) => {
  await updateSignal(req.params.id, { status: 'skipped', user_action: 'skipped' });
  await logEvent('info', 'signal', `Signal skipped: ${req.params.id}`);
  res.json({ success: true });
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
  const [ollama, context] = await Promise.all([
    checkOllamaHealth(),
    buildTradingContext().catch(() => null),
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

  res.json({ ollama, gateway, hasContext: !!context });
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
  res.json(state);
});

router.post('/scanner/start', async (req, res) => {
  await setScannerRunning(true);
  triggerScan();
  res.json({ success: true, isRunning: true });
});

router.post('/scanner/stop', async (req, res) => {
  await setScannerRunning(false);
  res.json({ success: true, isRunning: false });
});

// Backtest strategy (TradingView-style — supports period presets: 1y, 6m, 3m, 1m, 1w)
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
    } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: 'symbol required' });
    }

    if (!period && (!startDate || !endDate)) {
      return res.status(400).json({ error: 'period (1y, 6m, 3m, 1m) or startDate+endDate required' });
    }

    const tf = timeframe || '5m';
    if ((tf === '5m' || tf === '3m') && ['3m', '6m', '1y'].includes(period)) {
      return res.status(400).json({
        error: 'For 3M+ backtests use 15m or 30m entry timeframe. 5m/3m entry creates too much data and may crash the server.',
      });
    }

    const strategy = getStrategy(strategyId);
    if (!strategy?.runBacktest && strategy?.engine === 'freqtrade') {
      return res.status(400).json({
        error: 'Freqtrade backtests run via Freqtrade CLI. Select Freqtrade in Strategy Control to manage the bot.',
      });
    }
    if (!strategy?.runBacktest) {
      return res.status(400).json({ error: `Strategy ${strategyId} not found or no backtest support` });
    }

    const startMs = Date.now();
    const result = await runBacktestIsolated({
      symbol: symbol.toUpperCase(),
      entryTimeframe: timeframe || '5m',
      startDate,
      endDate,
      period,
      initialCapital: initialCapital || 10000,
      riskPerTrade: riskPerTrade || 0.01,
    });

    result.durationMs = Date.now() - startMs;

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
        },
      });
    }

    res.json(result);
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
