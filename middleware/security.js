const { URL } = require('url');

const DEFAULT_SESSION_SECRET = 'expense-manager-secret-change-in-production';
const DEFAULT_JWT_SECRET = 'expense-manager-jwt-secret-change-in-prod';
const failedAuthAttempts = new Map();

function isProductionLike() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function normalizeOrigin(origin) {
  const raw = String(origin || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin.toLowerCase();
  } catch (_err) {
    return '';
  }
}

function buildAllowedOrigins() {
  const set = new Set();
  const add = (value) => {
    const normalized = normalizeOrigin(value);
    if (normalized) set.add(normalized);
  };

  add(process.env.APP_BASE_URL);
  String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach(add);

  if (!isProductionLike()) {
    [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:8081',
      'http://127.0.0.1:8081',
      'http://localhost:19006',
      'http://127.0.0.1:19006',
    ].forEach(add);
  }

  return set;
}

function requestOriginMatchesHost(req, origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const protocol = String(req.protocol || 'http').trim();
  const host = String(req.get('host') || '').trim().toLowerCase();
  if (!host) return false;
  return normalized === `${protocol}://${host}`.toLowerCase();
}

function isAllowedCorsOrigin(req, origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (requestOriginMatchesHost(req, normalized)) return true;
  return buildAllowedOrigins().has(normalized);
}

function corsForApp(req, res, next) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) {
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Platform, X-Client-Name, X-Device-Name');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }

  if (!isAllowedCorsOrigin(req, origin)) {
    if (req.method === 'OPTIONS') {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Platform, X-Client-Name, X-Device-Name');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

function securityHeaders(req, res, next) {
  const requestPath = String(req.path || req.originalUrl || '').trim().toLowerCase();
  const isSameOriginEmbeddableAsset = requestPath.startsWith('/uploads/');
  res.removeHeader('X-Powered-By');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', isSameOriginEmbeddableAsset ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (isProductionLike()) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
}

function hasBearerAuth(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  return /^Bearer\s+/i.test(authHeader);
}

function isTrustedNativeAppRequest(req) {
  const platform = String(req.headers['x-client-platform'] || '').trim().toLowerCase();
  if (!platform || platform === 'web') return false;
  const origin = String(req.headers.origin || '').trim();
  const referer = String(req.headers.referer || '').trim();
  return !origin && !referer;
}

function enforceSameOriginForSessionWrites(req, res, next) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();
  if (!String(req.originalUrl || '').startsWith('/api/')) return next();
  if (hasBearerAuth(req)) return next();
  if (isTrustedNativeAppRequest(req)) return next();
  if (!req.session?.userId) return next();

  const origin = String(req.headers.origin || '').trim();
  const referer = String(req.headers.referer || '').trim();
  if (origin && isAllowedCorsOrigin(req, origin)) return next();
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (isAllowedCorsOrigin(req, refererOrigin)) return next();
    } catch (_err) {}
  }
  return res.status(403).json({ error: 'Blocked by origin check' });
}

function createRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs || 15 * 60 * 1000);
  const max = Number(options.max || 60);
  const message = String(options.message || 'Too many requests. Please try again later.');
  const keyFn = typeof options.keyFn === 'function'
    ? options.keyFn
    : (req) => String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || 'unknown').trim();

  const hits = new Map();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = `${String(options.bucket || 'default')}:${keyFn(req)}`;
    const current = hits.get(key);
    const base = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + windowMs };
    base.count += 1;
    hits.set(key, base);

    const remaining = Math.max(0, max - base.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(base.resetAt / 1000)));

    if (base.count > max) {
      const retryAfter = Math.max(1, Math.ceil((base.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message });
    }

    if (hits.size > 5000) {
      for (const [entryKey, entry] of hits.entries()) {
        if (!entry || entry.resetAt <= now) hits.delete(entryKey);
      }
    }
    next();
  };
}

function normalizeAuthIdentifier(value) {
  return String(value || '').trim().toLowerCase().slice(0, 160);
}

