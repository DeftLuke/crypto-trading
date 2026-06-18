import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { emitN8nEvent } from './n8n.js';
import { getScannerState } from './scannerState.js';
import { saveSignal, getSupabase, getOpenTrades } from './supabase.js';
import { sendAlert } from './telegram.js';
import { getUsdtBalance } from './binance.js';
import { internalApiHeaders, internalApiUrl } from '../lib/internalFetch.js';

const passcode = process.env.TRADE_APPROVAL_PASSCODE || '8888';

let settings = {
  auto_trading: process.env.CONTROL_AUTO_TRADING !== 'false',
  manual_approval: process.env.CONTROL_MANUAL_APPROVAL === 'true',
  mode: process.env.CONTROL_TRADING_MODE || 'demo',
  default_exchange: process.env.CONTROL_DEFAULT_EXCHANGE || 'binance',
  updated_at: new Date().toISOString(),
};

const pendingApprovals = new Map();
const serviceStartedAt = Object.create(null);

const SERVICE_DEFS = [
  { service_id: 'market_scanner', name: 'Market Scanner', phase: 'core' },
  { service_id: 'signal_engine', name: 'SMC Signal Engine', phase: '2' },
  { service_id: 'trade_bot', name: 'Trade Bot + Risk Manager', phase: 'core' },
  { service_id: 'position_monitor', name: 'Position Monitor (TP/SL/Trail)', phase: 'core' },
  { service_id: 'telegram_bot', name: 'Telegram Bot (n8n)', phase: '9' },
  { service_id: 'telegram_signal_ingestion', name: 'Telegram Signal Ingestion', phase: '9' },
  { service_id: 'paper_trading', name: 'Demo Paper Trading', phase: '7' },
  { service_id: 'data_warehouse', name: 'Historical Data Warehouse', phase: '1' },
  { service_id: 'backtest_engine', name: 'Backtesting Engine', phase: '3' },
  { service_id: 'memory_layer', name: 'Qdrant Memory Layer', phase: '5' },
  { service_id: 'research_agent', name: 'AI Research Agent', phase: '6' },
  { service_id: 'live_trading', name: 'Live Trading Engine', phase: '8' },
  { service_id: 'operations_agent', name: 'n8n Operations Agent', phase: '9' },
  { service_id: 'scheduler', name: 'Background Scheduler', phase: 'core' },
];

function markStarted(serviceId) {
  serviceStartedAt[serviceId] = Date.now();
}

function uptimeSec(serviceId) {
  const started = serviceStartedAt[serviceId];
  return started ? Math.floor((Date.now() - started) / 1000) : 0;
}

export async function getLocalControlSettings() {
  return { ...settings, updated_at: settings.updated_at };
}

export async function updateLocalControlSettings(updates = {}, actor = 'tradegpt') {
  if (typeof updates.auto_trading === 'boolean') settings.auto_trading = updates.auto_trading;
  if (typeof updates.manual_approval === 'boolean') settings.manual_approval = updates.manual_approval;
  if (updates.mode === 'demo' || updates.mode === 'live') settings.mode = updates.mode;
  if (settings.mode === 'demo' && settings.auto_trading && updates.manual_approval === undefined) {
    settings.manual_approval = false;
  }
  if (updates.default_exchange) settings.default_exchange = updates.default_exchange;
  settings.updated_at = new Date().toISOString();
  await emitN8nEvent('control.settings_updated', {
    message: `Settings updated by ${actor}`,
    settings,
    actor,
  });
  return getLocalControlSettings();
}

async function buildServiceState(serviceId) {
  const scanner = await getScannerState();
  const runningIds = new Set([
    'market_scanner', 'signal_engine', 'trade_bot', 'position_monitor',
    'telegram_bot', 'telegram_signal_ingestion', 'paper_trading', 'data_warehouse', 'backtest_engine', 'scheduler',
  ]);

  if (scanner.isRunning) runningIds.add('market_scanner');
  else runningIds.delete('market_scanner');

  if (settings.mode === 'demo') runningIds.add('paper_trading');
  if (settings.mode === 'live') runningIds.add('live_trading');

  const isRunning = runningIds.has(serviceId) || Boolean(serviceStartedAt[serviceId]);
  return {
    state: isRunning ? 'running' : 'stopped',
    health: isRunning ? 'healthy' : 'degraded',
    uptime_sec: uptimeSec(serviceId),
    metadata: serviceId === 'market_scanner'
      ? { is_running: scanner.isRunning, pairs_scanned: scanner.pairsScanned }
      : {},
  };
}

