import { getSupabase } from './supabase.js';

let memoryState = {
  isRunning: false,
  lastScanAt: null,
  pairsScanned: 0,
  lastSignalSymbol: null,
  bestScoreSymbol: null,
  bestScore: 0,
  bestScoreDirection: null,
  bestScoreStatus: null,
  engineId: 'institutional-smc',
  universeSize: 0,
  signalsFound: 0,
  scanMeta: null,
  scanning: false,
  scanProgressPct: 0,
  scanStartedAt: null,
};

export function setScanProgress(partial) {
  memoryState = { ...memoryState, ...partial };
}

export function getScannerLiveState() {
  return { ...memoryState };
}

export async function getScannerState() {
  const db = getSupabase();
  if (db) {
    const { data } = await db.from('scanner_state').select('*').eq('id', 1).single();
    if (data) {
      memoryState = {
        isRunning: data.is_running,
        lastScanAt: data.last_scan_at,
        pairsScanned: data.pairs_scanned || 0,
        lastSignalSymbol: data.last_signal_symbol,
        engineId: memoryState.engineId,
        universeSize: memoryState.universeSize,
        signalsFound: memoryState.signalsFound,
        scanMeta: memoryState.scanMeta,
        scanning: memoryState.scanning,
        scanProgressPct: memoryState.scanProgressPct,
        scanStartedAt: memoryState.scanStartedAt,
      };
    }
  }
  return { ...memoryState };
}

export async function setScannerRunning(isRunning) {
  memoryState.isRunning = isRunning;
  const db = getSupabase();
  if (db) {
    await db.from('scanner_state').upsert({
      id: 1,
      is_running: isRunning,
      updated_at: new Date().toISOString(),
    });
  }
  return memoryState;
}

export async function updateScannerStats(stats) {
  memoryState = {
    ...memoryState,
    lastScanAt: stats.lastScanAt ?? memoryState.lastScanAt,
    pairsScanned: stats.pairsScanned ?? memoryState.pairsScanned,
    lastSignalSymbol: stats.lastSignalSymbol ?? memoryState.lastSignalSymbol,
    bestScoreSymbol: stats.bestScoreSymbol ?? memoryState.bestScoreSymbol,
    bestScore: stats.bestScore ?? memoryState.bestScore,
    bestScoreDirection: stats.bestScoreDirection ?? memoryState.bestScoreDirection,
    bestScoreStatus: stats.bestScoreStatus ?? memoryState.bestScoreStatus,
    engineId: stats.engineId ?? memoryState.engineId,
    universeSize: stats.universeSize ?? memoryState.universeSize,
    signalsFound: stats.signalsFound ?? memoryState.signalsFound,
    scanMeta: stats.scanMeta ?? memoryState.scanMeta,
    scanning: stats.scanning ?? memoryState.scanning,
    scanProgressPct: stats.scanProgressPct ?? memoryState.scanProgressPct,
    scanStartedAt: stats.scanStartedAt ?? memoryState.scanStartedAt,
  };
  const db = getSupabase();
  if (db) {
    await db.from('scanner_state').update({
      last_scan_at: memoryState.lastScanAt,
      pairs_scanned: memoryState.pairsScanned,
      last_signal_symbol: memoryState.lastSignalSymbol,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
  }
}

export function isScannerRunning() {
  return memoryState.isRunning;
}
