import { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { fetchChart, fetchTvChart } from '../services/api';
import { subscribeKline } from '../services/binanceWs';

async function loadCandles(tvSymbol, binanceSymbol, interval) {
  try {
    const data = await fetchTvChart(tvSymbol, interval, 300);
    if (data.candles?.length) return data;
  } catch {
    /* try Binance REST fallback */
  }

  if (binanceSymbol) {
    const data = await fetchChart(binanceSymbol, interval);
    if (data.candles?.length) {
      return {
        candles: data.candles,
        info: { description: binanceSymbol.replace('USDT', '/USDT'), exchange: 'BINANCE' },
        source: 'binance',
        binanceSymbol,
      };
    }
  }

  throw new Error(`Could not load chart for ${tvSymbol}`);
}

export default function CleanMarketChart({ tvSymbol, binanceSymbol, interval }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const readyRef = useRef(false);
  const requestRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const [dataSource, setDataSource] = useState('');

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 480,
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#161b22' }, horzLines: { color: '#161b22' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#30363d' },
      timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
    });

    const candles = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    const volume = chart.addHistogramSeries({
      color: '#58a6ff55',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = { chart, candles, volume };
    readyRef.current = false;

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
      readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !tvSymbol) return;

    const reqId = ++requestRef.current;
    readyRef.current = false;
    setLoading(true);
    setError('');
    setInfo(null);

    const { chart, candles, volume } = chartRef.current;
    candles.setData([]);
    volume.setData([]);

    loadCandles(tvSymbol, binanceSymbol, interval).then((data) => {
      if (reqId !== requestRef.current || !chartRef.current) return;

      const list = (data.candles || []).filter(
        (c) => c.time && Number.isFinite(c.open) && Number.isFinite(c.close)
      );

      if (!list.length) {
        setError('No candle data returned');
        setLoading(false);
        return;
      }

      candles.setData(list);
      volume.setData(list.map((c) => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? '#26a69a44' : '#ef535044',
      })));

      setInfo(data.info);
      setDataSource(data.source || 'tradingview');
      setLivePrice(list[list.length - 1].close);
      chart.timeScale().fitContent();
      readyRef.current = true;
      setLoading(false);
    }).catch((e) => {
      if (reqId !== requestRef.current) return;
      setError(e.message);
      setLoading(false);
    });
  }, [tvSymbol, binanceSymbol, interval]);

  useEffect(() => {
    if (!binanceSymbol || !chartRef.current) return;

    const unsub = subscribeKline(binanceSymbol, interval, (candle) => {
      if (!readyRef.current || !chartRef.current) return;
      const { candles, volume } = chartRef.current;
      try {
        candles.update(candle);
        volume.update({
          time: candle.time,
          value: candle.volume || 0,
          color: candle.close >= candle.open ? '#26a69a44' : '#ef535044',
        });
        setLivePrice(candle.close);
      } catch {
        /* ignore out-of-order tick until next full reload */
      }
    });

    return unsub;
  }, [binanceSymbol, interval, tvSymbol]);

  return (
    <div className="clean-chart-wrap">
      <div className="clean-chart-header">
        <div>
          <strong>{info?.description || tvSymbol}</strong>
          <span className="muted small" style={{ marginLeft: 8 }}>
            {info?.exchange || 'Crypto'} · {dataSource === 'binance' ? 'Binance' : 'TradingView'}
          </span>
        </div>
        {livePrice != null && (
          <div className="live-price-tag clean">
            ${livePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
            {binanceSymbol && readyRef.current && <span className="live-dot" title="Live" />}
          </div>
        )}
      </div>
      {error && <div className="tester-error">{error}</div>}
      {loading && <div className="chart-loading">Loading chart…</div>}
      <div ref={containerRef} className="chart-container clean-chart" />
    </div>
  );
}
