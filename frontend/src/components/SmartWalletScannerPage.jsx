import { useCallback, useEffect, useState } from 'react';
import {
  fetchWalletScannerStatus,
  fetchWalletScannerWallets,
  fetchWalletScannerSignals,
  fetchWalletScannerDuneStatus,
  fetchWalletScannerDune,
  startWalletScanner,
  stopWalletScanner,
  runWalletScannerScan,
  refreshWalletScannerWallets,
  runWalletScannerDaily,
} from '../services/api';

function fmtTime(iso) {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function QueryStatusBadge({ ok }) {
  return (
    <span className={ok ? 'green-text' : 'red-text'}>{ok ? 'OK' : 'Failed'}</span>
  );
}

export default function SmartWalletScannerPage() {
  const [status, setStatus] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [signals, setSignals] = useState([]);
  const [dune, setDune] = useState(null);
  const [lastFetchReport, setLastFetchReport] = useState(null);
  const [tab, setTab] = useState('dune');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fetchingDune, setFetchingDune] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    setErr('');
    try {
      const [st, wl, sig, duneSt] = await Promise.all([
        fetchWalletScannerStatus(),
        fetchWalletScannerWallets({ limit: 100 }),
        fetchWalletScannerSignals(30),
        fetchWalletScannerDuneStatus(),
      ]);
      setStatus(st);
      setWallets(wl.wallets || []);
      setSignals(sig.signals || []);
      setDune(duneSt);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const act = async (fn, ok) => {
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      await fn();
      setMsg(ok);
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runDuneFetch = async () => {
    setFetchingDune(true);
    setMsg('');
    setErr('');
    setLastFetchReport(null);
    try {
      const report = await fetchWalletScannerDune();
      setLastFetchReport(report);
      const okCount = Object.values(report.fetch || {}).filter((q) => q.ok).length;
      const total = Object.keys(report.fetch || {}).length;
      setMsg(`Dune updated — ${okCount}/${total} queries OK · ${report.walletRegistry?.count ?? 0} wallets in registry`);
      await refresh();
    } catch (e) {
      setErr(e.message);
    } finally {
      setFetchingDune(false);
    }
  };

  const cfg = status?.config;
  const rules = cfg?.rules || status?.config?.rules;
  const duneCfg = cfg?.dune || {};
  const busyAny = busy || fetchingDune;

  if (loading) return <div className="page-loading">Loading wallet scanner…</div>;

  const fetchRows = lastFetchReport?.fetch
    ? Object.entries(lastFetchReport.fetch)
    : [];

  return (
    <div className="wallet-scanner-page">
      <header className="page-header">
        <div>
          <h1>Profitable Wallet Scanner</h1>
          <p className="muted">
            Fetch smart wallets from Dune (Solana + TRON) · score · consensus alerts
          </p>
        </div>
        <div className="freqtrade-actions">
          <button type="button" className="primary-btn" onClick={refresh} disabled={busyAny}>Refresh</button>
          {!status?.running ? (
            <button type="button" className="primary-btn" disabled={busyAny} onClick={() => act(startWalletScanner, 'Scanner started')}>Start</button>
          ) : (
            <button type="button" className="primary-btn" disabled={busyAny} onClick={() => act(stopWalletScanner, 'Scanner stopped')}>Stop</button>
          )}
          <button type="button" className="primary-btn" disabled={busyAny} onClick={() => act(runWalletScannerScan, 'Full scan complete')}>Scan now</button>
          <button type="button" className="primary-btn" disabled={busyAny} onClick={() => act(runWalletScannerDaily, 'Daily maintenance done')}>Daily cleanup</button>
        </div>
      </header>

      {err && <div className="tester-error">{err}</div>}
      {msg && <div className="tester-hint">{msg}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Status</span>
          <span className={`stat-value ${status?.running ? 'green-text' : ''}`}>{status?.running ? 'Running' : 'Stopped'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Registry wallets</span>
          <span className="stat-value">{dune?.registry?.count ?? status?.wallet_count ?? 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Qualified</span>
          <span className="stat-value">{status?.qualified_count ?? 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Buy trades cached</span>
          <span className="stat-value">{dune?.trades_cache?.count ?? 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Consensus signals</span>
          <span className="stat-value">{status?.signal_count ?? 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Last Dune sync</span>
          <span className="stat-value small">{fmtTime(dune?.registry?.updated_at)}</span>
        </div>
      </div>

      <div className="ft-tabs">
        {['dune', 'wallets', 'signals'].map((t) => (
          <button key={t} type="button" className={`ft-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'dune' ? 'Dune Data' : t === 'wallets' ? 'Top wallets' : 'Consensus signals'}
          </button>
        ))}
      </div>

      {tab === 'dune' && (
        <section className="freqtrade-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0 }}>Dune data sync</h2>
              <p className="muted small" style={{ marginTop: 6 }}>
                Fetches latest results from all configured Dune queries, stores JSON locally, and rebuilds the wallet registry.
              </p>
            </div>
            <button
              type="button"
              className="primary-btn"
              disabled={busyAny || !dune?.configured}
              onClick={runDuneFetch}
              style={{ minWidth: 180 }}
            >
              {fetchingDune ? 'Fetching from Dune…' : 'Update from Dune'}
            </button>
          </div>

          {!dune?.configured && (
            <p className="tester-error">DUNE_API_KEY not configured on server.</p>
          )}

          {dune?.registry?.by_chain && Object.keys(dune.registry.by_chain).length > 0 && (
            <div className="stats-grid" style={{ marginBottom: 16 }}>
              {Object.entries(dune.registry.by_chain).map(([chain, count]) => (
                <div key={chain} className="stat-card">
                  <span className="stat-label">{chain}</span>
                  <span className="stat-value">{count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          <table className="data-table">
            <thead>
              <tr>
                <th>Query</th>
                <th>ID</th>
                <th>Chain</th>
                <th>Type</th>
                <th>Status</th>
                <th>Rows</th>
                <th>Size</th>
                <th>Last fetch</th>
              </tr>
            </thead>
            <tbody>
              {(dune?.queries || []).length === 0 ? (
                <tr><td colSpan={8} className="muted">No stored queries yet — click Update from Dune</td></tr>
              ) : dune.queries.map((q) => (
                <tr key={q.query_id}>
                  <td>{q.label}</td>
                  <td>
                    <a href={`https://dune.com/queries/${q.query_id}`} target="_blank" rel="noreferrer">{q.query_id}</a>
                  </td>
                  <td>{q.chain}</td>
                  <td>{q.type}</td>
                  <td><QueryStatusBadge ok={q.ok} /></td>
                  <td>{q.rows?.toLocaleString() ?? '—'}</td>
                  <td>{q.file_size_kb ? `${q.file_size_kb} KB` : '—'}</td>
                  <td className="small">{fmtTime(q.fetched_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(dune?.queries || []).some((q) => q.error) && (
            <div style={{ marginTop: 8 }}>
              {(dune.queries.filter((q) => q.error).map((q) => (
                <p key={q.query_id} className="muted small red-text">{q.label} ({q.query_id}): {q.error}</p>
              )))}
            </div>
          )}

          {!duneCfg.solWalletsQueryId && !duneCfg.solTradesQueryId && (
            <p className="muted small" style={{ marginTop: 12 }}>
              Sol wallet stats (3623302) and top trades (3641832) belong to another Dune user.
              {' '}<a href="https://dune.com/maditim/solmemecoinstradewallets" target="_blank" rel="noreferrer">Fork the dashboard</a>
              {' '}on dune.com → run each query → set{' '}
              <code>DUNE_SOL_WALLETS_QUERY_ID</code> and <code>DUNE_SOL_TRADES_QUERY_ID</code> in server env.
              TRON + recent Sol trades (3641835) work without forking.
            </p>
          )}

          {lastFetchReport && fetchRows.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3>Last fetch result</h3>
              <dl className="metrics-list">
                <div className="metric-row"><dt>Wallets imported</dt><dd>{lastFetchReport.import?.wallets ?? 0}</dd></div>
                <div className="metric-row"><dt>Buy trades cached</dt><dd>{lastFetchReport.import?.trades ?? 0}</dd></div>
                <div className="metric-row"><dt>Registry total</dt><dd>{lastFetchReport.walletRegistry?.count ?? 0}</dd></div>
              </dl>
              <table className="data-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr><th>Label</th><th>Query</th><th>Result</th><th>Rows</th></tr>
                </thead>
                <tbody>
                  {fetchRows.map(([label, r]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{r.query_id}</td>
                      <td><QueryStatusBadge ok={r.ok} /></td>
                      <td>{r.ok ? r.rows : (r.error || '—')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details style={{ marginTop: 20 }}>
            <summary className="muted small">Configured query IDs (env)</summary>
            <dl className="metrics-list" style={{ marginTop: 8 }}>
              <div className="metric-row"><dt>Sol wallets</dt><dd>{duneCfg.solWalletsQueryId || <span className="muted">not set (fork required)</span>}</dd></div>
              <div className="metric-row"><dt>Sol trades</dt><dd>{duneCfg.solTradesQueryId || <span className="muted">not set (fork required)</span>}</dd></div>
              <div className="metric-row"><dt>Sol recent trades</dt><dd>{duneCfg.solTradesRecentQueryId || '3641835'}</dd></div>
              <div className="metric-row"><dt>Sol token list</dt><dd>{duneCfg.solTokensQueryId || '7714204'}</dd></div>
              <div className="metric-row"><dt>TRON wallets</dt><dd>{duneCfg.tronWalletsQueryId || '—'}</dd></div>
              <div className="metric-row"><dt>TRON trades</dt><dd>{duneCfg.tronTradesQueryId || '—'}</dd></div>
              <div className="metric-row"><dt>TRON recent</dt><dd>{duneCfg.tronTradesRecentQueryId || '—'}</dd></div>
              <div className="metric-row"><dt>Base daily stats</dt><dd>{duneCfg.baseDailyStatsQueryId || '—'}</dd></div>
            </dl>
          </details>
        </section>
      )}

      {tab === 'wallets' && (
        <>
          <section className="freqtrade-card" style={{ marginBottom: 16 }}>
            <h2>Filter rules</h2>
            <dl className="metrics-list">
              <div className="metric-row"><dt>Win rate</dt><dd>&gt; {((rules?.minWinRate || 0.55) * 100).toFixed(0)}%</dd></div>
              <div className="metric-row"><dt>90D ROI</dt><dd>&gt; {rules?.minRoi90d || 50}%</dd></div>
              <div className="metric-row"><dt>Profit factor</dt><dd>&gt; {rules?.minProfitFactor || 1.5}</dd></div>
              <div className="metric-row"><dt>Min trades</dt><dd>&gt; {rules?.minTrades || 20}</dd></div>
              <div className="metric-row"><dt>Consensus</dt><dd>{cfg?.consensus?.minWallets || 5}+ wallets, avg score {cfg?.consensus?.minAvgScore || 80}+</dd></div>
              <div className="metric-row"><dt>Liquidity</dt><dd>${((cfg?.liquidity?.minLiquidityUsd || 200000) / 1000).toFixed(0)}k+ liq & vol</dd></div>
            </dl>
            <button
              type="button"
              className="primary-btn"
              disabled={busyAny}
              onClick={() => act(refreshWalletScannerWallets, 'Scored wallets refreshed from stored Dune data')}
            >
              Rescore wallets
            </button>
          </section>
          <section className="freqtrade-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Chain</th>
                  <th>Wallet</th>
                  <th>Win%</th>
                  <th>ROI 90d</th>
                  <th>PF</th>
                  <th>Trades</th>
                  <th>Profit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {wallets.length === 0 ? (
                  <tr><td colSpan={9} className="muted">No wallets yet — run Update from Dune on the Dune Data tab</td></tr>
                ) : wallets.map((w) => (
                  <tr key={w.address}>
                    <td><strong>{w.score}</strong></td>
                    <td>{w.chain || w.metrics?.chain || '—'}</td>
                    <td><code title={w.address}>{w.address.slice(0, 10)}…</code></td>
                    <td>{((w.metrics?.win_rate || 0) * 100).toFixed(1)}%</td>
                    <td className={(w.metrics?.roi_90d || 0) >= 0 ? 'green-text' : 'red-text'}>{w.metrics?.roi_90d?.toFixed(1)}%</td>
                    <td>{w.metrics?.profit_factor?.toFixed(2)}</td>
                    <td>{w.metrics?.trade_count}</td>
                    <td>${Math.round(w.metrics?.profit_usd || 0).toLocaleString()}</td>
                    <td>{w.status}{w.qualified ? ' ✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {tab === 'signals' && (
        <section className="freqtrade-card">
          {signals.length === 0 ? (
            <p className="muted">No consensus signals yet. Scanner checks every 15 min when running.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Token</th>
                  <th>Wallets</th>
                  <th>Avg score</th>
                  <th>Confidence</th>
                  <th>Liquidity</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.id}>
                    <td>{s.created_at?.slice(0, 16)}</td>
                    <td>{s.symbol || s.token_mint?.slice(0, 8)}</td>
                    <td>{s.wallet_count}</td>
                    <td>{s.avg_wallet_score}</td>
                    <td><strong>{s.confidence}</strong></td>
                    <td>${Math.round(s.liquidity?.token?.liquidityUsd || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
