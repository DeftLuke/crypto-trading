/**
 * Continuous scan for open trades missing SL/TP on DB or Binance.
 * Alerts via Telegram + websocket; auto-recovery via tradeRecovery.js.
 */
import { getOpenTrades, logEvent } from '../services/supabase.js';
import { verifyExchangeProtection, getLivePositionQty, ensureTradeProtection, cancelOrphanProtectionOrders } from '../services/tradeProtection.js';
import { sendAlert } from '../services/telegram.js';
import { dashboardBroadcast } from '../services/wsBroadcast.js';
import { config } from '../config/index.js';

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const lastAlertByTrade = new Map();

function dbProtectionIssues(trade) {
  const issues = [];
  const sl = parseFloat(trade.stop_loss ?? trade.initial_stop_loss);
  const tp1 = parseFloat(trade.tp1);
  const tp2 = parseFloat(trade.tp2);
  if (!Number.isFinite(sl) || sl <= 0) issues.push('missing_db_sl');
  if (!Number.isFinite(tp1) || tp1 <= 0) issues.push('missing_db_tp1');
  if (!Number.isFinite(tp2) || tp2 <= 0) issues.push('missing_db_tp2');
  return issues;
}

function exchangeProtectionIssues(trade, verify) {
  const issues = [];
  if (!verify) {
    issues.push('verify_failed');
    return issues;
  }
  if (!verify.hasPosition && parseFloat(trade.quantity) > 0) {
    issues.push('orphan_db_trade_no_exchange_position');
  }
  if (verify.hasPosition && verify.slCount < 1) issues.push('missing_exchange_sl');
  if (verify.hasPosition && verify.tpCount < 1) {
    if (!trade.tp2_hit) issues.push('missing_exchange_tp');
  }
  return issues;
}

function shouldAlert(tradeId) {
  const last = lastAlertByTrade.get(tradeId) || 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
  lastAlertByTrade.set(tradeId, Date.now());
  return true;
}

export async function scanTradeSafety() {
  const { data: openTrades } = await getOpenTrades();
  const results = [];

  for (const trade of openTrades || []) {
    if (!trade?.symbol) continue;

    let verify = null;
    try {
      verify = await verifyExchangeProtection(trade.symbol);
    } catch (err) {
      await logEvent('warn', 'tradeSafety', `Verify failed: ${err.message}`, {
        symbol: trade.symbol,
        tradeId: trade.id,
      });
    }

    const liveQty = verify?.positionQty ?? await getLivePositionQty(trade.symbol).catch(() => null);
    const dbIssues = dbProtectionIssues(trade);
    const exIssues = exchangeProtectionIssues(trade, verify);

    if ((liveQty == null || liveQty <= 0) && verify && (verify.slCount > 0 || verify.tpCount > 0)) {
      await cancelOrphanProtectionOrders(trade.symbol).catch(() => {});
    }

    if (liveQty > 0 && exIssues.some((i) => i.startsWith('missing_exchange_'))) {
      await ensureTradeProtection(trade).catch(() => {});
    }

    const issues = [...new Set([...dbIssues, ...exIssues])];

    if (issues.length === 0) {
      results.push({ tradeId: trade.id, symbol: trade.symbol, ok: true });
      continue;
    }

    const record = {
      tradeId: trade.id,
      symbol: trade.symbol,
      ok: false,
      issues,
      liveQty,
      verify: verify
        ? { slCount: verify.slCount, tpCount: verify.tpCount, hasPosition: verify.hasPosition }
        : null,
    };
    results.push(record);

    await logEvent('warn', 'tradeSafety', `Unprotected trade: ${trade.symbol}`, {
      tradeId: trade.id,
      issues,
      liveQty,
      slCount: verify?.slCount,
      tpCount: verify?.tpCount,
    });

    dashboardBroadcast({
      type: 'trade_safety',
      severity: 'warn',
      trade_id: trade.id,
      symbol: trade.symbol,
      issues,
      liveQty,
    });

    if (shouldAlert(trade.id)) {
      const alertIssues = issues.filter(
        (i) => i !== 'orphan_db_trade_no_exchange_position' || config.tradeSafety?.recoveryEnabled === false,
      );
      if (alertIssues.length === 0) continue;
      await sendAlert(
        `⚠️ <b>Trade Safety Alert</b>\n\n` +
        `<b>${trade.symbol}</b> ${trade.direction || ''}\n` +
        `Issues: <code>${alertIssues.join(', ')}</code>\n` +
        `Exchange: SL×${verify?.slCount ?? '?'} TP×${verify?.tpCount ?? '?'} · pos ${liveQty ?? '—'}`,
      ).catch(() => {});
    }
  }

  return { results, openTrades: openTrades || [] };
}

class TradeSafetyMonitor {
  constructor() {
    this.running = false;
    this.interval = null;
    this.inFlight = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const ms = config.tradeSafety?.intervalMs || 30_000;
    this.interval = setInterval(() => this.tick(), ms);
    console.log(`[TradeSafety] Started — scanning every ${ms / 1000}s`);
    this.tick();
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.running = false;
  }

  async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const { results, openTrades } = await scanTradeSafety();
      const bad = results.filter((r) => !r.ok);
      if (bad.length === 0 || config.tradeSafety?.recoveryEnabled === false) return;

      const { attemptTradeRecovery } = await import('../services/tradeRecovery.js');
      for (const row of bad) {
        const trade = openTrades.find((t) => t.id === row.tradeId);
        if (trade) {
          await attemptTradeRecovery(trade, row.issues).catch((err) =>
            logEvent('error', 'tradeSafety', `Recovery failed: ${err.message}`, { tradeId: trade.id }),
          );
        }
      }
    } catch (err) {
      await logEvent('error', 'tradeSafety', err.message);
    } finally {
      this.inFlight = false;
    }
  }
}

export const tradeSafetyMonitor = new TradeSafetyMonitor();
