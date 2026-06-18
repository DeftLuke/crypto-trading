"use client";

import { use } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EquityChart, DrawdownChart, BarChartSimple } from "@/components/charts/RechartsPanel";
import {
  useBacktestEquity,
  useBacktestResults,
  useBacktestSessions,
  useBacktestSmc,
  useBacktestStatus,
  useBacktestTrades,
} from "@/hooks/useQueries";
import { formatNumber, formatPct, formatUsd } from "@/lib/utils";
import { GlobalFilters } from "@/components/shared/GlobalFilters";
import { VirtualTable } from "@/components/shared/VirtualTable";
import type { BacktestMetrics, Trade } from "@/types";

export default function BacktestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: status } = useBacktestStatus(id);
  const { data: results } = useBacktestResults(id);
  const { data: equity = [] } = useBacktestEquity(id);
  const { data: trades = [] } = useBacktestTrades(id);
  const { data: sessions } = useBacktestSessions(id);
  const { data: smc } = useBacktestSmc(id);

  const metrics = (results?.metrics || status?.metrics || {}) as BacktestMetrics;

  const equityChart = equity.map((p, i) => ({ label: String(i), value: p.balance }));
  const ddChart = equity.map((p, i) => ({ label: String(i), value: -(p.drawdown_pct ?? 0) }));

  return (
    <div className="space-y-6">
      <PageHeader title={`Backtest ${id.slice(0, 12)}…`} description={`Status: ${String(status?.status || "loading")}`} />
      <GlobalFilters />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <MetricCard label="Net Profit" value={formatUsd(metrics.net_profit)} />
        <MetricCard label="Profit Factor" value={formatNumber(metrics.profit_factor)} />
        <MetricCard label="Sharpe" value={formatNumber(metrics.sharpe_ratio)} />
        <MetricCard label="Sortino" value={formatNumber(metrics.sortino_ratio)} />
        <MetricCard label="Max DD" value={formatPct(metrics.max_drawdown_pct)} trend="down" />
        <MetricCard label="Recovery" value={formatNumber(metrics.recovery_factor)} />
        <MetricCard label="Win Rate" value={formatPct(metrics.win_rate)} />
        <MetricCard label="Expectancy" value={formatUsd(metrics.expectancy)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Equity Curve</CardTitle></CardHeader>
          <CardContent><EquityChart data={equityChart} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Drawdown</CardTitle></CardHeader>
          <CardContent><DrawdownChart data={ddChart} /></CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Session Breakdown</CardTitle></CardHeader>
          <CardContent>
            <BarChartSimple
              data={(sessions as { session: string; net_profit?: number }[] || []).map((s) => ({
                label: s.session,
                value: s.net_profit ?? 0,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>SMC Component Performance</CardTitle></CardHeader>
          <CardContent>
            <BarChartSimple
              data={(smc as { feature: string; win_rate?: number }[] || []).map((s) => ({
                label: s.feature?.slice(0, 12) || "?",
                value: (s.win_rate ?? 0) * 100,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Trades ({trades.length})</CardTitle></CardHeader>
        <CardContent>
          <VirtualTable<Trade>
            rows={trades}
            columns={[
              { key: "symbol", header: "Symbol", width: "100px" },
              { key: "direction", header: "Dir", width: "70px" },
              { key: "entry_price", header: "Entry", width: "90px", render: (r) => formatNumber(r.entry_price) },
              { key: "exit_price", header: "Exit", width: "90px", render: (r) => formatNumber(r.exit_price) },
              { key: "profit_usd", header: "PnL", width: "90px", render: (r) => formatUsd(r.profit_usd) },
              { key: "session", header: "Session", width: "90px" },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
