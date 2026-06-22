/**
 * Telegram Intelligence Audit Layer — raw archive, group memory, parsed output, rejections.
 * No execution changes; full traceability for review before trades.
 */
import { getSupabase } from './supabase.js';

function db() {
  return getSupabase();
}

function aiOutputToReviewShape(output = {}) {
  const tps = Array.isArray(output.take_profit) ? output.take_profit : [];
  return {
    symbol: output.symbol || output.parsed_signal?.symbol || '',
    direction: output.side || output.direction || '',
    entry: output.entry ?? output.entry_price ?? '',
    sl: output.stop_loss ?? output.sl ?? '',
    tp1: tps[0] ?? output.tp1 ?? '',
    tp2: tps[1] ?? output.tp2 ?? '',
    tp3: tps[2] ?? output.tp3 ?? '',
    confidence: output.confidence ?? output.external_confidence ?? '',
    reason: output.reason || output.metadata?.levels_source || output.message || '',
  };
}

export async function archiveTelegramRawMessage({
  sourceId,
  telegramChatId,
  messageId,
  text = '',
  imageUrl = null,
  imageBase64 = null,
  imageMime = 'image/jpeg',
  messageTimestamp = null,
  hasImage = false,
  processedStatus = 'pending',
  inboxMessageId = null,
  metadata = {},
} = {}) {
  const client = db();
  if (!client) return { data: null, error: new Error('Database unavailable') };

  const row = {
    source_id: sourceId || null,
    telegram_chat_id: telegramChatId,
    message_id: messageId,
    text: text || null,
    image_url: imageUrl,
    image_base64: imageBase64,
    image_mime: imageMime,
    message_timestamp: messageTimestamp,
    has_image: Boolean(hasImage || imageBase64 || imageUrl),
    processed_status: processedStatus,
    inbox_message_id: inboxMessageId || null,
    metadata,
    updated_at: new Date().toISOString(),
  };

  return client
    .from('telegram_raw_messages')
    .upsert(row, { onConflict: 'telegram_chat_id,message_id', ignoreDuplicates: false })
    .select('*')
    .single();
}

export async function updateTelegramRawStatus(rawId, patch = {}) {
  const client = db();
  if (!client || !rawId) return { data: null, error: null };
  const allowed = {};
  if (patch.processed_status) allowed.processed_status = patch.processed_status;
  if (patch.inbox_message_id) allowed.inbox_message_id = patch.inbox_message_id;
  if (patch.metadata) allowed.metadata = patch.metadata;
  allowed.updated_at = new Date().toISOString();
  return client.from('telegram_raw_messages').update(allowed).eq('id', rawId).select('*').single();
}

export async function getTelegramRawMessages({
  limit = 100,
  sourceId = null,
  chatId = null,
  processedStatus = null,
  offset = 0,
} = {}) {
  const client = db();
  if (!client) return { data: [], error: null, count: 0 };

  let query = client
    .from('telegram_raw_messages')
    .select('*, telegram_signal_sources(title, username)', { count: 'exact' })
    .order('message_timestamp', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sourceId) query = query.eq('source_id', sourceId);
  if (chatId) query = query.eq('telegram_chat_id', chatId);
  if (processedStatus) query = query.eq('processed_status', processedStatus);

  const result = await query;
  const rows = (result.data || []).map((row) => ({
    ...row,
    image_base64: row.image_base64 ? '[stored]' : null,
  }));
  return { ...result, data: rows };
}

export async function getTelegramRawMessageById(id) {
  const client = db();
  if (!client) return { data: null, error: new Error('Database unavailable') };
  return client
    .from('telegram_raw_messages')
    .select('*, telegram_signal_sources(title, username)')
    .eq('id', id)
    .single();
}

