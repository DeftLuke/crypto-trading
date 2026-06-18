import { useEffect, useMemo, useState } from 'react';
import { fetchControlDashboard } from '../services/researchApi';
import { deferNonCritical } from '../lib/fetchTimeout';
import { ALL_NAV_ITEMS, SERVICE_TO_PAGE } from '../lib/platformUrl';

const FALLBACK_APPS = [
  { id: 'trading', name: 'TradeGPT Trading', phase: 'Core', state: 'running', health: 'healthy', desc: 'Charts, signals, execution dock' },
  { id: 'platform-control', name: 'Control Center', phase: '10', state: 'unknown', health: 'unknown', desc: 'Services, exchanges, approvals' },
  { id: 'platform-telegram-signals', name: 'Telegram Sources', phase: '9', state: 'unknown', health: 'unknown', desc: 'Follow VIP groups and scrape signals' },
  { id: 'platform-paper', name: 'Paper Trading', phase: '7', state: 'unknown', health: 'unknown', desc: 'Simulated positions and risk' },
  { id: 'platform-live', name: 'Live Trading', phase: '8', state: 'unknown', health: 'unknown', desc: 'Exchange execution engine' },
  { id: 'platform-assistant', name: 'AI Assistant', phase: '9', state: 'unknown', health: 'unknown', desc: 'Operations agent and workflows' },
  { id: 'platform-research', name: 'Research Agent', phase: '6', state: 'unknown', health: 'unknown', desc: 'Hypotheses and memory layer' },
  { id: 'wallet-scanner', name: 'Smart Wallets', phase: 'Core', state: 'running', health: 'healthy', desc: 'On-chain wallet scanner' },
  { id: 'platform-system', name: 'System', phase: 'Ops', state: 'unknown', health: 'unknown', desc: 'Health, logs, infrastructure' },
];

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
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      setSyncing(true);
      try {
        const dash = await fetchControlDashboard();
        if (!alive) return;
        setServices(dash.services || []);
        setSettings(dash.settings || null);
        setError('');
      } catch (err) {
        if (alive) setError(err.message || 'Platform API unavailable');
      } finally {
        if (alive) setSyncing(false);
      }
    }
    deferNonCritical(load);
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const cards = useMemo(() => {
    const byPage = new Map();
    for (const svc of services) {
      const pageId = SERVICE_TO_PAGE[svc.service_id] || `platform-${svc.service_id}`;
      const nav = ALL_NAV_ITEMS.find((n) => n.id === pageId);
      byPage.set(pageId, {
        id: pageId,
        name: nav?.label || svc.name,
        phase: svc.phase || '—',
        state: svc.state || 'unknown',
        health: svc.health || 'unknown',
        desc: svc.metadata?.description || nav?.label || svc.name,
      });
    }
    for (const fb of FALLBACK_APPS) {
      if (!byPage.has(fb.id)) byPage.set(fb.id, fb);
    }
    return [...byPage.values()];
  }, [services]);

  const running = cards.filter((c) => c.state === 'running').length;

  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-hero-text">
          <p className="home-kicker">TradeGPT Platform</p>
          <h1>Command center</h1>
          <p className="home-sub">
            {syncing && services.length === 0 ? 'Syncing platform status…' : `${running} of ${cards.length} modules active`}
            {settings?.auto_trading && ' · Auto-trade enabled'}
          </p>
        </div>
        <div className="home-hero-stats">
          <div className="hero-stat"><span className="hero-stat-val">{running}</span><span className="hero-stat-label">Running</span></div>
          <div className="hero-stat"><span className="hero-stat-val">{cards.length - running}</span><span className="hero-stat-label">Idle</span></div>
          <div className="hero-stat"><span className="hero-stat-val cap">{settings?.mode || 'demo'}</span><span className="hero-stat-label">Mode</span></div>
        </div>
      </section>

      {error && <div className="home-notice">Platform status limited — {error}. Core trading still works.</div>}

      <section className="home-services" aria-labelledby="services-heading">
        <h2 id="services-heading" className="home-section-title">All services</h2>
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
    </div>
  );
}
