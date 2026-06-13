import { useEffect, useState } from 'react';

const LABELS = [
  { until: 25, text: 'Fetching historical candles from Binance…' },
  { until: 55, text: 'Analyzing multi-timeframe structure…' },
  { until: 85, text: 'Running strategy simulation…' },
  { until: 100, text: 'Building chart and trade list…' },
];

export default function BacktestProgressBar({ running, estimate, progress, onProgress }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!running) {
      onProgress?.(0);
      setLabel('');
      return;
    }

    const totalMs = Math.max(15000, (estimate?.estimatedSeconds || 45) * 1200);
    const start = Date.now();

    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min(95, Math.round((elapsed / totalMs) * 100));
      onProgress?.(pct);
      const stage = LABELS.find((l) => pct < l.until) || LABELS[LABELS.length - 1];
      setLabel(stage.text);
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [running, estimate, onProgress]);

  if (!running) return null;

  return (
    <div className="backtest-progress-wrap">
      <div className="backtest-progress-header">
        <span className="backtest-progress-label">{label}</span>
        <span className="backtest-progress-pct">{progress}%</span>
      </div>
      <div className="backtest-progress-track">
        <div className="backtest-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="backtest-progress-meta">
        {estimate?.estimatedBars != null && (
          <span>~{estimate.estimatedBars.toLocaleString()} bars</span>
        )}
        {estimate?.estimatedSeconds > 0 && (
          <span>est. {estimate.estimatedSeconds}s</span>
        )}
        {estimate?.periodLabel && <span>{estimate.periodLabel}</span>}
      </div>
    </div>
  );
}
