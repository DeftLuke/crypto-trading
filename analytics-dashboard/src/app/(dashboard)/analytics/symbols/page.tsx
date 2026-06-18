"use client";

import { Suspense } from "react";
import SymbolAnalyticsContent from "./SymbolAnalyticsContent";

export default function SymbolAnalyticsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-zinc-500">Loading…</p>}>
      <SymbolAnalyticsContent />
    </Suspense>
  );
}
