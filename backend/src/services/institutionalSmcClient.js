/**
 * Institutional SMC v2 client — calls research-platform Python engine.
 *
 * CP0: health + spec + analyze stubs.
 * CP6: wired into marketScanner replacing smc-mtf validation path.
 */
import { config } from '../config/index.js';
import { logEvent } from './supabase.js';

const BASE_PATH = '/api/v1/institutional-smc';
const DEFAULT_TIMEOUT_MS = 45_000;

function researchBaseUrl() {
  const url = (config.institutionalSmc?.researchApiUrl || config.researchApiUrl || '').replace(/\/$/, '');
  return url;
}

function isConfigured() {
  return Boolean(researchBaseUrl());
}

async function request(path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const base = researchBaseUrl();
  if (!base) {
    return { ok: false, error: 'RESEARCH_API_URL not configured', offline: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: data.detail || data.error || res.statusText, data };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message, offline: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Engine health — use before enabling live v2 scanning. */
export async function checkInstitutionalSmcHealth() {
  return request(`${BASE_PATH}/health`);
}

/** Full spec: weights, MTF roles, module roadmap. */
export async function getInstitutionalSmcSpec() {
  return request(`${BASE_PATH}/spec`);
}

/** Analyze single symbol — returns TradeSetupResult dict. */
export async function analyzeInstitutionalSetup(symbol, { persist = false } = {}) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return { ok: false, error: 'symbol required' };

  const result = await request(`${BASE_PATH}/analyze`, {
    method: 'POST',
    body: { symbol: sym, persist },
  });

  if (!result.ok && config.institutionalSmc?.rejectOnEngineOffline) {
    await logEvent('warn', 'institutionalSmc', 'Engine offline — setup rejected', {
      symbol: sym,
      error: result.error,
    }).catch(() => {});
  }

  return result;
}

/** Batch analyze for scanner — chunks handled by caller. */
export async function analyzeInstitutionalBatch(symbols, { persist = false } = {}) {
  const list = (symbols || []).map((s) => String(s).toUpperCase()).filter(Boolean);
  if (!list.length) return { ok: false, error: 'symbols required' };

  return request(`${BASE_PATH}/analyze/batch`, {
    method: 'POST',
    body: { symbols: list, persist },
  });
}

/** Whether v2 engine should be used for live scanning (CP6 gate). */
export function isInstitutionalSmcEnabled() {
  return config.institutionalSmc?.enabled === true
    && config.institutionalSmc?.engineVersion === 'v2'
    && isConfigured();
}

export function getInstitutionalSmcConfig() {
  return {
    enabled: isInstitutionalSmcEnabled(),
    configured: isConfigured(),
    ...config.institutionalSmc,
  };
}
