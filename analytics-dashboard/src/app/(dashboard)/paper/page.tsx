"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/badge";
import { tradingApi } from "@/services/api";
import { formatNumber, formatPrice, formatUsd, formatDateTime } from "@/lib/utils";
import type { Trade } from "@/types";

export default function PaperTradingPage() {
  const { data: dash } = useQuery({
    queryKey: ["paperDashboard"],
    queryFn: () => tradingApi.paperDashboard(),
    refetchInterval: 3000,
  });

  const accounts = (dash?.accounts || []) as { balance?: number; equity?: number; unrealized_pnl?: number }[];
  const positions = (dash?.positions || []) as Trade[];
  const perf = dash?.performance as {
    win_rate?: number;
    profit_factor?: number;
    net_profit?: number;
    booked_partial_pnl?: number;
    partial_open?: number;
  } | undefined;
  const risk = dash?.risk as {
    circuit_breaker?: boolean;
    open_positions?: number;
    total_exposure?: number;
    total_margin?: number;
  } | undefined;
  const acc = accounts[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paper Trading"
        description="Live demo positions with exchange-verified SL/TP"
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/trades/positions">Live Positions</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <MetricCard label="Balance" value={formatUsd(acc?.balance)} />
        <MetricCard label="Equity" value={formatUsd(acc?.equity)} />
        <MetricCard label="Unrealized PnL" value={formatUsd(acc?.unrealized_pnl)} trend={(acc?.unrealized_pnl ?? 0) >= 0 ? "up" : "down"} />
        <MetricCard
          label="Booked (partials)"
          value={formatUsd(perf?.booked_partial_pnl)}
          trend={(perf?.booked_partial_pnl ?? 0) >= 0 ? "up" : "down"}
        />
        <MetricCard label="Exposure" value={formatUsd(risk?.total_exposure)} />
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
                      {p.protection_ok ? (
                        <Badge variant="success">Protected</Badge>
                      ) : p.protection_missing ? (
                        <Badge variant="danger">Missing SL/TP</Badge>
                      ) : null}
                      {p.tp1_hit && <Badge variant="success">TP1</Badge>}
                      {p.tp2_hit && <Badge variant="success">TP2</Badge>}
                      {p.sl_moved_breakeven && <Badge variant="secondary">BE SL</Badge>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={((p.unrealized_pnl ?? 0) >= 0) ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>
                      {formatUsd(p.unrealized_pnl)}
                    </p>
                    {(p.realized_pnl ?? 0) !== 0 && (
                      <p className="text-xs text-zinc-400">Booked {formatUsd(p.realized_pnl)}</p>
                    )}
                    {(p.profit_usd ?? p.pnl_usd) != null && (p.realized_pnl ?? 0) === 0 && (p.profit_usd ?? p.pnl_usd ?? 0) !== 0 && (
                      <p className="text-xs text-zinc-400">Total {formatUsd(p.profit_usd ?? p.pnl_usd)}</p>
                    )}
                    <p className="text-xs text-zinc-500">Runner ROE {p.roe_pct?.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500 sm:grid-cols-3">
                  <MobileStat label="Opened" value={formatDateTime(p.opened_at)} />
                  <MobileStat label="Entry" value={formatPrice(p.entry_price)} />
                  <MobileStat label="Live" value={formatPrice(p.current_price)} />
                  <MobileStat label="Leverage" value={`${p.leverage ?? "—"}x`} />
                  <MobileStat
                    label="SL"
                    value={formatPrice(p.tp2_hit ? (p.runner_stop ?? p.stop_loss) : p.stop_loss)}
                    warn={p.protection_issues?.includes("missing_sl")}
                  />
                  <MobileStat
                    label={p.tp2_hit ? "Runner floor" : "TP1"}
                    value={formatPrice(p.tp2_hit ? p.tp1 : p.tp1)}
                    warn={!p.tp1_hit && p.protection_issues?.includes("missing_tp")}
                  />
                  {!p.tp2_hit && (
                    <MobileStat label="TP2" value={formatPrice(p.tp2)} />
                  )}
                  {p.tp2_hit && <MobileStat label="Trail" value="Active (30%)" />}
                  {p.exchange_protection && (
                    <MobileStat
                      label="Exchange orders"
                      value={`SL×${p.exchange_protection.sl_count ?? 0} TP×${p.exchange_protection.tp_count ?? 0}`}
                    />
                  )}
                  {(p.tp1_hit_at || p.tp2_hit_at) && (
                    <MobileStat
                      label="TP hit"
                      value={[p.tp1_hit_at && `TP1 ${formatDateTime(p.tp1_hit_at)}`, p.tp2_hit_at && `TP2 ${formatDateTime(p.tp2_hit_at)}`].filter(Boolean).join(" · ")}
                    />
                  )}
                  <MobileStat label="Qty" value={formatNumber(p.quantity, 8)} />
                  <MobileStat label="Margin" value={formatUsd(p.margin)} />
                </div>
                {p.protection_missing && (
                  <p className="mt-2 text-[11px] text-amber-400">
                    Recovery active — check Binance Futures → Open Orders → Conditional
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MobileStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg bg-zinc-950/40 p-2">
      <p className="text-[10px] uppercase text-zinc-600">{label}</p>
      <p className={`break-words font-medium tabular-nums ${warn ? "text-amber-400" : "text-zinc-300"}`}>{value}</p>
    </div>
  );
}
