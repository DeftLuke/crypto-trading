"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { researchApi } from "@/services/api";

export default function AuditPage() {
  const { data } = useQuery({
    queryKey: ["controlAudit"],
    queryFn: () => researchApi.controlAudit(200),
    refetchInterval: 10000,
  });

  const logs = (data?.logs || []) as {
    audit_id?: string; category?: string; action?: string; actor?: string; ts?: string; detail?: Record<string, unknown>;
  }[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Center"
        description="Immutable log of trades, AI decisions, user actions, and system changes"
        actions={
          <Button asChild variant="secondary" size="sm"><Link href="/control">Control Center</Link></Button>
        }
      />
      <Card>
        <CardHeader><CardTitle>Audit Log ({logs.length})</CardTitle></CardHeader>
        <CardContent className="max-h-[600px] space-y-1 overflow-y-auto">
          {logs.length === 0 ? (
            <p className="text-sm text-zinc-500">No audit entries yet</p>
          ) : logs.map((log) => (
            <div key={log.audit_id} className="rounded border border-zinc-800 px-3 py-2 text-xs font-mono">
              <span className="text-zinc-500">{log.ts?.slice(0, 19)}</span>
              {" · "}
              <span className="text-emerald-400">{log.category}</span>
              {" / "}
              <span className="text-zinc-200">{log.action}</span>
              {" · "}
              <span className="text-zinc-500">{log.actor}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
