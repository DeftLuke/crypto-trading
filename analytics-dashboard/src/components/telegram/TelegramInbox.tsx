"use client";

import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Inbox,
  Play,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { tradingApi } from "@/services/api";
import { cn } from "@/lib/utils";
import { getPipelineStage, pipelineProgress, stageBadgeVariant } from "@/lib/pipelineStage";
import { useNotificationStore } from "@/store/notificationStore";
import { toast } from "sonner";

export type InboxMessage = {
  id: string;
  telegram_chat_id: number;
  message_id: number;
  raw_message: string;
  parse_status?: string;
  parsed_signal?: {
    symbol?: string;
    side?: string;
    entry?: number;
    stop_loss?: number;
    take_profit?: number[];
    parser?: string;
    confidence?: number;
    metadata?: { has_image?: boolean; levels_source?: string };
  } | null;
  received_at?: string;
  message_date?: string;
  api_result?: {
    ok?: boolean;
    passed?: boolean;
    stale?: boolean;
    ready_to_approve?: boolean;
    approved?: boolean;
    executed?: boolean;
    reason?: string;
    status?: number;
    last_error?: string | null;
    error?: string | { error?: string };
    test_levels_refreshed?: boolean;
    refreshed_at?: string;
    mark_price?: number;
    ai_analysis?: { side?: string; confidence?: number; reason?: string; source?: string };
    pipeline_stage?: string;
    live?: boolean;
    scrape?: boolean;
    levels_adapted?: boolean;
    adapt_mark_price?: number;
    auto_executed?: boolean;
    auto_skip_reason?: string;
    trade_id?: string;
    protection?: { ok?: boolean; verify?: { slCount?: number; tpCount?: number; positionQty?: number } };
    validation?: { score?: number; checks?: Array<{ rule: string; passed: boolean; message: string }> };
    signal?: { symbol?: string; side?: string; entry?: number; stop_loss?: number; tp1?: number; tp2?: number };
    execution?: { success?: boolean; error?: string };
  };
  symbol_blocked?: boolean;
  symbol_block_reason?: string | null;
  telegram_signal_sources?: { title?: string; username?: string; is_followed?: boolean } | null;
};

type InboxStats = {
  total: number;
  parsed: number;
  skipped: number;
  validated: number;
  rejected: number;
  stale: number;
  executing?: number;
  executed?: number;
  failed?: number;
  approved?: number;
  needs_revalidation?: number;
  live_signals?: number;
};

