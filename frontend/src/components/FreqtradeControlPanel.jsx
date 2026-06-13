import { useCallback, useEffect, useState } from 'react';
import {
  fetchFreqtradeStatus,
  fetchFreqtradeStrategies,
  fetchFreqtradeBalance,
  fetchFreqtradeTrades,
  startFreqtradeBot,
  stopFreqtradeBot,
  setFreqtradeStrategy,
  forceExitFreqtrade,
} from '../services/api';

export default function FreqtradeControlPanel({ compact = false }) {
  const [status, setStatus] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [balance, setBalance] = useState(null);
  const [closedTrades, setClosedTrades] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedPyStrategy, setSelectedPyStrategy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [s, st, bal, trades] = await Promise.all([
        fetchFreqtradeStatus(),
        fetchFreqtradeStrategies(),
        fetchFreqtradeBalance().catch(() => null),
        fetchFreqtradeTrades(20).catch(() => null),
      ]);
      setStatus(s);
      const list = st.strategies || st.defaults || [];
      setStrategies(list);
      setBalance(bal);
      setClosedTrades(trades);
      const active = s?.ping?.strategy;
      if (active && !selectedPyStrategy) setSelectedPyStrategy(active);
    } catch (err) {
      setError(err.message || 'Freqtrade unavailable');
    } finally {
      setLoading(false);
    }
  }, [selectedPyStrategy]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [refresh]);

  const ping = status?.ping;
  const profit = status?.profit;
  const openTrades = status?.openTrades || [];

  const runAction = async (fn, okMsg) => {
    setActionLoading(true);
    setMessage('');
    setError('');
    try {
      await fn();
      setMessage(okMsg);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApplyStrategy = () => {
    if (!selectedPyStrategy) return;
    runAction(
      () => setFreqtradeStrategy(selectedPyStrategy),
      `Strategy set to ${selectedPyStrategy} — config reloaded`
    );
  };

  if (loading) return <p className="muted">Loading Freqtrade bot…</p>;

  return (
    <div className={`freqtrade-control ${compact ? 'compact' : ''}`}>
      <div className="freqtrade-control-header">
        <div>
          <span className={`ft-status-dot ${ping?.online ? 'online' : 'offline'}`} />
          <strong>{ping?.online ? 'Bot online' : 'Bot offline'}</strong>
          {ping?.online && (
            <span className="muted">
              {' · '}{ping.dryRun ? 'Dry-run' : 'LIVE'} · {ping.state} · {ping.strategy}
            </span>
          )}
        </div>
        <div className="freqtrade-actions">
          <button type="button" className="primary-btn" onClick={refresh} disabled={actionLoading}>
            Refresh
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={actionLoading || !ping?.online}
            onClick={() => runAction(startFreqtradeBot, 'Bot started')}
          >
            Start
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={actionLoading || !ping?.online}
            onClick={() => runAction(stopFreqtradeBot, 'Bot stopped')}
          >
            Stop
          </button>
        </div>
      </div>

      {error && <div className="tester-error">{error}</div>}
      {message && <div className="tester-hint">{message}</div>}
      {!ping?.online && (
        <p className="muted">
          Start Freqtrade on the server:{' '}
          <code>docker compose --profile freqtrade up -d freqtrade</code>
          {' '}and set <code>FREQTRADE_API_PASSWORD</code> in deploy/.env
        </p>
      )}

      <div className="freqtrade-grid">
        <section className="freqtrade-card">
          <h2>Python strategy</h2>
          <div className="ft-strategy-picker">
            <select
              value={selectedPyStrategy}
              onChange={(e) => setSelectedPyStrategy(e.target.value)}
              disabled={!ping?.online || actionLoading}
            >
              <option value="">Select…</option>
              {strategies.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              type="button"
              className="primary-btn"
              disabled={!selectedPyStrategy || actionLoading || !ping?.online}
              onClick={handleApplyStrategy}
            >
              Apply
            </button>
          </div>
          <p className="muted small">
            Files: <code>freqtrade/user_data/strategies/</code>
          </p>
        </section>

        <section className="freqtrade-card">
          <h2>Performance</h2>
          {profit ? (
            <dl className="metrics-list">
              <div className="metric-row">
                <dt>Total profit</dt>
                <dd className={profit.profit_all_coin >= 0 ? 'green-text' : 'red-text'}>
                  {profit.profit_all_coin?.toFixed(4)} {profit.stake_currency}
                </dd>
              </div>
              <div className="metric-row">
                <dt>Win / Loss</dt>
                <dd>{profit.winning_trades} / {profit.losing_trades}</dd>
              </div>
              <div className="metric-row">
                <dt>Win rate</dt>
                <dd>{profit.winrate ? (profit.winrate * 100).toFixed(1) : 0}%</dd>
              </div>
              {balance?.total && (
                <div className="metric-row">
                  <dt>Balance</dt>
                  <dd>{balance.total} {balance.symbol || 'USDT'}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="muted">No profit data yet.</p>
          )}
        </section>

        <section className="freqtrade-card">
          <h2>Open trades ({openTrades.length})</h2>
          {openTrades.length === 0 ? (
            <p className="muted">No open positions.</p>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th>Side</th>
                    <th>Entry</th>
                    <th>P/L %</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {openTrades.map((t) => (
                    <tr key={t.trade_id || t.pair}>
                      <td>{t.pair}</td>
                      <td>{t.is_short ? 'SHORT' : 'LONG'}</td>
                      <td>{t.open_rate}</td>
                      <td className={t.profit_pct >= 0 ? 'green-text' : 'red-text'}>
                        {t.profit_pct?.toFixed(2)}%
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-btn"
                          disabled={actionLoading}
                          onClick={() =>
                            runAction(
                              () => forceExitFreqtrade(t.trade_id),
                              `Closed trade ${t.trade_id}`
                            )
                          }
                        >
                          Exit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="primary-btn"
                style={{ marginTop: 8 }}
                disabled={actionLoading}
                onClick={() => runAction(() => forceExitFreqtrade('all'), 'All trades closed')}
              >
                Force exit all
              </button>
            </>
          )}
        </section>
      </div>

      {!compact && closedTrades?.trades?.length > 0 && (
        <section className="freqtrade-card">
          <h2>Recent closed trades</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Profit</th>
                <th>Close date</th>
              </tr>
            </thead>
            <tbody>
              {closedTrades.trades.slice(0, 10).map((t) => (
                <tr key={t.trade_id}>
                  <td>{t.pair}</td>
                  <td className={t.profit_ratio >= 0 ? 'green-text' : 'red-text'}>
                    {(t.profit_ratio * 100)?.toFixed(2)}%
                  </td>
                  <td>{t.close_date?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
