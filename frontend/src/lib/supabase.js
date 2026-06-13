import { createClient } from '@supabase/supabase-js';
import { getAppUrl } from './appUrl.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && key
  ? createClient(url, key, {
      auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        flowType: 'pkce',
      },
    })
  : null;

export const isAuthEnabled = Boolean(supabase);

/** URL Supabase should redirect to after email confirm / magic link */
export function getAuthRedirectUrl() {
  return `${getAppUrl()}${import.meta.env.VITE_AUTH_CALLBACK_PATH || '/'}`;
}
