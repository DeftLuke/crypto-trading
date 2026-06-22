"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { tradingApi } from "@/services/api";
import { Radio, Clock, Target, TrendingUp } from "lucide-react";

type Row = {
  key: string;
  signals: number;
  executed: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_r: number;
  avg_latency_sec: number;
  avg_validation_score: number;
  execution_rate: number;
};

function StatPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-xl font-semibold text-zinc-100">{value}</p>
      {sub && <p className="text-[11px] text-zinc-600">{sub}</p>}
    </div>
  );
}

function SourceTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-zinc-500">
              <th className="pb-2 pr-3">Name</th>
              <th className="pb-2 pr-3">Signals</th>
              <th className="pb-2 pr-3">Exec%</th>
              <th className="pb-2 pr-3">Win%</th>
              <th className="pb-2 pr-3">Avg R</th>
              <th className="pb-2">Latency</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-zinc-600">
                  No data yet — signals will appear after Telegram/scanner ingestion.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-zinc-900/80">
                <td className="py-2 pr-3 font-medium text-zinc-200">{r.key}</td>
                <td className="py-2 pr-3 text-zinc-400">{r.signals}</td>
                <td className="py-2 pr-3 text-zinc-400">{r.execution_rate}%</td>
                <td className="py-2 pr-3">
                  <Badge variant={r.win_rate >= 50 ? "default" : "secondary"}>{r.win_rate}%</Badge>
                </td>
                <td className="py-2 pr-3 text-emerald-400/90">{r.avg_r.toFixed(2)}R</td>
                <td className="py-2 text-zinc-500">{r.avg_latency_sec ? `${r.avg_latency_sec}s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default function SignalAnalyticsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["signalAnalytics", 90],
    queryFn: () => tradingApi.signalAnalytics(90),
    refetchInterval: 60_000,
  });

  const summary = data?.summary;
  const bySource = (data?.by_source || []) as Row[];
  const byStrategy = (data?.by_strategy || []) as Row[];
  const byGroup = (data?.by_group || []) as Row[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Signal Analytics"
        description="Performance by source, strategy, and VIP group — feeds Phase 4 backtest → live loop"
      />

      {error && (
        <p className="text-sm text-red-400">{(error as Error).message}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill
          label="Total signals (90d)"
          value={isLoading ? "…" : String(summary?.total_signals ?? 0)}
          sub="Telegram + scanner + manual"
        />
        <StatPill
          label="Win rate (executed)"
          value={isLoading ? "…" : `${summary?.win_rate ?? 0}%`}
          sub={`${summary?.executed_trades ?? 0} trades`}
        />
        <StatPill
          label="Avg R-multiple"
          value={isLoading ? "…" : `${(summary?.avg_r ?? 0).toFixed(2)}R`}
          sub="Closed trades"
        />
        <StatPill
          label="Avg latency"
          value={isLoading ? "…" : summary?.avg_latency_sec ? `${summary.avg_latency_sec}s` : "—"}
          sub="Signal received → fill"
        />
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <Radio className="h-3 w-3" /> Phase 2: signal DB + reporting
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" /> Latency tracked on every execute
        </span>
        <span className="inline-flex items-center gap-1">
          <Target className="h-3 w-3" /> Phase 4: strategy gate uses backtest_runs
        </span>
        <span className="inline-flex items-center gap-1">
          <TrendingUp className="h-3 w-3" /> Lessons update learned_patterns
        </span>
      </div>

      <SourceTable title="By source (Telegram / scanner / AI)" rows={bySource} />
      <SourceTable title="By strategy" rows={byStrategy} />
      <SourceTable title="By Telegram group" rows={byGroup.filter((r) => r.key !== "unknown")} />
    </div>
  );
}
