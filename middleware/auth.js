// ============================================================
// Auth Middleware
// ============================================================
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'expense-manager-jwt-secret-change-in-prod';

function requireAuth(req, res, next) {
  // 1. JWT Bearer token (mobile apps)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.session = req.session || {};
      req.session.userId = decoded.userId;
      req.session.displayName = decoded.displayName;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }
  // 2. Session cookie (web)
  if (req.session && req.session.userId) {
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

function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  const db = require('../db/database');
  const user = db.findUserById(req.session.userId);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { requireAuth, guestOnly, requireAdmin };
