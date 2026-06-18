import { useEffect, useRef, useState } from 'react';
import { loadTvConfig, buildStudies } from '../utils/tvConfig';

const TV_INTERVAL = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D' };

export default function TradingViewWidget({ tvSymbol, binanceSymbol, interval }) {
  const wrapRef = useRef(null);
  const [config, setConfig] = useState(loadTvConfig);

  useEffect(() => {
    const refresh = () => setConfig(loadTvConfig());
    window.addEventListener('tv-config-updated', refresh);
    return () => window.removeEventListener('tv-config-updated', refresh);
  }, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const container = wrapRef.current;
    container.innerHTML = '';

    const symbol = tvSymbol || `BINANCE:${binanceSymbol || 'BTCUSDT'}`;
    const tvInterval = TV_INTERVAL[interval] || '5';
    const studies = buildStudies(config);

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
      studies,
      support_host: 'https://www.tradingview.com',
      backgroundColor: '#131722',
      gridColor: '#2a2e39',
    });

    widgetDiv.appendChild(script);
    container.appendChild(widgetDiv);
    return () => { container.innerHTML = ''; };
  }, [tvSymbol, binanceSymbol, interval, config]);

  return <div ref={wrapRef} className="tv-widget-container fill" />;
}
