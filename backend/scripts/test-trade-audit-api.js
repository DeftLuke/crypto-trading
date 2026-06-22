#!/usr/bin/env node
/** Smoke test trade audit APIs (requires migration 024 + backend). */
const BASE = (process.env.TRADING_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

console.log('\n=== Trade Execution Audit API ===\n');

for (const path of ['/trades/home-dashboard', '/trades/today', '/trades/open/audit']) {
  try {
    const { ok, status, data } = await get(path);
    console.log(ok ? '✓' : '✗', path, status, typeof data === 'object' ? JSON.stringify(data).slice(0, 120) : data);
  } catch (err) {
    console.log('✗', path, err.message);
  }
}

console.log('\nDone.\n');
