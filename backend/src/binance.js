import crypto from 'crypto';
import { config } from '../config/index.js';
import { ensureBinanceTime } from './binanceTime.js';

function sign(queryString) {
  return crypto
    .createHmac('sha256', config.binance.apiSecret)
    .update(queryString)
    .digest('hex');
}

async function binanceRequest(method, endpoint, params = {}, signed = false) {
  const url = new URL(`${config.binance.restUrl}${endpoint}`);
  const searchParams = new URLSearchParams(params);

  if (signed) {
    const timestamp = await ensureBinanceTime(config.binance.restUrl);
    searchParams.set('timestamp', timestamp.toString());
    searchParams.set('recvWindow', '10000');
    searchParams.set('signature', sign(searchParams.toString()));
  }

  url.search = searchParams.toString();

  const headers = { 'X-MBX-APIKEY': config.binance.apiKey };

  const res = await fetch(url.toString(), { method, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.msg || `Binance API error: ${res.status}`);
  }
  return data;
}

export async function getKlines(symbol, interval, limit = 500, startTime = null) {
  const params = { symbol, interval, limit };
  if (startTime) params.startTime = startTime.toString();
  return binanceRequest('GET', '/fapi/v1/klines', params);
}

let cachedSymbols = null;
let symbolsCacheTime = 0;

export async function getAllFuturesSymbols(minVolume = 1000000) {
  if (cachedSymbols && Date.now() - symbolsCacheTime < 3600000) {
    return cachedSymbols;
  }

  const info = await getExchangeInfo();
  const tickers = await binanceRequest('GET', '/fapi/v1/ticker/24hr');

  const volumeMap = {};
  for (const t of tickers) {
    volumeMap[t.symbol] = parseFloat(t.quoteVolume || 0);
  }

  const symbols = info.symbols
    .filter((s) =>
      s.status === 'TRADING' &&
      s.contractType === 'PERPETUAL' &&
      s.quoteAsset === 'USDT' &&
      !s.symbol.includes('_') &&
      volumeMap[s.symbol] >= minVolume
    )
    .map((s) => s.symbol)
    .sort((a, b) => (volumeMap[b] || 0) - (volumeMap[a] || 0));

  cachedSymbols = symbols;
  symbolsCacheTime = Date.now();
  return symbols;
}

export async function get24hrTicker(symbol) {
  try {
    return await binanceRequest('GET', '/fapi/v1/ticker/24hr', { symbol });
  } catch (err) {
    const { binanceWs } = await import('./binanceWs.js');
    const price = binanceWs.getPrice(symbol);
    if (price) {
      return {
        symbol,
        lastPrice: String(price),
        priceChangePercent: '0',
        highPrice: String(price),
        lowPrice: String(price),
        quoteVolume: '0',
      };
    }
    throw err;
  }
}

export async function getAccountBalance() {
  return binanceRequest('GET', '/fapi/v2/balance', {}, true);
}

export async function getUsdtBalance() {
  const balances = await getAccountBalance();
  const usdt = balances.find((b) => b.asset === 'USDT');
  return {
    total: parseFloat(usdt?.balance || 0),
    available: parseFloat(usdt?.availableBalance || 0),
  };
}

export async function getPositionRisk(symbol) {
  const params = symbol ? { symbol } : {};
  return binanceRequest('GET', '/fapi/v2/positionRisk', params, true);
}

export async function setLeverage(symbol, leverage = 5) {
  return binanceRequest('POST', '/fapi/v1/leverage', { symbol, leverage }, true);
}

export async function placeMarketOrder(symbol, side, quantity, reduceOnly = false) {
  const params = {
    symbol,
    side,
    type: 'MARKET',
    quantity: quantity.toString(),
  };
  if (reduceOnly) params.reduceOnly = 'true';
  return binanceRequest('POST', '/fapi/v1/order', params, true);
}

