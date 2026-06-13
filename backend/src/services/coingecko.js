/**
 * CoinGecko Demo API — https://docs.coingecko.com/
 * Demo: api.coingecko.com + header x-cg-demo-api-key
 */
import { config } from '../config/index.js';

const BASE = 'https://api.coingecko.com/api/v3';

export const SYMBOL_TO_COINGECKO = {
  BTCUSDT: 'bitcoin',
  ETHUSDT: 'ethereum',
  BNBUSDT: 'binancecoin',
  SOLUSDT: 'solana',
  XRPUSDT: 'ripple',
  ADAUSDT: 'cardano',
  DOGEUSDT: 'dogecoin',
  AVAXUSDT: 'avalanche-2',
  DOTUSDT: 'polkadot',
  LINKUSDT: 'chainlink',
  MATICUSDT: 'matic-network',
  LTCUSDT: 'litecoin',
  UNIUSDT: 'uniswap',
  ATOMUSDT: 'cosmos',
  ETCUSDT: 'ethereum-classic',
  FILUSDT: 'filecoin',
  NEARUSDT: 'near',
  APTUSDT: 'aptos',
  ARBUSDT: 'arbitrum',
  OPUSDT: 'optimism',
};

function cgHeaders() {
  const key = config.coingecko.apiKey;
  if (!key) return {};
  return { 'x-cg-demo-api-key': key };
}

async function cgFetch(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json', ...cgHeaders() },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CoinGecko ${res.status}: ${err.slice(0, 120)}`);
  }
  return res.json();
}

export function symbolToCoinId(symbol) {
  return SYMBOL_TO_COINGECKO[symbol.toUpperCase()] || null;
}

/** Batch USD prices for dashboard symbol bar */
export async function getSimplePrices(symbols) {
  const ids = [...new Set(symbols.map(symbolToCoinId).filter(Boolean))];
  if (!ids.length) return {};
  const data = await cgFetch('/simple/price', {
    ids: ids.join(','),
    vs_currencies: 'usd',
    include_24hr_change: 'true',
  });
  const out = {};
  for (const [sym, id] of Object.entries(SYMBOL_TO_COINGECKO)) {
    if (data[id]) {
      out[sym] = {
        price: data[id].usd,
        change24h: data[id].usd_24h_change,
      };
    }
  }
  return out;
}

/** OHLC candlesticks — days maps to granularity (1=5min, 7=hourly, 30=daily) */
export async function getOHLC(coinId, days = 1) {
  const raw = await cgFetch(`/coins/${coinId}/ohlc`, { vs_currency: 'usd', days: String(days) });
  return raw.map(([t, o, h, l, c]) => ({
    time: Math.floor(t / 1000),
    open: o,
    high: h,
    low: l,
    close: c,
  }));
}

/** Map chart interval to CoinGecko OHLC days param */
export function intervalToCgDays(interval) {
  if (['3m', '5m', '15m'].includes(interval)) return 1;
  if (['30m', '1h'].includes(interval)) return 7;
  return 30;
}

/** Market chart prices (fallback intraday) */
export async function getMarketChart(coinId, days = 1) {
  const data = await cgFetch(`/coins/${coinId}/market_chart`, {
    vs_currency: 'usd',
    days: String(days),
  });
  return (data.prices || []).map(([t, p]) => ({
    time: Math.floor(t / 1000),
    value: p,
  }));
}

export async function searchCoin(query) {
  return cgFetch('/search', { query });
}
