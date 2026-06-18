"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { GlobalFilters } from "@/components/shared/GlobalFilters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TradingViewChart } from "@/components/charts/TradingViewChart";
import { useSignals } from "@/hooks/useQueries";
import { useSignalStore } from "@/store/signalStore";

export default function SignalsPage() {
  const { data: apiSignals = [] } = useSignals(30);
  const liveSignals = useSignalStore((s) => s.latest);
  const signals = [...liveSignals, ...apiSignals].slice(0, 30);

  return (
    <div className="space-y-6">
      <PageHeader title="Signal Dashboard" description="Live SMC + indicator confluence signals" />
      <GlobalFilters showStrategy={false} />

      <TradingViewChart symbol="BINANCE:BTCUSDT" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {signals.map((s, i) => (
          <Card key={`${s.symbol}-${i}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>{s.symbol}</CardTitle>
              <Badge variant={s.direction?.includes("SHORT") ? "danger" : "success"}>{s.direction}</Badge>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-2xl font-bold text-emerald-400">{s.confidence}%</p>
              <ConfluenceTags s={s} />
              <div className="grid grid-cols-3 gap-2 pt-2 text-xs text-zinc-500">
                <div>TP1<br /><span className="text-zinc-300">{s.tp1 ?? "—"}</span></div>
                <div>TP2<br /><span className="text-zinc-300">{s.tp2 ?? "—"}</span></div>
                <div>TP3<br /><span className="text-zinc-300">{String(s.tp3 ?? "—")}</span></div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!signals.length && <p className="text-zinc-500">No signals — ensure research platform is running on :8100</p>}
      </div>
    </div>
  );
}

function ConfluenceTags({ s }: { s: { confluence?: Record<string, unknown>; smc?: Record<string, unknown>; indicators?: Record<string, unknown> } }) {
  const tags: string[] = [];
  const c = s.confluence || s.smc || s.indicators || {};
  Object.entries(c).forEach(([k, v]) => {
    if (v) tags.push(k.replace(/_/g, " "));
  });
  if (!tags.length) tags.push("EMA Alignment", "RSI", "BOS", "OB Retest");
  return (
    <div className="flex flex-wrap gap-1">
      {tags.slice(0, 6).map((t) => (
        <Badge key={t} variant="default">{t}</Badge>
      ))}
    </div>
  );
}
