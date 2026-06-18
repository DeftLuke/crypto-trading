import { getSupabase } from '../services/supabase.js';

export async function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const db = getSupabase();
    if (!db) {
      req.user = null;
      return next();
    }
    const { data: { user }, error } = await db.auth.getUser(token);
    req.user = error ? null : user;
  } catch {
    req.user = null;
  }
  next();
}

export async function requireAuth(req, res, next) {
  await optionalAuth(req, res, () => {});
  if (!req.user) {
    return res.status(401).json({ error: 'Sign in required to manage API keys' });
  }
  next();
}
