const API = import.meta.env.VITE_API_URL || '';
const RESEARCH = import.meta.env.VITE_RESEARCH_API_URL || `${API}/api/research`;

function baseUrl() {
  return RESEARCH.replace(/\/$/, '');
}

async function request(method, path, body) {
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const opts = { method, headers: { Accept: 'application/json' } };
  if (body != null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || res.statusText);
  return data;
}

async function requestTrading(path) {
  const api = (API || 'https://api.deftluke.online').replace(/\/$/, '');
  const res = await fetch(`${api}/api${path.startsWith('/') ? path : `/${path}`}`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function fetchControlDashboard() {
  try {
    return await request('GET', '/control/dashboard');
  } catch {
    return requestTrading('/control/dashboard');
  }
}

export async function fetchControlSettings() {
  return request('GET', '/control/settings');
}

export async function updateControlSettings(updates) {
  return request('POST', '/control/settings', { ...updates, actor: 'dashboard' });
}
