import { useEffect, useState } from 'react';

const PHASE_LABELS = {
  init: 'Initializing backtest engine…',
  download: 'Phase 1 — Loading candles from DB (sync if missing)…',
  smc: 'Phase 2 — SMC detection + indicators…',
  backtest: 'Phase 3 — Running strategy simulation…',
  report: 'Building trade list and metrics…',
  done: 'Complete',
  fallback: 'Fallback engine — loading from database…',
  running: 'Running backtest…',
  error: 'Error',
};

export default function BacktestProgressBar({ running, estimate, progress, phase, message, onProgress }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!running) {
      onProgress?.(0);
      setLabel('');
      return;
    }

    if (message) {
      setLabel(message);
      return;
    }

    const totalMs = Math.max(15000, (estimate?.estimatedSeconds || 45) * 1200);
    const start = Date.now();

    const tick = () => {
      if (progress > 0) return;
      const elapsed = Date.now() - start;
      const pct = Math.min(90, Math.round((elapsed / totalMs) * 100));
      onProgress?.(pct);
      setLabel(PHASE_LABELS[phase] || PHASE_LABELS.running);
    };

    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [running, estimate, onProgress, message, phase, progress]);

  useEffect(() => {
    if (running && (message || phase)) {
      setLabel(message || PHASE_LABELS[phase] || PHASE_LABELS.running);
    }
  }, [running, message, phase]);

  if (!running) return null;

  const pct = Math.min(100, Math.max(0, progress || 0));

  return (
    <div className="backtest-progress-wrap">
      <div className="backtest-progress-header">
        <span className="backtest-progress-label">{label}</span>
        <span className="backtest-progress-pct">{pct}%</span>
      </div>
      <div className="backtest-progress-track">
        <div className="backtest-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="backtest-progress-meta">
        {phase && <span>{phase.replace('_', ' ')}</span>}
        {estimate?.estimatedBars != null && (
          <span>~{estimate.estimatedBars.toLocaleString()} bars</span>
        )}
        {estimate?.periodLabel && <span>{estimate.periodLabel}</span>}
      </div>
    </div>
  );
}