function formatTime(value?: string) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function ageLabel(value?: string) {
  if (!value) return "";
  const ms = Date.now() - new Date(value).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

type Filter = "all" | "validated" | "executed" | "failed" | "stale";

type FollowedSource = { id: string; title?: string; telegram_chat_id: number; is_followed?: boolean };

export function TelegramInbox({ onScrapeQueued }: { onScrapeQueued?: () => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [groupChatId, setGroupChatId] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [customSizes, setCustomSizes] = useState<Record<string, string>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["telegramInbox", groupChatId],
    queryFn: () =>
      tradingApi.telegramInbox(
        500,
        "all",
        groupChatId === "all" ? undefined : groupChatId
      ),
    refetchInterval: 10_000,
  });

  const revalidateMutation = useMutation({
    mutationFn: () => tradingApi.revalidateTelegramInbox(50),
    onSuccess: (res) => {
      toast.success(`Re-validated ${res.count ?? 0} signal(s)`);
      qc.invalidateQueries({ queryKey: ["telegramInbox"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Re-validation failed");
    },
  });

  const liveListener = data?.live_listener !== false;
  const control = data?.control as { auto_trading?: boolean; manual_approval?: boolean; mode?: string } | undefined;
  const lastLiveAt = data?.last_live_at as string | undefined;

  const followedGroups = (data?.followed_sources || []) as FollowedSource[];

  const { data: defaults } = useQuery({
    queryKey: ["telegramTradeDefaults"],
    queryFn: () => tradingApi.telegramTradeDefaults(),
  });

  const [scrapePolling, setScrapePolling] = useState(false);

  const { data: scrapeStatus } = useQuery({
    queryKey: ["telegramScrapeStatus"],
    queryFn: () => tradingApi.telegramScrapeStatus(),
    enabled: scrapePolling,
    refetchInterval: scrapePolling ? 3000 : false,
  });

  useEffect(() => {
    const status = scrapeStatus?.active?.status;
    if (status === "done" || status === "error") {
      setScrapePolling(false);
      qc.invalidateQueries({ queryKey: ["telegramInbox"] });
    }
  }, [scrapeStatus?.active?.status, qc]);

  const scrapeMutation = useMutation({
    mutationFn: () => tradingApi.scrapeTelegramRecent(25),
    onSuccess: () => {
      onScrapeQueued?.();
      setScrapePolling(true);
      qc.invalidateQueries({ queryKey: ["telegramScrapeStatus"] });
    },
  });

  const scrapeActive = scrapeStatus?.active;
  const isScraping =
    scrapeMutation.isPending
    || scrapePolling
    || scrapeActive?.status === "queued"
    || scrapeActive?.status === "running";
  const scrapePct =
    scrapeActive && scrapeActive.total > 0
      ? Math.round((scrapeActive.completed / scrapeActive.total) * 100)
      : 0;

  const addNotification = useNotificationStore((s) => s.add);
  const messages = (data?.messages || []) as InboxMessage[];

  const refreshMutation = useMutation({
    mutationFn: (id: string) => tradingApi.refreshTelegramForTest(id),
    onMutate: (id) => {
      const sym = messages.find((m) => m.id === id)?.parsed_signal?.symbol || "";
      toast.loading(`Refreshing ${sym} for test…`, { id: `refresh-${id}` });
    },
    onSuccess: (res, id) => {
      toast.dismiss(`refresh-${id}`);
      if (res.ok) {
        const ai = res.ai_analysis;
        toast.success(`Refreshed ${res.symbol} @ $${res.mark_price?.toFixed(4)}`, {
          description: ai ? `${ai.side} (${ai.confidence}%) — ${ai.reason}` : undefined,
        });
      } else {
        toast.error(String(res.error || "Refresh failed"));
      }
      qc.invalidateQueries({ queryKey: ["telegramInbox"] });
    },
    onError: (err, id) => {
      toast.dismiss(`refresh-${id}`);
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, margin }: { id: string; margin?: number }) =>
      tradingApi.approveTelegramSignal(id, margin ? { margin_usdt: margin } : {}),
    onMutate: ({ id }) => {
      const msg = messages.find((m) => m.id === id);
      const sym = msg?.parsed_signal?.symbol || "";
      toast.loading(`Approving ${sym}…`, { id: `approve-${id}` });
      addNotification({ type: "telegram", title: "Approving trade", message: sym, ts: Date.now() });
    },
    onSuccess: (res, { id }) => {
      toast.dismiss(`approve-${id}`);
      if (res.ok) {
        toast.success("Trade executed", { description: "Check Trades page for position" });
      } else {
        toast.error(String(res.error || "Approve failed"));
      }
      qc.invalidateQueries({ queryKey: ["telegramInbox"] });
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["openTrades"] });
    },
    onError: (err, { id }) => {
      toast.dismiss(`approve-${id}`);
      toast.error(err instanceof Error ? err.message : "Approve failed");
    },
  });

  const stats = (data?.stats || {}) as InboxStats;
  const testMode = Boolean(data?.test_mode);

  const filtered = useMemo(() => {
    let rows = messages.filter((m) => m.parse_status === "parsed");
    if (filter === "validated") {
      rows = rows.filter((m) => m.api_result?.passed || m.api_result?.ready_to_approve);
    } else if (filter === "executed") {
      rows = rows.filter((m) => m.api_result?.executed);
    } else if (filter === "failed") {
      rows = rows.filter(
        (m) =>
          !m.api_result?.executed
          && (Boolean(m.api_result?.last_error)
            || m.api_result?.pipeline_stage === "approve_failed"
            || m.api_result?.pipeline_stage === "rejected")
      );
    } else if (filter === "stale") {
      rows = rows.filter(
        (m) => m.api_result?.stale || m.api_result?.pipeline_stage === "stale"
      );
    }
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => {
      const sig = m.parsed_signal || m.api_result?.signal || {};
      return (
        m.raw_message?.toLowerCase().includes(q)
        || m.telegram_signal_sources?.title?.toLowerCase().includes(q)
        || String(sig.symbol || "").toLowerCase().includes(q)
      );
    });
  }, [messages, filter, search]);

  function shortGroupName(title?: string) {
    if (!title) return "Group";
    const clean = title.replace(/[^\w\s]/g, " ").trim();
    return clean.length > 18 ? `${clean.slice(0, 16)}…` : clean;
  }

  const defaultNotional = defaults?.notional_usdt;
  const defaultRisk = defaults?.risk_amount ?? (defaults?.balance ? defaults.balance * 0.01 : null);
  const riskLabel = defaultRisk != null ? `1% risk (~$${defaultRisk.toFixed(0)})` : "1% risk sizing";

  return (
    <div className="space-y-4">
      {liveListener && (
        <div className="rounded-lg border border-blue-900/40 bg-blue-950/20 px-4 py-2 text-xs text-blue-200">
          <span className="font-medium">Live listener ON</span>
          {lastLiveAt ? ` — last live signal ${ageLabel(lastLiveAt)}` : " — waiting for next VIP message"}
          {control?.auto_trading && !control?.manual_approval ? (
            <span className="ml-2 text-emerald-300">· Auto-trade active</span>
          ) : control?.manual_approval ? (
            <span className="ml-2 text-amber-300">· Manual approval required</span>
          ) : null}
        </div>
      )}

      {control && !control.auto_trading && (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          Auto-trade is OFF in Control Center — signals validate but won&apos;t open until you enable Auto Trade or click Approve.
        </div>
      )}

      {testMode ? (
        <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          Test mode ON — freshness/score gates relaxed. Production uses auto-validation + auto-trade when enabled in Control Center.
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-4 py-2 text-xs text-emerald-200">
          Auto mode — trades size at <strong>1% account risk</strong> (30/40/30 protection at open). Custom $ overrides notional.
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "All signals", stats.parsed ?? 0],
              ["validated", "Validated", stats.validated ?? 0],
              ["executed", "Opened", stats.executed ?? 0],
              ["failed", "Failed", stats.failed ?? 0],
              ["stale", "Stale", stats.stale ?? 0],
            ] as const
          ).map(([key, label, count]) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? "default" : "secondary"}
              onClick={() => setFilter(key)}
            >
              {label} ({count})
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          {(stats.needs_revalidation ?? 0) > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => revalidateMutation.mutate()}
              disabled={revalidateMutation.isPending}
              title="Only for signals that failed validation during scrape — not run automatically"
            >
              <Play className="mr-2 h-4 w-4" />
              {revalidateMutation.isPending ? "Validating…" : "Re-validate all"}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => scrapeMutation.mutate()} disabled={isScraping} title="Optional: read last 25 messages per group once">
            <Inbox className="mr-2 h-4 w-4" />
            {isScraping ? `Syncing… ${scrapePct}%` : "One-time sync (25 msgs)"}
          </Button>
        </div>
      </div>

      {followedGroups.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Button
            size="sm"
            variant={groupChatId === "all" ? "default" : "secondary"}
            className="shrink-0"
            onClick={() => setGroupChatId("all")}
          >
            All groups ({followedGroups.length})
          </Button>
          {followedGroups.map((group) => (
            <Button
              key={group.id}
              size="sm"
              variant={groupChatId === group.telegram_chat_id ? "default" : "secondary"}
              className="shrink-0 max-w-[160px] truncate"
              title={group.title}
              onClick={() => setGroupChatId(group.telegram_chat_id)}
            >
              {shortGroupName(group.title)}
            </Button>
          ))}
        </div>
      )}

      {(isScraping || scrapeMutation.isSuccess) && (
        <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-200">
          {isScraping ? (
            <>
              <p className="font-medium">
                Scraping {scrapeActive?.completed ?? 0}/{scrapeActive?.total ?? data?.followed_count ?? 9} groups
                {scrapeActive?.current ? ` — ${scrapeActive.current}` : ""}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${Math.max(scrapePct, scrapeMutation.isPending ? 5 : 0)}%` }}
                />
              </div>
              {(scrapeActive?.results || []).slice(-4).map((row) => (
                <p key={row.title} className="mt-1 text-zinc-500">
                  {row.title}: {row.error ? `error — ${row.error}` : row.parsed ? "signal found" : "no signal in last 25 msgs"}
                </p>
              ))}
            </>
          ) : (
            <p>{(scrapeMutation.data as { message?: string })?.message || "Scrape finished — refresh if signals are missing"}</p>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4" />
          {error instanceof Error ? error.message : "Failed to load inbox"}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-10 pr-3 text-sm text-zinc-200 outline-none focus:border-emerald-500"
          placeholder="Search symbol or group…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-zinc-800 bg-zinc-950/80 py-3">
          <CardTitle className="text-sm font-medium text-zinc-300">
            {groupChatId === "all" ? "All groups" : "Group"} — {filtered.length} signal{filtered.length === 1 ? "" : "s"}
            {filter !== "all" ? ` (${filter})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-[min(560px,60vh)] overflow-y-auto p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-zinc-900" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <Inbox className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
              <p className="text-sm text-zinc-400">No signals in this view</p>
              <p className="mt-1 text-xs text-zinc-600">
                {messages.length === 0
                  ? "Follow groups on the Groups tab — new VIP messages appear here automatically"
                  : "Try “All signals” or run a one-time sync"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {filtered.map((message) => (
                <InboxRow
                  key={message.id}
                  message={message}
                  expanded={expandedId === message.id}
                  defaultMargin={defaultNotional ?? 0}
                  defaultRiskLabel={riskLabel}
                  customSize={customSizes[message.id] || ""}
                  onCustomSizeChange={(v) => setCustomSizes((s) => ({ ...s, [message.id]: v }))}
                  onToggle={() => setExpandedId(expandedId === message.id ? null : message.id)}
                  onApprove={(margin) => approveMutation.mutate({ id: message.id, margin })}
                  approving={approveMutation.isPending && approveMutation.variables?.id === message.id}
                  onRefresh={() => refreshMutation.mutate(message.id)}
                  refreshing={refreshMutation.isPending && refreshMutation.variables === message.id}
                  testMode={testMode}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-8">
        <StatPill label="Signals" value={stats.parsed ?? 0} tone="emerald" />
        <StatPill label="Validated" value={stats.validated ?? 0} tone="emerald" />
        <StatPill label="Executing" value={stats.executing ?? 0} tone={stats.executing ? "warning" : undefined} />
        <StatPill label="Opened" value={stats.executed ?? 0} tone="emerald" />
        <StatPill label="Failed" value={stats.failed ?? 0} tone={stats.failed ? "danger" : undefined} />
        <StatPill label="Stale" value={stats.stale ?? 0} tone={stats.stale ? "warning" : undefined} />
        <StatPill label="Groups" value={data?.followed_count ?? 0} />
        <StatPill label="Live" value={stats.live_signals ?? 0} />
      </div>
    </div>
  );
}

function InboxRow({
  message,
  expanded,
  defaultMargin,
  defaultRiskLabel,
  customSize,
  onCustomSizeChange,
  onToggle,
  onApprove,
  approving,
  onRefresh,
  refreshing,
  testMode,
}: {
  message: InboxMessage;
  expanded: boolean;
  defaultMargin: number;
  defaultRiskLabel: string;
  customSize: string;
  onCustomSizeChange: (v: string) => void;
  onToggle: () => void;
  onApprove: (margin?: number) => void;
  approving: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  testMode: boolean;
}) {
  const pipeline = getPipelineStage(message);
  const sig = message.parsed_signal || {};
  const result = message.api_result || {};
  const signal = result.signal || sig;
  const isParsed = message.parse_status === "parsed";
  const ready = (result.ready_to_approve || result.passed || testMode) && !message.symbol_blocked;
  const executed = Boolean(result.executed);
  const approved = Boolean(result.approved);
  const executionFailed = Boolean(result.last_error || result.execution?.error) && !executed;
  const symbolBlocked = Boolean(message.symbol_blocked);
  const score = result.validation?.score ?? sig.confidence;
  const hasImage = sig.metadata?.has_image;
  const customMargin = parseFloat(customSize);
  const useCustom = Number.isFinite(customMargin) && customMargin > 0;

  return (
    <div className="bg-zinc-950/40 transition-colors hover:bg-zinc-900/50">
      <div className="flex w-full flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onToggle}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-100">
              {message.telegram_signal_sources?.title || message.telegram_chat_id}
            </span>
            {message.telegram_signal_sources?.username && (
              <span className="text-xs text-zinc-600">@{message.telegram_signal_sources.username}</span>
            )}
            {hasImage && <ImageIcon className="h-3.5 w-3.5 text-blue-400" />}
          </div>
          {isParsed ? (
            <p className="mt-1 font-mono text-sm text-emerald-400">
              {String(signal.symbol || sig.symbol || "—")}{" "}
              <span className="text-zinc-300">{String(signal.side || sig.side || "")}</span>
              {" · "}Entry {String(signal.entry ?? sig.entry ?? "—")}
              {" · "}SL {String(signal.stop_loss ?? sig.stop_loss ?? "—")}
            </p>
          ) : (
            <p className="mt-1 line-clamp-1 text-sm text-zinc-500">{message.raw_message}</p>
          )}
          <p className="mt-1 text-[10px] text-zinc-600">
            {formatTime(message.message_date || message.received_at)} · {ageLabel(message.message_date || message.received_at)}
            {sig.parser ? ` · ${sig.parser}` : ""}
            {result.live ? " · live" : result.scrape ? " · sync" : ""}
          </p>
          {pipeline.detail && (
            <p className="mt-0.5 text-[10px] text-zinc-500">{pipeline.detail}</p>
          )}
        </button>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <Badge variant={stageBadgeVariant[pipeline.stage]} title={pipeline.label}>
            {pipeline.label}
          </Badge>
          {executed && (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> Executed
            </Badge>
          )}
          {!executed && approved && (
            <Badge variant="info" className="gap-1">Approved</Badge>
          )}
          {executionFailed && (
            <Badge variant="danger" className="gap-1" title={String(result.last_error || result.execution?.error || "")}>
              <XCircle className="h-3 w-3" /> Execution failed
            </Badge>
          )}
          {!executed && !approved && isParsed && ready && pipeline.stage === "ready" && <Badge variant="info">Approve</Badge>}
          {!executed && isParsed && symbolBlocked && (
            <Badge variant="warning" title={message.symbol_block_reason || undefined}>
              Pair blocked
            </Badge>
          )}
          {result.test_levels_refreshed && (
            <Badge variant="warning" title={result.refreshed_at}>Test refreshed</Badge>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
        </div>

        {isParsed && !executed && (!approved || executionFailed) && (
          <div className="flex w-full flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-3 lg:w-auto lg:border-0 lg:pt-0">
            {symbolBlocked ? (
              <p className="text-xs text-amber-400">{message.symbol_block_reason || "Same pair already in a trade"}</p>
            ) : (
              <>
                {testMode && onRefresh && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={refreshing || approving}
                    onClick={onRefresh}
                    title="Reprice to current market + AI bias check"
                  >
                    <RefreshCw className={cn("mr-1 h-3 w-3", refreshing && "animate-spin")} />
                    {refreshing ? "…" : "Refresh for test"}
                  </Button>
                )}
                <input
                  type="number"
                  min={1}
                  step={1}
                  placeholder={defaultMargin > 0 ? `Override $${Math.round(defaultMargin)}` : "Custom $ size"}
                  title="Optional fixed position size in USDT — leave empty for 1% risk sizing"
                  className="w-28 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
                  value={customSize}
                  onChange={(e) => onCustomSizeChange(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={approving}
                  onClick={() => onApprove(useCustom ? customMargin : undefined)}
                >
                  <Play className="mr-1 h-3 w-3" />
                  {approving ? "…" : useCustom ? `Approve $${customMargin} size` : `Approve (${defaultRiskLabel})`}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-zinc-800/80 bg-zinc-950 px-4 py-3 text-xs">
          <PipelineTimeline stage={pipeline.stage} progress={pipelineProgress(pipeline.stage)} />
          {result.last_error && !executed && (
            <p className="mb-2 rounded border border-red-900/40 bg-red-950/30 px-2 py-1.5 text-red-300">
              {String(result.last_error)}
            </p>
          )}
          {result.levels_adapted && (
            <p className="mb-2 text-emerald-400/90">
              Levels adapted to market
              {result.adapt_mark_price != null ? ` @ $${Number(result.adapt_mark_price).toFixed(5)}` : ""}
            </p>
          )}
          <p className="mb-2 whitespace-pre-wrap text-zinc-400">{message.raw_message}</p>
          {result.ai_analysis && (
            <div className="mt-2 rounded border border-amber-900/40 bg-amber-950/20 p-2 text-amber-100">
              <p className="font-medium text-amber-200">AI market bias</p>
              <p>
                {result.ai_analysis.side} · {result.ai_analysis.confidence}% — {result.ai_analysis.reason}
              </p>
              {result.mark_price != null && (
                <p className="mt-1 text-amber-300/80">Mark @ refresh: ${result.mark_price}</p>
              )}
            </div>
          )}
          {result.validation?.checks && (
            <div className="mt-2 space-y-1">
              <p className="font-medium text-zinc-500">Validation</p>
              {result.validation.checks.map((check) => (
                <div key={check.rule} className="flex items-center gap-2">
                  {check.passed ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <XCircle className="h-3 w-3 text-red-500" />
                  )}
                  <span className={cn(check.passed ? "text-zinc-400" : "text-red-300")}>
                    {check.rule}: {check.message}
                  </span>
                </div>
              ))}
            </div>
          )}
          {result.reason && <p className="mt-2 text-zinc-600">Reason: {result.reason}</p>}
          {result.executed && result.trade_id && (
            <p className="mt-2 text-emerald-400/90">
              Trade opened · ID <code>{result.trade_id}</code>
              {result.protection?.ok ? " · 30/40/30 protection verified on Binance" : result.protection ? " · protection pending verify" : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PipelineTimeline({ stage, progress }: { stage: string; progress: number }) {
  const steps = ["Received", "Parsed", "Validated", "Trade", "Opened"];
  const failed = progress < 0;
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-[10px] text-zinc-500">
        {steps.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn(
            "h-full transition-all",
            failed ? "bg-red-500 w-full" : stage === "executed" ? "bg-emerald-500" : "bg-blue-500"
          )}
          style={{ width: failed ? "100%" : `${Math.max(progress, 8)}%` }}
        />
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone = "zinc",
}: {
  label: string;
  value: number | string;
  tone?: "zinc" | "emerald" | "danger" | "warning";
}) {
  const colors = {
    zinc: "text-zinc-100 border-zinc-800",
    emerald: "text-emerald-400 border-emerald-900/50",
    danger: "text-red-400 border-red-900/50",
    warning: "text-amber-400 border-amber-900/50",
  };
  return (
    <div className={cn("rounded-xl border bg-zinc-950/60 px-4 py-3", colors[tone])}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
