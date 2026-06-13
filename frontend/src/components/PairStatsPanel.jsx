import { useEffect, useState } from 'react';
import { fetchPairStats, fetchBalance } from '../services/api';

export default function PairStatsPanel() {
  const [stats, setStats] = useState([]);
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      const [pairData, bal] = await Promise.all([fetchPairStats(), fetchBalance()]);
      setStats(Array.isArray(pairData) ? pairData : []);
      setBalance(bal);
    } catch {
      setStats([]);
    }
  }

  const topPairs = stats
    .filter((s) => s.total_trades > 0)
    .sort((a, b) => b.strategy_score - a.strategy_score)
    .slice(0, 8);

  return (
    <>
      <div className="panel balance-card">
        <div className="balance-amount">
          {balance ? `${parseFloat(balance.available || 0).toFixed(2)}` : '—'}
        </div>
        <div className="balance-label">USDT Available</div>
      </div>

      <div className="panel">
        <h3>Pair Performance (AI Memory)</h3>
        {topPairs.length === 0 && (
          <p className="signal-detail">No trade history yet. Stats will populate after trades.</p>
        )}
        {topPairs.map((p) => (
          <div key={p.symbol} className="pair-stat-row">
            <span>{p.symbol}</span>
            <span>
              {parseFloat(p.win_rate || 0).toFixed(0)}% WR | Score: {parseFloat(p.strategy_score).toFixed(0)}
            </span>
            <div className="score-bar">
              <div
                className="score-fill"
                style={{
                  width: `${p.strategy_score}%`,
                  background: p.strategy_score >= 60 ? '#3fb950' : p.strategy_score >= 40 ? '#d29922' : '#f85149',
                }}
              />
            </div>
          </div>
        ))}

        <h3 style={{ marginTop: 16 }}>All Pairs Score</h3>
        {stats.slice(0, 10).map((p) => (
          <div key={p.symbol} className="pair-stat-row">
            <span>{p.symbol.replace('USDT', '')}</span>
            <span style={{ color: p.strategy_score >= 50 ? '#3fb950' : '#8b949e' }}>
              {parseFloat(p.strategy_score).toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
