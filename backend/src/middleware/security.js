import { config } from '../config/index.js';

const windowMs = 60_000;
const maxPerWindow = parseInt(process.env.RATE_LIMIT_PER_MIN || '120', 10);
const hits = new Map();

function clientIp(req) {
  return req.headers['cf-connecting-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.ip
    || req.socket?.remoteAddress
    || 'unknown';
}

function isLocalRequest(req) {
  const ip = clientIp(req);
  return ip === '127.0.0.1'
    || ip === '::1'
    || ip === '::ffff:127.0.0.1'
    || ip.startsWith('172.')
    || ip.startsWith('10.');
}

export function rateLimit(req, res, next) {
  if (isLocalRequest(req)) return next();
  const key = `${clientIp(req)}:${req.method}:${req.baseUrl}${req.path}`;
  const now = Date.now();
  const bucket = hits.get(key) || { count: 0, reset: now + windowMs };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + windowMs;
  }
  bucket.count += 1;
  hits.set(key, bucket);
  if (bucket.count > maxPerWindow) {
    return res.status(429).json({ error: 'Too many requests — try again shortly' });
  }
  return next();
}

export function strictRateLimit(max = 20) {
  return (req, res, next) => {
    if (isLocalRequest(req)) return next();
    const key = `strict:${clientIp(req)}:${req.path}`;
    const now = Date.now();
    const bucket = hits.get(key) || { count: 0, reset: now + windowMs };
    if (now > bucket.reset) {
      bucket.count = 0;
      bucket.reset = now + windowMs;
    }
    bucket.count += 1;
    hits.set(key, bucket);
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Rate limit exceeded for this action' });
    }
    return next();
  };
}

export function corsOptions() {
  const defaults = [
    'https://trade.deftluke.online',
    'https://terminal.deftluke.online',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  const allowed = (process.env.CORS_ORIGINS || defaults.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    origin(origin, callback) {
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else if (config.nodeEnv !== 'production') {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
  };
}

export function requireInternalOrAuth(req, res, next) {
  const secret = process.env.INTERNAL_API_SECRET;
  const provided = req.get('X-Internal-Key') || req.get('X-Internal-Secret');
  if (secret && provided === secret) return next();
  if (isLocalRequest(req)) return next();

  const ingestionKey = config.externalSignals?.ingestionKey;
  const ingestHeader = req.get('X-Ingestion-Key') || req.body?.ingestion_key;
  if (ingestionKey && ingestHeader === ingestionKey) return next();

  if (req.user?.id) return next();

  return res.status(401).json({
    error: 'Unauthorized — sign in or use internal credentials',
    hint: 'Trade execution API is protected in production',
  });
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}
