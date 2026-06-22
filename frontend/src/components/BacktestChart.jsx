import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

export default function BacktestChart({ candles, trades, symbol, loading }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 380,
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    });

    chartRef.current = { chart, series };

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ref = chartRef.current;
    if (!ref) return;

    if (!candles?.length) {
      ref.series.setData([]);
      ref.series.setMarkers([]);
      return;
    }

    ref.series.setData(
      candles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    const markers = [];
    for (const t of trades || []) {
      if (!t.entryTime) continue;
      const isLong = t.direction === 'BUY';
      markers.push({
        time: t.entryTime,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: isLong ? '#3fb950' : '#f85149',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: isLong ? 'L' : 'S',
      });
      if (t.exitTime && !t.open) {
        markers.push({
          time: t.exitTime,
          position: t.outcome === 'win' ? 'aboveBar' : 'belowBar',
          color: t.outcome === 'win' ? '#58a6ff' : '#d29922',
          shape: 'circle',
          text: t.outcome === 'win' ? 'TP' : 'SL',
        });
      }
    }

    ref.series.setMarkers(markers.sort((a, b) => a.time - b.time));
    ref.chart.timeScale().fitContent();
  }, [candles, trades]);

  return (
    <div className="backtest-chart-wrap">
      <div className="backtest-chart-header">
        <span>{symbol || '—'}</span>
        {loading && <span className="backtest-loading-badge">Running backtest…</span>}
      </div>
      {!loading && !candles?.length && (
        <div className="backtest-chart-empty muted">
          Chart loads after you run a backtest — uses cached OHLCV, no live Binance polling.
        </div>
      )}
      <div ref={containerRef} className="backtest-chart" />
    </div>
  );
}
