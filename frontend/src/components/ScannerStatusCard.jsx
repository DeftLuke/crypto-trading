import { useApp } from '../context/AppContext';

function fmtAgo(iso) {
  if (!iso) return '—';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function scoreClass(score) {
  if (score >= 80) return 'scanner-score-high';
  if (score >= 60) return 'scanner-score-mid';
  return 'scanner-score-low';
}

export default function ScannerStatusCard() {
  const { scannerOn, scannerStatus } = useApp();
  const scanning = Boolean(scannerStatus?.scanning);
  const pct = scannerStatus?.progress_pct ?? 0;
  const scanned = scannerStatus?.pairs_scanned ?? 0;
  const total = scannerStatus?.universe_size ?? 0;
  const bestSymbol = scannerStatus?.best_score_symbol;
  const bestScore = scannerStatus?.best_score ?? 0;
  const bestDir = scannerStatus?.best_score_direction;
  const bestStatus = scannerStatus?.best_score_status;

  return (
    <section className="scanner-status-card">
      <div className="scanner-status-head">
        <div>
          <p className="home-section-title">Signal scanner</p>
          <h3 className="scanner-status-title">Institutional SMC v2</h3>
        </div>
        <span className={`scanner-status-badge ${scannerOn ? 'on' : 'off'}`}>
          {scannerOn ? (scanning ? 'Scanning' : 'Active') : 'Off'}
        </span>
      </div>

      {scanning && (
        <div className="scanner-status-progress">
          <div className="scanner-status-progress-top">
            <span>Analyzing downloaded OHLCV cohort</span>
            <strong>{pct}%</strong>
          </div>
          <div className="scanner-status-track">
            <div className="scanner-status-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted scanner-status-meta">
            {scanned}/{total || '—'} pairs · Python engine
          </p>
        </div>
      )}

      {!scanning && (
        <>
          {bestSymbol && bestScore > 0 && (
            <div className={`scanner-best-score ${scoreClass(bestScore)}`}>
              <span className="scanner-best-label">Top score last scan</span>
              <strong className="scanner-best-symbol">{bestSymbol}</strong>
              <span className="scanner-best-meta">
                {bestScore}/100
                {bestDir ? ` · ${bestDir}` : ''}
                {bestStatus ? ` · ${bestStatus}` : ''}
              </span>
            </div>
          )}
          <dl className="scanner-status-stats">
            <div><dt>Last scan</dt><dd>{fmtAgo(scannerStatus?.lastScanAt)}</dd></div>
            <div><dt>Pairs</dt><dd>{scanned}{total ? ` / ${total}` : ''}</dd></div>
            <div><dt>Signals</dt><dd>{scannerStatus?.signals_found ?? 0}</dd></div>
            <div><dt>Next</dt><dd>{scannerStatus?.next_scan_in_sec != null ? `${scannerStatus.next_scan_in_sec}s` : '—'}</dd></div>
          </dl>
        </>
      )}
    </section>
  );
}
