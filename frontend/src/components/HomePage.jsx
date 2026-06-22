import { useEffect, useMemo, useState } from 'react';
import { fetchDashboardSnapshot } from '../services/api';
import { readClientCache, writeClientCache, isDocumentVisible } from '../lib/clientCache';
import { deferNonCritical } from '../lib/fetchTimeout';
import { ALL_NAV_ITEMS, SERVICE_TO_PAGE } from '../lib/platformUrl';
import MarketDataProgressPanel from './MarketDataProgressPanel';
import DailyTradesModal from './DailyTradesModal';
import ScannerStatusCard from './ScannerStatusCard';

const FALLBACK_APPS = [
  { id: 'trading', name: 'TradeGPT Trading', phase: 'Core', state: 'running', health: 'healthy', desc: 'Charts, signals, execution dock' },
  { id: 'platform-control', name: 'Control Center', phase: '10', state: 'unknown', health: 'unknown', desc: 'Services, exchanges, approvals' },
  { id: 'platform-telegram-signals', name: 'Telegram Sources', phase: '9', state: 'unknown', health: 'unknown', desc: 'Follow VIP groups and scrape signals' },
  { id: 'platform-paper', name: 'Paper Trading', phase: '7', state: 'unknown', health: 'unknown', desc: 'Simulated positions and risk' },
  { id: 'platform-live', name: 'Live Trading', phase: '8', state: 'unknown', health: 'unknown', desc: 'Exchange execution engine' },
  { id: 'wallet-scanner', name: 'Smart Wallets', phase: 'Core', state: 'running', health: 'healthy', desc: 'On-chain wallet scanner' },
];

const FLOW_STAGES = [
  { key: 'open', label: 'OPEN' },
  { key: 'after_tp1', label: 'TP1' },
  { key: 'after_tp2', label: 'TP2' },
  { key: 'desync', label: 'SYNC' },
];

function snapshotCacheKey() {
  const day = new Date().toLocaleDateString('en-CA');
  const tz = -new Date().getTimezoneOffset();
  return `snapshot:${day}:${tz}`;
}

function applySnapshot(setters, snap) {
  if (!snap) return;
  if (snap.trade) setters.setTradeDash(snap.trade);
  if (snap.control?.services) setters.setServices(snap.control.services);
  if (snap.settings || snap.control?.settings) setters.setSettings(snap.settings || snap.control.settings);
}

