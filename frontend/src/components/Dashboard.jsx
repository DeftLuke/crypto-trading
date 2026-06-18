import { lazy, Suspense, useState } from 'react';
import AppShell from './AppShell';
import { AppProvider } from '../context/AppContext';
import HomePage from './HomePage';
import { getNavItem } from '../lib/platformUrl';

const TradingPage = lazy(() => import('./TradingPage'));
const StrategyStatsPage = lazy(() => import('./StrategyStatsPage'));
const StrategyTesterPage = lazy(() => import('./StrategyTesterPage'));
const SmartWalletScannerPage = lazy(() => import('./SmartWalletScannerPage'));
const SettingsPage = lazy(() => import('./SettingsPage'));
const PlatformFrame = lazy(() => import('./PlatformFrame'));

function PageLoader() {
  return <div className="page-loading">Loading module…</div>;
}

function PlatformRoute({ pageId }) {
  const item = getNavItem(pageId);
  return <PlatformFrame path={item?.platformPath || '/dashboard'} title={item?.label} />;
}

export default function Dashboard() {
  const [page, setPage] = useState('home');

  let content;
  if (page.startsWith('platform-')) {
    content = <PlatformRoute pageId={page} />;
  } else {
    switch (page) {
      case 'home':
        content = <HomePage onNavigate={setPage} />;
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
      <AppShell page={page} onNavigate={setPage}>
        <Suspense fallback={<PageLoader />}>
          {content}
        </Suspense>
      </AppShell>
    </AppProvider>
  );
}
