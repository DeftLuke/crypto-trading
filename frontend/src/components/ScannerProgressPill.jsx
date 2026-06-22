function fmtAgo(iso) {
  if (!iso) return '—';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export default function ScannerProgressPill({ scannerOn, status, onClick }) {
  if (!scannerOn && !status?.scanning) return null;

  const scanning = Boolean(status?.scanning);
  const pct = status?.progress_pct ?? 0;
  const scanned = status?.pairsScanned ?? status?.pairs_scanned ?? 0;
  const total = status?.universe_size ?? 0;
  const engine = status?.engine_label || 'SMC v2';

  return (
    <button
      type="button"
      className={`scanner-progress-pill ${scanning ? 'is-scanning' : ''}`}
      onClick={onClick}
      title={scanning ? `Scanning ${scanned}/${total} pairs` : `Last scan ${fmtAgo(status?.lastScanAt)}`}
    >
      <span className="scanner-progress-dot" />
      <span className="scanner-progress-text">
        {scanning ? (
          <>
            <strong>{engine}</strong>
            <span className="scanner-progress-sep">·</span>
            {pct}%
            {total > 0 && (
              <span className="scanner-progress-count"> ({scanned}/{total})</span>
            )}
          </>
        ) : (
          <>
            <strong>{engine}</strong>
            <span className="scanner-progress-sep">·</span>
            Idle
            {status?.next_scan_in_sec != null && status.next_scan_in_sec > 0 && (
              <span className="scanner-progress-count"> · next {status.next_scan_in_sec}s</span>
            )}
          </>
        )}
      </span>
      {scanning && (
        <span className="scanner-progress-track" aria-hidden="true">
          <span className="scanner-progress-fill" style={{ width: `${pct}%` }} />
        </span>
      )}
    </button>
  );
}
