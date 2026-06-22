import { useState } from 'react';
import TopBar from './TopBar';
import { NAV_SECTIONS } from '../lib/platformUrl';

const MOBILE_QUICK_IDS = ['home', 'trading', 'platform-paper', 'platform-live', 'platform-dashboard'];

export default function AppShell({ page, onNavigate, children, embed = false, navPending = false }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const allItems = NAV_SECTIONS.flatMap((section) => section.items);
  const quickItems = MOBILE_QUICK_IDS.map((id) => allItems.find((item) => item.id === id)).filter(Boolean);

  const navigate = (id) => {
    onNavigate(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className={`app-shell ${collapsed ? 'nav-collapsed' : ''} ${mobileMenuOpen ? 'mobile-nav-open' : ''} ${navPending ? 'is-nav-pending' : ''}`}>
      {navPending && <div className="app-nav-progress" aria-hidden="true" />}
      {mobileMenuOpen && (
        <button
          type="button"
          className="mobile-nav-overlay"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <nav className="left-nav">
        <button
          type="button"
          className="nav-brand nav-brand-link"
          onClick={() => navigate('home')}
          title="TradeGPT Home"
        >
          <img
            src="/logo-32.webp"
            srcSet="/logo-32.webp 1x, /logo-64.webp 2x"
            alt=""
            className="nav-logo-img"
            width="32"
            height="32"
            decoding="async"
          />
          <span>TradeGPT</span>
          <span
            className="nav-collapse-btn"
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setCollapsed(!collapsed); } }}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? '»' : '«'}
          </span>
        </button>
        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="nav-section">
            {!collapsed && <p className="nav-section-label">{section.label}</p>}
            <ul className="nav-list">
              {section.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`nav-item ${page === item.id ? 'active' : ''} ${item.live ? 'nav-live' : ''}`}
                    onClick={() => navigate(item.id)}
                    title={item.label}
                  >
                    <span className="nav-glyph">{item.glyph}</span>
                    <span className="nav-label">{item.label}</span>
                    {item.live && <span className="nav-live-dot" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="app-content">
        <TopBar onNavigate={onNavigate} onMenuClick={() => setMobileMenuOpen(true)} />
        <main className={`app-main${embed ? ' app-main-embed' : ''}`}>{children}</main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {quickItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mobile-bottom-btn ${page === item.id ? 'active' : ''}`}
            onClick={() => navigate(item.id)}
          >
            <span className="mobile-bottom-glyph">{item.glyph}</span>
            <span>{item.short || item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export { NAV_SECTIONS };
