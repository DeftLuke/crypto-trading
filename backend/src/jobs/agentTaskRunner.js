import { config } from '../config/index.js';
import { getDueTasks, completeTask } from '../services/agentMemory.js';
import { logEvent } from '../services/supabase.js';

let interval = null;

async function sendTelegram(chatId, text) {
  if (!config.telegram.token) return;
  const TelegramBot = (await import('node-telegram-bot-api')).default;
  const bot = new TelegramBot(config.telegram.token, { polling: false });
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch {
    await bot.sendMessage(chatId, text.replace(/<[^>]+>/g, ''));
  }
}

async function tick() {
  try {
    const due = await getDueTasks();
    for (const task of due) {
      const note = task.payload?.note || 'Reminder';
      await sendTelegram(task.chat_id, `⏰ <b>Timer</b>\n\n${note}`);
      await completeTask(task.id);
    }
  } catch (err) {
    console.error('[AgentTasks] tick error:', err.message);
  }
}

export function startAgentTaskRunner() {
  if (interval) return;
  interval = setInterval(tick, 15_000);
  tick();
  console.log('[AgentTasks] Timer runner started (15s)');
}

export function stopAgentTaskRunner() {
  if (interval) clearInterval(interval);
  interval = null;
}

export async function notifyWatchlistUsers(symbol, signal) {
  const { getWatchTasksForSymbol } = await import('../services/agentMemory.js');
  const tasks = await getWatchTasksForSymbol(symbol);
  for (const task of tasks) {
    const msg = `👁 <b>Watch alert — ${symbol}</b>\n\n${signal.direction} signal ${signal.confidence}%\nEntry: ${signal.entry_price}\nSL: ${signal.stop_loss}`;
    await sendTelegram(task.chat_id, msg);
    await logEvent('info', 'agent', `Watch alert ${symbol}`, { chat_id: task.chat_id });
  }
}
