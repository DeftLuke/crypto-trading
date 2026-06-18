import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NotificationItem } from "@/types";

function buildDedupeKey(n: Pick<NotificationItem, "dedupeKey" | "type" | "title" | "message">) {
  return n.dedupeKey || `${n.type}:${n.title}:${n.message}`;
}

interface NotificationState {
  items: NotificationItem[];
  dismissedKeys: string[];
  add: (n: Omit<NotificationItem, "id" | "read">) => boolean;
  remove: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  isDismissed: (dedupeKey: string) => boolean;
  unreadCount: () => number;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      items: [],
      dismissedKeys: [],
      isDismissed: (dedupeKey) => get().dismissedKeys.includes(dedupeKey),
      add: (n) => {
        const dedupeKey = buildDedupeKey(n);
        if (get().dismissedKeys.includes(dedupeKey)) return false;
        if (get().items.some((i) => i.dedupeKey === dedupeKey)) return false;
        set((s) => ({
          items: [{ ...n, id: crypto.randomUUID(), read: false, dedupeKey }, ...s.items].slice(0, 100),
        }));
        return true;
      },
      remove: (id) =>
        set((s) => {
          const item = s.items.find((i) => i.id === id);
          const nextDismissed = item?.dedupeKey
            ? [...new Set([...s.dismissedKeys, item.dedupeKey])]
            : s.dismissedKeys;
          return {
            items: s.items.filter((i) => i.id !== id),
            dismissedKeys: nextDismissed,
          };
        }),
      markRead: (id) =>
        set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, read: true } : i)) })),
      markAllRead: () => set((s) => ({ items: s.items.map((i) => ({ ...i, read: true })) })),
      clear: () =>
        set((s) => ({
          items: [],
          dismissedKeys: [
            ...new Set([...s.dismissedKeys, ...s.items.map((i) => i.dedupeKey).filter(Boolean) as string[]]),
          ],
        })),
      unreadCount: () => get().items.filter((i) => !i.read).length,
    }),
    {
      name: "tradegpt-notifications",
      partialize: (state) => ({ items: state.items, dismissedKeys: state.dismissedKeys }),
    }
  )
);
