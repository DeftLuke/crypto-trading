import { useEffect, useState } from 'react';
import { fetchTrades, fetchOpenTrades } from '../services/api';

export default function TradesPanel({ bare = false }) {
  const [trades, setTrades] = useState([]);
  const [openTrades, setOpenTrades] = useState([]);

  useEffect(() => {
    loadTrades();
    const interval = setInterval(loadTrades, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadTrades() {
    try {
      const [all, open] = await Promise.all([fetchTrades(10), fetchOpenTrades()]);
      setTrades(Array.isArray(all) ? all : []);
      setOpenTrades(Array.isArray(open) ? open : []);
    } catch {
      setTrades([]);
      setOpenTrades([]);
    }
  }

  const inner = (
    <>
      <h3>Open Trades ({openTrades.length})</h3>
      {openTrades.map((t) => (
        <div key={t.id} className="trade-row">
          <span>
            <strong>{t.symbol}</strong> {t.direction}
            <br />
            <span style={{ color: '#8b949e' }}>
              Entry: {t.entry_price} | SL: {t.stop_loss}
            </span>
          </span>
          <span>
            {t.tp1_hit && '✅ TP1 '}
            {t.tp2_hit && '✅ TP2 '}
            {t.sl_moved_breakeven && '🛡 BE '}
          </span>
        </div>
      ))}

      <h3 style={{ marginTop: 16 }}>Recent Trades</h3>
      {trades.filter((t) => t.status === 'closed' || t.status === 'stopped').map((t) => (
        <div key={t.id} className="trade-row">
          <span>
            {t.symbol} {t.direction}
          </span>
          <span className={t.pnl >= 0 ? 'trade-pnl-positive' : 'trade-pnl-negative'}>
            {t.pnl ? `${t.pnl >= 0 ? '+' : ''}${parseFloat(t.pnl).toFixed(2)} USDT` : t.status}
            {t.r_multiple ? ` (${parseFloat(t.r_multiple).toFixed(1)}R)` : ''}
          </span>
        </div>
      ))}
    </>
  );

  if (bare) return inner;
  return <div className="panel">{inner}</div>;
}
