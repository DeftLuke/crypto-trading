import { config } from '../config/index.js';
import { openclawChat, isOpenClawConfigured } from './openclaw.js';

// Ollama is now a fallback only. Set OLLAMA_ENABLED=false once the container is
// removed so we never wait on a dead local model (was a 120s timeout per call).
const OLLAMA_ENABLED = process.env.OLLAMA_ENABLED !== 'false';

function useGateway() {
  return config.ollama.viaGateway || config.ollama.url.includes('deftluke.online');
}

function ollamaHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (useGateway() && config.ai.apiKey) {
    headers['X-API-Key'] = config.ai.apiKey;
  }
  return headers;
}

function ollamaUrl(endpoint) {
  const base = (useGateway() ? config.ai.gatewayUrl : config.ollama.url).replace(/\/$/, '');
  if (useGateway()) {
    return `${base}/ollama${endpoint.replace('/api', '')}`;
  }
  return `${base}${endpoint}`;
}

export async function ollamaGenerate(prompt, systemPrompt = '') {
  // OpenClaw-first: route text generation to the OpenClaw gateway when configured.
  if (isOpenClawConfigured()) {
    try {
      const { answer, model } = await openclawChat({ system: systemPrompt, prompt, maxTokens: 500 });
      return { text: answer, model: model || 'openclaw' };
    } catch (err) {
      console.warn(`[AI] OpenClaw generate failed: ${err.message}${OLLAMA_ENABLED ? ' — falling back to Ollama' : ''}`);
      if (!OLLAMA_ENABLED) throw err;
    }
  }
  if (!OLLAMA_ENABLED) {
    throw new Error('Ollama disabled (OLLAMA_ENABLED=false) and OpenClaw unavailable');
  }

  const models = [config.ollama.model, config.ollama.fallbackModel].filter(Boolean);
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

  let lastError;
  for (const model of models) {
    try {
      const res = await fetch(ollamaUrl('/api/generate'), {
        method: 'POST',
        headers: ollamaHeaders(),
        body: JSON.stringify({
          model,
          prompt: fullPrompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 500 },
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return { text: data.response?.trim() || '', model };
    } catch (err) {
      lastError = err;
      console.warn(`[Ollama] ${model} failed: ${err.message}, trying fallback...`);
    }
  }
  throw lastError || new Error('All Ollama models failed');
}

export async function ollamaEmbed(text) {
  // Skip entirely when Ollama is disabled — lessons store without a vector.
  if (!OLLAMA_ENABLED) return null;
  const res = await fetch(ollamaUrl('/api/embeddings'), {
    method: 'POST',
    headers: ollamaHeaders(),
    body: JSON.stringify({
      model: config.ollama.embedModel,
      prompt: text,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    console.warn('[Ollama] Embedding failed, storing without vector');
    return null;
  }

  const data = await res.json();
  return data.embedding || null;
}

export async function generateTradeLesson(signal, outcome, outcomeData, lessonType) {
  const systemPrompt = `You are an SMC crypto trading analyst. Write a concise lesson (3-5 bullet points) from this ${lessonType} signal outcome. Be specific about what worked or failed. Include win probability assessment.`;

  const prompt = `Signal Data:
- Symbol: ${signal.symbol}
- Direction: ${signal.direction}
- Confidence: ${signal.confidence}%
- Entry: ${signal.entry_price}
- SL: ${signal.stop_loss}
- TP1: ${signal.tp1}
- User action: ${lessonType === 'skipped' ? 'SKIPPED (did not trade)' : 'EXECUTED'}
- Outcome after ${outcomeData.checkMinutes}min: ${outcome}
- Price at check: ${outcomeData.priceAtCheck}
- Hit TP1: ${outcomeData.hitTp1}
- Hit SL: ${outcomeData.hitSl}
- R-multiple: ${outcomeData.rMultiple?.toFixed(2) || 'N/A'}
- Max favorable move: ${outcomeData.maxFavorable}
- Reasons: ${JSON.stringify(signal.reasons || {})}

Write the lesson:`;

  try {
    const { text: lessonText, model: usedModel } = await ollamaGenerate(prompt, systemPrompt);
    const embedding = await ollamaEmbed(lessonText);

    return {
      lesson_text: lessonText,
      embedding,
      ai_model: usedModel,
    };
  } catch (err) {
    console.error('[Ollama] Lesson generation failed:', err.message);
    return {
      lesson_text: buildFallbackLesson(signal, outcome, outcomeData, lessonType),
      embedding: null,
      ai_model: 'fallback',
    };
  }
}

function buildFallbackLesson(signal, outcome, data, lessonType) {
  const action = lessonType === 'skipped' ? 'Skipped' : 'Traded';
  return `${action} ${signal.symbol} ${signal.direction} at ${signal.entry_price}.
Outcome (${data.checkMinutes}min): ${outcome.toUpperCase()}.
${data.hitTp1 ? 'Would have hit TP1.' : data.hitSl ? 'Would have hit SL.' : 'No clear TP/SL hit yet.'}
Confidence was ${signal.confidence}%. ${outcome === 'win' ? 'Setup validated — consider taking similar setups.' : 'Review OB retest quality before similar entries.'}`;
}

export async function generateClosedTradeLesson(trade, signal, closeFactors) {
  const systemPrompt = `You are an SMC crypto trading analyst. Write a concise post-trade review (4-6 bullet points) explaining why this trade won or lost.
Cover: market structure (TP hits, SL management), timing (signal-to-fill latency, hold time), slippage/stale entry if relevant, and one actionable rule for the strategy loop.`;

  const prompt = `Closed Trade:
- Symbol: ${trade.symbol}
- Direction: ${trade.direction}
- Entry: ${trade.entry_price} → Exit: ${trade.exit_price}
- PnL: ${parseFloat(trade.pnl || 0).toFixed(2)} USDT
- R-multiple: ${trade.r_multiple ?? 'N/A'}
- Close reason: ${closeFactors.close_reason}
- Outcome: ${closeFactors.outcome}

Close factors:
- TP1 hit: ${closeFactors.market_structure.tp1_hit}
- TP2 hit: ${closeFactors.market_structure.tp2_hit}
- SL breakeven: ${closeFactors.market_structure.sl_breakeven}
- Signal→fill latency: ${closeFactors.timing.signal_to_fill_ms ?? 'N/A'} ms
- Hold duration: ${closeFactors.timing.hold_duration_ms ?? 'N/A'} ms
- Entry slippage: ${closeFactors.slippage.entry_drift_pct}%
- Stale/adapted entry: ${closeFactors.stale_entry}
- Validation score: ${closeFactors.validation_score ?? 'N/A'}

${signal ? `Original signal confidence: ${signal.confidence}%, MTF: ${JSON.stringify(signal.mtf_status || {})}` : 'No linked signal row.'}

Write the lesson:`;

  try {
    const { text: lessonText, model: usedModel } = await ollamaGenerate(prompt, systemPrompt);
    const embedding = await ollamaEmbed(lessonText);
    return { lesson_text: lessonText, embedding, ai_model: usedModel };
  } catch (err) {
    console.error('[Ollama] Closed trade lesson failed:', err.message);
    const fallback = buildClosedTradeFallback(trade, closeFactors);
    return { lesson_text: fallback, embedding: null, ai_model: 'fallback' };
  }
}

function buildClosedTradeFallback(trade, closeFactors) {
  return `Closed ${trade.symbol} ${trade.direction}: ${closeFactors.outcome.toUpperCase()} (${closeFactors.close_reason}).
PnL ${parseFloat(trade.pnl || 0).toFixed(2)} USDT, R=${trade.r_multiple ?? 'N/A'}.
TP1 ${closeFactors.market_structure.tp1_hit ? 'hit' : 'missed'}, TP2 ${closeFactors.market_structure.tp2_hit ? 'hit' : 'missed'}.
${closeFactors.stale_entry ? 'Entry was stale or adapted — tighten freshness gate.' : 'Entry timing acceptable.'}
${closeFactors.outcome === 'win' ? 'Repeat similar structure when validation score is high.' : 'Review MTF alignment and OB quality before re-entry.'}`;
}

export async function checkOllamaHealth() {
  try {
    const res = await fetch(ollamaUrl('/api/tags'), {
      headers: ollamaHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    return {
      ok: true,
      url: useGateway() ? config.ai.gatewayUrl : config.ollama.url,
      models,
      hasQwen: models.some((m) => m.includes('qwen2.5')),
      hasEmbed: models.some((m) => m.includes('nomic-embed')),
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
