"use client";

import { use, useEffect } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/badge";
import { useStrategyStore, type StrategyRecord } from "@/store/strategyStore";
import { useStrategyCatalog } from "@/hooks/useQueries";
import { formatNumber, formatPct } from "@/lib/utils";

export default function StrategyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Self-hydrate the store so deep links / direct visits work without the list page.
  const { data: catalog, isLoading } = useStrategyCatalog();
  const setStrategies = useStrategyStore((s) => s.setStrategies);
  const strategy = useStrategyStore((s) => s.strategies.find((x) => x.id === id));

  useEffect(() => {
    if (catalog) setStrategies(catalog as StrategyRecord[]);
  }, [catalog, setStrategies]);

  if (!strategy) {
    return <p className="p-6 text-zinc-500">{isLoading ? "Loading strategy…" : "Strategy not found"}</p>;
  }

  const m = strategy.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        title={strategy.name}
        description={`Status: ${strategy.status} · Deployment: ${strategy.deployment || "none"}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Win Rate" value={formatPct(m?.win_rate)} />
        <MetricCard label="Profit Factor" value={formatNumber(m?.profit_factor)} />
        <MetricCard label="Sharpe" value={formatNumber(m?.sharpe_ratio)} />
        <MetricCard label="Max Drawdown" value={formatPct(m?.max_drawdown_pct)} trend="down" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Rules</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(strategy.rules || []).map((r) => (
              <Badge key={r} variant="info">{r}</Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Walk Forward / Monte Carlo</CardTitle></CardHeader>
          <CardContent className="text-sm text-zinc-500">
            Run a backtest from the Backtests page and link results here. Phase 3 API supports walk-forward and Monte Carlo endpoints.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
