import { config } from '../config/index.js';
import { ingestExternalSignal } from './externalSignalIngestion.js';
import { getDefaultTradeParams } from './telegramTrade.js';
import { getOpenTrades, getSupabase, logEvent, updateTelegramSignalMessage } from './supabase.js';
import { broadcastTelegramPipeline, broadcastTradeEvent } from './wsBroadcast.js';
import { getControlSettings } from './researchApi.js';
import { internalApiHeaders, internalApiUrl } from '../lib/internalFetch.js';

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
    metadata: ps.metadata || {},
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

export async function approveTelegramInboxMessage(messageId, { marginUsdt = 0, leverage } = {}) {
  const { data: message, error } = await getTelegramMessageById(messageId);
  if (error || !message) {
    return { ok: false, error: 'Message not found' };
  }
  if (message.parse_status !== 'parsed' || !message.parsed_signal) {
    return { ok: false, error: 'Message is not a parsed trading signal' };
  }
  if (message.api_result?.executed || message.api_result?.approved) {
    return { ok: false, error: 'Signal already approved or executed' };
  }

  const symbolCheck = await assertSymbolAvailableForApprove(message);
  if (!symbolCheck.ok) {
    return { ok: false, error: symbolCheck.error };
  }

  const payload = parsedSignalToPayload(message);
  const ingested = await ingestExternalSignal(payload, {
    testMode: config.externalSignals.testMode,
    allowStale: config.externalSignals.testMode,
    skipScoreGate: config.externalSignals.testMode,
  });

  if (!ingested.accepted || !ingested.signal?.id) {
    return {
      ok: false,
      error: ingested.reason || 'Failed to register signal',
      validation: ingested.validation,
    };
  }

  const defaults = await getDefaultTradeParams({
    entry: ingested.signal.entry_price || payload.entry,
    stopLoss: ingested.signal.stop_loss || payload.stop_loss,
    symbol: payload.symbol,
  });
  const useLeverage = parseInt(leverage || defaults.leverage || config.telegram.defaultLeverage || 50, 10);
  const customNotional = parseFloat(marginUsdt) > 0 ? parseFloat(marginUsdt) : 0;

  const execBody = {
    ...ingested.signal,
    id: ingested.signal.id,
    source: 'telegram',
    manual_approved: true,
    test_levels_refreshed: Boolean(message.api_result?.test_levels_refreshed),
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
    ...(message.api_result || {}),
    approved: Boolean(execution.success),
    approved_at: execution.success ? new Date().toISOString() : message.api_result?.approved_at,
    executed: Boolean(execution.success),
    execution,
    signal_id: ingested.signal.id,
    margin_usdt: tradeMargin,
    leverage: execution.trade?.leverage || useLeverage,
    last_error: execution.success ? null : (execution.error || execution.reason || null),
  };

  await updateTelegramSignalMessage(messageId, { api_result: apiResult });
  broadcastTelegramPipeline(
    { ...message, api_result: apiResult, parsed_signal: payload },
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
}

/** Auto-execute when control auto_trading is on and signal validation passed. */
export async function tryAutoExecuteTelegramMessage(messageId) {
  const settings = await getControlSettings();
  if (!settings?.auto_trading) return { ok: false, reason: 'auto_trading_off' };

  const { data: message, error } = await getTelegramMessageById(messageId);
  if (error || !message) return { ok: false, reason: 'not_found' };
  if (message.parse_status !== 'parsed' || !message.parsed_signal) return { ok: false, reason: 'not_parsed' };
  if (message.api_result?.executed || message.api_result?.approved) return { ok: false, reason: 'already_executed' };

  const isScrape = Boolean(message.api_result?.scrape);
  const isLive = message.api_result?.live === true;
  const testMode = config.externalSignals.testMode === true;
  const maxAgeMinutes = config.externalSignals.maxSignalAgeMinutes || 15;
  const receivedAt = new Date(message.received_at || message.message_date || 0).getTime();
  const ageMinutes = Number.isFinite(receivedAt)
    ? Math.round((Date.now() - receivedAt) / 60000)
    : null;
  const freshEnough = ageMinutes == null || ageMinutes <= maxAgeMinutes;

  if (isScrape && !isLive) {
    if (!freshEnough && !testMode) {
      return { ok: false, reason: 'scrape_stale_skip', ageMinutes };
    }
    if (!message.api_result?.passed && !message.api_result?.ready_to_approve) {
      return { ok: false, reason: 'scrape_not_validated' };
    }
    return { ok: false, reason: 'scrape_inbox_only', ready_to_approve: true };
  }

  const payload = parsedSignalToPayload(message);
  const ingestOpts = {
    validateOnly: true,
    allowStale: testMode || freshEnough,
    testMode,
    skipScoreGate: testMode,
  };

  if (!message.api_result?.passed && !message.api_result?.ready_to_approve) {
    const validation = await ingestExternalSignal(payload, ingestOpts);
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

  const symbolCheck = await assertSymbolAvailableForApprove(message);
  if (!symbolCheck.ok) {
    await logEvent('warn', 'telegramInbox', `Auto-trade blocked: ${symbolCheck.error}`, {
      messageId,
      symbol: payload.symbol,
    });
    return { ok: false, reason: symbolCheck.error };
  }

  const defaults = await getDefaultTradeParams({
    entry: payload.entry,
    stopLoss: payload.stop_loss,
    symbol: payload.symbol,
  });
  const result = await approveTelegramInboxMessage(messageId, {
    marginUsdt: defaults.margin_usdt,
    leverage: defaults.leverage,
  });

  if (!result.ok) {
    await logEvent('warn', 'telegramInbox', `Auto-trade failed: ${result.error || result.reason || 'unknown'}`, {
      messageId,
      symbol: payload.symbol,
      reason: result.error || result.reason,
      checks: result.checks,
    });
    if (message.api_result?.passed || message.api_result?.ready_to_approve) {
      try {
        const { sendSignalNotification } = await import('./telegram.js');
        const ingested = await ingestExternalSignal(payload, {
          ...ingestOpts,
          validateOnly: false,
        });
        if (ingested.passed && ingested.signal?.id) {
          await sendSignalNotification(ingested.signal, ingested.signal.id);
        }
      } catch (notifyErr) {
        await logEvent('warn', 'telegramInbox', `Fallback notify failed: ${notifyErr.message}`, { messageId });
      }
    }
  }

  return result;
}
