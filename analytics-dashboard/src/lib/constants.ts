import {
  Activity,
  BarChart3,
  LayoutDashboard,
  Bot,
  Database,
  FlaskConical,
  Home,
  LineChart,
  MessageSquare,
  Radio,
  Settings,
  Shield,
  Target,
  TrendingUp,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: string[];
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/control", label: "Control Center", icon: LayoutDashboard },
  { href: "/research", label: "Research", icon: FlaskConical, roles: ["admin", "researcher"] },
  { href: "/backtests", label: "Backtests", icon: BarChart3 },
  { href: "/market-data", label: "Market Data", icon: Database },
  { href: "/strategies", label: "Strategies", icon: Target },
  { href: "/signals", label: "Signals", icon: Radio },
  { href: "/telegram-signals", label: "Telegram Sources", icon: MessageSquare },
  { href: "/trades", label: "Trades", icon: TrendingUp },
  { href: "/analytics", label: "Analytics", icon: LineChart },
  { href: "/risk", label: "Risk", icon: Shield },
  { href: "/system", label: "System", icon: Activity, roles: ["admin"] },
  { href: "/paper", label: "Paper Trading", icon: Wallet },
  { href: "/live", label: "Live Trading", icon: Zap },
  { href: "/rsi-scalper", label: "RSI Scalper", icon: Zap },
  { href: "/assistant", label: "AI Assistant", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function getTradingApi(): string {
  const fromEnv = process.env.NEXT_PUBLIC_TRADING_API_URL;
  if (fromEnv && fromEnv.startsWith("http")) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      return "https://api.deftluke.online/api";
    }
  }
  return fromEnv || "/api/trading";
}

export function getWsUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (fromEnv && fromEnv.startsWith("ws")) return fromEnv;
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      return "wss://api.deftluke.online/ws";
    }
  }
  return fromEnv || "ws://localhost:3001/ws";
}

export const RESEARCH_API = process.env.NEXT_PUBLIC_RESEARCH_API_URL || "/api/research";
/** @deprecated use getTradingApi() — resolved at call time for correct browser hostname */
export const TRADING_API = "/api/trading";
export const WS_URL = "wss://api.deftluke.online/ws";