function authAttemptKey(identifier, ipAddress) {
  return `${normalizeAuthIdentifier(identifier)}|${String(ipAddress || 'unknown').trim()}`;
}

function currentIpAddress(req) {
  return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || 'unknown').trim();
}

function getLoginLockState(req, identifier) {
  const key = authAttemptKey(identifier, currentIpAddress(req));
  const now = Date.now();
  const current = failedAuthAttempts.get(key);
  if (!current || current.lockUntil <= now) {
    if (current && current.lockUntil <= now) failedAuthAttempts.delete(key);
    return { locked: false, remainingMs: 0, attempts: current?.count || 0 };
  }
  return { locked: true, remainingMs: current.lockUntil - now, attempts: current.count || 0 };
}

function registerFailedLoginAttempt(req, identifier) {
  const key = authAttemptKey(identifier, currentIpAddress(req));
  const now = Date.now();
  const existing = failedAuthAttempts.get(key);
  const current = existing && existing.lockUntil > now
    ? existing
    : { count: 0, firstAt: now, lockUntil: now + (15 * 60 * 1000) };
  current.count += 1;
  current.lockUntil = now + (15 * 60 * 1000);
  failedAuthAttempts.set(key, current);
  return current.count;
}

function clearFailedLoginAttempts(req, identifier) {
  failedAuthAttempts.delete(authAttemptKey(identifier, currentIpAddress(req)));
}

function loginLockoutMiddleware(req, res, next) {
  const identifier = String(req.body?.username || req.body?.email || req.body?.mobile || '').trim();
  if (!identifier) return next();
  const state = getLoginLockState(req, identifier);
  if (!state.locked) return next();
  const retryAfter = Math.max(1, Math.ceil(state.remainingMs / 1000));
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({
    error: `Too many failed login attempts. Please wait ${Math.ceil(retryAfter / 60)} minute(s) and try again.`,
  });
}

const loginRateLimiter = createRateLimiter({
  bucket: 'login',
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
});

const registerRateLimiter = createRateLimiter({
  bucket: 'register',
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many registration attempts. Please try again later.',
});

const passwordResetRateLimiter = createRateLimiter({
  bucket: 'password-reset',
  windowMs: 30 * 60 * 1000,
  max: 6,
  message: 'Too many password reset attempts. Please try again later.',
});

const publicContactRateLimiter = createRateLimiter({
  bucket: 'public-contact',
  windowMs: 30 * 60 * 1000,
  max: 10,
  message: 'Too many contact requests. Please try again later.',
});

const adminRateLimiter = createRateLimiter({
  bucket: 'admin',
  windowMs: 5 * 60 * 1000,
  max: 300,
  message: 'Too many admin requests. Please slow down and try again.',
  keyFn: (req) => `${String(req.session?.userId || 'anon')}:${String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || 'unknown').trim()}`,
});

function assertSecureRuntimeConfig() {
  if (!isProductionLike()) return;
  const sessionSecret = String(process.env.SESSION_SECRET || '').trim();
  const jwtSecret = String(process.env.JWT_SECRET || '').trim();
  const errors = [];
  if (!sessionSecret || sessionSecret === DEFAULT_SESSION_SECRET || sessionSecret.length < 32) {
    errors.push('SESSION_SECRET must be set to a strong random value (min 32 chars) in production.');
  }
  if (!jwtSecret || jwtSecret === DEFAULT_JWT_SECRET || jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be set to a strong random value (min 32 chars) in production.');
  }
  if (errors.length) {
    throw new Error(errors.join(' '));
  }
}

module.exports = {
  adminRateLimiter,
  assertSecureRuntimeConfig,
  corsForApp,
  enforceSameOriginForSessionWrites,
  clearFailedLoginAttempts,
  currentIpAddress,
  getLoginLockState,
  isProductionLike,
  loginLockoutMiddleware,
  loginRateLimiter,
  passwordResetRateLimiter,
  publicContactRateLimiter,
  registerFailedLoginAttempt,
  registerRateLimiter,
  securityHeaders,
};
