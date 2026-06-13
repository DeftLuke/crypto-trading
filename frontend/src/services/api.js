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
