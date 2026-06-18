"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader, StatusDot } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { researchApi } from "@/services/api";
import { formatPct } from "@/lib/utils";

export default function RiskPage() {
  const { data: dash } = useQuery({
    queryKey: ["controlDashboard"],
    queryFn: () => researchApi.controlDashboard(),
    refetchInterval: 5000,
  });

  const risk = dash?.risk as {
    paper?: { total_exposure?: number; open_positions?: number; circuit_breaker?: boolean };
    live?: { total_exposure?: number; open_positions?: number; kill_switch?: boolean; active?: boolean; daily_pnl?: number };
    circuit_breaker?: { active?: boolean; kill_switch?: boolean; reason?: string };
  } | undefined;

  const paper = risk?.paper || {};
  const live = risk?.live || {};
  const cb = risk?.circuit_breaker || {};
  const exposure = (paper.total_exposure || 0) + (live.total_exposure || 0);
  const tripped = cb.active || cb.kill_switch || live.kill_switch;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk Dashboard"
        description="Live risk from paper + live engines — real data only"
        actions={
          <Button asChild variant="secondary" size="sm"><Link href="/control">Control Center</Link></Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Exposure" value={`$${exposure.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
        <MetricCard label="Paper Positions" value={String(paper.open_positions ?? 0)} />
        <MetricCard label="Live Positions" value={String(live.open_positions ?? 0)} />
        <MetricCard label="Daily PnL (Live)" value={formatPct(live.daily_pnl ?? 0)} trend={(live.daily_pnl ?? 0) >= 0 ? "up" : "down"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Circuit Breaker</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={tripped ? "danger" : "success"}>{tripped ? "TRIPPED" : "OK"}</Badge>
            {cb.reason && <p className="mt-2 text-sm text-red-400">{cb.reason}</p>}
            <p className="mt-2 text-sm text-zinc-500">Auto-halt on risk limits — Phase 8 live engine</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Engine Status</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Paper Risk</span><StatusDot ok={!paper.circuit_breaker} label="OK" /></div>
            <div className="flex justify-between"><span>Live Kill Switch</span><StatusDot ok={!live.kill_switch} label={live.kill_switch ? "ACTIVE" : "Off"} /></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
