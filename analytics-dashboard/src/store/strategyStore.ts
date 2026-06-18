import { create } from "zustand";
import type { BacktestMetrics, BacktestSummary, StrategyRanking } from "@/types";

export interface StrategyRecord {
  id: string;
  name: string;
  status: "draft" | "testing" | "validated" | "rejected" | "deployed";
  rules?: string[];
  metrics?: BacktestMetrics;
  deployment?: string;
}

const DEFAULT_STRATEGIES: StrategyRecord[] = [
  {
    id: "smc-v2",
    name: "SMC Liquidity Sweep v2",
    status: "validated",
    rules: ["Bearish BOS", "OB retest", "RSI > 70"],
    metrics: { win_rate: 58, profit_factor: 2.1, sharpe_ratio: 1.8, max_drawdown_pct: 12.4 },
    deployment: "paper",
  },
  {
    id: "ema-align",
    name: "EMA Alignment Scalper",
    status: "testing",
    rules: ["EMA 9/21 cross", "Volume spike"],
    metrics: { win_rate: 52, profit_factor: 1.6, sharpe_ratio: 1.2, max_drawdown_pct: 18 },
  },
  {
    id: "session-bias",
    name: "London Session Bias",
    status: "validated",
    rules: ["London open", "Asian range break"],
    metrics: { win_rate: 61, profit_factor: 2.4, sharpe_ratio: 2.0, max_drawdown_pct: 9.8 },
    deployment: "live",
  },
];

interface StrategyState {
  strategies: StrategyRecord[];
  rankings: StrategyRanking[];
  selectedId: string | null;
  setStrategies: (s: StrategyRecord[]) => void;
  setRankings: (r: StrategyRanking[]) => void;
  setSelectedId: (id: string | null) => void;
}

export const useStrategyStore = create<StrategyState>((set) => ({
  strategies: DEFAULT_STRATEGIES,
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
