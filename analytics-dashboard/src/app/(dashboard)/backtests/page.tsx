"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader, exportCsv } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { researchApi } from "@/services/api";
import { pushRecentBacktest, useRecentBacktests } from "@/hooks/useQueries";
import type { BacktestSummary } from "@/types";

const DEFAULT_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT",
];

type Estimate = {
  symbols: number;
  total_bars: number;
  bars_per_symbol?: number;
  estimated_minutes: number;
  memory_warning: boolean;
  heap_limit_mb: number;
  recommendation: string;
};

function tsFromDate(d: string): number | undefined {
  if (!d) return undefined;
  return new Date(d).getTime();
}

function buildBacktestPayload(symbols: string[], startDate: string, endDate: string, leverage: number, scoreThreshold: number, force = false) {
  return {
    name: `E5 Institutional ${new Date().toISOString().slice(0, 16)}`,
    mode: symbols.length > 1 ? "multi" : "e5",
    strategy_name: "E5_INSTITUTIONAL_V1",
    symbols,
    exchange: "binance",
    timeframe: "15m",
    start_ts: tsFromDate(startDate),
    end_ts: tsFromDate(endDate),
    initial_balance: 10000,
    score_threshold: scoreThreshold,
    leverage,
    force,
    config: {
      risk: { risk_pct: 0.01, leverage, account_balance: 10000 },
      mtf_timeframes: ["4h", "1h"],
      max_workers: Math.min(8, symbols.length),
    },
  };
}

