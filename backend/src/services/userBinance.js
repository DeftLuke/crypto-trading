import crypto from 'crypto';
import { config } from '../config/index.js';
import { getSupabase } from './supabase.js';

const ALGO = 'aes-256-gcm';
const KEY = crypto.scryptSync(
  config.supabase?.serviceKey || process.env.API_ENCRYPTION_KEY || 'default-key-change-me',
  'salt',
  32
);

/** Runtime API keys (dashboard save without auth) */
let runtimeCredentials = null;

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

export async function saveUserApiKeys(userId, apiKey, apiSecret, testnet = true) {
  const db = getSupabase();
  if (!db) throw new Error('Database not configured');

  const row = {
    user_id: userId,
    exchange: 'binance',
    api_key: encrypt(apiKey),
    api_secret: encrypt(apiSecret),
    testnet,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('user_api_keys')
    .upsert(row, { onConflict: 'user_id,exchange' })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { saved: true, testnet: data.testnet };
}

export async function getUserApiKeys(userId) {
  const db = getSupabase();
  if (!db) return null;

  const { data } = await db
    .from('user_api_keys')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (!data) return null;

  return {
    apiKey: decrypt(data.api_key),
    apiSecret: decrypt(data.api_secret),
    testnet: data.testnet,
  };
}

export async function getActiveApiKeys() {
  if (runtimeCredentials) return { ...runtimeCredentials, source: 'runtime' };
  if (config.binance.apiKey && config.binance.apiSecret) {
    return {
      apiKey: config.binance.apiKey,
      apiSecret: config.binance.apiSecret,
      testnet: config.binance.testnet,
      source: 'env',
    };
  }
  return null;
}

export function setRuntimeApiKeys(apiKey, apiSecret, testnet = true) {
  runtimeCredentials = { apiKey, apiSecret, testnet };
  return runtimeCredentials;
}

export async function hasApiKeysConfigured() {
  if (runtimeCredentials) return { configured: true, source: 'runtime', testnet: runtimeCredentials.testnet };
  const env = config.binance.apiKey && config.binance.apiSecret;
  if (env) return { configured: true, source: 'env', testnet: config.binance.testnet };

  const db = getSupabase();
  if (db) {
    const { count } = await db
      .from('user_api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);
    if (count > 0) return { configured: true, source: 'database' };
  }
  return { configured: false };
}

async function signedRequest(credentials, method, endpoint, params = {}) {
  const restUrl = credentials.testnet
    ? 'https://testnet.binancefuture.com'
    : 'https://fapi.binance.com';

  const url = new URL(`${restUrl}${endpoint}`);
  const searchParams = new URLSearchParams(params);
  searchParams.set('timestamp', Date.now().toString());
  const signature = crypto
    .createHmac('sha256', credentials.apiSecret)
    .update(searchParams.toString())
    .digest('hex');
  searchParams.set('signature', signature);
  url.search = searchParams.toString();

  const res = await fetch(url.toString(), {
    method,
    headers: { 'X-MBX-APIKEY': credentials.apiKey },
  });
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
    testnet: credentials.testnet,
  };
}

export async function executeWithCredentials(credentials, tradeParams) {
  const { symbol, side, quantity, stopLoss, leverage = 5 } = tradeParams;

  await signedRequest(credentials, 'POST', '/fapi/v1/leverage', { symbol, leverage });

  const order = await signedRequest(credentials, 'POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity: quantity.toString(),
  });

  const slSide = side === 'BUY' ? 'SELL' : 'BUY';
  let slOrder = null;
  try {
    slOrder = await signedRequest(credentials, 'POST', '/fapi/v1/order', {
      symbol,
      side: slSide,
      type: 'STOP_MARKET',
      stopPrice: stopLoss.toString(),
      quantity: quantity.toString(),
      reduceOnly: 'true',
      workingType: 'MARK_PRICE',
    });
  } catch (err) {
    console.error('[UserBinance] SL order failed:', err.message);
  }

  return { order, slOrder };
}
