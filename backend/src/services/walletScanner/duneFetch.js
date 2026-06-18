/**
 * Fetch Solana smart wallets & trades from Dune.
 * Dashboard: https://dune.com/maditim/solmemecoinstradewallets
 */
import { runQueryAndWait, runSqlAndWait, getLatestQueryResults, isDuneConfigured } from '../dune.js';
import { normalizeWalletRow } from './scoring.js';

/** SQL — top profitable Solana memecoin traders (adapt to your Dune tables) */
export const WALLET_STATS_SQL = `
SELECT
  trader AS "Trader",
  COUNT(DISTINCT token_mint) AS "# of memecoins",
  AVG(CASE WHEN spent_usd > 0 THEN (received_usd - spent_usd) / spent_usd * 100 END) AS "Avg ROI per token",
  COUNT(*) AS "# of trades",
  SUM(spent_usd) AS "Spent",
  AVG(spent_usd) AS "Avg spent per token",
  SUM(received_usd) AS "Received",
  SUM(received_usd - spent_usd) AS "Profit",
  AVG(CASE WHEN spent_usd > 0 THEN received_usd / spent_usd END) AS profit_factor,
  MAX(win_rate) AS win_rate,
  MAX(sol_balance) AS sol_balance
FROM (
  SELECT
    trader,
    token_mint,
    SUM(CASE WHEN action = 'buy' THEN amount_usd ELSE 0 END) AS spent_usd,
    SUM(CASE WHEN action = 'sell' THEN amount_usd ELSE 0 END) AS received_usd,
    COUNT(*) AS trades,
    AVG(CASE WHEN pnl_usd > 0 THEN 1.0 ELSE 0.0 END) AS win_rate,
    MAX(sol_balance) AS sol_balance
  FROM dune.maditim.result_sol_memecoin_trades
  WHERE block_time > NOW() - INTERVAL '90' DAY
  GROUP BY trader, token_mint
) t
GROUP BY trader
HAVING COUNT(*) >= 10
ORDER BY "Profit" DESC
LIMIT 1000
`;

export const RECENT_TRADES_SQL = `
SELECT
  block_time AS "Date",
  trader AS "trader",
  token_mint AS "Token",
  token_symbol AS "symbol",
  amount AS "Amount",
  amount_usd AS "Amount, USD",
  LOWER(action) AS "Action"
FROM dune.maditim.result_sol_memecoin_trades
WHERE block_time > NOW() - INTERVAL '2' HOUR
  AND LOWER(action) = 'buy'
ORDER BY block_time DESC
LIMIT 5000
`;

function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
  }
  return null;
}

/** Extract token mint/address from plain address or HTML link (birdeye, sunpump, etc.) */
export function extractTokenMint(raw) {
  if (!raw) return null;
  const s = String(raw);
  const hrefMatch = s.match(/(?:token\/|\/token\/)([A-Za-z0-9]{32,44}|T[A-Za-z0-9]{33})/);
  if (hrefMatch) return hrefMatch[1];
  const plain = s.replace(/<[^>]+>/g, '').trim();
  if (/^[A-HJ-NP-Za-km-z1-9]{32,44}$/.test(plain)) return plain;
  if (/^T[A-Za-z0-9]{33}$/.test(plain)) return plain;
  return plain.slice(0, 64) || null;
}

export function normalizeTradeRow(row, chain = 'solana') {
  const trader = pick(row, 'trader', 'Trader', 'trader_id', 'wallet');
  const tokenRaw = pick(row, 'Token', 'token', 'token_mint', 'token_address');
  const token_mint = extractTokenMint(tokenRaw);
  const action = String(pick(row, 'Action', 'action') || '').toLowerCase();
  const ts = pick(row, 'Date', 'date', 'block_time', 'blocktime');
  if (!trader || !token_mint) return null;

  return {
    trader: String(trader).trim(),
    chain,
    token_mint,
    symbol: pick(row, 'symbol', 'Coin', 'name', 'token_symbol') || '',
    action,
    amount_usd: Number(pick(row, 'Amount, USD', 'amount_usd', 'amount_trx_usd', 'usd') || 0),
    timestamp: ts ? new Date(String(ts).replace(' UTC', 'Z')).toISOString() : new Date().toISOString(),
  };
}

