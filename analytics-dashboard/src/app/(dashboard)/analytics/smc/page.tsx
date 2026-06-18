"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChartSimple } from "@/components/charts/RechartsPanel";
import { MetricCard } from "@/components/ui/badge";

const SMC_STATS = [
  { feature: "BOS", trades: 142, winRate: 58, pf: 2.1, avg: 45 },
  { feature: "CHOCH", trades: 89, winRate: 52, pf: 1.8, avg: 38 },
  { feature: "Order Block", trades: 201, winRate: 61, pf: 2.4, avg: 52 },
  { feature: "Liquidity Sweep", trades: 76, winRate: 64, pf: 2.7, avg: 61 },
  { feature: "FVG", trades: 118, winRate: 55, pf: 1.9, avg: 41 },
];

export default function SmcAnalyticsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="SMC Analytics" description="Smart Money Concepts component performance and confluence" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {SMC_STATS.map((s) => (
          <MetricCard key={s.feature} label={s.feature} value={`${s.winRate}% WR`} sub={`PF ${s.pf} · ${s.trades} trades`} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>SMC Component Win Rate</CardTitle></CardHeader>
          <CardContent>
            <BarChartSimple data={SMC_STATS.map((s) => ({ label: s.feature, value: s.winRate }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Profit Factor by Component</CardTitle></CardHeader>
          <CardContent>
            <BarChartSimple data={SMC_STATS.map((s) => ({ label: s.feature, value: s.pf }))} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
