import { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { fetchChart } from '../services/api';

export default function TradingChart({ symbol, interval }) {
  const chartContainerRef = useRef(null);
  const rsiContainerRef = useRef(null);
  const chartRef = useRef(null);
  const rsiChartRef = useRef(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: true },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    });

    const ema9Series = chart.addLineSeries({ color: '#58a6ff', lineWidth: 1, title: 'EMA 9' });
    const ema21Series = chart.addLineSeries({ color: '#d29922', lineWidth: 1, title: 'EMA 21' });
    const ema100Series = chart.addLineSeries({ color: '#bc8cff', lineWidth: 2, title: 'EMA 100' });

    chartRef.current = { chart, candleSeries, ema9Series, ema21Series, ema100Series };

    const rsiChart = createChart(rsiContainerRef.current, {
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', visible: false },
      height: 120,
    });

    const rsiSeries = rsiChart.addLineSeries({ color: '#58a6ff', lineWidth: 1 });
    const rsiUpper = rsiChart.addLineSeries({ color: '#f8514966', lineWidth: 1, lineStyle: 2 });
    const rsiLower = rsiChart.addLineSeries({ color: '#3fb95066', lineWidth: 1, lineStyle: 2 });

    rsiChartRef.current = { chart: rsiChart, rsiSeries, rsiUpper, rsiLower };

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      rsiChart.applyOptions({ width: rsiContainerRef.current.clientWidth });
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      rsiChart.remove();
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;

    setLoading(true);
    fetchChart(symbol, interval).then((data) => {
      const { chart, candleSeries, ema9Series, ema21Series, ema100Series } = chartRef.current;
      const { rsiSeries, rsiUpper, rsiLower, chart: rsiChart } = rsiChartRef.current;

      candleSeries.setData(data.candles);

      if (data.indicators) {
        ema9Series.setData(data.indicators.ema9 || []);
        ema21Series.setData(data.indicators.ema21 || []);
        ema100Series.setData(data.indicators.ema100 || []);

        const rsiData = data.indicators.rsi || [];
        rsiSeries.setData(rsiData);

        if (rsiData.length > 0) {
          const upperLine = rsiData.map((r) => ({ time: r.time, value: 80 }));
          const lowerLine = rsiData.map((r) => ({ time: r.time, value: 25 }));
          rsiUpper.setData(upperLine);
          rsiLower.setData(lowerLine);
        }
      }

      // Draw Order Block zones as price lines
      if (data.smc?.orderBlocks) {
        for (const ob of data.smc.orderBlocks.filter((b) => !b.mitigated).slice(-5)) {
          candleSeries.createPriceLine({
            price: ob.type === 'demand' ? ob.low : ob.high,
            color: ob.type === 'demand' ? '#3fb95044' : '#f8514944',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: ob.type === 'demand' ? 'OB Demand' : 'OB Supply',
          });
        }
      }

      chart.timeScale().fitContent();
      rsiChart.timeScale().fitContent();
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [symbol, interval]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {loading && (
        <div style={{ padding: 8, fontSize: 12, color: '#8b949e' }}>Loading chart...</div>
      )}
      <div ref={chartContainerRef} className="chart-container" />
      <div ref={rsiContainerRef} className="rsi-container" />
    </div>
  );
}
