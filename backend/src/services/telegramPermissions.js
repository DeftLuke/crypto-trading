import { config } from '../config/index.js';

export function getTelegramAllowedIds() {
  const ids = new Set();
  if (config.telegram?.chatId) ids.add(String(config.telegram.chatId));
  for (const id of config.telegram?.allowedUsers || []) {
    if (id) ids.add(String(id).trim());
  }
  return ids;
}

/** Primary owner — full task + reboot permission. */
export function isTelegramOwner(chatId) {
  if (!config.telegram?.chatId) return true;
  return String(chatId) === String(config.telegram.chatId);
}

/** Allowed to chat and run tasks (owner + TELEGRAM_ALLOWED_USERS). */
export function isTelegramAllowed(chatId) {
  if (config.telegram?.assistantRestricted === false) return true;
  const allowed = getTelegramAllowedIds();
  if (!allowed.size) return true;
  return allowed.has(String(chatId));
}

export function denyTelegramMessage(chatId) {
  return `⛔ Unauthorized chat (${chatId}). Ask the owner to add your ID to TELEGRAM_ALLOWED_USERS.`;
}
