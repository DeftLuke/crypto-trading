"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { researchApi, type MarketDataProgress } from "@/services/api";

function statusColor(status: string) {
  if (status === "complete" || status === "ready") return "bg-emerald-500/20 text-emerald-400";
  if (status === "running" || status === "downloading") return "bg-amber-500/20 text-amber-400";
  if (status === "error") return "bg-red-500/20 text-red-400";
  return "bg-zinc-800 text-zinc-400";
}

export function MarketDataProgressCard({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["marketDataProgress"],
    queryFn: () => researchApi.marketDataProgress(),
    refetchInterval: 2000,
  });

  const progress = data as MarketDataProgress | undefined;
  const activePhase = Math.max(1, progress?.current_phase || 1);
  const currentPhase = progress?.phases?.find((p) => p.phase === activePhase) ?? progress?.phases?.[0];
  const running = progress?.global_status === "running";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">Market data downloads</CardTitle>
          <p className="text-xs text-zinc-500">
            Binance Vision · {progress?.universe_size ?? 200} pairs · phase {activePhase}/{progress?.total_phases ?? 4}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {progress && (
            <Badge className={cn("border border-zinc-700", progress.auto_download && !progress.paused && "border-emerald-500/40 text-emerald-400")}>
              Auto {progress.auto_download ? "ON" : "OFF"}
              {progress.paused ? " · Paused" : ""}
            </Badge>
          )}
          <Button asChild size="sm" variant="secondary">
            <Link href="/market-data">Details</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isError && (
          <p className="text-sm text-red-400">{(error as Error)?.message || "Cannot reach market-data API"}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-zinc-500">Overall</p>
            <p className="text-lg font-semibold tabular-nums">{progress?.global_pct?.toFixed(1) ?? (isLoading ? "…" : "0")}%</p>
            <ProgressBar value={progress?.global_pct ?? 0} className="mt-1" />
          </div>
          <div>
            <p className="text-xs text-zinc-500">Status</p>
            <p className="text-lg font-semibold capitalize">{progress?.global_status || (isLoading ? "…" : "idle")}</p>
            <Badge className={cn("mt-1", statusColor(running ? "running" : progress?.global_status || "idle"))}>
              {running ? "Downloading" : progress?.global_status || "idle"}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Phase {activePhase}</p>
            <p className="text-lg font-semibold tabular-nums">
              {currentPhase?.symbols_complete ?? 0} / {currentPhase?.symbols_total ?? 50}
            </p>
            <ProgressBar value={currentPhase?.overall_pct ?? 0} className="mt-1" showLabel={false} />
          </div>
        </div>
        {!compact && (progress?.phases?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {progress?.phases.map((p) => (
              <div key={p.phase} className="min-w-[6rem] flex-1 rounded-lg border border-zinc-800 bg-zinc-950/50 px-2 py-1.5">
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span>Phase {p.phase}</span>
                  <span>{p.symbols_complete}/{p.symbols_total}</span>
                </div>
                <ProgressBar value={p.overall_pct} className="mt-1" showLabel={false} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
