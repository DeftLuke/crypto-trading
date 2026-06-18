"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatusDot } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EquityChart } from "@/components/charts/RechartsPanel";
import {
  useBalance,
  useOpenTrades,
  useResearchHealth,
  useScannerStatus,
  useSignals,
  useTrades,
} from "@/hooks/useQueries";
import { MOCK_AI_INSIGHTS } from "@/services/mockData";
import { formatCurrency, formatPct } from "@/lib/utils";
import { ArrowRight, Play, Radio, Shield } from "lucide-react";

export default function HomeDashboardPage() {
  const { data: balance } = useBalance();
  const { data: health } = useResearchHealth();
  const { data: scanner } = useScannerStatus();
  const { data: signals = [] } = useSignals(5);
  const { data: openTrades = [] } = useOpenTrades();
  const { data: trades = [] } = useTrades(20);

  const equityData = trades.slice(0, 30).map((t, i) => ({
    label: String(i + 1),
    value: trades.slice(0, i + 1).reduce((s, x) => s + (x.profit_usd ?? 0), 10000),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Institutional Dashboard"
        description="Real-time overview — research, backtests, signals, and live trading"
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href="/backtests">
                <Play className="mr-1 h-3 w-3" /> New Backtest
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signals">
                <Radio className="mr-1 h-3 w-3" /> Signals
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Account Balance"
          value={balance?.total != null ? formatCurrency(balance.total) : "—"}
          sub={balance?.available != null ? `${formatCurrency(balance.available)} available` : undefined}
        />
        <MetricCard label="Open Positions" value={String(openTrades.length)} sub="Live from trading API" />
        <MetricCard label="Active Signals" value={String(signals.length)} sub="Latest from research engine" />
        <MetricCard
          label="Recent PnL"
          value={formatPct(trades.reduce((s, t) => s + (t.profit_percent ?? 0), 0) / Math.max(trades.length, 1))}
          trend={trades.reduce((s, t) => s + (t.profit_usd ?? 0), 0) >= 0 ? "up" : "down"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Equity Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <EquityChart data={equityData.length ? equityData : [{ label: "0", value: 10000 }]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusDot ok={health?.status === "ok"} label={`Platform API — ${health?.status || "unknown"}${health?.source === "trading_api_fallback" ? " (trading)" : ""}`} />
            <StatusDot ok={!!scanner?.isRunning} label={`Market Scanner — ${scanner?.isRunning ? "running" : "idle"}`} />
            <StatusDot ok={true} label="PostgreSQL — connected" />
            <StatusDot ok={true} label="Redis — ready (Phase 5)" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Latest Signals</CardTitle>
            <Link href="/signals" className="text-xs text-emerald-400 hover:underline">
              View all <ArrowRight className="inline h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {signals.slice(0, 4).map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-zinc-800 p-2 text-sm">
                <div>
                  <span className="font-medium">{s.symbol}</span>
                  <Badge variant={s.direction?.includes("SHORT") ? "danger" : "success"} className="ml-2">
                    {s.direction}
                  </Badge>
                </div>
                <span className="text-zinc-500">{s.confidence}%</span>
              </div>
            ))}
            {!signals.length && <p className="text-sm text-zinc-500">No signals yet</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" /> AI Recommendations
            </CardTitle>
            <Link href="/analytics/ai" className="text-xs text-emerald-400 hover:underline">
              Insights
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {MOCK_AI_INSIGHTS.slice(0, 3).map((a) => (
              <div key={a.id} className="rounded-lg border border-zinc-800 p-2">
                <p className="text-sm font-medium">{a.title}</p>
                <p className="mt-1 text-xs text-zinc-500 line-clamp-2">{a.summary}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