export async function fetchWalletStatsFromDune(config = {}) {
  if (!isDuneConfigured()) throw new Error('DUNE_API_KEY not configured');

  const queryId = config.walletsQueryId || process.env.DUNE_SOL_WALLETS_QUERY_ID;
  let rows = [];

  if (queryId) {
    try {
      const data = await getLatestQueryResults(Number(queryId), { limit: 1000, maxRows: 1000 });
      rows = data.rows || [];
    } catch {
      const result = await runQueryAndWait(Number(queryId), config.queryParams || {}, { maxWaitMs: 180000 });
      rows = result.rows || [];
    }
  } else {
    try {
      const result = await runSqlAndWait(WALLET_STATS_SQL, { maxWaitMs: 180000, limit: 1000 });
      rows = result.rows || [];
    } catch (err) {
      throw new Error(
        `Dune wallet fetch failed. Set DUNE_SOL_WALLETS_QUERY_ID from `
        + `https://dune.com/maditim/solmemecoinstradewallets — ${err.message}`
      );
    }
  }

  return rows.map(normalizeWalletRow).filter(Boolean);
}

export async function fetchRecentBuysFromDune(config = {}, hours = 2) {
  if (!isDuneConfigured()) throw new Error('DUNE_API_KEY not configured');

  const queryId = config.tradesQueryId || process.env.DUNE_SOL_TRADES_QUERY_ID;
  let rows = [];

  if (queryId) {
    const result = await runQueryAndWait(Number(queryId), { hours, ...config.tradeParams }, { maxWaitMs: 120000 });
    rows = result.rows || [];
  } else {
    try {
      const result = await runSqlAndWait(RECENT_TRADES_SQL, { maxWaitMs: 120000, limit: 5000 });
      rows = result.rows || [];
    } catch (err) {
      throw new Error(
        `Dune trades fetch failed. Set DUNE_SOL_TRADES_QUERY_ID — ${err.message}`
      );
    }
  }

  return rows.map(normalizeTradeRow).filter(Boolean);
}

const QUERY_MAP = {
  tradesRecent: 3641835,
};

/** Registered Dune queries — id, label, type, chain, maxRows, optional env key */
export const DUNE_QUERY_REGISTRY = {
  solWallets: { id: 3623302, label: 'Sol wallet stats', type: 'wallets', chain: 'solana', maxRows: 1000, env: 'DUNE_SOL_WALLETS_QUERY_ID', optional: true },
  solTradesTop1000: { id: 3641832, label: 'Sol top trades', type: 'trades', chain: 'solana', maxRows: 1000, env: 'DUNE_SOL_TRADES_QUERY_ID', optional: true },
  solTradesRecent: { id: 3641835, label: 'Sol recent trades', type: 'trades', chain: 'solana', maxRows: 10000, env: 'DUNE_SOL_TRADES_RECENT_QUERY_ID' },
  solTokenList: { id: 7714204, label: 'Sol memecoin tokens', type: 'tokens', chain: 'solana', maxRows: 50000, env: 'DUNE_SOL_TOKENS_QUERY_ID' },
  tronWallets: { id: 4003316, label: 'TRON wallet stats', type: 'wallets', chain: 'tron', maxRows: 1000, env: 'DUNE_TRON_WALLETS_QUERY_ID' },
  tronTradesRecent: { id: 4009866, label: 'TRON recent trades', type: 'trades', chain: 'tron', maxRows: 10000, env: 'DUNE_TRON_TRADES_RECENT_QUERY_ID' },
  tronTrades: { id: 4003641, label: 'TRON trades', type: 'trades', chain: 'tron', maxRows: 10000, env: 'DUNE_TRON_TRADES_QUERY_ID' },
  baseDailyStats: { id: 5797617, label: 'Base daily stats', type: 'analytics', chain: 'base', maxRows: 5000, env: 'DUNE_BASE_DAILY_STATS_QUERY_ID' },
};

function envQueryId(name) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : null;
}

