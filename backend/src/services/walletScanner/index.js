import crypto from 'crypto';
import { config } from '../../config/index.js';
import { callN8nWebhook } from '../n8n.js';
import { sendWalletConsensusAlert } from '../telegram.js';
import { fetchWalletStatsFromDune, fetchRecentBuysFromDune, fetchAndStoreDuneQueries, loadStoredTrades, extractAndStoreAllWallets, getDuneStoreStatus } from './duneFetch.js';
import {
  enrichWallet,
  detectDecliningWallets,
  DEFAULT_RULES,
  passesFilter,
} from './scoring.js';
import {
  buildWalletScoreMap,
  detectConsensus,
  applyLiquidityFilter,
  filterPassedSignals,
  DEFAULT_CONSENSUS_RULES,
} from './consensus.js';
import { DEFAULT_LIQUIDITY_RULES } from './liquidity.js';
import {
  loadWallets,
  saveWallets,
  loadSignals,
  appendSignal,
  loadScannerState,
  saveScannerState,
  loadScannerConfig,
  saveScannerConfig,
  getDataDir,
  writeJson,
} from './store.js';

function getRules() {
  const cfg = config.walletScanner || {};
  return { ...DEFAULT_RULES, ...cfg.rules };
}

function getConsensusRules() {
  const cfg = config.walletScanner || {};
  return { ...DEFAULT_CONSENSUS_RULES, ...cfg.consensus };
}

function getLiquidityRules() {
  const cfg = config.walletScanner || {};
  return { ...DEFAULT_LIQUIDITY_RULES, ...cfg.liquidity };
}

export async function getWalletScannerStatus() {
  const state = await loadScannerState();
  const wallets = await loadWallets();
  const signals = await loadSignals();
  const cfg = await loadScannerConfig();

  return {
    dataDir: getDataDir(),
    running: state.running,
    last_scan_at: state.last_scan_at,
    last_daily_refresh_at: state.last_daily_refresh_at,
    last_consensus_at: state.last_consensus_at,
    wallet_count: wallets.length,
    active_count: wallets.filter((w) => w.status === 'active').length,
    qualified_count: wallets.filter((w) => w.qualified).length,
    signal_count: signals.length,
    recent_signals: signals.slice(0, 10),
    config: cfg || {
      rules: getRules(),
      consensus: getConsensusRules(),
      liquidity: getLiquidityRules(),
      dune: {
        dashboard: 'https://dune.com/maditim/solmemecoinstradewallets',
        solWalletsQueryId: process.env.DUNE_SOL_WALLETS_QUERY_ID || null,
        solTradesQueryId: process.env.DUNE_SOL_TRADES_QUERY_ID || null,
        solTradesRecentQueryId: process.env.DUNE_SOL_TRADES_RECENT_QUERY_ID || null,
        solTokensQueryId: process.env.DUNE_SOL_TOKENS_QUERY_ID || '7714204',
        tronWalletsQueryId: process.env.DUNE_TRON_WALLETS_QUERY_ID || '4003316',
        tronTradesQueryId: process.env.DUNE_TRON_TRADES_QUERY_ID || '4003641',
        tronTradesRecentQueryId: process.env.DUNE_TRON_TRADES_RECENT_QUERY_ID || '4009866',
        baseDailyStatsQueryId: process.env.DUNE_BASE_DAILY_STATS_QUERY_ID || '5797617',
      },
    },
    stats: state.stats || {},
  };
}

