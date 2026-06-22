"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader, StatusDot } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/badge";
import { researchApi } from "@/services/api";
import { formatUsd } from "@/lib/utils";

type Service = {
  service_id?: string; name?: string; state?: string; health?: string;
  cpu_pct?: number; ram_mb?: number; memory_shared?: boolean; memory_note?: string;
  error_count?: number; queue_size?: number; uptime_sec?: number;
};
type Runtime = {
  node_heap_limit_mb?: number; node_heap_used_mb?: number; node_rss_mb?: number;
  server_ram_total_mb?: number; server_ram_used_mb?: number; server_ram_free_mb?: number;
  in_process_modules?: number;
};
type Exchange = {
  exchange_id?: string; connected?: boolean; dry_run?: boolean; latency_ms?: number;
  balance?: number; open_positions?: number; error_count?: number;
};
type Approval = { approval_id?: string; symbol?: string; direction?: string; entry?: number; status?: string };

export default function ControlCenterPage() {
  const qc = useQueryClient();
  const { data: dash, isLoading } = useQuery({
    queryKey: ["controlDashboard"],
    queryFn: () => researchApi.controlDashboard(),
    refetchInterval: 5000,
  });

  const settings = dash?.settings as { mode?: string; auto_trading?: boolean; manual_approval?: boolean } | undefined;
  const services = (dash?.services || []) as Service[];
  const exchanges = (dash?.exchanges || []) as Exchange[];
  const approvals = (dash?.pending_approvals || []) as Approval[];
  const risk = dash?.risk as { live?: { kill_switch?: boolean; active?: boolean }; paper?: Record<string, unknown> } | undefined;
  const positions = dash?.positions as { paper?: unknown[]; live?: unknown[] } | undefined;
  const memory = dash?.memory as { total_memories?: number } | undefined;
  const runtime = dash?.runtime as Runtime | undefined;
  const riskLimits = dash?.risk as { limits?: Record<string, number> } | undefined;

  const [riskForm, setRiskForm] = useState({
    risk_per_trade_pct: 1,
    default_leverage: 50,
    max_daily_loss_pct: 3,
    max_open_trades: 5,
    max_drawdown_pct: 10,
    scanner_enabled: true,
    telegram_signals_enabled: true,
  });

  useEffect(() => {
    const s = dash?.settings as Record<string, unknown> | undefined;
    const limits = riskLimits?.limits;
    if (!s && !limits) return;
    setRiskForm({
      risk_per_trade_pct: Number(s?.risk_per_trade_pct ?? limits?.risk_per_trade_pct ?? 1),
      default_leverage: Number(s?.default_leverage ?? limits?.default_leverage ?? 50),
      max_daily_loss_pct: Number(s?.max_daily_loss_pct ?? limits?.max_daily_loss_pct ?? 3),
      max_open_trades: Number(s?.max_open_trades ?? limits?.max_open_trades ?? 5),
      max_drawdown_pct: Number(s?.max_drawdown_pct ?? limits?.max_drawdown_pct ?? 10),
      scanner_enabled: s?.scanner_enabled !== false,
      telegram_signals_enabled: s?.telegram_signals_enabled !== false,
    });
  }, [dash?.settings, riskLimits?.limits]);

  const saveRisk = useMutation({
    mutationFn: () => researchApi.controlSettings(riskForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["controlDashboard"] });
      toast.success("Risk settings saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const emergency = useMutation({
    mutationFn: (action: string) => researchApi.controlEmergency(action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["controlDashboard"] }),
  });

  const serviceAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "start" | "stop" | "restart" }) =>
      action === "start" ? researchApi.controlServiceStart(id) :
      action === "stop" ? researchApi.controlServiceStop(id) :
      researchApi.controlServiceRestart(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["controlDashboard"] }),
  });

  const toggleAuto = useMutation({
    mutationFn: () => researchApi.controlSettings({
      auto_trading: !settings?.auto_trading,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["controlDashboard"] }),
  });

  const openCount = (positions?.paper?.length || 0) + (positions?.live?.length || 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enterprise Control Center"
        description="Phase 10 — unified command center for all platform services"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm"><Link href="/assistant">AI Assistant</Link></Button>
            <Button asChild variant="secondary" size="sm"><Link href="/control/audit">Audit Log</Link></Button>
          </div>
        }
      />

      {risk?.live?.kill_switch && (
        <Card className="border-red-500/50"><CardContent className="py-3 text-red-400">Kill switch active</CardContent></Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Badge variant={settings?.mode === "live" ? "danger" : "success"}>
          {settings?.mode === "live" ? "LIVE MODE" : "DEMO MODE"}
        </Badge>
        <Badge variant={settings?.auto_trading ? "success" : "secondary"}>
          Auto Trading: {settings?.auto_trading ? "ON" : "OFF"}
        </Badge>
        <Badge variant={settings?.manual_approval ? "secondary" : "success"}>
          Manual Approval: {settings?.manual_approval ? "ON" : "OFF"}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Services" value={String(services.length)} />
        <MetricCard label="Open Positions" value={String(openCount)} />
        <MetricCard label="Pending Approvals" value={String(approvals.length)} />
        <MetricCard label="Memories" value={String(memory?.total_memories ?? "—")} />
      </div>

      {runtime && (
        <Card>
          <CardHeader><CardTitle>Server Resources</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <p className="text-xs text-zinc-500">Server RAM</p>
              <p className="font-medium tabular-nums">
                {(runtime.server_ram_used_mb ?? 0).toLocaleString()} / {(runtime.server_ram_total_mb ?? 0).toLocaleString()} MB
              </p>
              <p className="text-xs text-zinc-600">{(runtime.server_ram_free_mb ?? 0).toLocaleString()} MB free</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Backend process (RSS)</p>
              <p className="font-medium tabular-nums">{(runtime.node_rss_mb ?? 0).toLocaleString()} MB</p>
              <p className="text-xs text-zinc-600">Grows under load — not capped at 32 MB</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Node heap used / limit</p>
              <p className="font-medium tabular-nums">
                {(runtime.node_heap_used_mb ?? 0).toLocaleString()} / {(runtime.node_heap_limit_mb ?? 0).toLocaleString()} MB
              </p>
              <p className="text-xs text-zinc-600">Up to {(runtime.node_heap_limit_mb ?? 16384) / 1024} GB for scanner, backtests, AI</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">In-process modules</p>
              <p className="font-medium">{runtime.in_process_modules ?? "—"} services share one Node runtime</p>
              <p className="text-xs text-zinc-600">Separate containers: Qdrant, n8n, research-api, Ollama</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Risk Parameters</CardTitle>
            <Button size="sm" onClick={() => saveRisk.mutate()} disabled={saveRisk.isPending}>
              Save Risk Settings
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            {([
              ["risk_per_trade_pct", "Risk per trade (%)", 0.1, 5],
              ["default_leverage", "Default leverage", 1, 125],
              ["max_daily_loss_pct", "Max daily loss (%)", 0.5, 20],
              ["max_open_trades", "Max open trades", 1, 20],
              ["max_drawdown_pct", "Max drawdown (%)", 1, 50],
            ] as const).map(([key, label, min, max]) => (
              <label key={key} className="space-y-1">
                <span className="text-xs text-zinc-500">{label}</span>
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={key.includes("pct") ? 0.1 : 1}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 tabular-nums"
                  value={riskForm[key]}
                  onChange={(e) => setRiskForm((f) => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                />
              </label>
            ))}
            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={riskForm.scanner_enabled}
                onChange={(e) => setRiskForm((f) => ({ ...f, scanner_enabled: e.target.checked }))}
              />
              <span>AI scanner enabled</span>
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={riskForm.telegram_signals_enabled}
                onChange={(e) => setRiskForm((f) => ({ ...f, telegram_signals_enabled: e.target.checked }))}
              />
              <span>Telegram signals enabled</span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Trading Controls</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => toggleAuto.mutate()} disabled={toggleAuto.isPending}>
              Toggle Auto Trading
            </Button>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {[
              ["stop-auto-trading", "Stop Auto"],
              ["close-all", "Close All"],
              ["kill-switch", "Kill Switch"],
              ["pause-research", "Pause Research"],
            ].map(([action, label]) => (
              <Button
                key={action}
                size="sm"
                variant={action === "kill-switch" ? "destructive" : "outline"}
                disabled={emergency.isPending}
                onClick={() => {
                  if (action === "kill-switch" && !window.confirm("Activate kill switch?")) return;
                  emergency.mutate(action);
                }}
              >
                {label}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Exchanges</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {exchanges.map((ex) => (
            <div key={ex.exchange_id} className="flex items-center justify-between rounded border border-zinc-800 p-2 text-sm">
              <div>
                <span className="font-medium capitalize">{ex.exchange_id}</span>
                {ex.dry_run && <Badge variant="secondary" className="ml-2">Dry Run</Badge>}
              </div>
              <div className="text-right text-xs text-zinc-500">
                <StatusDot ok={!!ex.connected} label={ex.connected ? "Connected" : "Offline"} />
                <p>{formatUsd(ex.balance)} · {ex.latency_ms}ms · {ex.open_positions} pos</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {approvals.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Pending Trade Approvals</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {approvals.map((a) => (
              <div key={a.approval_id} className="flex justify-between rounded border border-amber-500/30 p-3 text-sm">
                <span>{a.symbol} {a.direction} @ {a.entry}</span>
                <Badge variant="secondary">{a.approval_id?.slice(0, 8)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Service Management</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? <p className="text-sm text-zinc-500">Loading…</p> : services.map((svc) => (
            <div key={svc.service_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 p-3 text-sm">
              <div>
                <p className="font-medium">{svc.name}</p>
                <p className="text-xs text-zinc-500">
                  Phase {svc.service_id} · CPU {svc.cpu_pct?.toFixed(0)}% ·{" "}
                  {svc.memory_shared
                    ? `Backend RSS ${svc.ram_mb?.toLocaleString()} MB (shared)`
                    : `RAM ${svc.ram_mb ?? 0} MB`}{" "}
                  · Errors {svc.error_count}
                </p>
                {svc.memory_note && (
                  <p className="text-[10px] text-zinc-600">{svc.memory_note}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={svc.state === "running" ? "success" : "secondary"}>{svc.state}</Badge>
                <Badge variant={svc.health === "healthy" ? "success" : "secondary"}>{svc.health}</Badge>
                <Button size="sm" variant="outline" onClick={() => serviceAction.mutate({ id: svc.service_id!, action: "start" })}>Start</Button>
                <Button size="sm" variant="outline" onClick={() => serviceAction.mutate({ id: svc.service_id!, action: "stop" })}>Stop</Button>
                <Button size="sm" variant="outline" onClick={() => serviceAction.mutate({ id: svc.service_id!, action: "restart" })}>Restart</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
