"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PageHeader, exportCsv } from "@/components/shared/PageHeader";
import { GlobalFilters } from "@/components/shared/GlobalFilters";
import { VirtualTable } from "@/components/shared/VirtualTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChartSimple } from "@/components/charts/RechartsPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/badge";
import { useOpenTrades, useTrades } from "@/hooks/useQueries";
import { formatUsd, formatPct, formatPrice, formatDateTime } from "@/lib/utils";
import type { Trade } from "@/types";

function tradePnl(t: Trade) {
  return t.realized_pnl ?? t.profit_usd ?? t.pnl_usd ?? t.pnl ?? 0;
}

function tradeBookedPnl(t: Trade) {
  return t.realized_pnl ?? t.exchange_realized_pnl ?? 0;
}

function isToday(iso?: string) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function isThisMonth(iso?: string) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

export default function TradesPage() {
  const { data: trades = [] } = useTrades(1000);
  const { data: open = [] } = useOpenTrades();
  const closed = trades.filter((t) => t.status !== "open" && t.status !== "partial");

  const dailyPnl = useMemo(
    () => closed.filter((t) => isToday(t.closed_at as string)).reduce((s, t) => s + tradePnl(t), 0),
    [closed]
  );
  const monthlyPnl = useMemo(
    () => closed.filter((t) => isThisMonth(t.closed_at as string)).reduce((s, t) => s + tradePnl(t), 0),
    [closed]
  );
  const winRate = closed.length
    ? (closed.filter((t) => tradePnl(t) > 0).length / closed.length) * 100
    : 0;

  const pnlBuckets = [
    { label: "<-2%", value: closed.filter((t) => (t.profit_percent ?? t.pnl_pct ?? t.roe_pct ?? 0) < -2).length },
    { label: "-2–0", value: closed.filter((t) => (t.profit_percent ?? t.pnl_pct ?? 0) >= -2 && (t.profit_percent ?? t.pnl_pct ?? 0) < 0).length },
    { label: "0–2%", value: closed.filter((t) => (t.profit_percent ?? t.pnl_pct ?? 0) >= 0 && (t.profit_percent ?? t.pnl_pct ?? 0) < 2).length },
    { label: ">2%", value: closed.filter((t) => (t.profit_percent ?? t.pnl_pct ?? t.roe_pct ?? 0) >= 2).length },
  ];

  const tpLabel = (r: Trade) => {
    const hits = [r.tp1_hit && "TP1", r.tp2_hit && "TP2", r.tp3_hit && "TP3"].filter(Boolean);
    return hits.length ? hits.join(", ") : "—";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade Analytics"
        description="Full history with margin, ROI, and take-profit tracking"
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href="/trades/positions">Open Positions</Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => exportCsv("trades.csv", trades as unknown as Record<string, unknown>[])}>
              Export CSV
            </Button>
          </>
        }
      />
      <GlobalFilters />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Today PnL" value={formatUsd(dailyPnl)} trend={dailyPnl >= 0 ? "up" : "down"} />
        <MetricCard label="Month PnL" value={formatUsd(monthlyPnl)} trend={monthlyPnl >= 0 ? "up" : "down"} />
        <MetricCard label="Win rate" value={formatPct(winRate, 1)} />
        <MetricCard label="Open positions" value={String(open.length)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>PnL Distribution</CardTitle></CardHeader>
          <CardContent><BarChartSimple data={pnlBuckets} /></CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Open Trades ({open.length})</CardTitle></CardHeader>
          <CardContent>
            <VirtualTable<Trade>
              rows={open}
              maxHeight={220}
              columns={[
                { key: "symbol", header: "Symbol", width: "90px" },
                { key: "direction", header: "Dir", width: "60px" },
                { key: "entry_price", header: "Entry", width: "80px", render: (r) => formatPrice(r.entry_price) },
                { key: "margin", header: "Margin", width: "80px", render: (r) => formatUsd(r.margin) },
                { key: "leverage", header: "Lev", width: "50px" },
                { key: "roe_pct", header: "ROI", width: "70px", render: (r) => formatPct(r.roe_pct ?? r.profit_percent) },
                { key: "profit_usd", header: "PnL", width: "80px", render: (r) => formatUsd(tradePnl(r)) },
                {
                  key: "booked",
                  header: "Booked",
                  width: "80px",
                  render: (r) => (tradeBookedPnl(r) ? formatUsd(tradeBookedPnl(r)) : "—"),
                },
                { key: "tp", header: "TP hits", width: "80px", render: (r) => tpLabel(r) },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <VirtualTable<Trade>
        rows={closed}
        columns={[
          { key: "symbol", header: "Symbol", width: "90px" },
          { key: "direction", header: "Dir", width: "60px" },
          {
            key: "opened_at",
            header: "Opened",
            width: "130px",
            render: (r) => formatDateTime(r.opened_at),
          },
          {
            key: "closed_at",
            header: "Closed",
            width: "130px",
            render: (r) => formatDateTime(r.closed_at),
          },
          {
            key: "result",
            header: "Result",
            width: "70px",
            render: (r) => (
              <Badge variant={tradePnl(r) >= 0 ? "success" : "danger"}>
                {tradePnl(r) >= 0 ? "WIN" : "LOSS"}
              </Badge>
            ),
          },
          { key: "entry_price", header: "Entry", width: "80px", render: (r) => formatPrice(r.entry_price) },
          { key: "exit_price", header: "Exit", width: "80px", render: (r) => formatPrice(r.exit_price) },
          { key: "margin", header: "Margin", width: "80px", render: (r) => formatUsd(r.margin) },
          { key: "notional", header: "Size", width: "90px", render: (r) => formatUsd(r.notional) },
          { key: "leverage", header: "Lev", width: "50px" },
          { key: "profit_usd", header: "PnL", width: "85px", render: (r) => formatUsd(tradePnl(r)) },
          { key: "roe_pct", header: "ROI", width: "70px", render: (r) => formatPct(r.roe_pct ?? r.profit_percent ?? r.pnl_pct) },
          { key: "tp", header: "TP", width: "70px", render: (r) => tpLabel(r) },
          { key: "status", header: "Status", width: "70px" },
        ]}
      />
    </div>
  );
}
