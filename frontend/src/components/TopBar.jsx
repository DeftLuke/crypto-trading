import { useState } from 'react';
import { useApp } from '../context/AppContext';
import AccountPanel from './AccountPanel';
import ScannerProgressPill from './ScannerProgressPill';

export default function TopBar({ onNavigate, onMenuClick }) {
  const {
    balance, scannerOn, scannerStatus, autoTrade, tradingMode, setTradingMode, toggleScanner, toggleAutoTrade,
  } = useApp();
  const [accountOpen, setAccountOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const availableValue = balance?.available ?? balance?.total ?? balance?.equity;
  const available = availableValue != null ? parseFloat(availableValue).toFixed(2) : '—';

  async function handleAutoTrade() {
    setBusy(true);
    try {
      await toggleAutoTrade();
    } catch (err) {
      window.alert(err.message || 'Could not update auto trade');
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <button type="button" className="top-menu-btn" onClick={onMenuClick} aria-label="Open navigation">
          ☰
        </button>
        <div className="balance-chip">
          <span className="balance-label">Balance</span>
          <span className="balance-value">{available}</span>
          <span className="balance-unit">USDT</span>
        </div>
        <select
          className={`mode-pill mode-${tradingMode}`}
          value={tradingMode}
          onChange={(event) => setTradingMode(event.target.value)}
          title="Trading mode"
        >
          <option value="demo">Demo Trading</option>
          <option value="live">Live Trading</option>
        </select>
      </div>

      <div className="top-bar-center">
        <ScannerProgressPill
          scannerOn={scannerOn}
          status={scannerStatus}
          onClick={toggleScanner}
        />
        <button type="button" className={`top-toggle ${scannerOn ? 'is-on' : ''}`} onClick={toggleScanner}>
          <span className="toggle-dot" />
          Scanner {scannerOn ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          className={`top-toggle accent ${autoTrade ? 'is-on' : ''}`}
          onClick={handleAutoTrade}
          disabled={busy}
        >
          <span className="toggle-dot" />
          Auto Trade {autoTrade ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="top-bar-right">
        <button type="button" className="top-icon-btn top-settings-btn" onClick={() => onNavigate('settings')} title="Settings">
          ⚙ Settings
        </button>
        <button type="button" className="top-icon-btn" onClick={() => onNavigate('platform-risk')} title="Risk management">
          Risk
        </button>
        <button type="button" className="top-account-btn" onClick={() => setAccountOpen((v) => !v)}>
          Account
        </button>
        <AccountPanel open={accountOpen} onClose={() => setAccountOpen(false)} />
      </div>
    </header>
  );
}
