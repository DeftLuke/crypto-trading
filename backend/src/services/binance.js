import crypto from 'crypto';
import fs from 'fs';
import { config } from '../config/index.js';
import { ensureBinanceTime } from './binanceTime.js';
import { fetchWithTimeout } from '../utils/fetchTimeout.js';

function sign(queryString) {
  const keyPath = config.binance.privateKeyPath;
  const useRsa = (config.binance.signatureType === 'rsa' || keyPath)
    && keyPath
    && fs.existsSync(keyPath);
  if (useRsa) {
    const privateKey = fs.readFileSync(keyPath, 'utf8');
    return crypto
      .createSign('RSA-SHA256')
      .update(queryString)
      .sign(privateKey, 'base64');
  }
  if (!config.binance.apiSecret) {
    throw new Error('Binance API secret or private key not configured');
  }
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

  const res = await fetchWithTimeout(url.toString(), { method, headers }, 15000);
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

export async function getAccountInfo() {
  return binanceRequest('GET', '/fapi/v2/account', {}, true);
}

let exchangeDownUntil = 0;
let balanceCache = null;
let balanceCacheAt = 0;
const BALANCE_CACHE_MS = 30_000;

export function isExchangeUnreachable() {
  return Date.now() < exchangeDownUntil;
}

function balanceFallback(reason) {
  exchangeDownUntil = Date.now() + 30_000;
  const fallback = parseFloat(process.env.DEMO_BALANCE_FALLBACK || '5000');
  return {
    total: fallback,
    available: fallback,
    source: 'fallback',
    error: reason,
    exchange_unreachable: true,
  };
}

export async function getUsdtBalance() {
  if (balanceCache && Date.now() - balanceCacheAt < BALANCE_CACHE_MS) {
    return balanceCache;
  }
  if (Date.now() < exchangeDownUntil) {
    return balanceFallback('exchange_unreachable_cached');
  }

  let balances = [];
  try {
    balances = await getAccountBalance();
  } catch (err) {
    return balanceFallback(err.message);
  }
  const usdt = balances.find((b) => b.asset === 'USDT');
  const total = parseFloat(usdt?.balance || usdt?.crossWalletBalance || 0);
  const available = parseFloat(usdt?.availableBalance || usdt?.maxWithdrawAmount || 0);

  if (total > 0 || available > 0) {
    exchangeDownUntil = 0;
    balanceCache = { total, available, source: 'balance' };
    balanceCacheAt = Date.now();
    return balanceCache;
  }

  return balanceFallback('empty_balance');
}

/** Binance rejects SL/TP when mark price has already crossed the trigger level. */
export function protectionTriggerIssues(direction, markPrice, { stopLoss, tp1, tp2 } = {}) {
  const mark = parseFloat(markPrice);
  const sl = parseFloat(stopLoss);
  const t1 = parseFloat(tp1);
  const t2 = parseFloat(tp2);
  if (!Number.isFinite(mark) || mark <= 0) return [];
  const isLong = direction === 'LONG' || direction === 'BUY';
  const issues = [];
  if (isLong) {
    if (Number.isFinite(sl) && mark <= sl) issues.push({ level: 'SL', message: 'Price already at/below stop loss' });
    if (Number.isFinite(t1) && mark >= t1) issues.push({ level: 'TP1', message: 'Price already at/above TP1 — signal levels are stale' });
    if (Number.isFinite(t2) && mark >= t2) issues.push({ level: 'TP2', message: 'Price already at/above TP2 — signal levels are stale' });
  } else {
    if (Number.isFinite(sl) && mark >= sl) issues.push({ level: 'SL', message: 'Price already at/above stop loss' });
    if (Number.isFinite(t1) && mark <= t1) issues.push({ level: 'TP1', message: 'Price already at/below TP1 — target already passed' });
    if (Number.isFinite(t2) && mark <= t2) issues.push({ level: 'TP2', message: 'Price already at/below TP2 — target already passed' });
  }
  return issues;
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

export async function placeStopMarketOrder(symbol, side, stopPrice, quantity, { closePosition = false } = {}) {
  const params = {
    algoType: 'CONDITIONAL',
    symbol,
    side,
    type: 'STOP_MARKET',
    triggerPrice: (await formatOrderPrice(symbol, stopPrice)).toString(),
    workingType: 'MARK_PRICE',
  };
  if (closePosition || !quantity) {
    params.closePosition = 'true';
  } else {
    params.quantity = (await formatOrderQuantity(symbol, quantity)).toString();
    params.reduceOnly = 'true';
  }
  return binanceRequest('POST', '/fapi/v1/algoOrder', params, true);
}

export async function placeTakeProfitOrder(symbol, side, stopPrice, quantity) {
  return binanceRequest('POST', '/fapi/v1/algoOrder', {
    algoType: 'CONDITIONAL',
    symbol,
    side,
    type: 'TAKE_PROFIT_MARKET',
    triggerPrice: (await formatOrderPrice(symbol, stopPrice)).toString(),
    quantity: (await formatOrderQuantity(symbol, quantity)).toString(),
    reduceOnly: 'true',
    workingType: 'MARK_PRICE',
  }, true);
}

export async function cancelAllOrders(symbol) {
  const regular = await binanceRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol }, true).catch((err) => ({ error: err.message }));
  const algo = await binanceRequest('DELETE', '/fapi/v1/allOpenAlgoOrders', { symbol }, true).catch((err) => ({ error: err.message }));
  return { regular, algo };
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
      let tickSize = 0.01;
      for (const f of s.filters) {
        if (f.filterType === 'PRICE_FILTER') {
          tickSize = parseFloat(f.tickSize);
        }
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
        tickSize,
        precision: countDecimals(stepSize),
        pricePrecision: countDecimals(tickSize),
      };
    }
  }
  return symbolRulesCache[symbol] || { stepSize: 0.001, minQty: 0.001, minNotional: 5, tickSize: 0.01, precision: 3, pricePrecision: 2 };
}

