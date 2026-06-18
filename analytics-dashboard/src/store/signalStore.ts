import { create } from "zustand";
import type { Signal } from "@/types";

interface SignalState {
  latest: Signal[];
  history: Signal[];
  setLatest: (s: Signal[]) => void;
  prepend: (s: Signal) => void;
}

export const useSignalStore = create<SignalState>((set) => ({
  latest: [],
  history: [],
  setLatest: (latest) => set({ latest }),
  prepend: (signal) =>
    set((s) => ({ latest: [signal, ...s.latest].slice(0, 50), history: [signal, ...s.history].slice(0, 500) })),
}));
