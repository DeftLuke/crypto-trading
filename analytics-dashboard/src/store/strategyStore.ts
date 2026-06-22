import { create } from "zustand";
import type { BacktestMetrics, BacktestSummary, StrategyRanking } from "@/types";

export interface StrategyRecord {
  id: string;
  name: string;
  // Status reflects the real strategy_catalog lifecycle from the backend.
  status: "draft" | "candidate" | "testing" | "validated" | "rejected" | "production" | "deployed" | "archived";
  engine?: string;
  source?: string;
  rules?: string[];
  metrics?: BacktestMetrics;
  deployment?: string;
  last_backtest_at?: string | null;
}

interface StrategyState {
  strategies: StrategyRecord[];
  rankings: StrategyRanking[];
  selectedId: string | null;
  setStrategies: (s: StrategyRecord[]) => void;
  setRankings: (r: StrategyRanking[]) => void;
  setSelectedId: (id: string | null) => void;
}

export const useStrategyStore = create<StrategyState>((set) => ({
  strategies: [],
  rankings: [],
  selectedId: null,
  setStrategies: (strategies) => set({ strategies }),
  setRankings: (rankings) => set({ rankings }),
  setSelectedId: (selectedId) => set({ selectedId }),
}));

interface BacktestState {
  running: BacktestSummary[];
  recent: BacktestSummary[];
  activeId: string | null;
  setRunning: (items: BacktestSummary[]) => void;
  setRecent: (items: BacktestSummary[]) => void;
  setActiveId: (id: string | null) => void;
}

export const useBacktestStore = create<BacktestState>((set) => ({
  running: [],
  recent: [],
  activeId: null,
  setRunning: (running) => set({ running }),
  setRecent: (recent) => set({ recent }),
  setActiveId: (activeId) => set({ activeId }),
}));
