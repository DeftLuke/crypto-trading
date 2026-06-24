"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/badge";
import { tradingApi } from "@/services/api";
import { formatNumber, formatPrice, formatUsd, formatDateTime } from "@/lib/utils";

export default function RsiScalperPage() {
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["rsiScalperStatus"],
    queryFn: () => tradingApi.rsiScalperStatus(),
    refetchInterval: 5000,
  });

  const { data: signalsData } = useQuery({
    queryKey: ["rsiScalperSignals"],
    queryFn: () => tradingApi.rsiScalperSignals(20),
    refetchInterval: 10000,
  });

  const { data: tradesData } = useQuery({
    queryKey: ["rsiScalperTrades"],
    queryFn: () => tradingApi.rsiScalperTrades(50),
    refetchInterval: 15000,
  });

  const signals = (signalsData?.signals || []) as Array<{
    id: string;
    symbol: string;
    direction: string;
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    rsi?: number;
    atr?: number;
    reason?: string;
    triggered: boolean;
    triggered_at?: string;
    created_at: string;
  }>;

  const trades = (tradesData?.trades || []) as Array<{
    id: string;
    symbol: string;
    direction: string;
    entry_price: number;
    exit_price?: number;
    quantity: number;
    pnl?: number;
    pnl_pct?: number;
    stop_loss: number;
    take_profit: number;
    exit_reason?: string;
    rsi_entry?: number;
    rsi_exit?: number;
    opened_at: string;
    closed_at?: string;
  }>;

  const position = status?.position;
  const isRunning = status?.running;

  return (
    <div className="space-y-6">
      <PageHeader
        title="RSI Scalper Bot"
        description="BTCUSDT 5m mean-reversion scalper — automated"
        actions={
          <div className="flex gap-2">
            <Badge variant={isRunning ? "success" : "danger"}>
              {isRunning ? "Running" : "Stopped"}
            </Badge>
            <Badge variant={status?.mode === "live" ? "danger" : "secondary"}>
              {status?.mode === "live" ? "LIVE" : "Paper"}
            </Badge>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <MetricCard label="Balance" value={formatUsd(status?.balance)} />
        <MetricCard label="Equity" value={formatUsd(status?.equity)} />
        <MetricCard label="Daily PnL" value={formatUsd(status?.daily_pnl)} trend={(status?.daily_pnl ?? 0) >= 0 ? "up" : "down"} />
        <MetricCard label="Daily Limit" value={formatUsd(status?.daily_limit)} />
        <MetricCard label="Errors (1h)" value={String(status?.errors_last_hour ?? 0)} />
        <MetricCard label="Heartbeat" value={status?.last_heartbeat ? formatDateTime(status.last_heartbeat) : "—"} />
      </div>

      {position ? (
        <Card className="border-emerald-500/30">
          <CardHeader><CardTitle>Open Position</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
              <div>
                <p className="text-zinc-500">Symbol</p>
                <p className="font-medium">{position.symbol}</p>
              </div>
              <div>
                <p className="text-zinc-500">Direction</p>
                <Badge variant={position.direction === "SHORT" ? "danger" : "success"}>{position.direction}</Badge>
              </div>
              <div>
                <p className="text-zinc-500">Entry</p>
                <p className="font-medium tabular-nums">{formatPrice(position.entry_price)}</p>
              </div>
              <div>
                <p className="text-zinc-500">Current</p>
                <p className="font-medium tabular-nums">{formatPrice(position.current_price)}</p>
              </div>
              <div>
                <p className="text-zinc-500">Quantity</p>
                <p className="font-medium tabular-nums">{formatNumber(position.quantity, 6)}</p>
              </div>
              <div>
                <p className="text-zinc-500">Unrealized PnL</p>
                <p className={`font-semibold tabular-nums ${position.unrealized_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {formatUsd(position.unrealized_pnl)}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Stop Loss</p>
                <p className="font-medium tabular-nums text-red-400">{formatPrice(position.stop_loss)}</p>
              </div>
              <div>
                <p className="text-zinc-500">Take Profit</p>
                <p className="font-medium tabular-nums text-emerald-400">{formatPrice(position.take_profit)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-zinc-500">
            No open position — bot is {isRunning ? "scanning for entries" : "stopped"}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Recent Signals ({signals.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {signals.length === 0 ? (
            <p className="text-sm text-zinc-500">No signals yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Symbol</th>
                  <th className="pb-2 pr-3">Direction</th>
                  <th className="pb-2 pr-3">Entry</th>
                  <th className="pb-2 pr-3">SL</th>
                  <th className="pb-2 pr-3">TP</th>
                  <th className="pb-2 pr-3">RSI</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-800/50">
                    <td className="py-2 pr-3 text-zinc-400">{formatDateTime(s.created_at)}</td>
                    <td className="py-2 pr-3 font-medium">{s.symbol}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={s.direction === "SHORT" ? "danger" : "success"}>{s.direction}</Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatPrice(s.entry_price)}</td>
                    <td className="py-2 pr-3 tabular-nums text-red-400">{formatPrice(s.stop_loss)}</td>
                    <td className="py-2 pr-3 tabular-nums text-emerald-400">{formatPrice(s.take_profit)}</td>
                    <td className="py-2 pr-3 tabular-nums">{s.rsi?.toFixed(1)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={s.triggered ? "success" : "secondary"}>
                        {s.triggered ? "Triggered" : "Pending"}
                      </Badge>
                    </td>
                    <td className="py-2 text-zinc-400">{s.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Trade History ({trades.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {trades.length === 0 ? (
            <p className="text-sm text-zinc-500">No trades yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="pb-2 pr-3">Opened</th>
                  <th className="pb-2 pr-3">Closed</th>
                  <th className="pb-2 pr-3">Symbol</th>
                  <th className="pb-2 pr-3">Dir</th>
                  <th className="pb-2 pr-3">Entry</th>
                  <th className="pb-2 pr-3">Exit</th>
                  <th className="pb-2 pr-3">PnL</th>
                  <th className="pb-2 pr-3">ROE</th>
                  <th className="pb-2 pr-3">Exit Reason</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-t border-zinc-800/50">
                    <td className="py-2 pr-3 text-zinc-400">{formatDateTime(t.opened_at)}</td>
                    <td className="py-2 pr-3 text-zinc-400">{t.closed_at ? formatDateTime(t.closed_at) : "—"}</td>
                    <td className="py-2 pr-3 font-medium">{t.symbol}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={t.direction === "SHORT" ? "danger" : "success"}>{t.direction}</Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{formatPrice(t.entry_price)}</td>
                    <td className="py-2 pr-3 tabular-nums">{t.exit_price ? formatPrice(t.exit_price) : "—"}</td>
                    <td className={`py-2 pr-3 tabular-nums font-medium ${(t.pnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {t.pnl != null ? formatUsd(t.pnl) : "—"}
                    </td>
                    <td className={`py-2 pr-3 tabular-nums ${(t.pnl_pct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {t.pnl_pct != null ? `${t.pnl_pct >= 0 ? "+" : ""}${t.pnl_pct.toFixed(2)}%` : "—"}
                    </td>
                    <td className="py-2 text-zinc-400">{t.exit_reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