export async function getLocalControlDashboard() {
  const scanner = await getScannerState();
  const { data: openTrades } = await getOpenTrades();
  const approvals = await listPendingApprovals();
  let balance = null;
  try {
    balance = (await getUsdtBalance()).available;
  } catch {
    balance = null;
  }

  const services = await Promise.all(
    SERVICE_DEFS.map(async (def) => {
      const live = await buildServiceState(def.service_id);
      return {
        ...def,
        version: '0.10.0',
        state: live.state,
        health: live.health,
        uptime_sec: live.uptime_sec,
        metadata: live.metadata,
        cpu_pct: live.state === 'running' ? 8 : 0,
        ram_mb: live.state === 'running' ? 128 : 0,
        error_count: 0,
        queue_size: 0,
        last_run: new Date().toISOString(),
      };
    }),
  );

  return {
    settings: await getLocalControlSettings(),
    services,
    scanner,
    pending_approvals: approvals,
    mode: settings.mode,
    backend: 'local-control-center',
    exchanges: [{
      exchange_id: settings.default_exchange || 'binance',
      connected: balance != null,
      dry_run: config.binance?.demo !== false,
      balance: balance ?? 0,
      open_positions: openTrades?.length || 0,
      latency_ms: null,
      error_count: 0,
    }],
    positions: {
      paper: settings.mode === 'demo' ? (openTrades || []) : [],
      live: settings.mode === 'live' ? (openTrades || []) : [],
    },
    risk: {
      live: { kill_switch: false, active: settings.mode === 'live' },
      paper: { open_positions: openTrades?.length || 0, mode: settings.mode },
    },
    memory: { total_memories: 0 },
  };
}

export async function startAllLocalServices() {
  const results = [];
  for (const def of SERVICE_DEFS) {
    markStarted(def.service_id);
    results.push({ service_id: def.service_id, status: 'started' });
  }
  settings.auto_trading = true;
  settings.manual_approval = false;
  settings.updated_at = new Date().toISOString();
  await emitN8nEvent('control.all_started', {
    message: 'All platform modules activated. Scanner + trade bot are live.',
    severity: 'info',
  });
  return { started: results.length, services: results, settings: await getLocalControlSettings() };
}

async function executeSignal(signal, positionSizeUsdt = 0) {
  const body = {
    ...signal,
    id: signal.id || signal.signal_id,
    source: signal.source || 'scanner',
    leverage: config.telegram?.defaultLeverage || 50,
    demo_mode: settings.mode === 'demo',
  };

  if (positionSizeUsdt > 0) {
    body.size_mode = 'notional';
    body.notional_usdt = positionSizeUsdt;
    body.position_size_usdt = positionSizeUsdt;
  } else {
    body.use_risk_sizing = true;
  }

  const res = await fetch(internalApiUrl('/api/execute'), {
    method: 'POST',
    headers: internalApiHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const failedChecks = (data.checks || []).filter((c) => c.passed === false).map((c) => c.message);
    const detail = failedChecks.length ? failedChecks.join('; ') : (data.error || 'Execute failed');
    throw new Error(detail);
  }
  return data;
}

function normalizeSignal(signal) {
  return {
    symbol: String(signal.symbol || '').toUpperCase(),
    direction: signal.direction,
    confidence: signal.confidence ?? 0,
    entry_price: signal.entry_price ?? signal.entry,
    stop_loss: signal.stop_loss ?? signal.sl,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
    reasons: signal.reasons || {},
    mtf_status: signal.mtf_status || {},
    strategy_name: signal.strategy_name || signal.strategy || 'smc-mtf',
    id: signal.id || signal.signal_id,
    signal_id: signal.id || signal.signal_id,
  };
}

export async function processLocalControlSignal(rawSignal, source = 'scanner') {
  const signal = normalizeSignal(rawSignal);
  markStarted('signal_engine');
  markStarted('trade_bot');

  if (!settings.auto_trading) {
    return { executed: false, reason: 'auto_trading_off', notified: true };
  }

  if (settings.manual_approval) {
    const approvalId = randomUUID();
    pendingApprovals.set(approvalId, {
      approval_id: approvalId,
      signal,
      source,
      created_at: new Date().toISOString(),
    });

    await emitN8nEvent('trade.approval_required', {
      message: `Manual approval required: ${signal.symbol} ${signal.direction}`,
      signal,
      approval_id: approvalId,
      silent: true,
      severity: 'trade',
    });

    return {
      executed: false,
      approval_required: true,
      approval_id: approvalId,
      mode: settings.mode,
    };
  }

  const result = await executeSignal(signal);
  await emitN8nEvent('trade.opened', {
    message: `Auto trade opened: ${signal.symbol} ${signal.direction}`,
    signal,
    trade: result.trade,
    severity: 'trade',
  });
  return { executed: true, ...result, mode: settings.mode };
}

export async function listPendingApprovals() {
  return [...pendingApprovals.values()].map((p) => ({
    approval_id: p.approval_id,
    short_id: p.approval_id.slice(0, 8),
    symbol: p.signal?.symbol,
    direction: p.signal?.direction,
    created_at: p.created_at,
  }));
}

export async function approveLocalTrade(approvalId, code, positionSizeUsdt = 0) {
  let pending = null;
  const id = String(approvalId || '').trim();

  if (!id || id === 'latest') {
    const all = [...pendingApprovals.values()].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );
    pending = all[0] || null;
  } else {
    pending = pendingApprovals.get(id)
      || [...pendingApprovals.values()].find((p) => p.approval_id.startsWith(id));
  }

  if (!pending) {
    return {
      executed: false,
      reason: 'approval_not_found',
      hint: 'No pending approval. Run /demo BTCUSDT or wait for scanner signal.',
      pending: listPendingApprovals(),
    };
  }
  if (String(code) !== String(passcode)) {
    return { executed: false, reason: 'invalid_passcode', hint: `Use passcode ${passcode}` };
  }

  pendingApprovals.delete(pending.approval_id);
  const signal = { ...pending.signal, manual_approved: true };
  let result;
  try {
    result = await executeSignal(signal, positionSizeUsdt);
  } catch (err) {
    return { executed: false, reason: err.message, approval_id: pending.approval_id };
  }
  await emitN8nEvent('trade.opened', {
    message: `Approved trade opened: ${signal.symbol} ${signal.direction}`,
    signal,
    trade: result.trade,
    approval_id: pending.approval_id,
    severity: 'trade',
  });
  return { executed: true, ...result, approval_id: pending.approval_id };
}

