import { config } from '../config/index.js';

/** Headers for server-to-server calls to /api/execute (localhost + optional secret). */
export function internalApiHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret) headers['X-Internal-Key'] = secret;
  const ingestionKey = config.externalSignals?.ingestionKey;
  if (ingestionKey) headers['X-Ingestion-Key'] = ingestionKey;
  return headers;
}

export function internalApiUrl(path) {
  const port = config.port || 3001;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `http://127.0.0.1:${port}${p}`;
}