export async function refreshWalletsFromDune(options = {}) {
  const rules = { ...getRules(), ...options.rules };
  const rows = await fetchWalletStatsFromDune(options.dune || {});
  const existing = await loadWallets();
  const existingMap = new Map(existing.map((w) => [w.address.toLowerCase(), w]));

  const refreshed = [];
  for (const row of rows) {
    const prev = existingMap.get(row.address.toLowerCase());
    const wallet = enrichWallet(prev ? { ...prev, metrics: row } : { ...row }, rules);
    if (!wallet) continue;

    if (prev?.score_history) {
      wallet.score_history = [
        ...prev.score_history.slice(-30),
        { date: new Date().toISOString(), score: wallet.score, roi_90d: wallet.metrics.roi_90d },
      ];
    } else {
      wallet.score_history = [{ date: new Date().toISOString(), score: wallet.score, roi_90d: wallet.metrics.roi_90d }];
    }

    wallet.status = wallet.qualified ? 'active' : (prev?.status === 'active' ? 'watch' : 'candidate');
    refreshed.push(wallet);
  }

  refreshed.sort((a, b) => b.score - a.score);
  const capped = refreshed.slice(0, rules.maxWallets || 1000);
  await saveWallets(capped);

  const state = await loadScannerState();
  state.last_daily_refresh_at = new Date().toISOString();
  state.stats = {
    ...state.stats,
    last_refresh_count: capped.length,
    last_qualified: capped.filter((w) => w.qualified).length,
  };
  await saveScannerState(state);

  return { count: capped.length, qualified: capped.filter((w) => w.qualified).length, wallets: capped };
}

export async function dailyWalletMaintenance() {
  const rules = getRules();
  let wallets = await loadWallets();
  const declining = detectDecliningWallets(wallets.filter((w) => w.status === 'active'));

  const removed = [];
  for (const { wallet, reason } of declining) {
    wallet.status = 'removed';
    wallet.removed_at = new Date().toISOString();
    wallet.removed_reason = reason;
    removed.push(wallet.address);
  }

  const activeCount = wallets.filter((w) => w.status === 'active').length;
  const needMore = (rules.targetWallets || 750) - activeCount + removed.length;

  if (needMore > 0) {
    try {
      const fresh = await refreshWalletsFromDune();
      wallets = fresh.wallets;
    } catch (err) {
      console.error('[WalletScanner] Dune refresh failed:', err.message);
    }
  }

  const candidates = wallets
    .filter((w) => w.status !== 'active' && w.qualified)
    .sort((a, b) => b.score - a.score);

  let added = 0;
  for (const c of candidates) {
    if (added >= needMore) break;
    if (wallets.filter((w) => w.status === 'active').length >= rules.maxWallets) break;
    c.status = 'active';
    c.promoted_at = new Date().toISOString();
    added++;
  }

  await saveWallets(wallets);

  const report = {
    removed,
    added,
    active: wallets.filter((w) => w.status === 'active').length,
    timestamp: new Date().toISOString(),
  };

  if (config.n8n?.walletScannerWebhook) {
    await callN8nWebhook(config.n8n.walletScannerWebhook, { type: 'daily_maintenance', ...report }).catch(() => {});
  }

  return report;
}

export async function runConsensusScan(options = {}) {
  const wallets = await loadWallets();
  const walletMap = buildWalletScoreMap(wallets);
  const consensusRules = { ...getConsensusRules(), ...options.consensus };
  const liquidityRules = { ...getLiquidityRules(), ...options.liquidity };

  const trades = await fetchRecentBuysFromDune(options.dune || {}, consensusRules.windowHours);
  const candidates = detectConsensus(trades, walletMap, consensusRules);
  const withLiquidity = await applyLiquidityFilter(candidates, liquidityRules);
  const passed = filterPassedSignals(withLiquidity);

  const existing = await loadSignals();
  const existingKeys = new Set(existing.map((s) => `${s.token_mint}:${s.wallet_count}`));

  const newSignals = [];
  for (const sig of passed) {
    const key = `${sig.token_mint}:${sig.wallet_count}`;
    if (existingKeys.has(key)) continue;

    const record = {
      id: crypto.randomUUID(),
      type: 'wallet_consensus',
      chain: 'solana',
      ...sig,
      created_at: new Date().toISOString(),
    };
    await appendSignal(record);
    newSignals.push(record);

    await sendWalletConsensusAlert(record).catch((e) => console.error('[Telegram] consensus:', e.message));

    if (config.n8n?.walletScannerWebhook) {
      await callN8nWebhook(config.n8n.walletScannerWebhook, { type: 'consensus_signal', signal: record }).catch(() => {});
    }
  }

  const state = await loadScannerState();
  state.last_consensus_at = new Date().toISOString();
  state.last_scan_at = new Date().toISOString();
  state.stats = {
    ...state.stats,
    last_consensus_candidates: candidates.length,
    last_consensus_passed: passed.length,
    last_new_signals: newSignals.length,
  };
  await saveScannerState(state);

  return {
    trades_analyzed: trades.length,
    candidates: candidates.length,
    passed_liquidity: passed.length,
    new_signals: newSignals,
    filtered: withLiquidity.filter((s) => !s.passed_liquidity),
  };
}

