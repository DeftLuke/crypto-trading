import { useEffect } from 'react';

const DOCK_ITEMS = [
  { id: 'balance', icon: '💰', label: 'Balance' },
  { id: 'signals', icon: '📡', label: 'Signals' },
  { id: 'history', icon: '📋', label: 'History' },
  { id: 'backtest', icon: '🧪', label: 'TV Backtest' },
];

export default function DockShell({ active, onSelect, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onSelect(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  return (
    <>
      {active && (
        <div className="dock-overlay" onClick={() => onSelect(null)} role="presentation" />
      )}

      <div className={`dock-panel ${active ? 'open' : ''}`}>
        {active && (
          <div className="dock-panel-inner">
            <header className="dock-panel-header">
              <h3>{DOCK_ITEMS.find((d) => d.id === active)?.label}</h3>
              <button type="button" className="dock-close" onClick={() => onSelect(null)} aria-label="Close">✕</button>
            </header>
            <div className="dock-panel-body">{children}</div>
          </div>
        )}
      </div>

      <nav className="dock-bar" aria-label="Trading tools">
        {DOCK_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`dock-btn ${active === item.id ? 'active' : ''}`}
            onClick={() => onSelect(active === item.id ? null : item.id)}
          >
            <span className="dock-btn-icon">{item.icon}</span>
            <span className="dock-btn-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

export { DOCK_ITEMS };
