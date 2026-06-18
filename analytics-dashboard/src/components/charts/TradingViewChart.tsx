"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** TradingView Charting Library — loads when NEXT_PUBLIC_TV_LIBRARY is set */
export function TradingViewChart({
  symbol = "BINANCE:BTCUSDT",
  interval = "15",
  height = 420,
}: {
  symbol?: string;
  interval?: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const libUrl = process.env.NEXT_PUBLIC_TV_LIBRARY;

  useEffect(() => {
    if (!libUrl || !containerRef.current) return;

    const script = document.createElement("script");
    script.src = libUrl;
    script.async = true;
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tv = (window as any).TradingView;
      if (!tv?.widget || !containerRef.current) return;
      new tv.widget({
        container_id: containerRef.current.id,
        symbol,
        interval,
        theme: "dark",
        locale: "en",
        toolbar_bg: "#09090b",
        studies_overrides: {},
        overrides: {
          "paneProperties.background": "#09090b",
          "paneProperties.vertGridProperties.color": "#27272a",
          "paneProperties.horzGridProperties.color": "#27272a",
        },
      });
      setReady(true);
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [symbol, interval, libUrl]);

  if (!libUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Chart — {symbol}</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 text-sm text-zinc-500"
            style={{ height }}
          >
            Set NEXT_PUBLIC_TV_LIBRARY to enable TradingView overlays (signals, OB, FVG, BOS).
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 pt-2">
        <div id={`tv-${symbol.replace(/[^a-zA-Z0-9]/g, "")}`} ref={containerRef} style={{ height }} />
        {!ready && <p className="p-4 text-center text-xs text-zinc-500">Loading chart…</p>}
      </CardContent>
    </Card>
  );
}