export async function placeStopMarketOrder(symbol, side, stopPrice, quantity, reduceOnly = true) {
  return binanceRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'STOP_MARKET',
    stopPrice: stopPrice.toString(),
    quantity: quantity.toString(),
    reduceOnly: reduceOnly.toString(),
    workingType: 'MARK_PRICE',
  }, true);
}

export async function placeTakeProfitOrder(symbol, side, stopPrice, quantity) {
  return binanceRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'TAKE_PROFIT_MARKET',
    stopPrice: stopPrice.toString(),
    quantity: quantity.toString(),
    reduceOnly: 'true',
    workingType: 'MARK_PRICE',
  }, true);
}

export async function cancelAllOrders(symbol) {
  return binanceRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol }, true);
}

export async function getExchangeInfo() {
  return binanceRequest('GET', '/fapi/v1/exchangeInfo');
}

export function parseKlines(rawKlines) {
  return rawKlines.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function getMarkPrice(symbol) {
  try {
    const { binanceWs } = await import('./binanceWs.js');
    const wsPrice = binanceWs.getPrice(symbol);
    if (wsPrice && wsPrice > 0) return wsPrice;
  } catch { /* fall through */ }

  const ticker = await binanceRequest('GET', '/fapi/v1/ticker/price', { symbol });
  const price = parseFloat(ticker.price);
  if (!price || price <= 0) throw new Error(`No mark price for ${symbol}`);
  return price;
}

let symbolRulesCache = null;

function countDecimals(step) {
  const s = String(step);
  if (!s.includes('.')) return 0;
  return s.split('.')[1].replace(/0+$/, '').length;
}

export async function getSymbolRules(symbol) {
  if (!symbolRulesCache) {
    const info = await getExchangeInfo();
    symbolRulesCache = {};
    for (const s of info.symbols) {
      let stepSize = 0.001;
      let minQty = 0.001;
      let minNotional = 5;
      for (const f of s.filters) {
        if (f.filterType === 'LOT_SIZE') {
          stepSize = parseFloat(f.stepSize);
          minQty = parseFloat(f.minQty);
        }
        if (f.filterType === 'MIN_NOTIONAL') {
          minNotional = parseFloat(f.notional || f.minNotional || 5);
        }
      }
      symbolRulesCache[s.symbol] = {
        stepSize,
        minQty,
        minNotional,
        precision: countDecimals(stepSize),
      };
    }
  }
  return symbolRulesCache[symbol] || { stepSize: 0.001, minQty: 0.001, minNotional: 5, precision: 3 };
}

export function roundToStep(qty, stepSize) {
  if (!stepSize || stepSize <= 0) return qty;
  const steps = Math.floor(qty / stepSize + 1e-12);
  const rounded = steps * stepSize;
  return parseFloat(rounded.toFixed(countDecimals(stepSize)));
}

/** Margin × leverage at live mark price; enforces Binance min notional (≥5 USDT). */
export async function calculateOrderQty(symbol, marginUsdt, leverage, priceHint = null) {
  const price = priceHint && priceHint > 0 ? priceHint : await getMarkPrice(symbol);
  const rules = await getSymbolRules(symbol);
  const lev = leverage || 50;

  let qty = (marginUsdt * lev) / price;
  qty = Math.max(roundToStep(qty, rules.stepSize), rules.minQty);

  let notional = qty * price;
  const minNotional = Math.max(rules.minNotional, 5.5);

  if (notional < minNotional) {
    qty = roundToStep((minNotional * 1.02) / price, rules.stepSize);
    qty = Math.max(qty, rules.minQty);
    notional = qty * price;
  }

  return { qty, price, notional, leverage: lev, rules };
}

export function formatQuantity(symbol, qty, decimals = 3) {
  const d = Number.isFinite(decimals) && decimals >= 0 ? decimals : 3;
  const rounded = parseFloat(Number(qty).toFixed(d));
  return rounded > 0 ? rounded : parseFloat(Number(qty).toFixed(6));
}

export function calculatePositionSize(balance, riskPercent, entryPrice, stopLoss) {
  const riskAmount = balance * riskPercent;
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit === 0) return 0;
  return riskAmount / riskPerUnit;
}
