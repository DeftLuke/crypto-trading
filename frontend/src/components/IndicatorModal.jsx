import { useMemo, useState } from 'react';

export const CHART_INDICATORS = [
  { id: 'smc', name: 'Smart Money Algo Pro', desc: 'Order blocks, FVG, IDM from pinscript', group: 'Strategy' },
  { id: 'setups', name: 'Entry / SL / TP', desc: 'Strategy trade setups on chart', group: 'Strategy' },
  { id: 'ema9', name: 'EMA 9', desc: 'Fast exponential moving average', group: 'Moving Averages' },
  { id: 'ema21', name: 'EMA 21', desc: 'Short-term trend', group: 'Moving Averages' },
  { id: 'ema100', name: 'EMA 100', desc: 'Major trend filter', group: 'Moving Averages' },
  { id: 'rsi', name: 'RSI 14', desc: 'Relative strength oscillator panel', group: 'Oscillators' },
  { id: 'volume', name: 'Volume', desc: 'Volume histogram', group: 'Volume' },
];

const GROUPS = ['All', 'Strategy', 'Moving Averages', 'Oscillators', 'Volume'];

export default function IndicatorModal({ open, onClose, active, onToggle }) {
  const [tab, setTab] = useState('All');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = CHART_INDICATORS;
    if (tab !== 'All') list = list.filter((i) => i.group === tab);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q));
    }
    return list;
  }, [tab, query]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="indicator-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Indicators">
        <header className="indicator-modal-header">
          <h3>Indicators, metrics & strategies</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <input
          type="search"
          className="indicator-search"
          placeholder="Search indicators…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <div className="indicator-modal-body">
          <aside className="indicator-groups">
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                className={`ind-group-btn ${tab === g ? 'active' : ''}`}
                onClick={() => setTab(g)}
              >
                {g}
              </button>
            ))}
          </aside>

          <ul className="indicator-list">
            {filtered.map((ind) => {
              const on = active[ind.id];
              return (
                <li key={ind.id}>
                  <button
                    type="button"
                    className={`indicator-row ${on ? 'active' : ''}`}
                    onClick={() => onToggle(ind.id)}
                  >
                    <span className="ind-check">{on ? '✓' : ''}</span>
                    <span className="ind-info">
                      <strong>{ind.name}</strong>
                      <span className="ind-desc">{ind.desc}</span>
                    </span>
                    <span className="ind-group-tag">{ind.group}</span>
                  </button>
                </li>
              );
            })}
            {!filtered.length && (
              <li className="indicator-empty">No indicators match your search.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
