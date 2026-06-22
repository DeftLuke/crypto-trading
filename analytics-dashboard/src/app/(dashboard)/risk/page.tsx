"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader, StatusDot } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { researchApi, tradingApi } from "@/services/api";
import { cn, formatPct } from "@/lib/utils";

type ControlSettings = {
  risk_per_trade_pct?: number;
  default_leverage?: number;
  max_open_trades?: number;
  max_daily_loss_pct?: number;
  max_drawdown_pct?: number;
  institutional_min_score?: number;
  auto_trading?: boolean;
  manual_approval?: boolean;
  scanner_enabled?: boolean;
  telegram_signals_enabled?: boolean;
  signal_engine?: string;
  updated_at?: string;
};

type SignalEngineStatus = {
  active_engine?: string;
  smc_mtf?: { available: boolean };
  institutional_smc?: { available: boolean; min_score?: number; label?: string };
};

function NumInput({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  hint?: string;
  value: number | string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      />
      {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5">
      <span className="text-sm text-zinc-200">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
    </label>
  );
}

export default function RiskPage() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ControlSettings>({});

  const { data: dash } = useQuery({
    queryKey: ["controlDashboard"],
    queryFn: () => researchApi.controlDashboard(),
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const { data: settings } = useQuery({
    queryKey: ["controlSettings"],
    queryFn: () => researchApi.controlSettings() as Promise<ControlSettings>,
    staleTime: 30000,
  });

  const { data: engineStatus } = useQuery({
    queryKey: ["signalEngineStatus"],
    queryFn: () => tradingApi.signalEngineStatus() as Promise<SignalEngineStatus>,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  const setEngine = useMutation({
    mutationFn: (signal_engine: string) => tradingApi.setSignalEngine(signal_engine),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signalEngineStatus"] });
      qc.invalidateQueries({ queryKey: ["controlSettings"] });
      toast.success("Signal engine updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveSettings = useMutation({
    mutationFn: (body: ControlSettings) =>
      researchApi.controlSettings({ ...body, actor: "risk-dashboard" }) as Promise<ControlSettings>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["controlSettings"] });
      qc.invalidateQueries({ queryKey: ["controlDashboard"] });
      toast.success("Risk settings saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const risk = dash?.risk as {
    paper?: { total_exposure?: number; open_positions?: number; total_margin?: number; circuit_breaker?: boolean };
    live?: { total_exposure?: number; open_positions?: number; total_margin?: number; kill_switch?: boolean; daily_pnl?: number };
    circuit_breaker?: { active?: boolean; kill_switch?: boolean; reason?: string };
    limits?: ControlSettings;
  } | undefined;

  const engine = engineStatus || {};
  const activeEngine = engine.active_engine || draft.signal_engine || "smc-mtf";
  const institutionalAvailable = engine.institutional_smc?.available !== false;

  const paper = risk?.paper || {};
  const live = risk?.live || {};
  const cb = risk?.circuit_breaker || {};
  const exposure = (paper.total_exposure || 0) + (live.total_exposure || 0);
  const totalMargin = (paper.total_margin || 0) + (live.total_margin || 0);
  const tripped = cb.active || cb.kill_switch || live.kill_switch;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk Management"
        description="Full control — signal engine, leverage, limits, automation"
        actions={
          <>
            <Button asChild variant="secondary" size="sm"><Link href="/control">Control Center</Link></Button>
            <Button
              size="sm"
              onClick={() => saveSettings.mutate(draft)}
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending ? "Saving…" : "Save all"}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Total Exposure" value={`$${exposure.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <MetricCard label="Total Margin" value={`$${totalMargin.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <MetricCard label="Open Positions" value={String((paper.open_positions ?? 0) + (live.open_positions ?? 0))} />
        <MetricCard label="Paper / Live" value={`${paper.open_positions ?? 0} / ${live.open_positions ?? 0}`} />
        <MetricCard label="Daily PnL (Live)" value={formatPct(live.daily_pnl ?? 0)} trend={(live.daily_pnl ?? 0) >= 0 ? "up" : "down"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Signal engine</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-zinc-400">
              Only one engine generates scanner signals at a time. Institutional SMC v2 runs on Python research-api.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  activeEngine === "smc-mtf" ? "border-blue-500/50 bg-blue-500/10" : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-700",
                )}
                onClick={() => setEngine.mutate("smc-mtf")}
                disabled={setEngine.isPending}
              >
                <p className="font-medium text-zinc-100">SMC-MTF Legacy</p>
                <p className="mt-1 text-xs text-zinc-500">Node.js · RSI + MTF</p>
                <Badge className="mt-2" variant={engine.smc_mtf?.available ? "success" : "secondary"}>smc-mtf</Badge>
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  activeEngine === "institutional-smc" ? "border-emerald-500/50 bg-emerald-500/10" : "border-zinc-800 bg-zinc-950/50 hover:border-zinc-700",
                  !institutionalAvailable && "opacity-50",
                )}
                onClick={() => setEngine.mutate("institutional-smc")}
                disabled={setEngine.isPending || !institutionalAvailable}
              >
                <p className="font-medium text-zinc-100">Institutional SMC v2</p>
                <p className="mt-1 text-xs text-zinc-500">Python · score gate ≥{draft.institutional_min_score ?? 80}</p>
                <Badge className="mt-2" variant={institutionalAvailable ? "success" : "secondary"}>institutional-smc</Badge>
              </button>
            </div>
            <p className="text-xs text-zinc-500">Active: <code className="text-zinc-300">{activeEngine}</code></p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Circuit breaker</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={tripped ? "danger" : "success"}>{tripped ? "TRIPPED" : "OK"}</Badge>
            {cb.reason && <p className="mt-2 text-sm text-red-400">{cb.reason}</p>}
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span>Paper</span><StatusDot ok={!paper.circuit_breaker} label="OK" /></div>
              <div className="flex justify-between"><span>Live kill switch</span><StatusDot ok={!live.kill_switch} label={live.kill_switch ? "ACTIVE" : "Off"} /></div>
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Risk limits & sizing</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumInput label="Risk per trade (%)" value={draft.risk_per_trade_pct ?? 1} min={0.1} max={10} step={0.1} onChange={(v) => setDraft({ ...draft, risk_per_trade_pct: parseFloat(v) })} />
              <NumInput label="Default leverage" value={draft.default_leverage ?? 50} min={1} max={125} onChange={(v) => setDraft({ ...draft, default_leverage: parseInt(v, 10) })} />
              <NumInput label="Max open trades" value={draft.max_open_trades ?? 5} min={1} max={50} onChange={(v) => setDraft({ ...draft, max_open_trades: parseInt(v, 10) })} />
              <NumInput label="Max daily loss (%)" value={draft.max_daily_loss_pct ?? 3} min={0.5} max={50} step={0.1} onChange={(v) => setDraft({ ...draft, max_daily_loss_pct: parseFloat(v) })} />
              <NumInput label="Max drawdown (%)" value={draft.max_drawdown_pct ?? 10} min={1} max={100} step={0.5} onChange={(v) => setDraft({ ...draft, max_drawdown_pct: parseFloat(v) })} />
              <NumInput label="Institutional min score" hint="50–100 · higher = stricter" value={draft.institutional_min_score ?? 80} min={50} max={100} onChange={(v) => setDraft({ ...draft, institutional_min_score: parseInt(v, 10) })} />
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Automation & signal sources</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleRow label="Auto trading" checked={draft.auto_trading ?? true} onChange={(v) => setDraft({ ...draft, auto_trading: v })} />
              <ToggleRow label="Manual approval required" checked={draft.manual_approval ?? false} onChange={(v) => setDraft({ ...draft, manual_approval: v })} />
              <ToggleRow label="Market scanner enabled" checked={draft.scanner_enabled ?? true} onChange={(v) => setDraft({ ...draft, scanner_enabled: v })} />
              <ToggleRow label="Telegram signals enabled" checked={draft.telegram_signals_enabled ?? true} onChange={(v) => setDraft({ ...draft, telegram_signals_enabled: v })} />
            </div>
            {settings?.updated_at && (
              <p className="mt-4 text-xs text-zinc-500">Last saved {new Date(settings.updated_at).toLocaleString()}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
