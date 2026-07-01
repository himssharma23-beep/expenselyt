// ============================================================
// Auth Middleware
// ============================================================
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'expense-manager-jwt-secret-change-in-prod';
const pgDb = require('../db/postgres-auth');

function parseUserAgent(userAgent) {
  const ua = String(userAgent || '').trim().toLowerCase();
  let browser = 'Browser';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('opr/') || ua.includes('opera')) browser = 'Opera';
  else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';

  let os = 'Unknown OS';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) os = 'iOS';
  else if (ua.includes('mac os') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  return { browser, os };
}

function updateWebSessionState(req) {
  if (!req.session) return;
  const nowIso = new Date().toISOString();
  const userAgent = String(req.headers['user-agent'] || '').trim();
  const { browser, os } = parseUserAgent(userAgent);
  req.session.createdAt = req.session.createdAt || nowIso;
  req.session.lastSeenAt = nowIso;
  req.session.authTransport = 'web';
  req.session.deviceInfo = {
    platform: 'web',
    client_name: browser,
    device_name: `${browser} on ${os}`,
    user_agent: userAgent || `${browser} on ${os}`,
    ip_address: String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || '').trim() || null,
    subtitle: `${browser} - ${os}`,
  };
}

async function requireAuth(req, res, next) {
  // 1. JWT Bearer token (mobile apps)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await pgDb.findUserById(decoded.userId);
      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'Account unavailable' });
      }
      const currentAuthTag = await pgDb.getUserAuthTag(decoded.userId);
      if (!currentAuthTag || decoded.authTag !== currentAuthTag) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
      if (decoded.sessionId) {
        const mobileSession = await pgDb.getMobileAuthSession(decoded.sessionId);
        if (!mobileSession || Number(mobileSession.user_id || 0) !== Number(decoded.userId || 0) || mobileSession.revoked_at || String(mobileSession.auth_tag || '') !== currentAuthTag) {
          return res.status(401).json({ error: 'Session expired. Please log in again.' });
        }
        await pgDb.touchMobileAuthSession(decoded.sessionId, decoded.userId);
        req.mobileSession = mobileSession;
      }
      req.session = req.session || {};
      req.session.userId = decoded.userId;
      req.session.displayName = user.display_name || decoded.displayName;
      req.session.authTag = currentAuthTag;
      req.session.authTransport = 'mobile';
      req.session.mobileSessionId = decoded.sessionId ? String(decoded.sessionId) : '';
      req.session.clientPlatform = String(req.mobileSession?.platform || req.headers['x-client-platform'] || '').trim().toLowerCase() || 'mobile';
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }
  // 2. Session cookie (web)
  if (req.session && req.session.userId) {
    try {
      const user = await pgDb.findUserById(req.session.userId);
      if (!user || !user.is_active) {
        req.session.destroy?.(() => {});
        if (req.originalUrl.startsWith('/api/')) {
          return res.status(401).json({ error: 'Account unavailable' });
        }
        return res.redirect('/login');
      }
      const currentAuthTag = await pgDb.getUserAuthTag(req.session.userId);
      if (!currentAuthTag || req.session.authTag !== currentAuthTag) {
        req.session.destroy?.(() => {});
        if (req.originalUrl.startsWith('/api/')) {
          return res.status(401).json({ error: 'Session expired. Please log in again.' });
        }
        return res.redirect('/login');
      }
      updateWebSessionState(req);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Authentication failed' });
    }
    return next();
  }
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/');
}

function guestOnly(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  return next();
}

async function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = await pgDb.findUserById(req.session.userId);
    if (!user || !user.is_active) {
      req.session.destroy?.(() => {});
      return res.status(401).json({ error: 'Account unavailable' });
    }
    const currentAuthTag = await pgDb.getUserAuthTag(req.session.userId);
    if (!currentAuthTag || req.session.authTag !== currentAuthTag) {
      req.session.destroy?.(() => {});
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    updateWebSessionState(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Admin check failed' });
  }
}


module.exports = { requireAuth, guestOnly, requireAdmin };
