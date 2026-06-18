import { config } from '../config/index.js';
import { getMarkPrice, roundPriceToTick, getSymbolRules } from './binance.js';
import { ingestExternalSignal } from './externalSignalIngestion.js';
import { getTelegramMessageById, parsedSignalToPayload } from './telegramInbox.js';
import { logEvent, updateTelegramSignalMessage } from './supabase.js';
import { broadcastTelegramPipeline } from './wsBroadcast.js';

function roundLevels(symbol, levels, rules) {
  const tick = rules?.tickSize || 0.0001;
  return {
    entry: roundPriceToTick(levels.entry, tick),
    stop_loss: roundPriceToTick(levels.stop_loss, tick),
    take_profit: (levels.take_profit || []).map((p) => roundPriceToTick(p, tick)),
    tp1: roundPriceToTick(levels.tp1, tick),
    tp2: roundPriceToTick(levels.tp2, tick),
    tp3: roundPriceToTick(levels.tp3, tick),
  };
}

/** Reprice entry/SL/TPs from current mark while keeping original % distances. */
export function repriceSignalLevels(parsed = {}, markPrice, side) {
  const isLong = String(side || parsed.side || 'LONG').toUpperCase() === 'LONG';
  const entry = parseFloat(parsed.entry) || markPrice;
  const sl = parseFloat(parsed.stop_loss);
  const tps = (Array.isArray(parsed.take_profit) ? parsed.take_profit : [])
    .map((v) => parseFloat(v))
    .filter((v) => Number.isFinite(v) && v > 0);

  const slPct = Number.isFinite(sl) && entry > 0 ? Math.abs(entry - sl) / entry : 0.03;
  const tpPcts = tps.length
    ? tps.map((tp) => Math.abs(tp - entry) / entry)
    : [0.02, 0.04, 0.06];

  const newEntry = markPrice;
  let newSl;
  let newTps;
  if (isLong) {
    newSl = newEntry * (1 - slPct);
    newTps = tpPcts.map((pct) => newEntry * (1 + pct));
  } else {
    newSl = newEntry * (1 + slPct);
    newTps = tpPcts.map((pct) => newEntry * (1 - pct));
  }

  return {
    side: isLong ? 'LONG' : 'SHORT',
    entry: newEntry,
    stop_loss: newSl,
    take_profit: newTps,
    tp1: newTps[0],
    tp2: newTps[1],
    tp3: newTps[2],
  };
}

function parseAiJson(text) {
  if (!text) return null;
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function fetchAiMarketBias({ symbol, markPrice, originalSide, rawMessage }) {
  const gatewayUrl = config.ai?.gatewayUrl;
  const question = `Analyze ${symbol} USDT perpetual futures for a test trade entry NOW.
Mark price: ${markPrice}
Original telegram signal side: ${originalSide}
Signal text: ${String(rawMessage || '').slice(0, 800)}

Reply with JSON only (no markdown):
{"side":"LONG" or "SHORT","confidence":0-100,"reason":"one sentence"}`;

  const context = { symbol, mark_price: markPrice, original_side: originalSide, mode: 'test_refresh' };

  if (gatewayUrl) {
    try {
      const res = await fetch(`${gatewayUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.ai?.apiKey ? { 'X-API-Key': config.ai.apiKey } : {}),
        },
        body: JSON.stringify({ question, context }),
        signal: AbortSignal.timeout(90000),
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = parseAiJson(data.answer);
        if (parsed?.side) {
          return {
            side: String(parsed.side).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG',
            confidence: parseInt(parsed.confidence, 10) || 55,
            reason: parsed.reason || data.answer,
            source: 'ai_gateway',
          };
        }
      }
    } catch (err) {
      await logEvent('warn', 'telegramSignalTest', `AI bias failed: ${err.message}`, { symbol });
    }
  }

  return {
    side: originalSide,
    confidence: 50,
    reason: 'AI unavailable — kept original signal side',
    source: 'fallback',
  };
}

export async function refreshTelegramSignalForTest(messageId, { useAi = true } = {}) {
  const { data: message, error } = await getTelegramMessageById(messageId);
  if (error || !message) return { ok: false, error: 'Message not found' };
  if (message.parse_status !== 'parsed' || !message.parsed_signal) {
    return { ok: false, error: 'Not a parsed signal' };
  }
  if (!config.externalSignals.testMode) {
    return { ok: false, error: 'Test refresh only available in TG_TEST_MODE' };
  }

  const ps = message.parsed_signal;
  const symbol = ps.symbol;
  const markPrice = await getMarkPrice(symbol);
  const rules = await getSymbolRules(symbol);

  let aiBias = null;
  let side = String(ps.side || 'LONG').toUpperCase();
  if (useAi) {
    aiBias = await fetchAiMarketBias({
      symbol,
      markPrice,
      originalSide: side,
      rawMessage: message.raw_message,
    });
    side = aiBias.side;
  }

  const repriced = repriceSignalLevels(ps, markPrice, side);
  const rounded = roundLevels(symbol, repriced, rules);

  const updatedParsed = {
    ...ps,
    ...rounded,
    side,
    metadata: {
      ...(ps.metadata || {}),
      test_refreshed_at: new Date().toISOString(),
      test_mark_price: markPrice,
      test_original_entry: ps.entry,
      ai_bias: aiBias,
    },
  };

  const payload = parsedSignalToPayload({ ...message, parsed_signal: updatedParsed });
  const validation = await ingestExternalSignal(payload, {
    validateOnly: true,
    testMode: true,
    allowStale: true,
    skipScoreGate: true,
  });

  const apiResult = {
    ok: true,
    passed: validation.passed,
    ready_to_approve: true,
    pipeline_stage: 'validated',
    test_mode: true,
    test_levels_refreshed: true,
    refreshed_at: new Date().toISOString(),
    mark_price: markPrice,
    ai_analysis: aiBias,
    validation: validation.validation,
    approved: false,
    executed: false,
    last_error: null,
  };

  await updateTelegramSignalMessage(messageId, {
    parsed_signal: updatedParsed,
    api_result: apiResult,
  });

  broadcastTelegramPipeline(
    { ...message, parsed_signal: updatedParsed, api_result: apiResult },
    'ready',
  );

  return {
    ok: true,
    symbol,
    mark_price: markPrice,
    side,
    levels: rounded,
    ai_analysis: aiBias,
    validation,
  };
}
