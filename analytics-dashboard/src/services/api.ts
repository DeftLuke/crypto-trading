import { RESEARCH_API, getTradingApi } from "@/lib/constants";
import type { ResearchHealth } from "@/types";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.startsWith("<") ? `API returned HTML instead of JSON (${url})` : text.slice(0, 120) || `HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(String(data.error || data.detail || `HTTP ${res.status}`));
  return data as T;
}

export const researchApi = {
  health: async (): Promise<ResearchHealth> => {
    try {
      return await fetchJson<ResearchHealth>(`${RESEARCH_API}/health`);
    } catch {
      const trading = await fetchJson<{ status: string; research?: string; position_monitor?: string }>(`${getTradingApi()}/health`);
      return {
        status: trading.status === "ok" ? "ok" : "degraded",
        checks: { trading_api: trading },
        source: "trading_api_fallback",
      };
    }
  },
  backtestStart: (body: Record<string, unknown>) =>
    fetchJson<{ backtest_id: string; status: string }>(`${RESEARCH_API}/backtest/start`, { method: "POST", body: JSON.stringify(body) }),
  backtestStatus: (id: string) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/backtest/status?backtest_id=${id}`),
  backtestResults: (id: string) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/backtest/results?backtest_id=${id}`),
  backtestTrades: (id: string, limit = 500) =>
    fetchJson<{ count: number; trades: unknown[] }>(`${RESEARCH_API}/backtest/trades?backtest_id=${id}&limit=${limit}`),
  backtestEquity: (id: string) =>
    fetchJson<{ count: number; equity: unknown[] }>(`${RESEARCH_API}/backtest/equity?backtest_id=${id}`),
  backtestSessions: (id: string) =>
    fetchJson<{ sessions: unknown[] }>(`${RESEARCH_API}/backtest/sessions?backtest_id=${id}`),
  backtestSmc: (id: string) =>
    fetchJson<{ smc: unknown[] }>(`${RESEARCH_API}/backtest/smc?backtest_id=${id}`),
  backtestMonteCarlo: (id: string) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/backtest/monte-carlo?backtest_id=${id}`),
  backtestWalkforward: (id: string) =>
    fetchJson<{ folds: unknown[] }>(`${RESEARCH_API}/backtest/walkforward?backtest_id=${id}`),
  backtestRankings: (ids: string[]) =>
    fetchJson<{ rankings: unknown[] }>(`${RESEARCH_API}/backtest/rankings`, {
      method: "POST",
      body: JSON.stringify({ backtest_ids: ids }),
    }),
  signals: (limit = 20) =>
    fetchJson<{ count?: number; signals: unknown[] }>(`${RESEARCH_API}/signals?limit=${limit}`),
  generateSignal: (symbol: string, exchange = "binance", timeframe = "15m") =>
    fetchJson<Record<string, unknown>>(
      `${RESEARCH_API}/signals/generate?symbol=${symbol}&exchange=${exchange}&timeframe=${timeframe}`,
      { method: "POST" }
    ),
  datasetStatus: () => fetchJson<unknown>(`${RESEARCH_API}/dataset/status`),
  memoryDashboard: () =>
    fetchJson<{
      top_patterns: unknown[];
      top_reflections: unknown[];
      agent_state: Record<string, unknown>;
      stats: { total_memories: number; collections: Record<string, number> };
      learning_progress: Record<string, unknown>;
    }>(`${RESEARCH_API}/memory/dashboard`),
  memoryStats: () => fetchJson<{ total_memories: number; collections: Record<string, number> }>(`${RESEARCH_API}/memory/stats`),
  memoryRecall: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/memory/recall`, { method: "POST", body: JSON.stringify(body) }),
  agentDashboard: () =>
    fetchJson<{
      status: Record<string, unknown>;
      top_discoveries: unknown[];
      best_strategies: unknown[];
      recommendations: unknown[];
      learning_progress: Record<string, unknown>;
      pattern_insights: unknown[];
    }>(`${RESEARCH_API}/agent/dashboard`),
  agentCycle: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/agent/research/cycle`, { method: "POST" }),
  paperDashboard: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/paper/dashboard`),
  paperOrder: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/paper/order`, { method: "POST", body: JSON.stringify(body) }),
  paperPositions: () =>
    fetchJson<{ count: number; positions: unknown[] }>(`${RESEARCH_API}/paper/positions`),
  paperTrades: (limit = 50) =>
    fetchJson<{ count: number; trades: unknown[] }>(`${RESEARCH_API}/paper/trades?limit=${limit}`),
  paperPerformance: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/paper/performance`),
  liveDashboard: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/live/dashboard`),
  liveStart: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/live/start`, { method: "POST" }),
  liveStop: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/live/stop`, { method: "POST" }),
  liveOrder: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/live/order`, { method: "POST", body: JSON.stringify(body) }),
  liveClose: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/live/close`, { method: "POST", body: JSON.stringify(body) }),
  liveKillSwitch: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/live/kill-switch`, { method: "POST" }),
  livePositions: () =>
    fetchJson<{ count: number; positions: unknown[] }>(`${RESEARCH_API}/live/positions`),
  liveRisk: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/live/risk`),
  livePerformance: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/live/performance`),
  agentChat: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/agent/chat`, { method: "POST", body: JSON.stringify(body) }),
  operationsDashboard: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/operations/dashboard`),
  operationsStatus: () =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/operations/status`),
  agentTask: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/agent/task`, { method: "POST", body: JSON.stringify(body) }),
  runWorkflow: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/agent/workflow/run`, { method: "POST", body: JSON.stringify(body) }),
  controlDashboard: () =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/control/dashboard`),
  controlSettings: (body?: Record<string, unknown>) =>
    body
      ? fetchJson<Record<string, unknown>>(`${getTradingApi()}/control/settings`, { method: "POST", body: JSON.stringify(body) })
      : fetchJson<Record<string, unknown>>(`${getTradingApi()}/control/settings`),
  controlServices: () =>
    fetchJson<{ services: unknown[] }>(`${getTradingApi()}/control/dashboard`).then((d) => ({
      services: (d.services as unknown[]) || [],
    })),
  controlServiceStart: (id: string) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/control/services/${id}/start`, { method: "POST", body: "{}" }),
  controlServiceStop: (id: string) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/control/services/${id}/stop`, { method: "POST", body: "{}" }),
  controlServiceRestart: (id: string) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/control/services/${id}/restart`, { method: "POST", body: "{}" }),
  controlExchanges: () =>
    fetchJson<{ supported: string[]; exchanges: unknown[] }>(`${RESEARCH_API}/control/exchanges`),
  controlSignal: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/control/signal`, { method: "POST", body: JSON.stringify(body) }),
  controlApprove: (body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/control/approve`, { method: "POST", body: JSON.stringify(body) }),
  controlEmergency: (action: string) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/control/emergency/${action}`, { method: "POST", body: "{}" }),
  controlJournal: (limit = 100) =>
    fetchJson<{ count: number; entries: unknown[] }>(`${getTradingApi()}/control/journal?limit=${limit}`),
  controlAudit: (limit = 200, category?: string) =>
    fetchJson<{ count: number; logs: unknown[] }>(
      `${getTradingApi()}/control/audit?limit=${limit}${category ? `&category=${category}` : ""}`
    ),
};

export const tradingApi = {
  balance: () => fetchJson<{ total?: number; available?: number; error?: string; exchange_unreachable?: boolean; source?: string }>(`${getTradingApi()}/balance`),
  trades: (limit = 50) => fetchJson<unknown[]>(`${getTradingApi()}/trades?limit=${limit}`),
  openTrades: () => fetchJson<unknown[]>(`${getTradingApi()}/trades/open`),
  dashboard: () => fetchJson<Record<string, unknown>>(`${getTradingApi()}/trading/dashboard`),
  paperDashboard: () => fetchJson<Record<string, unknown>>(`${getTradingApi()}/paper/dashboard`),
  closeTrade: (id: string, body: Record<string, unknown> = {}) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/trades/${id}/close`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  partialCloseTrade: (id: string, percent = 30) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/trades/${id}/partial`, {
      method: "POST",
      body: JSON.stringify({ percent }),
    }),
  updateTradeLevels: (id: string, body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/trades/${id}/levels`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  telegramSources: () => fetchJson<{ sources: unknown[] }>(`${getTradingApi()}/telegram/sources`),
  updateTelegramSource: (id: string, body: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/telegram/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  learnTelegramFormat: (id: string) =>
    fetchJson<{ ok: boolean; message?: string }>(`${getTradingApi()}/telegram/sources/${id}/learn-format`, {
      method: "POST",
      body: "{}",
    }),
  scrapeTelegramRecent: (scanLimit = 25) =>
    fetchJson<{ ok: boolean; queued?: number; message?: string }>(`${getTradingApi()}/telegram/scrape-recent`, {
      method: "POST",
      body: JSON.stringify({ scan_limit: scanLimit, latest_signal_only: false }),
    }),
  telegramScrapeStatus: () =>
    fetchJson<{
      ok: boolean;
      active?: {
        status: string;
        total: number;
        completed: number;
        current?: string | null;
        results?: Array<{ title?: string; parsed?: number; skipped?: number; error?: string }>;
        updated_at?: string;
        error?: string;
      } | null;
      groups_with_signals?: number;
      followed_count?: number;
    }>(`${getTradingApi()}/telegram/scrape-status`),
  approveTelegramSignal: (id: string, body: { margin_usdt?: number; leverage?: number }) =>
    fetchJson<{ ok: boolean; error?: string; execution?: Record<string, unknown> }>(
      `${getTradingApi()}/telegram/messages/${id}/approve`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  revalidateTelegramSignal: (id: string) =>
    fetchJson<{ ok: boolean; passed?: boolean; error?: string }>(
      `${getTradingApi()}/telegram/messages/${id}/revalidate`,
      { method: "POST", body: "{}" }
    ),
  revalidateTelegramInbox: (limit = 50) =>
    fetchJson<{ ok: boolean; count?: number; results?: unknown[] }>(
      `${getTradingApi()}/telegram/inbox/revalidate`,
      { method: "POST", body: JSON.stringify({ limit }) }
    ),
  refreshTelegramForTest: (id: string, useAi = true) =>
    fetchJson<{
      ok: boolean;
      symbol?: string;
      mark_price?: number;
      side?: string;
      ai_analysis?: { side?: string; confidence?: number; reason?: string };
      levels?: { entry?: number; stop_loss?: number; tp1?: number; tp2?: number };
      error?: string;
    }>(`${getTradingApi()}/telegram/messages/${id}/refresh-for-test`, {
      method: "POST",
      body: JSON.stringify({ use_ai: useAi }),
    }),
  telegramTradeDefaults: (entry?: number, stopLoss?: number, symbol?: string) => {
    const q = new URLSearchParams();
    if (entry != null) q.set("entry", String(entry));
    if (stopLoss != null) q.set("stop_loss", String(stopLoss));
    if (symbol) q.set("symbol", symbol);
    const qs = q.toString();
    return fetchJson<{
      margin_usdt?: number;
      leverage?: number;
      notional_usdt?: number;
      risk_amount?: number;
      risk_percent?: number;
      sizing_mode?: string;
      can_open?: boolean;
      balance?: number;
    }>(`${getTradingApi()}/telegram/trade-defaults${qs ? `?${qs}` : ""}`);
  },
  followTelegramByNames: (names: string[], exclusive = true) =>
    fetchJson<{ ok: boolean; matched?: Array<{ title?: string }>; message?: string }>(
      `${getTradingApi()}/telegram/sources/follow-by-names`,
      { method: "POST", body: JSON.stringify({ names, exclusive }) }
    ),
  telegramInbox: (limit = 200, status?: string, chatId?: number, revalidate = false) =>
    fetchJson<{
      messages: unknown[];
      stats: Record<string, number>;
      followed_count?: number;
      followed_sources?: Array<{ id: string; title?: string; telegram_chat_id: number; is_followed?: boolean }>;
      test_mode?: boolean;
      live_listener?: boolean;
      source?: string;
    }>(
      `${getTradingApi()}/telegram/inbox?limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ""}${chatId ? `&chat_id=${chatId}` : ""}&dedupe=false${revalidate ? "&revalidate=true" : ""}`
    ),
  telegramMessages: (limit = 100, parseStatus?: string) =>
    fetchJson<{ messages: unknown[] }>(
      `${getTradingApi()}/telegram/messages?limit=${limit}${parseStatus ? `&parse_status=${encodeURIComponent(parseStatus)}` : ""}`
    ),
  signals: (limit = 20) => fetchJson<unknown[]>(`${getTradingApi()}/signals?limit=${limit}`),
  scannerStatus: () => fetchJson<{ isRunning: boolean }>(`${getTradingApi()}/scanner/status`),
  apiKeyStatus: () => fetchJson<Record<string, unknown>>(`${getTradingApi()}/settings/api-keys`),
  pairs: () => fetchJson<string[]>(`${getTradingApi()}/pairs`),
};
