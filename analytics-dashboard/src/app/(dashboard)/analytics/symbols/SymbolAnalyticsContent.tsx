"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChartSimple } from "@/components/charts/RechartsPanel";
import { useTrades } from "@/hooks/useQueries";
import { tradingApi } from "@/services/api";
import { formatPct } from "@/lib/utils";

export default function SymbolAnalyticsContent() {
  const params = useSearchParams();
  const focus = params.get("symbol")?.toUpperCase();
  const { data: pairs = [] } = useQuery({ queryKey: ["pairs"], queryFn: () => tradingApi.pairs() });
  const { data: trades = [] } = useTrades(2000);

  const symbols = [...new Set([...(pairs as string[]), ...trades.map((t) => t.symbol)])].slice(0, 12);

  const ranked = symbols
    .map((sym) => {
      const subset = trades.filter((t) => t.symbol === sym);
      const wins = subset.filter((t) => (t.profit_usd ?? 0) > 0).length;
      const net = subset.reduce((s, t) => s + (t.profit_usd ?? 0), 0);
      return {
        symbol: sym,
        trades: subset.length,
        winRate: subset.length ? (wins / subset.length) * 100 : 0,
        net,
      };
    })
    .sort((a, b) => b.net - a.net);

  const selected = focus ? ranked.find((r) => r.symbol === focus) : ranked[0];

  return (
    <div className="space-y-6">
      <PageHeader title="Symbol Analytics" description={focus ? `Focused: ${focus}` : "Cross-symbol performance ranking"} />
      {selected && (
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricCard label={selected.symbol} value={`${selected.trades} trades`} />
          <MetricCard label="Win Rate" value={formatPct(selected.winRate)} />
          <MetricCard
            label="Net PnL"
            value={`$${selected.net.toFixed(0)}`}
            trend={selected.net >= 0 ? "up" : "down"}
          />
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Performance Ranking</CardTitle>
        </CardHeader>
        <CardContent>
          <BarChartSimple data={ranked.map((r) => ({ label: r.symbol.replace("USDT", ""), value: r.net }))} />
        </CardContent>
      </Card>
    </div>
  );
}
