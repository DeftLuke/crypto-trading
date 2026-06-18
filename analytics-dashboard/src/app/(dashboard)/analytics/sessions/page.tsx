"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChartSimple } from "@/components/charts/RechartsPanel";
import { MetricCard } from "@/components/ui/badge";
import { useTrades } from "@/hooks/useQueries";

const SESSIONS = ["Asian", "London", "New York"];

export default function SessionAnalyticsPage() {
  const { data: trades = [] } = useTrades(1000);

  const stats = SESSIONS.map((session) => {
    const subset = trades.filter((t) => t.session === session || (!t.session && session === "London"));
    const wins = subset.filter((t) => (t.profit_usd ?? 0) > 0).length;
    const net = subset.reduce((s, t) => s + (t.profit_usd ?? 0), 0);
    return {
      session,
      trades: subset.length,
      winRate: subset.length ? (wins / subset.length) * 100 : 0,
      net,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Session Analytics" description="Performance by trading session" />
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <MetricCard key={s.session} label={s.session} value={`${s.trades} trades`} sub={`WR ${s.winRate.toFixed(0)}% · ${s.net.toFixed(0)} USD`} />
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Session Comparison</CardTitle></CardHeader>
        <CardContent>
          <BarChartSimple data={stats.map((s) => ({ label: s.session, value: s.net }))} />
        </CardContent>
      </Card>
    </div>
  );
}
