import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import {
  fetchChart, fetchTvChart, fetchStrategies, fetchStrategyChartSetups,
} from '../services/api';
import { subscribeKline } from '../services/binanceWs';
import { useChartDrawings } from '../hooks/useChartDrawings';
import IndicatorModal from './IndicatorModal';
import TradingViewWidget from './TradingViewWidget';
import TradingViewAccountChart from './TradingViewAccountChart';
import { loadTvConfig } from '../utils/tvConfig';

const TIMEFRAMES = ['1h', '30m', '15m', '5m', '3m'];

const DRAW_TOOLS = [
  { id: 'cross', icon: '✛', title: 'Crosshair' },
  { id: 'cursor', icon: '↖', title: 'Cursor' },
  { id: 'hline', icon: '─', title: 'Horizontal line' },
  { id: 'trend', icon: '╱', title: 'Trend line' },
  { id: 'long', icon: '▲', title: 'Long position' },
  { id: 'short', icon: '▼', title: 'Short position' },
  { id: 'erase', icon: '🗑', title: 'Clear drawings' },
];

const DEFAULT_IND = {
  smc: true, setups: true, ema9: false, ema21: true, ema100: true, rsi: false, volume: true,
};

async function loadCandles(tvSymbol, binanceSymbol, interval) {
  try {
    const data = await fetchTvChart(tvSymbol, interval, 300);
    if (data.candles?.length) return data;
  } catch { /* fallback */ }
  const data = await fetchChart(binanceSymbol, interval);
  return { candles: data.candles, info: {}, source: 'binance', smc: data.smc, indicators: data.indicators };
}

function applySmcLines(candleSeries, smc, priceLinesRef, show) {
  for (const line of priceLinesRef.current) {
    try { candleSeries.removePriceLine(line); } catch { /* */ }
  }
  priceLinesRef.current = [];
  if (!show || !smc) return;

  for (const ob of (smc.orderBlocks || []).filter((b) => !b.mitigated).slice(-6)) {
    const isDemand = ob.type === 'demand';
    priceLinesRef.current.push(candleSeries.createPriceLine({
      price: ob.high, color: isDemand ? '#26a69a' : '#ef5350',
      lineWidth: 1, lineStyle: 2, axisLabelVisible: true,
      title: isDemand ? 'EXT OB' : 'SUP OB',
    }));
    priceLinesRef.current.push(candleSeries.createPriceLine({
      price: ob.low, color: isDemand ? '#26a69a88' : '#ef535088',
      lineWidth: 1, lineStyle: 0, axisLabelVisible: false,
    }));
  }
  for (const fvg of (smc.fvgZones || []).slice(-4)) {
    priceLinesRef.current.push(candleSeries.createPriceLine({
      price: (fvg.high + fvg.low) / 2, color: '#f0b429',
      lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'FVG',
    }));
  }
  for (const idm of (smc.idmZones || []).slice(-3)) {
    priceLinesRef.current.push(candleSeries.createPriceLine({
      price: idm.price, color: '#bc8cff',
      lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: 'IDM',
    }));
  }
}

function applySetupMarkers(candleSeries, setups, show) {
  if (!show || !setups?.length) { candleSeries.setMarkers([]); return; }
  candleSeries.setMarkers(
    setups.filter((s) => s.entryTime).map((s) => {
      const isLong = s.direction === 'BUY' || s.direction === 'long';
      const won = s.outcome === 'win';
      const lost = s.outcome === 'loss';
      return {
        time: s.entryTime,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: won ? '#26a69a' : lost ? '#ef5350' : '#f0b429',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: isLong ? 'LONG' : 'SHORT',
      };
    }).sort((a, b) => a.time - b.time),
  );
}

