import { create } from "zustand";
import type { Trade } from "@/types";

interface TradeState {
  open: Trade[];
  closed: Trade[];
  setOpen: (t: Trade[]) => void;
  setClosed: (t: Trade[]) => void;
  upsertOpen: (t: Trade) => void;
  removeOpen: (id: string) => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  open: [],
  closed: [],
  setOpen: (open) => set({ open }),
  setClosed: (closed) => set({ closed }),
  upsertOpen: (trade) =>
    set((s) => ({
      open: [...s.open.filter((t) => (t.trade_id || t.id) !== (trade.trade_id || trade.id)), trade],
    })),
  removeOpen: (id) => set((s) => ({ open: s.open.filter((t) => (t.trade_id || t.id) !== id) })),
}));
