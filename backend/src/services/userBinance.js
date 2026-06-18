import crypto from 'crypto';
import fs from 'fs';
import { config } from '../config/index.js';
import { getSupabase } from './supabase.js';
import { ensureBinanceTime } from './binanceTime.js';
import { loadStoredCredentials, saveStoredCredentials } from './credentialStore.js';
import { getSymbolRules, roundToStep, roundPriceToTick, getUsdtBalance, isExchangeUnreachable, setLeverageWithFallback, capQtyToPositionLimit, isPositionLimitError, getMarkPrice, LEVERAGE_LADDER } from './binance.js';
import { fetchWithTimeout } from '../utils/fetchTimeout.js';

const ALGO = 'aes-256-gcm';
const KEY = crypto.scryptSync(
  config.supabase?.serviceKey || process.env.API_ENCRYPTION_KEY || 'default-key-change-me',
  'salt',
  32
);

/** Global fallback (env / file) for unauthenticated or single-tenant */
let runtimeState = {
  tradingMode: config.binance.tradingMode === 'live' ? 'live' : 'demo',
  demo: {
    apiKey: config.binance.demoApiKey || '',
    apiSecret: config.binance.demoApiSecret || '',
    privateKeyPath: config.binance.demoPrivateKeyPath || '',
  },
  live: {
    apiKey: config.binance.liveApiKey || '',
    apiSecret: config.binance.liveApiSecret || '',
    privateKeyPath: config.binance.livePrivateKeyPath || '',
  },
  updatedAt: null,
};

