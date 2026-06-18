import { useEffect, useState } from 'react';
import { loadTvConfig, buildAccountChartUrl } from '../utils/tvConfig';

export default function TradingViewAccountChart({ tvSymbol, binanceSymbol, interval }) {
  const [config, setConfig] = useState(loadTvConfig);
  const [iframeBlocked, setIframeBlocked] = useState(false);

  useEffect(() => {
    const refresh = () => setConfig(loadTvConfig());
    window.addEventListener('storage', refresh);
    window.addEventListener('tv-config-updated', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('tv-config-updated', refresh);
    };
  }, []);

  const chartUrl = buildAccountChartUrl(tvSymbol || `BINANCE:${binanceSymbol}`, interval, config);

  return (
    <div className="tv-account-wrap">
      <div className="tv-account-bar">
        <span className="tv-account-badge">My TradingView</span>
        <span className="muted small">
          Uses your logged-in TV session — Smart Money Algo Pro E5 & saved layout load when you are signed in at tradingview.com in this browser.
        </span>
        <a href={chartUrl} target="_blank" rel="noopener noreferrer" className="tv-open-link">
          Open in tab ↗
        </a>
      </div>

      {!iframeBlocked ? (
        <iframe
          title="TradingView chart"
          className="tv-account-iframe"
          src={chartUrl}
          allow="fullscreen"
          onError={() => setIframeBlocked(true)}
        />
      ) : (
        <div className="tv-account-fallback">
          <p>TradingView blocked embed — open your chart in a new tab (your Pine scripts & Strategy Tester work there).</p>
          <a href={chartUrl} target="_blank" rel="noopener noreferrer" className="primary-btn">
            Open My TradingView Chart
          </a>
        </div>
      )}

      <p className="tv-account-tip muted small">
        Tip: In Settings → Chart, paste your saved chart URL (with E5 loaded) so this always opens your layout.
      </p>
    </div>
  );
}
