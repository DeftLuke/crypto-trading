"use client";

import { useSettingsStore } from "@/store/settingsStore";
import { Button } from "@/components/ui/button";

const SESSIONS = ["", "Asian", "London", "New York"];
const DIRECTIONS = ["", "LONG", "SHORT"];

export function GlobalFilters({ showStrategy = true }: { showStrategy?: boolean }) {
  const filters = useSettingsStore((s) => s.filters);
  const setFilter = useSettingsStore((s) => s.setFilter);
  const resetFilters = useSettingsStore((s) => s.resetFilters);

  return (
    <div className="grid grid-cols-2 items-end gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 sm:flex sm:flex-wrap">
      <FilterField label="From">
        <input
          type="date"
          value={filters.dateFrom || ""}
          onChange={(e) => setFilter("dateFrom", e.target.value || undefined)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs sm:w-auto"
        />
      </FilterField>
      <FilterField label="To">
        <input
          type="date"
          value={filters.dateTo || ""}
          onChange={(e) => setFilter("dateTo", e.target.value || undefined)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs sm:w-auto"
        />
      </FilterField>
      <FilterField label="Symbol">
        <input
          placeholder="BTCUSDT"
          value={filters.symbol || ""}
          onChange={(e) => setFilter("symbol", e.target.value || undefined)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs uppercase sm:w-28"
        />
      </FilterField>
      {showStrategy && (
        <FilterField label="Strategy">
          <input
            placeholder="SMC v2"
            value={filters.strategy || ""}
            onChange={(e) => setFilter("strategy", e.target.value || undefined)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs sm:w-28"
          />
        </FilterField>
      )}
      <FilterField label="Session">
        <select
          value={filters.session || ""}
          onChange={(e) => setFilter("session", e.target.value || undefined)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs sm:w-auto"
        >
          {SESSIONS.map((s) => (
            <option key={s || "all"} value={s}>
              {s || "All"}
            </option>
          ))}
        </select>
      </FilterField>
      <FilterField label="Direction">
        <select
          value={filters.direction || ""}
          onChange={(e) => setFilter("direction", e.target.value || undefined)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs sm:w-auto"
        >
          {DIRECTIONS.map((d) => (
            <option key={d || "all"} value={d}>
              {d || "All"}
            </option>
          ))}
        </select>
      </FilterField>
      <FilterField label="Result">
        <select
          value={filters.result || ""}
          onChange={(e) => setFilter("result", e.target.value || undefined)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs sm:w-auto"
        >
          <option value="">All</option>
          <option value="win">Win</option>
          <option value="loss">Loss</option>
        </select>
      </FilterField>
      <Button className="col-span-2 sm:col-span-1" variant="ghost" size="sm" onClick={resetFilters}>
        Reset
      </Button>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-0 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
