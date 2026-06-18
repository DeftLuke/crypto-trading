import { useCallback, useEffect, useRef, useState } from 'react';

function storageKey(symbol, interval) {
  return `chart-drawings:${symbol}:${interval}`;
}

export function loadDrawings(symbol, interval) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(symbol, interval)) || '[]');
  } catch {
    return [];
  }
}

function saveDrawings(symbol, interval, drawings) {
  localStorage.setItem(storageKey(symbol, interval), JSON.stringify(drawings));
}

export function applyUserDrawings(chart, candleSeries, drawings, refs) {
  for (const line of refs.priceLines) {
    try { candleSeries.removePriceLine(line); } catch { /* */ }
  }
  refs.priceLines = [];

  for (const series of refs.lineSeries) {
    try { chart.removeSeries(series); } catch { /* */ }
  }
  refs.lineSeries = [];

  for (const d of drawings) {
    if (d.type === 'hline') {
      refs.priceLines.push(candleSeries.createPriceLine({
        price: d.price,
        color: '#2962ff',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'H-Line',
      }));
    }

    if (d.type === 'trend' && d.p1 && d.p2) {
      const series = chart.addLineSeries({
        color: '#2962ff',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      const pts = [
        { time: d.p1.time, value: d.p1.price },
        { time: d.p2.time, value: d.p2.price },
      ].sort((a, b) => a.time - b.time);
      series.setData(pts);
      refs.lineSeries.push(series);
    }

    if ((d.type === 'long' || d.type === 'short') && d.entry != null && d.sl != null) {
      const isLong = d.type === 'long';
      refs.priceLines.push(candleSeries.createPriceLine({
        price: d.entry,
        color: isLong ? '#26a69a' : '#ef5350',
        lineWidth: 2,
        axisLabelVisible: true,
        title: 'ENTRY',
      }));
      refs.priceLines.push(candleSeries.createPriceLine({
        price: d.sl,
        color: '#ef5350',
        lineWidth: 2,
        axisLabelVisible: true,
        title: 'SL',
      }));
      if (d.tp != null) {
        refs.priceLines.push(candleSeries.createPriceLine({
          price: d.tp,
          color: '#26a69a',
          lineWidth: 2,
          axisLabelVisible: true,
          title: 'TP',
        }));
      }
    }
  }
}

export function useChartDrawings(symbol, interval, chartRef, activeTool) {
  const [drawings, setDrawings] = useState(() => loadDrawings(symbol, interval));
  const [drawHint, setDrawHint] = useState('');
  const userDrawRefs = useRef({ priceLines: [], lineSeries: [] });
  const pendingRef = useRef(null);
  const positionRef = useRef(null);

  useEffect(() => {
    setDrawings(loadDrawings(symbol, interval));
    pendingRef.current = null;
    positionRef.current = null;
    setDrawHint('');
  }, [symbol, interval]);

  useEffect(() => {
    if (activeTool === 'cross' || activeTool === 'cursor') setDrawHint('');
    else if (activeTool === 'hline') setDrawHint('Click chart to add horizontal line');
    else if (activeTool === 'trend') setDrawHint('Click two points for trend line');
    else if (activeTool === 'long') setDrawHint('Click entry → SL → TP for long position');
    else if (activeTool === 'short') setDrawHint('Click entry → SL → TP for short position');
  }, [activeTool]);

  useEffect(() => {
    saveDrawings(symbol, interval, drawings);
    if (chartRef.current?.chart && chartRef.current?.candles) {
      applyUserDrawings(
        chartRef.current.chart,
        chartRef.current.candles,
        drawings,
        userDrawRefs.current,
      );
    }
  }, [drawings, symbol, interval, chartRef]);

  const clearDrawings = useCallback(() => {
    setDrawings([]);
    pendingRef.current = null;
    positionRef.current = null;
  }, []);

  const handleChartClick = useCallback((param) => {
    if (!param.point || !chartRef.current?.candles) return;
    const { candles } = chartRef.current;
    const price = candles.coordinateToPrice(param.point.y);
    const time = param.time;
    if (price == null || time == null) return;

    if (activeTool === 'hline') {
      setDrawings((d) => [...d, { type: 'hline', price, id: Date.now() }]);
      return;
    }

    if (activeTool === 'trend') {
      if (!pendingRef.current) {
        pendingRef.current = { time, price };
        setDrawHint('Click second point to finish trend line');
      } else {
        setDrawings((d) => [...d, {
          type: 'trend',
          p1: pendingRef.current,
          p2: { time, price },
          id: Date.now(),
        }]);
        pendingRef.current = null;
        setDrawHint('Click two points for trend line');
      }
      return;
    }

    if (activeTool === 'long' || activeTool === 'short') {
      if (!positionRef.current) {
        positionRef.current = { step: 1, type: activeTool, entry: price, time };
        setDrawHint('Click stop loss price');
      } else if (positionRef.current.step === 1) {
        positionRef.current.sl = price;
        positionRef.current.step = 2;
        setDrawHint('Click take profit price');
      } else if (positionRef.current.step === 2) {
        const p = positionRef.current;
        setDrawings((d) => [...d, {
          type: p.type,
          entry: p.entry,
          sl: p.sl,
          tp: price,
          time: p.time,
          id: Date.now(),
        }]);
        positionRef.current = null;
        setDrawHint(`Click entry → SL → TP for ${activeTool} position`);
      }
    }
  }, [activeTool, chartRef]);

  return {
    drawings,
    clearDrawings,
    handleChartClick,
    drawHint,
    userDrawRefs,
    applyUserDrawings: () => {
      if (chartRef.current?.chart && chartRef.current?.candles) {
        applyUserDrawings(
          chartRef.current.chart,
          chartRef.current.candles,
          drawings,
          userDrawRefs.current,
        );
      }
    },
  };
}