export async function upsertTelegramGroupMemory(sourceId, profile = {}, sourceMeta = {}) {
  const client = db();
  if (!client || !sourceId) return { data: null, error: new Error('source_id required') };

  const formatProfile = profile.format_profile || profile;
  const row = {
    source_id: sourceId,
    group_title: sourceMeta.title || formatProfile.group_title || null,
    group_username: sourceMeta.username || formatProfile.group_username || null,
    common_patterns: formatProfile.common_patterns || formatProfile.example_snippets || [],
    signal_keywords: formatProfile.signal_keywords || [],
    entry_format: formatProfile.entry_format || formatProfile.symbol_format || null,
    sl_format: formatProfile.sl_format || formatProfile.sl_tp_location || null,
    tp_format: formatProfile.tp_format || formatProfile.sl_tp_location || null,
    emoji_patterns: formatProfile.emoji_patterns || [],
    successful_examples: formatProfile.parsed_examples || formatProfile.successful_examples || [],
    format_profile: formatProfile,
    learned_at: formatProfile.learned_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return client
    .from('telegram_group_memory')
    .upsert(row, { onConflict: 'source_id', ignoreDuplicates: false })
    .select('*')
    .single();
}

export async function getTelegramGroupMemory({ sourceId = null, limit = 50 } = {}) {
  const client = db();
  if (!client) return { data: [], error: null };

  let query = client
    .from('telegram_group_memory')
    .select('*, telegram_signal_sources(title, username, is_followed)')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (sourceId) query = query.eq('source_id', sourceId);
  return query;
}

export async function saveParsedSignalRaw({
  rawMessageId = null,
  sourceId = null,
  inboxMessageId = null,
  telegramChatId = null,
  messageId = null,
  originalMessage = '',
  originalText = '',
  hasImage = false,
  aiOutput = {},
  modelUsed = null,
  parserUsed = null,
  parseStage = 'unknown',
  confidence = null,
} = {}) {
  const client = db();
  if (!client) return { data: null, error: new Error('Database unavailable') };

  const review = aiOutputToReviewShape(aiOutput);

  const row = {
    raw_message_id: rawMessageId,
    source_id: sourceId,
    inbox_message_id: inboxMessageId,
    telegram_chat_id: telegramChatId,
    message_id: messageId,
    original_message: originalMessage,
    original_text: originalText,
    has_image: hasImage,
    ai_output: { ...aiOutput, review_shape: review },
    model_used: modelUsed,
    parser_used: parserUsed,
    parse_stage: parseStage,
    confidence: confidence != null ? Number(confidence) : null,
  };

  return client.from('parsed_signals_raw').insert(row).select('*').single();
}

export async function getParsedSignalsRaw({
  limit = 100,
  sourceId = null,
  chatId = null,
  offset = 0,
} = {}) {
  const client = db();
  if (!client) return { data: [], error: null, count: 0 };

  let query = client
    .from('parsed_signals_raw')
    .select('*, telegram_signal_sources(title, username)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sourceId) query = query.eq('source_id', sourceId);
  if (chatId) query = query.eq('telegram_chat_id', chatId);

  return query;
}

export async function saveTelegramSignalRejection({
  parsedSignalId = null,
  rawMessageId = null,
  inboxMessageId = null,
  signalId = null,
  sourceId = null,
  telegramChatId = null,
  messageId = null,
  rejectStage = 'validation',
  rejectReason = '',
  validationScore = null,
  failedRules = [],
  aiOutput = null,
  validationResult = null,
  originalMessage = '',
  metadata = {},
} = {}) {
  const client = db();
  if (!client) return { data: null, error: new Error('Database unavailable') };

  const row = {
    parsed_signal_id: parsedSignalId,
    raw_message_id: rawMessageId,
    inbox_message_id: inboxMessageId,
    signal_id: signalId,
    source_id: sourceId,
    telegram_chat_id: telegramChatId,
    message_id: messageId,
    reject_stage: rejectStage,
    reject_reason: rejectReason,
    validation_score: validationScore != null ? Number(validationScore) : null,
    failed_rules: failedRules,
    ai_output: aiOutput,
    validation_result: validationResult,
    original_message: originalMessage,
    metadata,
  };

  return client.from('telegram_signal_rejections').insert(row).select('*').single();
}

export async function getTelegramSignalRejections({
  limit = 100,
  sourceId = null,
  chatId = null,
  rejectStage = null,
  offset = 0,
} = {}) {
  const client = db();
  if (!client) return { data: [], error: null, count: 0 };

  let query = client
    .from('telegram_signal_rejections')
    .select('*, telegram_signal_sources(title, username)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sourceId) query = query.eq('source_id', sourceId);
  if (chatId) query = query.eq('telegram_chat_id', chatId);
  if (rejectStage) query = query.eq('reject_stage', rejectStage);

  return query;
}

export function buildFailedRulesFromValidation(result = {}) {
  const failed = [];
  for (const check of result.checks || result.validation?.checks || []) {
    if (check.passed === false) failed.push(check.message || check.rule);
  }
  if (result.reason && !failed.length) failed.push(result.reason);
  return failed;
}

export async function recordTelegramMessageAudit(body = {}, inboxMessage = null) {
  const audit = body.audit || {};
  const chatId = body.telegram_chat_id;
  const msgId = body.message_id;

  const { data: rawRow, error: rawErr } = await archiveTelegramRawMessage({
    sourceId: body.source_id,
    telegramChatId: chatId,
    messageId: msgId,
    text: body.raw_message || audit.text || '',
    imageUrl: audit.image_url || null,
    imageBase64: audit.image_base64 || null,
    imageMime: audit.image_mime || 'image/jpeg',
    messageTimestamp: body.message_date,
    hasImage: audit.has_image || Boolean(audit.image_base64),
    processedStatus: mapParseStatusToProcessed(body.parse_status, body.api_result),
    inboxMessageId: inboxMessage?.id || null,
    metadata: {
      live: body.api_result?.live,
      scrape: body.api_result?.scrape,
      pipeline_stage: body.api_result?.pipeline_stage,
    },
  });

  if (rawErr) {
    return { raw: null, parsed: null, rejection: null, error: rawErr };
  }

  let parsedRow = null;
  let rejectionRow = null;

  const hasParseOutput = (body.parsed_signal || audit.ai_output)
    && body.parse_status !== 'parsing'
    && body.parse_status !== 'archived';

  if (hasParseOutput) {
    const aiOut = audit.ai_output || body.parsed_signal || {};
    const parseStage = audit.parse_stage
      || (audit.has_image ? 'vision' : body.parsed_signal?.metadata?.ai_detected ? 'ai' : 'rule');

    const { data: pRow } = await saveParsedSignalRaw({
      rawMessageId: rawRow?.id,
      sourceId: body.source_id,
      inboxMessageId: inboxMessage?.id,
      telegramChatId: chatId,
      messageId: msgId,
      originalMessage: body.raw_message || '',
      originalText: audit.original_text || body.raw_message || '',
      hasImage: audit.has_image || Boolean(audit.image_base64),
      aiOutput: aiOut,
      modelUsed: audit.model_used || body.parsed_signal?.metadata?.ai_model || null,
      parserUsed: audit.parser_used || body.parsed_signal?.parser || null,
      parseStage,
      confidence: aiOut.confidence ?? body.parsed_signal?.confidence,
    });
    parsedRow = pRow;
  }

  if (body.parse_status === 'skipped') {
    const { data: rRow } = await saveTelegramSignalRejection({
      rawMessageId: rawRow?.id,
      parsedSignalId: parsedRow?.id,
      inboxMessageId: inboxMessage?.id,
      sourceId: body.source_id,
      telegramChatId: chatId,
      messageId: msgId,
      rejectStage: 'parse',
      rejectReason: body.api_result?.reason || audit.reject_reason || 'Not a trading signal',
      failedRules: audit.failed_rules || [body.api_result?.reason || 'parse_failed'],
      aiOutput: audit.ai_output || null,
      originalMessage: body.raw_message || '',
    });
    rejectionRow = rRow;
  } else if (body.parse_status === 'parsed' && body.api_result?.passed === false) {
    const validation = body.api_result?.validation || body.api_result;
    const { data: rRow } = await saveTelegramSignalRejection({
      rawMessageId: rawRow?.id,
      parsedSignalId: parsedRow?.id,
      inboxMessageId: inboxMessage?.id,
      sourceId: body.source_id,
      telegramChatId: chatId,
      messageId: msgId,
      rejectStage: 'validation',
      rejectReason: body.api_result?.reason || 'validation_failed',
      validationScore: validation?.score ?? body.api_result?.validation_score,
      failedRules: buildFailedRulesFromValidation(body.api_result),
      aiOutput: body.parsed_signal || audit.ai_output,
      validationResult: body.api_result,
      originalMessage: body.raw_message || '',
    });
    rejectionRow = rRow;
  }

  return { raw: rawRow, parsed: parsedRow, rejection: rejectionRow, error: null };
}

function mapParseStatusToProcessed(parseStatus, apiResult = {}) {
  if (parseStatus === 'archived') return 'archived';
  if (parseStatus === 'parsing') return 'parsing';
  if (parseStatus === 'skipped') return 'skipped';
  if (parseStatus === 'parsed' && apiResult.passed === true) return 'validated';
  if (parseStatus === 'parsed' && apiResult.passed === false) return 'rejected';
  if (parseStatus === 'parsed') return 'parsed';
  return 'archived';
}

export { aiOutputToReviewShape };
