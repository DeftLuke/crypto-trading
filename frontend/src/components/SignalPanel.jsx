import { useEffect, useState } from 'react';
import { fetchSignals } from '../services/api';

export default function SignalPanel() {
  const [signals, setSignals] = useState([]);

  useEffect(() => {
    loadSignals();
    const interval = setInterval(loadSignals, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadSignals() {
    try {
      const data = await fetchSignals(15);
      setSignals(Array.isArray(data) ? data : []);
    } catch {
      setSignals([]);
    }
  }

  function getConfidenceClass(c) {
    if (c >= 75) return 'confidence-high';
    if (c >= 50) return 'confidence-mid';
    return 'confidence-low';
  }

  return (
    <div className="panel">
      <h3>Signals</h3>
      {signals.length === 0 && (
        <p className="signal-detail">No signals yet. Scanner running...</p>
      )}
      {signals.map((s) => (
        <div key={s.id} className={`signal-card ${s.direction?.toLowerCase()}`}>
          <div className="signal-header">
            <span className="signal-symbol">{s.symbol}</span>
            <span className={`confidence-badge ${getConfidenceClass(s.confidence)}`}>
              {s.confidence}%
            </span>
          </div>
          <div className="signal-detail">
            <strong>{s.direction}</strong> — Entry: {s.entry_price} | SL: {s.stop_loss}
            <br />
            TP1: {s.tp1} | TP2: {s.tp2}
          </div>
          {s.mtf_status && (
            <div className="mtf-status">
              {Object.entries(s.mtf_status).map(([tf, data]) => (
                data && (
                  <span key={tf} className={`mtf-chip ${data.emaTrend ? 'pass' : 'fail'}`}>
                    {tf}: {data.emaTrend || '—'}
                  </span>
                )
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
