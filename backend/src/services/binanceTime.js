/** Keep signed Binance requests in sync with exchange server time */

import { fetchWithTimeout } from '../utils/fetchTimeout.js';

let timeOffsetMs = 0;
let lastSyncAt = 0;

export function getBinanceTimestamp() {
  return Date.now() + timeOffsetMs;
}

export function isTimeSyncStale(maxAgeMs = 5 * 60 * 1000) {
  return !lastSyncAt || Date.now() - lastSyncAt > maxAgeMs;
}

export async function syncBinanceTime(restUrl) {
  const base = restUrl.replace(/\/$/, '');

  const parseServerTime = async (url) => {
    const res = await fetchWithTimeout(url, {}, 8000);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    return data.time || data.serverTime || null;
  };

  let serverTime = null;
  try {
    serverTime = await parseServerTime(`${base}/fapi/v2/ticker/price?symbol=BTCUSDT`);
  } catch {
    /* demo v1 /time returns plain "ok" */
  }
  if (!serverTime) {
    try {
      serverTime = await parseServerTime(`${base}/fapi/v1/time`);
    } catch { /* ignore */ }
  }
  if (!serverTime) {
    serverTime = await parseServerTime(`${base}/fapi/v1/exchangeInfo`);
  }
  if (!serverTime) {
    throw new Error('Failed to sync Binance server time');
  }

  timeOffsetMs = serverTime - Date.now();
  lastSyncAt = Date.now();
  return timeOffsetMs;
}

export async function ensureBinanceTime(restUrl) {
  if (isTimeSyncStale()) {
    try {
      await syncBinanceTime(restUrl);
    } catch {
      /* use local clock if exchange time sync fails */
    }
  }
  return getBinanceTimestamp();
}
