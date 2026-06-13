import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from './config/index.js';
import apiRoutes from './routes/api.js';
import { startScanner } from './jobs/marketScanner.js';
import { positionMonitor } from './jobs/positionMonitor.js';
import { startOutcomeTrackerRecovery } from './jobs/signalOutcomeTracker.js';
import { setupTelegramPolling, sendStartupNotification } from './services/telegram.js';
import { binanceWs } from './services/binanceWs.js';
import { logEvent } from './services/supabase.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);

// WebSocket for real-time dashboard updates
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

// Subscribe to price updates for top pairs
for (const symbol of config.topPairs) {
  binanceWs.subscribeMarkPrice(symbol, (data) => {
    broadcast({ type: 'price', ...data });
  });
}

// Telegram callback handler
async function handleTelegramCallback(action, signalId, query) {
  if (action === 'execute') {
    try {
      const response = await fetch(`http://localhost:${config.port}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: signalId, ...query }),
      });
      const result = await response.json();

      if (config.n8n.executeWebhook) {
        await fetch(config.n8n.executeWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'execute', signalId, result }),
        }).catch(() => {});
      }
    } catch (err) {
      await logEvent('error', 'telegram', `Execute failed: ${err.message}`);
    }
  } else if (action === 'skip') {
    const { updateSignal } = await import('./services/supabase.js');
    await updateSignal(signalId, { status: 'skipped', user_action: 'skipped' });
    await fetch(`http://localhost:${config.port}/api/signal/${signalId}/skip`, {
      method: 'POST',
    }).catch(() => {});
  } else if (action === 'question') {
    const question = query.text;
    try {
      const response = await fetch(`http://localhost:${config.port}/api/ai/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await response.json();

      const TelegramBot = (await import('node-telegram-bot-api')).default;
      const bot = new TelegramBot(config.telegram.token, { polling: false });
      const reply = data.answer || data.error || 'No answer available';
      await bot.sendMessage(query.chat.id, `🤖 ${reply}`, { parse_mode: 'HTML' });
    } catch (err) {
      await logEvent('error', 'telegram', `AI query failed: ${err.message}`);
    }
  } else if (action === 'lessons') {
    try {
      const response = await fetch(`http://localhost:${config.port}/api/ai/lessons/${signalId}`, {
        method: 'GET',
      });
      const data = await response.json();
      const TelegramBot = (await import('node-telegram-bot-api')).default;
      const bot = new TelegramBot(config.telegram.token, { polling: false });
      await bot.sendMessage(query.chat.id, data.answer || JSON.stringify(data).slice(0, 500));
    } catch (err) {
      await logEvent('error', 'telegram', `Lessons failed: ${err.message}`);
    }
  } else if (action === 'stats') {
    try {
      const response = await fetch(`http://localhost:${config.port}/api/pairs/stats`);
      const stats = await response.json();
      const top = (stats || []).slice(0, 5).map((p) =>
        `${p.symbol}: score ${parseFloat(p.strategy_score).toFixed(0)} | WR ${parseFloat(p.win_rate || 0).toFixed(0)}%`
      ).join('\n');
      const TelegramBot = (await import('node-telegram-bot-api')).default;
      const bot = new TelegramBot(config.telegram.token, { polling: false });
      await bot.sendMessage(query.chat.id, `📊 Top Pairs:\n${top || 'No data yet'}`);
    } catch (err) {
      await logEvent('error', 'telegram', `Stats failed: ${err.message}`);
    }
  }
}

server.listen(config.port, async () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   Crypto Trading System — Backend Running    ║
║   Port: ${config.port}                              ║
║   Testnet: ${config.binance.testnet}                        ║
╚══════════════════════════════════════════════╝
  `);

  await logEvent('info', 'server', 'Backend started');

  startScanner();
  positionMonitor.start();
  startOutcomeTrackerRecovery();

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
