"use client";

import { useScannerStatus } from "@/hooks/useQueries";

function fmtAgo(iso?: string | null) {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export function ScannerProgressCard() {
  const { data: scanner } = useScannerStatus();
  const scanning = Boolean(scanner?.scanning);
  const pct = scanner?.progress_pct ?? 0;
  const scanned = scanner?.pairs_scanned ?? 0;
  const total = scanner?.universe_size ?? 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-cyan-950/30 to-zinc-950 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Signal scanner</p>
          <h3 className="text-lg font-semibold text-zinc-100">{scanner?.engine_label || "SMC v2 (Python)"}</h3>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
            scanning
              ? "border border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
              : scanner?.isRunning
                ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border border-zinc-700 text-zinc-500"
          }`}
        >
          {scanning ? "Scanning" : scanner?.isRunning ? "Active" : "Off"}
        </span>
      </div>

      {scanning ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-zinc-300">
            <span>Analyzing market-data cohort</span>
            <strong>{pct}%</strong>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-zinc-500">
            {scanned}/{total || "—"} pairs
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
            <p className="text-[10px] uppercase text-zinc-500">Last scan</p>
            <p className="font-semibold text-zinc-200">{fmtAgo(scanner?.lastScanAt)}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
            <p className="text-[10px] uppercase text-zinc-500">Pairs</p>
            <p className="font-semibold text-zinc-200">
              {scanned}
              {total ? ` / ${total}` : ""}
            </p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
            <p className="text-[10px] uppercase text-zinc-500">Signals</p>
            <p className="font-semibold text-zinc-200">{scanner?.signals_found ?? 0}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
            <p className="text-[10px] uppercase text-zinc-500">Next</p>
            <p className="font-semibold text-zinc-200">
              {scanner?.next_scan_in_sec != null ? `${scanner.next_scan_in_sec}s` : "—"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
