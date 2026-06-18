"use client";

import { useEffect } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { VirtualTable } from "@/components/shared/VirtualTable";
import { useStrategyStore } from "@/store/strategyStore";
import { formatNumber } from "@/lib/utils";
import type { StrategyRanking } from "@/types";

export default function StrategyRankingPage() {
  const strategies = useStrategyStore((s) => s.strategies);
  const rankings = useStrategyStore((s) => s.rankings);
  const setRankings = useStrategyStore((s) => s.setRankings);

  useEffect(() => {
    const ranked: StrategyRanking[] = [...strategies]
      .map((s, i) => {
        const m = s.metrics;
        const profitability = Math.min(100, (m?.profit_factor ?? 1) * 30);
        const stability = Math.max(0, 100 - (m?.max_drawdown_pct ?? 20) * 2);
        const sharpe = Math.min(100, (m?.sharpe_ratio ?? 1) * 40);
        const consistency = m?.win_rate ?? 50;
        const composite = (profitability + stability + sharpe + consistency) / 4;
        return {
          rank: i + 1,
          strategy_name: s.name,
          composite_score: composite,
          profitability_score: profitability,
          drawdown_score: stability,
          sharpe_score: sharpe,
          consistency_score: consistency,
          metrics: m,
        };
      })
      .sort((a, b) => b.composite_score - a.composite_score)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    setRankings(ranked);
  }, [strategies, setRankings]);

  const rows = rankings.length ? rankings : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Strategy Ranking" description="Composite score — profitability, stability, risk, consistency" />
      <VirtualTable<StrategyRanking>
        rows={rows}
        columns={[
          { key: "rank", header: "#", width: "50px" },
          { key: "strategy_name", header: "Strategy", width: "1.5fr" },
          { key: "composite_score", header: "Composite", width: "90px", render: (r) => formatNumber(r.composite_score, 1) },
          { key: "profitability_score", header: "Profit", width: "80px", render: (r) => formatNumber(r.profitability_score, 0) },
          { key: "drawdown_score", header: "Stability", width: "80px", render: (r) => formatNumber(r.drawdown_score, 0) },
          { key: "sharpe_score", header: "Risk", width: "70px", render: (r) => formatNumber(r.sharpe_score, 0) },
          { key: "consistency_score", header: "Consistency", width: "90px", render: (r) => formatNumber(r.consistency_score, 0) },
        ]}
      />
    </div>
  );
}
