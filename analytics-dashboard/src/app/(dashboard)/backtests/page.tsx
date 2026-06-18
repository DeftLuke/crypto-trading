"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader, exportCsv } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlobalFilters } from "@/components/shared/GlobalFilters";
import { researchApi } from "@/services/api";
import { pushRecentBacktest, useRecentBacktests } from "@/hooks/useQueries";
import type { BacktestSummary } from "@/types";

export default function BacktestsPage() {
  const recent = useRecentBacktests();
  const [selectedId, setSelectedId] = useState<string | null>(recent[0]?.backtest_id ?? null);

  const startMutation = useMutation({
    mutationFn: () =>
      researchApi.backtestStart({
        name: `Dashboard Run ${new Date().toISOString().slice(0, 16)}`,
        symbols: ["BTCUSDT", "ETHUSDT"],
        exchange: "binance",
        timeframe: "15m",
        start_date: "2024-01-01",
        end_date: "2024-12-31",
        initial_balance: 10000,
        mode: "smc",
      }),
    onSuccess: (data) => {
      const summary: BacktestSummary = {
        backtest_id: data.backtest_id,
        status: data.status,
        mode: "smc",
        name: "Dashboard Run",
      };
      pushRecentBacktest(summary);
      setSelectedId(data.backtest_id);
      toast.success("Backtest started", { description: data.backtest_id });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const running = recent.filter((b) => b.status === "running" || b.status === "queued");
  const completed = recent.filter((b) => b.status === "completed");
  const failed = recent.filter((b) => b.status === "failed");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backtesting"
        description="Phase 3 institutional backtest engine — live job monitoring"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => exportCsv("backtests.csv", recent as unknown as Record<string, unknown>[])}>
              Export CSV
            </Button>
            <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              {startMutation.isPending ? "Starting…" : "Start Backtest"}
            </Button>
          </>
        }
      />

      <GlobalFilters showStrategy={false} />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Running" value={String(running.length)} />
        <MetricCard label="Completed" value={String(completed.length)} trend="up" />
        <MetricCard label="Failed" value={String(failed.length)} trend="down" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Backtests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recent.length === 0 ? (
            <p className="text-sm text-zinc-500">No backtests yet — start one to track results here.</p>
          ) : (
            recent.map((b) => (
              <div
                key={b.backtest_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{b.name || b.backtest_id}</p>
                  <p className="text-xs text-zinc-500">{b.mode} · {b.backtest_id.slice(0, 8)}…</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={b.status === "completed" ? "success" : b.status === "failed" ? "danger" : "info"}>
                    {b.status}
                  </Badge>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/backtests/${b.backtest_id}`}>Details</Link>
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
