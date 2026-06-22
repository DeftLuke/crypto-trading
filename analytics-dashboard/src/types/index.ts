export interface ResearchHealth {
  status: string;
  checks?: Record<string, unknown>;
  source?: string;
}

export type UserRole = "admin" | "researcher" | "trader" | "viewer";

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  displayName?: string;
  avatarUrl?: string;
}

export interface BacktestSummary {
  backtest_id: string;
  name?: string;
  mode: string;
  status: string;
  progress_pct?: number;
  metrics?: BacktestMetrics;
  symbols?: string[];
  export_paths?: Record<string, string>;
}

export interface BacktestMetrics {
  net_profit?: number;
  profit_factor?: number;
  sharpe_ratio?: number;
  sortino_ratio?: number;
  max_drawdown_pct?: number;
  recovery_factor?: number;
  win_rate?: number;
  expectancy?: number;
  total_trades?: number;
  return_pct?: number;
  final_balance?: number;
}

export interface TradingDashboardAccount {
  balance?: number;
  available?: number;
  equity?: number;
  unrealized_pnl?: number;
  source?: string;
  exchange_unreachable?: boolean;
  exchange_error?: string | null;
}

export interface TradingDashboardHealth {
  running?: boolean;
  dry_run?: boolean;
  exchange_connected?: boolean;
}

export interface TradingDashboard {
  accounts?: TradingDashboardAccount[];
  positions?: Trade[];
  health?: TradingDashboardHealth;
  performance?: Record<string, unknown>;
}

export interface Trade {
  id?: string;
  position_id?: string;
  exchange_only?: boolean;
  exchange_quantity?: number;
  trade_id?: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entry_time?: number;
  exit_time?: number;
  entry_price?: number;
  exit_price?: number;
  profit_usd?: number;
  pnl?: number;
  pnl_usd?: number;
  profit_percent?: number;
  pnl_pct?: number;
  unrealized_pnl?: number;
  roe_pct?: number;
  result?: string;
  session?: string;
  signal_confidence?: number;
  leverage?: number;
  quantity?: number;
  margin?: number;
  notional?: number;
  current_price?: number;
  stop_loss?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  tp3_hit?: boolean;
  sl_moved_breakeven?: boolean;
  sl_locked_1r?: boolean;
  take_profit?: number;
  status?: "open" | "partial" | "closed" | "stopped" | "liquidated";
  closed_at?: string;
  opened_at?: string;
  tp1_hit_at?: string;
  tp2_hit_at?: string;
  sl_updated_at?: string;
  exchange_realized_pnl?: number;
  realized_pnl?: number;
  runner_stop?: number;
  protection_ok?: boolean;
  protection_missing?: boolean;
  protection_issues?: string[];
  exchange_protection?: {
    sl_count?: number;
    tp_count?: number;
    sl_price?: number | string | null;
    tp_prices?: Array<number | string>;
    has_position?: boolean;
  };
}

export interface Signal {
  symbol: string;
  direction: string;
  confidence: number;
  entry?: number;
  stop_loss?: number;
  tp1?: number;
  tp2?: number;
  tp3?: string | number;
  timeframe?: string;
  confluence?: Record<string, unknown>;
  smc?: Record<string, unknown>;
  indicators?: Record<string, unknown>;
  created_at?: string;
}

export interface StrategyRanking {
  rank: number;
  strategy_name: string;
  composite_score: number;
  profitability_score?: number;
  drawdown_score?: number;
  sharpe_score?: number;
  consistency_score?: number;
  recovery_score?: number;
  metrics?: BacktestMetrics;
}

export interface SmcStat {
  feature: string;
  trades: number;
  win_rate?: number;
  profit_factor?: number;
  net_profit?: number;
}

export interface SessionStat {
  session: string;
  trades: number;
  win_rate?: number;
  profit_factor?: number;
  net_profit?: number;
}

export interface EquityPoint {
  ts: number;
  balance: number;
  equity?: number;
  drawdown_pct?: number;
}

export interface SystemHealth {
  research?: { status: string; database?: string; parquet?: Record<string, unknown> };
  trading?: { status: string };
  redis?: string;
  workers?: { scanner?: boolean; backtest?: number };
}

export interface NotificationItem {
  id: string;
  type: "signal" | "trade" | "backtest" | "risk" | "system" | "strategy" | "telegram";
  title: string;
  message: string;
  ts: number;
  read: boolean;
  dedupeKey?: string;
}

export interface ResearchStats {
  totalTested: number;
  generated: number;
  validated: number;
  rejected: number;
  queueSize: number;
  optimizationQueue: number;
}

export interface RiskSnapshot {
  exposure: number;
  dailyLoss: number;
  drawdown: number;
  openRisk: number;
  circuitBreaker: boolean;
  leverageDistribution: { leverage: number; count: number }[];
}

export interface AiInsight {
  id: string;
  category: "recommendation" | "market" | "pattern" | "behavior" | "performance";
  title: string;
  summary: string;
  confidence: number;
  ts: number;
}

export interface FilterState {
  dateFrom?: string;
  dateTo?: string;
  symbol?: string;
  strategy?: string;
  session?: string;
  direction?: string;
  result?: string;
}
