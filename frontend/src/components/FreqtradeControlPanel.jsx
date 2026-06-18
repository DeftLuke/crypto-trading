import { useCallback, useEffect, useState } from 'react';
import {
  fetchFreqtradeStatus,
  fetchFreqtradeStrategies,
  fetchFreqtradeBalance,
  fetchFreqtradeTrades,
  fetchFreqtradeConfig,
  fetchFreqtradeDaily,
  fetchFreqtradeWeekly,
  fetchFreqtradePerformance,
  fetchFreqtradeStats,
  fetchFreqtradeCount,
  fetchFreqtradeWhitelist,
  fetchFreqtradeBlacklist,
  fetchFreqtradeLocks,
  fetchFreqtradeLogs,
  fetchFreqtradeHealth,
  fetchFreqtradeVersion,
  fetchFreqtradeSysinfo,
  startFreqtradeBot,
  stopFreqtradeBot,
  pauseFreqtradeBot,
  stopBuyFreqtrade,
  reloadFreqtradeConfig,
  setFreqtradeStrategy,
  forceExitFreqtrade,
  forceEnterFreqtrade,
  addFreqtradeBlacklist,
  removeFreqtradeBlacklist,
  addFreqtradeLock,
  deleteFreqtradeLock,
  cancelFreqtradeOrder,
  deleteFreqtradeTrade,
  reloadFreqtradeTrade,
} from '../services/api';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'trades', label: 'Trades' },
  { id: 'pairs', label: 'Pairs' },
  { id: 'locks', label: 'Locks' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'logs', label: 'Logs' },
  { id: 'system', label: 'System' },
];

function modeLabel(ping) {
  if (!ping?.online) return '';
  if (ping.demoTrading) return 'Binance Demo';
  if (ping.dryRun) return 'Dry-run';
  return 'LIVE';
}

