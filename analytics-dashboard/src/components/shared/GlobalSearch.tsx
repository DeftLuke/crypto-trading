"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { tradingApi } from "@/services/api";

type Result = { type: string; label: string; href: string };

export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const router = useRouter();

  const { data: pairs = [] } = useQuery({
    queryKey: ["pairs"],
    queryFn: () => tradingApi.pairs(),
    enabled: open,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [] as Result[];
    const out: Result[] = [];

    if ("strategy".includes(term) || term.includes("strat"))
      out.push({ type: "Page", label: "Strategies", href: "/strategies" });
    if ("backtest".includes(term) || term.includes("back"))
      out.push({ type: "Page", label: "Backtests", href: "/backtests" });
    if ("signal".includes(term))
      out.push({ type: "Page", label: "Signals", href: "/signals" });
    if ("trade".includes(term))
      out.push({ type: "Page", label: "Trades", href: "/trades" });

    pairs
      .filter((p) => p.toLowerCase().includes(term))
      .slice(0, 8)
      .forEach((p) => out.push({ type: "Symbol", label: p, href: `/analytics/symbols?symbol=${p}` }));

    return out;
  }, [q, pairs]);

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-[20%] z-50 w-[95vw] max-w-lg -translate-x-1/2 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
            <Search className="h-4 w-4 text-zinc-500" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search strategies, trades, backtests, symbols…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
            />
            <Dialog.Close asChild>
              <button type="button">
                <X className="h-4 w-4 text-zinc-500" />
              </button>
            </Dialog.Close>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {results.length === 0 ? (
              <p className="p-3 text-center text-xs text-zinc-500">Type to search…</p>
            ) : (
              results.map((r) => (
                <button
                  key={`${r.type}-${r.label}`}
                  type="button"
                  onClick={() => go(r.href)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-900"
                >
                  <span>{r.label}</span>
                  <span className="text-[10px] uppercase text-zinc-600">{r.type}</span>
                </button>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
