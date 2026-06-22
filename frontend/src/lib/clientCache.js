const PREFIX = 'tgpt:ui:';

export function readClientCache(key, maxAgeMs = 60000) {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (Date.now() - at > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeClientCache(key, data) {
  try {
    sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota */
  }
}

export function isDocumentVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}
