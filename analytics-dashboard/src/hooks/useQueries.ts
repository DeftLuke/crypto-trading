"use client";

import { useQuery } from "@tanstack/react-query";
import { researchApi, tradingApi } from "@/services/api";
import type { BacktestSummary, Signal, Trade } from "@/types";
import { useSettingsStore } from "@/store/settingsStore";

function applyTradeFilters(trades: Trade[], filters: ReturnType<typeof useSettingsStore.getState>["filters"]) {
  return trades.filter((t) => {
    if (filters.symbol && !t.symbol?.toUpperCase().includes(filters.symbol.toUpperCase())) return false;
    if (filters.direction && t.direction !== filters.direction) return false;
    if (filters.session && t.session !== filters.session) return false;
    if (filters.result === "win" && (t.profit_usd ?? 0) <= 0) return false;
    if (filters.result === "loss" && (t.profit_usd ?? 0) >= 0) return false;
    return true;
  });
}

export function useBalance() {
  return useQuery({
    queryKey: ["balance"],
    queryFn: () => tradingApi.balance(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useTrades(limit = 200) {
  const filters = useSettingsStore((s) => s.filters);
  return useQuery({
    queryKey: ["trades", limit, filters],
    queryFn: async () => {
      const raw = (await tradingApi.trades(limit)) as Trade[];
      return applyTradeFilters(raw, filters);
    },
    // History changes slowly — 15s background refresh (was 5s) + staleTime keeps
    // the cached view instant on navigation instead of re-fetching every mount.
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}

export function useOpenTrades() {
  return useQuery({
    queryKey: ["openTrades"],
    queryFn: () => tradingApi.openTrades() as Promise<Trade[]>,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useTradingDashboard() {
  return useQuery({
    queryKey: ["tradingDashboard"],
    queryFn: () => tradingApi.dashboard() as Promise<import("@/types").TradingDashboard>,
    refetchInterval: 10_000,
  });
}

export function useSignals(limit = 50) {
  return useQuery({
    queryKey: ["signals", limit],
    queryFn: async () => {
      try {
        const r = await researchApi.signals(limit);
        return (r.signals || []) as Signal[];
      } catch {
        return (await tradingApi.signals(limit)) as Signal[];
      }
    },
    refetchInterval: 15_000,
  });
}

export function useSignalFeed(limit = 100) {
  return useQuery({
    queryKey: ["signalFeed", limit],
    queryFn: async () => {
      const r = await tradingApi.signalFeed(limit);
      return r.signals || [];
    },
    refetchInterval: 10_000,
  });
}

export function useResearchHealth() {
  return useQuery({
    queryKey: ["researchHealth"],
    queryFn: () => researchApi.health(),
    refetchInterval: 30_000,
  });
}

export function useDatasetStatus() {
  return useQuery({
    queryKey: ["datasetStatus"],
    queryFn: () => researchApi.datasetStatus(),
    refetchInterval: 60_000,
  });
}

export function useScannerStatus() {
  return useQuery({
    queryKey: ["scannerStatus"],
    queryFn: () => tradingApi.scannerStatus(),
    refetchInterval: (query) => (query.state.data?.scanning ? 2000 : 8000),
  });
}

export function useBacktestStatus(id: string | null) {
  return useQuery({
    queryKey: ["backtestStatus", id],
    queryFn: () => researchApi.backtestStatus(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const status = (q.state.data as { status?: string })?.status;
      return status === "running" || status === "queued" ? 3000 : false;
    },
  });
}

export function useBacktestResults(id: string | null) {
  return useQuery({
    queryKey: ["backtestResults", id],
    queryFn: () => researchApi.backtestResults(id!),
    enabled: !!id,
  });
}

export function useBacktestEquity(id: string | null) {
  return useQuery({
    queryKey: ["backtestEquity", id],
    queryFn: async () => {
      const r = await researchApi.backtestEquity(id!);
      return r.equity as { ts: number; balance: number; drawdown_pct?: number }[];
    },
    enabled: !!id,
  });
}

export function useBacktestTrades(id: string | null) {
  return useQuery({
    queryKey: ["backtestTrades", id],
    queryFn: async () => {
      const r = await researchApi.backtestTrades(id!, 2000);
      return r.trades as Trade[];
    },
    enabled: !!id,
  });
}

export function useBacktestSessions(id: string | null) {
  return useQuery({
    queryKey: ["backtestSessions", id],
    queryFn: async () => {
      const r = await researchApi.backtestSessions(id!);
      return r.sessions;
    },
    enabled: !!id,
  });
}

export function useBacktestSmc(id: string | null) {
  return useQuery({
    queryKey: ["backtestSmc", id],
    queryFn: async () => {
      const r = await researchApi.backtestSmc(id!);
      return r.smc;
    },
    enabled: !!id,
  });
}

/** Recent backtest IDs from localStorage + demo fallback */
export function getRecentBacktests(): BacktestSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("recent_backtests");
    return raw ? (JSON.parse(raw) as BacktestSummary[]) : [];
  } catch {
    return [];
  }
}

export function useRecentBacktests(): BacktestSummary[] {
  return getRecentBacktests();
}

export function pushRecentBacktest(summary: BacktestSummary) {
  if (typeof window === "undefined") return;
  const existing = getRecentBacktests().filter((b) => b.backtest_id !== summary.backtest_id);
  localStorage.setItem("recent_backtests", JSON.stringify([summary, ...existing].slice(0, 20)));
}

export function useStrategyCatalog() {
  return useQuery({
    queryKey: ["strategyCatalog"],
    queryFn: async () => {
      const r = await tradingApi.strategyCatalog();
      return r.strategies || [];
    },
    refetchInterval: 30_000,
  });
}
