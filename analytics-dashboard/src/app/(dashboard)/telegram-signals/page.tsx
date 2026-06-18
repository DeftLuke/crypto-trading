"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCw, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { tradingApi } from "@/services/api";
import { getTradingApi } from "@/lib/constants";
import { TelegramInbox } from "@/components/telegram/TelegramInbox";
import { cn } from "@/lib/utils";

type FormatProfile = {
  style?: string;
  notes?: string;
  sl_tp_location?: string;
  learned_at?: string;
  sample_count?: number;
  parsed_examples?: Array<{ symbol?: string; side?: string; snippet?: string; has_image?: boolean }>;
};

type TelegramSource = {
  id: string;
  telegram_chat_id: number;
  title: string;
  username?: string | null;
  source_type?: string | null;
  provider_id?: string | null;
  parser?: string | null;
  is_followed?: boolean;
  last_synced_at?: string | null;
  metadata?: { format_profile?: FormatProfile } & Record<string, unknown>;
};

type TelegramMessage = {
  id: string;
  telegram_chat_id: number;
  message_id: number;
  raw_message: string;
  parse_status?: string;
  parsed_signal?: Record<string, unknown> | null;
  received_at?: string;
  message_date?: string;
  api_result?: { passed?: boolean; reason?: string; validation?: { score?: number } };
  telegram_signal_sources?: { title?: string; username?: string; is_followed?: boolean } | null;
};

