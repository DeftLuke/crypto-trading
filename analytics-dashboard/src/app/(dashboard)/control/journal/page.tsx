"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { researchApi } from "@/services/api";
import { formatUsd } from "@/lib/utils";

export default function JournalPage() {
  const { data } = useQuery({
    queryKey: ["controlJournal"],
    queryFn: () => researchApi.controlJournal(100),
    refetchInterval: 10000,
  });

  const entries = (data?.entries || []) as {
    journal_id?: string; symbol?: string; direction?: string; source?: string;
    entry_price?: number; exit_price?: number; pnl_usd?: number; pnl_pct?: number;
    result?: string; strategy_name?: string; timeline?: { event_type?: string; ts?: string }[];
  }[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trading Journal"
        description="Every trade with full event timeline — no dummy data"
        actions={
          <Button asChild variant="secondary" size="sm"><Link href="/control">Control Center</Link></Button>
        }
      />
      <Card>
        <CardHeader><CardTitle>Journal Entries ({entries.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {entries.length === 0 ? (
            <p className="text-sm text-zinc-500">No journal entries — trades appear after execution</p>
          ) : entries.map((e) => (
            <div key={e.journal_id} className="rounded-lg border border-zinc-800 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{e.symbol}</span>
                  <Badge variant={e.direction === "SHORT" ? "danger" : "success"} className="ml-2">{e.direction}</Badge>
                  <Badge variant="secondary" className="ml-2">{e.source}</Badge>
                  <p className="text-xs text-zinc-500">{e.strategy_name} · Entry {e.entry_price?.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  {e.exit_price != null && (
                    <p className={(e.pnl_usd ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {formatUsd(e.pnl_usd)} · {e.pnl_pct?.toFixed(2)}% · {e.result}
                    </p>
                  )}
                </div>
              </div>
              {e.timeline && e.timeline.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {e.timeline.map((ev, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{ev.event_type}</Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