export async function runFullWalletScan(options = {}) {
  const refresh = options.refreshWallets !== false;
  if (refresh) await refreshWalletsFromDune(options);
  return runConsensusScan(options);
}

export async function setWalletScannerRunning(running) {
  const state = await loadScannerState();
  state.running = running;
  await saveScannerState(state);
  return state;
}

export async function updateWalletScannerConfig(partial) {
  const current = await loadScannerConfig() || {};
  const merged = {
    rules: { ...getRules(), ...current.rules, ...partial.rules },
    consensus: { ...getConsensusRules(), ...current.consensus, ...partial.consensus },
    liquidity: { ...getLiquidityRules(), ...current.liquidity, ...partial.liquidity },
    updated_at: new Date().toISOString(),
  };
  await saveScannerConfig(merged);
  return merged;
}

export async function getWalletsList({ status, qualified, limit = 100, offset = 0 } = {}) {
  let wallets = await loadWallets();
  if (status) wallets = wallets.filter((w) => w.status === status);
  if (qualified != null) wallets = wallets.filter((w) => w.qualified === qualified);
  wallets.sort((a, b) => b.score - a.score);
  return {
    total: wallets.length,
    wallets: wallets.slice(offset, offset + limit),
  };
}

export async function importWalletsFromRows(rows) {
  const rules = getRules();
  const existing = await loadWallets();
  const map = new Map(existing.map((w) => [w.address.toLowerCase(), w]));
  for (const row of rows) {
    const w = enrichWallet(row, rules);
    if (!w) continue;
    map.set(w.address.toLowerCase(), w);
  }
  const merged = [...map.values()].sort((a, b) => b.score - a.score);
  await saveWallets(merged);
  return { count: merged.length };
}

export async function importFromStoredDune() {
  const fs = await import('fs/promises');
  const path = await import('path');
  const duneDir = path.join(getDataDir(), 'dune');
  let walletRows = [];

  try {
    const raw = await fs.readFile(path.join(duneDir, 'query-3623302.json'), 'utf8');
    const data = JSON.parse(raw);
    if (data.rows?.length) walletRows = data.rows;
  } catch {
    /* sol wallets query not stored yet */
  }

  if (!walletRows.length) {
    try {
      const raw = await fs.readFile(path.join(duneDir, 'query-4003316.json'), 'utf8');
      const data = JSON.parse(raw);
      if (data.rows?.length) walletRows = data.rows;
    } catch {
      /* tron wallets query not stored yet */
    }
  }

  const report = { wallets: 0, trades: 0 };

  if (walletRows.length) {
    const r = await importWalletsFromRows(walletRows);
    report.wallets = r.count;
  }

  const trades = await loadStoredTrades();
  if (trades.length) {
    await writeJson('trades-cache', {
      updated_at: new Date().toISOString(),
      count: trades.length,
      trades: trades.slice(0, 10000),
    });
    report.trades = trades.length;
  }

  return report;
}

export async function fetchStoreAndImportDune(queryIds) {
  const fetchReport = await fetchAndStoreDuneQueries(queryIds);
  const importReport = await importFromStoredDune();
  const walletRegistry = await extractAndStoreAllWallets();
  const dune = await getDuneStoreStatus();
  return { fetch: fetchReport, import: importReport, walletRegistry, dune };
}

export { getDuneStoreStatus };

export { getDataDir, passesFilter, DEFAULT_RULES, DEFAULT_CONSENSUS_RULES, DEFAULT_LIQUIDITY_RULES };
