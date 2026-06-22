import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  fetchBalance, fetchScannerStatus, startScanner, stopScanner, connectWebSocket, fetchControlSettings, updateControlSettings,
} from '../services/api';
import { readClientCache, writeClientCache, isDocumentVisible } from '../lib/clientCache';
import { deferNonCritical } from '../lib/fetchTimeout';

const AppContext = createContext(null);

const EMPTY_SCANNER = {
  isRunning: false,
  scanning: false,
  progress_pct: 0,
  pairs_scanned: 0,
  universe_size: 0,
  engine: 'institutional-smc',
  engine_label: 'SMC v2 (Python)',
};

export function AppProvider({ children }) {
  const [balance, setBalance] = useState(null);
  const [scannerOn, setScannerOn] = useState(false);
  const [scannerStatus, setScannerStatus] = useState(EMPTY_SCANNER);
  const [autoTrade, setAutoTrade] = useState(false);
  const [tradingMode, setTradingMode] = useState('demo');

  const loadBalance = useCallback(async () => {
    try {
      const cached = readClientCache('balance', 30000);
      if (cached && !cached.error) setBalance(cached);
      const data = await fetchBalance();
      if (!data?.error) {
        setBalance(data);
        writeClientCache('balance', data);
      }
    } catch { /* optional */ }
  }, []);

  const loadScannerStatus = useCallback(async () => {
    try {
      const data = await fetchScannerStatus();
      setScannerStatus({ ...EMPTY_SCANNER, ...data, lastScanAt: data.lastScanAt });
      setScannerOn(Boolean(data.isRunning));
      writeClientCache('scanner-status', data);
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
    const cached = readClientCache('scanner-status', 8000);
    if (cached) {
      setScannerStatus({ ...EMPTY_SCANNER, ...cached, lastScanAt: cached.lastScanAt });
      setScannerOn(Boolean(cached.isRunning));
    }

    connectWebSocket((data) => {
      if (data.type === 'scanner') setScannerOn(data.isRunning);
      if (data.type === 'scanner_progress') {
        setScannerStatus((prev) => ({
          ...prev,
          ...data,
          scanning: data.scanning,
          progress_pct: data.scanProgressPct ?? data.progress_pct ?? prev.progress_pct,
          pairs_scanned: data.pairsScanned ?? data.pairs_scanned ?? prev.pairs_scanned,
          universe_size: data.universeSize ?? data.universe_size ?? prev.universe_size,
          signals_found: data.signalsFound ?? data.signals_found ?? prev.signals_found,
          best_score_symbol: data.bestScoreSymbol ?? data.best_score_symbol ?? prev.best_score_symbol,
          best_score: data.bestScore ?? data.best_score ?? prev.best_score,
          best_score_direction: data.bestScoreDirection ?? data.best_score_direction ?? prev.best_score_direction,
          best_score_status: data.bestScoreStatus ?? data.best_score_status ?? prev.best_score_status,
          lastScanAt: data.lastScanAt ?? prev.lastScanAt,
        }));
      }
      if (data.type === 'account_update') loadBalance();
    });

    deferNonCritical(async () => {
      await loadBalance();
      await loadPlatformSettings();
      await loadScannerStatus();
    });

    const balanceId = setInterval(() => { if (isDocumentVisible()) loadBalance(); }, 90000);
    const scannerId = setInterval(() => { if (isDocumentVisible()) loadScannerStatus(); }, 4000);
    const onBalance = () => loadBalance();
    window.addEventListener('balance-updated', onBalance);
    return () => {
      clearInterval(balanceId);
      clearInterval(scannerId);
      window.removeEventListener('balance-updated', onBalance);
    };
  }, [loadBalance, loadPlatformSettings, loadScannerStatus]);

  const toggleScanner = useCallback(async () => {
    if (scannerOn) {
      await stopScanner();
      setScannerOn(false);
    } else {
      await startScanner();
      setScannerOn(true);
    }
    await loadScannerStatus();
  }, [scannerOn, loadScannerStatus]);

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
    scannerStatus,
    autoTrade,
    tradingMode,
    setTradingMode: changeTradingMode,
    toggleScanner,
    toggleAutoTrade,
    refreshPlatformSettings: loadPlatformSettings,
    refreshScannerStatus: loadScannerStatus,
  }), [balance, scannerOn, scannerStatus, autoTrade, tradingMode, changeTradingMode, toggleScanner, toggleAutoTrade, loadPlatformSettings, loadScannerStatus]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
