import { logEvent } from './supabase.js';

/** Restart backend — Docker `restart: always` brings it back. */
export async function rebootBackend(chatId) {
  await logEvent('info', 'agent', 'Reboot requested via Telegram', { chat_id: chatId });
  setTimeout(() => {
    console.log('[Agent] Reboot requested — exiting for Docker restart');
    process.exit(0);
  }, 2500);
  return '♻️ Restarting trading backend now… I\'ll be back in ~30 seconds.';
}

export async function getSystemStatus() {
  const mem = process.memoryUsage();
  return {
    uptimeSec: Math.floor(process.uptime()),
    memoryMb: Math.round(mem.rss / 1024 / 1024),
    node: process.version,
    pid: process.pid,
  };
}

export function formatSystemStatus(s) {
  const mins = Math.floor(s.uptimeSec / 60);
  return `🟢 <b>System OK</b>\nUptime: ${mins} min\nMemory: ${s.memoryMb} MB\nNode: ${s.node}`;
}