export default function FreqtradeControlPanel({ compact = false }) {
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [balance, setBalance] = useState(null);
  const [closedTrades, setClosedTrades] = useState(null);
  const [botConfig, setBotConfig] = useState(null);
  const [daily, setDaily] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [stats, setStats] = useState(null);
  const [tradeCount, setTradeCount] = useState(null);
  const [whitelist, setWhitelist] = useState(null);
  const [blacklist, setBlacklist] = useState(null);
  const [locks, setLocks] = useState(null);
  const [logs, setLogs] = useState(null);
  const [health, setHealth] = useState(null);
  const [version, setVersion] = useState(null);
  const [sysinfo, setSysinfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedPyStrategy, setSelectedPyStrategy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [blacklistInput, setBlacklistInput] = useState('');
  const [lockPair, setLockPair] = useState('');
  const [lockUntil, setLockUntil] = useState('');
  const [forcePair, setForcePair] = useState('BTC/USDT:USDT');
  const [forceSide, setForceSide] = useState('long');

  const refreshCore = useCallback(async () => {
    const [s, st, bal, trades] = await Promise.all([
      fetchFreqtradeStatus(),
      fetchFreqtradeStrategies(),
      fetchFreqtradeBalance().catch(() => null),
      fetchFreqtradeTrades(30).catch(() => null),
    ]);
    setStatus(s);
    setStrategies(st.strategies || st.defaults || []);
    setBalance(bal);
    setClosedTrades(trades);
    const active = s?.ping?.strategy;
    if (active) setSelectedPyStrategy((prev) => prev || active);
  }, []);

  const refreshTab = useCallback(async (activeTab) => {
    try {
      if (activeTab === 'overview') {
        const [cfg, count] = await Promise.all([
          fetchFreqtradeConfig().catch(() => null),
          fetchFreqtradeCount().catch(() => null),
        ]);
        setBotConfig(cfg);
        setTradeCount(count);
      } else if (activeTab === 'pairs') {
        const [wl, bl] = await Promise.all([
          fetchFreqtradeWhitelist().catch(() => null),
          fetchFreqtradeBlacklist().catch(() => null),
        ]);
        setWhitelist(wl);
        setBlacklist(bl);
      } else if (activeTab === 'locks') {
        setLocks(await fetchFreqtradeLocks().catch(() => null));
      } else if (activeTab === 'analytics') {
        const [d, w, perf, st] = await Promise.all([
          fetchFreqtradeDaily(14).catch(() => null),
          fetchFreqtradeWeekly(8).catch(() => null),
          fetchFreqtradePerformance().catch(() => null),
          fetchFreqtradeStats().catch(() => null),
        ]);
        setDaily(d);
        setWeekly(w);
        setPerformance(perf);
        setStats(st);
      } else if (activeTab === 'logs') {
        setLogs(await fetchFreqtradeLogs(150).catch(() => null));
      } else if (activeTab === 'system') {
        const [h, v, si] = await Promise.all([
          fetchFreqtradeHealth().catch(() => null),
          fetchFreqtradeVersion().catch(() => null),
          fetchFreqtradeSysinfo().catch(() => null),
        ]);
        setHealth(h);
        setVersion(v);
        setSysinfo(si);
      }
    } catch {
      /* tab data optional */
    }
  }, []);

  const refresh = useCallback(async () => {
    setError('');
    try {
      await refreshCore();
      await refreshTab(tab);
    } catch (err) {
      setError(err.message || 'Freqtrade unavailable');
    } finally {
      setLoading(false);
    }
  }, [refreshCore, refreshTab, tab]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!loading) refreshTab(tab);
  }, [tab, loading, refreshTab]);

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
      `Strategy set to ${selectedPyStrategy}`
    );
  };

  const handleAddBlacklist = () => {
    const pairs = blacklistInput.split(',').map((p) => p.trim()).filter(Boolean);
    if (!pairs.length) return;
    runAction(async () => {
      await addFreqtradeBlacklist(pairs);
      setBlacklistInput('');
    }, `Blacklisted: ${pairs.join(', ')}`);
  };

  const handleAddLock = () => {
    if (!lockPair || !lockUntil) return;
    const until = lockUntil.includes('Z') ? lockUntil : `${lockUntil}Z`;
    runAction(
      () => addFreqtradeLock({ pair: lockPair, until, side: 'long', reason: 'dashboard' }),
      `Locked ${lockPair}`
    );
  };

  const handleForceEnter = () => {
    if (!forcePair) return;
    runAction(
      () => forceEnterFreqtrade({ pair: forcePair, side: forceSide }),
      `Force enter ${forceSide} ${forcePair}`
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
              {' · '}{modeLabel(ping)} · {ping.state} · {ping.strategy}
            </span>
          )}
        </div>
        <div className="freqtrade-actions">
          <button type="button" className="primary-btn" onClick={refresh} disabled={actionLoading}>
            Refresh
          </button>
          <button type="button" className="primary-btn" disabled={actionLoading || !ping?.online} onClick={() => runAction(startFreqtradeBot, 'Bot started')}>Start</button>
          <button type="button" className="primary-btn" disabled={actionLoading || !ping?.online} onClick={() => runAction(stopFreqtradeBot, 'Bot stopped')}>Stop</button>
          <button type="button" className="primary-btn" disabled={actionLoading || !ping?.online} onClick={() => runAction(pauseFreqtradeBot, 'Bot paused')}>Pause</button>
          <button type="button" className="primary-btn" disabled={actionLoading || !ping?.online} onClick={() => runAction(stopBuyFreqtrade, 'Stop buy enabled')}>Stop buy</button>
          <button type="button" className="primary-btn" disabled={actionLoading || !ping?.online} onClick={() => runAction(reloadFreqtradeConfig, 'Config reloaded')}>Reload</button>
        </div>
      </div>

      {!compact && (
        <div className="ft-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ft-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="tester-error">{error}</div>}
      {message && <div className="tester-hint">{message}</div>}
      {!ping?.online && (
        <p className="muted">
          Start Freqtrade: <code>docker compose --profile freqtrade up -d freqtrade</code>
        </p>
      )}

      {(compact || tab === 'overview') && (
        <div className="freqtrade-grid">
          <section className="freqtrade-card">
            <h2>Python strategy</h2>
            <div className="ft-strategy-picker">
              <select value={selectedPyStrategy} onChange={(e) => setSelectedPyStrategy(e.target.value)} disabled={!ping?.online || actionLoading}>
                <option value="">Select…</option>
                {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="button" className="primary-btn" disabled={!selectedPyStrategy || actionLoading || !ping?.online} onClick={handleApplyStrategy}>Apply</button>
            </div>
            {botConfig && (
              <dl className="metrics-list small">
                <div className="metric-row"><dt>Exchange</dt><dd>{botConfig.exchange}{botConfig.demo_trading ? ' (Demo)' : ''}</dd></div>
                <div className="metric-row"><dt>Max trades</dt><dd>{botConfig.max_open_trades}</dd></div>
                <div className="metric-row"><dt>Force entry</dt><dd>{botConfig.force_entry_enable ? 'Yes' : 'No'}</dd></div>
                {tradeCount && <div className="metric-row"><dt>Open / max</dt><dd>{tradeCount.current} / {tradeCount.max}</dd></div>}
              </dl>
            )}
          </section>

          <section className="freqtrade-card">
            <h2>Performance</h2>
            {profit ? (
              <dl className="metrics-list">
                <div className="metric-row"><dt>Total profit</dt><dd className={profit.profit_all_coin >= 0 ? 'green-text' : 'red-text'}>{profit.profit_all_coin?.toFixed(4)} {profit.stake_currency}</dd></div>
                <div className="metric-row"><dt>Win / Loss</dt><dd>{profit.winning_trades} / {profit.losing_trades}</dd></div>
                <div className="metric-row"><dt>Win rate</dt><dd>{profit.winrate ? (profit.winrate * 100).toFixed(1) : 0}%</dd></div>
                {balance?.total != null && <div className="metric-row"><dt>Balance</dt><dd>{Number(balance.total).toFixed(2)} {balance.symbol || 'USDT'}</dd></div>}
              </dl>
            ) : <p className="muted">No profit data yet.</p>}
          </section>

          <section className="freqtrade-card">
            <h2>Open trades ({openTrades.length})</h2>
            {openTrades.length === 0 ? <p className="muted">No open positions.</p> : (
              <>
                <table className="data-table">
                  <thead><tr><th>Pair</th><th>Side</th><th>Entry</th><th>P/L %</th><th /></tr></thead>
                  <tbody>
                    {openTrades.map((t) => (
                      <tr key={t.trade_id || t.pair}>
                        <td>{t.pair}</td>
                        <td>{t.is_short ? 'SHORT' : 'LONG'}</td>
                        <td>{t.open_rate}</td>
                        <td className={t.profit_pct >= 0 ? 'green-text' : 'red-text'}>{t.profit_pct?.toFixed(2)}%</td>
                        <td>
                          <button type="button" className="link-btn" disabled={actionLoading} onClick={() => runAction(() => forceExitFreqtrade(t.trade_id), `Closed ${t.trade_id}`)}>Exit</button>
                          {' · '}
                          <button type="button" className="link-btn" disabled={actionLoading} onClick={() => runAction(() => cancelFreqtradeOrder(t.trade_id), 'Order cancelled')}>Cancel</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="primary-btn" style={{ marginTop: 8 }} disabled={actionLoading} onClick={() => runAction(() => forceExitFreqtrade('all'), 'All trades closed')}>Force exit all</button>
              </>
            )}
          </section>
        </div>
      )}

      {!compact && tab === 'trades' && (
        <div className="freqtrade-grid">
          <section className="freqtrade-card">
            <h2>Force enter</h2>
            <div className="ft-form-row">
              <input type="text" value={forcePair} onChange={(e) => setForcePair(e.target.value)} placeholder="BTC/USDT:USDT" />
              <select value={forceSide} onChange={(e) => setForceSide(e.target.value)}>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
              <button type="button" className="primary-btn" disabled={actionLoading || !ping?.online || !ping?.forceEntryEnable} onClick={handleForceEnter}>Enter</button>
            </div>
            {!ping?.forceEntryEnable && <p className="muted small">Force entry disabled in config.</p>}
          </section>
          <section className="freqtrade-card ft-span-2">
            <h2>Closed trades</h2>
            {closedTrades?.trades?.length ? (
              <table className="data-table">
                <thead><tr><th>ID</th><th>Pair</th><th>Profit</th><th>Close</th><th /></tr></thead>
                <tbody>
                  {closedTrades.trades.map((t) => (
                    <tr key={t.trade_id}>
                      <td>{t.trade_id}</td>
                      <td>{t.pair}</td>
                      <td className={t.profit_ratio >= 0 ? 'green-text' : 'red-text'}>{(t.profit_ratio * 100)?.toFixed(2)}%</td>
                      <td>{t.close_date?.slice(0, 16)}</td>
                      <td>
                        <button type="button" className="link-btn" disabled={actionLoading} onClick={() => runAction(() => reloadFreqtradeTrade(t.trade_id), 'Trade reloaded')}>Reload</button>
                        {' · '}
                        <button type="button" className="link-btn" disabled={actionLoading} onClick={() => runAction(() => deleteFreqtradeTrade(t.trade_id), 'Trade deleted')}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">No closed trades yet.</p>}
          </section>
        </div>
      )}

      {!compact && tab === 'pairs' && (
        <div className="freqtrade-grid">
          <section className="freqtrade-card">
            <h2>Whitelist</h2>
            {whitelist?.whitelist?.length ? (
              <ul className="ft-pair-list">{whitelist.whitelist.map((p) => <li key={p}>{p}</li>)}</ul>
            ) : <p className="muted">No whitelist data.</p>}
          </section>
          <section className="freqtrade-card">
            <h2>Blacklist</h2>
            {blacklist?.blacklist?.length ? (
              <ul className="ft-pair-list">
                {blacklist.blacklist.map((p) => (
                  <li key={p}>
                    {p}
                    <button type="button" className="link-btn" disabled={actionLoading} onClick={() => runAction(() => removeFreqtradeBlacklist([p]), `Removed ${p}`)}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Blacklist empty.</p>}
            <div className="ft-form-row" style={{ marginTop: 12 }}>
              <input type="text" value={blacklistInput} onChange={(e) => setBlacklistInput(e.target.value)} placeholder="DOGE/USDT:USDT, LUNA/USDT:USDT" />
              <button type="button" className="primary-btn" disabled={actionLoading || !blacklistInput} onClick={handleAddBlacklist}>Add</button>
            </div>
          </section>
        </div>
      )}

      {!compact && tab === 'locks' && (
        <section className="freqtrade-card">
          <h2>Pair locks</h2>
          <div className="ft-form-row" style={{ marginBottom: 16 }}>
            <input type="text" value={lockPair} onChange={(e) => setLockPair(e.target.value)} placeholder="BTC/USDT:USDT" />
            <input type="datetime-local" value={lockUntil} onChange={(e) => setLockUntil(e.target.value)} />
            <button type="button" className="primary-btn" disabled={actionLoading} onClick={handleAddLock}>Lock pair</button>
          </div>
          {locks?.locks?.length ? (
            <table className="data-table">
              <thead><tr><th>Pair</th><th>Until</th><th>Reason</th><th /></tr></thead>
              <tbody>
                {locks.locks.map((l) => (
                  <tr key={l.id}>
                    <td>{l.pair}</td>
                    <td>{l.lock_end_time || l.lock_end_timestamp}</td>
                    <td>{l.reason}</td>
                    <td>
                      <button type="button" className="link-btn" disabled={actionLoading} onClick={() => runAction(() => deleteFreqtradeLock(l.id), 'Lock removed')}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No active locks.</p>}
        </section>
      )}

      {!compact && tab === 'analytics' && (
        <div className="freqtrade-grid">
          <section className="freqtrade-card">
            <h2>Daily P/L (14d)</h2>
            {daily?.data?.length ? (
              <table className="data-table">
                <thead><tr><th>Date</th><th>Trades</th><th>Profit</th></tr></thead>
                <tbody>
                  {daily.data.slice(-14).map((row) => (
                    <tr key={row.date}><td>{row.date}</td><td>{row.trade_count}</td><td className={row.abs_profit >= 0 ? 'green-text' : 'red-text'}>{row.abs_profit?.toFixed(4)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">No daily data.</p>}
          </section>
          <section className="freqtrade-card">
            <h2>Weekly</h2>
            {weekly?.data?.length ? (
              <table className="data-table">
                <thead><tr><th>Week</th><th>Trades</th><th>Profit</th></tr></thead>
                <tbody>
                  {weekly.data.map((row) => (
                    <tr key={row.date}><td>{row.date}</td><td>{row.trade_count}</td><td>{row.abs_profit?.toFixed(4)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">No weekly data.</p>}
          </section>
          <section className="freqtrade-card">
            <h2>By pair</h2>
            {performance?.length ? (
              <table className="data-table">
                <thead><tr><th>Pair</th><th>Profit %</th><th>Count</th></tr></thead>
                <tbody>
                  {performance.map((row) => (
                    <tr key={row.pair}><td>{row.pair}</td><td>{(row.profit_pct * 100)?.toFixed(2)}%</td><td>{row.count}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">No performance data.</p>}
          </section>
          {stats && (
            <section className="freqtrade-card ft-span-2">
              <h2>Exit reasons</h2>
              <pre className="cli-block">{JSON.stringify(stats, null, 2)}</pre>
            </section>
          )}
        </div>
      )}

      {!compact && tab === 'logs' && (
        <section className="freqtrade-card">
          <h2>Bot logs</h2>
          <pre className="ft-log-view">{logs?.logs?.join('\n') || 'No logs.'}</pre>
        </section>
      )}

      {!compact && tab === 'system' && (
        <div className="freqtrade-grid">
          <section className="freqtrade-card">
            <h2>Health</h2>
            <pre className="cli-block">{JSON.stringify(health, null, 2)}</pre>
          </section>
          <section className="freqtrade-card">
            <h2>Version</h2>
            <pre className="cli-block">{JSON.stringify(version, null, 2)}</pre>
          </section>
          <section className="freqtrade-card">
            <h2>System</h2>
            <pre className="cli-block">{JSON.stringify(sysinfo, null, 2)}</pre>
          </section>
        </div>
      )}

      {!compact && tab === 'overview' && closedTrades?.trades?.length > 0 && (
        <section className="freqtrade-card" style={{ marginTop: 16 }}>
          <h2>Recent closed</h2>
          <table className="data-table">
            <thead><tr><th>Pair</th><th>Profit</th><th>Close date</th></tr></thead>
            <tbody>
              {closedTrades.trades.slice(0, 8).map((t) => (
                <tr key={t.trade_id}>
                  <td>{t.pair}</td>
                  <td className={t.profit_ratio >= 0 ? 'green-text' : 'red-text'}>{(t.profit_ratio * 100)?.toFixed(2)}%</td>
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