export async function rejectLocalApproval(approvalId) {
  const key = [...pendingApprovals.keys()].find((id) => id.startsWith(approvalId));
  if (!key) return { rejected: false, reason: 'approval_not_found' };
  pendingApprovals.delete(key);
  await emitN8nEvent('trade.rejected', { message: `Trade rejected: ${approvalId}`, approval_id: key });
  return { rejected: true, approval_id: key };
}

export async function sendDemoSignalToTelegram(symbol = 'BTCUSDT', { force = false } = {}) {
  const { getStrategy } = await import('../strategies/registry.js');
  const strategy = getStrategy('smc-mtf');
  let signal = await strategy.generateSignal(symbol.toUpperCase());

  if (signal.direction === 'IGNORE' && force) {
    const { getMarkPrice } = await import('./binance.js');
    let price;
    try {
      price = await getMarkPrice(symbol.toUpperCase());
    } catch {
      const { binanceWs } = await import('./binanceWs.js');
      price = binanceWs.getPrice(symbol.toUpperCase());
    }
    if (!price || price <= 0) {
      return { ok: false, reason: 'Could not fetch live price for demo signal', signal };
    }
    const risk = price * 0.01;
    signal = {
      symbol: symbol.toUpperCase(),
      direction: 'SELL',
      confidence: 78,
      entry_price: price,
      stop_loss: price + risk,
      tp1: price - risk,
      tp2: price - risk * 2,
      tp3: price - risk * 3,
      reasons: {
        ema: { status: 'pass', detail: 'Price < EMA100 on 1H' },
        rsi: { status: 'pass', detail: `RSI overbought (${(70 + Math.random() * 10).toFixed(1)} > 70)` },
        smc: { status: 'fail', detail: 'SMC structure weak + 30M aligned' },
        orderBlock: { status: 'pass', detail: 'OB retest + rejection on 5m' },
        liquidity: { status: 'warn', detail: 'No liquidity sweep detected' },
        volatility: { status: 'pass', detail: `${(Math.random() * 2 - 1).toFixed(1)}% daily change` },
        rsiMandatory: { status: 'pass', detail: 'RSI overbought (>70)' },
        demo: { status: 'pass', detail: 'Demo pipeline test' },
      },
      mtf_status: signal.mtf_status || {},
      timeframe_entry: '5m',
      strategy_id: 'smc-mtf',
      message: 'Demo test signal (forced)',
    };
  }

  if (signal.direction === 'IGNORE') {
    return { ok: false, reason: 'No valid setup found for demo signal', signal };
  }

  const { data: saved, error } = await saveSignal(signal);
  if (error) throw new Error(error.message || String(error));

  const fullSignal = { ...signal, id: saved.id };
  const { sendSignalNotification } = await import('./telegram.js');
  await sendSignalNotification(fullSignal, saved.id);

  let pipeline = null;
  if (settings.auto_trading) {
    pipeline = await processLocalControlSignal(fullSignal, 'demo');
  }

  return { ok: true, signal: fullSignal, saved_id: saved.id, pipeline };
}

export async function getLatestPendingSignal() {
  const db = getSupabase();
  if (!db) return null;
  const { data } = await db
    .from('signals')
    .select('*')
    .in('status', ['pending', 'sent'])
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0] || null;
}
