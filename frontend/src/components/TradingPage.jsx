import { useEffect, useState } from 'react';
import TradingChart from './TradingChart';
import SignalPanel from './SignalPanel';
import TradesPanel from './TradesPanel';
import PairStatsPanel from './PairStatsPanel';
import SkippedLessonsPanel, { ExecutedLessonsPanel } from './LessonsPanel';
import {
  fetchPairs,
  fetchCgPrices,
  connectWebSocket,
  fetchScannerStatus,
  startScanner,
  stopScanner,
} from '../services/api';
import { subscribeMarkPrice } from '../services/binanceWs';

const TIMEFRAMES = ['1h', '30m', '15m', '5m', '3m'];

export default function TradingPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('5m');
  const [pairs, setPairs] = useState([]);
  const [prices, setPrices] = useState({});
  const [changes, setChanges] = useState({});
  const [connected, setConnected] = useState(false);
  const [liveWs, setLiveWs] = useState(false);
  const [scannerOn, setScannerOn] = useState(false);

  useEffect(() => {
    fetchPairs().then((p) => { if (Array.isArray(p)) setPairs(p); }).catch(() => {});
    fetchScannerStatus().then((s) => setScannerOn(s.isRunning)).catch(() => {});

    connectWebSocket((data) => {
      if (data.type === 'connected') setConnected(true);
      if (data.type === 'price') setPrices((prev) => ({ ...prev, [data.symbol]: data.price }));
      if (data.type === 'scanner') setScannerOn(data.isRunning);
    });
  }, []);

  useEffect(() => {
    if (!pairs.length) return;
    const load = () => {
      fetchCgPrices(pairs).then((data) => {
        const p = {};
        const c = {};
        for (const [sym, v] of Object.entries(data || {})) {
          if (v?.price) p[sym] = v.price;
          if (v?.change24h != null) c[sym] = v.change24h;
        }
        setPrices((prev) => ({ ...prev, ...p }));
        setChanges((prev) => ({ ...prev, ...c }));
      }).catch(() => {});
    };
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [pairs]);

  useEffect(() => {
    if (!pairs.length) return;
    const unsubs = pairs.map((sym) =>
      subscribeMarkPrice(sym, ({ symbol: s, price }) => {
        setLiveWs(true);
        setPrices((prev) => ({ ...prev, [s]: price }));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [pairs]);

  const toggleScanner = async () => {
    if (scannerOn) {
      await stopScanner();
      setScannerOn(false);
    } else {
      await startScanner();
      setScannerOn(true);
    }
  };

  return (
    <div className="trading-page">
      <header className="page-header">
        <div>
          <h2>Live Trading</h2>
          <span className="page-sub">
            {symbol.replace('USDT', '')}{' '}
            {prices[symbol] ? `$${prices[symbol].toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
          </span>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className={`scanner-toggle ${scannerOn ? 'on' : 'off'}`}
            onClick={toggleScanner}
          >
            {scannerOn ? '🟢 Scanner ON' : '🔴 Scanner OFF'}
          </button>
          <span className="status-dot" />
          <span className="status-text">{liveWs ? 'Live' : connected ? 'Connected' : '…'}</span>
        </div>
      </header>

      <div className="symbol-select">
        {pairs.slice(0, 30).map((p) => (
          <button
            key={p}
            type="button"
            className={`symbol-btn ${symbol === p ? 'active' : ''}`}
            onClick={() => setSymbol(p)}
          >
            <span>{p.replace('USDT', '')}</span>
            {prices[p] != null && (
              <span className="sym-price">
                ${prices[p] < 1 ? prices[p].toFixed(4) : prices[p].toFixed(2)}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="main-grid">
        <div className="chart-area">
          <div className="timeframe-bar">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
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
