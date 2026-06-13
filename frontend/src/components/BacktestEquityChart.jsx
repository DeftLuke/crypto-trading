import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

export default function BacktestEquityChart({ equityCurve, initialCapital }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 160,
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
    });

    const series = chart.addAreaSeries({
      lineColor: '#58a6ff',
      topColor: 'rgba(88, 166, 255, 0.35)',
      bottomColor: 'rgba(88, 166, 255, 0.02)',
      lineWidth: 2,
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
    };
  }, []);

  useEffect(() => {
    const ref = chartRef.current;
    if (!ref || !equityCurve?.length) return;

    ref.series.setData(
      equityCurve.map((p) => ({ time: p.time, value: p.equity }))
    );
    ref.chart.timeScale().fitContent();
  }, [equityCurve]);

  const final = equityCurve?.length ? equityCurve[equityCurve.length - 1].equity : initialCapital;
  const change = initialCapital ? ((final - initialCapital) / initialCapital) * 100 : 0;

  return (
    <div className="equity-chart-wrap">
      <div className="equity-chart-header">
        <span>Equity Curve</span>
        <span className={change >= 0 ? 'green-text' : 'red-text'}>
          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
        </span>
      </div>
      <div ref={containerRef} className="equity-chart" />
    </div>
  );
}
