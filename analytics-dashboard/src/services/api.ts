import { RESEARCH_API, getTradingApi } from "@/lib/constants";
import type { ResearchHealth } from "@/types";

export type SignalFeedRow = {
  id: string;
  symbol: string;
  direction: string;
  confidence?: number;
  source?: string;
  source_group?: string | null;
  strategy_name?: string;
  execution_status?: string;
  final_outcome?: string | null;
  trade_id?: string | null;
  pnl?: number | null;
  stop_loss?: number;
  tp1?: number;
  tp2?: number;
  created_at?: string;
};

export type StrategyCatalogRow = {
  id: string;
  name: string;
  status: string;
  engine?: string;
  source?: string;
  rules?: string[];
  deployment?: string;
  metrics?: import("@/types").BacktestMetrics;
  last_backtest_at?: string | null;
};

export type MarketDataTimeframeProgress = {
  timeframe: string;
  total_months: number;
  completed_months: number;
  converted: number;
  bars: number;
  min_bars: number;
  ready: boolean;
  fresh: boolean;
  status: string;
  pct: number;
  message?: string;
};

export type MarketDataSymbolProgress = {
  symbol: string;
  status: string;
  overall_pct: number;
  message?: string;
  updated_at?: string;
  timeframes: Record<string, MarketDataTimeframeProgress>;
};

export type MarketDataPhaseProgress = {
  phase: number;
  symbols: string[];
  status: string;
  overall_pct: number;
  symbols_complete: number;
  symbols_total: number;
  started_at?: string | null;
  finished_at?: string | null;
  symbol_progress: Record<string, MarketDataSymbolProgress>;
};

