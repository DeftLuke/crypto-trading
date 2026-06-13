import { useEffect, useState } from 'react';
import TradingChart from './components/TradingChart';
import SignalPanel from './components/SignalPanel';
import TradesPanel from './components/TradesPanel';
import PairStatsPanel from './components/PairStatsPanel';
import SkippedLessonsPanel, { ExecutedLessonsPanel } from './components/LessonsPanel';
import { fetchPairs, connectWebSocket } from './services/api';

const TIMEFRAMES = ['1h', '30m', '15m', '5m', '3m'];
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

export default function App() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('5m');
  const [pairs, setPairs] = useState(DEFAULT_SYMBOLS);
  const [prices, setPrices] = useState({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetchPairs().then((p) => {
      if (Array.isArray(p)) setPairs(p.slice(0, 10));
    }).catch(() => {});

    connectWebSocket((data) => {
      if (data.type === 'connected') setConnected(true);
      if (data.type === 'price') {
        setPrices((prev) => ({ ...prev, [data.symbol]: data.price }));
      }
    });
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>Crypto Trading Dashboard</h1>
        <div className="header-right">
          <span style={{ fontSize: 13, color: '#8b949e' }}>
            {symbol} {prices[symbol] ? `$${prices[symbol].toLocaleString()}` : ''}
          </span>
          <span className="status-dot" title={connected ? 'Connected' : 'Connecting...'} />
          <span style={{ fontSize: 12, color: '#8b949e' }}>
            {connected ? 'Live' : 'Connecting'}
          </span>
        </div>
      </header>

      <div className="symbol-select">
        {pairs.map((p) => (
          <button
            key={p}
            className={`symbol-btn ${symbol === p ? 'active' : ''}`}
            onClick={() => setSymbol(p)}
          >
            {p.replace('USDT', '')}
          </button>
        ))}
      </div>

      <div className="main-grid">
        <div className="chart-area">
          <div className="timeframe-bar">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                className={`tf-btn ${interval === tf ? 'active' : ''}`}
                onClick={() => setInterval(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
          <TradingChart symbol={symbol} interval={interval} />
        </div>

        <aside className="sidebar">
          <PairStatsPanel />
          <SignalPanel />
          <TradesPanel />
        </aside>
      </div>

      <div className="lessons-grid">
        <SkippedLessonsPanel />
        <ExecutedLessonsPanel />
      </div>
    </div>
  );
}
