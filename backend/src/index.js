import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/index.js';
import apiRoutes from './routes/api.js';
import { rateLimit, corsOptions, securityHeaders } from './middleware/security.js';
import { startScanner } from './jobs/marketScanner.js';
import { positionMonitor } from './jobs/positionMonitor.js';
import { tradeSafetyMonitor } from './jobs/tradeSafetyMonitor.js';
import { startOutcomeTrackerRecovery } from './jobs/signalOutcomeTracker.js';
import {
  setupTelegramPolling,
  sendStartupNotification,
  sendAlert,
  askPositionSize,
} from './services/telegram.js';
import { startCandleIngestion } from './jobs/candleIngestion.js';
import { binanceWs } from './services/binanceWs.js';
import { startUserStream, stopUserStream } from './services/binanceUserStream.js';
import { logEvent, getSupabase } from './services/supabase.js';
import { callN8nWebhook, emitN8nEvent } from './services/n8n.js';
import { askPersonalAssistant } from './services/personalAssistant.js';
import { getLessonsSummary } from './services/aiAgent.js';
import { getPairStats } from './services/supabase.js';
import { startAgentTaskRunner } from './jobs/agentTaskRunner.js';
import { startWalletScannerJob } from './jobs/walletScannerJob.js';
import { loadScannerState } from './services/walletScanner/store.js';
import { setScannerRunning, getScannerState } from './services/scannerState.js';
import { triggerScan } from './jobs/marketScanner.js';
import { initUserBinance } from './services/userBinance.js';
import { internalApiHeaders, internalApiUrl } from './lib/internalFetch.js';
import { setWsBroadcast } from './services/wsBroadcast.js';

async function sendTelegramReply(chatId, text) {
  const TelegramBot = (await import('node-telegram-bot-api')).default;
  const bot = new TelegramBot(config.telegram.token, { polling: false });
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch {
    await bot.sendMessage(chatId, text.replace(/<[^>]+>/g, ''));
  }
}

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.set('trust proxy', true);

app.use(securityHeaders);
app.use(cors(corsOptions()));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit);
app.use('/api', apiRoutes);

const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: 'connected', message: 'Dashboard connected' }));
});

export function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg);
  }
}

setWsBroadcast(broadcast);

for (const symbol of config.topPairs) {
  binanceWs.subscribeMarkPrice(symbol, (data) => {
    broadcast({ type: 'price', ...data });
  });
}

async function executeTradeWithSize(signalId, usdtAmount, chatId) {
  const db = getSupabase();
  let signal = null;

  if (db && signalId && !signalId.startsWith('local-')) {
    const { data } = await db.from('signals').select('*').eq('id', signalId).single();
    signal = data;
  }

  if (!signal) {
    await sendTelegramReply(chatId, '❌ Signal not found or expired.');
    return;
  }

  const response = await fetch(internalApiUrl('/api/execute'), {
    method: 'POST',
    headers: internalApiHeaders(),
    body: JSON.stringify({
      ...signal,
      id: signalId,
      position_size_usdt: usdtAmount,
    }),
  });
  const result = await response.json();

  if (result.success) {
    await sendTelegramReply(chatId,
      `✅ <b>Trade Executed</b>\n${signal.symbol} ${signal.direction}\n` +
      `Size: $${usdtAmount} USDT\nQty: ${result.trade?.quantity || '—'}\n` +
      `Entry: ${signal.entry_price}`
    );
    // Do not call N8N_EXECUTE_WEBHOOK — trade is already open; that webhook re-runs /control/signal → duplicate execute.
    await emitN8nEvent('trade.opened', {
      message: `Trade opened: ${signal.symbol} ${signal.direction}`,
      signal,
      trade: result.trade,
      severity: 'trade',
      already_executed: true,
    }).catch(() => {});
  } else {
    await sendTelegramReply(chatId, `❌ Trade failed: ${result.error || 'Unknown error'}`);
  }
}

