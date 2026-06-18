"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Bell, Menu, Moon, Search, Sun, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationCenter } from "./NotificationCenter";
import { GlobalSearch } from "@/components/shared/GlobalSearch";
import { useSystemStore } from "@/store/systemStore";
import { useAuthStore } from "@/store/authStore";
import { useNotificationStore } from "@/store/notificationStore";
import { tradingApi } from "@/services/api";
import { useBalance } from "@/hooks/useQueries";
import { formatUsd } from "@/lib/utils";

export function TopNav({ onMenuClick }: { onMenuClick?: () => void }) {
  const { theme, setTheme } = useTheme();
  const wsConnected = useSystemStore((s) => s.wsConnected);
  const user = useAuthStore((s) => s.user);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const unread = useNotificationStore((s) => s.unreadCount());
  const { data: balanceApi } = useBalance();
  const { data: dash } = useQuery({
    queryKey: ["topnavTradingDashboard"],
    queryFn: () => tradingApi.dashboard(),
    refetchInterval: 10_000,
  });
  const account = ((dash?.accounts || []) as { balance?: number; available?: number; equity?: number }[])[0];
  const balance = account?.available ?? account?.balance ?? account?.equity ?? balanceApi?.available ?? balanceApi?.total;
  const balanceHint = balanceApi?.exchange_unreachable ? "Demo fallback — exchange unreachable" : undefined;

  return (
    <>
      <header className="sticky top-0 z-40 flex min-h-14 flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-950/85 px-3 py-2 backdrop-blur-md sm:flex-nowrap sm:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick}>
          <Menu className="h-5 w-5" />
        </Button>

        <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setSearchOpen(true)}>
          <Search className="h-4 w-4" />
        </Button>

        <Button
          variant="secondary"
          className="hidden sm:flex flex-1 max-w-md justify-start text-zinc-500"
          onClick={() => setSearchOpen(true)}
        >
          <Search className="mr-2 h-4 w-4" />
          Search strategies, trades, signals…
          <kbd className="ml-auto hidden lg:inline rounded bg-zinc-800 px-1.5 text-[10px]">⌘K</kbd>
        </Button>

        <div className="order-3 flex w-full min-w-0 items-center gap-2 sm:order-none sm:ml-auto sm:w-auto">
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-xs sm:flex-none"
            title={balanceHint}
          >
            <span className="text-zinc-500">Balance</span>
            <span className="truncate font-semibold text-zinc-100">{formatUsd(balance)}</span>
            <span className="text-zinc-500">USDT</span>
          </div>

          <select
            value={mode}
            onChange={(e) => setMode(e.target.value === "live" ? "live" : "demo")}
            className="h-8 max-w-[8.5rem] rounded-lg border border-zinc-800 bg-zinc-900 px-2 text-xs font-medium text-zinc-100 outline-none sm:max-w-none"
            title="Trading mode"
          >
            <option value="demo">Demo Trading</option>
            <option value="live">Live Trading</option>
          </select>

          <span
            className="hidden sm:flex items-center gap-1 text-xs text-zinc-500"
            title={wsConnected ? "WebSocket connected" : "Polling fallback"}
          >
            {wsConnected ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-amber-500" />
            )}
            {wsConnected ? "Live" : "Poll"}
          </span>

          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button variant="ghost" size="icon" className="relative" onClick={() => setNotifOpen(true)}>
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-black">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Button>

          <div className="hidden sm:block text-right">
            <p className="text-xs font-medium text-zinc-200">{user?.displayName || user?.email}</p>
            <p className="text-[10px] uppercase text-zinc-500">{user?.role}</p>
          </div>
        </div>
      </header>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <NotificationCenter open={notifOpen} onOpenChange={setNotifOpen} />
    </>
  );
}
