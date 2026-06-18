"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/lib/constants";
import { useAuthStore } from "@/store/authStore";
import { Activity } from "lucide-react";

export function Sidebar({ collapsed }: { collapsed?: boolean }) {
  const pathname = usePathname();
  const hasRole = useAuthStore((s) => s.hasRole);

  const items = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    return hasRole(...(item.roles as Parameters<typeof hasRole>));
  });

  return (
    <aside
      className={cn(
        "hidden md:flex h-screen shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950/90",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-800 px-4">
        <Activity className="h-5 w-5 text-emerald-500" />
        {!collapsed && (
          <div>
            <p className="text-sm font-bold text-zinc-100">TradeGPT</p>
            <p className="text-[10px] text-zinc-500">Institutional Terminal</p>
          </div>
        )}
      </div>
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
