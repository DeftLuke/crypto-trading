"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { researchApi } from "@/services/api";

type Message = { role: "user" | "assistant"; content: string };

export function AIChatPanel() {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();

  const { data: dash } = useQuery({
    queryKey: ["operationsDashboard"],
    queryFn: () => researchApi.operationsDashboard(),
    refetchInterval: 15000,
  });

  const chat = useMutation({
    mutationFn: (message: string) =>
      researchApi.agentChat({ message, conversation_id: conversationId, channel: "dashboard" }),
    onSuccess: (data) => {
      const d = data as { answer?: string; conversation_id?: string; suggestions?: string[] };
      if (d.conversation_id) setConversationId(d.conversation_id);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: d.answer || "No response" },
      ]);
      qc.invalidateQueries({ queryKey: ["operationsDashboard"] });
    },
  });

  const send = () => {
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { role: "user", content: input.trim() }]);
    chat.mutate(input.trim());
    setInput("");
  };

  const status = dash?.status as { llm_configured?: boolean; n8n_configured?: boolean } | undefined;
  const recentActions = (dash?.recent_actions || []) as { action_type?: string; ts?: string }[];

  return (
    <Card className="flex h-[520px] flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">AI Assistant</CardTitle>
          <div className="flex gap-1">
            <Badge variant={status?.llm_configured ? "success" : "secondary"}>LLM</Badge>
            <Badge variant={status?.n8n_configured ? "success" : "secondary"}>n8n</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 overflow-hidden">
        <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 p-3 text-sm">
          {messages.length === 0 ? (
            <p className="text-zinc-500">Ask about strategies, trades, risk, or system health.</p>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
                <span
                  className={`inline-block max-w-[85%] rounded-lg px-3 py-2 ${
                    m.role === "user" ? "bg-emerald-500/20 text-emerald-100" : "bg-zinc-800 text-zinc-200"
                  }`}
                >
                  {m.content}
                </span>
              </div>
            ))
          )}
          {chat.isPending && <p className="text-xs text-zinc-500">Thinking…</p>}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            placeholder="Ask anything…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <Button size="sm" onClick={send} disabled={chat.isPending}>
            Send
          </Button>
        </div>
        {recentActions.length > 0 && (
          <p className="text-xs text-zinc-600">Recent: {recentActions[0]?.action_type}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AssistantPage() {
  const { data: dash } = useQuery({
    queryKey: ["operationsDashboard"],
    queryFn: () => researchApi.operationsDashboard(),
    refetchInterval: 10000,
  });

  const tasks = (dash?.active_tasks || []) as { task_type?: string; status?: string }[];
  const reports = (dash?.recent_reports || []) as { title?: string; report_type?: string }[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Operations Assistant"
        description="Phase 9 — natural language control across research, trading, memory, and monitoring"
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AIChatPanel />
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Active Tasks</CardTitle></CardHeader>
            <CardContent className="text-sm text-zinc-400">
              {tasks.length === 0 ? "No active tasks" : tasks.map((t, i) => (
                <p key={i}>{t.task_type} — {t.status}</p>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Reports</CardTitle></CardHeader>
            <CardContent className="text-sm text-zinc-400">
              {reports.length === 0 ? "No reports yet" : reports.map((r, i) => (
                <p key={i}>{r.title || r.report_type}</p>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
