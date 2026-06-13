import { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { fetchChart } from '../services/api';
import { subscribeKline } from '../services/binanceWs';
import MTFBiasPanel from './MTFBiasPanel';
import MarketStructurePanel from './MarketStructurePanel';

export default function TradingChart({ symbol, interval }) {
  const chartContainerRef = useRef(null);
  const rsiContainerRef = useRef(null);
  const chartRef = useRef(null);
  const rsiChartRef = useRef(null);
  const overlayRef = useRef(null);
  const priceLinesRef = useRef([]);
  const [loading, setLoading] = useState(true);
  const [mtf, setMtf] = useState(null);
  const [smc, setSmc] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const [smcLabels, setSmcLabels] = useState([]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 420,
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
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
      height: 100,
    });

    const rsiSeries = rsiChart.addLineSeries({ color: '#58a6ff', lineWidth: 1 });
    rsiChartRef.current = { chart: rsiChart, rsiSeries };

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        rsiChart.applyOptions({ width: rsiContainerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      priceLinesRef.current = [];
      chart.remove();
      rsiChart.remove();
      chartRef.current = null;
    };
  }, []);

  function clearOverlays() {
    const { candleSeries } = chartRef.current || {};
    for (const line of priceLinesRef.current) {
      try { candleSeries?.removePriceLine(line); } catch { /* gone */ }
    }
    priceLinesRef.current = [];
  }

  function applySMCOverlays(data) {
    if (!chartRef.current || !data.smc) return;
    clearOverlays();
    const { candleSeries } = chartRef.current;
    const labels = [];

    for (const ob of (data.smc.orderBlocks || []).filter((b) => !b.mitigated).slice(-4)) {
      const color = ob.type === 'demand' ? '#3fb95055' : '#f8514955';
      const lineColor = ob.type === 'demand' ? '#3fb950' : '#f85149';
      priceLinesRef.current.push(candleSeries.createPriceLine({
        price: ob.high,
        color: lineColor,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: ob.type === 'demand' ? 'OB Demand' : 'OB Supply',
      }));
      priceLinesRef.current.push(candleSeries.createPriceLine({
        price: ob.low,
        color,
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: false,
      }));
    }

    for (const rz of data.smc.retestZones || []) {
      priceLinesRef.current.push(candleSeries.createPriceLine({
        price: (rz.high + rz.low) / 2,
        color: '#d29922',
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: 'OB Retest',
      }));
      labels.push(rz.label);
    }

    for (const idm of data.smc.idmZones || []) {
      priceLinesRef.current.push(candleSeries.createPriceLine({
        price: idm.price,
        color: '#bc8cff',
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: 'IDM',
      }));
    }

    for (const fvg of (data.smc.fvgZones || []).slice(-3)) {
      priceLinesRef.current.push(candleSeries.createPriceLine({
        price: (fvg.high + fvg.low) / 2,
        color: '#58a6ff',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'FVG',
      }));
      labels.push('FVG');
    }

    if (data.smc.lastBOS) {
      labels.push(`BOS ${data.smc.lastBOS.direction}`);
    }
    if (data.smc.lastCHoCH) {
      labels.push(`CHoCH ${data.smc.lastCHoCH.direction}`);
    }
    for (const sw of (data.smc.sweeps || []).slice(-2)) {
      labels.push(sw.type.includes('bull') ? 'Liq Sweep ↑' : 'Liq Sweep ↓');
    }

    setSmcLabels(labels);
    setSmc(data.smc);
  }

  useEffect(() => {
    if (!chartRef.current) return;
    setLoading(true);
    clearOverlays();

    fetchChart(symbol, interval).then((data) => {
      const { chart, candleSeries, ema9Series, ema21Series, ema100Series } = chartRef.current;
      const { rsiSeries, chart: rsiChart } = rsiChartRef.current;

      candleSeries.setData(data.candles);
      setLivePrice(data.candles?.[data.candles.length - 1]?.close);

      if (data.indicators) {
        ema9Series.setData(data.indicators.ema9 || []);
        ema21Series.setData(data.indicators.ema21 || []);
        ema100Series.setData(data.indicators.ema100 || []);
        rsiSeries.setData(data.indicators.rsi || []);
      }

      applySMCOverlays(data);
      setMtf(data.mtf);
      if (data.cgPrice?.price) setLivePrice(data.cgPrice.price);
      chart.timeScale().fitContent();
      rsiChart.timeScale().fitContent();
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [symbol, interval]);

  // Real-time kline from Binance (sub-second updates)
  useEffect(() => {
    if (!chartRef.current) return;

    const unsub = subscribeKline(symbol, interval, (candle) => {
      const { candleSeries } = chartRef.current;
      candleSeries.update(candle);
      setLivePrice(candle.close);
    });

    return unsub;
  }, [symbol, interval]);

  // Refresh MTF bias every 60s
  useEffect(() => {
    const id = setInterval(() => {
      fetchChart(symbol, interval).then((d) => setMtf(d.mtf)).catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, [symbol, interval]);

  return (
    <div className="chart-wrap">
      <MTFBiasPanel mtf={mtf} symbol={symbol} />
      <MarketStructurePanel smc={smc} livePrice={livePrice} />
      {livePrice && (
        <div className="live-price-tag">
          ${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
          <span className="live-dot" title="Live from Binance" />
        </div>
      )}
      {smcLabels.length > 0 && (
        <div className="smc-legend">
          {smcLabels.map((l) => (
            <span key={l} className="smc-chip">{l}</span>
          ))}
        </div>
      )}
      {loading && <div className="chart-loading">Loading…</div>}
      <div ref={chartContainerRef} className="chart-container" />
      <div ref={rsiContainerRef} className="rsi-container" />
    </div>
  );
}
