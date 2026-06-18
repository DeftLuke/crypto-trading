import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  fetchBalance, fetchScannerStatus, startScanner, stopScanner, connectWebSocket,
} from '../services/api';
import { fetchControlSettings, updateControlSettings } from '../services/researchApi';
import { deferNonCritical } from '../lib/fetchTimeout';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [balance, setBalance] = useState(null);
  const [scannerOn, setScannerOn] = useState(false);
  const [autoTrade, setAutoTrade] = useState(false);
  const [tradingMode, setTradingMode] = useState('demo');

  const loadBalance = useCallback(async () => {
    try {
      const data = await fetchBalance();
      if (!data?.error) setBalance(data);
    } catch { /* optional */ }
  }, []);

  const loadPlatformSettings = useCallback(async () => {
    try {
      const settings = await fetchControlSettings();
      setAutoTrade(Boolean(settings.auto_trading));
      setTradingMode(settings.mode || 'demo');
    } catch { /* research API can be offline in local dev */ }
  }, []);

  useEffect(() => {
    connectWebSocket((data) => {
      if (data.type === 'scanner') setScannerOn(data.isRunning);
    });
    deferNonCritical(async () => {
      await loadBalance();
      await loadPlatformSettings();
      try {
        const s = await fetchScannerStatus();
        setScannerOn(s.isRunning);
      } catch { /* optional */ }
    });
    const id = setInterval(loadBalance, 60000);
    const onBalance = () => loadBalance();
    window.addEventListener('balance-updated', onBalance);
    return () => {
      clearInterval(id);
      window.removeEventListener('balance-updated', onBalance);
    };
  }, [loadBalance, loadPlatformSettings]);

  const toggleScanner = useCallback(async () => {
    if (scannerOn) {
      await stopScanner();
      setScannerOn(false);
    } else {
      await startScanner();
      setScannerOn(true);
    }
  }, [scannerOn]);

  const toggleAutoTrade = useCallback(async () => {
    const next = !autoTrade;
    setAutoTrade(next);
    try {
      await updateControlSettings({ auto_trading: next });
    } catch (err) {
      setAutoTrade(!next);
      throw err;
    }
  }, [autoTrade]);

  const changeTradingMode = useCallback(async (mode) => {
    const next = mode === 'live' ? 'live' : 'demo';
    const previous = tradingMode;
    setTradingMode(next);
    try {
      await updateControlSettings({ mode: next });
      await loadBalance();
    } catch (err) {
      setTradingMode(previous);
      throw err;
    }
  }, [tradingMode, loadBalance]);

  const value = useMemo(() => ({
    balance,
    scannerOn,
    autoTrade,
    tradingMode,
    setTradingMode: changeTradingMode,
    toggleScanner,
    toggleAutoTrade,
    refreshPlatformSettings: loadPlatformSettings,
  }), [balance, scannerOn, autoTrade, tradingMode, changeTradingMode, toggleScanner, toggleAutoTrade, loadPlatformSettings]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
