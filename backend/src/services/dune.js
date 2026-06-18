/**
 * Dune Analytics API — https://docs.dune.com/api-reference/
 */
import { config } from '../config/index.js';

const BASE = 'https://api.dune.com/api/v1';

function headers() {
  const key = config.dune?.apiKey;
  if (!key) throw new Error('DUNE_API_KEY not configured');
  return {
    'Content-Type': 'application/json',
    'X-DUNE-API-KEY': key,
  };
}

async function duneFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
    signal: AbortSignal.timeout(options.timeout || 120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `Dune API error ${res.status}`);
  }
  return data;
}

export function isDuneConfigured() {
  return Boolean(config.dune?.apiKey);
}

/** Verify API key by fetching a lightweight endpoint */
export async function testDuneConnection() {
  if (!isDuneConfigured()) {
    return { ok: false, reason: 'DUNE_API_KEY not set' };
  }
  try {
    const data = await duneFetch('/sql/execute', {
      method: 'POST',
      body: JSON.stringify({ sql: 'SELECT 1 AS ok LIMIT 1', performance: 'small' }),
    });
    return { ok: true, executionId: data.execution_id, state: data.state };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

export async function executeQuery(queryId, queryParameters = {}, performance = 'small') {
  return duneFetch(`/query/${queryId}/execute`, {
    method: 'POST',
    body: JSON.stringify({ query_parameters: queryParameters, performance }),
  });
}

export async function executeSql(sql, performance = 'small') {
  return duneFetch('/sql/execute', {
    method: 'POST',
    body: JSON.stringify({ sql, performance }),
  });
}

export async function getExecutionStatus(executionId) {
  return duneFetch(`/execution/${executionId}/status`);
}

export async function getExecutionResults(executionId, limit = 100) {
  return duneFetch(`/execution/${executionId}/results?limit=${limit}`);
}

/** Poll until complete, then return rows */
export async function runQueryAndWait(queryId, queryParameters = {}, { maxWaitMs = 90000 } = {}) {
  const exec = await executeQuery(queryId, queryParameters);
  const executionId = exec.execution_id;
  if (!executionId) throw new Error('No execution_id returned');

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const status = await getExecutionStatus(executionId);
    const state = status.state;
    if (state === 'QUERY_STATE_COMPLETED') {
      const results = await getExecutionResults(executionId);
      return {
        executionId,
        rows: results.result?.rows || [],
        metadata: results.result?.metadata,
      };
    }
    if (state === 'QUERY_STATE_FAILED' || state === 'QUERY_STATE_CANCELLED') {
      throw new Error(status.error || `Query ${state}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Dune query timed out');
}

export async function runSqlAndWait(sql, opts = {}) {
  const exec = await executeSql(sql, opts.performance || 'small');
  const executionId = exec.execution_id;
  if (!executionId) throw new Error('No execution_id returned');

  const maxWaitMs = opts.maxWaitMs || 90000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const status = await getExecutionStatus(executionId);
    const state = status.state;
    if (state === 'QUERY_STATE_COMPLETED') {
      const results = await getExecutionResults(executionId, opts.limit || 100);
      return {
        executionId,
        rows: results.result?.rows || [],
        metadata: results.result?.metadata,
      };
    }
    if (state === 'QUERY_STATE_FAILED' || state === 'QUERY_STATE_CANCELLED') {
      throw new Error(status.error || `SQL ${state}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Dune SQL timed out');
}

/** Latest cached results (no re-execution) — paginated */
export async function getLatestQueryResults(queryId, { limit = 1000, maxRows = 10000 } = {}) {
  const all = [];
  let offset = 0;
  let metadata = null;

  while (all.length < maxRows) {
    const pageLimit = Math.min(limit, maxRows - all.length);
    const data = await duneFetch(`/query/${queryId}/results?limit=${pageLimit}&offset=${offset}`);
    if (data.error) throw new Error(data.error);

    const rows = data.result?.rows || [];
    metadata = data.result?.metadata || metadata;
    all.push(...rows);
    if (rows.length < pageLimit) break;
    offset += pageLimit;
  }

  return { query_id: queryId, rows: all, metadata, fetched_at: new Date().toISOString() };
}
