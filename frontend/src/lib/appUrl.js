/** Production dashboard URL for Supabase email redirects */
export function getAppUrl() {
  const configured = import.meta.env.VITE_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://trade.deftluke.online';
}

export const AUTH_CALLBACK_PATH = '/';
