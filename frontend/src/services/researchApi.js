import { fetchWithTimeout } from '../lib/fetchTimeout';

const API = import.meta.env.VITE_API_URL || '';
const RESEARCH = import.meta.env.VITE_RESEARCH_API_URL || `${API}/api/research`;
const DASHBOARD_TIMEOUT_MS = 8000;
const SETTINGS_TIMEOUT_MS = 5000;

function baseUrl() {
  return RESEARCH.replace(/\/$/, '');
}

async function request(method, path, body, timeoutMs = SETTINGS_TIMEOUT_MS) {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const opts = { method, headers: { Accept: 'application/json' } };
  if (body != null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetchWithTimeout(url, opts, timeoutMs);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || res.statusText);
  return data;
}

async function requestTrading(path, timeoutMs = DASHBOARD_TIMEOUT_MS) {
  const api = (API || 'https://api.deftluke.online').replace(/\/$/, '');
  const res = await fetchWithTimeout(
    `${api}/api${path.startsWith('/') ? path : `/${path}`}`,
    { headers: { Accept: 'application/json' } },
    timeoutMs,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function fetchControlDashboard() {
  try {
    return await request('GET', '/control/dashboard', undefined, DASHBOARD_TIMEOUT_MS);
  } catch {
    return requestTrading('/control/dashboard', DASHBOARD_TIMEOUT_MS);
  }
}

export async function fetchControlSettings() {
  return request('GET', '/control/settings');
}

export async function updateControlSettings(updates) {
  return request('POST', '/control/settings', { ...updates, actor: 'dashboard' });
}
