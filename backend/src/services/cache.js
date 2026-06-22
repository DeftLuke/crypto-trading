/**
 * L1 memory + optional Redis L2 cache with stale-while-revalidate.
 */
import { config } from '../config/index.js';

const PREFIX = 'tgpt:';
const memory = new Map();

let redisClient = null;
let redisInit = null;

async function getRedis() {
  if (redisClient === false) return null;
  if (redisClient) return redisClient;
  if (redisInit) return redisInit;

  const url = process.env.REDIS_URL || config.redis?.url || '';
  if (!url) {
    redisClient = false;
    return null;
  }

  redisInit = (async () => {
    try {
      const { createClient } = await import('redis');
      const client = createClient({ url });
      client.on('error', (err) => {
        console.warn('[Cache] Redis error:', err.message);
      });
      await client.connect();
      redisClient = client;
      console.log('[Cache] Redis connected');
      return client;
    } catch (err) {
      console.warn('[Cache] Redis unavailable — memory only:', err.message);
      redisClient = false;
      return null;
    } finally {
      redisInit = null;
    }
  })();

  return redisInit;
}

function memGet(key) {
  return memory.get(key) || null;
}

function memSet(key, entry) {
  memory.set(key, entry);
}

export async function cacheInvalidatePrefix(prefix) {
  for (const k of [...memory.keys()]) {
    if (k.startsWith(prefix)) memory.delete(k);
  }
  try {
    const r = await getRedis();
    if (!r) return;
    const keys = [];
    for await (const key of r.scanIterator({ MATCH: `${PREFIX}${prefix}*`, COUNT: 100 })) {
      keys.push(key);
    }
    if (keys.length) await r.del(keys);
  } catch {
    /* ignore */
  }
}

export async function cacheInvalidate(key) {
  memory.delete(key);
  try {
    const r = await getRedis();
    if (r) await r.del(`${PREFIX}${key}`);
  } catch {
    /* ignore */
  }
}

async function redisGet(key) {
  const r = await getRedis();
  if (!r) return null;
  const raw = await r.get(`${PREFIX}${key}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function redisSet(key, data, ttlSec) {
  const r = await getRedis();
  if (!r) return;
  await r.setEx(`${PREFIX}${key}`, Math.max(1, ttlSec), JSON.stringify(data));
}

/**
 * @param {string} key
 * @param {() => Promise<any>} fn
 * @param {{ ttlSec?: number, staleSec?: number }} opts
 * @returns {Promise<{ data: any, cache: 'hit'|'stale'|'miss'|'redis' }>}
 */
export async function cacheGetOrSet(key, fn, opts = {}) {
  const ttlSec = opts.ttlSec ?? 15;
  const staleSec = opts.staleSec ?? 60;
  const now = Date.now();

  const entry = memGet(key);
  if (entry?.data != null) {
    if (entry.freshUntil > now) {
      return { data: entry.data, cache: 'hit' };
    }
    if (entry.staleUntil > now) {
      if (!entry.refreshing) {
        entry.refreshing = true;
        fn()
          .then(async (data) => {
            const next = {
              data,
              freshUntil: Date.now() + ttlSec * 1000,
              staleUntil: Date.now() + staleSec * 1000,
              refreshing: false,
            };
            memSet(key, next);
            await redisSet(key, data, ttlSec).catch(() => {});
          })
          .catch(() => {
            entry.refreshing = false;
          });
      }
      return { data: entry.data, cache: 'stale' };
    }
  }

  const fromRedis = await redisGet(key);
  if (fromRedis != null) {
    memSet(key, {
      data: fromRedis,
      freshUntil: now + ttlSec * 1000,
      staleUntil: now + staleSec * 1000,
      refreshing: false,
    });
    return { data: fromRedis, cache: 'redis' };
  }

  const data = await fn();
  memSet(key, {
    data,
    freshUntil: now + ttlSec * 1000,
    staleUntil: now + staleSec * 1000,
    refreshing: false,
  });
  await redisSet(key, data, ttlSec).catch(() => {});
  return { data, cache: 'miss' };
}

export async function warmDashboardCaches() {
  try {
    const { getHomeDashboardPayload } = await import('./tradeAuditAnalytics.js');
    const { getLocalControlServicesLite, getLocalControlSettings } = await import('./controlCenter.js');
    const { getSignalEngineStatus } = await import('./signalEngineSelector.js');
    const tz = 0;
    const day = new Date().toISOString().slice(0, 10);
    await Promise.all([
      cacheGetOrSet(`dashboard:snapshot:${day}:${tz}`, async () => ({
        trade: await getHomeDashboardPayload({ day, tz, dbOnly: true }),
        settings: await getLocalControlSettings(),
        signal_engine: await getSignalEngineStatus(),
        control: await getLocalControlServicesLite(),
        generated_at: new Date().toISOString(),
      }), { ttlSec: 20, staleSec: 120 }),
    ]);
  } catch (err) {
    console.warn('[Cache] Warmup skipped:', err.message);
  }
}

export function getCacheStats() {
  return {
    memory_keys: memory.size,
    redis: redisClient && redisClient !== false ? 'connected' : 'memory_only',
  };
}
