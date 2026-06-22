import type { InboxMessage } from "@/components/telegram/TelegramInbox";

export type PipelineStage =
  | "received"
  | "parsing"
  | "validating"
  | "ready"
  | "executing"
  | "rejected"
  | "stale"
  | "approved"
  | "executed"
  | "blocked"
  | "skipped"
  | "retry";

function validationFetchFailed(result: Record<string, unknown>) {
  if (result.ok === false) return true;
  if (result.status === 500) return true;
  const err = result.error;
  if (typeof err === "string" && err.includes("fetch")) return true;
  if (err && typeof err === "object" && "error" in err) {
    const nested = (err as { error?: string }).error;
    if (nested === "fetch failed" || nested?.includes?.("fetch")) return true;
  }
  return false;
}

export function getPipelineStage(message: InboxMessage): { stage: PipelineStage; label: string; detail?: string } {
  const result = message.api_result || {};
  const explicit = result.pipeline_stage as string | undefined;

  if (message.symbol_blocked) return { stage: "blocked", label: "Pair blocked", detail: message.symbol_block_reason || undefined };

  if (result.executed) {
    return {
      stage: "executed",
      label: result.levels_adapted ? "Opened (adapted)" : "Opened",
      detail: result.adapt_mark_price ? `Mark ${result.adapt_mark_price}` : undefined,
    };
  }

  if (explicit === "executing") {
    return {
      stage: "executing",
      label: result.auto_executed ? "Auto-trading…" : "Executing…",
    };
  }

  if (result.approved && !result.executed) {
    return { stage: "approved", label: "Approved" };
  }

  const execErr = result.last_error || result.execution?.error;
  if (execErr && !result.executed) {
    return { stage: "rejected", label: "Failed", detail: String(execErr) };
  }

  if (explicit === "stale" || result.auto_skip_reason === "signal_too_old") {
    return { stage: "stale", label: "Stale — manual only", detail: result.last_error as string | undefined };
  }

  if (message.parse_status === "skipped") return { stage: "skipped", label: "Not a signal" };

  if (explicit === "validated" || result.ready_to_approve || result.passed) {
    const live = result.live ? "Live" : "Scraped";
    return { stage: "ready", label: "Validated", detail: `${live} — awaiting trade` };
  }

  if (result.stale) return { stage: "stale", label: "Stale (>15m)" };

  if (validationFetchFailed(result)) {
    return { stage: "retry", label: "Validation pending" };
  }

  if (message.parse_status === "parsed" && result.passed === false) {
    return { stage: "rejected", label: "Validation failed", detail: result.reason as string | undefined };
  }

  if (explicit === "rejected") return { stage: "rejected", label: "Rejected", detail: result.reason as string | undefined };

  if (message.parse_status === "parsing" || explicit === "parsing") {
    return { stage: "parsing", label: "Parsing…" };
  }

  if (message.parse_status === "parsed") return { stage: "validating", label: "Validating…" };

  return { stage: "received", label: "Received" };
}

export const PIPELINE_STEPS: PipelineStage[] = [
  "received",
  "parsing",
  "validating",
  "ready",
  "executing",
  "executed",
];

export function pipelineProgress(stage: PipelineStage): number {
  const order: PipelineStage[] = ["received", "parsing", "validating", "ready", "executing", "executed"];
  const failed = ["rejected", "stale", "blocked", "skipped"];
  if (failed.includes(stage)) return -1;
  const idx = order.indexOf(stage);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / order.length) * 100);
}

export const stageBadgeVariant: Record<PipelineStage, "default" | "secondary" | "success" | "danger" | "warning" | "info"> = {
  received: "secondary",
  parsing: "secondary",
  validating: "info",
  ready: "success",
  executing: "info",
  rejected: "danger",
  stale: "warning",
  approved: "info",
  executed: "success",
  blocked: "warning",
  skipped: "secondary",
  retry: "warning",
};
