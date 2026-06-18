import { create } from "zustand";
import type { SmcStat, SessionStat, EquityPoint, FilterState } from "@/types";

interface AnalyticsState {
  smc: SmcStat[];
  sessions: SessionStat[];
  equity: EquityPoint[];
  filters: FilterState;
  setSmc: (s: SmcStat[]) => void;
  setSessions: (s: SessionStat[]) => void;
  setEquity: (e: EquityPoint[]) => void;
  setFilters: (f: Partial<FilterState>) => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  smc: [],
  sessions: [],
  equity: [],
  filters: {},
  setSmc: (smc) => set({ smc }),
  setSessions: (sessions) => set({ sessions }),
  setEquity: (equity) => set({ equity }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
}));
