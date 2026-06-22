/**
 * Binance Futures user-data WebSocket — live balance + positions without REST polling.
 * Uses one listenKey (2 REST calls/hour: create + keepalive) + persistent WS.
 */
import WebSocket from 'ws';
import { config } from '../config/index.js';
import { getActiveApiKeys } from './userBinance.js';
import { isExchangeBlocked, noteExchangeRateLimit } from './exchangeRateLimit.js';
import { logEvent } from './supabase.js';
import { dashboardBroadcast } from './wsBroadcast.js';
import { binanceWs } from './binanceWs.js';

const positions = new Map();
let balance = null;
let listenKey = null;
let ws = null;
let keepaliveTimer = null;
let reconnectTimer = null;
let running = false;
let lastEventAt = 0;
let bootstrapAt = 0;
let bootstrapRetryTimer = null;

function scheduleBootstrapRetry() {
  if (bootstrapRetryTimer) return;
  bootstrapRetryTimer = setInterval(async () => {
    if (!running || isUserStreamLive() || isExchangeBlocked()) return;
    const creds = await getActiveApiKeys();
    if (!creds) return;
    await bootstrapFromRest(creds);
  }, 30_000);
}

function restBase(testnet) {
  return testnet ? 'https://demo-fapi.binance.com' : 'https://fapi.binance.com';
}

function wsBase() {
  return config.binance.wsUrl || 'wss://fstream.binance.com';
}

async function createListenKey(credentials) {
  const url = `${restBase(credentials.testnet)}/fapi/v1/listenKey`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': credentials.apiKey },
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* */ }
  if (!res.ok) throw new Error(data.msg || `listenKey failed ${res.status}`);
  return data.listenKey;
}

async function keepaliveListenKey(credentials, key) {
  const url = `${restBase(credentials.testnet)}/fapi/v1/listenKey`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'X-MBX-APIKEY': credentials.apiKey },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.msg || `listenKey keepalive ${res.status}`);
  }
}

function parsePosition(row) {
  const amt = parseFloat(row.pa || row.positionAmt || 0);
  if (!amt) return null;
  const sym = row.s || row.symbol;
  const mark = parseFloat(row.mp || row.markPrice || 0) || binanceWs.getPrice(sym) || 0;
  const entry = parseFloat(row.ep || row.entryPrice || 0);
  const leverage = parseInt(row.l || row.leverage || config.telegram?.defaultLeverage || 50, 10);
  const notional = Math.abs(parseFloat(row.notional || amt * mark || 0));
  return {
    symbol: row.s || row.symbol,
    quantity: Math.abs(amt),
    direction: amt > 0 ? 'LONG' : 'SHORT',
    entry_price: entry,
    current_price: mark,
    unrealized_pnl: parseFloat(row.up || row.unRealizedProfit || 0),
    leverage,
    margin: parseFloat(row.iw || row.isolatedMargin || 0) || (leverage > 0 ? notional / leverage : notional),
    notional,
    liquidation_price: parseFloat(row.liq || row.liquidationPrice || 0),
  };
}

function applyAccountUpdate(msg) {
  const account = msg.a || msg;
  if (account.B) {
    for (const b of account.B) {
      if (b.a === 'USDT') {
        balance = {
          total: parseFloat(b.wb || b.balance || 0),
          available: parseFloat(b.cw || b.availableBalance || b.wb || 0),
          source: 'user_stream',
          tradingMode: config.binance.demo ? 'demo' : 'live',
          updated_at: new Date().toISOString(),
        };
      }
    }
  }
  if (account.P) {
    for (const p of account.P) {
      const sym = p.s || p.symbol;
      if (sym) binanceWs.subscribeMarkPrice(sym, () => {});
      const parsed = parsePosition(p);
      if (parsed && parsed.quantity > 0) {
        positions.set(sym, parsed);
      } else {
        positions.delete(sym);
      }
    }
  }
  lastEventAt = Date.now();
  dashboardBroadcast({
    type: 'account_update',
    positions: getCachedPositions(),
    balance: getCachedBalance(),
  });
}

/** One REST bootstrap when stream starts (then WS maintains state). */
async function bootstrapFromRest(credentials) {
  if (isExchangeBlocked()) return;
  try {
    const { getPositionRiskWithCredentials } = await import('./userBinance.js');
    const rows = await getPositionRiskWithCredentials(credentials);
    positions.clear();
    for (const row of rows || []) {
      const parsed = parsePosition({
        s: row.symbol,
        pa: row.positionAmt,
        ep: row.entryPrice,
        mp: row.markPrice,
        up: row.unRealizedProfit,
        l: row.leverage,
        iw: row.isolatedMargin,
        notional: row.notional,
      });
      if (parsed) positions.set(parsed.symbol, parsed);
    }
    const { testUserConnection } = await import('./userBinance.js');
    const bal = await testUserConnection(credentials);
    balance = {
      total: bal.total,
      available: bal.balance,
      source: 'user_stream_bootstrap',
      tradingMode: bal.mode,
      updated_at: new Date().toISOString(),
    };
    bootstrapAt = Date.now();
    lastEventAt = Date.now();
  } catch (err) {
    noteExchangeRateLimit(err.message);
    await logEvent('warn', 'binanceUserStream', `Bootstrap failed: ${err.message}`);
  }
}

