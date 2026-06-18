"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOpenTrades } from "@/hooks/useQueries";
import { formatUsd, formatNumber, formatPrice } from "@/lib/utils";
import { tradingApi } from "@/services/api";
import { toast } from "sonner";
import type { Trade } from "@/types";

export default function PositionsPage() {
  const qc = useQueryClient();
  const { data: positions = [] } = useOpenTrades();
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["openTrades"] });
    qc.invalidateQueries({ queryKey: ["trades"] });
    qc.invalidateQueries({ queryKey: ["tradingDashboard"] });
  };

  const closeMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body?: Record<string, unknown> }) => tradingApi.closeTrade(id, body),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: () => {
      toast.success("Position update sent to Binance");
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Position action failed"),
    onSettled: () => setBusyId(null),
  });

  const partialMutation = useMutation({
    mutationFn: ({ id, percent }: { id: string; percent: number }) => tradingApi.partialCloseTrade(id, percent),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: () => {
      toast.success("Partial close sent to Binance");
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Partial close failed"),
    onSettled: () => setBusyId(null),
  });

  const levelsMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => tradingApi.updateTradeLevels(id, body),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: () => {
      toast.success("TP/SL updated");
      refresh();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "TP/SL update failed"),
    onSettled: () => setBusyId(null),
  });

  const closePosition = (p: Trade) => {
    if (!p.id || !window.confirm(`Close ${p.symbol} ${p.direction}?`)) return;
    closeMutation.mutate({ id: p.id, body: { reason: "Manual dashboard close" } });
  };

  const partialClose = (p: Trade) => {
    if (!p.id) return;
    const raw = window.prompt("Close what percent of current position?", "30");
    if (!raw) return;
    const percent = Number(raw);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      toast.error("Enter a percent between 1 and 100");
      return;
    }
    partialMutation.mutate({ id: p.id, percent });
  };

  const updateLevels = (p: Trade, field: "stop_loss" | "tp1") => {
    if (!p.id) return;
    const label = field === "stop_loss" ? "Stop loss" : "TP1";
    const current = field === "stop_loss" ? p.stop_loss : p.tp1;
    const raw = window.prompt(`New ${label} for ${p.symbol}`, current != null ? String(current) : "");
    if (!raw) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter a valid price");
      return;
    }
    levelsMutation.mutate({ id: p.id, body: { [field]: value } });
  };

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-hidden md:h-[calc(100vh-7rem)] md:gap-6">
      <PageHeader title="Active Positions" description="Manage open positions — paper/live trading (Phase 7/8)" />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto md:space-y-4 md:pr-2">
        {positions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-zinc-500">
              No open positions. Connect Binance API in Settings for live data.
            </CardContent>
          </Card>
        ) : (
          positions.map((p, i) => (
            <Card key={p.id || i} className="overflow-hidden">
              <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base sm:text-lg">{p.symbol}</CardTitle>
                  <p className="mt-1 text-xs text-zinc-500">
                    {p.status || "open"} · {p.leverage ?? 1}x · Qty {formatNumber(p.quantity, 6)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge variant={p.direction === "SHORT" ? "danger" : "success"}>{p.direction}</Badge>
                  <p className={`mt-2 text-sm font-semibold tabular-nums ${(p.profit_usd ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {formatUsd(p.profit_usd)}
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
                  <Stat label="Entry" value={formatPrice(p.entry_price)} />
                  <Stat label="Live Price" value={formatPrice(p.current_price)} />
                  <Stat
                    label="PnL"
                    value={formatUsd(p.profit_usd)}
                    valueClassName={(p.profit_usd ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}
                  />
                  <Stat label="Leverage" value={`${p.leverage ?? 1}x`} />
                  <Stat label="SL / TP1 / TP2" value={`${formatPrice(p.stop_loss)} / ${formatPrice(p.tp1)} / ${formatPrice(p.tp2)}`} />
                  <Stat label="Qty" value={formatNumber(p.quantity, 8)} />
                  <Stat label="Margin" value={formatUsd(p.margin)} />
                  <Stat label="ROE" value={`${formatNumber(p.roe_pct)}%`} />
                  <Stat label="State" value={`${p.tp1_hit ? "TP1 " : ""}${p.tp2_hit ? "TP2 " : ""}${p.sl_moved_breakeven ? "BE" : p.status || "open"}`} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  <Button className="w-full sm:w-auto" size="sm" variant="destructive" disabled={busyId === p.id} onClick={() => closePosition(p)}>Close</Button>
                  <Button className="w-full sm:w-auto" size="sm" variant="secondary" disabled={busyId === p.id} onClick={() => partialClose(p)}>Partial</Button>
                  <Button className="w-full sm:w-auto" size="sm" variant="secondary" disabled={busyId === p.id} onClick={() => updateLevels(p, "stop_loss")}>Move SL</Button>
                  <Button className="w-full sm:w-auto" size="sm" variant="secondary" disabled={busyId === p.id} onClick={() => updateLevels(p, "tp1")}>Move TP1</Button>
                  <Button className="w-full sm:w-auto" size="sm" variant="ghost" disabled>Leverage</Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, valueClassName = "" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-950/30 p-2 sm:border-0 sm:bg-transparent sm:p-0">
      <p className="text-[10px] uppercase text-zinc-500">{label}</p>
      <p className={`break-words font-medium tabular-nums ${valueClassName}`}>{value}</p>
    </div>
  );
}
