import { Router } from 'express';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from '../config/index.js';
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
} from '../services/supabase.js';
import {
  getKlines,
  parseKlines,
  getUsdtBalance,
  setLeverage,
  placeMarketOrder,
  placeStopMarketOrder,
  cancelAllOrders,
  calculatePositionSize,
  formatQuantity,
  calculateOrderQty,
  getMarkPrice,
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
import { getStrategy } from '../strategies/registry.js';
import {
  saveUserApiKeys,
  saveUserTradingMode,
  loadUserCredentials,
  testUserConnection,
  hasApiKeysConfigured,
  getActiveApiKeys,
  getBalanceForUser,
  executeWithCredentials,
  setRuntimeApiKeys,
  setTradingMode,
} from '../services/userBinance.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
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

async function enrichTrade(trade) {
  const entry = toNumber(trade.entry_price);
  const quantity = toNumber(trade.quantity);
  const leverage = tradeLeverage(trade);
  const currentPrice = ['open', 'partial'].includes(trade.status)
    ? await getMarkPrice(trade.symbol).catch(() => entry)
    : toNumber(trade.exit_price, entry);
  const direction = trade.direction;
  const unrealized = direction === 'LONG'
    ? (currentPrice - entry) * quantity
    : (entry - currentPrice) * quantity;
  const realized = toNumber(trade.pnl);
  const notional = currentPrice * quantity;
  const margin = leverage > 0 ? notional / leverage : notional;
  const totalPnl = ['open', 'partial'].includes(trade.status) ? realized + unrealized : realized;

  return {
    ...trade,
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
  return Promise.all((trades || []).map((trade) => enrichTrade(trade)));
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
    enrichTrades(rawOpen || []),
  ]);
  let balance = { total: 0, available: 0 };
  try {
    balance = await getUsdtBalance();
  } catch (err) {
    await logEvent('warn', 'dashboard', `Balance fetch failed: ${err.message}`);
  }
  const unrealized = positions.reduce((sum, p) => sum + toNumber(p.unrealized_pnl), 0);
  const perf = computeTradePerformance(trades);

  return {
    accounts: [{
      balance: balance.total || balance.available || 0,
      available: balance.available || 0,
      equity: (balance.total || balance.available || 0) + unrealized,
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
      exchange_connected: Boolean(balance.total || balance.available),
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
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    n8n: n8n.ok ? 'connected' : n8n.error,
    dune: dune.ok ? 'connected' : dune.reason || 'offline',
    tradingview: (await testTradingViewConnection()).ok ? 'connected' : 'offline',
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
    const execRes = await fetch(`http://127.0.0.1:${port}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  res.json(await enrichTrades(data || []));
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
    const db = getSupabase();
    const { data: trade, error } = await db.from('trades').select('*').eq('id', req.params.id).single();
    if (error || !trade) return res.status(404).json({ error: 'Trade not found' });
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const qty = toNumber(req.body?.quantity || trade.quantity);
    await placeMarketOrder(trade.symbol, side, qty, true);
    await cancelAllOrders(trade.symbol).catch(() => {});
    const exitPrice = await getMarkPrice(trade.symbol);
    const pnl = toNumber(trade.pnl) + (trade.direction === 'LONG'
      ? (exitPrice - toNumber(trade.entry_price)) * qty
      : (toNumber(trade.entry_price) - exitPrice) * qty);
    const remainQty = Math.max(0, toNumber(trade.quantity) - qty);
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
    const db = getSupabase();
    const { data: trade, error } = await db.from('trades').select('*').eq('id', req.params.id).single();
    if (error || !trade) return res.status(404).json({ error: 'Trade not found' });
    const percent = Math.min(Math.max(toNumber(req.body?.percent, 30), 1), 100);
    const qty = roundApiQty(toNumber(trade.quantity) * (percent / 100));
    if (qty <= 0) return res.status(400).json({ error: 'Partial quantity is zero' });

    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    await placeMarketOrder(trade.symbol, side, qty, true);
    const exitPrice = await getMarkPrice(trade.symbol);
    const realized = trade.direction === 'LONG'
      ? (exitPrice - toNumber(trade.entry_price)) * qty
      : (toNumber(trade.entry_price) - exitPrice) * qty;
    const remainQty = roundApiQty(Math.max(0, toNumber(trade.quantity) - qty));
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
    const db = getSupabase();
    const { data: trade, error } = await db.from('trades').select('*').eq('id', req.params.id).single();
    if (error || !trade) return res.status(404).json({ error: 'Trade not found' });

    const stopLoss = req.body?.stop_loss != null ? toNumber(req.body.stop_loss) : toNumber(trade.stop_loss);
    const tp1 = req.body?.tp1 != null ? toNumber(req.body.tp1) : trade.tp1;
    const tp2 = req.body?.tp2 != null ? toNumber(req.body.tp2) : trade.tp2;
    const side = trade.direction === 'LONG' ? 'SELL' : 'BUY';

    await cancelAllOrders(trade.symbol).catch(() => {});
    if (stopLoss > 0 && toNumber(trade.quantity) > 0) {
      await placeStopMarketOrder(trade.symbol, side, stopLoss, trade.quantity);
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
    const balance = await getUsdtBalance();
    res.json(balance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute trade (called from n8n or Telegram BUY NOW)
router.post('/execute', async (req, res) => {
  try {
    const signal = req.body;
    const positionSizeUsdt = parseFloat(signal.position_size_usdt || 0);

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
    const stopLoss = parseFloat(signal.stop_loss);
    const leverage = parseInt(
      req.body.leverage || config.telegram?.defaultLeverage || '50',
      10,
    );

    let qty;
    let notional;
    if (positionSizeUsdt > 0) {
      const sized = await calculateOrderQty(symbol, positionSizeUsdt, leverage, markPrice);
      qty = sized.qty;
      notional = sized.notional;
    } else {
      qty = formatQuantity(
        symbol,
        calculatePositionSize(validation.balance, config.strategy.riskPerTrade, entryPrice, stopLoss),
      );
      notional = qty * markPrice;
    }

    if (qty <= 0) {
      return res.status(400).json({ error: 'Calculated quantity is zero' });
    }

    const credentials = await getActiveApiKeys();
    let order, slOrder;

    if (credentials) {
      const result = await executeWithCredentials(credentials, {
        symbol,
        side,
        quantity: qty,
        stopLoss,
        leverage,
      });
      order = result.order;
      slOrder = result.slOrder;
    } else {
      await setLeverage(symbol, leverage);
      order = await placeMarketOrder(symbol, side, qty);
      const slSide = side === 'BUY' ? 'SELL' : 'BUY';
      try {
        slOrder = await placeStopMarketOrder(symbol, slSide, stopLoss, qty);
      } catch (err) {
        await logEvent('error', 'execute', `SL order failed: ${err.message}`, { symbol });
      }
    }

    const trade = {
      signal_id: signal.id,
      symbol,
      direction,
      entry_price: entryPrice,
      quantity: qty,
      stop_loss: stopLoss,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      binance_order_id: order.orderId?.toString(),
      binance_sl_order_id: slOrder?.orderId?.toString(),
      risk_amount: validation.riskAmount,
      status: 'open',
    };

    const { data: savedTrade } = await saveTrade(trade);

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

    res.json({ success: true, trade: savedTrade, order, validation });
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
