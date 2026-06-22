"use client";

import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getWsUrl } from "@/lib/constants";
import { useSystemStore } from "@/store/systemStore";
import { useSignalStore } from "@/store/signalStore";
import { useNotificationStore } from "@/store/notificationStore";
import { toast } from "sonner";
import type { Signal } from "@/types";

const TOAST_COOLDOWN_MS = 60_000;

function signalKey(data: Record<string, unknown>) {
  return `${data.id || ""}:${data.symbol}:${data.direction || data.side}:${data.timestamp || data.created_at || ""}`;
}

export function useWebSocket(enabled = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const connectRef = useRef<(() => void) | undefined>(undefined);
  const recentToastsRef = useRef<Map<string, number>>(new Map());
  const setWsConnected = useSystemStore((s) => s.setWsConnected);
  const prependSignal = useSignalStore((s) => s.prepend);
  const addNotification = useNotificationStore((s) => s.add);
  const isDismissed = useNotificationStore((s) => s.isDismissed);
  const qc = useQueryClient();

  const notifySignal = useCallback(
    (data: Record<string, unknown>) => {
      const key = signalKey(data);
      const now = Date.now();
      const last = recentToastsRef.current.get(key) || 0;
      if (now - last < TOAST_COOLDOWN_MS) return;
      recentToastsRef.current.set(key, now);

      const direction = String(data.direction || data.side || "").toUpperCase();
      const label = direction === "BUY" || direction === "LONG" ? "LONG" : direction === "SELL" || direction === "SHORT" ? "SHORT" : direction || "SIGNAL";

      prependSignal(data as unknown as Signal);
      const dedupeKey = `signal:${key}`;
      if (isDismissed(dedupeKey)) return;
      addNotification({
        type: "signal",
        title: `New ${label} signal`,
        message: `${data.symbol} — confidence ${data.confidence ?? "—"}`,
        ts: now,
        dedupeKey,
      });
      toast.info(`${String(data.symbol)} ${label}`, { description: "New trading signal", id: dedupeKey });
    },
    [prependSignal, addNotification, isDismissed]
  );

  const handleTelegramPipeline = useCallback(
    (data: Record<string, unknown>) => {
      const stage = String(data.stage || "");
      const group = String(data.group || "VIP group");
      const symbol = data.symbol ? String(data.symbol) : "";
      const now = Date.now();

      qc.invalidateQueries({ queryKey: ["telegramInbox"] });

      const titles: Record<string, string> = {
        received: "Message received",
        parsing: "Parsing signal",
        validating: "Validating signal",
        validated: "Signal validated",
        ready: "Ready to trade",
        executing: "Opening trade…",
        rejected: "Signal rejected",
        executed: "Trade opened",
        approve_failed: "Trade failed",
        stale: "Signal too old for auto-trade",
        execution_blocked: "Execution blocked",
      };
      const title = titles[stage] || `Telegram: ${stage}`;
      const reason = data.reason ? String(data.reason) : "";
      const message = symbol
        ? `${group} — ${symbol}${reason ? ` (${reason.slice(0, 80)})` : ""}`
        : group;
      const dedupeKey = `telegram:${data.message_id || symbol}:${stage}`;

      if (isDismissed(dedupeKey)) return;

      const added = addNotification({ type: "telegram", title, message, ts: now, dedupeKey });
      if (!added) return;

      if (["validated", "ready", "executing", "executed", "rejected", "approve_failed", "stale", "execution_blocked"].includes(stage)) {
        const opts = { description: message, id: dedupeKey };
        if (stage === "executed") toast.success(title, opts);
        else if (stage.includes("fail") || stage === "rejected" || stage === "execution_blocked") toast.error(title, opts);
        else if (stage === "executing") toast.loading(title, opts);
        else toast.info(title, opts);
      }
    },
    [addNotification, qc, isDismissed]
  );

  const handleTradeEvent = useCallback(
    (data: Record<string, unknown>) => {
      const action = String(data.action || "");
      const symbol = String(data.symbol || "");
      const now = Date.now();

      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["openTrades"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["topnavTradingDashboard"] });

      const titles: Record<string, string> = {
        opened: "Trade opened",
        tp2_partial: "TP2 hit — partial close",
        tp2_closed: "TP2 hit — closed",
        closed: "Trade closed",
        stopped: "Stop loss hit",
      };
      const title = titles[action] || `Trade: ${action}`;
      const pnl = data.pnl != null ? ` PnL ${Number(data.pnl).toFixed(2)} USDT` : "";
      const dedupeKey = `trade:${data.trade_id || symbol}:${action}`;

      if (isDismissed(dedupeKey)) return;
      const added = addNotification({ type: "trade", title, message: `${symbol}${pnl}`, ts: now, dedupeKey });
      if (!added) return;

      const opts = { description: `${symbol}${pnl}`, id: dedupeKey };
      if (action.includes("closed") || action === "stopped") toast.info(title, opts);
      else toast.success(title, opts);
    },
    [addNotification, qc, isDismissed]
  );

  const connect = useCallback(() => {
    if (!enabled || typeof window === "undefined") return;
    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        reconnectRef.current = setTimeout(() => connectRef.current?.(), 5000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as Record<string, unknown>;
          if (data.type === "connected") return;

          if (data.type === "signal") {
            notifySignal(data);
            return;
          }

          if (data.type === "telegram_pipeline") {
            handleTelegramPipeline(data);
            return;
          }

          if (data.type === "trade_event") {
            handleTradeEvent(data);
            return;
          }

          if (data.type === "account_update") {
            qc.invalidateQueries({ queryKey: ["trades"] });
            qc.invalidateQueries({ queryKey: ["openTrades"] });
            qc.invalidateQueries({ queryKey: ["balance"] });
            qc.invalidateQueries({ queryKey: ["topnavTradingDashboard"] });
            return;
          }

          if (data.type === "scanner") {
            addNotification({
              type: "system",
              title: "Scanner update",
              message: data.isRunning ? "Scanner started" : "Scanner stopped",
              ts: Date.now(),
            });
          }
        } catch {
          /* ignore non-json */
        }
      };
    } catch {
      setWsConnected(false);
    }
  }, [enabled, setWsConnected, notifySignal, handleTelegramPipeline, handleTradeEvent, addNotification]);

  useEffect(() => {
    connectRef.current = connect;
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected: useSystemStore((s) => s.wsConnected) };
}
