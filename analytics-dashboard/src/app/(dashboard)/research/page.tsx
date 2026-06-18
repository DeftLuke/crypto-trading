"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChartSimple, BarChartSimple } from "@/components/charts/RechartsPanel";
import { MOCK_RESEARCH_STATS, RESEARCH_GROWTH } from "@/services/mockData";
import { useDatasetStatus } from "@/hooks/useQueries";
import { Badge } from "@/components/ui/badge";

export default function ResearchPage() {
  const { data: dataset } = useDatasetStatus();
  const stats = MOCK_RESEARCH_STATS;

  const qualityTrend = RESEARCH_GROWTH.map((r) => ({
    label: r.month,
    validated: r.validated,
    tested: r.tested,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Research Dashboard" description="Strategy discovery, validation, and optimization pipeline" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Strategies Tested" value={String(stats.totalTested)} />
        <MetricCard label="Generated" value={String(stats.generated)} trend="up" />
        <MetricCard label="Validated" value={String(stats.validated)} trend="up" />
        <MetricCard label="Rejected" value={String(stats.rejected)} trend="down" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Research Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChartSimple data={qualityTrend} lines={["tested", "validated"]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Validation Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChartSimple
              data={RESEARCH_GROWTH.map((r) => ({
                label: r.month,
                value: Math.round((r.validated / r.tested) * 100),
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Research Queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <QueueRow name="SMC Liquidity Sweep v3" status="running" />
            <QueueRow name="EMA Confluence Optimizer" status="queued" />
            <QueueRow name="Session Bias Filter" status="queued" />
            <p className="pt-2 text-xs text-zinc-500">{stats.queueSize} jobs in queue</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dataset Warehouse (Phase 1)</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-48 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-400">
              {JSON.stringify(dataset, null, 2) || "Loading…"}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QueueRow({ name, status }: { name: string; status: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 p-2">
      <span>{name}</span>
      <Badge variant={status === "running" ? "info" : "default"}>{status}</Badge>
    </div>
  );
}
