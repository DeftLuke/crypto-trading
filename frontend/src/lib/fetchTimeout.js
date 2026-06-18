export async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function deferNonCritical(task) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => { task().catch(() => {}); }, { timeout: 2000 });
    return;
  }
  setTimeout(() => { task().catch(() => {}); }, 150);
}