function fmtUsd(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${v.toFixed(2)}`;
}

function fmtDay(label) {
  if (!label) return '—';
  const d = new Date(`${label}T12:00:00Z`);
  const utcToday = new Date().toISOString().slice(0, 10);
  const localToday = new Date().toLocaleDateString('en-CA');
  if (label === localToday) return 'Today';
  if (label === utcToday && label !== localToday) return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} (UTC)`;
  const y = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  if (label === y) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATE_RANK = { running: 4, degraded: 3, paused: 2, stopped: 1, unknown: 0 };
const HEALTH_RANK = { healthy: 4, degraded: 3, unhealthy: 2, failed: 1, unknown: 0 };

function mergeServiceCard(prev, next) {
  if (!prev) return next;
  const pick = (a, b, rank) => ((rank[b] ?? 0) >= (rank[a] ?? 0) ? b : a);
  return {
    ...next,
    name: prev.name || next.name,
    state: pick(prev.state, next.state, STATE_RANK),
    health: pick(prev.health, next.health, HEALTH_RANK),
  };
}

function stateClass(state) {
  if (state === 'running') return 'is-running';
  if (state === 'stopped' || state === 'paused') return 'is-stopped';
  return 'is-unknown';
}

function healthClass(health) {
  if (health === 'healthy') return 'health-ok';
  if (health === 'degraded') return 'health-warn';
  if (health === 'unhealthy' || health === 'failed') return 'health-bad';
  return 'health-unknown';
}

export default function HomePage({ onNavigate }) {
  const [services, setServices] = useState([]);
  const [settings, setSettings] = useState(null);
  const [tradeDash, setTradeDash] = useState(null);
  const [tradeLoading, setTradeLoading] = useState(true);
  const [tradeError, setTradeError] = useState('');
  const [error, setError] = useState('');
  const [viewDay, setViewDay] = useState(null);
  const [viewDayLabel, setViewDayLabel] = useState('');
  const [viewFilter, setViewFilter] = useState('all');

  function openDayTrades(row, filter = 'all') {
    setViewDay(row.day);
    setViewDayLabel(fmtDay(row.day));
    setViewFilter(filter);
  }

  useEffect(() => {
    let alive = true;
    let initial = true;
    const setters = { setTradeDash, setServices, setSettings };

    async function loadSnapshot() {
      if (!isDocumentVisible()) return;

      const cacheKey = snapshotCacheKey();
      const cached = readClientCache(cacheKey, 45000);
      if (cached && initial) {
        applySnapshot(setters, cached);
        setTradeLoading(false);
      } else if (initial && !cached) {
        setTradeLoading(true);
      }

      try {
        const snap = await fetchDashboardSnapshot();
        if (!alive) return;
        writeClientCache(cacheKey, snap);
        applySnapshot(setters, snap);
        setTradeError('');
        setError('');
      } catch (err) {
        if (!alive) return;
        if (!cached) {
          setTradeError(err.message || 'Dashboard unavailable');
          setError(err.message || 'Platform API unavailable');
        }
      } finally {
        initial = false;
        if (alive) setTradeLoading(false);
      }
    }

    deferNonCritical(loadSnapshot);
    const id = setInterval(loadSnapshot, 60000);
    const onVisible = () => { if (isDocumentVisible()) loadSnapshot(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const cards = useMemo(() => {
    const byPage = new Map();
    for (const svc of services) {
      const pageId = SERVICE_TO_PAGE[svc.service_id] || `platform-${svc.service_id}`;
      const nav = ALL_NAV_ITEMS.find((n) => n.id === pageId);
      byPage.set(pageId, mergeServiceCard(byPage.get(pageId), {
        id: pageId,
        name: nav?.label || svc.name,
        phase: svc.phase || '—',
        state: svc.state || 'unknown',
        health: svc.health || 'unknown',
        desc: svc.metadata?.description || nav?.label || svc.name,
      }));
    }
    for (const fb of FALLBACK_APPS) {
      if (!byPage.has(fb.id)) byPage.set(fb.id, fb);
    }
    return [...byPage.values()];
  }, [services]);

  const running = cards.filter((c) => c.state === 'running').length;
  const today = tradeDash?.today;
  const daily = tradeDash?.daily || [];
  const openAudit = tradeDash?.open;
  const lc = openAudit?.lifecycle_counts || {};

  return (
    <div className="home-page">
      <section className="home-hero home-hero-compact">
        <div className="home-hero-text">
          <p className="home-kicker">Trade Execution Audit</p>
          <h1>Performance</h1>
          <p className="home-sub">
            {today
              ? `Today (${today.day}): ${today.closed} closed · ${today.wins}W / ${today.losses}L · ${fmtUsd(today.net_profit)} net`
              : tradeLoading
                ? 'Loading…'
                : tradeError || 'No closed trades today'}
          </p>
        </div>
        <div className="home-hero-stats">
          <div className="hero-stat">
            <span className={`hero-stat-val ${(today?.net_profit ?? 0) >= 0 ? 'pos' : 'neg'}`}>
              {today ? fmtUsd(today.net_profit) : '—'}
            </span>
            <span className="hero-stat-label">Net today</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-val">{openAudit?.total ?? '—'}</span>
            <span className="hero-stat-label">Open audited</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-val">{today?.win_rate != null ? `${today.win_rate}%` : '—'}</span>
            <span className="hero-stat-label">Win rate</span>
          </div>
        </div>
      </section>

      {tradeError && (
        <div className="home-notice">{tradeError}. Legacy PnL may still show in trades list.</div>
      )}
      {error && !tradeError && <div className="home-notice">Platform status limited — {error}</div>}

      <MarketDataProgressPanel onOpenFull={() => onNavigate('platform-market-data')} />

      <ScannerStatusCard />

      {daily.length > 0 && (
        <section className="trade-perf-section">
          <h2 className="home-section-title">Daily performance</h2>
          <p className="home-section-hint muted">Click <strong>View trades</strong> or the W/L counts to see every trade for that day.</p>
          <div className="trade-perf-table-wrap">
            <table className="trade-perf-table trade-perf-table-daily">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Closed</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Net PnL</th>
                  <th>Legacy est.</th>
                  <th>Exchange sync</th>
                  <th className="daily-view-col">Trades</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((row) => (
                  <tr key={row.day} className={row.closed > 0 ? 'daily-row-clickable' : ''}>
                    <td>{fmtDay(row.day)}</td>
                    <td>{row.closed}</td>
                    <td className="pos">
                      {row.wins > 0 ? (
                        <button type="button" className="daily-count-btn pos" onClick={() => openDayTrades(row, 'wins')}>
                          {row.wins}
                        </button>
                      ) : row.wins}
                    </td>
                    <td className="neg">
                      {row.losses > 0 ? (
                        <button type="button" className="daily-count-btn neg" onClick={() => openDayTrades(row, 'losses')}>
                          {row.losses}
                        </button>
                      ) : row.losses}
                    </td>
                    <td className={(row.net_profit ?? 0) >= 0 ? 'pos' : 'neg'}>{fmtUsd(row.net_profit)}</td>
                    <td className="muted">{fmtUsd(row.legacy_pnl_sum)}</td>
                    <td>
                      <span className={row.exchange_synced_pct >= 80 ? 'sync-ok' : 'sync-warn'}>
                        {row.exchange_synced_pct ?? 0}%
                      </span>
                    </td>
                    <td className="daily-view-cell">
                      {row.closed > 0 ? (
                        <button
                          type="button"
                          className="daily-view-btn"
                          onClick={() => openDayTrades(row, 'all')}
                        >
                          View trades
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {openAudit && (
        <section className="trade-flow-section">
          <h2 className="home-section-title">Open trade lifecycle</h2>
          <div className="trade-flow-pipeline">
            {FLOW_STAGES.map((stage, i) => {
              const count = lc[stage.key] ?? 0;
              const warn = stage.key === 'desync' && count > 0;
              return (
                <div key={stage.key} className="trade-flow-step-wrap">
                  {i > 0 && <div className="trade-flow-connector" />}
                  <div className={`trade-flow-step ${warn ? 'warn' : count > 0 ? 'active' : ''}`}>
                    <span className="trade-flow-count">{count}</span>
                    <span className="trade-flow-label">{stage.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="trade-flow-legend">
            OPEN → SL → TP1 (30%) → BE → TP2 (40%) → RUNNER (30%) → CLOSE
          </div>
          {openAudit.trades?.length > 0 && (
            <div className="open-audit-grid">
              {openAudit.trades.slice(0, 8).map((t) => (
                <div key={t.id} className={`open-audit-card ${t.db_exchange_sync_ok ? '' : 'desync'}`}>
                  <div className="open-audit-top">
                    <strong>{t.symbol}</strong>
                    <span>{t.direction}</span>
                  </div>
                  <div className="open-audit-meta">
                    {t.pct_remaining != null ? `${t.pct_remaining}% left` : '—'}
                    {t.tp1_hit && ' · TP1✓'}
                    {t.sl_moved_breakeven && ' · BE✓'}
                    {t.sl_order ? ' · SL✓' : ' · SL✗'}
                  </div>
                  {!t.db_exchange_sync_ok && <span className="desync-badge">DESYNC</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="home-services" aria-labelledby="services-heading">
        <h2 id="services-heading" className="home-section-title">All services · {running} running</h2>
        <div className="app-card-grid">
          {cards.map((card) => (
            <button key={card.id} type="button" className={`app-card ${stateClass(card.state)}`} onClick={() => onNavigate(card.id)}>
              <div className="app-card-top">
                <span className={`health-dot ${healthClass(card.health)}`} />
                <span className={`state-badge ${stateClass(card.state)}`}>
                  {card.state === 'running' ? 'Running' : card.state === 'stopped' ? 'Stopped' : 'Unknown'}
                </span>
              </div>
              <h3>{card.name}</h3>
              <p>{card.desc}</p>
              <div className="app-card-foot">
                <span className="phase-tag">Phase {card.phase}</span>
                <span className="app-card-go">Open →</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {viewDay && (
        <DailyTradesModal
          day={viewDay}
          dayLabel={viewDayLabel}
          initialFilter={viewFilter}
          onClose={() => { setViewDay(null); setViewDayLabel(''); setViewFilter('all'); }}
        />
      )}
    </div>
  );
}