function applySetupLines(candleSeries, setups, priceLinesRef, show) {
  for (const line of priceLinesRef.current) {
    try { candleSeries.removePriceLine(line); } catch { /* */ }
  }
  priceLinesRef.current = [];
  if (!show) return;
  const targets = setups.filter((s) => s.open).length ? setups.filter((s) => s.open) : setups.slice(-2);
  for (const s of targets) {
    const isLong = s.direction === 'BUY' || s.direction === 'long';
    if (!s.entry || !s.stopLoss) continue;
    priceLinesRef.current.push(candleSeries.createPriceLine({
      price: s.entry, color: isLong ? '#26a69a' : '#ef5350',
      lineWidth: 2, axisLabelVisible: true, title: s.open ? 'ENTRY' : 'Entry',
    }));
    priceLinesRef.current.push(candleSeries.createPriceLine({
      price: s.stopLoss, color: '#ef5350', lineWidth: 2, axisLabelVisible: true, title: 'SL',
    }));
    const tp = s.tp2 || s.tp1;
    if (tp) {
      priceLinesRef.current.push(candleSeries.createPriceLine({
        price: tp, color: '#26a69a', lineWidth: 2, axisLabelVisible: true, title: 'TP',
      }));
    }
  }
}

function useChartHeight(hasRsi) {
  const [height, setHeight] = useState(480);
  useEffect(() => {
    const update = () => {
      const vh = window.innerHeight;
      setHeight(Math.max(340, vh - (hasRsi ? 200 : 168)));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [hasRsi]);
  return height;
}

function modeFromConfig() {
  const c = loadTvConfig();
  if (c.chartMode === 'chart-pro') return 'pro';
  if (c.chartMode === 'tv-widget') return 'widget';
  return 'account';
}

export default function ProTradingChart({
  tvSymbol, binanceSymbol, interval, onIntervalChange,
  balance, strategyId = 'smc-mtf', onStrategyChange, onOpenDock,
}) {
  const wrapRef = useRef(null);
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const smcLinesRef = useRef([]);
  const setupLinesRef = useRef([]);
  const readyRef = useRef(false);
  const requestRef = useRef(0);
  const indicatorDataRef = useRef(null);

  const [viewMode, setViewMode] = useState(modeFromConfig);
  const [strategies, setStrategies] = useState([]);
  const [indicators, setIndicators] = useState(DEFAULT_IND);
  const [indModalOpen, setIndModalOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [setups, setSetups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [livePrice, setLivePrice] = useState(null);
  const [smcData, setSmcData] = useState(null);
  const [activeTool, setActiveTool] = useState('cross');

  const chartHeight = useChartHeight(indicators.rsi);
  const { clearDrawings, handleChartClick, drawHint, applyUserDrawings } = useChartDrawings(
    binanceSymbol, interval, chartRef, activeTool,
  );
  const clickRef = useRef(handleChartClick);
  clickRef.current = handleChartClick;

  const toggleIndicator = (id) => setIndicators((prev) => ({ ...prev, [id]: !prev[id] }));
  const activeIndCount = Object.values(indicators).filter(Boolean).length;

  useEffect(() => { fetchStrategies().then(setStrategies).catch(() => {}); }, []);

  useEffect(() => {
    if (viewMode !== 'pro' || !containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: chartHeight,
      layout: { background: { color: '#131722' }, textColor: '#787b86' },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      crosshair: { mode: activeTool === 'cross' ? 1 : 0 },
      rightPriceScale: { borderColor: '#2a2e39' },
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
    });

    const candles = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    const ema9 = chart.addLineSeries({ color: '#58a6ff', lineWidth: 1, title: 'EMA 9', visible: false });
    const ema21 = chart.addLineSeries({ color: '#f0b429', lineWidth: 1, title: 'EMA 21' });
    const ema100 = chart.addLineSeries({ color: '#ab47bc', lineWidth: 2, title: 'EMA 100' });
    const volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', visible: true });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    const rsi = chart.addLineSeries({
      color: '#ab47bc', lineWidth: 1, title: 'RSI', priceScaleId: 'rsi', visible: false,
    });
    chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.78, bottom: 0.02 }, borderVisible: false });

    chartRef.current = { chart, candles, ema9, ema21, ema100, volume, rsi };
    readyRef.current = false;

    chart.subscribeClick((param) => clickRef.current?.(param));

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth, height: chartHeight });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      smcLinesRef.current = [];
      setupLinesRef.current = [];
    };
  }, [viewMode, chartHeight]);

  useEffect(() => {
    if (!chartRef.current?.chart) return;
    chartRef.current.chart.applyOptions({ crosshair: { mode: activeTool === 'cross' ? 1 : 0 } });
  }, [activeTool]);

  const redrawOverlays = useCallback((smc, setupList) => {
    if (!chartRef.current) return;
    const { candles } = chartRef.current;
    applySmcLines(candles, smc, smcLinesRef, indicators.smc);
    applySetupLines(candles, setupList, setupLinesRef, indicators.setups);
    applySetupMarkers(candles, setupList, indicators.setups);
    applyUserDrawings();
  }, [indicators.smc, indicators.setups, applyUserDrawings]);

  const applyIndicatorVisibility = useCallback((ind) => {
    if (!chartRef.current) return;
    const { ema9, ema21, ema100, volume, rsi, chart } = chartRef.current;
    ema9.applyOptions({ visible: ind.ema9 });
    ema21.applyOptions({ visible: ind.ema21 });
    ema100.applyOptions({ visible: ind.ema100 });
    volume.applyOptions({ visible: ind.volume });
    rsi.applyOptions({ visible: ind.rsi });
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.05, bottom: ind.rsi ? 0.28 : ind.volume ? 0.12 : 0.05 },
    });
  }, []);

  useEffect(() => {
    if (viewMode !== 'pro' || !chartRef.current) return;
    const reqId = ++requestRef.current;
    readyRef.current = false;
    setLoading(true);
    setError('');

    const { chart, candles, ema9, ema21, ema100, volume, rsi } = chartRef.current;
    candles.setData([]);
    ema9.setData([]); ema21.setData([]); ema100.setData([]); volume.setData([]); rsi.setData([]);
    smcLinesRef.current = [];
    setupLinesRef.current = [];

    Promise.all([
      loadCandles(tvSymbol, binanceSymbol, interval),
      fetchChart(binanceSymbol, interval).catch(() => null),
      indicators.setups
        ? fetchStrategyChartSetups(strategyId, binanceSymbol, interval).catch(() => ({ historical: [], current: null }))
        : Promise.resolve({ historical: [], current: null }),
    ]).then(([priceData, smcBundle, setupBundle]) => {
      if (reqId !== requestRef.current || !chartRef.current) return;

      const list = (priceData.candles || []).filter((c) => c.time && Number.isFinite(c.close));
      if (!list.length) { setError('No candle data'); setLoading(false); return; }

      candles.setData(list);
      volume.setData(list.map((c) => ({
        time: c.time, value: c.volume || 0,
        color: c.close >= c.open ? '#26a69a44' : '#ef535044',
      })));

      const ind = smcBundle?.indicators || priceData.indicators;
      indicatorDataRef.current = ind;
      if (ind) {
        ema9.setData(ind.ema9 || []);
        ema21.setData(ind.ema21 || []);
        ema100.setData(ind.ema100 || []);
        rsi.setData(ind.rsi || []);
      }

      const smc = smcBundle?.smc || priceData.smc;
      setSmcData(smc);
      setLivePrice(list[list.length - 1].close);

      const allSetups = [...(setupBundle.historical || []), ...(setupBundle.current ? [setupBundle.current] : [])];
      setSetups(allSetups);

      applyIndicatorVisibility(indicators);
      redrawOverlays(smc, allSetups);
      chart.timeScale().fitContent();
      readyRef.current = true;
      setLoading(false);
    }).catch((e) => {
      if (reqId !== requestRef.current) return;
      setError(e.message);
      setLoading(false);
    });
  }, [tvSymbol, binanceSymbol, interval, viewMode, strategyId, indicators.setups, redrawOverlays, applyIndicatorVisibility]);

  useEffect(() => {
    if (!chartRef.current || viewMode !== 'pro') return;
    applyIndicatorVisibility(indicators);
    redrawOverlays(smcData, setups);
  }, [indicators, smcData, setups, viewMode, applyIndicatorVisibility, redrawOverlays]);

  useEffect(() => {
    if (!binanceSymbol || !chartRef.current || viewMode !== 'pro') return;
    return subscribeKline(binanceSymbol, interval, (candle) => {
      if (!readyRef.current || !chartRef.current) return;
      const { candles, volume } = chartRef.current;
      try {
        candles.update(candle);
        volume.update({
          time: candle.time, value: candle.volume || 0,
          color: candle.close >= candle.open ? '#26a69a44' : '#ef535044',
        });
        setLivePrice(candle.close);
      } catch { /* */ }
    });
  }, [binanceSymbol, interval, viewMode]);

  const handleToolClick = (id) => {
    if (id === 'erase') { clearDrawings(); setActiveTool('cross'); return; }
    setActiveTool(id);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      wrapRef.current?.requestFullscreen?.();
      setFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setFullscreen(false);
    }
  };

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const strat = strategies.find((s) => s.id === strategyId);
  const stratList = strategies.length ? strategies : [{ id: 'smc-mtf', name: 'Smart Money Algo Pro (SMC MTF)' }];

  const handleStrategyChange = (id) => {
    const s = stratList.find((x) => x.id === id);
    onStrategyChange?.(id, s?.name);
  };

  return (
    <div ref={wrapRef} className={`pro-chart ${fullscreen ? 'fullscreen' : ''}`}>
      <IndicatorModal
        open={indModalOpen}
        onClose={() => setIndModalOpen(false)}
        active={indicators}
        onToggle={toggleIndicator}
      />

      <header className="tv-toolbar slim">
        <div className="tv-toolbar-row">
          <div className="chart-mode-tabs pill">
            <button type="button" className={`chart-mode-btn ${viewMode === 'account' ? 'active' : ''}`} onClick={() => setViewMode('account')}>
              My TV
            </button>
            <button type="button" className={`chart-mode-btn ${viewMode === 'pro' ? 'active' : ''}`} onClick={() => setViewMode('pro')}>
              SMC Engine
            </button>
            <button type="button" className={`chart-mode-btn ${viewMode === 'widget' ? 'active' : ''}`} onClick={() => setViewMode('widget')}>
              Widget
            </button>
          </div>

          <span className="tv-toolbar-symbol">{binanceSymbol?.replace('USDT', '')}/USDT</span>

          <button type="button" className="balance-pill" onClick={() => onOpenDock?.('balance')} title="Balance & stats">
            <span className="balance-pill-val">{balance ?? '—'}</span>
            <span className="balance-pill-label">USDT</span>
          </button>

          <select
            className="strategy-select compact"
            value={strategyId}
            onChange={(e) => handleStrategyChange(e.target.value)}
          >
            {stratList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <div className="timeframe-bar inline">
            {TIMEFRAMES.map((tf) => (
              <button key={tf} type="button" className={`tf-btn ${interval === tf ? 'active' : ''}`} onClick={() => onIntervalChange(tf)}>
                {tf}
              </button>
            ))}
          </div>

          <div className="tv-toolbar-actions">
            {viewMode === 'pro' && (
              <button type="button" className="tv-toolbar-btn" onClick={() => setIndModalOpen(true)}>
                ƒx Indicators
                <span className="tv-btn-badge">{activeIndCount}</span>
              </button>
            )}
            <button type="button" className="tv-toolbar-btn" onClick={() => onOpenDock?.('backtest')}>Backtest</button>
            <button type="button" className="tv-toolbar-btn icon" onClick={toggleFullscreen} title="Fullscreen">
              {fullscreen ? '⊡' : '⛶'}
            </button>
          </div>
        </div>

        {viewMode === 'pro' && drawHint && (
          <div className="draw-hint-bar">{drawHint}</div>
        )}
      </header>

      <div className="pro-chart-layout">
        {viewMode === 'pro' && (
          <aside className="chart-left-tools tv-style" aria-label="Drawing tools">
            {DRAW_TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`chart-tool-btn ${activeTool === t.id ? 'active' : ''}`}
                title={t.title}
                onClick={() => handleToolClick(t.id)}
              >
                {t.icon}
              </button>
            ))}
          </aside>
        )}

        <div className="pro-chart-main fill">
          {viewMode === 'account' && (
            <TradingViewAccountChart tvSymbol={tvSymbol} binanceSymbol={binanceSymbol} interval={interval} />
          )}
          {viewMode === 'widget' && (
            <TradingViewWidget tvSymbol={tvSymbol} binanceSymbol={binanceSymbol} interval={interval} />
          )}
          {viewMode === 'pro' && (
            <div className="pro-chart-body fill">
              {error && <div className="tester-error">{error}</div>}
              {loading && <div className="chart-loading">Loading SMC engine…</div>}
              <div ref={containerRef} className="chart-container pro-chart-canvas fill" style={{ height: chartHeight }} />
              {indicators.rsi && (
                <div className="rsi-legend">
                  <span>RSI 14</span>
                  <span className="rsi-zone">30</span>
                  <span className="rsi-zone">70</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