/** Per-user credentials loaded from Supabase */
const userState = new Map();

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(payload) {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

export function isDemoMode(mode = runtimeState.tradingMode) {
  return mode !== 'live';
}

function emptyPair() {
  return { apiKey: '', apiSecret: '', privateKeyPath: '' };
}

function getStateForUser(userId) {
  if (!userId) return runtimeState;
  if (!userState.has(userId)) {
    userState.set(userId, {
      tradingMode: 'demo',
      demo: emptyPair(),
      live: emptyPair(),
      updatedAt: null,
      loaded: false,
    });
  }
  return userState.get(userId);
}

function getPairForState(state, mode) {
  const key = mode === 'live' ? 'live' : 'demo';
  const pair = state[key];
  const hasSecret = Boolean(pair?.apiSecret);
  const hasPrivateKey = Boolean(pair?.privateKey)
    || (pair?.privateKeyPath && fs.existsSync(pair.privateKeyPath));
  if (pair?.apiKey && (hasSecret || hasPrivateKey)) {
    return {
      apiKey: pair.apiKey,
      apiSecret: pair.apiSecret,
      privateKeyPath: pair.privateKeyPath,
      privateKey: pair.privateKey,
      testnet: key === 'demo',
      mode: key,
    };
  }
  return null;
}

export function getTradingMode(userId = null) {
  return getStateForUser(userId).tradingMode;
}

export function setTradingMode(mode, userId = null) {
  const next = mode === 'live' ? 'live' : 'demo';
  const state = getStateForUser(userId);
  state.tradingMode = next;
  if (!userId) {
    applyActiveCredentialsToConfig();
    persistRuntimeState();
  }
  return next;
}

function persistRuntimeState() {
  try {
    saveStoredCredentials(runtimeState);
  } catch (err) {
    console.warn('[UserBinance] Failed to persist credentials:', err.message);
  }
}

export function applyActiveCredentialsToConfig() {
  const creds = getPairForState(runtimeState, runtimeState.tradingMode);
  const demo = isDemoMode(runtimeState.tradingMode);
  config.binance.tradingMode = runtimeState.tradingMode;
  config.binance.demo = demo;
  config.binance.testnet = demo;
  config.binance.restUrl = demo ? 'https://demo-fapi.binance.com' : 'https://fapi.binance.com';
  config.binance.wsUrl = demo ? 'wss://fstream.binancefuture.com' : 'wss://fstream.binance.com';
  if (creds) {
    config.binance.apiKey = creds.apiKey;
    config.binance.apiSecret = creds.apiSecret;
    config.binance.privateKeyPath = creds.privateKeyPath || '';
    config.binance.signatureType = creds.privateKeyPath || creds.privateKey ? 'rsa' : config.binance.signatureType;
  }
}

export function setRuntimeApiKeys(apiKey, apiSecret, mode = 'demo', userId = null) {
  const key = mode === 'live' ? 'live' : 'demo';
  const state = getStateForUser(userId);
  state[key] = { ...state[key], apiKey, apiSecret };
  state.updatedAt = new Date().toISOString();
  if (!userId) {
    if (runtimeState.tradingMode === key) applyActiveCredentialsToConfig();
    persistRuntimeState();
  }
  return state[key];
}

export async function loadUserCredentials(userId) {
  const db = getSupabase();
  const state = getStateForUser(userId);
  if (!db || !userId) return state;

  const [{ data: rows }, { data: settings }] = await Promise.all([
    db.from('user_api_keys').select('*').eq('user_id', userId).eq('exchange', 'binance').eq('is_active', true),
    db.from('user_trading_settings').select('*').eq('user_id', userId).maybeSingle(),
  ]);

  state.demo = emptyPair();
  state.live = emptyPair();

  for (const row of rows || []) {
    const mode = row.account_mode || (row.testnet ? 'demo' : 'live');
    if (mode === 'demo' || mode === 'live') {
      state[mode] = {
        apiKey: decrypt(row.api_key),
        apiSecret: decrypt(row.api_secret),
      };
      if (row.updated_at && (!state.updatedAt || row.updated_at > state.updatedAt)) {
        state.updatedAt = row.updated_at;
      }
    }
  }

  if (settings?.trading_mode) {
    state.tradingMode = settings.trading_mode;
  }
  state.loaded = true;
  userState.set(userId, state);
  return state;
}

export async function saveUserApiKeys(userId, apiKey, apiSecret, accountMode = 'demo') {
  const db = getSupabase();
  if (!db) throw new Error('Database not configured');

  const row = {
    user_id: userId,
    exchange: 'binance',
    account_mode: accountMode,
    api_key: encrypt(apiKey),
    api_secret: encrypt(apiSecret),
    testnet: accountMode === 'demo',
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('user_api_keys')
    .upsert(row, { onConflict: 'user_id,exchange,account_mode' })
    .select()
    .single();

  if (error) throw new Error(error.message);

  setRuntimeApiKeys(apiKey, apiSecret, accountMode, userId);
  const state = getStateForUser(userId);
  state.updatedAt = data.updated_at;
  return { saved: true, accountMode, updatedAt: data.updated_at };
}

export async function saveUserTradingMode(userId, mode) {
  const db = getSupabase();
  if (!db) throw new Error('Database not configured');

  const { error } = await db.from('user_trading_settings').upsert({
    user_id: userId,
    trading_mode: mode,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  setTradingMode(mode, userId);
}

export async function getActiveApiKeys(userId = null) {
  if (userId) {
    const state = getStateForUser(userId);
    if (!state.loaded) await loadUserCredentials(userId);
    const runtime = getPairForState(state, state.tradingMode);
    if (runtime) return { ...runtime, source: 'user' };
    return null;
  }
  const runtime = getPairForState(runtimeState, runtimeState.tradingMode);
  if (runtime) return { ...runtime, source: 'runtime' };
  return null;
}

export async function hasApiKeysConfigured(userId = null) {
  const state = userId ? getStateForUser(userId) : runtimeState;
  if (userId && !state.loaded) await loadUserCredentials(userId);

  const mode = state.tradingMode;
  const demoOk = Boolean(state.demo?.apiKey && (state.demo?.apiSecret || state.demo?.privateKeyPath || state.demo?.privateKey));
  const liveOk = Boolean(state.live?.apiKey && (state.live?.apiSecret || state.live?.privateKeyPath || state.live?.privateKey));
  const activeOk = mode === 'live' ? liveOk : demoOk;

  const fileMeta = !userId ? loadStoredCredentials() : null;

  return {
    configured: activeOk,
    source: userId ? (activeOk ? 'database' : 'none') : (activeOk ? 'runtime' : 'none'),
    tradingMode: mode,
    testnet: isDemoMode(mode),
    demoConfigured: demoOk,
    liveConfigured: liveOk,
    restUrl: isDemoMode(mode) ? 'https://demo-fapi.binance.com' : 'https://fapi.binance.com',
    updatedAt: state.updatedAt || fileMeta?.updatedAt || null,
    demoUpdatedAt: demoOk ? state.updatedAt : null,
    liveUpdatedAt: liveOk ? state.updatedAt : null,
  };
}

async function signedRequest(credentials, method, endpoint, params = {}) {
  const restUrl = credentials.testnet
    ? 'https://demo-fapi.binance.com'
    : 'https://fapi.binance.com';

  const url = new URL(`${restUrl}${endpoint}`);
  const searchParams = new URLSearchParams(params);
  const timestamp = await ensureBinanceTime(restUrl);
  searchParams.set('timestamp', timestamp.toString());
  searchParams.set('recvWindow', '10000');
  const payload = searchParams.toString();
  const keyPath = credentials.privateKeyPath;
  const privateKey = credentials.privateKey
    || (keyPath && fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : '');
  const signature = privateKey
    ? crypto.createSign('RSA-SHA256').update(payload).sign(privateKey, 'base64')
    : crypto.createHmac('sha256', credentials.apiSecret).update(payload).digest('hex');
  searchParams.set('signature', signature);
  url.search = searchParams.toString();

  const res = await fetchWithTimeout(url.toString(), {
    method,
    headers: { 'X-MBX-APIKEY': credentials.apiKey },
  }, 15000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.msg || `Binance error ${res.status}`);
  return data;
}

export async function testUserConnection(credentials) {
  const balances = await signedRequest(credentials, 'GET', '/fapi/v2/balance');
  const usdt = balances.find((b) => b.asset === 'USDT');
  return {
    ok: true,
    balance: parseFloat(usdt?.availableBalance || 0),
    total: parseFloat(usdt?.balance || 0),
    testnet: credentials.testnet,
    mode: credentials.testnet ? 'demo' : 'live',
  };
}

export async function getBalanceForUser(userId = null) {
  if (isExchangeUnreachable()) {
    return getUsdtBalance();
  }
  const creds = await getActiveApiKeys(userId);
  if (!creds) {
    return getUsdtBalance();
  }
  try {
    const result = await testUserConnection(creds);
    return {
      total: result.total,
      available: result.balance,
      tradingMode: creds.mode,
      source: 'user_keys',
    };
  } catch (err) {
    const fallback = await getUsdtBalance();
    return {
      ...fallback,
      tradingMode: creds.mode,
      error: err.message,
    };
  }
}

export async function setLeverageWithCredentials(credentials, symbol, leverage) {
  return signedRequest(credentials, 'POST', '/fapi/v1/leverage', { symbol, leverage });
}

export async function executeWithCredentials(credentials, tradeParams) {
  const { symbol, side, quantity, stopLoss, leverage = 50, skipLeverageSet = false } = tradeParams;

  const usedLeverage = skipLeverageSet
    ? leverage
    : await setLeverageWithFallback(symbol, leverage, (sym, lev) => setLeverageWithCredentials(credentials, sym, lev));

  const rules = await getSymbolRules(symbol);
  const markPrice = await getMarkPrice(symbol);
  let orderQty = await capQtyToPositionLimit(symbol, quantity, markPrice, usedLeverage);
  let currentLeverage = usedLeverage;
  const ladder = [currentLeverage, ...LEVERAGE_LADDER.filter((l) => l !== currentLeverage)];
  let order = null;
  let lastError = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      order = await signedRequest(credentials, 'POST', '/fapi/v1/order', {
        symbol,
        side,
        type: 'MARKET',
        quantity: orderQty.toString(),
      });
      break;
    } catch (err) {
      lastError = err;
      if (!isPositionLimitError(err)) throw err;
      const reduced = roundToStep(orderQty * 0.8, rules.stepSize);
      if (reduced >= rules.minQty && reduced < orderQty) {
        orderQty = reduced;
        continue;
      }
      const nextLev = ladder.find((l) => l < currentLeverage);
      if (!nextLev) break;
      await setLeverageWithCredentials(credentials, symbol, nextLev);
      currentLeverage = nextLev;
      orderQty = await capQtyToPositionLimit(symbol, quantity, markPrice, nextLev);
      continue;
    }
  }
  if (!order) throw lastError || new Error(`Exceeded the maximum allowable position at current leverage for ${symbol}`);

  await new Promise((r) => setTimeout(r, 600));

  const slSide = side === 'BUY' ? 'SELL' : 'BUY';
  let slOrder = null;
  try {
    slOrder = await placeAlgoOrderWithCredentials(credentials, {
      symbol,
      side: slSide,
      type: 'STOP_MARKET',
      triggerPrice: stopLoss,
      closePosition: true,
    });
  } catch (err) {
    console.error('[UserBinance] SL order failed:', err.message);
  }

  return { order, slOrder, tp1Order: null, tp2Order: null, leverage: currentLeverage, qty: orderQty };
}

export async function placeMarketOrderWithCredentials(credentials, { symbol, side, quantity, reduceOnly = false }) {
  const params = {
    symbol,
    side,
    type: 'MARKET',
    quantity: quantity.toString(),
  };
  if (reduceOnly) params.reduceOnly = 'true';
  return signedRequest(credentials, 'POST', '/fapi/v1/order', params);
}

export async function placeStopMarketOrderWithCredentials(credentials, { symbol, side, stopPrice, quantity, closePosition = false }) {
  const qty = quantity ? await formatAlgoQuantity(symbol, quantity) : null;
  return placeAlgoOrderWithCredentials(credentials, {
    symbol,
    side,
    type: 'STOP_MARKET',
    triggerPrice: stopPrice,
    closePosition: closePosition || !qty,
    quantity: qty,
    reduceOnly: Boolean(qty),
  });
}

export async function placeTakeProfitOrderWithCredentials(credentials, { symbol, side, stopPrice, quantity }) {
  return placeAlgoOrderWithCredentials(credentials, {
    symbol,
    side,
    type: 'TAKE_PROFIT_MARKET',
    triggerPrice: stopPrice,
    quantity: await formatAlgoQuantity(symbol, quantity),
    reduceOnly: true,
  });
}

export async function cancelAllOrdersWithCredentials(credentials, symbol) {
  const regular = await signedRequest(credentials, 'DELETE', '/fapi/v1/allOpenOrders', { symbol }).catch((err) => ({ error: err.message }));
  const openAlgo = await getOpenAlgoOrdersWithCredentials(credentials, symbol).catch((err) => ({ error: err.message }));
  const algo = Array.isArray(openAlgo)
    ? await Promise.all(openAlgo.map((order) => cancelAlgoOrderWithCredentials(credentials, order.algoId).catch((err) => ({
      algoId: order.algoId,
      error: err.message,
    }))))
    : openAlgo;
  return { regular, algo };
}

export async function getPositionRiskWithCredentials(credentials, symbol = null) {
  const params = symbol ? { symbol } : {};
  return signedRequest(credentials, 'GET', '/fapi/v2/positionRisk', params);
}

export async function getOpenAlgoOrdersWithCredentials(credentials, symbol = null) {
  const params = symbol ? { symbol } : {};
  return signedRequest(credentials, 'GET', '/fapi/v1/openAlgoOrders', params);
}

export async function cancelAlgoOrderWithCredentials(credentials, algoId) {
  return signedRequest(credentials, 'DELETE', '/fapi/v1/algoOrder', { algoId });
}

async function formatAlgoQuantity(symbol, qty) {
  const rules = await getSymbolRules(symbol);
  return roundToStep(qty, rules.stepSize);
}

async function placeAlgoOrderWithCredentials(credentials, { symbol, side, type, triggerPrice, quantity = null, closePosition = false, reduceOnly = false }) {
  const rules = await getSymbolRules(symbol);
  const params = {
    algoType: 'CONDITIONAL',
    symbol,
    side,
    type,
    triggerPrice: roundPriceToTick(triggerPrice, rules.tickSize).toString(),
    workingType: 'MARK_PRICE',
  };

  if (closePosition) {
    params.closePosition = 'true';
  } else {
    params.quantity = quantity.toString();
    if (reduceOnly) params.reduceOnly = 'true';
  }

  return signedRequest(credentials, 'POST', '/fapi/v1/algoOrder', params);
}

function mergeStoredCredentials() {
  const stored = loadStoredCredentials();
  if (!stored) return;

  if (stored.demo?.apiKey && stored.demo?.apiSecret) runtimeState.demo = stored.demo;
  if (stored.live?.apiKey && stored.live?.apiSecret) runtimeState.live = stored.live;
  if (stored.tradingMode) runtimeState.tradingMode = stored.tradingMode;
  if (stored.updatedAt) runtimeState.updatedAt = stored.updatedAt;
}

export async function initUserBinance() {
  mergeStoredCredentials();
  applyActiveCredentialsToConfig();
  if (config.binance.apiKey && config.binance.apiSecret) {
    try {
      const { syncBinanceTime } = await import('./binanceTime.js');
      await syncBinanceTime(config.binance.restUrl);
    } catch (err) {
      console.warn('[UserBinance] Time sync failed:', err.message);
    }
  }
}

mergeStoredCredentials();
applyActiveCredentialsToConfig();