export function roundToStep(qty, stepSize) {
  if (!stepSize || stepSize <= 0) return qty;
  const steps = Math.floor(qty / stepSize + 1e-12);
  const rounded = steps * stepSize;
  return parseFloat(rounded.toFixed(countDecimals(stepSize)));
}

async function formatOrderQuantity(symbol, qty) {
  const rules = await getSymbolRules(symbol);
  return roundToStep(qty, rules.stepSize);
}

export function roundPriceToTick(price, tickSize) {
  if (!tickSize || tickSize <= 0) return price;
  const steps = Math.round(price / tickSize);
  const rounded = steps * tickSize;
  return parseFloat(rounded.toFixed(countDecimals(tickSize)));
}

async function formatOrderPrice(symbol, price) {
  const rules = await getSymbolRules(symbol);
  return roundPriceToTick(price, rules.tickSize);
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

const LEVERAGE_LADDER = [50, 40, 25, 20, 15, 10, 5];

export { LEVERAGE_LADDER };

let leverageBracketCache = null;

export function isPositionLimitError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('maximum allowable position')
    || msg.includes('exceeded the maximum')
    || msg.includes('position limit')
    || msg.includes('max position');
}

export async function getLeverageNotionalCap(symbol, leverage) {
  try {
    if (!leverageBracketCache) {
      const data = await binanceRequest('GET', '/fapi/v1/leverageBracket', {}, true);
      leverageBracketCache = {};
      for (const item of data) {
        leverageBracketCache[item.symbol] = item.brackets || [];
      }
    }
    const brackets = leverageBracketCache[symbol];
    if (!brackets?.length) return null;
    const sorted = [...brackets].sort((a, b) => b.initialLeverage - a.initialLeverage);
    for (const bracket of sorted) {
      if (leverage <= bracket.initialLeverage) {
        return parseFloat(bracket.notionalCap);
      }
    }
    return parseFloat(sorted[sorted.length - 1]?.notionalCap || 0) || null;
  } catch {
    return null;
  }
}

