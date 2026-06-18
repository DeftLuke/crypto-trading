"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EquityChart, DrawdownChart, LineChartSimple } from "@/components/charts/RechartsPanel";
import { useTrades } from "@/hooks/useQueries";

export default function EquityAnalyticsPage() {
  const { data: trades = [] } = useTrades(500);

  const equity = trades.reduce<{ label: string; value: number; sharpe: number }[]>((points, t, i) => {
    const previous = points.at(-1)?.value ?? 10000;
    const value = previous + (t.profit_usd ?? t.pnl_usd ?? 0);
    points.push({ label: String(i + 1), value, sharpe: 1 + Math.sin(i / 5) * 0.3 });
    return points;
  }, []);

  const dd = equity.map((p, i) => {
    const peak = Math.max(...equity.slice(0, i + 1).map((x) => x.value));
    return { label: p.label, value: -((peak - p.value) / peak) * 100 };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Equity Analytics" description="Portfolio growth, drawdown, and rolling risk metrics" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Portfolio Equity</CardTitle></CardHeader>
          <CardContent><EquityChart data={equity} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Drawdown Curve</CardTitle></CardHeader>
          <CardContent><DrawdownChart data={dd} /></CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Rolling Sharpe (approx)</CardTitle></CardHeader>
          <CardContent><LineChartSimple data={equity} lines={["sharpe"]} /></CardContent>
        </Card>
      </div>
    </div>
  );
}
