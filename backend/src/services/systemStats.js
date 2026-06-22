import fs from 'fs';
import os from 'os';
import v8 from 'v8';

function readCgroupMemoryLimitBytes() {
  const paths = [
    '/sys/fs/cgroup/memory.max',
    '/sys/fs/cgroup/memory/memory.limit_in_bytes',
  ];
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (!raw || raw === 'max') return null;
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) return n;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function readCgroupMemoryUsedBytes() {
  const paths = [
    '/sys/fs/cgroup/memory.current',
    '/sys/fs/cgroup/memory/memory.usage_in_bytes',
  ];
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const n = parseInt(fs.readFileSync(p, 'utf8').trim(), 10);
      if (Number.isFinite(n) && n >= 0) return n;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Configured Node heap ceiling (default 16 GB on production). */
export function getNodeHeapLimitMb() {
  const opt = process.env.NODE_OPTIONS || '';
  const match = opt.match(/--max-old-space-size=(\d+)/);
  if (match) return parseInt(match[1], 10);
  return Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
}

/** Host / container memory and CPU snapshot for control dashboard. */
export function getSystemResourceSnapshot() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const load = os.loadavg();
  const cpus = os.cpus()?.length || 1;
  const mem = process.memoryUsage();
  const heapLimitMb = getNodeHeapLimitMb();
  const cgroupLimit = readCgroupMemoryLimitBytes();
  const cgroupUsed = readCgroupMemoryUsedBytes();

  return {
    host: os.hostname(),
    platform: os.platform(),
    cpus,
    memory: {
      total_mb: Math.round(totalBytes / 1024 / 1024),
      used_mb: Math.round(usedBytes / 1024 / 1024),
      free_mb: Math.round(freeBytes / 1024 / 1024),
      used_pct: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
    },
    container: cgroupLimit
      ? {
        limit_mb: Math.round(cgroupLimit / 1024 / 1024),
        used_mb: cgroupUsed != null ? Math.round(cgroupUsed / 1024 / 1024) : null,
        unlimited: false,
      }
      : { limit_mb: null, used_mb: null, unlimited: true },
    load_avg: {
      '1m': Math.round(load[0] * 100) / 100,
      '5m': Math.round(load[1] * 100) / 100,
      '15m': Math.round(load[2] * 100) / 100,
    },
    process: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024),
      heap_limit_mb: heapLimitMb,
      uptime_sec: Math.floor(process.uptime()),
    },
  };
}

/** In-process modules share one Node runtime — show full backend RSS, not a fake split. */
export function getInProcessServiceRamMb() {
  return getSystemResourceSnapshot().process.rss_mb;
}

/** CPU % rough estimate from 1m load average vs cores. */
export function estimateCpuPct() {
  const snap = getSystemResourceSnapshot();
  const pct = (snap.load_avg['1m'] / Math.max(snap.cpus, 1)) * 100;
  return Math.min(100, Math.round(pct));
}
