"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/badge";
import { MOCK_AI_INSIGHTS } from "@/services/mockData";
import { researchApi } from "@/services/api";
import { formatDistanceToNow } from "date-fns";

export default function AiInsightsPage() {
  const { data: memory } = useQuery({
    queryKey: ["memoryDashboard"],
    queryFn: () => researchApi.memoryDashboard(),
    refetchInterval: 60_000,
  });
  const { data: agent } = useQuery({
    queryKey: ["agentDashboard"],
    queryFn: () => researchApi.agentDashboard(),
    refetchInterval: 60_000,
  });

  const progress = memory?.learning_progress;
  const patterns = (memory?.top_patterns || []) as { pattern_name?: string; win_rate?: number; trade_count?: number }[];
  const reflections = (memory?.top_reflections || []) as { observation?: string; confidence?: number; created_at?: string }[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Insights"
        description="Phase 5 memory layer + Phase 6 prep — patterns, reflections, learning progress"
      />

      {progress && (
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricCard label="Total Memories" value={String(progress.total_memories ?? memory?.stats?.total_memories ?? 0)} />
          <MetricCard label="Trades Indexed" value={String(progress.trades_indexed ?? 0)} />
          <MetricCard label="Patterns" value={String(progress.patterns_stored ?? 0)} />
          <MetricCard label="Reflections" value={String(progress.reflections_stored ?? 0)} />
        </div>
      )}

      {agent?.recommendations && (agent.recommendations as { title?: string; rationale?: string }[]).length > 0 && (
        <Card>
          <CardHeader><CardTitle>AI Agent Recommendations (Phase 6)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(agent.recommendations as { title?: string; rationale?: string; confidence?: number }[]).slice(0, 5).map((r, i) => (
              <div key={i} className="rounded-lg border border-zinc-800 p-2 text-sm">
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-zinc-500">{r.rationale}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {agent?.best_strategies && (agent.best_strategies as unknown[]).length > 0 && (
        <Card>
          <CardHeader><CardTitle>Top Ranked Strategies</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(agent.best_strategies as { strategy_name?: string; composite_score?: number }[]).slice(0, 5).map((s, i) => (
              <div key={i} className="flex justify-between rounded-lg border border-zinc-800 p-2">
                <span>{s.strategy_name}</span>
                <span className="text-emerald-400">{s.composite_score?.toFixed(1)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {patterns.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Top Patterns (Qdrant)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {patterns.map((p, i) => (
              <div key={i} className="flex justify-between rounded-lg border border-zinc-800 p-2 text-sm">
                <span>{p.pattern_name || "Pattern"}</span>
                <span className="text-zinc-500">{p.win_rate?.toFixed(0)}% · {p.trade_count} trades</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {reflections.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Memory Reflections</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {reflections.map((r, i) => (
              <p key={i} className="text-sm text-zinc-400">{r.observation}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {MOCK_AI_INSIGHTS.map((a) => (
          <Card key={a.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{a.title}</CardTitle>
              <Badge variant="info">{a.category}</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-zinc-400">{a.summary}</p>
              <div className="mt-3 flex justify-between text-xs text-zinc-600">
                <span>Confidence {a.confidence}%</span>
                <span>{formatDistanceToNow(a.ts, { addSuffix: true })}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
