import { useEffect, useState } from 'react';
import { fetchTradesByDay } from '../services/api';
import { readClientCache, writeClientCache } from '../lib/clientCache';

function fmtUsd(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${v.toFixed(2)}`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fmtDayTitle(day) {
  if (!day) return 'Trades';
  const localToday = new Date().toLocaleDateString('en-CA');
  if (day === localToday) return `Today · ${day}`;
  return day;
}

export default function DailyTradesModal({ day, dayLabel, initialFilter = 'all', onClose }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState(initialFilter);

  useEffect(() => {
    if (!day) return undefined;
    let alive = true;
    const cacheKey = `trades-day:${day}`;
    const cached = readClientCache(cacheKey, 120000);
    if (cached) {
      setPayload(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    async function load() {
      try {
        const data = await fetchTradesByDay(day);
        if (!alive) return;
        writeClientCache(cacheKey, data);
        setPayload(data);
        setError('');
      } catch (err) {
        if (!alive) return;
        if (!cached) setError(err.message || 'Could not load trades');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [day]);

  useEffect(() => {
    setFilter(initialFilter);
  }, [day, initialFilter]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!day) return null;

  const summary = payload?.summary;
  const trades = payload?.trades || [];
  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win && (t.net_profit ?? 0) < 0);
  const visible = filter === 'wins' ? wins : filter === 'losses' ? losses : trades;

  return (
    <div className="daily-trades-overlay" onClick={onClose} role="presentation">
      <div
        className="daily-trades-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="daily-trades-title"
      >
        <header className="daily-trades-header">
          <div>
            <p className="daily-trades-kicker">Daily trade audit</p>
            <h2 id="daily-trades-title">{fmtDayTitle(dayLabel || day)}</h2>
            {summary && (
              <p className="daily-trades-sub">
                {summary.closed} closed · {summary.wins}W / {summary.losses}L · {fmtUsd(summary.net_profit)} net
                {summary.win_rate != null ? ` · ${summary.win_rate}% win rate` : ''}
              </p>
            )}
          </div>
          <button type="button" className="daily-trades-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {summary && trades.length > 0 && (
          <div className="daily-trades-filters">
            <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              All ({trades.length})
            </button>
            <button type="button" className={`win-tab ${filter === 'wins' ? 'active' : ''}`} onClick={() => setFilter('wins')}>
              Wins ({wins.length})
            </button>
            <button type="button" className={`loss-tab ${filter === 'losses' ? 'active' : ''}`} onClick={() => setFilter('losses')}>
              Losses ({losses.length})
            </button>
          </div>
        )}

        {loading && !trades.length && <p className="daily-trades-loading">Loading trades from database…</p>}
        {error && <p className="home-notice">{error}</p>}

        {!loading && !error && trades.length === 0 && (
          <p className="daily-trades-empty">No closed trades on this date.</p>
        )}

        {trades.length > 0 && (
          <div className="daily-trades-table-wrap">
            <table className="daily-trades-table">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Symbol</th>
                  <th>Dir</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>Net PnL</th>
                  <th>R</th>
                  <th>Closed</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id || t.trade_id} className={t.win ? 'row-win' : 'row-loss'}>
                    <td><span className={`result-pill ${t.win ? 'win' : 'loss'}`}>{t.win ? 'WIN' : 'LOSS'}</span></td>
                    <td><strong>{t.symbol}</strong></td>
                    <td>{t.direction}</td>
                    <td>{t.entry_price ?? '—'}</td>
                    <td>{t.exit_price ?? '—'}</td>
                    <td className={t.net_profit >= 0 ? 'pos' : 'neg'}>{fmtUsd(t.net_profit)}</td>
                    <td>{t.r_multiple != null ? `${Number(t.r_multiple).toFixed(2)}R` : '—'}</td>
                    <td>{fmtTime(t.closed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && (
              <p className="daily-trades-empty">No {filter === 'wins' ? 'winning' : 'losing'} trades on this date.</p>
            )}
          </div>
        )}

        {trades.length > 0 && filter === 'all' && (
          <details className="daily-trades-details">
            <summary>Full detail ({trades.length} trades)</summary>
            <div className="daily-trades-cards">
              {trades.map((t) => (
                <article key={`${t.id}-detail`} className="daily-trade-card">
                  <div className="daily-trade-card-top">
                    <strong>{t.symbol}</strong>
                    <span>{t.direction}</span>
                    <span className={t.win ? 'pos' : 'neg'}>{fmtUsd(t.net_profit)}</span>
                  </div>
                  <dl className="daily-trade-dl">
                    <div><dt>Opened</dt><dd>{fmtTime(t.opened_at)}</dd></div>
                    <div><dt>Closed</dt><dd>{fmtTime(t.closed_at)}</dd></div>
                    <div><dt>Entry / Exit</dt><dd>{t.entry_price ?? '—'} → {t.exit_price ?? '—'}</dd></div>
                    <div><dt>Stop loss</dt><dd>{t.stop_loss ?? '—'}</dd></div>
                    <div><dt>TP levels</dt><dd>{[t.tp1, t.tp2, t.tp3].filter(Boolean).join(' / ') || '—'}</dd></div>
                    <div><dt>Qty</dt><dd>{t.quantity ?? '—'}</dd></div>
                    <div><dt>Gross / Fees</dt><dd>{fmtUsd(t.gross_profit)} / {fmtUsd(t.fees)}</dd></div>
                    <div><dt>Legacy est.</dt><dd>{fmtUsd(t.legacy_pnl)}</dd></div>
                    <div><dt>Close reason</dt><dd>{t.close_reason || '—'}</dd></div>
                    <div><dt>Lifecycle</dt><dd>{t.lifecycle_stage || '—'}</dd></div>
                    <div><dt>Strategy</dt><dd>{t.strategy_name || '—'}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
