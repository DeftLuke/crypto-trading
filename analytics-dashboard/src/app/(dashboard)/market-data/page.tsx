"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, StatusDot } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { researchApi, type MarketDataProgress } from "@/services/api";

function statusColor(status: string) {
  if (status === "complete" || status === "ready") return "bg-emerald-500/20 text-emerald-400";
  if (status === "running" || status === "downloading") return "bg-amber-500/20 text-amber-400";
  if (status === "error") return "bg-red-500/20 text-red-400";
  if (status === "partial") return "bg-sky-500/20 text-sky-400";
  return "bg-zinc-800 text-zinc-400";
}

export default function MarketDataPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["marketDataProgress"],
    queryFn: () => researchApi.marketDataProgress(),
    refetchInterval: 2000,
  });

  const progress = data as MarketDataProgress | undefined;
  const activePhase = Math.max(1, progress?.current_phase || 1);
  const [viewPhase, setViewPhase] = useState<number | null>(null);
  const displayPhase = viewPhase ?? activePhase;

  const currentPhase = useMemo(
    () => progress?.phases?.find((p) => p.phase === displayPhase) ?? progress?.phases?.[0],
    [progress?.phases, displayPhase]
  );

  const symbols = currentPhase
    ? Object.values(currentPhase.symbol_progress).sort((a, b) => a.symbol.localeCompare(b.symbol))
    : [];

  const startPhase = useMutation({
    mutationFn: (phase?: number) => researchApi.marketDataStartPhase(phase),
    onSuccess: () => {
      toast.success("Download phase started");
      qc.invalidateQueries({ queryKey: ["marketDataProgress"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const autoMut = useMutation({
    mutationFn: (enabled: boolean) => researchApi.marketDataAuto(enabled, true),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketDataProgress"] }),
  });

  const pauseMut = useMutation({
    mutationFn: () => researchApi.marketDataPause(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketDataProgress"] }),
  });

  const resumeMut = useMutation({
    mutationFn: () => researchApi.marketDataResume(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketDataProgress"] }),
  });

  const refreshUniverseMut = useMutation({
    mutationFn: () => researchApi.marketDataRefreshUniverse(),
    onSuccess: (d) => {
      toast.success(`Universe refreshed — ${d.universe_size} ranked pairs`);
      qc.invalidateQueries({ queryKey: ["marketDataProgress"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Market Data Downloads"
        description={`Binance Vision → local Parquet. Top ${progress?.universe_size ?? 200} USDT perpetuals by 24h volume · ${progress?.phase_size ?? 50} pairs/phase · 1D/4H/1H/15M.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => startPhase.mutate(1)} disabled={startPhase.isPending}>
              <Download className="mr-1 h-4 w-4" /> Start Phase 1
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refreshUniverseMut.mutate()}
              disabled={refreshUniverseMut.isPending}
            >
              <RefreshCw className={cn("mr-1 h-4 w-4", refreshUniverseMut.isPending && "animate-spin")} />
              Refresh top 200
            </Button>
            <Button
              size="sm"
              variant={progress?.auto_download ? "default" : "outline"}
              onClick={() => autoMut.mutate(!progress?.auto_download)}
            >
              Auto {progress?.auto_download ? "ON" : "OFF"}
            </Button>
            {progress?.paused ? (
              <Button size="sm" variant="outline" onClick={() => resumeMut.mutate()}>
                <Play className="mr-1 h-4 w-4" /> Resume
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => pauseMut.mutate()}>
                <Pause className="mr-1 h-4 w-4" /> Pause
              </Button>
            )}
          </div>
        }
      />

      {isError && (
        <Card className="border-red-900/50 bg-red-950/20">
          <CardContent className="pt-4 text-sm text-red-400">
            {(error as Error)?.message || "Cannot reach research-api market-data endpoints"}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-zinc-500">Global status</p>
            <p className="mt-1 text-lg font-semibold capitalize">{progress?.global_status || (isLoading ? "…" : "idle")}</p>
            <StatusDot ok={progress?.global_status === "running" || progress?.global_status === "complete"} label="Queue" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-zinc-500">Active phase</p>
            <p className="mt-1 text-lg font-semibold">
              {activePhase} / {progress?.total_phases || 4}
            </p>
            <p className="text-xs text-zinc-500">{progress?.universe_size ?? 200} pairs · ranked by volume</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-zinc-500">Phase {displayPhase} progress</p>
            <p className="mt-1 text-lg font-semibold">
              {currentPhase?.symbols_complete ?? 0} / {currentPhase?.symbols_total ?? 50} coins
            </p>
            <ProgressBar value={currentPhase?.overall_pct ?? 0} className="mt-2" showLabel={false} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-zinc-500">Overall (all phases)</p>
            <p className="mt-1 text-lg font-semibold">{progress?.global_pct?.toFixed(1) ?? 0}%</p>
            <ProgressBar value={progress?.global_pct ?? 0} className="mt-2" />
          </CardContent>
        </Card>
      </div>

      {(progress?.phases?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-2">
          {progress?.phases.map((p) => (
            <button
              key={p.phase}
              type="button"
              onClick={() => setViewPhase(p.phase)}
              className={cn(
                "min-w-[7rem] rounded-lg border px-3 py-2 text-left transition-colors",
                displayPhase === p.phase
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-700"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-300">Phase {p.phase}</span>
                <Badge className={statusColor(p.status)}>{p.status}</Badge>
              </div>
              <p className="mt-1 text-[10px] text-zinc-500">
                {p.symbols_complete}/{p.symbols_total}
              </p>
              <ProgressBar value={p.overall_pct} className="mt-1" showLabel={false} />
            </button>
          ))}
          {viewPhase != null && viewPhase !== activePhase && (
            <Button size="sm" variant="ghost" className="self-center text-xs" onClick={() => setViewPhase(null)}>
              Follow active
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Phase {displayPhase} — per coin ({symbols.length} symbols)
          </CardTitle>
          <RefreshCw className={`h-4 w-4 text-zinc-500 ${isLoading ? "animate-spin" : ""}`} />
        </CardHeader>
        <CardContent>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {symbols.map((sp) => (
              <div key={sp.symbol} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-zinc-100">{sp.symbol}</span>
                  <Badge className={statusColor(sp.status)}>{sp.status}</Badge>
                </div>
                <ProgressBar value={sp.overall_pct} barClassName={sp.status === "complete" ? "bg-emerald-500" : "bg-amber-500"} />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {Object.values(sp.timeframes || {}).map((tf) => (
                    <div key={tf.timeframe} className="rounded bg-zinc-900/80 px-2 py-1.5">
                      <div className="flex items-center justify-between text-[10px] uppercase text-zinc-500">
                        <span>{tf.timeframe}</span>
                        <span>{tf.bars}/{tf.min_bars}</span>
                      </div>
                      <ProgressBar value={tf.pct} className="mt-1" showLabel={false} barClassName="h-1.5" />
                    </div>
                  ))}
                </div>
                {sp.message && <p className="mt-1 text-[10px] text-zinc-500">{sp.message}</p>}
              </div>
            ))}
            {!symbols.length && !isLoading && (
              <p className="py-8 text-center text-sm text-zinc-500">
                Click &quot;Start Phase 1&quot; or enable Auto — downloads top 200 ranked pairs in sets of 50.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {progress?.last_error && <p className="text-xs text-red-400">Last error: {progress.last_error}</p>}
    </div>
  );
}
