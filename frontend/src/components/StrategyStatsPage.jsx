import { useEffect, useState } from 'react';
import { fetchStrategyStats, fetchLearnedPatterns, fetchStrategies } from '../services/api';

export default function StrategyStatsPage() {
  const [strategyId, setStrategyId] = useState('smc-mtf');
  const [strategies, setStrategies] = useState([]);
  const [stats, setStats] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStrategies()
      .then((items) => setStrategies((items || []).filter((s) => s.id !== 'freqtrade')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [s, p] = await Promise.all([
          fetchStrategyStats(strategyId),
          strategyId === 'smc-mtf' ? fetchLearnedPatterns(30) : Promise.resolve([]),
        ]);
        setStats(s);
        setPatterns(p);
      } catch {
        setStats(null);
      }
      setLoading(false);
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [strategyId]);

  const selected = strategies.find((s) => s.id === strategyId);

  return (
    <div className="strategy-stats-page">
      <header className="page-header">
        <div>
          <h2>Strategy Control</h2>
          <span className="page-sub">Stats, bot control, and performance</span>
        </div>
        <div className="toolbar-field toolbar-field-strategy">
          <label className="toolbar-label">Strategy</label>
          <select
            className="toolbar-select"
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
          >
            {(strategies.length ? strategies : [{ id: 'smc-mtf', name: 'SMC Multi-Timeframe' }]).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </header>

      {selected?.description && (
        <p className="toolbar-strategy-desc">{selected.description}</p>
      )}

      {loading && <div className="page-loading">Loading…</div>}

      {!loading && stats && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">Total Trades</span>
              <span className="stat-value">{stats.trades?.total || 0}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Open</span>
              <span className="stat-value">{stats.trades?.open || 0}</span>
            </div>
            <div className="stat-card green">
              <span className="stat-label">Wins</span>
              <span className="stat-value">{stats.trades?.wins || 0}</span>
            </div>
            <div className="stat-card red">
              <span className="stat-label">Losses</span>
              <span className="stat-value">{stats.trades?.losses || 0}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Win Rate</span>
              <span className="stat-value">{stats.trades?.winRate?.toFixed(1) || 0}%</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">P/L Ratio</span>
              <span className="stat-value">{stats.trades?.profitLossRatio?.toFixed(2) || '—'}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total PnL</span>
              <span className={`stat-value ${(stats.trades?.totalPnl || 0) >= 0 ? 'green-text' : 'red-text'}`}>
                {(stats.trades?.totalPnl || 0).toFixed(2)} USDT
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Patterns Learned</span>
              <span className="stat-value">{stats.patterns?.total || 0}</span>
            </div>
          </div>

          <div className="stats-sections">
            <section className="stats-section">
              <h3>Lesson Breakdown</h3>
              <div className="lesson-breakdown">
                {Object.entries(stats.lessons || {}).map(([type, data]) => (
                  <div key={type} className="lesson-type-card">
                    <strong>{type}</strong>
                    <span>✅ {data.wins || 0} wins</span>
                    <span>❌ {data.losses || 0} losses</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="stats-section">
              <h3>Learned Patterns</h3>
              <div className="patterns-list">
                {patterns.length === 0 && <p className="muted">No patterns yet.</p>}
                {patterns.map((p) => (
                  <div key={p.id} className={`pattern-row ${p.pattern_type}`}>
                    <span className="pattern-badge">{p.pattern_type}</span>
                    <span>{p.symbol || p.pattern_key}</span>
                    <span className="muted">W:{p.win_count} L:{p.loss_count}</span>
                  </div>
                ))}
              </div>
            </section>

            {stats.recentBacktests?.length > 0 && (
              <section className="stats-section">
                <h3>Recent Backtests</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>TF</th>
                      <th>Trades</th>
                      <th>WR</th>
                      <th>PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentBacktests.map((b) => (
                      <tr key={b.id}>
                        <td>{b.symbol}</td>
                        <td>{b.timeframe}</td>
                        <td>{b.total_trades}</td>
                        <td>{parseFloat(b.win_rate || 0).toFixed(1)}%</td>
                        <td>{parseFloat(b.total_pnl || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
