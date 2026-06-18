import { useEffect, useState } from 'react';
import TradingViewChart from './TradingViewChart';
import CryptoPairSearch from './CryptoPairSearch';
import DockShell from './DockShell';
import SignalPanel from './SignalPanel';
import TradesPanel from './TradesPanel';
import PairStatsPanel from './PairStatsPanel';
import SkippedLessonsPanel, { ExecutedLessonsPanel } from './LessonsPanel';
import { fetchPairs } from '../services/api';
import { subscribeMarkPrice } from '../services/binanceWs';
import { loadTvConfig } from '../utils/tvConfig';
import { useApp } from '../context/AppContext';

const TIMEFRAMES = ['1h', '30m', '15m', '5m', '3m'];

export default function TradingPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [tvSymbol, setTvSymbol] = useState('BINANCE:BTCUSDT');
  const [interval, setInterval] = useState('5m');
  const [pairs, setPairs] = useState([]);
  const [liveWs, setLiveWs] = useState(false);
  const [dock, setDock] = useState(null);
  const [historyTab, setHistoryTab] = useState('skipped');
  const { balance, scannerOn } = useApp();

  useEffect(() => {
    fetchPairs().then((p) => { if (Array.isArray(p)) setPairs(p); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!pairs.length) return;
    const unsubs = pairs.map((sym) => subscribeMarkPrice(sym, () => setLiveWs(true)));
    return () => unsubs.forEach((u) => u());
  }, [pairs]);

  const handlePairSelect = (item) => {
    setTvSymbol(item.id);
    let binance = item.binanceSymbol
      || (item.exchange === 'BINANCE' ? item.symbol.replace('/', '').toUpperCase() : null);
    if (binance) {
      binance = binance.replace(/\.P$/i, '').replace('USDTUSDT', 'USDT');
      if (!binance.endsWith('USDT')) binance = `${binance}USDT`;
      setSymbol(binance);
    } else {
      const base = (item.symbol || '').replace(/USDT\.P|USDT|USD|\.P/gi, '').toUpperCase();
      if (base) setSymbol(`${base}USDT`);
    }
  };

  const balDisplay = balance?.available != null
    ? parseFloat(balance.available).toFixed(2)
    : '—';
  const layoutUrl = loadTvConfig().chartLayoutUrl?.trim();

  return (
    <div className="trading-workspace">
      <div className="workspace-top slim">
        <CryptoPairSearch tvSymbol={tvSymbol} onSelect={handlePairSelect} />
        <div className="timeframe-bar inline workspace-tf">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} type="button" className={`tf-btn ${interval === tf ? 'active' : ''}`} onClick={() => setInterval(tf)}>
              {tf}
            </button>
          ))}
        </div>
        <div className="workspace-status">
          <span className={`chip-status ${scannerOn ? 'on' : ''}`}>{scannerOn ? 'Scanner ON' : 'Scanner OFF'}</span>
          {liveWs && <span className="live-pill">Live</span>}
        </div>
      </div>

      <div className="workspace-chart">
        <TradingViewChart
          tvSymbol={tvSymbol}
          binanceSymbol={symbol}
          interval={interval}
          balance={balDisplay}
          onOpenDock={setDock}
        />
      </div>

      <DockShell active={dock} onSelect={setDock}>
        {dock === 'balance' && <PairStatsPanel />}
        {dock === 'signals' && <SignalPanel />}
        {dock === 'history' && (
          <div className="history-dock">
            <div className="history-tabs">
              <button type="button" className={historyTab === 'skipped' ? 'active' : ''} onClick={() => setHistoryTab('skipped')}>Skipped</button>
              <button type="button" className={historyTab === 'executed' ? 'active' : ''} onClick={() => setHistoryTab('executed')}>Executed</button>
              <button type="button" className={historyTab === 'trades' ? 'active' : ''} onClick={() => setHistoryTab('trades')}>Trades</button>
            </div>
            <div className="history-scroll">
              {historyTab === 'skipped' && <SkippedLessonsPanel bare />}
              {historyTab === 'executed' && <ExecutedLessonsPanel bare />}
              {historyTab === 'trades' && <TradesPanel bare />}
            </div>
          </div>
        )}
        {dock === 'backtest' && (
          <div className="tv-backtest-dock">
            <h4>Strategy Tester lives on TradingView</h4>
            <p>
              Your <strong>Smart Money Algo Pro E5</strong> indicator and full backtest run on TradingView — not inside this embed.
              Private Pine scripts cannot be injected into the widget without your TV login session.
            </p>
            <ol>
              <li>Save your chart URL in Settings (with E5 loaded).</li>
              <li>Click <strong>Open My E5 Chart</strong> on the chart bar.</li>
              <li>On TradingView: bottom panel → <strong>Strategy Tester</strong>.</li>
              <li>For a dedicated strategy script, paste <code>pine/smc-mtf-strategy.pine</code> into Pine Editor.</li>
            </ol>
            {layoutUrl ? (
              <a href={layoutUrl} target="_blank" rel="noopener noreferrer" className="primary-btn">
                Open My Chart & Strategy Tester ↗
              </a>
            ) : (
              <p className="tester-error">Add your chart URL in Settings → Chart first.</p>
            )}
          </div>
        )}
      </DockShell>
    </div>
  );
}