export function getActiveDuneQueryIds(queryIds = {}) {
  return {
    solWallets: queryIds.solWallets ?? queryIds.wallets ?? envQueryId('DUNE_SOL_WALLETS_QUERY_ID'),
    solTradesTop1000: queryIds.solTradesTop1000 ?? queryIds.tradesTop1000 ?? envQueryId('DUNE_SOL_TRADES_QUERY_ID'),
    solTradesRecent: queryIds.solTradesRecent ?? queryIds.tradesRecent ?? envQueryId('DUNE_SOL_TRADES_RECENT_QUERY_ID') ?? QUERY_MAP.tradesRecent,
    solTokenList: queryIds.solTokenList ?? queryIds.tokens ?? envQueryId('DUNE_SOL_TOKENS_QUERY_ID') ?? 7714204,
    tronWallets: queryIds.tronWallets ?? envQueryId('DUNE_TRON_WALLETS_QUERY_ID') ?? 4003316,
    tronTradesRecent: queryIds.tronTradesRecent ?? envQueryId('DUNE_TRON_TRADES_RECENT_QUERY_ID') ?? 4009866,
    tronTrades: queryIds.tronTrades ?? envQueryId('DUNE_TRON_TRADES_QUERY_ID') ?? 4003641,
    baseDailyStats: queryIds.baseDailyStats ?? envQueryId('DUNE_BASE_DAILY_STATS_QUERY_ID') ?? 5797617,
  };
}

export async function fetchAndStoreSingleQuery(queryId, { label, maxRows = 10000, pageSize = 1000 } = {}) {
  const fs = await import('fs/promises');
  const path = await import('path');
  const { getDataDir } = await import('./store.js');
  const duneDir = path.join(getDataDir(), 'dune');
  await fs.mkdir(duneDir, { recursive: true });

  const numId = Number(queryId);
  try {
    const data = await getLatestQueryResults(numId, { limit: pageSize, maxRows });
    const file = path.join(duneDir, `query-${numId}.json`);
    await fs.writeFile(file, `${JSON.stringify({ label, ok: true, ...data }, null, 2)}\n`);
    return { query_id: numId, label, ok: true, rows: data.rows.length, file };
  } catch (err) {
    const file = path.join(duneDir, `query-${numId}.json`);
    const payload = { label, query_id: numId, ok: false, error: err.message, fetched_at: new Date().toISOString() };
    await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
    return { query_id: numId, label, ok: false, error: err.message };
  }
}

export async function fetchAndStoreDuneQueries(queryIds = {}) {
  if (!isDuneConfigured()) throw new Error('DUNE_API_KEY not configured');

  const ids = getActiveDuneQueryIds(queryIds);
  const results = {};
  for (const [key, id] of Object.entries(ids)) {
    if (!id) continue;
    const numId = Number(id);
    const reg = Object.values(DUNE_QUERY_REGISTRY).find((q) => q.id === numId);
    const maxRows = reg?.maxRows || 10000;
    results[key] = await fetchAndStoreSingleQuery(id, { label: reg?.label || key, maxRows });
  }

  return results;
}

/** Build deduplicated wallet registry from all stored Dune query files */
export async function extractAndStoreAllWallets() {
  const fs = await import('fs/promises');
  const path = await import('path');
  const { getDataDir, writeJson } = await import('./store.js');
  const duneDir = path.join(getDataDir(), 'dune');

  const walletMap = new Map();
  const sources = {};
  let files;
  try {
    files = (await fs.readdir(duneDir)).filter((f) => f.startsWith('query-') && f.endsWith('.json'));
  } catch {
    files = [];
  }

  for (const file of files) {
    const queryId = Number(file.replace('query-', '').replace('.json', ''));
    const reg = Object.values(DUNE_QUERY_REGISTRY).find((q) => q.id === queryId);
    let data;
    try {
      data = JSON.parse(await fs.readFile(path.join(duneDir, file), 'utf8'));
    } catch {
      continue;
    }
    if (!data.ok || !data.rows?.length) {
      sources[queryId] = { ok: false, error: data.error, type: reg?.type || 'unknown' };
      continue;
    }

    const chain = reg?.chain || 'unknown';
    const type = reg?.type || 'unknown';
    sources[queryId] = { ok: true, rows: data.rows.length, type, chain, label: data.label || reg?.label };

    if (type === 'wallets') {
      for (const row of data.rows) {
        const w = normalizeWalletRow(row, chain);
        if (!w) continue;
        const key = `${chain}:${w.address.toLowerCase()}`;
        walletMap.set(key, { ...w, source_query: queryId, source_type: 'stats' });
      }
    } else if (type === 'trades') {
      for (const row of data.rows) {
        const t = normalizeTradeRow(row, chain);
        if (!t?.trader) continue;
        const key = `${chain}:${t.trader.toLowerCase()}`;
        if (!walletMap.has(key)) {
          walletMap.set(key, {
            address: t.trader,
            chain,
            source_query: queryId,
            source_type: 'trades',
            trade_count: 0,
          });
        }
        const w = walletMap.get(key);
        w.trade_count = (w.trade_count || 0) + 1;
      }
    }
  }

  const wallets = [...walletMap.values()].sort((a, b) => (b.profit_usd || 0) - (a.profit_usd || 0));
  const registry = {
    updated_at: new Date().toISOString(),
    count: wallets.length,
    by_chain: wallets.reduce((acc, w) => {
      acc[w.chain] = (acc[w.chain] || 0) + 1;
      return acc;
    }, {}),
    sources,
    wallets,
  };

  await writeJson('all-wallets', registry);
  return { count: wallets.length, by_chain: registry.by_chain, sources };
}