function formatTime(value?: string) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function TelegramSignalsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"inbox" | "groups">("inbox");

  const {
    data: sourcesData,
    isLoading: sourcesLoading,
    error: sourcesError,
    isError: sourcesIsError,
    refetch: refetchSources,
  } = useQuery({
    queryKey: ["telegramSources"],
    queryFn: () => tradingApi.telegramSources(),
    refetchInterval: 10_000,
    retry: 2,
  });

  const { data: inboxStatsData, error: messagesError, refetch: refetchMessages } = useQuery({
    queryKey: ["telegramInboxStats"],
    queryFn: () => tradingApi.telegramInbox(1),
    refetchInterval: 15_000,
    enabled: !sourcesIsError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      tradingApi.updateTelegramSource(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["telegramSources"] }),
  });

  const learnMutation = useMutation({
    mutationFn: (id: string) => tradingApi.learnTelegramFormat(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["telegramSources"] }),
  });

  const sources = (sourcesData?.sources || []) as TelegramSource[];
  const inboxStats = inboxStatsData?.stats || {};
  const followedCount = sources.filter((source) => source.is_followed).length;

  const filteredSources = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (source) =>
        source.title?.toLowerCase().includes(q)
        || source.username?.toLowerCase().includes(q)
        || String(source.telegram_chat_id).includes(q)
    );
  }, [sources, search]);

  async function setFollowAll(follow: boolean) {
    const targets = filteredSources.filter((s) => !!s.is_followed !== follow);
    await Promise.all(
      targets.map((source) => updateMutation.mutateAsync({ id: source.id, body: { is_followed: follow } }))
    );
  }

  const loadError = sourcesIsError
    ? (sourcesError instanceof Error ? sourcesError.message : "Failed to load groups")
    : messagesError instanceof Error
      ? messagesError.message
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Telegram Signal Sources"
        description="Follow VIP groups, scrape recent messages, and review parsed signals with full validation in the inbox."
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              refetchSources();
              refetchMessages();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {loadError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Could not load Telegram data</p>
            <p className="mt-1 text-red-200/80">{loadError}</p>
            <p className="mt-2 text-xs text-red-200/60">API: {getTradingApi()}/telegram/sources</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard title="Discovered Groups" value={sourcesLoading ? "…" : sources.length} />
        <MetricCard title="Following" value={sourcesLoading ? "…" : followedCount} tone="emerald" />
        <MetricCard title="Parsed Signals" value={Number(inboxStats.parsed ?? 0)} />
        <Card>
          <CardHeader><CardTitle>Signal Rules</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-zinc-500">
            <p>AI detects trade signals only</p>
            <p>Max age: 15 minutes</p>
            <p>EMA not required for TG trades</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={tab === "inbox" ? "default" : "secondary"} onClick={() => setTab("inbox")}>
          Inbox
        </Button>
        <Button variant={tab === "groups" ? "default" : "secondary"} onClick={() => setTab("groups")}>
          Groups ({sources.length})
        </Button>
      </div>

      {tab === "inbox" ? (
        <TelegramInbox onScrapeQueued={() => qc.invalidateQueries({ queryKey: ["telegramSources"] })} />
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Groups & Channels</CardTitle>
              <p className="mt-1 text-xs text-zinc-500">Toggle follow to start scraping signals from that group</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setFollowAll(true)} disabled={updateMutation.isPending || sources.length === 0}>
                Follow visible
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setFollowAll(false)} disabled={updateMutation.isPending || sources.length === 0}>
                Unfollow visible
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pl-10 pr-3 text-sm text-zinc-200 outline-none focus:border-emerald-500"
                placeholder="Search by name, @username, or chat id…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {sourcesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-900" />
                ))}
              </div>
            ) : filteredSources.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center">
                <p className="text-sm text-zinc-400">
                  {sources.length === 0
                    ? "No groups loaded from the API yet."
                    : "No groups match your search."}
                </p>
                {sources.length === 0 && !loadError && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Groups sync from Telethon on the server. If this stays empty after refresh, rebuild the analytics-dashboard container on Kali.
                  </p>
                )}
              </div>
            ) : (
              <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
                {filteredSources.map((source) => {
                  const profile = source.metadata?.format_profile;
                  return (
                  <div key={source.id} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-emerald-500"
                          checked={!!source.is_followed}
                          disabled={updateMutation.isPending}
                          onChange={(event) =>
                            updateMutation.mutate({ id: source.id, body: { is_followed: event.target.checked } })
                          }
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-zinc-100">{source.title || "Untitled group"}</p>
                          <p className="truncate text-xs text-zinc-500">
                            {source.username ? `@${source.username}` : `ID ${source.telegram_chat_id}`}
                            {" · "}
                            {source.source_type || "group"}
                          </p>
                          {profile?.style && (
                            <p className="mt-1 text-[10px] text-emerald-400/80">
                              Format: {profile.style}
                              {profile.sl_tp_location ? ` · SL/TP in ${profile.sl_tp_location}` : ""}
                            </p>
                          )}
                          {profile?.notes && (
                            <p className="mt-0.5 line-clamp-2 text-[10px] text-zinc-600">{profile.notes}</p>
                          )}
                          {source.last_synced_at && (
                            <p className="mt-0.5 text-[10px] text-zinc-600">Synced {formatTime(source.last_synced_at)}</p>
                          )}
                        </div>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={source.is_followed ? "success" : "secondary"}>
                          {source.is_followed ? "Following" : "Ignored"}
                        </Badge>
                        <Badge variant={profile?.learned_at ? "info" : "warning"}>
                          {profile?.learned_at ? "Format learned" : "Learning…"}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input
                        className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-500"
                        defaultValue={source.provider_id || source.username || ""}
                        placeholder="Provider ID"
                        onBlur={(event) => {
                          const value = event.target.value.trim();
                          if (value !== (source.provider_id || "")) {
                            updateMutation.mutate({ id: source.id, body: { provider_id: value } });
                          }
                        }}
                      />
                      <select
                        className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-emerald-500"
                        value={source.parser || "generic"}
                        onChange={(event) => updateMutation.mutate({ id: source.id, body: { parser: event.target.value } })}
                      >
                        <option value="generic">generic (AI + chart vision)</option>
                        <option value="vip_channel_1">vip_channel_1</option>
                      </select>
                    </div>
                    {source.is_followed && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={learnMutation.isPending}
                          onClick={() => learnMutation.mutate(source.id)}
                        >
                          Re-learn signal format
                        </Button>
                        <span className="self-center text-[10px] text-zinc-600">
                          AI reads last ~40 messages to learn this group&apos;s signal style (text, chart, SL/TP layout)
                        </span>
                      </div>
                    )}
                  </div>
                );})}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MetricCard({
  title,
  value,
  tone = "zinc",
}: {
  title: string;
  value: number | string;
  tone?: "zinc" | "emerald";
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <p className={cn("text-3xl font-bold", tone === "emerald" ? "text-emerald-400" : "text-zinc-100")}>{value}</p>
      </CardContent>
    </Card>
  );
}
