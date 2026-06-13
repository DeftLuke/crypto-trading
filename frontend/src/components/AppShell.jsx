import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { id: 'trading', label: 'Trading', icon: '📈' },
  { id: 'strategy-stats', label: 'Strategy Stats', icon: '📊' },
  { id: 'strategy-tester', label: 'Strategy Tester', icon: '🧪' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function AppShell({ page, onNavigate, children }) {
  const { user, signOut } = useAuth();

  return (
    <div className="app-shell">
      <nav className="left-nav">
        <div className="nav-brand">
          <span className="nav-logo">⚡</span>
          <span>TradeGPT</span>
        </div>
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="nav-footer">
          {user?.email && <span className="nav-user">{user.email}</span>}
          {user && (
            <button type="button" className="nav-logout" onClick={signOut}>Sign out</button>
          )}
        </div>
      </nav>
      <main className="app-main">
        {children}
      </main>
    </div>
  );
}

export { NAV_ITEMS };
