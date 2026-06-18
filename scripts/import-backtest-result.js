#!/usr/bin/env node
/**
 * Import a backtest result JSON into Supabase via the trading API.
 *
 * Usage:
 *   node scripts/import-backtest-result.js quantconnect/examples/import-backtest.example.json
 *   API_URL=https://api.deftluke.online node scripts/import-backtest-result.js my-qc-result.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.API_URL || process.env.PUBLIC_API_URL || 'https://api.deftluke.online').replace(/\/$/, '');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-backtest-result.js <result.json>');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

const res = await fetch(`${API}/api/backtest/import`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const text = await res.text();
let data;
try { data = JSON.parse(text); } catch { data = { raw: text }; }

if (!res.ok) {
  console.error('Import failed:', data.error || text);
  process.exit(1);
}

console.log('Imported backtest:');
console.log('  id:', data.backtest?.id);
console.log('  strategy:', data.backtest?.strategy_id);
console.log('  score:', data.backtest?.score);
console.log('  return %:', data.backtest?.return_pct);
console.log('\nView rankings: GET', `${API}/api/backtest/rankings`);
