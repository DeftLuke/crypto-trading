"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** TradingView Charting Library — loads when NEXT_PUBLIC_TV_LIBRARY is set */
function TvAdvancedWidget({ symbol, interval, height }: { symbol: string; interval: string; height: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      allow_symbol_change: true,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);
  }, [symbol, interval]);

  return (
    <div className="tradingview-widget-container overflow-hidden rounded-lg border border-zinc-800" style={{ height }}>
      <div ref={containerRef} className="tradingview-widget-container__widget h-full w-full" />
    </div>
  );
}

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
  const widgetId = useId().replace(/:/g, "");

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
          "paneProperties.horGridProperties.color": "#27272a",
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
        <CardContent className="p-2">
          <TvAdvancedWidget symbol={symbol} interval={interval} height={height} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 pt-2">
        <div id={`tv-${widgetId}`} ref={containerRef} style={{ height }} />
        {!ready && <p className="p-4 text-center text-xs text-zinc-500">Loading chart…</p>}
      </CardContent>
    </Card>
  );
}
