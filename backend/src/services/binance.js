import crypto from 'crypto';
import { config } from '../config/index.js';

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
    searchParams.set('timestamp', Date.now().toString());
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

export async function placeMarketOrder(symbol, side, quantity) {
  return binanceRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity: quantity.toString(),
  }, true);
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

export function formatQuantity(symbol, qty, stepSize = 3) {
  const precision = stepSize.toString().split('.')[1]?.length || 0;
  return parseFloat(qty.toFixed(precision));
}

export function calculatePositionSize(balance, riskPercent, entryPrice, stopLoss) {
  const riskAmount = balance * riskPercent;
  const riskPerUnit = Math.abs(entryPrice - stopLoss);
  if (riskPerUnit === 0) return 0;
  return riskAmount / riskPerUnit;
}
