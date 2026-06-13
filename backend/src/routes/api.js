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
import { runMTFAnalysis } from '../strategy/mtfAnalysis.js';
import { positionMonitor } from '../jobs/positionMonitor.js';
import { sendAlert, sendSignalNotification } from '../services/telegram.js';
import { getSupabase } from '../services/supabase.js';
import { checkOllamaHealth } from '../services/ollama.js';
import { askTradingAgent, buildTradingContext, getLessonsSummary } from '../services/aiAgent.js';
import { scheduleSignalOutcomeCheck } from '../jobs/signalOutcomeTracker.js';

const router = Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get chart data with indicators + SMC overlays
router.get('/chart/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const interval = req.query.interval || '5m';
    const limit = parseInt(req.query.limit || '500', 10);

    const raw = await getKlines(symbol.toUpperCase(), interval, limit);
    const candles = parseKlines(raw);
    const indicators = attachIndicators(candles);
    const smc = analyzeSMC(candles);

    res.json({ symbol, interval, candles, indicators, smc });
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

    await setLeverage(symbol, 5);

    const qty = formatQuantity(
      symbol,
      calculatePositionSize(validation.balance, config.strategy.riskPerTrade, entryPrice, stopLoss)
    );

    if (qty <= 0) {
      return res.status(400).json({ error: 'Calculated quantity is zero' });
    }

    const order = await placeMarketOrder(symbol, side, qty);

    const slSide = side === 'BUY' ? 'SELL' : 'BUY';
    let slOrder = null;
    try {
      slOrder = await placeStopMarketOrder(symbol, slSide, stopLoss, qty);
    } catch (err) {
      await logEvent('error', 'execute', `SL order failed: ${err.message}`, { symbol });
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
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });

    const result = await askTradingAgent(question);
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

// Top pairs list
router.get('/pairs', (req, res) => {
  res.json(config.topPairs);
});

export default router;