/** Cap qty so notional stays within Binance leverage bracket limits. */
export async function capQtyToPositionLimit(symbol, qty, price, leverage) {
  const cap = await getLeverageNotionalCap(symbol, leverage);
  if (!cap || !price || price <= 0) return qty;
  const rules = await getSymbolRules(symbol);
  const maxQty = roundToStep((cap * 0.98) / price, rules.stepSize);
  if (maxQty < rules.minQty) return qty;
  return Math.min(qty, maxQty);
}

export async function placeMarketOrderResilient(symbol, side, quantity, reduceOnly = false, {
  leverage = null,
  setLeverageFn = null,
  priceHint = null,
} = {}) {
  const rules = await getSymbolRules(symbol);
  let qty = roundToStep(quantity, rules.stepSize);
  if (leverage) {
    const price = priceHint && priceHint > 0 ? priceHint : await getMarkPrice(symbol);
    qty = await capQtyToPositionLimit(symbol, qty, price, leverage);
  }

  let currentLeverage = leverage;
  const levLadder = currentLeverage
    ? [currentLeverage, ...LEVERAGE_LADDER.filter((l) => l !== currentLeverage)]
    : [];
  let levIdx = 0;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return {
        order: await placeMarketOrder(symbol, side, qty, reduceOnly),
        qty,
        leverage: levLadder[levIdx] || currentLeverage,
      };
    } catch (err) {
      if (!isPositionLimitError(err)) throw err;
      const reduced = roundToStep(qty * 0.8, rules.stepSize);
      if (reduced >= rules.minQty && reduced < qty) {
        qty = reduced;
        continue;
      }
      levIdx += 1;
      if (!setLeverageFn || levIdx >= levLadder.length) throw err;
      currentLeverage = levLadder[levIdx];
      await setLeverageFn(symbol, currentLeverage);
      const price = priceHint && priceHint > 0 ? priceHint : await getMarkPrice(symbol);
      qty = await capQtyToPositionLimit(symbol, roundToStep(quantity, rules.stepSize), price, currentLeverage);
    }
  }
  throw new Error(`Exceeded the maximum allowable position at current leverage for ${symbol}`);
}

/** Step down leverage until Binance accepts it for this symbol. */
export async function setLeverageWithFallback(symbol, preferredLeverage = 50, setFn = null) {
  const fn = setFn || ((sym, lev) => setLeverage(sym, lev));
  const ladder = [preferredLeverage, ...LEVERAGE_LADDER.filter((l) => l !== preferredLeverage)];
  let lastError = null;
  for (const lev of ladder) {
    try {
      await fn(symbol, lev);
      return lev;
    } catch (err) {
      lastError = err;
      const msg = String(err.message || '').toLowerCase();
      const leverageIssue = msg.includes('leverage') || msg.includes('not valid') || msg.includes('invalid');
      if (!leverageIssue) throw err;
    }
  }
  throw lastError || new Error(`Leverage ${preferredLeverage} is not valid for ${symbol}`);
}

