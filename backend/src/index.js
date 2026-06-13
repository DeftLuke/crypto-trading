import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/index.js';
import apiRoutes from './routes/api.js';
import { startScanner } from './jobs/marketScanner.js';
import { positionMonitor } from './jobs/positionMonitor.js';
import { startOutcomeTrackerRecovery } from './jobs/signalOutcomeTracker.js';
import {
  setupTelegramPolling,
  sendStartupNotification,
  sendAlert,
  askPositionSize,
} from './services/telegram.js';
import { binanceWs } from './services/binanceWs.js';
import { logEvent, getSupabase } from './services/supabase.js';
import { callN8nWebhook } from './services/n8n.js';
import { askPersonalAssistant } from './services/personalAssistant.js';
import { getLessonsSummary } from './services/aiAgent.js';
import { getPairStats } from './services/supabase.js';
import { startAgentTaskRunner } from './jobs/agentTaskRunner.js';
import { setScannerRunning, getScannerState } from './services/scannerState.js';
import { triggerScan } from './jobs/marketScanner.js';

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

app.use(cors());
app.use(express.json());
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

  const response = await fetch(`http://localhost:${config.port}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    if (config.n8n.executeWebhook) {
      await callN8nWebhook(config.n8n.executeWebhook, { action: 'execute', signalId, result });
    }
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
║   Testnet: ${config.binance.testnet}                        ║
║   Scanner: OFF by default (/startT to enable) ║
╚══════════════════════════════════════════════╝
  `);

  await logEvent('info', 'server', 'Backend started');
  await setScannerRunning(false);

  startScanner();
  positionMonitor.start();
  startOutcomeTrackerRecovery();
  startAgentTaskRunner();

  if (config.telegram.token) {
    await setupTelegramPolling(handleTelegramCallback);
    await sendStartupNotification();
  }
});

process.on('SIGINT', () => {
  positionMonitor.stop();
  binanceWs.closeAll();
  process.exit(0);
});
