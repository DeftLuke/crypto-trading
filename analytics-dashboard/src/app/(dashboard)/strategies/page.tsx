"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { GlobalFilters } from "@/components/shared/GlobalFilters";
import { VirtualTable } from "@/components/shared/VirtualTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStrategyStore, type StrategyRecord } from "@/store/strategyStore";
import { formatNumber, formatPct } from "@/lib/utils";

export default function StrategiesPage() {
  const strategies = useStrategyStore((s) => s.strategies);
  const [minWin, setMinWin] = useState(0);
  const [minPf, setMinPf] = useState(0);

  const filtered = useMemo(
    () =>
      strategies.filter((s) => {
        const m = s.metrics;
        if (minWin && (m?.win_rate ?? 0) < minWin) return false;
        if (minPf && (m?.profit_factor ?? 0) < minPf) return false;
        return true;
      }),
    [strategies, minWin, minPf]
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Strategy Explorer" description="Filter, rank, and deploy validated strategies" />
      <GlobalFilters />

      <div className="flex flex-wrap gap-3 text-xs">
        <label>
          Min Win Rate %
          <input type="number" className="ml-2 w-16 rounded border border-zinc-700 bg-zinc-950 px-2 py-1" value={minWin} onChange={(e) => setMinWin(+e.target.value)} />
        </label>
        <label>
          Min PF
          <input type="number" step="0.1" className="ml-2 w-16 rounded border border-zinc-700 bg-zinc-950 px-2 py-1" value={minPf} onChange={(e) => setMinPf(+e.target.value)} />
        </label>
      </div>

      <VirtualTable<StrategyRecord>
        rows={filtered}
        columns={[
          { key: "name", header: "Strategy", width: "1.5fr" },
          {
            key: "status",
            header: "Status",
            width: "100px",
            render: (r) => <Badge variant={r.status === "validated" ? "success" : "default"}>{r.status}</Badge>,
          },
          { key: "win_rate", header: "Win%", width: "80px", render: (r) => formatPct(r.metrics?.win_rate) },
          { key: "pf", header: "PF", width: "70px", render: (r) => formatNumber(r.metrics?.profit_factor) },
          { key: "sharpe", header: "Sharpe", width: "70px", render: (r) => formatNumber(r.metrics?.sharpe_ratio) },
          { key: "dd", header: "DD", width: "70px", render: (r) => formatPct(r.metrics?.max_drawdown_pct) },
          {
            key: "id",
            header: "",
            width: "90px",
            render: (r) => (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/strategies/${r.id}`}>Open</Link>
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
