import { useEffect, useRef, useState } from 'react';
import { loadTvConfig, buildStudies } from '../utils/tvConfig';

const TV_INTERVAL = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D' };

export default function TradingViewChart({
  tvSymbol,
  binanceSymbol,
  interval,
  balance,
  onOpenDock,
}) {
  const wrapRef = useRef(null);
  const containerRef = useRef(null);
  const [config, setConfig] = useState(loadTvConfig);
  const [fullscreen, setFullscreen] = useState(false);

  const symbol = tvSymbol || `BINANCE:${binanceSymbol || 'BTCUSDT'}`;
  const tvInterval = TV_INTERVAL[interval] || '5';

  useEffect(() => {
    const refresh = () => setConfig(loadTvConfig());
    window.addEventListener('tv-config-updated', refresh);
    return () => window.removeEventListener('tv-config-updated', refresh);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    el.innerHTML = '';

    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container';
    widgetDiv.style.cssText = 'height:100%;width:100%';

    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.cssText = 'height:100%;width:100%';
    widgetDiv.appendChild(inner);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval: tvInterval,
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      enable_publishing: true,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: false,
      allow_symbol_change: true,
      save_image: true,
      withdateranges: true,
      details: true,
      hotlist: true,
      calendar: false,
      studies: buildStudies(config),
      support_host: 'https://www.tradingview.com',
      backgroundColor: '#131722',
      gridColor: '#2a2e39',
    });

    widgetDiv.appendChild(script);
    el.appendChild(widgetDiv);
    return () => { el.innerHTML = ''; };
  }, [symbol, tvInterval, config]);

  const layoutUrl = config.chartLayoutUrl?.trim()
    || `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}&interval=${tvInterval}`;

  const openMyChart = () => {
    window.open(layoutUrl, '_blank', 'noopener,noreferrer');
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

  return (
    <div ref={wrapRef} className={`tv-chart-page ${fullscreen ? 'fullscreen' : ''}`}>
      <header className="tv-chart-bar">
        <span className="tv-chart-pair">{binanceSymbol?.replace('USDT', '')}/USDT</span>

        <button type="button" className="balance-pill" onClick={() => onOpenDock?.('balance')}>
          <span className="balance-pill-val">{balance ?? '—'}</span>
          <span className="balance-pill-label">USDT</span>
        </button>

        <div className="tv-chart-bar-actions">
          <button type="button" className="tv-toolbar-btn primary" onClick={openMyChart}>
            Open My E5 Chart ↗
          </button>
          <span className="tv-chart-hint">
            Indicators · Strategy Tester · Pine scripts run on TradingView
          </span>
          <button type="button" className="tv-toolbar-btn icon" onClick={toggleFullscreen} title="Fullscreen">
            {fullscreen ? '⊡' : '⛶'}
          </button>
        </div>
      </header>

      <div ref={containerRef} className="tv-chart-frame" />

      <footer className="tv-chart-footer">
        <p>
          Use <strong>Open My E5 Chart</strong> for your saved Smart Money Algo Pro layout + Strategy Tester backtest.
          The embedded chart uses TradingView tools — add scripts via the <strong>Indicators</strong> button if published.
        </p>
      </footer>
    </div>
  );
}
