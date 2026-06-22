"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { tradingApi } from "@/services/api";
import { Brain } from "lucide-react";

type Lesson = {
  id: string;
  symbol: string;
  direction: string;
  outcome: string;
  lesson_type: string;
  lesson_text: string;
  ai_model?: string;
  r_multiple?: number;
  pnl?: number;
  close_factors?: {
    stale_entry?: boolean;
    slippage?: { entry_drift_pct?: number };
    timing?: { signal_to_fill_ms?: number; hold_duration_ms?: number };
    close_reason?: string;
  };
  created_at: string;
};

export default function LessonsAnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["recentLessons"],
    queryFn: () => tradingApi.recentLessons(40),
    refetchInterval: 60_000,
  });

  const lessons = (data?.lessons || []) as Lesson[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trade Lessons"
        description="AI post-trade reviews on every close — feeds strategy improvement (Phase 3 → Phase 4)"
      />

      <p className="text-sm text-zinc-500">
        Each closed trade records market structure, timing, slippage, and stale-entry flags.
        Lessons update <code className="text-zinc-400">learned_patterns</code> and the AI agent context.
        {" "}
        <Link href="/analytics/signals" className="text-emerald-500 hover:underline">
          Signal analytics →
        </Link>
      </p>

      {isLoading && <p className="text-sm text-zinc-500">Loading lessons…</p>}

      <div className="grid gap-4">
        {lessons.length === 0 && !isLoading && (
          <Card>
            <CardContent className="py-10 text-center text-zinc-600">
              No lessons yet. They appear automatically when trades close.
            </CardContent>
          </Card>
        )}

        {lessons.map((l) => (
          <Card key={l.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <span>{l.symbol}</span>
                <Badge variant={l.outcome === "win" ? "default" : "secondary"}>{l.outcome}</Badge>
                <Badge variant="info">{l.lesson_type}</Badge>
                {l.close_factors?.stale_entry && (
                  <Badge variant="secondary">stale entry</Badge>
                )}
                {l.r_multiple != null && (
                  <span className="text-sm font-normal text-emerald-400">{Number(l.r_multiple).toFixed(2)}R</span>
                )}
              </CardTitle>
              <p className="text-xs text-zinc-600">
                {new Date(l.created_at).toLocaleString()}
                {l.ai_model && ` · ${l.ai_model}`}
                {l.close_factors?.timing?.signal_to_fill_ms != null && (
                  ` · fill latency ${Math.round(l.close_factors.timing.signal_to_fill_ms / 1000)}s`
                )}
              </p>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm text-zinc-300 font-sans leading-relaxed">
                {l.lesson_text}
              </pre>
              {l.close_factors?.close_reason && (
                <p className="mt-3 text-xs text-zinc-600">
                  Close: {l.close_factors.close_reason}
                  {l.close_factors.slippage?.entry_drift_pct != null && (
                    ` · slippage ${l.close_factors.slippage.entry_drift_pct}%`
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-emerald-500" />
            Phase 4 connection
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-zinc-400 space-y-2">
          <p>
            Lessons and signal analytics feed the strategy loop: backtest 1 year → promote strategy →
            generate signals → execute → close review → update patterns → re-backtest.
          </p>
          <p>
            Enable strict backtest gate with <code className="text-zinc-300">BACKTEST_GATE_STRICT=true</code> when
            you are ready to block live signals without a passing 1-year backtest.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
