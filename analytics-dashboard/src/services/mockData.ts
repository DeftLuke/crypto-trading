import type { AiInsight, ResearchStats, RiskSnapshot } from "@/types";

/** Mock data for Phase 5/6 prep — replaced when AI layer is live */

export const MOCK_AI_INSIGHTS: AiInsight[] = [
  {
    id: "1",
    category: "recommendation",
    title: "Increase SMC confluence threshold",
    summary: "Bearish OB retests with RSI>80 show 67% win rate vs 52% baseline. Consider min confidence 75.",
    confidence: 82,
    ts: Date.now() - 3600000,
  },
  {
    id: "2",
    category: "market",
    title: "London session outperformance",
    summary: "Last 30 days: London PF 2.6 vs Asian 1.4. Bias short setups to 08:00–16:00 UTC.",
    confidence: 71,
    ts: Date.now() - 7200000,
  },
  {
    id: "3",
    category: "pattern",
    title: "Liquidity sweep + BOS cluster",
    summary: "Combined sweep+BOS signals on BTC/ETH show highest expectancy in low-volatility regimes.",
    confidence: 68,
    ts: Date.now() - 86400000,
  },
];

export const MOCK_RESEARCH_STATS: ResearchStats = {
  totalTested: 142,
  generated: 28,
  validated: 19,
  rejected: 9,
  queueSize: 4,
  optimizationQueue: 2,
};

export const MOCK_RISK: RiskSnapshot = {
  exposure: 12500,
  dailyLoss: -1.2,
  drawdown: 3.4,
  openRisk: 250,
  circuitBreaker: false,
  leverageDistribution: [
    { leverage: 10, count: 2 },
    { leverage: 25, count: 1 },
    { leverage: 50, count: 1 },
  ],
};

export const RESEARCH_GROWTH = [
  { month: "Jan", tested: 12, validated: 4 },
  { month: "Feb", tested: 18, validated: 7 },
  { month: "Mar", tested: 22, validated: 9 },
  { month: "Apr", tested: 28, validated: 11 },
  { month: "May", tested: 35, validated: 14 },
  { month: "Jun", tested: 27, validated: 12 },
];
