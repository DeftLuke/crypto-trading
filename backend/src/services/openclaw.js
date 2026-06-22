/**
 * OpenClaw Gateway — OpenAI-compatible chat for strategy assistant (text only).
 * Requires gateway.http.endpoints.chatCompletions.enabled=true in ~/.openclaw/openclaw.json
 */
import { config } from '../config/index.js';

function baseUrl() {
  return (config.openclaw?.url || '').replace(/\/$/, '');
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = config.openclaw?.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function isOpenClawConfigured() {
  return Boolean(baseUrl() && config.openclaw?.token);
}

export async function checkOpenClawHealth() {
  if (!isOpenClawConfigured()) {
    return { ok: false, error: 'OPENCLAW_GATEWAY_URL or OPENCLAW_GATEWAY_TOKEN not set' };
  }
  try {
    const res = await fetch(`${baseUrl()}/health`, { signal: AbortSignal.timeout(5000) });
    const health = res.ok ? await res.json().catch(() => ({})) : {};
    const modelsRes = await fetch(`${baseUrl()}/v1/models`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(8000),
    });
    if (!modelsRes.ok) {
      return {
        ok: false,
        url: baseUrl(),
        gateway: health,
        error: `Chat API not enabled (HTTP ${modelsRes.status}). Set gateway.http.endpoints.chatCompletions.enabled=true`,
      };
    }
    const models = await modelsRes.json();
    const ids = (models.data || []).map((m) => m.id);
    return {
      ok: true,
      url: baseUrl(),
      gateway: health,
      models: ids,
      default_model: config.openclaw?.model || 'openclaw/default',
    };
  } catch (err) {
    return { ok: false, url: baseUrl(), error: err.message };
  }
}

/**
 * @param {{ system?: string, prompt: string, user?: string, history?: Array<{role:string,content:string}> }} opts
 */
export async function openclawChat({ system, prompt, user, history = [], maxTokens = 900 }) {
  if (!isOpenClawConfigured()) {
    throw new Error('OpenClaw not configured');
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  for (const m of history.slice(-8)) {
    if (m?.role && m?.content) messages.push({ role: m.role, content: String(m.content).slice(0, 4000) });
  }
  messages.push({ role: 'user', content: prompt });

  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: config.openclaw.model || 'openclaw/default',
      user: user || undefined,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      stream: false,
    }),
    signal: AbortSignal.timeout(180000),
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const detail = data?.error?.message || data?.error || text || res.statusText;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  const answer = data.choices?.[0]?.message?.content?.trim() || '';
  if (!answer) throw new Error('OpenClaw returned empty response');

  return {
    answer,
    model: data.model || config.openclaw.model,
    source: 'openclaw',
    usage: data.usage,
  };
}
