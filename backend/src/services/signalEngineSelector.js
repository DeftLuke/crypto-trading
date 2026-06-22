/**
 * Runtime signal engine selection — institutional-smc (Python v2) vs legacy smc-mtf.
 */
import { config } from '../config/index.js';
import { getLocalControlSettings } from './controlCenter.js';
import { getStrategy } from '../strategies/registry.js';

export const SIGNAL_ENGINE_SMC_MTF = 'smc-mtf';
export const SIGNAL_ENGINE_INSTITUTIONAL = 'institutional-smc';

const VALID_ENGINES = new Set([SIGNAL_ENGINE_SMC_MTF, SIGNAL_ENGINE_INSTITUTIONAL]);

function defaultEngineFromEnv() {
  if (process.env.LEGACY_SMC_MTF_ENABLED === 'true') {
    return SIGNAL_ENGINE_SMC_MTF;
  }
  if (process.env.SIGNAL_ENGINE === SIGNAL_ENGINE_SMC_MTF) {
    return SIGNAL_ENGINE_SMC_MTF;
  }
  if (isResearchApiConfigured()) {
    return SIGNAL_ENGINE_INSTITUTIONAL;
  }
  return SIGNAL_ENGINE_SMC_MTF;
}

export function isLegacySmcMtfEnabled() {
  return process.env.LEGACY_SMC_MTF_ENABLED === 'true';
}

export function isResearchApiConfigured() {
  return Boolean(
    (config.institutionalSmc?.researchApiUrl || config.researchApiUrl || '').replace(/\/$/, ''),
  );
}

/** Whether Python institutional engine can be called (research-api URL set). */
export function isInstitutionalEngineAvailable() {
  return isResearchApiConfigured();
}

/** Active engine id from control settings (runtime toggle on Risk page). */
export async function getActiveSignalEngineId() {
  const settings = await getLocalControlSettings();
  let preferred = settings.signal_engine || defaultEngineFromEnv();

  if (preferred === SIGNAL_ENGINE_SMC_MTF && !isLegacySmcMtfEnabled()) {
    preferred = isInstitutionalEngineAvailable()
      ? SIGNAL_ENGINE_INSTITUTIONAL
      : preferred;
  }

  const engineId = VALID_ENGINES.has(preferred) ? preferred : defaultEngineFromEnv();

  if (engineId === SIGNAL_ENGINE_INSTITUTIONAL && !isInstitutionalEngineAvailable()) {
    console.warn('[SignalEngine] institutional-smc unavailable — scanner will skip (legacy smc-mtf disabled)');
    return SIGNAL_ENGINE_INSTITUTIONAL;
  }
  return engineId;
}

export async function getActiveSignalStrategy() {
  const engineId = await getActiveSignalEngineId();
  if (engineId === SIGNAL_ENGINE_INSTITUTIONAL) {
    return getStrategy(SIGNAL_ENGINE_INSTITUTIONAL);
  }
  if (!isLegacySmcMtfEnabled()) {
    return getStrategy(SIGNAL_ENGINE_INSTITUTIONAL) || null;
  }
  const strategy = getStrategy(engineId);
  if (!strategy) {
    console.warn(`[SignalEngine] Strategy ${engineId} not registered — falling back to smc-mtf`);
    return getStrategy(SIGNAL_ENGINE_SMC_MTF);
  }
  return strategy;
}

export async function getSignalEngineStatus() {
  const settings = await getLocalControlSettings();
  const active = await getActiveSignalEngineId();
  return {
    active_engine: active,
    requested_engine: settings.signal_engine || defaultEngineFromEnv(),
    smc_mtf: {
      id: SIGNAL_ENGINE_SMC_MTF,
      available: isLegacySmcMtfEnabled(),
      enabled: isLegacySmcMtfEnabled(),
      label: 'SMC-MTF (Legacy Node)',
    },
    institutional_smc: {
      id: SIGNAL_ENGINE_INSTITUTIONAL,
      available: isInstitutionalEngineAvailable(),
      configured: isResearchApiConfigured(),
      env_enabled: config.institutionalSmc?.enabled === true,
      min_score: settings.institutional_min_score ?? config.institutionalSmc?.minScore ?? 80,
      engine_version: config.institutionalSmc?.engineVersion || 'v2',
      label: 'Institutional SMC v2 (Python)',
    },
  };
}

export async function setSignalEngine(engineId, actor = 'dashboard') {
  if (!VALID_ENGINES.has(engineId)) {
    throw new Error(`Invalid signal engine: ${engineId}`);
  }
  if (engineId === SIGNAL_ENGINE_SMC_MTF && !isLegacySmcMtfEnabled()) {
    throw new Error('Legacy SMC-MTF engine is disabled. Use institutional-smc (v2) only.');
  }
  if (engineId === SIGNAL_ENGINE_INSTITUTIONAL && !isInstitutionalEngineAvailable()) {
    throw new Error('Institutional SMC requires RESEARCH_API_URL');
  }
  const { updateLocalControlSettings } = await import('./controlCenter.js');
  const result = await updateLocalControlSettings({ signal_engine: engineId }, actor);
  const { clearScannerUniverseCache } = await import('./scannerUniverse.js');
  clearScannerUniverseCache();
  const { cacheInvalidatePrefix } = await import('./cache.js');
  await cacheInvalidatePrefix('dash:').catch(() => {});
  await cacheInvalidatePrefix('dashboard:').catch(() => {});
  return result;
}
