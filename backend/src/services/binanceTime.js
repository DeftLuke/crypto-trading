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
  const res = await fetchWithTimeout(`${base}/fapi/v1/time`, {}, 8000);
  const data = await res.json();
  if (!res.ok || !data.serverTime) {
    throw new Error(data.msg || 'Failed to sync Binance server time');
  }
  timeOffsetMs = data.serverTime - Date.now();
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
