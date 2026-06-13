import { Router } from 'express';
import { config } from '../config/index.js';
import { generateSignal } from '../strategy/signalEngine.js';
import { validateTradeExecution } from '../strategy/riskManager.js';
import {
  saveSignal,
  saveTrade,
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
  calculatePositionSize,
  formatQuantity,
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
import { listStrategies, getStrategy } from '../strategies/registry.js';
import { getScannerState, setScannerRunning } from '../services/scannerState.js';
import { triggerScan } from '../jobs/marketScanner.js';
import { getStrategyStats, getLearnedPatterns } from '../services/tradeLearner.js';
import {
  saveUserApiKeys,
  testUserConnection,
  hasApiKeysConfigured,
  getActiveApiKeys,
  executeWithCredentials,
  setRuntimeApiKeys,
} from '../services/userBinance.js';
import { getAllFuturesSymbols } from '../services/binance.js';

const router = Router();

// Health check
router.get('/health', async (req, res) => {
  const n8n = await checkN8nHealth();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    n8n: n8n.ok ? 'connected' : n8n.error,
  });
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
  res.json(data);
});

// Get open trades
router.get('/trades/open', async (req, res) => {
  const { data, error } = await getOpenTrades();
  if (error) return res.status(500).json({ error });
  res.json(data);
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

// Get balance
router.get('/balance', async (req, res) => {
  try {
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
    const entryPrice = parseFloat(signal.entry_price);
    const stopLoss = parseFloat(signal.stop_loss);

    let qty;
    if (positionSizeUsdt > 0) {
      const leverage = parseInt(req.body.leverage || '5', 10);
      qty = formatQuantity(symbol, (positionSizeUsdt * leverage) / entryPrice);
    } else {
      qty = formatQuantity(
        symbol,
        calculatePositionSize(validation.balance, config.strategy.riskPerTrade, entryPrice, stopLoss)
      );
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
        leverage: parseInt(req.body.leverage || '5', 10),
      });
      order = result.order;
      slOrder = result.slOrder;
    } else {
      await setLeverage(symbol, 5);
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

// Strategy stats dashboard
router.get('/strategy/stats', async (req, res) => {
  try {
    const stats = await getStrategyStats();
    res.json(stats);
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

    const strategy = getStrategy(strategyId);
    if (!strategy?.runBacktest) {
      return res.status(400).json({ error: `Strategy ${strategyId} not found or no backtest support` });
    }

    const startMs = Date.now();
    const result = await strategy.runBacktest({
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
router.get('/settings/api-keys', async (req, res) => {
  const status = await hasApiKeysConfigured();
  res.json(status);
});

router.post('/settings/api-keys', async (req, res) => {
  try {
    const { apiKey, apiSecret, testnet = true, userId } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'apiKey and apiSecret required' });
    }

    const testResult = await testUserConnection({ apiKey, apiSecret, testnet });
    if (!testResult.ok) {
      return res.status(400).json({ error: 'API key validation failed' });
    }

    if (userId) {
      await saveUserApiKeys(userId, apiKey, apiSecret, testnet);
    } else {
      setRuntimeApiKeys(apiKey, apiSecret, testnet);
    }

    res.json({
      success: true,
      testnet,
      balance: testResult.balance,
      message: 'API keys validated and saved',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings/api-keys/test', async (req, res) => {
  try {
    const { apiKey, apiSecret, testnet = true } = req.body;
    const result = await testUserConnection({ apiKey, apiSecret, testnet });
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

export default router;
