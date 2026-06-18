import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { config } from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_DIR = path.join(__dirname, '../../data');
const STORE_FILE = path.join(STORE_DIR, 'binance-credentials.json');

const ALGO = 'aes-256-gcm';
const KEY = crypto.scryptSync(
  config.supabase?.serviceKey || process.env.API_ENCRYPTION_KEY || 'default-key-change-me',
  'salt',
  32
);

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv(ALGO, KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

function encryptPair(pair) {
  if (!pair?.apiKey || !pair?.apiSecret) return null;
  return { apiKey: encrypt(pair.apiKey), apiSecret: encrypt(pair.apiSecret) };
}

function decryptPair(pair) {
  if (!pair?.apiKey || !pair?.apiSecret) return null;
  return { apiKey: decrypt(pair.apiKey), apiSecret: decrypt(pair.apiSecret) };
}

export function loadStoredCredentials() {
  try {
    if (!fs.existsSync(STORE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return {
      tradingMode: raw.tradingMode === 'live' ? 'live' : 'demo',
      demo: decryptPair(raw.demo) || { apiKey: '', apiSecret: '' },
      live: decryptPair(raw.live) || { apiKey: '', apiSecret: '' },
      updatedAt: raw.updatedAt || null,
    };
  } catch (err) {
    console.warn('[CredentialStore] Load failed:', err.message);
    return null;
  }
}

export function saveStoredCredentials(state) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const payload = {
    tradingMode: state.tradingMode === 'live' ? 'live' : 'demo',
    demo: encryptPair(state.demo),
    live: encryptPair(state.live),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STORE_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return payload.updatedAt;
}
