const API_URL = import.meta.env.VITE_API_URL || '';

export async function fetchChart(symbol, interval = '5m') {
  const res = await fetch(`${API_URL}/api/chart/${symbol}?interval=${interval}`);
  return res.json();
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
  const res = await fetch(`${API_URL}/api/balance`);
  return res.json();
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

export async function fetchStrategyStats() {
  const res = await fetch(`${API_URL}/api/strategy/stats`);
  return res.json();
}

export async function fetchLearnedPatterns(limit = 30) {
  const res = await fetch(`${API_URL}/api/strategy/patterns?limit=${limit}`);
  return res.json();
}

export async function fetchScannerStatus() {
  const res = await fetch(`${API_URL}/api/scanner/status`);
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

export async function runBacktest(params) {
  const res = await fetch(`${API_URL}/api/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Backtest failed');
  return data;
}

export async function fetchBacktestHistory(limit = 30) {
  const res = await fetch(`${API_URL}/api/backtest/history?limit=${limit}`);
  return res.json();
}

export async function fetchApiKeyStatus() {
  const res = await fetch(`${API_URL}/api/settings/api-keys`);
  return res.json();
}

export async function saveApiKeys(keys) {
  const res = await fetch(`${API_URL}/api/settings/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keys),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Save failed');
  return data;
}

export async function testApiKeys(keys) {
  const res = await fetch(`${API_URL}/api/settings/api-keys/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(keys),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Test failed');
  return data;
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
