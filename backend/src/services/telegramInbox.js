import { config } from '../config/index.js';
import { ingestExternalSignal } from './externalSignalIngestion.js';
import { getDefaultTradeParams } from './telegramTrade.js';
import { getOpenTrades, getSupabase, logEvent, updateTelegramSignalMessage } from './supabase.js';
import { broadcastTelegramPipeline, broadcastTradeEvent } from './wsBroadcast.js';
import { getControlSettings } from './researchApi.js';
import { getLocalControlSettings } from './controlCenter.js';
import { internalApiHeaders, internalApiUrl } from '../lib/internalFetch.js';
import { prepareTelegramSignalForExecution } from './telegramSignalLevels.js';

/** Prevent concurrent approve/execute for the same inbox message. */
const inboxExecuting = new Set();

function sideToDirection(side) {
  const s = String(side || '').toUpperCase();
  return s === 'SHORT' || s === 'SELL' ? 'SELL' : 'BUY';
}

export async function getTelegramMessageById(id) {
  const db = getSupabase();
  if (!db) return { data: null, error: new Error('Database unavailable') };
  return db
    .from('telegram_signal_messages')
    .select('*, telegram_signal_sources(title, username, is_followed)')
    .eq('id', id)
    .single();
}

export function normalizeSymbol(symbol) {
  return String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function getActiveSymbolLocks(excludeMessageId = null) {
  const locks = new Map();

  const { data: openTrades } = await getOpenTrades();
  for (const trade of openTrades || []) {
    const sym = normalizeSymbol(trade.symbol);
    if (sym) {
      locks.set(sym, {
        source: 'open_trade',
        tradeId: trade.id,
        reason: `Open ${sym} position already active`,
      });
    }
  }

  const db = getSupabase();
  if (db) {
    const { data: rows } = await db
      .from('telegram_signal_messages')
      .select('id, parsed_signal, api_result, telegram_signal_sources(title)')
      .eq('parse_status', 'parsed');
    for (const row of rows || []) {
      if (excludeMessageId && row.id === excludeMessageId) continue;
      if (!row.api_result?.approved && !row.api_result?.executed) continue;
      const sym = normalizeSymbol(row.parsed_signal?.symbol);
      if (!sym || locks.has(sym)) continue;
      locks.set(sym, {
        source: 'telegram_approved',
        messageId: row.id,
        group: row.telegram_signal_sources?.title,
        reason: `${sym} already approved from ${row.telegram_signal_sources?.title || 'another group'}`,
      });
    }
  }

  return locks;
}

export function symbolBlockForMessage(message, locks) {
  const sym = normalizeSymbol(message.parsed_signal?.symbol);
  if (!sym) return { symbol_blocked: false, symbol_block_reason: null };
  const lock = locks.get(sym);
  if (!lock) return { symbol_blocked: false, symbol_block_reason: null };
  if (lock.messageId === message.id) {
    return { symbol_blocked: false, symbol_block_reason: null };
  }
  return { symbol_blocked: true, symbol_block_reason: lock.reason || `${sym} already in use` };
}

export async function assertSymbolAvailableForApprove(message) {
  const sym = normalizeSymbol(message.parsed_signal?.symbol);
  if (!sym) return { ok: false, error: 'Signal has no symbol' };
  const locks = await getActiveSymbolLocks(message.id);
  const block = symbolBlockForMessage(message, locks);
  if (block.symbol_blocked) {
    return { ok: false, error: block.symbol_block_reason || `${sym} already has an active trade or approval` };
  }
  return { ok: true };
}

export function parsedSignalToPayload(message) {
  const ps = message.parsed_signal || {};
  const tps = Array.isArray(ps.take_profit) ? ps.take_profit : [];
  const source = message.telegram_signal_sources || {};
  return {
    provider: ps.provider || source.title || 'telegram',
    symbol: ps.symbol,
    side: ps.side,
    entry: ps.entry,
    stop_loss: ps.stop_loss,
    take_profit: tps,
    tp1: tps[0],
    tp2: tps[1],
    tp3: tps[2],
    confidence: ps.confidence,
    parser: ps.parser,
    raw_message: message.raw_message,
    timestamp: ps.timestamp || message.message_date || message.received_at,
    provider_message_id: ps.provider_message_id || message.message_id,
    source_chat_id: ps.source_chat_id || message.telegram_chat_id,
    metadata: {
      ...(ps.metadata || {}),
      group_title: ps.metadata?.group_title || source.title || null,
    },
  };
}

export function needsRevalidation(message) {
  if (message.parse_status !== 'parsed' || !message.parsed_signal) return false;
  const result = message.api_result || {};
  if (result.approved || result.executed) return false;
  if (result.passed === true || result.ready_to_approve || result.pipeline_stage === 'validated') return false;
  if (result.ok === false || result.status === 500) return true;
  const errMsg = typeof result.error === 'string' ? result.error : result.error?.error;
  return errMsg === 'fetch failed';
}

export async function revalidateTelegramMessage(messageId) {
  const { data: message, error } = await getTelegramMessageById(messageId);
  if (error || !message) {
    return { ok: false, error: 'Message not found' };
  }
  if (message.parse_status !== 'parsed' || !message.parsed_signal) {
    return { ok: false, error: 'Message is not a parsed trading signal' };
  }

  const payload = parsedSignalToPayload(message);
  const result = await ingestExternalSignal(payload, {
    validateOnly: true,
    allowStale: config.externalSignals.testMode,
    testMode: config.externalSignals.testMode,
    skipScoreGate: config.externalSignals.testMode,
  });

  const apiResult = {
    ok: true,
    passed: result.passed,
    accepted: result.accepted,
    reason: result.reason,
    stale: result.stale,
    test_mode: config.externalSignals.testMode,
    ready_to_approve: Boolean(result.passed),
    pipeline_stage: result.passed ? 'validated' : 'rejected',
    validation: result.validation,
    checks: result.validation?.checks || result.checks,
    signal: result.signal,
    revalidated_at: new Date().toISOString(),
    scrape: message.api_result?.scrape,
  };

  await updateTelegramSignalMessage(messageId, { api_result: apiResult });
  broadcastTelegramPipeline(
    { ...message, api_result: apiResult },
    result.passed ? 'validated' : 'rejected',
  );

  return {
    ok: true,
    passed: result.passed,
    ready_to_approve: apiResult.ready_to_approve,
    api_result: apiResult,
    validation: result.validation,
  };
}

export async function revalidateTelegramMessages(messages = []) {
  const targets = messages.filter(needsRevalidation);
  const results = [];
  for (const message of targets) {
    try {
      const row = await revalidateTelegramMessage(message.id);
      results.push({ id: message.id, ...row });
    } catch (err) {
      results.push({ id: message.id, ok: false, error: err.message });
    }
  }
  return results;
}

export async function markTelegramPipelineStage(messageId, stage, patch = {}) {
  const { data: message, error } = await getTelegramMessageById(messageId);
  if (error || !message) return null;
  const apiResult = {
    ...(message.api_result || {}),
    pipeline_stage: stage,
    ...patch,
  };
  await updateTelegramSignalMessage(messageId, { api_result: apiResult });
  broadcastTelegramPipeline({ ...message, api_result: apiResult }, stage);
  return { ...message, api_result: apiResult };
}

export async function approveTelegramInboxMessage(messageId, { marginUsdt = 0, leverage, autoMode = false, useRiskSizing = false } = {}) {
  if (inboxExecuting.has(messageId)) {
    return { ok: false, error: 'Execution already in progress for this message' };
  }
  inboxExecuting.add(messageId);
  try {
  const { data: message, error } = await getTelegramMessageById(messageId);
  if (error || !message) {
    return { ok: false, error: 'Message not found' };
  }
  if (message.parse_status !== 'parsed' || !message.parsed_signal) {
    return { ok: false, error: 'Message is not a parsed trading signal' };
  }
  if (message.api_result?.executed) {
    return { ok: false, error: 'Signal already executed' };
  }

  const symbolCheck = await assertSymbolAvailableForApprove(message);
  if (!symbolCheck.ok) {
    return { ok: false, error: symbolCheck.error };
  }

  await markTelegramPipelineStage(messageId, 'executing', {
    auto_executed: autoMode,
    last_error: null,
  });

  const prepared = await prepareTelegramSignalForExecution(message.parsed_signal);
  if (!prepared.ok) {
    const err = prepared.error || prepared.levelIssues?.[0]?.message || 'Signal levels not tradeable';
    await updateTelegramSignalMessage(messageId, {
      api_result: {
        ...(message.api_result || {}),
        last_error: err,
        pipeline_stage: 'execution_blocked',
        level_issues: prepared.levelIssues,
      },
    });
    broadcastTelegramPipeline({ ...message, api_result: { last_error: err } }, 'approve_failed');
    return { ok: false, error: err, level_issues: prepared.levelIssues };
  }

  let workingMessage = message;
  if (prepared.levelsAdapted) {
    await updateTelegramSignalMessage(messageId, { parsed_signal: prepared.parsed });
    workingMessage = { ...message, parsed_signal: prepared.parsed };
  }

  const payload = parsedSignalToPayload(workingMessage);
  const settings = await getControlSettings();
  const telegramAuto = autoMode || (settings?.auto_trading && !settings?.manual_approval);
  const ingested = await ingestExternalSignal(payload, {
    testMode: config.externalSignals.testMode,
    allowStale: telegramAuto || prepared.levelsAdapted || config.externalSignals.testMode,
    skipScoreGate: telegramAuto || config.externalSignals.testMode,
  });

  if (!ingested.accepted || !ingested.passed) {
    const failReason = ingested.reason || 'Failed validation at execution';
    await updateTelegramSignalMessage(messageId, {
      api_result: {
        ...(workingMessage.api_result || {}),
        last_error: failReason,
        pipeline_stage: 'rejected',
        validation: ingested.validation,
      },
    });
    return {
      ok: false,
      error: failReason,
      validation: ingested.validation,
    };
  }

  if (!ingested.signal?.id) {
    return { ok: false, error: ingested.reason || 'Failed to register signal', validation: ingested.validation };
  }

  const defaults = await getDefaultTradeParams({
    entry: ingested.signal.entry_price || payload.entry,
    stopLoss: ingested.signal.stop_loss || payload.stop_loss,
    symbol: payload.symbol,
  });
  const useLeverage = parseInt(leverage || defaults.leverage || config.telegram.defaultLeverage || 50, 10);
  const customNotional = !useRiskSizing && !autoMode && parseFloat(marginUsdt) > 0
    ? parseFloat(marginUsdt)
    : 0;

  const execBody = {
    ...ingested.signal,
    id: ingested.signal.id,
    source: 'telegram',
    manual_approved: !autoMode,
    auto_executed: autoMode,
    test_levels_refreshed: Boolean(
      workingMessage.api_result?.test_levels_refreshed || prepared.levelsAdapted,
    ),
    levels_adapted: prepared.levelsAdapted,
    adapt_mark_price: prepared.markPrice,
    leverage: useLeverage,
    direction: ingested.signal.direction || sideToDirection(payload.side),
    entry_price: ingested.signal.entry_price || payload.entry,
    stop_loss: ingested.signal.stop_loss || payload.stop_loss,
    tp1: ingested.signal.tp1 || payload.tp1,
    tp2: ingested.signal.tp2 || payload.tp2,
    tp3: ingested.signal.tp3 || payload.tp3,
  };

  if (customNotional > 0) {
    execBody.size_mode = 'notional';
    execBody.notional_usdt = customNotional;
    execBody.position_size_usdt = customNotional;
  } else {
    execBody.use_risk_sizing = true;
  }

  const execRes = await fetch(internalApiUrl('/api/execute'), {
    method: 'POST',
    headers: internalApiHeaders(),
    body: JSON.stringify(execBody),
  });
  const execution = await execRes.json();
  const tradeMargin = execution.trade?.margin_usdt ?? defaults.margin_usdt;

  const apiResult = {
    ...(workingMessage.api_result || {}),
    approved: Boolean(execution.success),
    approved_at: execution.success ? new Date().toISOString() : workingMessage.api_result?.approved_at,
    executed: Boolean(execution.success),
    execution,
    protection: execution.protection || null,
    trade_id: execution.trade?.id || null,
    signal_id: ingested.signal.id,
    margin_usdt: tradeMargin,
    leverage: execution.trade?.leverage || useLeverage,
    last_error: execution.success ? null : (execution.error || execution.reason || execution.stale_levels?.[0]?.message || null),
    levels_adapted: prepared.levelsAdapted,
    adapt_mark_price: prepared.markPrice,
    pipeline_stage: execution.success ? 'executed' : 'approve_failed',
  };

  await updateTelegramSignalMessage(messageId, {
    api_result: apiResult,
    parsed_signal: workingMessage.parsed_signal,
    signal_id: ingested.signal.id,
  });
  broadcastTelegramPipeline(
    { ...workingMessage, api_result: apiResult, parsed_signal: workingMessage.parsed_signal },
    execution.success ? 'executed' : 'approve_failed',
  );

  if (!execRes.ok || !execution.success) {
    await logEvent('warn', 'telegramInbox', 'Approve failed at execution', {
      messageId,
      symbol: payload.symbol,
      error: execution.error || execution.reason,
    });
    return {
      ok: false,
      error: execution.error || execution.reason || 'Execution failed',
      signal: ingested.signal,
      validation: ingested.validation,
      execution,
      checks: execution.checks,
    };
  }

  await logEvent('trade', 'telegramInbox', `Approved & executed ${payload.symbol}`, {
    messageId,
    signalId: ingested.signal.id,
    tradeId: execution.trade?.id,
    marginUsdt: tradeMargin,
  });

  if (execution.trade) {
    broadcastTradeEvent('opened', execution.trade, { source: 'telegram', margin_usdt: tradeMargin });
  }

  return {
    ok: true,
    signal: ingested.signal,
    execution,
    margin_usdt: tradeMargin,
    leverage: execution.trade?.leverage || useLeverage,
  };
  } finally {
    inboxExecuting.delete(messageId);
  }
}

/** Auto-execute when control auto_trading is on and signal validation passed. */
export async function tryAutoExecuteTelegramMessage(messageId) {
  // Fail-safe gate: only auto-execute when BOTH the remote control settings and
  // the local control file agree auto-trading is on and manual approval is off.
  // If they diverge (the scanner reads local, this path read remote), we fall
  // through to the Telegram approval buttons instead of silently auto-trading.
  const settings = await getControlSettings();
  const localSettings = await getLocalControlSettings().catch(() => settings);
  const autoOn = Boolean(settings?.auto_trading) && Boolean(localSettings?.auto_trading);
  const manualRequired = Boolean(settings?.manual_approval) || Boolean(localSettings?.manual_approval);
  if (!autoOn) return { ok: false, reason: 'auto_trading_off' };
  if (manualRequired) return { ok: false, reason: 'manual_approval_required' };

  const { data: message, error } = await getTelegramMessageById(messageId);
  if (error || !message) return { ok: false, reason: 'not_found' };
  if (message.parse_status !== 'parsed' || !message.parsed_signal) return { ok: false, reason: 'not_parsed' };
  if (message.api_result?.executed || message.api_result?.approved) return { ok: false, reason: 'already_executed' };

  const maxAgeMinutes = config.externalSignals.maxSignalAgeMinutes || 15;
  const receivedAt = new Date(message.received_at || message.message_date || 0).getTime();
  const ageMinutes = Number.isFinite(receivedAt)
    ? Math.round((Date.now() - receivedAt) / 60000)
    : null;
  const freshEnough = ageMinutes == null || ageMinutes <= maxAgeMinutes;

  if (!message.api_result?.passed && !message.api_result?.ready_to_approve) {
    const payload = parsedSignalToPayload(message);
    const validation = await ingestExternalSignal(payload, {
      validateOnly: true,
      allowStale: freshEnough,
      testMode: false,
      skipScoreGate: false,
      telegram: true,
    });
    if (!validation.passed) {
      await updateTelegramSignalMessage(messageId, {
        api_result: {
          ...(message.api_result || {}),
          passed: false,
          ready_to_approve: false,
          reason: validation.reason,
          validation: validation.validation,
          pipeline_stage: 'rejected',
        },
      });
      broadcastTelegramPipeline(
        { ...message, api_result: { ...(message.api_result || {}), passed: false, reason: validation.reason } },
        'rejected',
      );
      return { ok: false, reason: validation.reason || 'validation_failed' };
    }
    await updateTelegramSignalMessage(messageId, {
      api_result: {
        ...(message.api_result || {}),
        passed: true,
        ready_to_approve: true,
        validation: validation.validation,
        pipeline_stage: 'validated',
      },
    });
  }

  if (!freshEnough) {
    await markTelegramPipelineStage(messageId, 'stale', {
      last_error: `Signal ${ageMinutes}m old — max ${maxAgeMinutes}m for auto-trade`,
      auto_skip_reason: 'signal_too_old',
    });
    await logEvent('info', 'telegramInbox', `Auto-trade skipped — signal ${ageMinutes}m old`, {
      messageId,
      symbol: message.parsed_signal?.symbol,
    });
    return { ok: false, reason: 'signal_too_old', ageMinutes, ready_to_approve: true };
  }

  await markTelegramPipelineStage(messageId, 'executing', { auto_executed: true });

  const symbolCheck = await assertSymbolAvailableForApprove(message);
  if (!symbolCheck.ok) {
    await logEvent('warn', 'telegramInbox', `Auto-trade blocked: ${symbolCheck.error}`, {
      messageId,
      symbol: message.parsed_signal?.symbol,
    });
    return { ok: false, reason: symbolCheck.error };
  }

  const defaults = await getDefaultTradeParams({
    entry: message.parsed_signal?.entry,
    stopLoss: message.parsed_signal?.stop_loss,
    symbol: message.parsed_signal?.symbol,
  });
  const result = await approveTelegramInboxMessage(messageId, {
    leverage: defaults.leverage,
    autoMode: true,
    useRiskSizing: true,
  });

  if (!result.ok) {
    await logEvent('warn', 'telegramInbox', `Auto-trade failed: ${result.error || result.reason || 'unknown'}`, {
      messageId,
      symbol: message.parsed_signal?.symbol,
      reason: result.error || result.reason,
      checks: result.checks,
      level_issues: result.level_issues,
    });
    try {
      const { sendTelegramMessage, formatTelegramSignal, buildSignalKeyboard } = await import('./telegram.js');
      const chatId = config.telegram.chatId;
      if (chatId && message.parsed_signal) {
        const ps = message.parsed_signal;
        const failNote = result.error ? `\n\n⚠️ Auto-trade: ${result.error}` : '';
        const text = `${formatTelegramSignal({
          symbol: ps.symbol,
          direction: ps.side === 'SHORT' ? 'SELL' : 'BUY',
          confidence: message.api_result?.validation?.score || 70,
          entry_price: ps.entry,
          stop_loss: ps.stop_loss,
          tp1: ps.take_profit?.[0] || ps.tp1,
          tp2: ps.take_profit?.[1] || ps.tp2,
          tp3: ps.take_profit?.[2] || ps.tp3,
          reasons: { telegram: { status: 'pass', detail: 'VIP signal — tap to trade manually' } },
        })}${failNote}`;
        await sendTelegramMessage(chatId, text, {
          reply_markup: buildSignalKeyboard({
            symbol: ps.symbol,
            direction: ps.side === 'SHORT' ? 'SELL' : 'BUY',
          }, messageId),
        });
      }
    } catch (notifyErr) {
      await logEvent('warn', 'telegramInbox', `Auto-trade fallback notify failed: ${notifyErr.message}`, { messageId });
    }
  } else {
    await logEvent('trade', 'telegramInbox', `Auto-trade opened ${message.parsed_signal?.symbol}`, {
      messageId,
      symbol: message.parsed_signal?.symbol,
    });
  }

  return result;
}
