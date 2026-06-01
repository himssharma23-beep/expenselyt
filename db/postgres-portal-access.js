const { query } = require('./postgres');

let ensured = false;

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePortalType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['tenant', 'society'].includes(normalized) ? normalized : 'tenant';
}

function normalizeAccessKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['otp_login', 'widget_login', 'session_open'].includes(normalized) ? normalized : 'session_open';
}

function normalizeSearch(value) {
  return String(value || '').trim();
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

async function ensureSchema() {
  if (ensured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS portal_access_logs (
      id BIGSERIAL PRIMARY KEY,
      portal_type TEXT NOT NULL,
      access_kind TEXT NOT NULL,
      tenant_id BIGINT,
      member_id BIGINT,
      owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      session_id TEXT,
      display_name TEXT,
      phone_number TEXT,
      unit_label TEXT,
      property_type TEXT,
      location_label TEXT,
      ip_address TEXT,
      user_agent TEXT,
      logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_portal_access_logs_logged_at ON portal_access_logs (logged_at DESC) WHERE deleted_at IS NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_portal_access_logs_portal_kind ON portal_access_logs (portal_type, access_kind, logged_at DESC) WHERE deleted_at IS NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_portal_access_logs_owner ON portal_access_logs (owner_user_id, logged_at DESC) WHERE deleted_at IS NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_portal_access_logs_tenant ON portal_access_logs (tenant_id, logged_at DESC) WHERE deleted_at IS NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_portal_access_logs_member ON portal_access_logs (member_id, logged_at DESC) WHERE deleted_at IS NULL`);
  ensured = true;
}

async function logPortalAccess(entry = {}) {
  await ensureSchema();
  const portalType = normalizePortalType(entry.portal_type);
  const accessKind = normalizeAccessKind(entry.access_kind);
  await query(
    `INSERT INTO portal_access_logs
      (portal_type, access_kind, tenant_id, member_id, owner_user_id, session_id, display_name, phone_number, unit_label, property_type, location_label, ip_address, user_agent, logged_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14::timestamptz, NOW()))`,
    [
      portalType,
      accessKind,
      entry.tenant_id ? Number(entry.tenant_id) : null,
      entry.member_id ? Number(entry.member_id) : null,
      entry.owner_user_id ? Number(entry.owner_user_id) : null,
      String(entry.session_id || '').trim() || null,
      String(entry.display_name || '').trim() || null,
      String(entry.phone_number || '').trim() || null,
      String(entry.unit_label || '').trim() || null,
      String(entry.property_type || '').trim() || null,
      String(entry.location_label || '').trim() || null,
      String(entry.ip_address || '').trim() || null,
      String(entry.user_agent || '').trim() || null,
      entry.logged_at || null,
    ]
  );
  return true;
}

function mapRow(row) {
  return {
    id: Number(row.id),
    portal_type: row.portal_type || 'tenant',
    access_kind: row.access_kind || 'session_open',
    tenant_id: row.tenant_id != null ? Number(row.tenant_id) : null,
    member_id: row.member_id != null ? Number(row.member_id) : null,
    owner_user_id: row.owner_user_id != null ? Number(row.owner_user_id) : null,
    session_id: row.session_id || '',
    display_name: row.display_name || '',
    phone_number: row.phone_number || '',
    unit_label: row.unit_label || '',
    property_type: row.property_type || '',
    location_label: row.location_label || '',
    ip_address: row.ip_address || '',
    user_agent: row.user_agent || '',
    logged_at: row.logged_at || row.created_at || null,
    created_at: row.created_at || null,
  };
}

async function listPortalAccessLogs(filters = {}) {
  await ensureSchema();
  const page = Math.max(1, Math.trunc(toNumber(filters.page, 1)));
  const pageSize = Math.min(100, Math.max(10, Math.trunc(toNumber(filters.page_size, 20))));
  const params = [];
  const where = [`deleted_at IS NULL`];
  const portalType = String(filters.portal_type || 'all').trim().toLowerCase();
  const accessKind = String(filters.access_kind || 'all').trim().toLowerCase();
  const search = normalizeSearch(filters.search);
  const fromDate = normalizeDate(filters.from_date);
  const toDate = normalizeDate(filters.to_date);

  if (portalType && portalType !== 'all') {
    params.push(portalType);
    where.push(`portal_type = $${params.length}`);
  }
  if (accessKind && accessKind !== 'all') {
    params.push(accessKind);
    where.push(`access_kind = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where.push(`(
      lower(COALESCE(display_name, '')) LIKE $${params.length}
      OR lower(COALESCE(phone_number, '')) LIKE $${params.length}
      OR lower(COALESCE(unit_label, '')) LIKE $${params.length}
      OR lower(COALESCE(location_label, '')) LIKE $${params.length}
      OR lower(COALESCE(ip_address, '')) LIKE $${params.length}
    )`);
  }
  if (fromDate) {
    params.push(fromDate);
    where.push(`logged_at >= ($${params.length}::date)`);
  }
  if (toDate) {
    params.push(toDate);
    where.push(`logged_at < (($${params.length}::date) + INTERVAL '1 day')`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await query(`SELECT COUNT(*)::int AS total FROM portal_access_logs ${whereSql}`, params);
  const total = Number(countResult.rows[0]?.total || 0);
  const offset = (page - 1) * pageSize;
  const rowsResult = await query(
    `SELECT *
     FROM portal_access_logs
     ${whereSql}
     ORDER BY logged_at DESC, id DESC
     LIMIT $${params.length + 1}
     OFFSET $${params.length + 2}`,
    [...params, pageSize, offset]
  );
  const summaryResult = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE portal_type = 'tenant')::int AS tenant_total,
       COUNT(*) FILTER (WHERE portal_type = 'society')::int AS society_total,
       COUNT(*) FILTER (WHERE access_kind = 'session_open')::int AS session_open_total,
       COUNT(*) FILTER (WHERE access_kind IN ('otp_login', 'widget_login'))::int AS login_total
     FROM portal_access_logs
     ${whereSql}`,
    params
  );
  return {
    logs: rowsResult.rows.map(mapRow),
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      total: Number(summaryResult.rows[0]?.total || 0),
      tenant_total: Number(summaryResult.rows[0]?.tenant_total || 0),
      society_total: Number(summaryResult.rows[0]?.society_total || 0),
      session_open_total: Number(summaryResult.rows[0]?.session_open_total || 0),
      login_total: Number(summaryResult.rows[0]?.login_total || 0),
    },
  };
}

module.exports = {
  ensureSchema,
  logPortalAccess,
  listPortalAccessLogs,
};
