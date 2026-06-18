import { config } from '../config/index.js';
import {
  approveLocalTrade,
  getLocalControlDashboard,
  getLocalControlSettings,
  getLatestPendingSignal,
  processLocalControlSignal,
  rejectLocalApproval,
  sendDemoSignalToTelegram,
  startAllLocalServices,
  updateLocalControlSettings,
  listPendingApprovals,
} from './controlCenter.js';

const baseUrl = () => (config.researchApiUrl || '').replace(/\/$/, '');

export function isResearchConfigured() {
  return true;
}

async function request(method, path, body) {
  const base = baseUrl();
  if (!base) throw new Error('Research API not configured (set RESEARCH_API_URL)');

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const opts = {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  };
  if (body != null) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const detail = data.detail || data.error || text || res.statusText;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data;
}

async function withFallback(path, remoteFn, localFn) {
  if (!baseUrl()) return localFn();
  try {
    return await remoteFn();
  } catch (err) {
    console.warn(`[ResearchAPI] ${path} unavailable (${err.message}) — using local control center`);
    return localFn();
  }
}

export async function getControlSettings() {
  return withFallback('/control/settings', () => request('GET', '/control/settings'), getLocalControlSettings);
}

export async function updateControlSettings(updates, actor = 'tradegpt') {
  return withFallback('/control/settings', () => request('POST', '/control/settings', { ...updates, actor }), () => updateLocalControlSettings(updates, actor));
}

export async function postControlSignal(signal) {
  return withFallback('/control/signal', () => request('POST', '/control/signal', {
    symbol: signal.symbol,
    direction: signal.direction,
    confidence: signal.confidence ?? 0,
    entry: signal.entry ?? signal.entry_price,
    sl: signal.sl ?? signal.stop_loss,
    tp1: signal.tp1 ?? signal.take_profit,
    tp2: signal.tp2,
    tp3: signal.tp3,
    strategy_name: signal.strategy_name || signal.strategy || 'smc-mtf',
    signal_id: signal.id || signal.signal_id,
    source: signal.source || 'scanner',
  }), () => processLocalControlSignal(signal, signal.source || 'scanner'));
}

export async function getControlDashboard() {
  return withFallback('/control/dashboard', () => request('GET', '/control/dashboard'), getLocalControlDashboard);
}

export async function startAllControlServices() {
  return withFallback('/control/services/start-all', () => request('POST', '/control/services/start-all', { actor: 'tradegpt' }), startAllLocalServices);
}

export async function approveControlTrade(approvalId, passcode, positionSizeUsdt = 0) {
  return withFallback('/control/approve', () => request('POST', '/control/approve', {
    approval_id: approvalId,
    passcode,
    position_size_usdt: positionSizeUsdt,
  }), () => approveLocalTrade(approvalId, passcode, positionSizeUsdt));
}

export async function rejectControlApproval(approvalId) {
  return withFallback('/control/reject', () => request('POST', '/control/reject', { approval_id: approvalId }), () => rejectLocalApproval(approvalId));
}

export async function triggerDemoSignal(symbol = 'BTCUSDT', options = {}) {
  return sendDemoSignalToTelegram(symbol, options);
}

export async function getLatestSignal() {
  return getLatestPendingSignal();
}

export async function getPendingApprovals() {
  return listPendingApprovals();
}

export async function proxyResearch(method, path, body) {
  return withFallback(path, () => request(method, path, body), async () => {
    if (path.startsWith('/control/dashboard')) return getLocalControlDashboard();
    if (path.startsWith('/control/settings')) {
      return method === 'GET' ? getLocalControlSettings() : updateLocalControlSettings(body || {});
    }
    throw new Error(`Local control center does not proxy ${method} ${path}`);
  });
}
