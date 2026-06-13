import { getSupabase } from './supabase.js';

let memoryState = { isRunning: false, lastScanAt: null, pairsScanned: 0, lastSignalSymbol: null };

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
  memoryState = { ...memoryState, ...stats };
  const db = getSupabase();
  if (db) {
    await db.from('scanner_state').update({
      last_scan_at: stats.lastScanAt || memoryState.lastScanAt,
      pairs_scanned: stats.pairsScanned || memoryState.pairsScanned,
      last_signal_symbol: stats.lastSignalSymbol || memoryState.lastSignalSymbol,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
  }
}

export function isScannerRunning() {
  return memoryState.isRunning;
}
