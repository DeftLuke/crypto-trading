"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { GlobalFilters } from "@/components/shared/GlobalFilters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TradingViewChart } from "@/components/charts/TradingViewChart";
import { useSignalFeed } from "@/hooks/useQueries";
import { formatUsd } from "@/lib/utils";

type FeedRow = {
  id: string;
  symbol: string;
  direction: string;
  confidence?: number;
  source?: string;
  source_group?: string;
  strategy_name?: string;
  execution_status?: string;
  final_outcome?: string | null;
  trade_id?: string | null;
  pnl?: number | null;
  stop_loss?: number;
  tp1?: number;
  tp2?: number;
  created_at?: string;
};

function statusVariant(status?: string) {
  if (status === "open") return "default" as const;
  if (status === "closed") return "success" as const;
  if (status === "skipped") return "secondary" as const;
  return "default" as const;
}

function outcomeBadge(outcome?: string | null) {
  if (outcome === "win") return <Badge variant="success">WIN</Badge>;
  if (outcome === "loss") return <Badge variant="danger">LOSS</Badge>;
  if (outcome === "open") return <Badge variant="default">OPEN</Badge>;
  if (outcome === "inconclusive") return <Badge variant="secondary">INC</Badge>;
  return <Badge variant="secondary">—</Badge>;
}

export default function SignalsPage() {
  const { data: feed = [] } = useSignalFeed(100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Signal Performance"
        description="Live signals with execution status, source, and linked trade outcomes"
      />
      <GlobalFilters showStrategy={false} />

      <TradingViewChart symbol="BINANCE:BTCUSDT" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(feed as FeedRow[]).map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">{s.symbol}</CardTitle>
              <Badge variant={s.direction?.includes("SELL") || s.direction === "SHORT" ? "danger" : "success"}>
                {s.direction}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xl font-bold text-emerald-400">{s.confidence ?? "—"}%</span>
                <Badge variant={statusVariant(s.execution_status)}>{s.execution_status || "pending"}</Badge>
                {outcomeBadge(s.final_outcome)}
              </div>
              <p className="text-xs text-zinc-500">
                {s.source || "unknown"}
                {s.source_group ? ` · ${s.source_group}` : ""}
                {s.strategy_name ? ` · ${s.strategy_name}` : ""}
              </p>
              <div className="grid grid-cols-3 gap-2 text-xs text-zinc-500">
                <div>SL<br /><span className="text-zinc-300">{s.stop_loss ?? "—"}</span></div>
                <div>TP1<br /><span className="text-zinc-300">{s.tp1 ?? "—"}</span></div>
                <div>TP2<br /><span className="text-zinc-300">{s.tp2 ?? "—"}</span></div>
              </div>
              {s.trade_id ? (
                <div className="flex items-center justify-between border-t border-zinc-800 pt-2 text-xs">
                  <span className={s.pnl != null && s.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {s.pnl != null ? formatUsd(s.pnl) : "—"}
                  </span>
                  <Link href={`/trades?highlight=${s.trade_id}`} className="text-emerald-500 hover:underline">
                    View trade
                  </Link>
                </div>
              ) : (
                <p className="text-xs text-zinc-600">Not executed</p>
              )}
            </CardContent>
          </Card>
        ))}
        {!feed.length && (
          <p className="text-zinc-500 col-span-full">No signals in the last 90 days — scanner or Telegram sources will populate this feed.</p>
        )}
      </div>
    </div>
  );
}
