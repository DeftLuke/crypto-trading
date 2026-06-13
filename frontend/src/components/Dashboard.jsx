import { useState } from 'react';
import AppShell from './AppShell';
import TradingPage from './TradingPage';
import StrategyStatsPage from './StrategyStatsPage';
import StrategyTesterPage from './StrategyTesterPage';
import SettingsPage from './SettingsPage';

export default function Dashboard() {
  const [page, setPage] = useState('trading');

  let content;
  switch (page) {
    case 'strategy-stats':
      content = <StrategyStatsPage />;
      break;
    case 'strategy-tester':
      content = <StrategyTesterPage />;
      break;
    case 'settings':
      content = <SettingsPage />;
      break;
    default:
      content = <TradingPage />;
  }

  return (
    <AppShell page={page} onNavigate={setPage}>
      {content}
    </AppShell>
  );
}
