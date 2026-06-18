import { config } from '../config/index.js';

export function n8nHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (config.n8n.apiKey) {
    headers['X-N8N-API-KEY'] = config.n8n.apiKey;
  }
  return headers;
}

/** POST to an n8n webhook (includes API key when configured). */
export async function callN8nWebhook(url, body) {
  if (!url) return { ok: false, error: 'Webhook URL not configured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: n8nHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function emitN8nEvent(eventType, payload = {}) {
  return callN8nWebhook(config.n8n.eventWebhook, {
    event_type: eventType,
    chat_id: payload.chatId || config.telegram.chatId,
    source: payload.source || 'tradegpt-backend',
    severity: payload.severity || 'info',
    message: payload.message || '',
    payload,
    ts: new Date().toISOString(),
  });
}

/** Verify n8n Public API using N8N_API_KEY. */
export async function checkN8nHealth() {
  if (!config.n8n.apiKey) {
    return { ok: false, error: 'N8N_API_KEY not set' };
  }

  try {
    const res = await fetch(`${config.n8n.baseUrl}/api/v1/workflows?limit=1`, {
      headers: n8nHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, baseUrl: config.n8n.baseUrl };
    }

    const data = await res.json();
    return {
      ok: true,
      baseUrl: config.n8n.baseUrl,
      workflowCount: data.data?.length ?? 0,
    };
  } catch (err) {
    return { ok: false, error: err.message, baseUrl: config.n8n.baseUrl };
  }
}