/** Keep notional fixed; step down leverage until Binance accepts it. */
export async function resolveOrderSizing(symbol, {
  notionalUsdt,
  preferredLeverage = 50,
  priceHint = null,
  setLeverageFn,
}) {
  const ladder = [preferredLeverage, ...LEVERAGE_LADDER.filter((l) => l !== preferredLeverage)];
  let lastError = null;
  for (const lev of ladder) {
    try {
      await setLeverageFn(symbol, lev);
      const marginUsdt = notionalUsdt / lev;
      const sized = await calculateOrderQty(symbol, marginUsdt, lev, priceHint);
      const cappedQty = await capQtyToPositionLimit(symbol, sized.qty, sized.price, lev);
      const cappedNotional = cappedQty * sized.price;
      return {
        leverage: lev,
        marginUsdt: cappedNotional / lev,
        ...sized,
        qty: cappedQty,
        notional: cappedNotional,
      };
    } catch (err) {
      lastError = err;
      const msg = String(err.message || '').toLowerCase();
      const leverageIssue = msg.includes('leverage') || msg.includes('not valid') || msg.includes('invalid');
      if (!leverageIssue) throw err;
    }
  }
  throw lastError || new Error(`Could not set leverage for ${symbol}`);
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

/**
 * Risk-based position sizing (1% default):
 * qty = (equity × risk%) / |entry − SL|; notional = qty × entry; margin = notional / leverage
 */
export function computeRiskBasedSizing({
  accountEquity,
  availableBalance,
  entryPrice,
  stopLossPrice,
  riskPercent = 0.01,
  preferredLeverage = 50,
}) {
  const equity = parseFloat(accountEquity) || 0;
  const available = parseFloat(availableBalance ?? accountEquity) || equity;
  const entry = parseFloat(entryPrice);
  const sl = parseFloat(stopLossPrice);
  const priceRisk = Math.abs(entry - sl);

  if (!equity || equity <= 0) {
    return { ok: false, error: 'Account equity unavailable for risk sizing' };
  }
  if (priceRisk <= 0 || entry <= 0) {
    return { ok: false, error: 'Invalid entry or stop loss for risk sizing' };
  }

  const riskAmount = equity * riskPercent;
  const qty = riskAmount / priceRisk;
  const positionValue = qty * entry;
  const requiredMargin = positionValue / preferredLeverage;

  return {
    ok: true,
    riskAmount,
    priceRisk,
    qty,
    positionValue,
    requiredMargin,
    riskPercent,
    accountEquity: equity,
    availableBalance: available,
    canOpen: requiredMargin <= available,
  };
}

/** Risk-based qty with leverage ladder + margin gate + min notional. */
export async function resolveRiskBasedOrderSizing(symbol, {
  accountEquity,
  availableBalance,
  entryPrice,
  stopLossPrice,
  riskPercent = 0.01,
  preferredLeverage = 50,
  setLeverageFn,
}) {
  const price = parseFloat(entryPrice);
  const rules = await getSymbolRules(symbol);
  const core = computeRiskBasedSizing({
    accountEquity,
    availableBalance,
    entryPrice: price,
    stopLossPrice,
    riskPercent,
    preferredLeverage,
  });
  if (!core.ok) throw new Error(core.error);

  let qty = roundToStep(core.qty, rules.stepSize);
  qty = Math.max(qty, rules.minQty);
  let notional = qty * price;
  const minNotional = Math.max(rules.minNotional, 5.5);

  if (notional < minNotional) {
    qty = roundToStep((minNotional * 1.02) / price, rules.stepSize);
    qty = Math.max(qty, rules.minQty);
    notional = qty * price;
  }

  const priceRisk = core.priceRisk;
  const riskAmount = qty * priceRisk;
  const available = parseFloat(availableBalance ?? accountEquity) || 0;
  const ladder = [preferredLeverage, ...LEVERAGE_LADDER.filter((l) => l !== preferredLeverage)];
  let lastError = null;

  for (const lev of ladder) {
    const marginUsdt = notional / lev;
    if (marginUsdt > available) {
      lastError = new Error(
        `Insufficient margin: need $${marginUsdt.toFixed(2)} at ${lev}x, available $${available.toFixed(2)}`,
      );
      continue;
    }
    try {
      await setLeverageFn(symbol, lev);
      const cappedQty = await capQtyToPositionLimit(symbol, qty, price, lev);
      const cappedNotional = cappedQty * price;
      const cappedMargin = cappedNotional / lev;
      if (cappedMargin > available) {
        lastError = new Error(
          `Insufficient margin after position cap: need $${cappedMargin.toFixed(2)} at ${lev}x`,
        );
        continue;
      }
      return {
        leverage: lev,
        marginUsdt: cappedMargin,
        qty: cappedQty,
        price,
        notional: cappedNotional,
        riskAmount: cappedQty * priceRisk,
        priceRisk,
        riskPercent,
        accountEquity: core.accountEquity,
        sizing_mode: 'risk_percent',
      };
    } catch (err) {
      lastError = err;
      const msg = String(err.message || '').toLowerCase();
      const leverageIssue = msg.includes('leverage') || msg.includes('not valid') || msg.includes('invalid');
      if (!leverageIssue) throw err;
    }
  }
  throw lastError || new Error(`Cannot open ${symbol}: insufficient margin or leverage unavailable`);
}
