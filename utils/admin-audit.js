const { query } = require('../db/postgres');

let ensurePromise = null;

function sanitizeValue(value, depth = 0) {
  if (depth > 3) return '[truncated]';
  if (value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, raw] of Object.entries(value)) {
      const normalizedKey = String(key || '').toLowerCase();
      if (
        normalizedKey.includes('password')
        || normalizedKey.includes('token')
        || normalizedKey.includes('secret')
        || normalizedKey.includes('otp')
        || normalizedKey.includes('file')
        || normalizedKey.includes('buffer')
        || normalizedKey.includes('image')
      ) {
        out[key] = '[redacted]';
      } else {
        out[key] = sanitizeValue(raw, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  return value;
}

async function ensureAdminAuditTable() {
  if (!ensurePromise) {
    ensurePromise = query(`
      CREATE TABLE IF NOT EXISTS admin_action_audit (
        id BIGSERIAL PRIMARY KEY,
        admin_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action_method TEXT NOT NULL,
        action_path TEXT NOT NULL,
        action_status INTEGER NOT NULL DEFAULT 200,
        target_hint TEXT DEFAULT '',
        request_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_action_audit_admin_user_id ON admin_action_audit(admin_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_action_audit_created_at ON admin_action_audit(created_at DESC);
    `).catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

function inferTargetHint(req) {
  const path = String(req.path || '').trim();
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const pieces = [];
  if (req.params?.id) pieces.push(`id:${req.params.id}`);
  if (body.user_id) pieces.push(`user:${body.user_id}`);
  if (body.email) pieces.push(`email:${String(body.email).trim().toLowerCase()}`);
  if (body.username) pieces.push(`username:${String(body.username).trim().toLowerCase()}`);
  return `${path}${pieces.length ? ` | ${pieces.join(' | ')}` : ''}`;
}

async function writeAdminAuditEntry(req, res) {
  const adminUserId = Number(req.session?.userId || 0);
  if (!adminUserId) return;
  await ensureAdminAuditTable();
  const payload = {
    params: sanitizeValue(req.params || {}),
    query: sanitizeValue(req.query || {}),
    body: sanitizeValue(req.body || {}),
  };
  await query(
    `INSERT INTO admin_action_audit
      (admin_user_id, action_method, action_path, action_status, target_hint, request_summary, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
    [
      adminUserId,
      String(req.method || '').toUpperCase(),
      String(req.originalUrl || req.path || ''),
      Number(res.statusCode || 200),
      inferTargetHint(req),
      JSON.stringify(payload),
      String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.ip || '').trim() || null,
      String(req.headers['user-agent'] || '').trim() || null,
    ],
  );
}

module.exports = {
  ensureAdminAuditTable,
  writeAdminAuditEntry,
};
