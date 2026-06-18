"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export function VirtualTable<T extends object>({
  rows,
  columns,
  rowHeight = 40,
  maxHeight = 480,
}: {
  rows: T[];
  columns: { key: string; header: string; width?: string; render?: (row: T) => React.ReactNode }[];
  rowHeight?: number;
  maxHeight?: number;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });
  const gridTemplateColumns = columns.map((c) => c.width || "minmax(8rem, 1fr)").join(" ");

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <div className="overflow-x-auto">
        <div className="min-w-[42rem]">
          <div className="grid border-b border-zinc-800 bg-zinc-900/80 text-[10px] font-semibold uppercase tracking-wide text-zinc-500"
            style={{ gridTemplateColumns }}
          >
            {columns.map((c) => (
              <div key={c.key} className="px-3 py-2">
                {c.header}
              </div>
            ))}
          </div>
          <div ref={parentRef} style={{ maxHeight, overflowY: "auto", overflowX: "hidden" }}>
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const row = rows[vi.index];
                return (
                  <div
                    key={vi.key}
                    className="grid border-b border-zinc-800/50 text-xs hover:bg-zinc-900/50"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: vi.size,
                      transform: `translateY(${vi.start}px)`,
                      gridTemplateColumns,
                    }}
                  >
                    {columns.map((c) => (
                      <div key={c.key} className="flex min-w-0 items-center px-3 py-2 tabular-nums">
                        {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            {rows.length === 0 && (
              <p className="p-6 text-center text-sm text-zinc-500">No rows</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
