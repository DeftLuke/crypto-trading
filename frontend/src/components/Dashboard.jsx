import { useState } from 'react';
import AppShell from './AppShell';
import { AppProvider } from '../context/AppContext';
import HomePage from './HomePage';
import TradingPage from './TradingPage';
import StrategyStatsPage from './StrategyStatsPage';
import StrategyTesterPage from './StrategyTesterPage';
import SmartWalletScannerPage from './SmartWalletScannerPage';
import SettingsPage from './SettingsPage';
import PlatformFrame from './PlatformFrame';
import { getNavItem } from '../lib/platformUrl';

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
        {content}
      </AppShell>
    </AppProvider>
  );
}