function connectUserStream(credentials, key) {
  if (ws) {
    try { ws.close(); } catch { /* */ }
    ws = null;
  }

  const url = `${wsBase()}/ws/${key}`;
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[UserStream] Connected — live positions + balance');
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.e === 'ACCOUNT_UPDATE') applyAccountUpdate(msg);
      if (msg.e === 'ORDER_TRADE_UPDATE') {
        dashboardBroadcast({ type: 'order_update', event: msg.o });
        import('./tradeFillListener.js').then(({ handleOrderTradeUpdate }) =>
          handleOrderTradeUpdate(msg.o).catch((err) =>
            logEvent('warn', 'tradeFillListener', err.message, { symbol: msg.o?.s }),
          ),
        );
      }
      if (msg.e === 'listenKeyExpired') scheduleReconnect();
    } catch (err) {
      console.warn('[UserStream] Parse error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[UserStream] Disconnected — reconnecting…');
    ws = null;
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.warn('[UserStream] Error:', err.message);
  });
}

function scheduleReconnect() {
  if (!running || reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (running) await startUserStream();
  }, 5000);
}

export function getCachedPositions() {
  return [...positions.values()];
}

export function getCachedBalance() {
  return balance;
}

export function isUserStreamLive(maxAgeMs = 120_000) {
  return lastEventAt > 0 && Date.now() - lastEventAt < maxAgeMs;
}

export function getUserStreamStatus() {
  return {
    running,
    connected: ws?.readyState === WebSocket.OPEN,
    live: isUserStreamLive(),
    last_event_at: lastEventAt ? new Date(lastEventAt).toISOString() : null,
    bootstrap_at: bootstrapAt ? new Date(bootstrapAt).toISOString() : null,
    positions_count: positions.size,
    balance: balance ? { total: balance.total, available: balance.available, source: balance.source } : null,
    listen_key_active: Boolean(listenKey),
  };
}

export async function refreshUserStreamBootstrap() {
  const credentials = await getActiveApiKeys();
  if (!credentials?.apiKey) return { ok: false, reason: 'no_credentials' };
  if (isExchangeBlocked()) return { ok: false, reason: 'rate_limit_cooldown' };
  await bootstrapFromRest(credentials);
  return { ok: true, positions: getCachedPositions().length, balance: getCachedBalance() };
}

export async function startUserStream() {
  const credentials = await getActiveApiKeys();
  if (!credentials?.apiKey) {
    return { ok: false, reason: 'no_credentials' };
  }

  if (running && ws?.readyState === WebSocket.OPEN) {
    if (!isUserStreamLive() && !isExchangeBlocked()) {
      await bootstrapFromRest(credentials);
    }
    return { ok: true, already: true, positions: getCachedPositions().length };
  }

  running = true;

  try {
    if (!listenKey) listenKey = await createListenKey(credentials);
    else await keepaliveListenKey(credentials, listenKey).catch(() => {});

    if (!bootstrapAt || Date.now() - bootstrapAt > 300_000) {
      await bootstrapFromRest(credentials);
    }

    connectUserStream(credentials, listenKey);
    scheduleBootstrapRetry();

    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = setInterval(async () => {
      try {
        const creds = await getActiveApiKeys();
        if (creds && listenKey) await keepaliveListenKey(creds, listenKey);
      } catch (err) {
        console.warn('[UserStream] Keepalive failed:', err.message);
        listenKey = null;
        scheduleReconnect();
      }
    }, 30 * 60 * 1000);

    return { ok: true, positions: getCachedPositions().length };
  } catch (err) {
    noteExchangeRateLimit(err.message);
    await logEvent('warn', 'binanceUserStream', `Start failed: ${err.message}`);
    scheduleReconnect();
    return { ok: false, reason: err.message };
  }
}

export function stopUserStream() {
  running = false;
  if (bootstrapRetryTimer) clearInterval(bootstrapRetryTimer);
  bootstrapRetryTimer = null;
  if (keepaliveTimer) clearInterval(keepaliveTimer);
  keepaliveTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    try { ws.close(); } catch { /* */ }
    ws = null;
  }
  listenKey = null;
}
