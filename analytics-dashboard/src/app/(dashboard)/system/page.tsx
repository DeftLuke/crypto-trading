"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader, StatusDot } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useResearchHealth, useScannerStatus, useDatasetStatus } from "@/hooks/useQueries";
import { useSystemStore } from "@/store/systemStore";
import { researchApi } from "@/services/api";

export default function SystemPage() {
  const { data: health } = useResearchHealth();
  const { data: scanner } = useScannerStatus();
  const { data: dataset } = useDatasetStatus();
  const { data: control } = useQuery({
    queryKey: ["controlServices"],
    queryFn: () => researchApi.controlServices(),
    refetchInterval: 10000,
  });
  const wsConnected = useSystemStore((s) => s.wsConnected);

  const services = (control?.services || []) as { name?: string; state?: string; health?: string; error_count?: number }[];

  return (
    <div className="space-y-6">
      <PageHeader title="System Monitoring" description="Real-time health from control center — no hardcoded status" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <HealthCard title="Research API" ok={health?.status === "ok"} detail={JSON.stringify(health?.checks || {}, null, 0)} />
        <HealthCard title="Trading Scanner" ok={!!scanner?.isRunning} detail={scanner?.isRunning ? "Running" : "Idle"} />
        <HealthCard title="WebSocket" ok={wsConnected} detail={wsConnected ? "Connected" : "Polling fallback"} />
        {services.slice(0, 6).map((svc) => (
          <HealthCard
            key={svc.name}
            title={svc.name || "Service"}
            ok={svc.health === "healthy" && svc.state === "running"}
            detail={`${svc.state} · errors ${svc.error_count ?? 0}`}
          />
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>All Platform Services</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {services.map((svc) => (
            <div key={svc.name} className="flex items-center justify-between rounded border border-zinc-800 p-2 text-sm">
              <span>{svc.name}</span>
              <div className="flex gap-2">
                <Badge variant={svc.state === "running" ? "success" : "secondary"}>{svc.state}</Badge>
                <StatusDot ok={svc.health === "healthy"} label={svc.health || "unknown"} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Dataset Warehouse</CardTitle></CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-400">
            {JSON.stringify(dataset, null, 2) || "Loading…"}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function HealthCard({ title, ok, detail }: { title: string; ok: boolean; detail: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <StatusDot ok={ok} label={ok ? "Healthy" : "Degraded"} />
        <p className="mt-2 truncate text-xs text-zinc-500">{detail}</p>
      </CardContent>
    </Card>
  );
}
