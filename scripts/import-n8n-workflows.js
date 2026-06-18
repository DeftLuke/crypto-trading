#!/usr/bin/env node
/**
 * Import n8n workflows via Public API
 * Usage: node scripts/import-n8n-workflows.js
 * Env: N8N_BASE_URL, N8N_API_KEY (or reads n8n/workflows/production.env.json)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadEnvFile(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const env = {};
    for (const line of lines) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim();
    }
    return env;
  } catch {
    return {};
  }
}

const prodEnvPath = path.join(root, 'n8n/workflows/production.env.json');
let prodEnv = {};
try {
  prodEnv = JSON.parse(fs.readFileSync(prodEnvPath, 'utf8')).variables || {};
} catch { /* optional */ }

const backendEnv = loadEnvFile(path.join(root, 'backend/.env'));
const N8N_URL = (backendEnv.N8N_BASE_URL || prodEnv.N8N_BASE_URL || 'https://n8n.deftluke.online').replace(/\/$/, '');
const API_KEY = backendEnv.N8N_API_KEY || prodEnv.N8N_API_KEY || '';

if (!API_KEY) {
  console.error('Missing N8N_API_KEY in backend/.env or n8n/workflows/production.env.json');
  process.exit(1);
}

const headers = {
  'X-N8N-API-KEY': API_KEY,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

async function api(method, endpoint, body) {
  const res = await fetch(`${N8N_URL}/api/v1${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${endpoint} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

const CRED_ID_ENV = process.env.N8N_TELEGRAM_CREDENTIAL_ID || 'SNHZjAKoQFrl7Atc';
const CRED_NAME = 'PipBotX TradeGPT';
const CHAT_ID = backendEnv.TELEGRAM_CHAT_ID || prodEnv.TELEGRAM_CHAT_ID || '600639327';
const TELEGRAM_TOKEN = backendEnv.TELEGRAM_BOT_TOKEN || '';

const WORKFLOW_FILES = [
  'tradegpt-unified-telegram.json',
  'ai-assistant.json',
  'trade-execution.json',
  'app-integration.json',
];

const DEACTIVATE_WORKFLOW_NAMES = new Set([
  'Signal Notify (Production)',
  'Platform Event Handler (Phase 9)',
  'Daily Summary (Phase 9)',
  'Trading App Integration (Production)',
]);

async function ensureTelegramCredential() {
  if (!TELEGRAM_TOKEN) return CRED_ID_ENV;
  try {
    const cred = await api('POST', '/credentials', {
      name: CRED_NAME,
      type: 'telegramApi',
      data: { accessToken: TELEGRAM_TOKEN },
    });
    return cred.id;
  } catch {
    return CRED_ID_ENV;
  }
}

function applyTelegramNodes(nodes, credId) {
  for (const node of nodes) {
    if (node.type === 'n8n-nodes-base.telegram' || node.type === 'n8n-nodes-base.telegramTrigger') {
      node.credentials = { telegramApi: { id: credId, name: CRED_NAME } };
      if (node.parameters && 'chatId' in node.parameters) {
        node.parameters.chatId = CHAT_ID;
      }
    }
  }
}

function loadWorkflow(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows', file), 'utf8'));
  return {
    name: raw.name,
    nodes: raw.nodes,
    connections: raw.connections,
    settings: raw.settings || { executionOrder: 'v1' },
  };
}

const existing = (await api('GET', '/workflows?limit=100')).data || [];
const byName = new Map(existing.filter((w) => !w.isArchived).map((w) => [w.name, w]));

console.log(`n8n: ${N8N_URL}\n`);

const credId = await ensureTelegramCredential();
console.log(`Telegram credential: ${CRED_NAME} (${credId})\n`);

for (const file of WORKFLOW_FILES) {
  const payload = loadWorkflow(file);
  applyTelegramNodes(payload.nodes, credId);
  const match = byName.get(payload.name);
  let workflow;

  if (match) {
    workflow = await api('PUT', `/workflows/${match.id}`, payload);
    console.log(`✓ Updated: ${workflow.name} (${workflow.id})`);
  } else {
    workflow = await api('POST', '/workflows', payload);
    console.log(`✓ Created: ${workflow.name} (${workflow.id})`);
  }

  try {
    await api('POST', `/workflows/${workflow.id}/activate`);
    console.log(`  → Activated`);
  } catch (err) {
    console.log(`  → Activate failed: ${err.message}`);
  }
}

for (const workflow of existing) {
  if (!workflow.isArchived && DEACTIVATE_WORKFLOW_NAMES.has(workflow.name) && workflow.active) {
    try {
      await api('POST', `/workflows/${workflow.id}/deactivate`);
      console.log(`✓ Deactivated duplicate Telegram workflow: ${workflow.name} (${workflow.id})`);
    } catch (err) {
      console.log(`! Could not deactivate ${workflow.name}: ${err.message}`);
    }
  }
}

console.log('\nWebhooks:');
for (const wh of ['tradegpt-event', 'trade-execute', 'ai-assistant', 'app-signal']) {
  const res = await fetch(`${N8N_URL}/webhook/${wh}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: true }),
  });
  console.log(`  /webhook/${wh} → ${res.status}`);
}

console.log('\nDone. Telegram credential linked from backend/.env');
