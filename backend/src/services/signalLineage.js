/** Normalize signal source / strategy / group for Phase 2 analytics → Phase 4 loop. */

export function inferSignalSource(payload = {}, options = {}) {
  if (options.source) return String(options.source);
  const provider = String(payload.provider || payload.metadata?.provider || '').toLowerCase();
  if (provider.includes('telegram') || payload.source_chat_id) return 'telegram';
  if (provider.includes('scanner') || payload.scanner) return 'scanner';
  if (provider.includes('ai') || payload.ai_generated) return 'ai';
  if (payload.source) return String(payload.source);
  return 'manual';
}

export function resolveStrategyName(payload = {}, options = {}) {
  if (options.strategyName) return options.strategyName;
  if (payload.strategy_name) return payload.strategy_name;
  if (payload.strategy_id) return String(payload.strategy_id);
  const source = inferSignalSource(payload, options);
  if (source === 'telegram') return 'telegram-vip-smc-validation';
  if (source === 'scanner') return payload.strategy_id || 'smc-mtf';
  return 'unknown';
}

export function resolveSourceGroup(payload = {}, options = {}) {
  return options.sourceGroup
    || payload.metadata?.group
    || payload.metadata?.source_title
    || payload.provider
    || payload.source_group
    || null;
}

export function buildLineage(payload = {}, options = {}) {
  const source = inferSignalSource(payload, options);
  const strategy = resolveStrategyName(payload, options);
  const group = resolveSourceGroup(payload, options);
  const receivedAt = payload.timestamp || payload.received_at || new Date().toISOString();
  const validationScore = options.validationScore ?? payload.validation_score ?? null;

  return {
    source,
    strategy,
    group,
    received_at: receivedAt,
    validation_score: validationScore,
    parser: payload.parser || null,
    provider: payload.provider || null,
  };
}

export function applyLineageToSignal(signal, lineage) {
  return {
    ...signal,
    signal_source: lineage.source,
    strategy_name: lineage.strategy,
    source_group: lineage.group,
    validation_score: lineage.validation_score,
    reasons: {
      ...(signal.reasons || {}),
      lineage,
    },
  };
}

export function extractLineageFromSignal(signal) {
  const l = signal?.reasons?.lineage || {};
  return {
    source: signal?.signal_source || l.source || 'unknown',
    strategy: signal?.strategy_name || l.strategy || 'unknown',
    group: signal?.source_group || l.group || null,
    validation_score: signal?.validation_score ?? l.validation_score ?? signal?.reasons?.validation?.score ?? null,
    received_at: l.received_at || signal?.created_at || null,
  };
}
