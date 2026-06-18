import type { InboxMessage } from "@/components/telegram/TelegramInbox";



export type PipelineStage =

  | "received"

  | "parsing"

  | "validating"

  | "ready"

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



export function getPipelineStage(message: InboxMessage): { stage: PipelineStage; label: string } {

  const result = message.api_result || {};

  const explicit = result.pipeline_stage as string | undefined;



  if (message.symbol_blocked) return { stage: "blocked", label: "Pair blocked" };

  if (result.executed) return { stage: "executed", label: "Traded" };

  if (result.approved) return { stage: "approved", label: "Approved" };

  const execErr = (result as { last_error?: string; execution?: { error?: string } }).last_error
    || (result as { execution?: { error?: string } }).execution?.error;
  if (execErr) return { stage: "rejected", label: "Execution failed" };

  if (message.parse_status === "skipped") return { stage: "skipped", label: "Not a signal" };

  if (explicit === "validated" || result.ready_to_approve || result.passed) {

    return { stage: "ready", label: "Ready to approve" };

  }

  if (result.stale) return { stage: "stale", label: "Stale (>15m)" };

  if (validationFetchFailed(result)) {

    return { stage: "retry", label: "Validation pending" };

  }

  if (message.parse_status === "parsed" && result.passed === false) {

    return { stage: "rejected", label: "Validation failed" };

  }

  if (explicit === "rejected") return { stage: "rejected", label: "Rejected" };

  if (message.parse_status === "parsed") return { stage: "validating", label: "Validating…" };

  return { stage: "received", label: "Received" };

}



export const stageBadgeVariant: Record<PipelineStage, "default" | "secondary" | "success" | "danger" | "warning" | "info"> = {

  received: "secondary",

  parsing: "secondary",

  validating: "info",

  ready: "success",

  rejected: "danger",

  stale: "warning",

  approved: "info",

  executed: "success",

  blocked: "warning",

  skipped: "secondary",

  retry: "warning",

};


