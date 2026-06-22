import { supabase } from '../lib/supabase';
import { fetchWithTimeout } from '../lib/fetchTimeout';

const API_TIMEOUT_MS = 5000;

const API_URL = import.meta.env.VITE_API_URL || '';

async function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  }
  return headers;
}

export async function fetchChart(symbol, interval = '5m') {
  const res = await fetch(`${API_URL}/api/chart/${symbol}?interval=${interval}`);
  return res.json();
}

export async function searchTvPairs(query, limit = 25) {
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${API_URL}/api/tradingview/search?${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Search failed');
  return data;
}

export async function fetchTvChart(symbol, interval = '5m', range = 300) {
  const qs = new URLSearchParams({ symbol, interval, range: String(range) });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch(`${API_URL}/api/tradingview/chart?${qs}`, { signal: controller.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Chart fetch failed');
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Chart load timed out — retrying with Binance…');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchSignals(limit = 20) {
  const res = await fetch(`${API_URL}/api/signals?limit=${limit}`);
  return res.json();
}

export async function fetchTrades(limit = 20) {
  const res = await fetch(`${API_URL}/api/trades?limit=${limit}`);
  return res.json();
}

export async function fetchOpenTrades() {
  const res = await fetch(`${API_URL}/api/trades/open`);
  return res.json();
}

export async function fetchPairStats() {
  const res = await fetch(`${API_URL}/api/pairs/stats`);
  return res.json();
}

export async function fetchBalance() {
  const res = await fetchWithTimeout(
    `${API_URL}/api/balance`,
    { headers: await authHeaders() },
    API_TIMEOUT_MS,
  );
  return res.json();
}

export async function fetchTradeHomeDashboard(localDay = null) {
  const day = localDay || new Date().toLocaleDateString('en-CA');
  const tz = -new Date().getTimezoneOffset();
  const qs = `?day=${encodeURIComponent(day)}&tz=${tz}`;
  const res = await fetchWithTimeout(`${API_URL}/api/trades/home-dashboard${qs}`, {}, 8000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Dashboard unavailable');
  return data;
}

/** One request: trade audit + services + settings + signal engine (cached server-side). */
export async function fetchDashboardSnapshot(localDay = null) {
  const day = localDay || new Date().toLocaleDateString('en-CA');
  const tz = -new Date().getTimezoneOffset();
  const qs = `?day=${encodeURIComponent(day)}&tz=${tz}`;
  const res = await fetchWithTimeout(`${API_URL}/api/dashboard/snapshot${qs}`, {}, 8000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Dashboard unavailable');
  return data;
}

export async function fetchMarketDataProgress() {
  const res = await fetchWithTimeout(`${API_URL}/api/market-data/progress`, {}, 6000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.detail || 'Market data unavailable');
  return data;
}

/** Compact archive backfill + live WS candle sync (home dashboard). */
export async function fetchCandleSyncStatus() {
  const res = await fetchWithTimeout(`${API_URL}/api/candles/sync-status`, {}, 8000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Candle sync status unavailable');
  return data;
}

export async function fetchControlSettings() {
  const res = await fetchWithTimeout(`${API_URL}/api/control/settings`, {}, 8000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Settings unavailable');
  return data;
}

export async function updateControlSettings(updates) {
  const res = await fetchWithTimeout(`${API_URL}/api/control/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ ...updates, actor: 'dashboard' }),
  }, 10000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Save failed');
  return data;
}

export async function fetchSignalEngineStatus() {
  const res = await fetchWithTimeout(`${API_URL}/api/signal-engine/status`, {}, 8000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Engine status unavailable');
  return data;
}

export async function setSignalEngine(signal_engine) {
  const res = await fetchWithTimeout(`${API_URL}/api/signal-engine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ signal_engine, actor: 'dashboard' }),
  }, 10000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Engine switch failed');
  return data;
}

export async function fetchTradesToday(days = 7) {
  const qs = days ? `?days=${days}` : '';
  const res = await fetchWithTimeout(`${API_URL}/api/trades/today${qs}`, {}, 10000);
  return res.json();
}

export async function fetchTradesByDay(day, tz = -new Date().getTimezoneOffset()) {
  const qs = `?day=${encodeURIComponent(day)}&tz=${tz}`;
  const res = await fetchWithTimeout(`${API_URL}/api/trades/by-day${qs}`, {}, 8000);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load trades for day');
  return data;
}

export async function fetchPairs() {
  const res = await fetch(`${API_URL}/api/pairs`);
  return res.json();
}

export async function fetchAllPairs() {
  const res = await fetch(`${API_URL}/api/pairs?all=true`);
  return res.json();
}

export async function fetchBacktestEstimate(period, timeframe) {
  const res = await fetch(`${API_URL}/api/backtest/estimate?period=${period}&timeframe=${timeframe}`);
  return res.json();
}

export async function fetchCgPrices(symbols) {
  const list = Array.isArray(symbols) ? symbols.join(',') : symbols;
  const res = await fetch(`${API_URL}/api/prices/coingecko?symbols=${list}`);
  return res.json();
}

export async function fetchSkippedLessons(limit = 20) {
  const res = await fetch(`${API_URL}/api/lessons/skipped?limit=${limit}`);
  return res.json();
}

export async function fetchExecutedLessons(limit = 20) {
  const res = await fetch(`${API_URL}/api/lessons/executed?limit=${limit}`);
  return res.json();
}

export async function fetchLessonStats() {
  const res = await fetch(`${API_URL}/api/lessons/stats`);
  return res.json();
}

export async function analyzeSymbol(symbol) {
  const res = await fetch(`${API_URL}/api/analyze/${symbol}`);
  return res.json();
}

export async function fetchStrategies() {
  const res = await fetch(`${API_URL}/api/strategies`);
  return res.json();
}

export async function fetchStrategyChartSetups(strategyId, symbol, interval = '5m', period = '1m') {
  const qs = new URLSearchParams({ symbol, interval, period });
  const res = await fetch(`${API_URL}/api/strategies/${strategyId}/chart-setups?${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load setups');
  return data;
}

export async function fetchStrategyStats(strategyId = 'smc-mtf') {
  const res = await fetch(`${API_URL}/api/strategy/stats?strategy=${strategyId}`);
  return res.json();
}

export async function fetchLearnedPatterns(limit = 30) {
  const res = await fetch(`${API_URL}/api/strategy/patterns?limit=${limit}`);
  return res.json();
}

export async function fetchScannerStatus() {
  const res = await fetchWithTimeout(`${API_URL}/api/scanner/status`, {}, API_TIMEOUT_MS);
  return res.json();
}

export async function startScanner() {
  const res = await fetch(`${API_URL}/api/scanner/start`, { method: 'POST' });
  return res.json();
}

export async function stopScanner() {
  const res = await fetch(`${API_URL}/api/scanner/stop`, { method: 'POST' });
  return res.json();
}

export async function runBacktest(params, onProgress) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const res = await fetch(`${API_URL}/api/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, async: true }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Backtest failed');

    if (data.jobId) {
      return pollBacktestJob(data.jobId, onProgress);
    }
    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('Backtest timed out after 5 minutes.');
    }
    throw err;
  }
}

async function pollBacktestJob(jobId, onProgress) {
  const deadline = Date.now() + 300000;
  let lastProgress = 0;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_URL}/api/backtest/status/${jobId}`);
      const st = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Backtest job lost — server restarted during run. Try 15m TF or 1M period.');
        }
        throw new Error(st.error || 'Backtest status failed');
      }

      lastProgress = st.progress_pct || lastProgress;
      onProgress?.(lastProgress, st.phase, st.message);

      if (st.status === 'completed' && st.result) return st.result;
      if (st.status === 'failed') throw new Error(st.error || st.message || 'Backtest failed');
    } catch (err) {
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
        throw new Error('Server disconnected during backtest (likely out of memory). Use 15m entry TF or 1M period.');
      }
      throw err;
    }

    await new Promise((r) => setTimeout(r, 450));
  }
  throw new Error('Backtest timed out while waiting for results.');
}

export async function fetchBacktestHistory(limit = 30) {
  const res = await fetch(`${API_URL}/api/backtest/history?limit=${limit}`);
  return res.json();
}

export async function fetchApiKeyStatus() {
  const res = await fetch(`${API_URL}/api/settings/api-keys`, { headers: await authHeaders() });
  return res.json();
}

export async function saveApiKeys(keys) {
  const res = await fetch(`${API_URL}/api/settings/api-keys`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(keys),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Save failed');
  return data;
}

export async function testApiKeys(keys) {
  const res = await fetch(`${API_URL}/api/settings/api-keys/test`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(keys),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Test failed');
  return data;
}

export async function setTradingMode(mode) {
  const res = await fetch(`${API_URL}/api/settings/trading-mode`, {
    method: 'PUT',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Mode switch failed');
  return data;
}

async function ftRequest(path, { method = 'GET', body } = {}) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_URL}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function fetchFreqtradeInfo() {
  return ftRequest('/api/freqtrade/info');
}

export async function fetchFreqtradeStatus() {
  return ftRequest('/api/freqtrade/status');
}

export async function fetchFreqtradeStrategies() {
  return ftRequest('/api/freqtrade/strategies');
}

export async function fetchFreqtradeConfig() {
  return ftRequest('/api/freqtrade/config');
}

export async function startFreqtradeBot() {
  return ftRequest('/api/freqtrade/start', { method: 'POST' });
}

export async function stopFreqtradeBot() {
  return ftRequest('/api/freqtrade/stop', { method: 'POST' });
}

export async function pauseFreqtradeBot() {
  return ftRequest('/api/freqtrade/pause', { method: 'POST' });
}

export async function stopBuyFreqtrade() {
  return ftRequest('/api/freqtrade/stopbuy', { method: 'POST' });
}

export async function reloadFreqtradeConfig() {
  return ftRequest('/api/freqtrade/reload', { method: 'POST' });
}

export async function setFreqtradeStrategy(strategy) {
  return ftRequest('/api/freqtrade/strategy', { method: 'POST', body: { strategy } });
}

export async function forceExitFreqtrade(tradeId = 'all', ordertype, amount) {
  return ftRequest('/api/freqtrade/force-exit', { method: 'POST', body: { tradeId, ordertype, amount } });
}

export async function forceEnterFreqtrade(params) {
  return ftRequest('/api/freqtrade/force-enter', { method: 'POST', body: params });
}

export async function fetchFreqtradeBalance() {
  return ftRequest('/api/freqtrade/balance');
}

export async function fetchFreqtradeTrades(limit = 50) {
  return ftRequest(`/api/freqtrade/trades?limit=${limit}`);
}

export async function fetchFreqtradeDaily(days = 7) {
  return ftRequest(`/api/freqtrade/daily?days=${days}`);
}

export async function fetchFreqtradeWeekly(days = 4) {
  return ftRequest(`/api/freqtrade/weekly?days=${days}`);
}

export async function fetchFreqtradeMonthly(days = 3) {
  return ftRequest(`/api/freqtrade/monthly?days=${days}`);
}

export async function fetchFreqtradePerformance() {
  return ftRequest('/api/freqtrade/performance');
}

export async function fetchFreqtradeStats() {
  return ftRequest('/api/freqtrade/stats');
}

export async function fetchFreqtradeCount() {
  return ftRequest('/api/freqtrade/count');
}

export async function fetchFreqtradeWhitelist() {
  return ftRequest('/api/freqtrade/whitelist');
}

export async function fetchFreqtradeBlacklist() {
  return ftRequest('/api/freqtrade/blacklist');
}

export async function addFreqtradeBlacklist(pairs) {
  return ftRequest('/api/freqtrade/blacklist', { method: 'POST', body: { pairs } });
}

export async function removeFreqtradeBlacklist(pairs) {
  return ftRequest('/api/freqtrade/blacklist', { method: 'DELETE', body: { pairs } });
}

export async function fetchFreqtradeLocks() {
  return ftRequest('/api/freqtrade/locks');
}

export async function addFreqtradeLock(params) {
  return ftRequest('/api/freqtrade/locks', { method: 'POST', body: params });
}

export async function deleteFreqtradeLock(id) {
  return ftRequest(`/api/freqtrade/locks/${id}`, { method: 'DELETE' });
}

export async function fetchFreqtradeLogs(limit = 100) {
  return ftRequest(`/api/freqtrade/logs?limit=${limit}`);
}

export async function fetchFreqtradeHealth() {
  return ftRequest('/api/freqtrade/health');
}

export async function fetchFreqtradeVersion() {
  return ftRequest('/api/freqtrade/version');
}

export async function fetchFreqtradeSysinfo() {
  return ftRequest('/api/freqtrade/sysinfo');
}

export async function cancelFreqtradeOrder(tradeId) {
  return ftRequest(`/api/freqtrade/trades/${tradeId}/open-order`, { method: 'DELETE' });
}

export async function deleteFreqtradeTrade(tradeId) {
  return ftRequest(`/api/freqtrade/trades/${tradeId}`, { method: 'DELETE' });
}

export async function reloadFreqtradeTrade(tradeId) {
  return ftRequest(`/api/freqtrade/trades/${tradeId}/reload`, { method: 'POST' });
}

export async function fetchWalletScannerStatus() {
  return ftRequest('/api/wallet-scanner/status');
}

export async function fetchWalletScannerWallets(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', params.limit);
  if (params.offset) qs.set('offset', params.offset);
  if (params.status) qs.set('status', params.status);
  return ftRequest(`/api/wallet-scanner/wallets?${qs}`);
}

export async function fetchWalletScannerSignals(limit = 50) {
  return ftRequest(`/api/wallet-scanner/signals?limit=${limit}`);
}

export async function startWalletScanner() {
  return ftRequest('/api/wallet-scanner/start', { method: 'POST' });
}

export async function stopWalletScanner() {
  return ftRequest('/api/wallet-scanner/stop', { method: 'POST' });
}

export async function runWalletScannerScan() {
  return ftRequest('/api/wallet-scanner/scan', { method: 'POST', body: {} });
}

export async function refreshWalletScannerWallets() {
  return ftRequest('/api/wallet-scanner/refresh', { method: 'POST', body: {} });
}

export async function runWalletScannerDaily() {
  return ftRequest('/api/wallet-scanner/daily', { method: 'POST' });
}

export async function fetchWalletScannerDuneStatus() {
  return ftRequest('/api/wallet-scanner/dune');
}

/** Fetch all Dune queries, store locally, rebuild wallet registry (may take 1–3 min) */
export async function fetchWalletScannerDune(queryIds = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(`${API_URL}/api/wallet-scanner/fetch-dune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryIds }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Dune fetch timed out (3 min). Try again.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function connectWebSocket(onMessage) {
  const wsUrl = import.meta.env.VITE_WS_URL || `ws://${window.location.hostname}:3001`;
  const ws = new WebSocket(`${wsUrl}/ws`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    onMessage(data);
  };

  ws.onclose = () => {
    setTimeout(() => connectWebSocket(onMessage), 3000);
  };

  return ws;
}
