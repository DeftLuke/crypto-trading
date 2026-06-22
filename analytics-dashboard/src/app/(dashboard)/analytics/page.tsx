"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Brain, Shield, BarChart3, Globe, Radio, BookOpen } from "lucide-react";

const sections = [
  { href: "/analytics/signals", label: "Signal Analytics", icon: Radio, desc: "Win rate, avg R, latency by source/strategy/group (Phase 2)" },
  { href: "/analytics/lessons", label: "Trade Lessons", icon: BookOpen, desc: "AI post-trade reviews on every close (Phase 3)" },
  { href: "/analytics/equity", label: "Equity Analytics", icon: LineChart, desc: "Portfolio equity, drawdown, rolling Sharpe" },
  { href: "/analytics/sessions", label: "Session Analytics", icon: Globe, desc: "Asian, London, New York performance" },
  { href: "/analytics/symbols", label: "Symbol Analytics", icon: BarChart3, desc: "Per-symbol ranking and metrics" },
  { href: "/analytics/smc", label: "SMC Analytics", icon: Shield, desc: "BOS, CHOCH, OB, FVG confluence stats" },
  { href: "/analytics/ranking", label: "Strategy Ranking", icon: BarChart3, desc: "Composite score leaderboard" },
  { href: "/analytics/ai", label: "AI Insights", icon: Brain, desc: "Recommendations and pattern discovery" },
];

export default function AnalyticsHubPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Deep performance analysis across strategies, sessions, and symbols" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map(({ href, label, icon: Icon, desc }) => (
          <Link key={href} href={href}>
            <Card className="h-full transition-colors hover:border-emerald-500/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-emerald-500" />
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-500">{desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
