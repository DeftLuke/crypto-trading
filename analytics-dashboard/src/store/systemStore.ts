import { create } from "zustand";
import type { SystemHealth } from "@/types";

interface SystemState {
  health: SystemHealth | null;
  wsConnected: boolean;
  lastUpdate: number | null;
  setHealth: (h: SystemHealth) => void;
  setWsConnected: (c: boolean) => void;
}

export const useSystemStore = create<SystemState>((set) => ({
  health: null,
  wsConnected: false,
  lastUpdate: null,
  setHealth: (health) => set({ health, lastUpdate: Date.now() }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
}));
