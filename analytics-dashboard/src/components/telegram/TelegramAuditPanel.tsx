"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tradingApi } from "@/services/api";
import { cn } from "@/lib/utils";
import { getTradingApi } from "@/lib/constants";

type AuditTab = "raw" | "parsed" | "rejected" | "memory";

function fmtTime(v?: string) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
}

export function TelegramAuditPanel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<AuditTab>("rejected");
  const [selectedRawId, setSelectedRawId] = useState<string | null>(null);

  const rawQ = useQuery({
    queryKey: ["telegramAuditRaw"],
    queryFn: () => tradingApi.telegramRawMessages(80),
    enabled: tab === "raw",
    refetchInterval: 15_000,
  });

  const parsedQ = useQuery({
    queryKey: ["telegramAuditParsed"],
    queryFn: () => tradingApi.telegramParsedSignals(80),
    enabled: tab === "parsed",
    refetchInterval: 15_000,
  });

  const rejectedQ = useQuery({
    queryKey: ["telegramAuditRejected"],
    queryFn: () => tradingApi.telegramRejectedSignals(80),
    enabled: tab === "rejected",
    refetchInterval: 15_000,
  });

  const memoryQ = useQuery({
    queryKey: ["telegramGroupMemory"],
    queryFn: () => tradingApi.telegramGroupMemory(),
    enabled: tab === "memory",
    refetchInterval: 30_000,
  });

  const detailQ = useQuery({
    queryKey: ["telegramRawDetail", selectedRawId],
    queryFn: () => tradingApi.telegramRawMessage(selectedRawId!),
    enabled: Boolean(selectedRawId),
  });

  const archiveMut = useMutation({
    mutationFn: () => tradingApi.telegramArchiveRecent(10),
    onSuccess: (d) => {
      toast.success(d.message || `Archive queued for ${d.queued} groups`);
      qc.invalidateQueries({ queryKey: ["telegramAuditRaw"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tabs: { id: AuditTab; label: string }[] = [
    { id: "rejected", label: "Rejections" },
    { id: "parsed", label: "Parsed (AI)" },
    { id: "raw", label: "Raw archive" },
    { id: "memory", label: "Group memory" },
  ];

  const rejections = (rejectedQ.data?.rejections || []) as Array<Record<string, unknown>>;
  const parsed = (parsedQ.data?.signals || []) as Array<Record<string, unknown>>;
  const raw = (rawQ.data?.messages || []) as Array<Record<string, unknown>>;
  const groups = (memoryQ.data?.groups || []) as Array<Record<string, unknown>>;

  const detail = detailQ.data?.message as Record<string, unknown> | undefined;
  const imageUrl = useMemo(() => {
    if (!selectedRawId) return null;
    return `${getTradingApi()}/telegram/raw/${selectedRawId}/image`;
  }, [selectedRawId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium",
                tab === t.id ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 text-zinc-400"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => archiveMut.mutate()} disabled={archiveMut.isPending}>
          Backfill 10 / group (slow)
        </Button>
        <p className="w-full text-xs text-zinc-500">
          Live Telethon listener archives every new message automatically — no bulk scrape needed.
        </p>
      </div>

      {tab === "rejected" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rejection log — why signals failed</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[65vh] space-y-3 overflow-y-auto">
            {rejections.map((row) => {
              const failed = (row.failed_rules as string[]) || [];
              const source = row.telegram_signal_sources as { title?: string } | null;
              return (
                <div key={String(row.id)} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-200">{source?.title || "Unknown group"}</span>
                    <Badge variant="danger">{String(row.reject_stage)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{fmtTime(row.created_at as string)}</p>
                  <p className="mt-2 text-sm text-red-300">{String(row.reject_reason || "—")}</p>
                  {row.validation_score != null && (
                    <p className="mt-1 text-xs text-zinc-400">Score: {String(row.validation_score)}</p>
                  )}
                  {failed.length > 0 && (
                    <ul className="mt-2 list-inside list-disc text-xs text-amber-300/90">
                      {failed.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  )}
                  {Boolean(row.original_message) && (
                    <pre className="mt-2 max-h-24 overflow-auto rounded bg-zinc-900 p-2 text-[10px] text-zinc-400 whitespace-pre-wrap">
                      {String(row.original_message).slice(0, 500)}
                    </pre>
                  )}
                </div>
              );
            })}
            {!rejections.length && <p className="py-8 text-center text-sm text-zinc-500">No rejections logged yet.</p>}
          </CardContent>
        </Card>
      )}

      {tab === "parsed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI parsed output (review before execution)</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[65vh] space-y-3 overflow-y-auto">
            {parsed.map((row) => {
              const ai = (row.ai_output as Record<string, unknown>) || {};
              const review = (ai.review_shape as Record<string, unknown>) || ai;
              const source = row.telegram_signal_sources as { title?: string } | null;
              return (
                <div key={String(row.id)} className="rounded-lg border border-zinc-800 p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-mono text-sm text-zinc-100">
                      {String(review.symbol || "—")} {String(review.direction || "")}
                    </span>
                    <Badge variant="info">{String(row.parse_stage || row.parser_used || "ai")}</Badge>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {source?.title} · {String(row.model_used || "—")} · {fmtTime(row.created_at as string)}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    {(["entry", "sl", "tp1", "tp2", "tp3", "confidence"] as const).map((k) => (
                      <div key={k} className="rounded bg-zinc-900/80 px-2 py-1">
                        <span className="uppercase text-zinc-500">{k}: </span>
                        <span className="text-zinc-200">{String(review[k] ?? "—")}</span>
                      </div>
                    ))}
                  </div>
                  {Boolean(review.reason) && <p className="mt-2 text-xs text-zinc-400">{String(review.reason)}</p>}
                </div>
              );
            })}
            {!parsed.length && <p className="py-8 text-center text-sm text-zinc-500">No parsed signals yet.</p>}
          </CardContent>
        </Card>
      )}

      {tab === "raw" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Raw Telegram messages</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[65vh] space-y-2 overflow-y-auto">
              {raw.map((row) => {
                const source = row.telegram_signal_sources as { title?: string } | null;
                return (
                  <button
                    key={String(row.id)}
                    type="button"
                    onClick={() => setSelectedRawId(String(row.id))}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left",
                      selectedRawId === row.id ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800"
                    )}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-sm text-zinc-200">{source?.title || "Group"}</span>
                      <Badge>{String(row.processed_status)}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{String(row.text || "[image only]").slice(0, 160)}</p>
                    {Boolean(row.has_image) && <span className="mt-1 inline-block text-[10px] text-sky-400">📷 chart attached</span>}
                  </button>
                );
              })}
              {!raw.length && <p className="py-8 text-center text-sm text-zinc-500">No raw archive yet — live listener fills this automatically; optional backfill above.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Message detail</CardTitle>
            </CardHeader>
            <CardContent>
              {!detail && <p className="text-sm text-zinc-500">Select a message to review original text + chart.</p>}
              {detail && (
                <div className="space-y-3">
                  <pre className="max-h-40 overflow-auto rounded bg-zinc-900 p-3 text-xs whitespace-pre-wrap text-zinc-300">
                    {String(detail.text || "")}
                  </pre>
                  {Boolean(detail.has_image) && imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="Telegram chart" className="max-h-80 rounded border border-zinc-800" />
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "memory" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-group format memory</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[65vh] space-y-3 overflow-y-auto">
            {groups.map((g) => {
              const source = g.telegram_signal_sources as { title?: string; username?: string } | null;
              const keywords = (g.signal_keywords as string[]) || [];
              const examples = (g.successful_examples as unknown[]) || [];
              const formatNotes = (g.format_profile as Record<string, unknown> | undefined)?.notes;
              return (
                <div key={String(g.id)} className="rounded-lg border border-zinc-800 p-3">
                  <p className="font-medium text-zinc-100">{source?.title || g.group_title as string}</p>
                  <p className="text-xs text-zinc-500">@{String(source?.username || g.group_username || "—")}</p>
                  <p className="mt-2 text-xs text-zinc-400">
                    Entry: {String(g.entry_format || "—")} · SL/TP: {String(g.sl_format || "—")}
                  </p>
                  {keywords.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">Keywords: {keywords.slice(0, 8).join(", ")}</p>
                  )}
                  {Boolean(formatNotes) && (
                    <p className="mt-2 text-xs text-zinc-400">{String(formatNotes)}</p>
                  )}
                  <p className="mt-1 text-[10px] text-zinc-600">{examples.length} successful examples stored</p>
                </div>
              );
            })}
            {!groups.length && <p className="py-8 text-center text-sm text-zinc-500">Run Learn format on each group to populate memory.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
