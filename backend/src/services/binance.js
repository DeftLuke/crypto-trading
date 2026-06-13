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

export async function getKlines(symbol, interval, limit = 500) {
  return binanceRequest('GET', '/fapi/v1/klines', { symbol, interval, limit });
}

export async function get24hrTicker(symbol) {
  return binanceRequest('GET', '/fapi/v1/ticker/24hr', { symbol });
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
