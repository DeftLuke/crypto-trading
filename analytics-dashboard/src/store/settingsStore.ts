import { create } from "zustand";
import type { FilterState } from "@/types";

type Theme = "light" | "dark" | "system";

interface SettingsState {
  theme: Theme;
  sidebarCollapsed: boolean;
  filters: FilterState;
  setTheme: (t: Theme) => void;
  setSidebarCollapsed: (c: boolean) => void;
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  resetFilters: () => void;
}

const defaultFilters: FilterState = {};

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "dark",
  sidebarCollapsed: false,
  filters: defaultFilters,
  setTheme: (theme) => set({ theme }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setFilter: (key, value) => set((s) => ({ filters: { ...s.filters, [key]: value } })),
  resetFilters: () => set({ filters: defaultFilters }),
}));
