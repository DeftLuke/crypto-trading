"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { formatDistanceToNow } from "date-fns";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificationStore } from "@/store/notificationStore";
import { cn } from "@/lib/utils";

const typeColors: Record<string, string> = {
  signal: "border-l-emerald-500",
  trade: "border-l-blue-500",
  backtest: "border-l-violet-500",
  risk: "border-l-red-500",
  system: "border-l-amber-500",
  strategy: "border-l-cyan-500",
  telegram: "border-l-violet-500",
};

export function NotificationCenter({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const items = useNotificationStore((s) => s.items);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clear = useNotificationStore((s) => s.clear);
  const remove = useNotificationStore((s) => s.remove);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-800 p-4">
            <Dialog.Title className="text-sm font-semibold">Notifications</Dialog.Title>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={markAllRead}>
                Mark read
              </Button>
              <Button variant="ghost" size="sm" onClick={clear}>
                Clear
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon">
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {items.length === 0 ? (
              <p className="p-4 text-center text-sm text-zinc-500">No notifications</p>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "mb-2 rounded-lg border border-zinc-800 border-l-4 p-3",
                    typeColors[n.type] || "border-l-zinc-600",
                    !n.read && "bg-zinc-900/80"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-100">{n.title}</p>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => remove(n.id)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{n.message}</p>
                  <p className="mt-1 text-[10px] text-zinc-600">
                    {formatDistanceToNow(n.ts, { addSuffix: true })}
                  </p>
                </div>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
