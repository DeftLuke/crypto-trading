import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import AppShell from './AppShell';
import { AppProvider } from '../context/AppContext';
import HomePage from './HomePage';
import PageTransitionLoader from './PageTransitionLoader';
import { getNavItem } from '../lib/platformUrl';

const TradingPage = lazy(() => import('./TradingPage'));
const StrategyStatsPage = lazy(() => import('./StrategyStatsPage'));
const StrategyTesterPage = lazy(() => import('./StrategyTesterPage'));
const SmartWalletScannerPage = lazy(() => import('./SmartWalletScannerPage'));
const SettingsPage = lazy(() => import('./SettingsPage'));
const PlatformFrame = lazy(() => import('./PlatformFrame'));

const PAGE_LABELS = {
  home: 'Home',
  trading: 'Trading',
  'wallet-scanner': 'Smart Wallets',
  'strategy-stats': 'Strategy',
  'strategy-tester': 'Backtest',
  settings: 'Settings',
};

function pageLabel(pageId) {
  if (PAGE_LABELS[pageId]) return PAGE_LABELS[pageId];
  return getNavItem(pageId)?.label || 'Loading';
}

function PlatformRoute({ pageId }) {
  const item = getNavItem(pageId);
  return <PlatformFrame path={item?.platformPath || '/dashboard'} title={item?.label} />;
}

export default function Dashboard() {
  const [page, setPage] = useState('home');
  const [navPending, setNavPending] = useState(false);
  const [navLabel, setNavLabel] = useState('Loading');

  const navigate = useCallback((id) => {
    if (id === page) return;
    setNavLabel(pageLabel(id));
    setNavPending(true);
    setPage(id);
  }, [page]);

  useEffect(() => {
    if (!navPending) return undefined;
    const timer = setTimeout(() => setNavPending(false), 350);
    return () => clearTimeout(timer);
  }, [page, navPending]);

  let content;
  if (page.startsWith('platform-')) {
    content = <PlatformRoute pageId={page} />;
  } else {
    switch (page) {
      case 'home':
        content = <HomePage onNavigate={navigate} />;
        break;
      case 'wallet-scanner':
        content = <SmartWalletScannerPage />;
        break;
      case 'strategy-stats':
        content = <StrategyStatsPage />;
        break;
      case 'strategy-tester':
        content = <StrategyTesterPage />;
        break;
      case 'settings':
        content = <SettingsPage />;
        break;
      case 'trading':
      default:
        content = <TradingPage />;
    }
  }

  return (
    <AppProvider>
      <AppShell page={page} onNavigate={navigate} navPending={navPending} embed={page.startsWith('platform-')}>
        {navPending && <PageTransitionLoader label={`Opening ${navLabel}`} />}
        <Suspense fallback={<PageTransitionLoader label={`Loading ${navLabel}`} />}>
          <div key={page} className="page-enter">
            {content}
          </div>
        </Suspense>
      </AppShell>
    </AppProvider>
  );
}
