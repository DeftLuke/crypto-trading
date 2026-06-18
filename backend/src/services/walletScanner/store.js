import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.WALLET_SCANNER_DATA_DIR
  || path.join(__dirname, '../../../../data/smart-wallets');

const FILES = {
  wallets: 'wallets.json',
  signals: 'consensus-signals.json',
  state: 'scanner-state.json',
  config: 'config.json',
  'trades-cache': 'trades-cache.json',
  'all-wallets': 'all-wallets.json',
};

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(name, fallback) {
  await ensureDir();
  const file = path.join(DATA_DIR, FILES[name] || name);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(name, data) {
  await ensureDir();
  const file = path.join(DATA_DIR, FILES[name] || name);
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return data;
}

export { writeJson };

export function getDataDir() {
  return DATA_DIR;
}

export async function loadWallets() {
  const data = await readJson('wallets', { updated_at: null, wallets: [] });
  return data.wallets || [];
}

export async function saveWallets(wallets) {
  return writeJson('wallets', {
    updated_at: new Date().toISOString(),
    count: wallets.length,
    wallets,
  });
}

export async function loadSignals() {
  const data = await readJson('signals', { signals: [] });
  return data.signals || [];
}

export async function saveSignals(signals) {
  const trimmed = signals.slice(0, 500);
  return writeJson('signals', {
    updated_at: new Date().toISOString(),
    signals: trimmed,
  });
}

export async function appendSignal(signal) {
  const signals = await loadSignals();
  signals.unshift({ ...signal, id: signal.id || crypto.randomUUID(), created_at: new Date().toISOString() });
  await saveSignals(signals);
  return signal;
}

export async function loadScannerState() {
  return readJson('state', {
    running: false,
    last_scan_at: null,
    last_daily_refresh_at: null,
    last_consensus_at: null,
    stats: {},
  });
}

export async function saveScannerState(state) {
  return writeJson('state', state);
}

export async function loadScannerConfig() {
  return readJson('config', null);
}

export async function saveScannerConfig(config) {
  return writeJson('config', config);
}
