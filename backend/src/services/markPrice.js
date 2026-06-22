/**
 * Fresh mark price for TP/SL decisions — REST is authoritative; WS is cache only.
 */
import { getMarkPrice } from './binance.js';
import { binanceWs } from './binanceWs.js';
import { isExchangeBlocked } from './exchangeRateLimit.js';

const restCache = new Map();
const REST_TTL_MS = 10_000;

export async function getFreshMarkPrice(symbol) {
  const sym = String(symbol || '').toUpperCase();
  const ws = binanceWs.getPrice(sym);
  if (isExchangeBlocked()) {
    if (Number.isFinite(ws) && ws > 0) return ws;
    const cached = restCache.get(sym);
    return cached?.price ?? null;
  }

  const cached = restCache.get(sym);
  const now = Date.now();
  if (cached && now - cached.at < REST_TTL_MS) {
    return cached.price;
  }

  if (Number.isFinite(ws) && ws > 0) {
    return ws;
  }

  try {
    const price = await getMarkPrice(sym);
    if (Number.isFinite(price) && price > 0) {
      restCache.set(sym, { price, at: now });
      binanceWs.prices.set(sym, price);
      return price;
    }
  } catch {
    /* fall through */
  }

  return cached?.price ?? ws ?? null;
}
