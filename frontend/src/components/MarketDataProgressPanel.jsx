import { useEffect, useState } from 'react';
import { fetchCandleSyncStatus } from '../services/api';
import { isDocumentVisible } from '../lib/clientCache';

function ProgressTrack({ value, className = '', active = false }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  return (
    <div className={`md-progress-track ${active ? 'is-active' : ''} ${className}`}>
      <div className="md-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatusPill({ ok, label }) {
  return (
    <span className={`md-sync-pill ${ok ? 'is-ok' : 'is-warn'}`}>
      {label}
    </span>
  );
}

export default function MarketDataProgressPanel({ onOpenFull }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!isDocumentVisible()) return;
      try {
        const data = await fetchCandleSyncStatus();
        if (!alive) return;
        setStatus(data);
        setError('');
      } catch (err) {
        if (!alive) return;
        setError(err.message || 'OHLCV status unavailable');
      }
    }
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const archives = status?.archives;
  const live = status?.live;
  const archivePct = archives?.global_pct ?? 0;
  const archiveDone = archivePct >= 99 || archives?.global_status === 'complete';
  const archiveRunning = archives?.global_status === 'running' && !archives?.paused;
  const livePct = live?.pct ?? (live?.ok ? 100 : live?.ws_connected ? 40 : 0);

  return (
    <section className="md-progress-section md-progress-compact" aria-labelledby="md-progress-heading">
      <div className="md-progress-header">
        <div>
          <h2 id="md-progress-heading" className="home-section-title">OHLCV data</h2>
          <p className="md-progress-sub">
            Binance Vision archives + live WebSocket candles for SMC v2
          </p>
        </div>
        {onOpenFull && (
          <button type="button" className="md-open-full" onClick={onOpenFull}>
            Market Data →
          </button>
        )}
      </div>

      {error && <div className="home-notice">{error}</div>}

      <div className="md-sync-grid">
        <div className="md-sync-row">
          <div className="md-sync-row-head">
            <span className="md-sync-label">Historical archives</span>
            <StatusPill
              ok={archiveDone}
              label={
                archiveDone
                  ? 'Ready'
                  : archiveRunning
                    ? `Phase ${archives?.current_phase || '—'}/${archives?.total_phases || '—'}`
                    : (archives?.global_status || 'idle')
              }
            />
          </div>
          <ProgressTrack value={archivePct} active={archiveRunning} />
          <p className="md-sync-meta">
            {archives?.ready_symbols ?? 0}/{archives?.total_symbols || archives?.universe_size || 200} pairs ready
            {archiveRunning ? ` · ${archivePct.toFixed(0)}% overall` : ''}
            {archives?.paused ? ' · Paused' : ''}
          </p>
        </div>

        <div className="md-sync-row">
          <div className="md-sync-row-head">
            <span className="md-sync-label">Live candle sync</span>
            <StatusPill
              ok={Boolean(live?.ok)}
              label={live?.ws_connected ? 'WS on' : 'WS off'}
            />
          </div>
          <ProgressTrack
            value={live?.started ? livePct : 0}
            active={Boolean(live?.started && live?.ws_connected && !live?.ok)}
          />
          <p className="md-sync-meta">
            {live?.message || 'Checking…'}
            {live?.ws_timeframes?.length ? ` · ${live.ws_timeframes.join(', ')}` : ''}
          </p>
        </div>
      </div>

      {archives?.last_error && (
        <p className="md-last-error">Archive worker: {archives.last_error}</p>
      )}
    </section>
  );
}
