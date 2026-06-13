import { config } from '../config/index.js';
import fs from 'fs/promises';

const { url, username, password, enabled, configPath } = config.freqtrade;

let accessToken = null;
let tokenExpires = 0;

async function login() {
  if (accessToken && Date.now() < tokenExpires) return accessToken;

  const res = await fetch(`${url}/api/v1/token/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Freqtrade login failed (${res.status}): ${text.slice(0, 120)}`);
  }

  const data = await res.json();
  accessToken = data.access_token;
  tokenExpires = Date.now() + 25 * 60 * 1000;
  return accessToken;
}

async function ftFetch(path, options = {}) {
  const token = await login();
  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(options.timeout || 15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Freqtrade ${path} (${res.status}): ${text.slice(0, 200)}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function pingFreqtrade() {
  if (!enabled || !password) {
    return { online: false, reason: 'Freqtrade not configured (set FREQTRADE_API_PASSWORD)' };
  }
  try {
    await fetch(`${url}/api/v1/ping`, { signal: AbortSignal.timeout(5000) });
    const status = await ftFetch('/api/v1/show_config');
    return {
      online: true,
      dryRun: status.dry_run,
      state: status.state,
      strategy: status.strategy,
      stakeCurrency: status.stake_currency,
      maxOpenTrades: status.max_open_trades,
    };
  } catch (err) {
    return { online: false, reason: err.message };
  }
}

export async function getFreqtradeStatus() {
  return ftFetch('/api/v1/status');
}

export async function getFreqtradeProfit() {
  return ftFetch('/api/v1/profit');
}

export async function getFreqtradeBalance() {
  return ftFetch('/api/v1/balance');
}

export async function getFreqtradeTrades(limit = 50) {
  return ftFetch(`/api/v1/trades?limit=${limit}`);
}

export async function listFreqtradeStrategies() {
  try {
    const data = await ftFetch('/api/v1/strategies');
    return data.strategies || [];
  } catch {
    return ['TradeGPT_RSI_Momentum', 'TradeGPT_EMA_Crossover'];
  }
}

export async function startFreqtradeBot() {
  return ftFetch('/api/v1/start', { method: 'POST', body: '{}' });
}

export async function stopFreqtradeBot() {
  return ftFetch('/api/v1/stop', { method: 'POST', body: '{}' });
}

export async function getFreqtradeDaily(days = 7) {
  return ftFetch(`/api/v1/daily?timescale=${days}`);
}

export async function setFreqtradeStrategy(strategyName) {
  if (!configPath) {
    throw new Error('FREQTRADE_CONFIG_PATH not configured');
  }
  const raw = await fs.readFile(configPath, 'utf8');
  const cfg = JSON.parse(raw);
  cfg.strategy = strategyName;
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
  await ftFetch('/api/v1/reload_config', { method: 'POST', body: '{}' });
  return { strategy: strategyName, reloaded: true };
}

export async function forceExitFreqtrade(tradeId = 'all') {
  const payload = tradeId === 'all' ? { tradeid: 'all' } : { tradeid: tradeId };
  return ftFetch('/api/v1/forceexit', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getFreqtradeStatsBundle() {
  const ping = await pingFreqtrade();
  if (!ping.online) {
    return { engine: 'freqtrade', online: false, reason: ping.reason };
  }
  const [openTrades, profit, balance] = await Promise.all([
    getFreqtradeStatus().catch(() => []),
    getFreqtradeProfit().catch(() => null),
    getFreqtradeBalance().catch(() => null),
  ]);
  return {
    engine: 'freqtrade',
    online: true,
    ping,
    openTrades,
    profit,
    balance,
    trades: {
      total: (profit?.winning_trades || 0) + (profit?.losing_trades || 0),
      open: openTrades?.length || 0,
      wins: profit?.winning_trades || 0,
      losses: profit?.losing_trades || 0,
      winRate: profit?.winrate ? profit.winrate * 100 : 0,
      totalPnl: profit?.profit_all_coin || 0,
    },
  };
}

export function getFreqtradePublicInfo() {
  return {
    enabled,
    publicUrl: config.freqtrade.publicUrl,
    localUrl: url,
    strategiesPath: 'freqtrade/user_data/strategies/',
    docsUrl: 'https://www.freqtrade.io/en/stable/',
    repoUrl: 'https://github.com/freqtrade/freqtrade',
  };
}
