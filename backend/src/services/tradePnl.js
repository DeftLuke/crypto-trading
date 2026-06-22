/**
 * Exchange-accurate PnL: realized from Binance income, unrealized on runner only.
 */
import { getRealizedPnlSince } from './userBinance.js';
import { isExchangeBlocked } from './exchangeRateLimit.js';

function toNumber(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

const realizedCache = new Map();
const REALIZED_CACHE_MS = 90_000;

export async function fetchExchangeRealizedPnl(trade) {
  if (!trade?.symbol || !trade?.opened_at) return null;
  if (isExchangeBlocked()) return null;
  if (!trade.tp1_hit && !trade.tp2_hit) return null;

  const cacheKey = `${trade.id || trade.symbol}:${trade.opened_at}`;
  const hit = realizedCache.get(cacheKey);
  if (hit && Date.now() - hit.at < REALIZED_CACHE_MS) return hit.data;

  const sinceMs = new Date(trade.opened_at).getTime() - 120000;
  const data = await getRealizedPnlSince(trade.symbol, sinceMs);
  if (data?.total != null) realizedCache.set(cacheKey, { data, at: Date.now() });
  return data;
}

/** Unrealized PnL on remaining exchange position only (never includes booked TP1/TP2). */
export function computeRunnerUnrealized(trade, live, currentPrice) {
  if (live?.unrealized_pnl != null && Number.isFinite(parseFloat(live.unrealized_pnl))) {
    return toNumber(live.unrealized_pnl);
  }
  const qty = toNumber(live?.quantity ?? trade.quantity);
  const entry = toNumber(live?.entry_price ?? trade.entry_price);
  const price = toNumber(currentPrice ?? live?.current_price);
  if (!qty || !entry || !price) return 0;
  return trade.direction === 'LONG'
    ? (price - entry) * qty
    : (entry - price) * qty;
}

/**
 * @returns {{ realized: number, unrealized: number, total: number, exchangeSynced: boolean }}
 */
export async function resolveTradePnl(trade, live = null, currentPrice = null) {
  const isOpen = ['open', 'partial'].includes(trade?.status);
  let realized = toNumber(trade.exchange_realized_pnl);
  let exchangeSynced = trade.exchange_realized_pnl != null && trade.exchange_realized_pnl !== '';

  const needsIncomeSync = (trade.tp1_hit || trade.tp2_hit) && isOpen && !exchangeSynced;
  if (needsIncomeSync) {
    const exchange = await fetchExchangeRealizedPnl(trade).catch(() => null);
    if (exchange?.total != null && Number.isFinite(exchange.total)) {
      realized = exchange.total;
      exchangeSynced = true;
    }
  } else if (!isOpen) {
    realized = toNumber(trade.exchange_realized_pnl ?? trade.pnl);
    exchangeSynced = trade.exchange_realized_pnl != null;
  } else if (!exchangeSynced && !(trade.tp1_hit || trade.tp2_hit)) {
    realized = 0;
  }

  const unrealized = isOpen ? computeRunnerUnrealized(trade, live, currentPrice) : 0;
  return {
    realized,
    unrealized,
    total: realized + unrealized,
    exchangeSynced,
  };
}

/** Sum notional exposure across open positions (margin × leverage fallback). */
export function computeOpenExposure(items = []) {
  return items.reduce((sum, p) => {
    const notional = toNumber(p.notional ?? p.notional_usdt);
    if (notional > 0) return sum + notional;
    const margin = toNumber(p.margin ?? p.margin_usdt);
    const lev = toNumber(p.leverage, 1);
    if (margin > 0 && lev > 0) return sum + margin * lev;
    const qty = toNumber(p.quantity ?? p.exchange_quantity);
    const price = toNumber(p.current_price ?? p.entry_price ?? p.mark_price);
    if (qty > 0 && price > 0) return sum + qty * price;
    return sum;
  }, 0);
}

export function computeOpenMargin(items = []) {
  return items.reduce((sum, p) => sum + toNumber(p.margin ?? p.margin_usdt), 0);
}

/** Persisted sizing for closed trades (quantity is 0 after close). */
export function resolveClosedTradeSizing(trade) {
  const entry = toNumber(trade.entry_price);
  const leverage = toNumber(trade.leverage, 50);
  const originalQty = toNumber(trade.original_quantity || trade.quantity);
  const notional = toNumber(trade.notional_usdt) || (originalQty * entry);
  const margin = toNumber(trade.margin_usdt) || (leverage > 0 ? notional / leverage : 0);
  const pnl = toNumber(trade.exchange_realized_pnl ?? trade.pnl);
  return {
    quantity: originalQty,
    notional,
    margin,
    leverage,
    roe_pct: margin > 0 ? (pnl / margin) * 100 : toNumber(trade.pnl_percent),
    profit_percent: notional > 0 ? (pnl / notional) * 100 : toNumber(trade.pnl_percent),
  };
}
