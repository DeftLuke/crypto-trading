import { useEffect, useState } from 'react';
import { fetchStrategyStats, fetchLearnedPatterns } from '../services/api';

export default function StrategyStatsPage() {
  const [stats, setStats] = useState(null);
  const [patterns, setPatterns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, p] = await Promise.all([
          fetchStrategyStats(),
          fetchLearnedPatterns(30),
        ]);
        setStats(s);
        setPatterns(p);
      } catch {
        /* ignore */
      }
      setLoading(false);
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <div className="page-loading">Loading strategy stats…</div>;
  if (!stats) return <div className="page-loading">No stats available yet.</div>;

  const t = stats.trades || {};

  return (
    <div className="strategy-stats-page">
      <header className="page-header">
        <h2>Strategy Performance</h2>
        <span className="page-sub">SMC Multi-Timeframe — live stats & lessons</span>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total Trades</span>
          <span className="stat-value">{t.total || 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Open</span>
          <span className="stat-value">{t.open || 0}</span>
        </div>
        <div className="stat-card green">
          <span className="stat-label">Wins</span>
          <span className="stat-value">{t.wins || 0}</span>
        </div>
        <div className="stat-card red">
          <span className="stat-label">Losses</span>
          <span className="stat-value">{t.losses || 0}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Win Rate</span>
          <span className="stat-value">{t.winRate?.toFixed(1) || 0}%</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">P/L Ratio</span>
          <span className="stat-value">{t.profitLossRatio?.toFixed(2) || '—'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total PnL</span>
          <span className={`stat-value ${(t.totalPnl || 0) >= 0 ? 'green-text' : 'red-text'}`}>
            {(t.totalPnl || 0).toFixed(2)} USDT
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
          <h3>Learned Patterns (avoid / favor)</h3>
          <div className="patterns-list">
            {patterns.length === 0 && <p className="muted">No patterns learned yet — trades will teach the agent.</p>}
            {patterns.map((p) => (
              <div key={p.id} className={`pattern-row ${p.pattern_type}`}>
                <span className="pattern-badge">{p.pattern_type}</span>
                <span>{p.symbol || p.pattern_key}</span>
                <span className="muted">W:{p.win_count} L:{p.loss_count}</span>
                <span className="pattern-reason">{p.reason?.slice(0, 80)}</span>
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
    </div>
  );
}
