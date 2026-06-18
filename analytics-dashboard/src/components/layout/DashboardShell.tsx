"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/lib/constants";
import { useAuthStore } from "@/store/authStore";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import { useAuthInit } from "@/hooks/useAuthInit";
import { useWebSocket } from "@/hooks/useWebSocket";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  useAuthInit();
  useWebSocket();

  return (
    <div className="flex min-h-screen bg-zinc-950 pb-16 text-zinc-100 md:pb-0">
      <Sidebar />
      <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-auto px-3 py-4 sm:px-4 md:p-6">{children}</main>
      </div>
      <MobileQuickNav />
    </div>
  );
}

function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const hasRole = useAuthStore((s) => s.hasRole);
  const items = NAV_ITEMS.filter((item) => !item.roles || hasRole(...(item.roles as Parameters<typeof hasRole>)));

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <nav className="absolute left-0 top-0 flex h-full w-[min(88vw,22rem)] flex-col border-r border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div>
            <p className="text-sm font-bold">TradeGPT Terminal</p>
            <p className="text-xs text-zinc-500">All dashboard modules</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
        {items.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onClose}
            className={cn(
              "mb-1 flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
              pathname.startsWith(href) ? "bg-emerald-500/10 text-emerald-400" : "text-zinc-400"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
        </div>
      </nav>
    </div>
  );
}

function MobileQuickNav() {
  const pathname = usePathname();
  const hasRole = useAuthStore((s) => s.hasRole);
  const items = NAV_ITEMS.filter((item) => !item.roles || hasRole(...(item.roles as Parameters<typeof hasRole>)));
  const pick = (href: string) => items.find((item) => item.href === href);
  const trades = pick("/trades");
  const quickItems = [
    pick("/dashboard"),
    trades && { ...trades, href: "/trades/positions", label: "Positions" },
    pick("/paper"),
    pick("/live"),
    pick("/settings"),
  ].filter(Boolean) as typeof items;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-zinc-800 bg-zinc-950/95 px-1 py-1.5 backdrop-blur md:hidden">
      {quickItems.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[10px]",
              active ? "bg-emerald-500/10 text-emerald-400" : "text-zinc-500"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="max-w-full truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