export type MarketDataProgress = {
  job_id: string;
  auto_download: boolean;
  auto_update: boolean;
  paused: boolean;
  phase_size: number;
  total_phases: number;
  current_phase: number;
  global_status: string;
  global_pct: number;
  universe_size: number;
  last_error?: string;
  updated_at?: string;
  phases: MarketDataPhaseProgress[];
};

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
    fetchJson<{ backtest_id: string; status: string; source?: string }>(`${RESEARCH_API}/backtest/start`, { method: "POST", body: JSON.stringify(body) }),
  backtestEstimate: (body: Record<string, unknown>) =>
    fetchJson<{
      symbols: number;
      total_bars: number;
      estimated_minutes: number;
      memory_warning: boolean;
      heap_limit_mb: number;
      recommendation: string;
      source?: string;
    }>(`${RESEARCH_API}/backtest/estimate`, { method: "POST", body: JSON.stringify(body) }),
  topFuturesSymbols: (limit = 50) =>
    fetchJson<{ symbols: string[]; count: number }>(`${RESEARCH_API}/symbols/futures/top?limit=${limit}`),
  strategyRegistry: () =>
    fetchJson<{ strategies: Array<{ id: string; name: string; version: string; engine: string; description: string }> }>(
      `${RESEARCH_API}/strategies/registry`
    ),
  syncBatch: (body: { exchange?: string; symbols: string[]; timeframes?: string[]; full?: boolean }) =>
    fetchJson<{ started: number; failed: number; symbols: string[]; timeframes: string[] }>(
      `${RESEARCH_API}/sync/batch`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  syncStart: (body: { exchange: string; symbol: string; timeframe: string; full?: boolean }) =>
    fetchJson<Record<string, unknown>>(`${RESEARCH_API}/sync/start`, { method: "POST", body: JSON.stringify(body) }),
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
  marketDataProgress: () => fetchJson<MarketDataProgress>(`${RESEARCH_API}/market-data/jobs/progress`),
  marketDataStartPhase: (phase?: number) =>
    fetchJson<MarketDataProgress>(`${RESEARCH_API}/market-data/jobs/start`, {
      method: "POST",
      body: JSON.stringify(phase != null ? { phase } : {}),
    }),
  marketDataAuto: (autoDownload: boolean, autoUpdate = true) =>
    fetchJson<MarketDataProgress>(`${RESEARCH_API}/market-data/jobs/auto`, {
      method: "POST",
      body: JSON.stringify({ auto_download: autoDownload, auto_update: autoUpdate }),
    }),
  marketDataPause: () =>
    fetchJson<MarketDataProgress>(`${RESEARCH_API}/market-data/jobs/pause`, { method: "POST", body: "{}" }),
  marketDataResume: () =>
    fetchJson<MarketDataProgress>(`${RESEARCH_API}/market-data/jobs/resume`, { method: "POST", body: "{}" }),
  marketDataRefreshUniverse: () =>
    fetchJson<MarketDataProgress>(`${RESEARCH_API}/market-data/jobs/refresh-universe`, { method: "POST", body: "{}" }),
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
  trades: (limit = 1000, status = "all") =>
    fetchJson<unknown[]>(`${getTradingApi()}/trades?limit=${limit}&status=${status}`),
  signalFeed: (limit = 100) =>
    fetchJson<{ signals: SignalFeedRow[] }>(`${getTradingApi()}/analytics/signals/feed?limit=${limit}`),
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
      last_live_at?: string | null;
      control?: { auto_trading?: boolean; manual_approval?: boolean; mode?: string };
    }>(
      `${getTradingApi()}/telegram/inbox?limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ""}${chatId ? `&chat_id=${chatId}` : ""}&dedupe=false${revalidate ? "&revalidate=true" : ""}`
    ),
  telegramMessages: (limit = 100, parseStatus?: string) =>
    fetchJson<{ messages: unknown[] }>(
      `${getTradingApi()}/telegram/messages?limit=${limit}${parseStatus ? `&parse_status=${encodeURIComponent(parseStatus)}` : ""}`
    ),
  telegramRawMessages: (limit = 100, opts?: { sourceId?: string; status?: string; offset?: number }) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (opts?.sourceId) q.set("source_id", opts.sourceId);
    if (opts?.status) q.set("status", opts.status);
    if (opts?.offset) q.set("offset", String(opts.offset));
    return fetchJson<{ messages: unknown[]; count: number }>(`${getTradingApi()}/telegram/raw?${q}`);
  },
  telegramRawMessage: (id: string) =>
    fetchJson<{ message: Record<string, unknown> }>(`${getTradingApi()}/telegram/raw/${id}`),
  telegramParsedSignals: (limit = 100, opts?: { sourceId?: string; offset?: number }) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (opts?.sourceId) q.set("source_id", opts.sourceId);
    if (opts?.offset) q.set("offset", String(opts.offset));
    return fetchJson<{ signals: unknown[]; count: number }>(`${getTradingApi()}/telegram/parsed?${q}`);
  },
  telegramRejectedSignals: (limit = 100, opts?: { sourceId?: string; stage?: string; offset?: number }) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (opts?.sourceId) q.set("source_id", opts.sourceId);
    if (opts?.stage) q.set("stage", opts.stage);
    if (opts?.offset) q.set("offset", String(opts.offset));
    return fetchJson<{ rejections: unknown[]; count: number }>(`${getTradingApi()}/telegram/rejected?${q}`);
  },
  telegramGroupMemory: (sourceId?: string) =>
    fetchJson<{ groups: unknown[] }>(
      `${getTradingApi()}/telegram/group-memory${sourceId ? `?source_id=${encodeURIComponent(sourceId)}` : ""}`
    ),
  telegramArchiveRecent: (limit = 50, sourceId?: string) =>
    fetchJson<{ ok: boolean; queued: number; message?: string }>(`${getTradingApi()}/telegram/archive/recent`, {
      method: "POST",
      body: JSON.stringify({ limit, source_id: sourceId }),
    }),
  signals: (limit = 20) => fetchJson<unknown[]>(`${getTradingApi()}/signals?limit=${limit}`),
  signalAnalytics: (days = 90) =>
    fetchJson<{
      ok: boolean;
      summary: {
        total_signals: number;
        executed_trades: number;
        win_rate: number;
        avg_r: number;
        avg_latency_ms: number;
        avg_latency_sec: number;
        lessons: Record<string, { wins: number; losses: number }>;
      };
      by_source: Array<Record<string, unknown>>;
      by_strategy: Array<Record<string, unknown>>;
      by_group: Array<Record<string, unknown>>;
      phase4_ready?: Record<string, unknown>;
    }>(`${getTradingApi()}/analytics/signals?days=${days}`),
  recentLessons: (limit = 30) =>
    fetchJson<{ lessons: Array<Record<string, unknown>> }>(`${getTradingApi()}/analytics/lessons/recent?limit=${limit}`),
  backtestGate: (strategyId: string) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/strategy/backtest-gate/${encodeURIComponent(strategyId)}`),
  scannerStatus: () => fetchJson<{
    isRunning: boolean;
    scanning?: boolean;
    progress_pct?: number;
    pairs_scanned?: number;
    universe_size?: number;
    engine?: string;
    engine_label?: string;
    signals_found?: number;
    lastScanAt?: string;
    next_scan_in_sec?: number | null;
  }>(`${getTradingApi()}/scanner/status`),
  signalEngineStatus: () => fetchJson<Record<string, unknown>>(`${getTradingApi()}/signal-engine/status`),
  setSignalEngine: (signal_engine: string) =>
    fetchJson<Record<string, unknown>>(`${getTradingApi()}/signal-engine`, {
      method: "POST",
      body: JSON.stringify({ signal_engine, actor: "risk-dashboard" }),
    }),
  apiKeyStatus: () => fetchJson<Record<string, unknown>>(`${getTradingApi()}/settings/api-keys`),
  pairs: () => fetchJson<string[]>(`${getTradingApi()}/pairs`),
  strategyCatalog: () => fetchJson<{ strategies: StrategyCatalogRow[] }>(`${getTradingApi()}/strategies/catalog`),
  rsiScalperStatus: () =>
    fetchJson<{
      running: boolean;
      mode: string;
      equity?: number;
      balance?: number;
      position?: {
        symbol: string;
        direction: string;
        entry_price: number;
        current_price: number;
        quantity: number;
        unrealized_pnl: number;
        stop_loss: number;
        take_profit: number;
      } | null;
      last_heartbeat?: string;
      last_signal_at?: string;
      daily_pnl?: number;
      daily_limit?: number;
      errors_last_hour?: number;
    }>(`${getTradingApi()}/bots/rsi-scalper/status`),
  rsiScalperSignals: (limit = 50) =>
    fetchJson<{ signals: unknown[] }>(`${getTradingApi()}/bots/rsi-scalper/signals?limit=${limit}`),
  rsiScalperTrades: (limit = 100) =>
    fetchJson<{ trades: unknown[] }>(`${getTradingApi()}/bots/rsi-scalper/trades?limit=${limit}`),
};
