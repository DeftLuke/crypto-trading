/**
 * Re-parse skipped Telegram messages using informal signal patterns + SMC enrichment.
 */
import {
  enrichTelegramSignalWithSmc,
  inferDirectionFromText,
  inferSymbolFromInformalText,
  stripGroupRiskHints,
} from './telegramSignalEnrichment.js';
import { ingestExternalSignal } from './externalSignalIngestion.js';
import { updateTelegramSignalMessage, logEvent } from './supabase.js';

const NOT_SIGNAL_RE = /(?:target\s*\d|take[\s-]*profit|all\s+target|achieved|acheived|achive|book\s+\d+\s*%|offer\s+price|complete\s+\d+\s*react|good\s+morning|premium\s+group|profit\s*:\s*\d|stop[\s-]*loss\s+got\s+hit|session\s+successfully\s+closed|need\s+free\s+signal|close this trade)/i;

export function isInformalTradeText(text = '') {
  const t = stripGroupRiskHints(text);
  if (!t || NOT_SIGNAL_RE.test(t)) return false;
  return /\b(long|short|buy|sell)\b/i.test(t) && inferSymbolFromInformalText(t);
}

export function buildInformalExternalPayload(message = {}, groupTitle = '') {
  const raw = message.raw_message || '';
  const text = stripGroupRiskHints(raw);
  if (!isInformalTradeText(text)) return null;

  const symbol = inferSymbolFromInformalText(text, groupTitle);
  const direction = inferDirectionFromText(text);
  if (!symbol || !direction) return null;

  const side = direction === 'SELL' ? 'SHORT' : 'LONG';
  let entry = null;
  let stopLoss = null;

  const symDirEntry = text.match(/\b([A-Za-z][A-Za-z0-9]{1,11})\s+(long|short|buy|sell)\s+([0-9.]+)\b/i);
  if (symDirEntry) entry = parseFloat(symDirEntry[3]);

  const hashEntry = text.match(/#\s*([A-Za-z0-9]{1,12})\s+(long|short|buy|sell)\D{0,8}([0-9.]+)/i);
  if (hashEntry && !entry) entry = parseFloat(hashEntry[3]);

  const dirSymSl = text.match(/\b(long|short|buy|sell)\s+([A-Za-z][A-Za-z0-9]{1,11})\s+(?:cmp\s+)?(?:stop\s*loss|stoploss|sl)\s+([0-9.]+)/i);
  if (dirSymSl) stopLoss = parseFloat(dirSymSl[3]);

  return {
    provider: groupTitle || message.telegram_signal_sources?.title || 'telegram_vip',
    symbol,
    side,
    direction,
    entry_price: Number.isFinite(entry) ? entry : undefined,
    entry: Number.isFinite(entry) ? entry : undefined,
    stop_loss: Number.isFinite(stopLoss) ? stopLoss : undefined,
    raw_message: raw,
    parser: 'informal-reparse',
    timestamp: message.message_date || message.received_at || new Date().toISOString(),
    source_chat_id: message.telegram_chat_id,
    provider_message_id: message.message_id,
    metadata: {
      levels_source: 'group_hint',
      informal_format: true,
      informal_signal: true,
      reparsed_at: new Date().toISOString(),
      group_title: groupTitle || message.telegram_signal_sources?.title,
    },
  };
}

export async function reparseSkippedTelegramMessage(message = {}) {
  const groupTitle = message.telegram_signal_sources?.title || '';
  const external = buildInformalExternalPayload(message, groupTitle);
  if (!external) {
    return { ok: false, reason: 'not_informal_signal', messageId: message.id };
  }

  const enriched = await enrichTelegramSignalWithSmc(external, {});
  if (!enriched?.enrichment?.ok && enriched?.enrichment?.reason) {
    return { ok: false, reason: enriched.enrichment.reason, messageId: message.id, symbol: external.symbol };
  }

  const result = await ingestExternalSignal(enriched, {
    allowStale: true,
    validateOnly: true,
    telegram: true,
  });

  if (!result.passed && !result.accepted) {
    return {
      ok: false,
      reason: result.reason || 'validation_failed',
      messageId: message.id,
      symbol: enriched.symbol,
      checks: result.checks,
    };
  }

  const parsed = {
    symbol: enriched.symbol,
    side: enriched.side,
    entry: enriched.entry_price,
    stop_loss: enriched.stop_loss,
    take_profit: [enriched.tp1, enriched.tp2, enriched.tp3].filter(Boolean),
    tp1: enriched.tp1,
    tp2: enriched.tp2,
    tp3: enriched.tp3,
    parser: 'informal-reparse',
    raw_message: message.raw_message,
    metadata: enriched.metadata,
  };

  await updateTelegramSignalMessage(message.id, {
    parsed_signal: parsed,
    parse_status: 'parsed',
    api_result: {
      ...(message.api_result || {}),
      pipeline_stage: result.passed ? 'validated' : 'rejected',
      passed: result.passed,
      reason: result.reason,
      informal_reparse: true,
      validation: result,
    },
  });

  await logEvent('info', 'telegramReparse', `Informal reparse OK ${enriched.symbol} ${enriched.side}`, {
    messageId: message.id,
    symbol: enriched.symbol,
  });

  return {
    ok: true,
    messageId: message.id,
    symbol: enriched.symbol,
    side: enriched.side,
    passed: result.passed,
    parsed,
  };
}

export async function reparseSkippedTelegramMessages(messages = []) {
  const results = [];
  for (const message of messages) {
    try {
      results.push(await reparseSkippedTelegramMessage(message));
    } catch (err) {
      results.push({ ok: false, messageId: message.id, reason: err.message });
    }
  }
  return results;
}

export function isSkippedInformalCandidate(message = {}) {
  const reason = String(message.api_result?.reason || '').toLowerCase();
  const skippedLike = message.parse_status === 'skipped'
    || reason.includes('not a trading signal')
    || reason === 'no_parser_match'
    || reason === 'ai_not_signal'
    || reason === 'ai_unavailable';
  if (!skippedLike) return false;
  return isInformalTradeText(message.raw_message || '');
}
