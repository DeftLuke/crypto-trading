import { config } from '../config/index.js';
import {
  runConsensusScan,
  dailyWalletMaintenance,
} from '../services/walletScanner/index.js';
import { loadScannerState } from '../services/walletScanner/store.js';

let intervalId = null;
let dailyTimer = null;

async function tick() {
  const state = await loadScannerState();
  if (!state.running) return;
  try {
    console.log('[WalletScanner] Running consensus scan…');
    const result = await runConsensusScan();
    console.log(`[WalletScanner] ${result.new_signals?.length || 0} new signals, ${result.passed_liquidity} passed liquidity`);
  } catch (err) {
    console.error('[WalletScanner] Scan error:', err.message);
  }
}

function scheduleDailyRefresh() {
  const hour = config.walletScanner?.dailyRefreshHour ?? 6;
  const msUntilNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if ( next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };

  const run = async () => {
    const state = await loadScannerState();
    if (!state.running) return;
    try {
      console.log('[WalletScanner] Daily maintenance…');
      const report = await dailyWalletMaintenance();
      console.log(`[WalletScanner] Daily: removed ${report.removed?.length || 0}, added ${report.added}`);
    } catch (err) {
      console.error('[WalletScanner] Daily maintenance error:', err.message);
    }
    dailyTimer = setTimeout(run, msUntilNext());
  };

  dailyTimer = setTimeout(run, msUntilNext());
}

export function startWalletScannerJob() {
  if (!config.walletScanner?.enabled) {
    console.log('[WalletScanner] Disabled (set WALLET_SCANNER_ENABLED=true)');
    return;
  }
  if (intervalId) return;

  const ms = config.walletScanner.scanIntervalMs || 900000;
  intervalId = setInterval(tick, ms);
  scheduleDailyRefresh();
  console.log(`[WalletScanner] Job started (every ${ms / 60000}m)`);
}

export function stopWalletScannerJob() {
  if (intervalId) clearInterval(intervalId);
  if (dailyTimer) clearTimeout(dailyTimer);
  intervalId = null;
  dailyTimer = null;
}

export async function triggerWalletScan() {
  return runConsensusScan();
}

export async function triggerDailyMaintenance() {
  return dailyWalletMaintenance();
}
