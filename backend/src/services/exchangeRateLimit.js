/** Shared Binance REST backoff — prevents hammering during IP bans. */

let blockedUntil = 0;
let lastError = null;

export function parseBanUntilMs(message) {
  const msg = String(message || '');
  const match = msg.match(/banned until (\d+)/i);
  if (match) {
    const ts = parseInt(match[1], 10);
    return ts > 1e12 ? ts : ts * 1000;
  }
  if (/too many requests|429|rate limit/i.test(msg)) {
    return Date.now() + 120_000;
  }
  return 0;
}

export function noteExchangeRateLimit(message) {
  const until = parseBanUntilMs(message);
  if (until > blockedUntil) blockedUntil = until;
  lastError = message;
}

export function isExchangeBlocked() {
  return Date.now() < blockedUntil;
}

export function getExchangeBlockInfo() {
  return {
    blocked: isExchangeBlocked(),
    blocked_until: blockedUntil > Date.now() ? new Date(blockedUntil).toISOString() : null,
    last_error: lastError,
  };
}

export function clearExchangeBlock() {
  blockedUntil = 0;
  lastError = null;
}
