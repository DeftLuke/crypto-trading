import { config } from '../config/index.js';
import {
  getTodayTradesCount,
  getTodayDailyPnl,
  logEvent,
} from '../services/supabase.js';
import { getUsdtBalance as getBinanceBalance } from '../services/binance.js';

export async function validateTradeExecution(signal) {
  const checks = [];
  let passed = true;

  if (signal.direction === 'IGNORE') {
    return { passed: false, checks: [{ rule: 'direction', passed: false, message: 'Signal is IGNORE' }] };
  }

  if (signal.confidence < config.strategy.minConfidence) {
    passed = false;
    checks.push({
      rule: 'confidence',
      passed: false,
      message: `Confidence ${signal.confidence} < minimum ${config.strategy.minConfidence}`,
    });
  } else {
    checks.push({ rule: 'confidence', passed: true, message: `Confidence ${signal.confidence} OK` });
  }

  const todayCount = await getTodayTradesCount();
  if (todayCount >= config.strategy.maxDailyTrades) {
    passed = false;
    checks.push({
      rule: 'max_trades',
      passed: false,
      message: `Daily trade limit reached (${todayCount}/${config.strategy.maxDailyTrades})`,
    });
  } else {
    checks.push({
      rule: 'max_trades',
      passed: true,
      message: `Trades today: ${todayCount}/${config.strategy.maxDailyTrades}`,
    });
  }

  let balance = 0;
  try {
    const bal = await getBinanceBalance();
    balance = bal.available;
  } catch {
    balance = 1000;
  }

  const dailyPnl = await getTodayDailyPnl();
  const maxLoss = balance * config.strategy.maxDailyLoss;
  if (dailyPnl < 0 && Math.abs(dailyPnl) >= maxLoss) {
    passed = false;
    checks.push({
      rule: 'daily_loss',
      passed: false,
      message: `Daily loss limit reached: ${dailyPnl.toFixed(2)} USDT`,
    });
  } else {
    checks.push({
      rule: 'daily_loss',
      passed: true,
      message: `Daily PnL: ${dailyPnl.toFixed(2)} USDT (limit: -${maxLoss.toFixed(2)})`,
    });
  }

  if (!signal.reasons?.orderBlock || signal.reasons.orderBlock.status !== 'pass') {
    passed = false;
    checks.push({
      rule: 'ob_confirmation',
      passed: false,
      message: 'OB retest confirmation required — never trade without it',
    });
  } else {
    checks.push({ rule: 'ob_confirmation', passed: true, message: 'OB retest confirmed' });
  }

  if (signal.reasons?.volatility?.status === 'fail') {
    passed = false;
    checks.push({
      rule: 'volatility',
      passed: false,
      message: 'High volatility coin blocked',
    });
  } else {
    checks.push({ rule: 'volatility', passed: true, message: 'Volatility OK' });
  }

  const riskAmount = balance * config.strategy.riskPerTrade;
  checks.push({
    rule: 'position_size',
    passed: true,
    message: `Risk amount: ${riskAmount.toFixed(2)} USDT (1%)`,
    riskAmount,
    balance,
  });

  await logEvent(passed ? 'info' : 'warn', 'riskManager', 'Trade validation', {
    signal: signal.symbol,
    passed,
    checks,
  });

  return { passed, checks, riskAmount, balance };
}

export function calculateTPQuantities(totalQty) {
  return {
    tp1Qty: parseFloat((totalQty * 0.30).toFixed(4)),
    tp2Qty: parseFloat((totalQty * 0.40).toFixed(4)),
    tp3Qty: parseFloat((totalQty * 0.30).toFixed(4)),
  };
}

export function getBreakevenSL(entryPrice, direction) {
  const buffer = entryPrice * 0.0005;
  return direction === 'LONG'
    ? entryPrice + buffer
    : entryPrice - buffer;
}

export function getLocked1RSL(entryPrice, risk, direction) {
  return direction === 'LONG'
    ? entryPrice + risk
    : entryPrice - risk;
}