export default function BacktestsPage() {
  const recent = useRecentBacktests();
  const [selectedId, setSelectedId] = useState<string | null>(recent[0]?.backtest_id ?? null);
  const [symbolsText, setSymbolsText] = useState(DEFAULT_SYMBOLS.join(", "));
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [leverage, setLeverage] = useState(10);
  const [scoreThreshold, setScoreThreshold] = useState(85);
  const [syncTop50, setSyncTop50] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);

  const symbols = useMemo(
    () => symbolsText.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean),
    [symbolsText]
  );

  const { data: topSymbols } = useQuery({
    queryKey: ["topFuturesSymbols"],
    queryFn: () => researchApi.topFuturesSymbols(50),
  });

  const { data: strategies } = useQuery({
    queryKey: ["strategyRegistry"],
    queryFn: () => researchApi.strategyRegistry(),
  });

  const { data: researchHealth } = useQuery({
    queryKey: ["researchHealth"],
    queryFn: () => researchApi.health(),
    refetchInterval: 30000,
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      researchApi.syncBatch({
        exchange: "binance",
        symbols: syncTop50 ? (topSymbols?.symbols || DEFAULT_SYMBOLS) : symbols.slice(0, 10),
        timeframes: ["5m", "15m", "1h", "4h"],
        full: false,
      }),
    onSuccess: (d) => toast.success(`Sync complete: ${d.started} jobs, ${d.failed} failed`),
    onError: (e: Error) => toast.error(e.message),
  });

  const startMutation = useMutation({
    mutationFn: (force: boolean) =>
      researchApi.backtestStart(buildBacktestPayload(symbols, startDate, endDate, leverage, scoreThreshold, force)),
    onSuccess: (data) => {
      const summary: BacktestSummary = {
        backtest_id: data.backtest_id,
        status: data.status,
        mode: "e5",
        name: "E5 Institutional",
      };
      pushRecentBacktest(summary);
      setSelectedId(data.backtest_id);
      setConfirmOpen(false);
      toast.success("E5 backtest started", {
        description: data.source === "backend_offline" ? `${data.backtest_id} (offline engine)` : data.backtest_id,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const estimateMutation = useMutation({
    mutationFn: () =>
      researchApi.backtestEstimate(buildBacktestPayload(symbols, startDate, endDate, leverage, scoreThreshold, false)),
    onSuccess: (est) => {
      setEstimate(est);
      setConfirmOpen(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const running = recent.filter((b) => b.status === "running" || b.status === "queued");
  const completed = recent.filter((b) => b.status === "completed");
  const failed = recent.filter((b) => b.status === "failed");

  const offlineMode = researchHealth?.source === "trading_api_fallback" || researchHealth?.source === "backend_offline";

  return (
    <div className="space-y-6">
      <PageHeader
        title="E5 Institutional Backtesting"
        description="TradeGPT E5 — MTF SMC backtests via research-platform or backend offline engine (16 GB heap)"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => exportCsv("backtests.csv", recent as unknown as Record<string, unknown>[])}>
              Export CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
              {syncMutation.isPending ? "Syncing…" : "Sync Data"}
            </Button>
            <Button
              size="sm"
              onClick={() => estimateMutation.mutate()}
              disabled={estimateMutation.isPending || startMutation.isPending || symbols.length === 0}
            >
              {estimateMutation.isPending ? "Estimating…" : `Run E5 (${symbols.length} pairs)`}
            </Button>
          </>
        }
      />

      {offlineMode && (
        <Card className="border-amber-500/40">
          <CardContent className="py-3 text-sm text-amber-200/90">
            Research API offline — using <strong>backend offline engine</strong> (Supabase candles + SMC-MTF). Start research-api for full E5 PostgreSQL pipeline.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <label className="block">
              <span className="text-zinc-500">Symbols (comma-separated)</span>
              <textarea
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs"
                rows={4}
                value={symbolsText}
                onChange={(e) => setSymbolsText(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setSymbolsText(DEFAULT_SYMBOLS.join(", "))}>
                Top 10
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setSymbolsText((topSymbols?.symbols || DEFAULT_SYMBOLS).join(", "))}
              >
                Top 50
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-zinc-500">Start</span>
                <input type="date" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 p-2" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-zinc-500">End</span>
                <input type="date" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 p-2" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-zinc-500">AI score min</span>
                <input type="number" min={70} max={100} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 p-2" value={scoreThreshold} onChange={(e) => setScoreThreshold(Number(e.target.value))} />
              </label>
              <label className="block">
                <span className="text-zinc-500">Leverage</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 p-2" value={leverage} onChange={(e) => setLeverage(Number(e.target.value))}>
                  {[1, 5, 10, 20, 50].map((l) => <option key={l} value={l}>{l}x</option>)}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-zinc-400">
              <input type="checkbox" checked={syncTop50} onChange={(e) => setSyncTop50(e.target.checked)} />
              Sync top 50 pairs (Parquet + PostgreSQL / Supabase candles)
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Strategy & Data</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-400">
            <p><strong className="text-zinc-200">E5_INSTITUTIONAL_V1</strong> — HTF 4h/1h trend, 15m signals, 5m entry</p>
            <p>Data: DB-first via Supabase <code className="text-emerald-500">candles</code> — sync once, reuse</p>
            <div className="flex flex-wrap gap-1 pt-2">
              {(strategies?.strategies || []).map((s: { id: string; name: string }) => (
                <Badge key={s.id} variant={s.id === "E5_INSTITUTIONAL_V1" ? "default" : "secondary"}>{s.id}</Badge>
              ))}
            </div>
            <p className="text-xs pt-2">Run opens a confirmation with bar count + memory estimate before starting.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Running" value={String(running.length)} />
        <MetricCard label="Completed" value={String(completed.length)} trend="up" />
        <MetricCard label="Failed" value={String(failed.length)} trend="down" />
      </div>

      <Card>
        <CardHeader><CardTitle>Recent Backtests</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {recent.length === 0 ? (
            <p className="text-sm text-zinc-500">Sync data first, then run E5 — you will confirm workload before start.</p>
          ) : (
            recent.map((b) => (
              <div key={b.backtest_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 p-3 text-sm">
                <div>
                  <p className="font-medium">{b.name || b.backtest_id}</p>
                  <p className="text-xs text-zinc-500">{b.mode} · {b.backtest_id.slice(0, 8)}…</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={b.status === "completed" ? "success" : b.status === "failed" ? "danger" : "info"}>{b.status}</Badge>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/backtests/${b.backtest_id}`}>Details</Link>
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {confirmOpen && estimate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-md border-zinc-700 shadow-2xl">
            <CardHeader>
              <CardTitle>Confirm E5 Backtest</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="space-y-1 text-zinc-300">
                <p><span className="text-zinc-500">Pairs:</span> {estimate.symbols}</p>
                <p><span className="text-zinc-500">Total bars:</span> {estimate.total_bars.toLocaleString()}</p>
                <p><span className="text-zinc-500">Est. runtime:</span> ~{estimate.estimated_minutes} min</p>
                <p><span className="text-zinc-500">Node heap limit:</span> {estimate.heap_limit_mb.toLocaleString()} MB</p>
              </div>
              {estimate.memory_warning ? (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
                  {estimate.recommendation}
                </p>
              ) : (
                <p className="text-zinc-500">{estimate.recommendation}</p>
              )}
              <p className="text-xs text-zinc-600">
                Range {startDate} → {endDate} · 15m TF · uses server RAM on demand (not capped at 32 MB).
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
                <Button
                  onClick={() => startMutation.mutate(true)}
                  disabled={startMutation.isPending}
                >
                  {startMutation.isPending ? "Starting…" : "Confirm & Run"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
