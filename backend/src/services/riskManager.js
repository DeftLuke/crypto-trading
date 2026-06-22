import { config } from '../config/index.js';
import {
  getTodayTradesCount,
  getTodayDailyPnl,
  logEvent,
} from '../services/supabase.js';
import { getUsdtBalance as getBinanceBalance } from '../services/binance.js';

export async function validateTradeExecution(signal) {
  const isTelegram = isTelegramSource(signal);
  if (isTelegram) return validateTelegramTradeExecution(signal);
  return validateScannerTradeExecution(signal);
}

function isTelegramSource(signal) {
  return signal.source === 'telegram'
    || signal.strategy_name?.includes('telegram')
    || Boolean(signal.reasons?.external_provider);
}

function isDemoTestMode(signal = {}) {
  return config.externalSignals?.testMode === true;
}

function isUnlimitedDemoTest(signal = {}) {
  if (config.binance?.demo || config.binance?.testnet) {
    return signal.source === 'telegram' || signal.manual_approved === true || signal.test_levels_refreshed === true;
  }
  return isDemoTestMode(signal) && (
    signal.manual_approved === true
    || signal.test_levels_refreshed === true
    || signal.source === 'telegram'
  );
}

async function validateScannerTradeExecution(signal) {
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
  if (!isDemoTestMode(signal) && todayCount >= config.strategy.maxDailyTrades) {
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
      message: isDemoTestMode(signal)
        ? `Demo test mode — unlimited (${todayCount} today)`
        : `Trades today: ${todayCount}/${config.strategy.maxDailyTrades}`,
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
  if (!isDemoTestMode(signal) && dailyPnl < 0 && Math.abs(dailyPnl) >= maxLoss) {
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

  const manualOk = signal.manual_approved === true || signal.reasons?.demo?.status === 'pass';
  const ob = signal.reasons?.orderBlock;
  const obPass = ob?.status === 'pass'
    || (ob?.status === 'partial' && (signal.confidence || 0) >= config.strategy.minConfidence)
    || (ob?.status === 'neutral' && (signal.confidence || 0) >= 80);
  if (!manualOk && !obPass) {
    passed = false;
    checks.push({
      rule: 'ob_confirmation',
      passed: false,
      message: ob?.detail || 'OB retest confirmation required — never trade without it',
    });
  } else {
    checks.push({
      rule: 'ob_confirmation',
      passed: true,
      message: manualOk ? 'Manual approval override' : (ob?.detail || 'OB retest confirmed'),
    });
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

  const rsiDetail = signal.reasons?.rsiMandatory || signal.reasons?.rsi;
  if (rsiDetail?.status === 'fail') {
    passed = false;
    checks.push({ rule: 'rsi_mandatory', passed: false, message: rsiDetail.detail || 'RSI gate failed' });
  } else {
    checks.push({ rule: 'rsi_mandatory', passed: true, message: rsiDetail?.detail || 'RSI OK' });
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

/** Telegram VIP signals: skip EMA/RSI/OB gates; keep risk limits and SL/TP requirements. */
export async function validateTelegramTradeExecution(signal) {
  const checks = [];
  let passed = true;

  if (signal.direction === 'IGNORE') {
    return { passed: false, checks: [{ rule: 'direction', passed: false, message: 'Signal is IGNORE' }] };
  }

  if (!signal.stop_loss || !signal.tp1 || !signal.tp2) {
    passed = false;
    checks.push({ rule: 'protection', passed: false, message: 'Telegram signal must include SL, TP1, and TP2' });
  } else {
    checks.push({ rule: 'protection', passed: true, message: 'SL/TP levels present' });
  }

  const minConfidence = config.externalSignals?.minValidationScore || config.strategy.minConfidence;
  if (!signal.manual_approved && (signal.confidence || 0) < minConfidence) {
    passed = false;
    checks.push({
      rule: 'confidence',
      passed: false,
      message: `Validation score ${signal.confidence || 0} < minimum ${minConfidence}`,
    });
  } else {
    checks.push({ rule: 'confidence', passed: true, message: `Validation score ${signal.confidence} OK` });
  }

  const testMode = config.externalSignals?.testMode === true;
  const manualTest = testMode && (signal.manual_approved === true || signal.test_levels_refreshed === true);
  const unlimitedDemo = isUnlimitedDemoTest(signal);

  const todayCount = await getTodayTradesCount();
  if (!unlimitedDemo && !manualTest && todayCount >= config.strategy.maxDailyTrades) {
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
      message: unlimitedDemo || manualTest
        ? `Demo test mode — unlimited (${todayCount} today)`
        : `Trades today: ${todayCount}/${config.strategy.maxDailyTrades}`,
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
  if (!unlimitedDemo && !isDemoTestMode(signal) && dailyPnl < 0 && Math.abs(dailyPnl) >= maxLoss) {
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

  if (signal.reasons?.volatility?.status === 'fail') {
    passed = false;
    checks.push({ rule: 'volatility', passed: false, message: 'High volatility coin blocked' });
  } else {
    checks.push({ rule: 'volatility', passed: true, message: 'Volatility OK' });
  }

  if (signal.expires_at && !manualTest) {
    const expired = Date.now() > new Date(signal.expires_at).getTime();
    if (expired) {
      passed = false;
      checks.push({ rule: 'freshness', passed: false, message: 'Signal expired — too old to trade' });
    } else {
      checks.push({ rule: 'freshness', passed: true, message: `Valid until ${signal.expires_at}` });
    }
  } else if (manualTest) {
    checks.push({ rule: 'freshness', passed: true, message: 'Test mode — freshness skipped for manual approve' });
  }

  checks.push({ rule: 'ema_gate', passed: true, message: 'Skipped for Telegram VIP signal' });
  checks.push({ rule: 'rsi_mandatory', passed: true, message: 'Skipped for Telegram VIP signal' });
  checks.push({ rule: 'ob_confirmation', passed: true, message: 'Skipped for Telegram VIP signal' });

  const riskAmount = balance * config.strategy.riskPerTrade;
  checks.push({
    rule: 'position_size',
    passed: true,
    message: `Risk amount: ${riskAmount.toFixed(2)} USDT (1%)`,
    riskAmount,
    balance,
  });

  await logEvent(passed ? 'info' : 'warn', 'riskManager', 'Telegram trade validation', {
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
    ? entryPrice - buffer
    : entryPrice + buffer;
}

export function getLocked1RSL(entryPrice, risk, direction) {
  return direction === 'LONG'
    ? entryPrice + risk
    : entryPrice - risk;
}
