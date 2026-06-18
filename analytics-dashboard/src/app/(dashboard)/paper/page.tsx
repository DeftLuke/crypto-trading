"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/badge";
import { tradingApi } from "@/services/api";
import { formatNumber, formatPrice, formatUsd } from "@/lib/utils";
import type { Trade } from "@/types";

export default function PaperTradingPage() {
  const { data: dash } = useQuery({
    queryKey: ["paperDashboard"],
    queryFn: () => tradingApi.paperDashboard(),
    refetchInterval: 3000,
  });

  const accounts = (dash?.accounts || []) as { balance?: number; equity?: number; unrealized_pnl?: number }[];
  const positions = (dash?.positions || []) as Trade[];
  const perf = dash?.performance as { win_rate?: number; profit_factor?: number; net_profit?: number } | undefined;
  const risk = dash?.risk as { circuit_breaker?: boolean; open_positions?: number } | undefined;
  const acc = accounts[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paper Trading"
        description="Phase 7 — real-time simulated execution before live deployment"
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/trades/positions">Live Positions</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Balance" value={formatUsd(acc?.balance)} />
        <MetricCard label="Equity" value={formatUsd(acc?.equity)} />
        <MetricCard label="Unrealized PnL" value={formatUsd(acc?.unrealized_pnl)} trend={(acc?.unrealized_pnl ?? 0) >= 0 ? "up" : "down"} />
        <MetricCard label="Win Rate" value={perf?.win_rate != null ? `${perf.win_rate.toFixed(1)}%` : "—"} />
      </div>

      {risk?.circuit_breaker && (
        <Card className="border-red-500/50">
          <CardContent className="py-3 text-sm text-red-400">Circuit breaker active — trading halted</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Open Paper Positions ({positions.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {positions.length === 0 ? (
            <p className="text-sm text-zinc-500">No open paper positions</p>
          ) : (
            positions.map((p) => (
              <div key={p.position_id || p.id} className="rounded-xl border border-zinc-800 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium">{p.symbol}</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant={p.direction === "SHORT" ? "danger" : "success"}>{p.direction}</Badge>
                      {p.tp1_hit && <Badge variant="success">TP1</Badge>}
                      {p.tp2_hit && <Badge variant="success">TP2</Badge>}
                      {p.sl_moved_breakeven && <Badge variant="secondary">BE SL</Badge>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={((p.unrealized_pnl ?? 0) >= 0) ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>
                      {formatUsd(p.unrealized_pnl)}
                    </p>
                    <p className="text-xs text-zinc-500">ROE {p.roe_pct?.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500 sm:grid-cols-3">
                  <MobileStat label="Entry" value={formatPrice(p.entry_price)} />
                  <MobileStat label="Live" value={formatPrice(p.current_price)} />
                  <MobileStat label="Leverage" value={`${p.leverage ?? "—"}x`} />
                  <MobileStat label="SL" value={formatPrice(p.stop_loss)} />
                  <MobileStat label="TP1" value={formatPrice(p.tp1)} />
                  <MobileStat label="TP2" value={formatPrice(p.tp2)} />
                  <MobileStat label="Qty" value={formatNumber(p.quantity, 8)} />
                  <MobileStat label="Margin" value={formatUsd(p.margin)} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MobileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-zinc-950/40 p-2">
      <p className="text-[10px] uppercase text-zinc-600">{label}</p>
      <p className="break-words font-medium tabular-nums text-zinc-300">{value}</p>
    </div>
  );
}
