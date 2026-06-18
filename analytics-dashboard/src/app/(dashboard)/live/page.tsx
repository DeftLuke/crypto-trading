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

export default function LiveTradingPage() {
  const { data: dash } = useQuery({
    queryKey: ["liveDashboard"],
    queryFn: () => tradingApi.dashboard(),
    refetchInterval: 3000,
  });

  const accounts = (dash?.accounts || []) as { balance?: number; equity?: number; unrealized_pnl?: number }[];
  const positions = (dash?.positions || []) as Trade[];
  const perf = dash?.performance as { win_rate?: number; profit_factor?: number; net_profit?: number } | undefined;
  const risk = dash?.risk as { active?: boolean; kill_switch?: boolean; open_positions?: number } | undefined;
  const health = dash?.health as { dry_run?: boolean; exchange_connected?: boolean; running?: boolean } | undefined;
  const execution = dash?.execution as { fill_rate_pct?: number; avg_latency_ms?: number } | undefined;
  const acc = accounts[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Trading"
        description="Phase 8 — institutional execution layer with risk-first controls"
        actions={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button asChild variant="secondary" size="sm">
              <Link href="/paper">Paper Trading</Link>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled
              onClick={() => {
                window.alert("Use Active Positions to close trades individually. Kill switch endpoint is not enabled yet.");
              }}
            >
              Kill Switch
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant={health?.running ? "success" : "secondary"}>
          {health?.running ? "Engine Running" : "Engine Stopped"}
        </Badge>
        <Badge variant={health?.dry_run ? "secondary" : "danger"}>
          {health?.dry_run ? "Dry Run" : "LIVE"}
        </Badge>
        <Badge variant={health?.exchange_connected ? "success" : "secondary"}>
          Exchange {health?.exchange_connected ? "Connected" : "Disconnected"}
        </Badge>
        {risk?.kill_switch && <Badge variant="danger">Kill Switch Active</Badge>}
        {risk?.active && !risk?.kill_switch && <Badge variant="danger">Circuit Breaker</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Equity" value={formatUsd(acc?.equity)} />
        <MetricCard label="Balance" value={formatUsd(acc?.balance)} />
        <MetricCard label="Unrealized PnL" value={formatUsd(acc?.unrealized_pnl)} trend={(acc?.unrealized_pnl ?? 0) >= 0 ? "up" : "down"} />
        <MetricCard label="Fill Rate" value={execution?.fill_rate_pct != null ? `${execution.fill_rate_pct}%` : "—"} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Win Rate" value={perf?.win_rate != null ? `${perf.win_rate.toFixed(1)}%` : "—"} />
        <MetricCard label="Profit Factor" value={perf?.profit_factor?.toFixed(2) ?? "—"} />
        <MetricCard label="Avg Latency" value={execution?.avg_latency_ms != null ? `${execution.avg_latency_ms}ms` : "—"} />
      </div>

      <Card>
        <CardHeader><CardTitle>Open Live Positions ({positions.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {positions.length === 0 ? (
            <p className="text-sm text-zinc-500">No open live positions</p>
          ) : (
            positions.map((p) => (
              <div key={p.position_id} className="rounded-xl border border-zinc-800 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium">{p.symbol}</span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant={p.direction === "SHORT" ? "danger" : "success"}>{p.direction}</Badge>
                      <Badge variant="secondary">{p.leverage}x</Badge>
                      {p.tp1_hit && <Badge variant="success">TP1</Badge>}
                      {p.tp2_hit && <Badge variant="success">TP2</Badge>}
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
