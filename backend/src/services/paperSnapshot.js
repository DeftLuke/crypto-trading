/**
 * Same open-position + PnL data as /api/paper/dashboard (merged DB + Binance).
 */
import { config } from '../config/index.js';

let cached = null;
let cachedAt = 0;
const CACHE_MS = 4000;

export async function getPaperDashboard({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;

  const port = config.port || 3001;
  const res = await fetch(`http://127.0.0.1:${port}/api/paper/dashboard`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Paper dashboard HTTP ${res.status}`);

  const data = await res.json();
  cached = data;
  cachedAt = Date.now();
  return data;
}

function fmtUsd(n) {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

/** Telegram HTML summary — matches Paper Trading dashboard. */
export async function formatOpenPositionsTelegram() {
  const dash = await getPaperDashboard();
  const positions = dash?.positions || [];
  const acc = dash?.accounts?.[0];
  const risk = dash?.risk || {};

  if (!positions.length) {
    return '📭 No open paper positions.';
  }

  let msg = (
    `📊 <b>Open positions (${positions.length})</b>\n` +
    `Unrealized: <b>${fmtUsd(acc?.unrealized_pnl)}</b> · Equity ${fmtUsd(acc?.equity)}\n` +
    `Exposure ~$${Number(risk.total_exposure || 0).toFixed(0)} · Margin ~$${Number(risk.total_margin || 0).toFixed(0)}\n\n`
  );

  for (const p of positions.slice(0, 10)) {
    const pnl = parseFloat(p.unrealized_pnl ?? p.pnl_usd ?? 0);
    const emoji = pnl >= 0 ? '🟢' : '🔴';
    const tags = [
      p.tp1_hit && 'TP1',
      p.tp2_hit && 'TP2',
      p.sl_moved_breakeven && 'BE',
    ].filter(Boolean).join(' ');
    msg += `${emoji} <b>${p.symbol}</b> ${p.direction} ${fmtUsd(pnl)}`;
    if (p.roe_pct != null) msg += ` (${Number(p.roe_pct).toFixed(1)}% ROE)`;
    if (tags) msg += ` · ${tags}`;
    msg += `\n   entry ${p.entry_price} → ${p.current_price ?? '—'}\n`;
  }
  if (positions.length > 10) msg += `\n…+${positions.length - 10} more`;

  return msg.trim();
}

export function paperContextPayload(dash) {
  if (!dash) return null;
  const positions = dash.positions || [];
  return {
    count: positions.length,
    unrealized_pnl: dash.accounts?.[0]?.unrealized_pnl,
    equity: dash.accounts?.[0]?.equity,
    balance: dash.accounts?.[0]?.balance,
    win_rate: dash.performance?.win_rate,
    exposure: dash.risk?.total_exposure,
    margin: dash.risk?.total_margin,
    positions: positions.map((p) => ({
      symbol: p.symbol,
      direction: p.direction,
      status: p.status,
      entry_price: p.entry_price,
      current_price: p.current_price,
      unrealized_pnl: p.unrealized_pnl,
      realized_pnl: p.realized_pnl,
      roe_pct: p.roe_pct,
      margin: p.margin,
      leverage: p.leverage,
      tp1_hit: p.tp1_hit,
      tp2_hit: p.tp2_hit,
      sl_moved_breakeven: p.sl_moved_breakeven,
    })),
  };
}