async function handleTelegramCallback(action, signalId, query) {
  const chatId = query.chat?.id || query.message?.chat?.id;

  if (action === 'scanner_start') {
    await setScannerRunning(true);
    await sendTelegramReply(chatId, '🟢 <b>Scanner STARTED</b>\nScanning all USDT futures pairs for high-probability setups.');
    triggerScan();
    broadcast({ type: 'scanner', isRunning: true });
    return;
  }

  if (action === 'scanner_stop') {
    await setScannerRunning(false);
    await sendTelegramReply(chatId, '🔴 <b>Scanner STOPPED</b>\nNo new signals until /startT.');
    broadcast({ type: 'scanner', isRunning: false });
    return;
  }

  if (action === 'execute_prompt') {
    const db = getSupabase();
    let signal = null;
    if (db) {
      const { data } = await db.from('signals').select('*').eq('id', signalId).single();
      signal = data;
    }
    if (signal) {
      await askPositionSize(chatId, signal, signalId);
    } else {
      await sendTelegramReply(chatId, '❌ Signal expired. Wait for a new one.');
    }
    return;
  }

  if (action === 'execute_size') {
    const usdtAmount = query.usdtAmount;
    if (!usdtAmount || usdtAmount <= 0) {
      await sendTelegramReply(chatId, '❌ Invalid position size.');
      return;
    }
    await executeTradeWithSize(signalId, usdtAmount, chatId);
    return;
  }

  if (action === 'skip') {
    const { updateSignal } = await import('./services/supabase.js');
    await updateSignal(signalId, { status: 'skipped', user_action: 'skipped' });
    await fetch(`http://localhost:${config.port}/api/signal/${signalId}/skip`, { method: 'POST' }).catch(() => {});
    return;
  }

  if (action === 'question') {
    const question = query.text?.trim();
    if (!question) return;
    try {
      const result = await askPersonalAssistant(chatId, question);
      await sendTelegramReply(chatId, result.answer);
    } catch (err) {
      await logEvent('error', 'telegram', `Assistant failed: ${err.message}`);
      await sendTelegramReply(chatId, 'Sorry, try again in a moment.');
    }
  } else if (action === 'lessons') {
    try {
      const summary = await getLessonsSummary(signalId);
      const reply = typeof summary === 'string' ? summary : JSON.stringify(summary).slice(0, 500);
      await sendTelegramReply(chatId, reply.startsWith('📚') ? reply : `📚 ${reply}`);
    } catch {
      await sendTelegramReply(chatId, 'Could not load lessons.');
    }
  } else if (action === 'stats') {
    try {
      const { data: stats } = await getPairStats();
      const top = (stats || []).slice(0, 5).map((p) =>
        `${p.symbol}: score ${parseFloat(p.strategy_score).toFixed(0)} | WR ${parseFloat(p.win_rate || 0).toFixed(0)}%`
      ).join('\n');
      const scanner = await getScannerState();
      await sendTelegramReply(chatId, `📊 Scanner: ${scanner.isRunning ? '🟢 ON' : '🔴 OFF'}\n\nTop Pairs:\n${top || 'No data yet'}`);
    } catch {
      await sendTelegramReply(chatId, 'Could not load stats.');
    }
  }
}

server.listen(config.port, async () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   Crypto Trading System — Backend Running    ║
║   Port: ${config.port}                              ║
║   Mode: ${(config.binance.tradingMode || 'demo').padEnd(6)} (${config.binance.testnet ? 'demo-fapi' : 'mainnet'})          ║
║   Scanner: AUTO (always scanning)             ║
╚══════════════════════════════════════════════╝
  `);

  await initUserBinance();

  const userStream = await startUserStream();
  if (userStream.ok) {
    console.log(`[UserStream] Live account feed — ${userStream.positions ?? 0} positions`);
  } else {
    console.warn('[UserStream] Not started:', userStream.reason || 'unknown');
  }

  try {
    const { reconcileAllFlatExchangeTrades } = await import('./services/tradeReconcile.js');
    const reconciled = await reconcileAllFlatExchangeTrades({ skipNotify: true });
    if (reconciled.closed > 0) {
      console.log(`[Reconcile] Closed ${reconciled.closed} orphan DB trade(s): ${reconciled.trades.map((t) => t.symbol).join(', ')}`);
    }
  } catch (err) {
    console.warn('[Reconcile] Boot flat-sync skipped:', err.message);
  }

  await logEvent('info', 'server', 'Backend started');

  const { warmDashboardCaches } = await import('./services/cache.js');
  warmDashboardCaches().catch(() => {});

  const autoStartScanner = process.env.SCANNER_AUTO_START !== 'false';
  await setScannerRunning(autoStartScanner);
  startScanner();
  startCandleIngestion();
  if (autoStartScanner) triggerScan();

  try {
    const { startAllControlServices, updateControlSettings } = await import('./services/researchApi.js');
    await updateControlSettings({
      auto_trading: process.env.CONTROL_AUTO_TRADING !== 'false',
      manual_approval: process.env.CONTROL_MANUAL_APPROVAL === 'true',
      mode: process.env.CONTROL_TRADING_MODE || 'demo',
    }, 'boot');
    await startAllControlServices();
    console.log('[ControlCenter] All modules activated (local fallback if research-api offline)');
  } catch (err) {
    console.warn('[ControlCenter] Boot activation skipped:', err.message);
  }
  positionMonitor.start();
  tradeSafetyMonitor.start();
  startOutcomeTrackerRecovery();
  startAgentTaskRunner();

  if (config.walletScanner?.enabled) {
    const ws = await loadScannerState();
    if (ws.running) startWalletScannerJob();
    else console.log('[WalletScanner] Enable via dashboard or POST /api/wallet-scanner/start');
  }

  if (config.telegram.token && (config.telegram.pollingEnabled || config.telegram.delivery === 'n8n')) {
    await setupTelegramPolling(handleTelegramCallback);
    await sendStartupNotification();
    if (config.telegram.delivery === 'n8n') {
      console.log('[Telegram] Inbound chat via backend polling; n8n handles outbound webhooks only');
    }
  }
});

process.on('SIGINT', () => {
  positionMonitor.stop();
  tradeSafetyMonitor.stop();
  stopUserStream();
  binanceWs.closeAll();
  process.exit(0);
});
