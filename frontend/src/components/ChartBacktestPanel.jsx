import { useState } from 'react';
import { runBacktest } from '../services/api';

const PERIODS = [
  { id: '1w', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
];

export default function ChartBacktestPanel({ symbol, interval, strategyId, strategyName }) {
  const [period, setPeriod] = useState('1m');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await runBacktest({
        strategy: strategyId,
        symbol,
        entryInterval: interval,
        period,
        initialCapital: 1000,
      });
      setResult(r);
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="backtest-dock">
      <p className="dock-desc">
        Test <strong>{strategyName || strategyId}</strong> on {symbol} ({interval}) — same engine as Strategy Tester page.
      </p>
      <div className="tester-controls">
        <div className="period-pills">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`period-pill ${period === p.id ? 'active' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className="primary-btn" disabled={running} onClick={run}>
          {running ? 'Running…' : 'Run Backtest'}
        </button>
      </div>
      {result && !result.error && (
        <div className="tester-metrics-grid">
          <div className="tester-metric">
            <span className="tester-metric-label">Net PnL</span>
            <span className={`tester-metric-val ${(result.stats?.netPnlPercent ?? 0) >= 0 ? 'green-text' : 'red-text'}`}>
              {result.stats?.netPnlPercent?.toFixed?.(2)}%
            </span>
          </div>
          <div className="tester-metric">
            <span className="tester-metric-label">Win rate</span>
            <span className="tester-metric-val">{result.stats?.winRate?.toFixed?.(0)}%</span>
          </div>
          <div className="tester-metric">
            <span className="tester-metric-label">Trades</span>
            <span className="tester-metric-val">{result.stats?.totalTrades}</span>
          </div>
          <div className="tester-metric">
            <span className="tester-metric-label">Profit factor</span>
            <span className="tester-metric-val">{result.stats?.profitFactor?.toFixed?.(2)}</span>
          </div>
          <div className="tester-metric">
            <span className="tester-metric-label">Max DD</span>
            <span className="tester-metric-val red-text">{result.stats?.maxDrawdownPercent?.toFixed?.(1)}%</span>
          </div>
        </div>
      )}
      {result?.error && <p className="tester-error">{result.error}</p>}
      {result?.trades?.length > 0 && (
        <div className="backtest-trades-scroll">
          <table className="data-table compact">
            <thead>
              <tr><th>Dir</th><th>Entry</th><th>Exit</th><th>PnL</th><th>R</th></tr>
            </thead>
            <tbody>
              {result.trades.slice(-20).reverse().map((t, i) => (
                <tr key={i}>
                  <td>{t.direction}</td>
                  <td>{t.entry?.toFixed?.(4)}</td>
                  <td>{t.exit?.toFixed?.(4)}</td>
                  <td className={t.pnl >= 0 ? 'green-text' : 'red-text'}>{t.pnlPercent?.toFixed?.(2)}%</td>
                  <td>{t.rMultiple?.toFixed?.(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