export async function loadStoredTrades() {
  const fs = await import('fs/promises');
  const path = await import('path');
  const { getDataDir } = await import('./store.js');
  const duneDir = path.join(getDataDir(), 'dune');
  const trades = [];

  const tradeQueries = [
    { id: 3641832, chain: 'solana' },
    { id: 3641835, chain: 'solana' },
    { id: 4009866, chain: 'tron' },
    { id: 4003641, chain: 'tron' },
  ];

  for (const { id, chain } of tradeQueries) {
    try {
      const raw = await fs.readFile(path.join(duneDir, `query-${id}.json`), 'utf8');
      const data = JSON.parse(raw);
      if (data.rows?.length) {
        for (const row of data.rows) {
          const t = normalizeTradeRow(row, chain);
          if (t && t.action === 'buy') trades.push(t);
        }
      }
    } catch {
      /* file missing */
    }
  }
  return trades;
}

/** Read stored Dune query files + wallet registry (no API call) */
export async function getDuneStoreStatus() {
  const fs = await import('fs/promises');
  const path = await import('path');
  const { getDataDir } = await import('./store.js');
  const duneDir = path.join(getDataDir(), 'dune');
  const dataDir = getDataDir();

  let registry = { count: 0, by_chain: {}, updated_at: null, sources: {} };
  let tradesCache = { count: 0, updated_at: null };

  try {
    const data = JSON.parse(await fs.readFile(path.join(dataDir, 'all-wallets.json'), 'utf8'));
    registry = {
      count: data.count || 0,
      by_chain: data.by_chain || {},
      updated_at: data.updated_at || null,
      sources: data.sources || {},
    };
  } catch { /* not built yet */ }

  try {
    const data = JSON.parse(await fs.readFile(path.join(dataDir, 'trades-cache.json'), 'utf8'));
    tradesCache = { count: data.count || 0, updated_at: data.updated_at || null };
  } catch { /* no trades */ }

  const queries = [];
  const files = await fs.readdir(duneDir).catch(() => []);
  for (const file of files.filter((f) => f.startsWith('query-') && f.endsWith('.json'))) {
    const queryId = Number(file.replace('query-', '').replace('.json', ''));
    const reg = Object.values(DUNE_QUERY_REGISTRY).find((q) => q.id === queryId);
    try {
      const raw = await fs.readFile(path.join(duneDir, file), 'utf8');
      const data = JSON.parse(raw);
      const hasRows = Boolean(data.rows?.length);
      const failed = data.ok === false || Boolean(data.error);
      queries.push({
        query_id: queryId,
        label: data.label || reg?.label || `query-${queryId}`,
        type: reg?.type || 'unknown',
        chain: reg?.chain || 'unknown',
        ok: hasRows || (data.ok === true),
        rows: data.rows?.length ?? 0,
        error: failed ? (data.error || 'fetch failed') : null,
        fetched_at: data.fetched_at || null,
        file_size_kb: Math.round(raw.length / 1024),
      });
    } catch (err) {
      queries.push({ query_id: queryId, ok: false, error: err.message });
    }
  }
  queries.sort((a, b) => a.query_id - b.query_id);

  const activeIds = new Set(Object.values(getActiveDuneQueryIds()).filter(Boolean).map(Number));
  const visibleQueries = queries.filter((q) => q.ok || activeIds.has(q.query_id));

  return {
    configured: isDuneConfigured(),
    active_query_ids: getActiveDuneQueryIds(),
    registry,
    trades_cache: tradesCache,
    queries: visibleQueries,
  };
}
