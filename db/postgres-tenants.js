const crypto = require('crypto');
const { query, withTransaction } = require('./postgres');

let tenantSchemaEnsured = false;

function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function num(value) {
  return Math.round((Number(value || 0) || 0) * 100) / 100;
}

function normalizeText(value, label, maxLength = 160) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) throw validationError(`${label} is required`);
  if (normalized.length > maxLength) throw validationError(`${label} must be ${maxLength} characters or fewer`);
  return normalized;
}

function normalizeOptionalText(value, maxLength = 500) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) throw validationError(`Text must be ${maxLength} characters or fewer`);
  return normalized;
}

function normalizePhoneNumber(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.length > 30) throw validationError('Contact number must be 30 characters or fewer');
  if (!/^[0-9+\-() ]+$/.test(normalized)) throw validationError('Contact number contains invalid characters');
  return normalized;
}

function phoneDigits(value) {
  return String(value || '').replace(/\D+/g, '').trim();
}

function normalizeDateValue(value, label = 'Date') {
  const raw = String(value || '').trim();
  if (!raw) throw validationError(`${label} is required`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw validationError(`${label} must be in YYYY-MM-DD format`);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw validationError(`${label} is invalid`);
  return raw;
}

function normalizeOptionalDateValue(value, label = 'Date') {
  if (value == null || value === '') return null;
  return normalizeDateValue(value, label);
}

function formatLocalDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysToDateValue(dateValue, days) {
  const raw = String(dateValue || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + Number(days || 0));
  return formatLocalDateValue(date);
}

function normalizeMonthKey(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) throw validationError('Month must be in YYYY-MM format');
  return raw;
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function monthKeyToDate(monthKey) {
  const normalized = normalizeMonthKey(monthKey);
  const parsed = new Date(`${normalized}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw validationError('Month is invalid');
  return parsed;
}

function previousMonthKey(monthKey) {
  const date = monthKeyToDate(monthKey);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function formatInvoiceMonthLabel(monthKey) {
  const date = monthKeyToDate(monthKey);
  return date.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function currentDateValue() {
  return formatLocalDateValue(new Date());
}

function monthStartDateValue(monthKey) {
  return `${normalizeMonthKey(monthKey)}-01`;
}

function monthEndDateValue(monthKey) {
  const date = monthKeyToDate(monthKey);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return formatLocalDateValue(date);
}

async function syncExpiredTenantStatuses(userId) {
  await ensureTenantTables();
  await query(
    `UPDATE tenant_records
     SET is_active = FALSE,
         updated_at = NOW()
     WHERE user_id = $1
       AND is_active = TRUE
       AND end_date IS NOT NULL
       AND end_date <= $2`,
    [userId, currentDateValue()]
  );
}

function normalizeImportLookup(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tenantImportRoomLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^room\b/i.test(raw)) return raw.replace(/\s+/g, ' ').trim();
  return `Room ${raw}`;
}

function tenantImportName(value) {
  return String(value || '').trim() || 'Tenant';
}

function safeImportDate(value, fallback = null) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    return normalizeDateValue(raw, 'Date');
  } catch (_err) {
    return fallback;
  }
}

function normalizeImportPhoneNumber(value) {
  const normalized = String(value || '').replace(/[,;/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, 30);
}

function combineImportNotes(parts = []) {
  return parts
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000) || null;
}

function importInvoiceMonthActivityKey(monthKey) {
  const raw = String(monthKey || '').trim();
  return /^\d{4}-\d{2}$/.test(raw) ? `${raw}-31` : '';
}

function normalizeAmount(value, label = 'Amount', { allowZero = true, allowNegative = false } = {}) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw validationError(`${label} is invalid`);
  if (!allowNegative && (allowZero ? amount < 0 : amount <= 0)) {
    throw validationError(`${label} must be ${allowZero ? '0 or more' : 'greater than 0'}`);
  }
  return Math.round(amount * 100) / 100;
}

function normalizeInteger(value, label = 'Number', { min = 0, max = 1000000, allowNull = false } = {}) {
  if (allowNull && (value == null || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw validationError(`${label} must be a whole number`);
  if (parsed < min || parsed > max) throw validationError(`${label} must be between ${min} and ${max}`);
  return parsed;
}

function normalizeContractMonths(value) {
  return normalizeInteger(value, 'Contract period', { min: 0, max: 240, allowNull: true });
}

function normalizeAttachmentList(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? value.split('\n')
      : [];
  return list
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeFileAttachmentObjects(value, limit = 12) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => tenantFileJson(item))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeTenantPaymentStatus(value) {
  const normalized = String(value || 'pending').trim().toLowerCase();
  if (['pending', 'paid', 'partial_paid', 'partial paid', 'partial'].includes(normalized)) {
    return normalized.startsWith('partial') ? 'partial_paid' : normalized;
  }
  throw validationError('Invoice status must be pending, paid, or partial paid');
}

function normalizeSplitFlag(value, fallback = false) {
  if (value === undefined) return !!fallback;
  return value === true || value === 'true' || value === 1 || value === '1' || value === 'on';
}

function normalizeTenantInvoiceSplitConfig(value = {}, defaultValue = false) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    divide_rent: normalizeSplitFlag(source.divide_rent, defaultValue),
    divide_electricity: normalizeSplitFlag(source.divide_electricity, defaultValue),
    divide_sewerage: normalizeSplitFlag(source.divide_sewerage, defaultValue),
    divide_water: normalizeSplitFlag(source.divide_water, defaultValue),
    divide_cleaning: normalizeSplitFlag(source.divide_cleaning, defaultValue),
    divide_other: normalizeSplitFlag(source.divide_other, defaultValue),
  };
}

function divideTenantChargeAmount(amount, shouldDivide, divisor) {
  const safeAmount = num(amount);
  const safeDivisor = Math.max(1, Number(divisor || 1));
  if (!shouldDivide || safeDivisor <= 1) return safeAmount;
  return Math.round((safeAmount / safeDivisor) * 100) / 100;
}

function applySplitToOtherChargeItems(items = [], shouldDivide, divisor) {
  return normalizeOtherChargeItems(items).map((item) => (
    isCarryForwardChargeItem(item)
      ? item
      : { ...item, amount: divideTenantChargeAmount(item.amount, shouldDivide, divisor) }
  ));
}

function normalizeOtherChargeItems(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      const detail = String(item?.detail || item?.description || '').trim();
      const amountRaw = item?.amount;
      const amount = normalizeAmount(amountRaw, 'Other charge amount', { allowZero: true, allowNegative: true });
      if (!detail && !amount) return null;
      const normalized = {
        detail: normalizeText(detail || 'Other charge', 'Other charge detail', 160),
        amount,
      };
      const kind = String(item?.kind || '').trim();
      if (kind) normalized.kind = kind.slice(0, 60);
      const sourceInvoiceMonth = String(item?.source_invoice_month || '').trim();
      if (sourceInvoiceMonth) normalized.source_invoice_month = normalizeMonthKey(sourceInvoiceMonth);
      return normalized;
    })
    .filter(Boolean)
    .slice(0, 20);
}

function isCarryForwardChargeItem(item) {
  return String(item?.kind || '').trim().toLowerCase() === 'carry_forward_pending';
}

function stripCarryForwardChargeItems(items = []) {
  return normalizeOtherChargeItems(items).filter((item) => !isCarryForwardChargeItem(item));
}

function sortMonthKeysAsc(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => normalizeMonthKey(value)))].sort((a, b) => a.localeCompare(b));
}

async function buildTenantPendingCarryForwardItems(tenantId, invoiceMonth) {
  const targetMonth = normalizeMonthKey(invoiceMonth);
  const previousMonth = previousMonthKey(targetMonth);
  const result = await query(
    `SELECT invoice_month, total_amount, paid_amount, other_charge_items
     FROM tenant_invoices
     WHERE tenant_id = $1
       AND invoice_month < $2
     ORDER BY invoice_month ASC, id ASC`,
    [tenantId, targetMonth]
  );

  const outstandingByMonth = new Map();
  for (const row of result.rows || []) {
    const rowMonth = normalizeMonthKey(row.invoice_month);
    const chargeItems = normalizeOtherChargeItems(row.other_charge_items);
    const carryItems = chargeItems.filter(isCarryForwardChargeItem);
    const carryTotal = sumOtherChargeItems(carryItems);
    const baseAmount = Math.max(0, num(row.total_amount) - carryTotal);
    if (baseAmount > 0) {
      outstandingByMonth.set(rowMonth, num((outstandingByMonth.get(rowMonth) || 0) + baseAmount));
    }

    let paymentRemaining = Math.max(0, num(row.paid_amount));
    if (paymentRemaining > 0 && carryItems.length) {
      const carryMonths = sortMonthKeysAsc(carryItems.map((item) => item.source_invoice_month).filter(Boolean));
      for (const sourceMonth of carryMonths) {
        if (paymentRemaining <= 0) break;
        const currentOutstanding = num(outstandingByMonth.get(sourceMonth) || 0);
        if (currentOutstanding <= 0) continue;
        const applied = Math.min(paymentRemaining, currentOutstanding);
        outstandingByMonth.set(sourceMonth, num(currentOutstanding - applied));
        paymentRemaining = num(paymentRemaining - applied);
      }
    }

    if (paymentRemaining > 0) {
      const currentOutstanding = num(outstandingByMonth.get(rowMonth) || 0);
      if (currentOutstanding > 0) {
        const applied = Math.min(paymentRemaining, currentOutstanding);
        outstandingByMonth.set(rowMonth, num(currentOutstanding - applied));
      }
    }
  }

  return sortMonthKeysAsc([...outstandingByMonth.keys()])
    .map((monthKey) => ({
      monthKey,
      amount: num(outstandingByMonth.get(monthKey) || 0),
    }))
    .filter((item) => item.amount > 0)
    .map((item) => ({
      detail: item.monthKey === previousMonth ? 'Last month pending' : `${formatInvoiceMonthLabel(item.monthKey)} pending`,
      amount: item.amount,
      kind: 'carry_forward_pending',
      source_invoice_month: item.monthKey,
    }));
}

function sumOtherChargeItems(items = []) {
  return Math.round((items || []).reduce((sum, item) => sum + normalizeAmount(item.amount, 'Other charge amount', { allowZero: true, allowNegative: true }), 0) * 100) / 100;
}

function recurringChargeItemsEqual(left = [], right = []) {
  const a = normalizeOtherChargeItems(left);
  const b = normalizeOtherChargeItems(right);
  if (a.length !== b.length) return false;
  return a.every((item, index) => item.detail === b[index]?.detail && num(item.amount) === num(b[index]?.amount));
}

function tenantFileJson(value) {
  if (!value || typeof value !== 'object') return null;
  const path = String(value.path || '').trim();
  const name = String(value.name || '').trim();
  if (!path) return null;
  return { path, name: name || path.split('/').pop() || 'file' };
}

function parseTenantFileJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return tenantFileJson(value);
  try {
    return tenantFileJson(JSON.parse(value));
  } catch (_err) {
    return null;
  }
}

async function ensureTenantTables() {
  if (tenantSchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_buildings (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      address TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, name)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_rooms (
      id BIGSERIAL PRIMARY KEY,
      building_id BIGINT NOT NULL REFERENCES tenant_buildings(id) ON DELETE CASCADE,
      room_label TEXT NOT NULL,
      floor_label TEXT,
      room_type TEXT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (building_id, room_label)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_records (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      building_id BIGINT NOT NULL REFERENCES tenant_buildings(id) ON DELETE CASCADE,
      room_id BIGINT NOT NULL REFERENCES tenant_rooms(id) ON DELETE CASCADE,
      tenant_name TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE,
      contract_months INTEGER,
      tenant_address TEXT,
      address_proof JSONB,
      contact_number TEXT,
      security_deposit NUMERIC(12,2) NOT NULL DEFAULT 0,
      rent_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      proof_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      photo_attachment JSONB,
      electricity_unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      sewerage_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
      water_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
      cleaning_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
      monthly_additional_charges JSONB NOT NULL DEFAULT '[]'::jsonb,
      next_invoice_charge_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      opening_electricity_units INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`ALTER TABLE tenant_records ADD COLUMN IF NOT EXISTS end_date DATE`);
  await query(`ALTER TABLE tenant_records ADD COLUMN IF NOT EXISTS monthly_additional_charges JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`ALTER TABLE tenant_records ADD COLUMN IF NOT EXISTS next_invoice_charge_items JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_charge_history (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenant_records(id) ON DELETE CASCADE,
      effective_from DATE NOT NULL,
      effective_to DATE,
      rent_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      electricity_unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      sewerage_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
      water_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
      cleaning_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
      monthly_additional_charges JSONB NOT NULL DEFAULT '[]'::jsonb,
      opening_electricity_units INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`ALTER TABLE tenant_charge_history ADD COLUMN IF NOT EXISTS monthly_additional_charges JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_vehicles (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenant_records(id) ON DELETE CASCADE,
      vehicle_type TEXT NOT NULL,
      vehicle_number TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_items (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenant_records(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_invoices (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenant_records(id) ON DELETE CASCADE,
      invoice_month TEXT NOT NULL,
      due_date DATE,
      tenant_name_snapshot TEXT NOT NULL,
      building_name_snapshot TEXT NOT NULL,
      room_label_snapshot TEXT NOT NULL,
      contact_number_snapshot TEXT,
      rent_amount_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
      electricity_unit_price_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
      sewerage_charge_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
      water_charge_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
      cleaning_charge_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
      other_charges_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
      other_charge_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      previous_electricity_units INTEGER NOT NULL DEFAULT 0,
      current_electricity_units INTEGER NOT NULL DEFAULT 0,
      electricity_units_used INTEGER NOT NULL DEFAULT 0,
      electricity_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, invoice_month)
    )`);
  await query(`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS other_charge_items JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS split_config JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await query(`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS roommate_count_snapshot INTEGER NOT NULL DEFAULT 1`);
  await query(`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending'`);
  await query(`ALTER TABLE tenant_invoices ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_invoice_share_links (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invoice_id BIGINT NOT NULL REFERENCES tenant_invoices(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ,
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_invoice_month_share_links (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      building_id BIGINT NOT NULL REFERENCES tenant_buildings(id) ON DELETE CASCADE,
      invoice_month TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ,
      view_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS tenant_invoice_payment_requests (
      id BIGSERIAL PRIMARY KEY,
      invoice_id BIGINT NOT NULL REFERENCES tenant_invoices(id) ON DELETE CASCADE,
      tenant_id BIGINT NOT NULL REFERENCES tenant_records(id) ON DELETE CASCADE,
      requested_status TEXT NOT NULL DEFAULT 'paid',
      requested_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      tenant_note TEXT,
      request_source TEXT NOT NULL DEFAULT 'tenant_portal',
      status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT,
      reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`ALTER TABLE tenant_invoice_payment_requests ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await query(`ALTER TABLE tenant_invoice_payment_requests ADD COLUMN IF NOT EXISTS request_source TEXT NOT NULL DEFAULT 'tenant_portal'`);
  await query(`ALTER TABLE tenant_invoice_payment_requests ADD COLUMN IF NOT EXISTS review_note TEXT`);
  await query(`ALTER TABLE tenant_invoice_payment_requests ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE tenant_invoice_payment_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_buildings_user_id ON tenant_buildings(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_rooms_building_id ON tenant_rooms(building_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_records_user_id ON tenant_records(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_records_room_id ON tenant_records(room_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_charge_history_tenant_id ON tenant_charge_history(tenant_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_vehicles_tenant_id ON tenant_vehicles(tenant_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_items_tenant_id ON tenant_items(tenant_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_invoices_tenant_month ON tenant_invoices(tenant_id, invoice_month)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_invoice_share_links_invoice_id ON tenant_invoice_share_links(invoice_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_invoice_share_links_user_id ON tenant_invoice_share_links(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_invoice_month_share_links_building_month ON tenant_invoice_month_share_links(building_id, invoice_month)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_invoice_month_share_links_user_id ON tenant_invoice_month_share_links(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_invoice_payment_requests_invoice_id ON tenant_invoice_payment_requests(invoice_id, requested_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_tenant_invoice_payment_requests_tenant_id ON tenant_invoice_payment_requests(tenant_id, requested_at DESC)`);
  tenantSchemaEnsured = true;
}

async function getBuildingOwnedByUser(userId, buildingId) {
  await ensureTenantTables();
  const result = await query(
    `SELECT id, user_id, name, address, notes, created_at, updated_at
     FROM tenant_buildings
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [buildingId, userId]
  );
  return result.rows[0] || null;
}

async function getRoomOwnedByUser(userId, roomId) {
  await ensureTenantTables();
  const result = await query(
    `SELECT r.id, r.building_id, r.room_label, r.floor_label, r.room_type, r.notes, r.is_active, r.created_at, r.updated_at
     FROM tenant_rooms r
     INNER JOIN tenant_buildings b ON b.id = r.building_id
     WHERE r.id = $1 AND b.user_id = $2
     LIMIT 1`,
    [roomId, userId]
  );
  return result.rows[0] || null;
}

async function getTenantOwnedByUser(userId, tenantId) {
  await ensureTenantTables();
  const result = await query(
    `SELECT t.*
     FROM tenant_records t
     WHERE t.id = $1 AND t.user_id = $2
     LIMIT 1`,
    [tenantId, userId]
  );
  return result.rows[0] || null;
}

async function getInvoiceOwnedByUser(userId, invoiceId) {
  await ensureTenantTables();
  const result = await query(
    `SELECT inv.*
     FROM tenant_invoices inv
     INNER JOIN tenant_records t ON t.id = inv.tenant_id
     WHERE inv.id = $1
       AND t.user_id = $2
     LIMIT 1`,
    [invoiceId, userId]
  );
  return result.rows[0] || null;
}

async function findActiveTenantForRoom(userId, roomId, excludeTenantId = null) {
  await ensureTenantTables();
  const params = [userId, roomId, currentDateValue()];
  let whereExclude = '';
  if (excludeTenantId != null) {
    params.push(excludeTenantId);
    whereExclude = 'AND t.id <> $4';
  }
  const result = await query(
    `SELECT t.id, t.tenant_name, t.room_id
     FROM tenant_records t
     WHERE t.user_id = $1
       AND t.room_id = $2
       AND t.is_active = TRUE
       AND (t.end_date IS NULL OR t.end_date > $3)
       ${whereExclude}
     ORDER BY t.id DESC
     LIMIT 1`,
    params
  );
  return result.rows[0] || null;
}

async function countRoomTenantsForInvoiceMonth(roomId, invoiceMonth, excludeTenantId = null) {
  await ensureTenantTables();
  const monthStart = monthStartDateValue(invoiceMonth);
  const monthEnd = monthEndDateValue(invoiceMonth);
  const params = [roomId, monthStart, monthEnd];
  let excludeSql = '';
  if (excludeTenantId != null) {
    params.push(excludeTenantId);
    excludeSql = 'AND id <> $4';
  }
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM tenant_records
     WHERE room_id = $1
       AND start_date <= $3
       AND (end_date IS NULL OR end_date >= $2)
       AND (is_active = TRUE OR (end_date IS NOT NULL AND end_date >= $2))
       ${excludeSql}`,
    params
  );
  return Math.max(1, Number(result.rows[0]?.count || 0));
}

function mapTenantRow(row) {
  const normalizeRowDate = (value) => {
    if (!value) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) return formatLocalDateValue(value);
    const raw = String(value).trim();
    const directMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (directMatch) return directMatch[1];
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : formatLocalDateValue(parsed);
  };
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    building_id: Number(row.building_id),
    room_id: Number(row.room_id),
    tenant_name: row.tenant_name,
    start_date: normalizeRowDate(row.start_date),
    end_date: normalizeRowDate(row.end_date),
    contract_months: row.contract_months != null ? Number(row.contract_months) : null,
    tenant_address: row.tenant_address || '',
    address_proof: parseTenantFileJson(row.address_proof),
    contact_number: row.contact_number || '',
    security_deposit: num(row.security_deposit),
    rent_amount: num(row.rent_amount),
    proof_attachments: Array.isArray(row.proof_attachments) ? row.proof_attachments.map(tenantFileJson).filter(Boolean) : [],
    photo_attachment: parseTenantFileJson(row.photo_attachment),
    electricity_unit_price: num(row.electricity_unit_price),
    sewerage_charge: num(row.sewerage_charge),
    water_charge: num(row.water_charge),
    cleaning_charge: num(row.cleaning_charge),
    monthly_additional_charges: normalizeOtherChargeItems(row.monthly_additional_charges),
    next_invoice_charge_items: normalizeOtherChargeItems(row.next_invoice_charge_items),
    opening_electricity_units: Number(row.opening_electricity_units || 0),
    is_active: row.is_active !== false,
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapChargeHistoryRow(row) {
  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    effective_from: row.effective_from ? formatLocalDateValue(row.effective_from instanceof Date ? row.effective_from : new Date(String(row.effective_from).slice(0, 10) + 'T00:00:00')) : '',
    effective_to: row.effective_to ? formatLocalDateValue(row.effective_to instanceof Date ? row.effective_to : new Date(String(row.effective_to).slice(0, 10) + 'T00:00:00')) : '',
    rent_amount: num(row.rent_amount),
    electricity_unit_price: num(row.electricity_unit_price),
    sewerage_charge: num(row.sewerage_charge),
    water_charge: num(row.water_charge),
    cleaning_charge: num(row.cleaning_charge),
    monthly_additional_charges: normalizeOtherChargeItems(row.monthly_additional_charges),
    opening_electricity_units: Number(row.opening_electricity_units || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function createTenantChargeHistory(clientOrQuery, tenantId, data = {}) {
  const runner = clientOrQuery?.query ? clientOrQuery : { query };
  const result = await runner.query(
    `INSERT INTO tenant_charge_history (
      tenant_id, effective_from, effective_to, rent_amount, electricity_unit_price,
      sewerage_charge, water_charge, cleaning_charge, monthly_additional_charges, opening_electricity_units, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9::jsonb, $10, NOW()
    )
    RETURNING *`,
    [
      tenantId,
      normalizeDateValue(data.effective_from, 'Charge effective from'),
      normalizeOptionalDateValue(data.effective_to, 'Charge effective to'),
      normalizeAmount(data.rent_amount, 'Rent amount per month'),
      normalizeAmount(data.electricity_unit_price, 'Electricity per unit price'),
      normalizeAmount(data.sewerage_charge, 'Sewerage charge'),
      normalizeAmount(data.water_charge, 'Water charge'),
      normalizeAmount(data.cleaning_charge, 'Cleaning charge'),
      JSON.stringify(normalizeOtherChargeItems(data.monthly_additional_charges)),
      normalizeInteger(data.opening_electricity_units, 'Opening electricity units', { min: 0, max: 100000000 }),
    ]
  );
  return result.rows[0] ? mapChargeHistoryRow(result.rows[0]) : null;
}

async function ensureTenantHasChargeHistory(clientOrQuery, tenantRow) {
  const runner = clientOrQuery?.query ? clientOrQuery : { query };
  const tenant = tenantRow && tenantRow.id ? tenantRow : null;
  if (!tenant) return;
  const existing = await listTenantChargeHistory(runner, [tenant.id]);
  if (existing.length) return;
  const mapped = tenant.start_date ? mapTenantRow(tenant) : tenant;
  await createTenantChargeHistory(runner, tenant.id, {
    effective_from: mapped.start_date || currentDateValue(),
    effective_to: mapped.end_date || null,
    rent_amount: mapped.rent_amount || 0,
    electricity_unit_price: mapped.electricity_unit_price || 0,
    sewerage_charge: mapped.sewerage_charge || 0,
    water_charge: mapped.water_charge || 0,
    cleaning_charge: mapped.cleaning_charge || 0,
    monthly_additional_charges: mapped.monthly_additional_charges || [],
    opening_electricity_units: mapped.opening_electricity_units || 0,
  });
}

async function listTenantChargeHistory(clientOrQuery, tenantIds = []) {
  const ids = Array.isArray(tenantIds) ? tenantIds.map((id) => Number(id)).filter((id) => id > 0) : [];
  if (!ids.length) return [];
  const runner = clientOrQuery?.query ? clientOrQuery : { query };
  const result = await runner.query(
    `SELECT *
     FROM tenant_charge_history
     WHERE tenant_id = ANY($1::bigint[])
     ORDER BY tenant_id, effective_from DESC, id DESC`,
    [ids]
  );
  return result.rows.map(mapChargeHistoryRow);
}

function pickChargeProfileForDate(chargeHistory = [], dateValue = '') {
  const target = String(dateValue || '').trim();
  const list = Array.isArray(chargeHistory) ? chargeHistory : [];
  if (!target) return list[0] || null;
  return list.find((row) => {
    const from = String(row.effective_from || '');
    const to = String(row.effective_to || '');
    if (!from || from > target) return false;
    if (to && to < target) return false;
    return true;
  }) || list.find((row) => !row.effective_to) || list[0] || null;
}

function didChargeProfileChange(previous = {}, next = {}) {
  const changedCore = [
    'rent_amount',
    'electricity_unit_price',
    'sewerage_charge',
    'water_charge',
    'cleaning_charge',
    'opening_electricity_units',
  ].some((key) => Number(previous[key] || 0) !== Number(next[key] || 0));
  return changedCore || !recurringChargeItemsEqual(previous.monthly_additional_charges, next.monthly_additional_charges);
}

function mapInvoiceRow(row) {
  return {
    id: Number(row.id),
    tenant_id: Number(row.tenant_id),
    invoice_month: row.invoice_month,
    due_date: row.due_date,
    tenant_name_snapshot: row.tenant_name_snapshot,
    building_name_snapshot: row.building_name_snapshot,
    room_label_snapshot: row.room_label_snapshot,
    contact_number_snapshot: row.contact_number_snapshot || '',
    rent_amount_snapshot: num(row.rent_amount_snapshot),
    electricity_unit_price_snapshot: num(row.electricity_unit_price_snapshot),
    sewerage_charge_snapshot: num(row.sewerage_charge_snapshot),
    water_charge_snapshot: num(row.water_charge_snapshot),
    cleaning_charge_snapshot: num(row.cleaning_charge_snapshot),
    other_charges_snapshot: num(row.other_charges_snapshot),
    other_charge_items: Array.isArray(row.other_charge_items) ? row.other_charge_items.map((item) => ({
      detail: String(item?.detail || '').trim(),
      amount: num(item?.amount || 0),
      kind: String(item?.kind || '').trim(),
      source_invoice_month: String(item?.source_invoice_month || '').trim(),
    })).filter((item) => item.detail || item.amount) : [],
    split_config: normalizeTenantInvoiceSplitConfig(row.split_config || {}, false),
    roommate_count_snapshot: Math.max(1, Number(row.roommate_count_snapshot || 1)),
    previous_electricity_units: Number(row.previous_electricity_units || 0),
    current_electricity_units: Number(row.current_electricity_units || 0),
    electricity_units_used: Number(row.electricity_units_used || 0),
    electricity_amount: num(row.electricity_amount),
    total_amount: num(row.total_amount),
    payment_status: String(row.payment_status || 'pending'),
    paid_amount: num(row.paid_amount || 0),
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    latest_payment_request: row.latest_payment_request || null,
    pending_payment_request: row.pending_payment_request || null,
  };
}

function mapTenantPaymentRequestRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    invoice_id: Number(row.invoice_id),
    tenant_id: Number(row.tenant_id),
    requested_status: String(row.requested_status || 'paid'),
    requested_amount: num(row.requested_amount || 0),
    tenant_note: row.tenant_note || '',
    request_source: String(row.request_source || 'tenant_portal'),
    status: String(row.status || 'pending'),
    review_note: row.review_note || '',
    reviewed_by: row.reviewed_by != null ? Number(row.reviewed_by) : null,
    requested_at: row.requested_at,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function listTenantsOverview(userId) {
  await ensureTenantTables();
  await syncExpiredTenantStatuses(userId);
  const existingTenantsForBackfill = await query(
    `SELECT *
     FROM tenant_records
     WHERE user_id = $1`,
    [userId]
  );
  for (const row of existingTenantsForBackfill.rows) {
    await ensureTenantHasChargeHistory({ query }, row);
  }
  const [buildingsR, roomsR, tenantsR, vehiclesR, itemsR, invoicesR, paymentRequestsR] = await Promise.all([
    query(
      `SELECT id, user_id, name, address, notes, created_at, updated_at
       FROM tenant_buildings
       WHERE user_id = $1
       ORDER BY lower(name), id`,
      [userId]
    ),
    query(
      `SELECT r.id, r.building_id, r.room_label, r.floor_label, r.room_type, r.notes, r.is_active, r.created_at, r.updated_at
       FROM tenant_rooms r
       INNER JOIN tenant_buildings b ON b.id = r.building_id
       WHERE b.user_id = $1
       ORDER BY b.id, lower(r.room_label), r.id`,
      [userId]
    ),
    query(
      `SELECT *
       FROM tenant_records
       WHERE user_id = $1
       ORDER BY is_active DESC, lower(tenant_name), id`,
      [userId]
    ),
    query(
      `SELECT v.id, v.tenant_id, v.vehicle_type, v.vehicle_number, v.notes, v.created_at, v.updated_at
       FROM tenant_vehicles v
       INNER JOIN tenant_records t ON t.id = v.tenant_id
       WHERE t.user_id = $1
       ORDER BY v.id`,
      [userId]
    ),
    query(
      `SELECT i.id, i.tenant_id, i.item_name, i.quantity, i.notes, i.created_at, i.updated_at
       FROM tenant_items i
       INNER JOIN tenant_records t ON t.id = i.tenant_id
       WHERE t.user_id = $1
       ORDER BY i.id`,
      [userId]
    ),
    query(
      `SELECT inv.*
       FROM tenant_invoices inv
       INNER JOIN tenant_records t ON t.id = inv.tenant_id
       WHERE t.user_id = $1
       ORDER BY inv.invoice_month DESC, inv.id DESC`,
      [userId]
    ),
    query(
      `SELECT req.*
       FROM tenant_invoice_payment_requests req
       INNER JOIN tenant_records t ON t.id = req.tenant_id
       WHERE t.user_id = $1
       ORDER BY req.requested_at DESC, req.id DESC`,
      [userId]
    ),
  ]);

  const buildings = buildingsR.rows.map((row) => ({
    id: Number(row.id),
    user_id: Number(row.user_id),
    name: row.name,
    address: row.address || '',
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const rooms = roomsR.rows.map((row) => ({
    id: Number(row.id),
    building_id: Number(row.building_id),
    room_label: row.room_label,
    floor_label: row.floor_label || '',
    room_type: row.room_type || '',
    notes: row.notes || '',
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const tenants = tenantsR.rows.map(mapTenantRow);
  const vehiclesByTenant = new Map();
  vehiclesR.rows.forEach((row) => {
    const list = vehiclesByTenant.get(Number(row.tenant_id)) || [];
    list.push({
      id: Number(row.id),
      tenant_id: Number(row.tenant_id),
      vehicle_type: row.vehicle_type,
      vehicle_number: row.vehicle_number,
      notes: row.notes || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    vehiclesByTenant.set(Number(row.tenant_id), list);
  });
  const itemsByTenant = new Map();
  itemsR.rows.forEach((row) => {
    const list = itemsByTenant.get(Number(row.tenant_id)) || [];
    list.push({
      id: Number(row.id),
      tenant_id: Number(row.tenant_id),
      item_name: row.item_name,
      quantity: Number(row.quantity || 0),
      notes: row.notes || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    itemsByTenant.set(Number(row.tenant_id), list);
  });
  const paymentRequests = paymentRequestsR.rows.map(mapTenantPaymentRequestRow);
  const latestPaymentRequestByInvoice = new Map();
  const pendingPaymentRequestByInvoice = new Map();
  paymentRequests.forEach((request) => {
    if (!latestPaymentRequestByInvoice.has(request.invoice_id)) latestPaymentRequestByInvoice.set(request.invoice_id, request);
    if (request.status === 'pending' && !pendingPaymentRequestByInvoice.has(request.invoice_id)) {
      pendingPaymentRequestByInvoice.set(request.invoice_id, request);
    }
  });
  const invoices = invoicesR.rows.map((row) => mapInvoiceRow({
    ...row,
    latest_payment_request: latestPaymentRequestByInvoice.get(Number(row.id)) || null,
    pending_payment_request: pendingPaymentRequestByInvoice.get(Number(row.id)) || null,
  }));
  const chargeHistoryRows = await listTenantChargeHistory({ query }, tenants.map((tenant) => tenant.id));
  const chargeHistoryByTenant = new Map();
  chargeHistoryRows.forEach((row) => {
    const list = chargeHistoryByTenant.get(row.tenant_id) || [];
    list.push(row);
    chargeHistoryByTenant.set(row.tenant_id, list);
  });
  const invoicesByTenant = new Map();
  invoices.forEach((invoice) => {
    const list = invoicesByTenant.get(invoice.tenant_id) || [];
    list.push(invoice);
    invoicesByTenant.set(invoice.tenant_id, list);
  });

  const tenantsEnriched = tenants.map((tenant) => ({
    ...tenant,
    charge_history: chargeHistoryByTenant.get(tenant.id) || [],
    vehicles: vehiclesByTenant.get(tenant.id) || [],
    provided_items: itemsByTenant.get(tenant.id) || [],
    invoices: invoicesByTenant.get(tenant.id) || [],
    latest_invoice: (invoicesByTenant.get(tenant.id) || [])[0] || null,
  }));

  const activeTenantsByRoomId = new Map();
  tenantsEnriched.forEach((tenant) => {
    if (!tenant.is_active) return;
    const list = activeTenantsByRoomId.get(tenant.room_id) || [];
    list.push(tenant);
    activeTenantsByRoomId.set(tenant.room_id, list);
  });
  const roomsWithTenant = rooms.map((room) => ({
    ...room,
    active_tenants: activeTenantsByRoomId.get(room.id) || [],
    active_tenant: (activeTenantsByRoomId.get(room.id) || [])[0] || null,
    active_tenant_count: (activeTenantsByRoomId.get(room.id) || []).length,
  }));
  const roomsByBuilding = new Map();
  roomsWithTenant.forEach((room) => {
    const list = roomsByBuilding.get(room.building_id) || [];
    list.push(room);
    roomsByBuilding.set(room.building_id, list);
  });

  return {
    buildings: buildings.map((building) => {
      const buildingRooms = roomsByBuilding.get(building.id) || [];
      const occupiedCount = buildingRooms.filter((room) => Number(room.active_tenant_count || 0) > 0).length;
      return {
        ...building,
        rooms: buildingRooms,
        room_count: buildingRooms.length,
        occupied_count: occupiedCount,
        vacant_count: Math.max(0, buildingRooms.length - occupiedCount),
      };
    }),
    rooms: roomsWithTenant,
    tenants: tenantsEnriched,
    invoices,
    totals: {
      building_count: buildings.length,
      room_count: rooms.length,
      occupied_count: roomsWithTenant.filter((room) => Number(room.active_tenant_count || 0) > 0).length,
      tenant_count: tenantsEnriched.filter((tenant) => tenant.is_active).length,
      monthly_rent: tenantsEnriched.filter((tenant) => tenant.is_active).reduce((sum, tenant) => Math.round((sum + num(tenant.rent_amount)) * 100) / 100, 0),
      security_deposit: tenantsEnriched.filter((tenant) => tenant.is_active).reduce((sum, tenant) => Math.round((sum + num(tenant.security_deposit)) * 100) / 100, 0),
      invoice_count: invoices.length,
    },
  };
}

async function getTenantPortalRecordByPhone(contactNumber) {
  await ensureTenantTables();
  const digits = phoneDigits(contactNumber);
  if (!digits) throw validationError('Phone number is required');
  const variants = [...new Set([digits, digits.length > 10 ? digits.slice(-10) : ''].filter(Boolean))];
  const result = await query(
    `SELECT t.*,
            r.room_label,
            r.floor_label,
            b.name AS building_name,
            b.address AS building_address
     FROM tenant_records t
     INNER JOIN tenant_rooms r ON r.id = t.room_id
     INNER JOIN tenant_buildings b ON b.id = t.building_id
     WHERE t.is_active = TRUE
       AND (t.end_date IS NULL OR t.end_date >= $2)
       AND regexp_replace(COALESCE(t.contact_number, ''), '\\D', '', 'g') = ANY($1::text[])
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT 1`,
    [variants, currentDateValue()]
  );
  if (!result.rows[0]) return null;
  return {
    ...mapTenantRow(result.rows[0]),
    room_label: result.rows[0].room_label || '',
    floor_label: result.rows[0].floor_label || '',
    building_name: result.rows[0].building_name || '',
    building_address: result.rows[0].building_address || '',
  };
}

function tenantPortalInvoiceVisualStatus(invoice = {}) {
  const paymentStatus = String(invoice.payment_status || 'pending').trim().toLowerCase();
  if (paymentStatus === 'paid') return 'paid';
  if (invoice.latest_payment_request?.status === 'rejected') return 'rejected';
  if (invoice.pending_payment_request?.status === 'pending') return 'approval_pending';
  const dueDate = String(invoice.due_date || '').trim();
  if (dueDate && dueDate < currentDateValue()) return 'overdue';
  return 'pending';
}

async function getTenantPortalDashboard(tenantId) {
  await ensureTenantTables();
  const tenantResult = await query(
    `SELECT t.*,
            r.room_label,
            r.floor_label,
            b.name AS building_name,
            b.address AS building_address,
            u.display_name AS manager_name,
            u.mobile AS manager_mobile,
            u.email AS manager_email
     FROM tenant_records t
     INNER JOIN tenant_rooms r ON r.id = t.room_id
     INNER JOIN tenant_buildings b ON b.id = t.building_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.id = $1
     LIMIT 1`,
    [tenantId]
  );
  if (!tenantResult.rows[0]) return null;
  const tenant = {
    ...mapTenantRow(tenantResult.rows[0]),
    room_label: tenantResult.rows[0].room_label || '',
    floor_label: tenantResult.rows[0].floor_label || '',
    building_name: tenantResult.rows[0].building_name || '',
    building_address: tenantResult.rows[0].building_address || '',
  };
  const [invoiceRows, chargeHistoryRows, requestRows, vehiclesRows, itemsRows] = await Promise.all([
    query(
      `SELECT inv.*
       FROM tenant_invoices inv
       WHERE inv.tenant_id = $1
       ORDER BY inv.invoice_month DESC, inv.id DESC`,
      [tenantId]
    ),
    listTenantChargeHistory({ query }, [tenantId]),
    query(
      `SELECT *
       FROM tenant_invoice_payment_requests
       WHERE tenant_id = $1
       ORDER BY requested_at DESC, id DESC`,
      [tenantId]
    ),
    query(
      `SELECT v.id, v.vehicle_type, v.vehicle_number, v.notes, v.created_at, v.updated_at
       FROM tenant_vehicles v
       WHERE v.tenant_id = $1
       ORDER BY v.id ASC`,
      [tenantId]
    ),
    query(
      `SELECT i.id, i.item_name, i.quantity, i.notes, i.created_at, i.updated_at
       FROM tenant_items i
       WHERE i.tenant_id = $1
       ORDER BY i.id ASC`,
      [tenantId]
    ),
  ]);
  const latestPaymentRequestByInvoice = new Map();
  const pendingPaymentRequestByInvoice = new Map();
  requestRows.rows.map(mapTenantPaymentRequestRow).forEach((request) => {
    if (!latestPaymentRequestByInvoice.has(request.invoice_id)) latestPaymentRequestByInvoice.set(request.invoice_id, request);
    if (request.status === 'pending' && !pendingPaymentRequestByInvoice.has(request.invoice_id)) {
      pendingPaymentRequestByInvoice.set(request.invoice_id, request);
    }
  });
  const invoices = invoiceRows.rows.map((row) => {
    const invoice = mapInvoiceRow({
      ...row,
      latest_payment_request: latestPaymentRequestByInvoice.get(Number(row.id)) || null,
      pending_payment_request: pendingPaymentRequestByInvoice.get(Number(row.id)) || null,
    });
    return {
      ...invoice,
      visual_status: tenantPortalInvoiceVisualStatus(invoice),
      can_mark_paid: String(invoice.payment_status || '').toLowerCase() !== 'paid'
        && !(invoice.pending_payment_request && invoice.pending_payment_request.status === 'pending'),
    };
  });
  const currentProfile = pickChargeProfileForDate(chargeHistoryRows, currentDateValue()) || chargeHistoryRows[0] || null;
  const balanceDue = invoices.reduce((sum, invoice) => {
    const remaining = num(invoice.total_amount || 0) - num(invoice.paid_amount || 0);
    return sum + Math.max(0, remaining);
  }, 0);
  const latestInvoice = invoices[0] || null;
  return {
    tenant: {
      id: tenant.id,
      tenant_name: tenant.tenant_name,
      contact_number: tenant.contact_number,
      tenant_address: tenant.tenant_address || '',
      start_date: tenant.start_date,
      end_date: tenant.end_date || '',
      contract_months: tenant.contract_months,
      security_deposit: tenant.security_deposit || 0,
      room_label: tenant.room_label || '',
      floor_label: tenant.floor_label || '',
      building_name: tenant.building_name || '',
      building_address: tenant.building_address || '',
      is_active: tenant.is_active,
    },
    manager: {
      name: tenantResult.rows[0].manager_name || '',
      mobile: tenantResult.rows[0].manager_mobile || '',
      email: tenantResult.rows[0].manager_email || '',
    },
    charge_profile: currentProfile ? {
      rent_amount: currentProfile.rent_amount || 0,
      electricity_unit_price: currentProfile.electricity_unit_price || 0,
      opening_electricity_units: currentProfile.opening_electricity_units || 0,
      sewerage_charge: currentProfile.sewerage_charge || 0,
      water_charge: currentProfile.water_charge || 0,
      cleaning_charge: currentProfile.cleaning_charge || 0,
      monthly_additional_charges: Array.isArray(currentProfile.monthly_additional_charges) && currentProfile.monthly_additional_charges.length
        ? currentProfile.monthly_additional_charges
        : (Array.isArray(tenant.monthly_additional_charges) ? tenant.monthly_additional_charges : []),
    } : null,
    summary: {
      monthly_rent: currentProfile?.rent_amount || tenant.rent_amount || 0,
      latest_invoice_month: latestInvoice?.invoice_month || '',
      latest_invoice_total: latestInvoice?.total_amount || 0,
      balance_due: num(balanceDue),
    },
    invoices,
    vehicles: vehiclesRows.rows.map((row) => ({
      id: Number(row.id),
      vehicle_type: row.vehicle_type || '',
      vehicle_number: row.vehicle_number || '',
      notes: row.notes || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    provided_items: itemsRows.rows.map((row) => ({
      id: Number(row.id),
      item_name: row.item_name || '',
      quantity: Number(row.quantity || 0),
      notes: row.notes || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  };
}

async function createTenantInvoicePaymentRequest(tenantId, invoiceId, data = {}) {
  await ensureTenantTables();
  return withTransaction(async (client) => {
    const invoiceResult = await client.query(
      `SELECT inv.*
       FROM tenant_invoices inv
       WHERE inv.id = $1
         AND inv.tenant_id = $2
       LIMIT 1`,
      [invoiceId, tenantId]
    );
    const invoice = invoiceResult.rows[0];
    if (!invoice) throw validationError('Invoice not found');
    if (String(invoice.payment_status || '').toLowerCase() === 'paid') {
      throw validationError('This invoice is already marked as paid');
    }
    const pendingResult = await client.query(
      `SELECT *
       FROM tenant_invoice_payment_requests
       WHERE invoice_id = $1
         AND tenant_id = $2
         AND status = 'pending'
       ORDER BY id DESC
       LIMIT 1`,
      [invoiceId, tenantId]
    );
    if (pendingResult.rows[0]) return mapTenantPaymentRequestRow(pendingResult.rows[0]);
    const requestedAmount = normalizeAmount(data.requested_amount != null ? data.requested_amount : invoice.total_amount, 'Requested amount', { allowZero: false });
    const tenantNote = normalizeOptionalText(data.tenant_note || '', 500);
    const inserted = await client.query(
      `INSERT INTO tenant_invoice_payment_requests (
        invoice_id, tenant_id, requested_status, requested_amount, tenant_note, request_source, status, updated_at
      ) VALUES (
        $1, $2, 'paid', $3, $4, 'tenant_portal', 'pending', NOW()
      )
      RETURNING *`,
      [invoiceId, tenantId, requestedAmount, tenantNote]
    );
    return mapTenantPaymentRequestRow(inserted.rows[0]);
  });
}

async function getTenantInvoicePaymentRequestNotificationContext(requestId) {
  await ensureTenantTables();
  const result = await query(
    `SELECT req.id,
            req.invoice_id,
            req.tenant_id,
            req.requested_amount,
            req.tenant_note,
            req.status,
            req.requested_at,
            inv.invoice_month,
            inv.due_date,
            inv.total_amount,
            t.tenant_name,
            t.contact_number,
            t.user_id AS owner_user_id,
            r.room_label,
            r.floor_label,
            b.name AS building_name,
            b.address AS building_address,
            u.display_name AS owner_name,
            u.email AS owner_email,
            u.mobile AS owner_mobile,
            u.currency_code,
            u.locale_code
     FROM tenant_invoice_payment_requests req
     INNER JOIN tenant_invoices inv ON inv.id = req.invoice_id
     INNER JOIN tenant_records t ON t.id = req.tenant_id
     INNER JOIN tenant_rooms r ON r.id = t.room_id
     INNER JOIN tenant_buildings b ON b.id = t.building_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE req.id = $1
     LIMIT 1`,
    [requestId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    request_id: Number(row.id),
    invoice_id: Number(row.invoice_id),
    tenant_id: Number(row.tenant_id),
    requested_amount: num(row.requested_amount || 0),
    tenant_note: row.tenant_note || '',
    status: row.status || 'pending',
    requested_at: row.requested_at || null,
    invoice_month: row.invoice_month || '',
    due_date: row.due_date || '',
    total_amount: num(row.total_amount || 0),
    tenant_name: row.tenant_name || '',
    contact_number: row.contact_number || '',
    owner_user_id: Number(row.owner_user_id || 0),
    owner_name: row.owner_name || '',
    owner_email: row.owner_email || '',
    owner_mobile: row.owner_mobile || '',
    room_label: row.room_label || '',
    floor_label: row.floor_label || '',
    building_name: row.building_name || '',
    building_address: row.building_address || '',
    currency_code: row.currency_code || 'INR',
    locale_code: row.locale_code || 'en-IN',
  };
}

async function getTenantPendingApprovalCount(userId) {
  await ensureTenantTables();
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM tenant_invoice_payment_requests req
     INNER JOIN tenant_records t ON t.id = req.tenant_id
     WHERE t.user_id = $1
       AND req.status = 'pending'`,
    [userId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function reviewTenantInvoicePaymentRequest(userId, requestId, data = {}) {
  await ensureTenantTables();
  return withTransaction(async (client) => {
    const requestResult = await client.query(
      `SELECT req.*, inv.total_amount, inv.payment_status, inv.paid_amount
       FROM tenant_invoice_payment_requests req
       INNER JOIN tenant_invoices inv ON inv.id = req.invoice_id
       INNER JOIN tenant_records t ON t.id = req.tenant_id
       WHERE req.id = $1
         AND t.user_id = $2
       LIMIT 1`,
      [requestId, userId]
    );
    const requestRow = requestResult.rows[0];
    if (!requestRow) throw validationError('Payment request not found');
    if (String(requestRow.status || '').toLowerCase() !== 'pending') {
      throw validationError('This request has already been reviewed');
    }
    const decision = String(data.status || '').trim().toLowerCase();
    if (!['approved', 'rejected'].includes(decision)) throw validationError('Status must be approved or rejected');
    const reviewNote = normalizeOptionalText(data.review_note || '', 500);
    const requestUpdate = await client.query(
      `UPDATE tenant_invoice_payment_requests
       SET status = $1,
           review_note = $2,
           reviewed_by = $3,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [decision, reviewNote, userId, requestId]
    );
    if (decision === 'approved') {
      const requestedAmount = num(requestRow.requested_amount || 0);
      const totalAmount = num(requestRow.total_amount || 0);
      const nextPaidAmount = Math.min(totalAmount, requestedAmount || totalAmount);
      await client.query(
        `UPDATE tenant_invoices
         SET payment_status = $1,
             paid_amount = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [nextPaidAmount >= totalAmount ? 'paid' : 'partial_paid', nextPaidAmount, requestRow.invoice_id]
      );
    }
    const invoiceResult = await client.query(`SELECT * FROM tenant_invoices WHERE id = $1 LIMIT 1`, [requestRow.invoice_id]);
    return {
      request: mapTenantPaymentRequestRow(requestUpdate.rows[0]),
      invoice: invoiceResult.rows[0] ? mapInvoiceRow(invoiceResult.rows[0]) : null,
    };
  });
}

async function createTenantBuilding(userId, data = {}) {
  await ensureTenantTables();
  const result = await query(
    `INSERT INTO tenant_buildings (user_id, name, address, notes, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, user_id, name, address, notes, created_at, updated_at`,
    [
      userId,
      normalizeText(data.name, 'Building name', 120),
      normalizeOptionalText(data.address, 320),
      normalizeOptionalText(data.notes, 500),
    ]
  );
  return result.rows[0];
}

async function updateTenantBuilding(userId, buildingId, data = {}) {
  const current = await getBuildingOwnedByUser(userId, buildingId);
  if (!current) throw validationError('Building not found');
  const result = await query(
    `UPDATE tenant_buildings
     SET name = $1, address = $2, notes = $3, updated_at = NOW()
     WHERE id = $4 AND user_id = $5
     RETURNING id, user_id, name, address, notes, created_at, updated_at`,
    [
      data.name !== undefined ? normalizeText(data.name, 'Building name', 120) : current.name,
      data.address !== undefined ? normalizeOptionalText(data.address, 320) : current.address,
      data.notes !== undefined ? normalizeOptionalText(data.notes, 500) : current.notes,
      buildingId,
      userId,
    ]
  );
  return result.rows[0] || null;
}

async function deleteTenantBuilding(userId, buildingId) {
  await ensureTenantTables();
  const building = await getBuildingOwnedByUser(userId, buildingId);
  if (!building) throw validationError('Building not found');
  return withTransaction(async (client) => {
    const result = await client.query('DELETE FROM tenant_buildings WHERE id = $1 AND user_id = $2', [buildingId, userId]);
    return result.rowCount > 0;
  });
}

async function createTenantRoom(userId, buildingId, data = {}) {
  const building = await getBuildingOwnedByUser(userId, buildingId);
  if (!building) throw validationError('Building not found');
  const result = await query(
    `INSERT INTO tenant_rooms (building_id, room_label, floor_label, room_type, notes, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING id, building_id, room_label, floor_label, room_type, notes, is_active, created_at, updated_at`,
    [
      buildingId,
      normalizeText(data.room_label, 'Room label', 80),
      normalizeOptionalText(data.floor_label, 80),
      normalizeOptionalText(data.room_type, 80),
      normalizeOptionalText(data.notes, 500),
      data.is_active !== false,
    ]
  );
  return result.rows[0];
}

async function updateTenantRoom(userId, roomId, data = {}) {
  const current = await getRoomOwnedByUser(userId, roomId);
  if (!current) throw validationError('Room not found');
  const result = await query(
    `UPDATE tenant_rooms
     SET room_label = $1, floor_label = $2, room_type = $3, notes = $4, is_active = $5, updated_at = NOW()
     WHERE id = $6
     RETURNING id, building_id, room_label, floor_label, room_type, notes, is_active, created_at, updated_at`,
    [
      data.room_label !== undefined ? normalizeText(data.room_label, 'Room label', 80) : current.room_label,
      data.floor_label !== undefined ? normalizeOptionalText(data.floor_label, 80) : current.floor_label,
      data.room_type !== undefined ? normalizeOptionalText(data.room_type, 80) : current.room_type,
      data.notes !== undefined ? normalizeOptionalText(data.notes, 500) : current.notes,
      data.is_active !== undefined ? !!data.is_active : !!current.is_active,
      roomId,
    ]
  );
  return result.rows[0] || null;
}

async function deleteTenantRoom(userId, roomId) {
  const room = await getRoomOwnedByUser(userId, roomId);
  if (!room) throw validationError('Room not found');
  const result = await query('DELETE FROM tenant_rooms WHERE id = $1', [roomId]);
  return result.rowCount > 0;
}

function normalizeVehicleRows(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      const vehicle_type = String(item?.vehicle_type || '').trim();
      const vehicle_number = String(item?.vehicle_number || '').trim();
      const notes = String(item?.notes || '').trim();
      if (!vehicle_type && !vehicle_number && !notes) return null;
      return {
        vehicle_type: normalizeText(vehicle_type || 'Vehicle', 'Vehicle type', 40),
        vehicle_number: normalizeText(vehicle_number || '', 'Vehicle number', 40),
        notes: normalizeOptionalText(notes, 200),
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeItemRows(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      const item_name = String(item?.item_name || '').trim();
      const quantityRaw = item?.quantity;
      const notes = String(item?.notes || '').trim();
      const hasQuantity = quantityRaw !== '' && quantityRaw != null && Number(quantityRaw) !== 0;
      if (!item_name && !hasQuantity && !notes) return null;
      return {
        item_name: normalizeText(item_name || '', 'Provided item', 80),
        quantity: normalizeInteger(quantityRaw, 'Quantity', { min: 0, max: 1000 }),
        notes: normalizeOptionalText(notes, 200),
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

async function syncTenantVehiclesAndItems(tenantId, vehicles = [], items = []) {
  await query('DELETE FROM tenant_vehicles WHERE tenant_id = $1', [tenantId]);
  await query('DELETE FROM tenant_items WHERE tenant_id = $1', [tenantId]);
  for (const vehicle of vehicles) {
    await query(
      `INSERT INTO tenant_vehicles (tenant_id, vehicle_type, vehicle_number, notes, updated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [tenantId, vehicle.vehicle_type, vehicle.vehicle_number, vehicle.notes]
    );
  }
  for (const item of items) {
    await query(
      `INSERT INTO tenant_items (tenant_id, item_name, quantity, notes, updated_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [tenantId, item.item_name, item.quantity, item.notes]
    );
  }
}

async function createTenantRecord(userId, data = {}) {
  await ensureTenantTables();
  const building = await getBuildingOwnedByUser(userId, data.building_id);
  if (!building) throw validationError('Building not found');
  const room = await getRoomOwnedByUser(userId, data.room_id);
  if (!room || Number(room.building_id) !== Number(building.id)) throw validationError('Room not found for this building');
  const nextStartDate = normalizeDateValue((data.start_date || currentDateValue()), 'Start from');
  const nextEndDate = normalizeOptionalDateValue(data.end_date, 'End date');
  const nextIsActive = data.is_active !== false && (!nextEndDate || nextEndDate > currentDateValue());
  if (nextIsActive) {
    const occupiedBy = await findActiveTenantForRoom(userId, room.id);
    if (occupiedBy && !normalizeSplitFlag(data.allow_shared_room, false)) {
      throw validationError('This room already has an active tenant. Enable shared room to add another tenant.');
    }
  }
  const vehicles = normalizeVehicleRows(data.vehicles);
  const items = normalizeItemRows(data.provided_items);
  const monthlyAdditionalCharges = normalizeOtherChargeItems(data.monthly_additional_charges);
  const nextInvoiceChargeItems = normalizeOtherChargeItems(data.next_invoice_charge_items);
  const result = await query(
    `INSERT INTO tenant_records (
      user_id, building_id, room_id, tenant_name, start_date, end_date, contract_months, tenant_address, address_proof,
      contact_number, security_deposit, rent_amount, proof_attachments, photo_attachment,
      electricity_unit_price, sewerage_charge, water_charge, cleaning_charge, monthly_additional_charges, next_invoice_charge_items, opening_electricity_units,
      is_active, notes, updated_at
     ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
      $10, $11, $12, $13::jsonb, $14::jsonb,
      $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21,
      $22, $23, NOW()
     )
     RETURNING *`,
    [
      userId,
      Number(building.id),
      Number(room.id),
      normalizeText((data.tenant_name || 'Tenant'), 'Tenant name', 120),
      nextStartDate,
      nextEndDate,
      normalizeContractMonths(data.contract_months),
      normalizeOptionalText(data.tenant_address, 500),
      JSON.stringify(tenantFileJson(data.address_proof)),
      normalizePhoneNumber(data.contact_number),
      normalizeAmount(data.security_deposit, 'Security deposited'),
      normalizeAmount(data.rent_amount, 'Rent amount per month'),
      JSON.stringify(normalizeFileAttachmentObjects(data.proof_attachments)),
      JSON.stringify(tenantFileJson(data.photo_attachment)),
      normalizeAmount(data.electricity_unit_price, 'Electricity per unit price'),
      normalizeAmount(data.sewerage_charge, 'Sewerage charge'),
      normalizeAmount(data.water_charge, 'Water charge'),
      normalizeAmount(data.cleaning_charge, 'Cleaning charge'),
      JSON.stringify(monthlyAdditionalCharges),
      JSON.stringify(nextInvoiceChargeItems),
      normalizeInteger(data.opening_electricity_units, 'Opening electricity units', { min: 0, max: 100000000 }),
      nextIsActive,
      normalizeOptionalText(data.notes, 1000),
    ]
  );
  const tenant = mapTenantRow(result.rows[0]);
  await createTenantChargeHistory({ query }, tenant.id, {
    effective_from: data.charge_effective_from || nextStartDate,
    effective_to: nextEndDate,
    rent_amount: normalizeAmount(data.rent_amount, 'Rent amount per month'),
    electricity_unit_price: normalizeAmount(data.electricity_unit_price, 'Electricity per unit price'),
    sewerage_charge: normalizeAmount(data.sewerage_charge, 'Sewerage charge'),
    water_charge: normalizeAmount(data.water_charge, 'Water charge'),
    cleaning_charge: normalizeAmount(data.cleaning_charge, 'Cleaning charge'),
    monthly_additional_charges: monthlyAdditionalCharges,
    opening_electricity_units: normalizeInteger(data.opening_electricity_units, 'Opening electricity units', { min: 0, max: 100000000 }),
  });
  await syncTenantVehiclesAndItems(tenant.id, vehicles, items);
  return tenant;
}

async function updateTenantRecord(userId, tenantId, data = {}) {
  const current = await getTenantOwnedByUser(userId, tenantId);
  if (!current) throw validationError('Tenant not found');
  const building = data.building_id !== undefined ? await getBuildingOwnedByUser(userId, data.building_id) : await getBuildingOwnedByUser(userId, current.building_id);
  if (!building) throw validationError('Building not found');
  const room = data.room_id !== undefined ? await getRoomOwnedByUser(userId, data.room_id) : await getRoomOwnedByUser(userId, current.room_id);
  if (!room || Number(room.building_id) !== Number(building.id)) throw validationError('Room not found for this building');
  const nextStartDate = data.start_date !== undefined
    ? normalizeDateValue((data.start_date || currentDateValue()), 'Start from')
    : mapTenantRow(current).start_date || currentDateValue();
  const nextEndDate = data.end_date !== undefined
    ? normalizeOptionalDateValue(data.end_date, 'End date')
    : mapTenantRow(current).end_date || null;
  const nextIsActive = (data.is_active !== undefined ? !!data.is_active : !!current.is_active)
    && (!nextEndDate || nextEndDate > currentDateValue());
  if (nextIsActive) {
    const occupiedBy = await findActiveTenantForRoom(userId, room.id, tenantId);
    const sameRoom = Number(room.id) === Number(current.room_id);
    if (occupiedBy && !(sameRoom || normalizeSplitFlag(data.allow_shared_room, false))) {
      throw validationError('This room already has an active tenant. Enable shared room to move another tenant here.');
    }
  }
  const vehicles = data.vehicles !== undefined ? normalizeVehicleRows(data.vehicles) : null;
  const items = data.provided_items !== undefined ? normalizeItemRows(data.provided_items) : null;
  const currentProofAttachments = Array.isArray(current.proof_attachments) ? current.proof_attachments : [];
  const currentMonthlyAdditionalCharges = normalizeOtherChargeItems(current.monthly_additional_charges);
  const currentNextInvoiceChargeItems = normalizeOtherChargeItems(current.next_invoice_charge_items);
  const nextChargeProfile = {
    rent_amount: data.rent_amount !== undefined ? normalizeAmount(data.rent_amount, 'Rent amount per month') : num(current.rent_amount),
    electricity_unit_price: data.electricity_unit_price !== undefined ? normalizeAmount(data.electricity_unit_price, 'Electricity per unit price') : num(current.electricity_unit_price),
    sewerage_charge: data.sewerage_charge !== undefined ? normalizeAmount(data.sewerage_charge, 'Sewerage charge') : num(current.sewerage_charge),
    water_charge: data.water_charge !== undefined ? normalizeAmount(data.water_charge, 'Water charge') : num(current.water_charge),
    cleaning_charge: data.cleaning_charge !== undefined ? normalizeAmount(data.cleaning_charge, 'Cleaning charge') : num(current.cleaning_charge),
    monthly_additional_charges: data.monthly_additional_charges !== undefined ? normalizeOtherChargeItems(data.monthly_additional_charges) : currentMonthlyAdditionalCharges,
    opening_electricity_units: data.opening_electricity_units !== undefined ? normalizeInteger(data.opening_electricity_units, 'Opening electricity units', { min: 0, max: 100000000 }) : Number(current.opening_electricity_units || 0),
  };
  const chargeEffectiveFrom = normalizeDateValue(data.charge_effective_from || currentDateValue(), 'Charge effective from');
  return withTransaction(async (client) => {
    await ensureTenantHasChargeHistory(client, current);
    const historyRows = await listTenantChargeHistory(client, [tenantId]);
    const currentChargeProfile = historyRows[0] || {
      rent_amount: num(current.rent_amount),
      electricity_unit_price: num(current.electricity_unit_price),
      sewerage_charge: num(current.sewerage_charge),
      water_charge: num(current.water_charge),
      cleaning_charge: num(current.cleaning_charge),
      monthly_additional_charges: currentMonthlyAdditionalCharges,
      opening_electricity_units: Number(current.opening_electricity_units || 0),
      effective_from: mapTenantRow(current).start_date || currentDateValue(),
      effective_to: mapTenantRow(current).end_date || null,
    };
    if (didChargeProfileChange(currentChargeProfile, nextChargeProfile)) {
      if (!historyRows.length) {
        await createTenantChargeHistory(client, tenantId, {
          effective_from: currentChargeProfile.effective_from || mapTenantRow(current).start_date || currentDateValue(),
          effective_to: addDaysToDateValue(chargeEffectiveFrom, -1),
          ...currentChargeProfile,
        });
      }
      await client.query(
        `UPDATE tenant_charge_history
         SET effective_to = $1,
             updated_at = NOW()
         WHERE tenant_id = $2
           AND effective_to IS NULL`,
        [addDaysToDateValue(chargeEffectiveFrom, -1), tenantId]
      );
      await createTenantChargeHistory(client, tenantId, {
        effective_from: chargeEffectiveFrom,
        effective_to: nextEndDate,
        ...nextChargeProfile,
      });
    } else if (data.end_date !== undefined) {
      await client.query(
        `UPDATE tenant_charge_history
         SET effective_to = $1,
             updated_at = NOW()
         WHERE tenant_id = $2
           AND effective_to IS NULL`,
        [nextEndDate, tenantId]
      );
    }

    const result = await client.query(
      `UPDATE tenant_records
       SET building_id = $1,
           room_id = $2,
           tenant_name = $3,
           start_date = $4,
           end_date = $5,
           contract_months = $6,
           tenant_address = $7,
           address_proof = $8::jsonb,
           contact_number = $9,
           security_deposit = $10,
           rent_amount = $11,
           proof_attachments = $12::jsonb,
           photo_attachment = $13::jsonb,
           electricity_unit_price = $14,
           sewerage_charge = $15,
           water_charge = $16,
           cleaning_charge = $17,
           monthly_additional_charges = $18::jsonb,
           next_invoice_charge_items = $19::jsonb,
           opening_electricity_units = $20,
           is_active = $21,
           notes = $22,
           updated_at = NOW()
       WHERE id = $23 AND user_id = $24
       RETURNING *`,
      [
        Number(building.id),
        Number(room.id),
        data.tenant_name !== undefined ? normalizeText((data.tenant_name || 'Tenant'), 'Tenant name', 120) : current.tenant_name,
        nextStartDate,
        nextEndDate,
        data.contract_months !== undefined ? normalizeContractMonths(data.contract_months) : current.contract_months,
        data.tenant_address !== undefined ? normalizeOptionalText(data.tenant_address, 500) : current.tenant_address,
        JSON.stringify(data.address_proof !== undefined ? tenantFileJson(data.address_proof) : parseTenantFileJson(current.address_proof)),
        data.contact_number !== undefined ? normalizePhoneNumber(data.contact_number) : current.contact_number,
        data.security_deposit !== undefined ? normalizeAmount(data.security_deposit, 'Security deposited') : num(current.security_deposit),
        nextChargeProfile.rent_amount,
        JSON.stringify(
          (data.proof_attachments !== undefined
            ? normalizeFileAttachmentObjects(data.proof_attachments)
            : currentProofAttachments.map(tenantFileJson)
          ).filter(Boolean)
        ),
        JSON.stringify(data.photo_attachment !== undefined ? tenantFileJson(data.photo_attachment) : parseTenantFileJson(current.photo_attachment)),
        nextChargeProfile.electricity_unit_price,
        nextChargeProfile.sewerage_charge,
        nextChargeProfile.water_charge,
        nextChargeProfile.cleaning_charge,
        JSON.stringify(nextChargeProfile.monthly_additional_charges),
        JSON.stringify(
          data.next_invoice_charge_items !== undefined
            ? normalizeOtherChargeItems(data.next_invoice_charge_items)
            : currentNextInvoiceChargeItems
        ),
        nextChargeProfile.opening_electricity_units,
        nextIsActive,
        data.notes !== undefined ? normalizeOptionalText(data.notes, 1000) : current.notes,
        tenantId,
        userId,
      ]
    );
    if (vehicles) await syncTenantVehiclesAndItems(tenantId, vehicles, items || []);
    else if (items) await syncTenantVehiclesAndItems(tenantId, normalizeVehicleRows([]), items);
    return result.rows[0] ? mapTenantRow(result.rows[0]) : null;
  });
}

async function deleteTenantRecord(userId, tenantId) {
  const result = await query('DELETE FROM tenant_records WHERE id = $1 AND user_id = $2', [tenantId, userId]);
  return result.rowCount > 0;
}

async function getLastInvoiceForTenant(tenantId) {
  const result = await query(
    `SELECT *
     FROM tenant_invoices
     WHERE tenant_id = $1
     ORDER BY invoice_month DESC, id DESC
     LIMIT 1`,
    [tenantId]
  );
  return result.rows[0] || null;
}

async function createOrUpdateTenantInvoice(userId, tenantId, data = {}) {
  await ensureTenantTables();
  const tenant = await getTenantOwnedByUser(userId, tenantId);
  if (!tenant) throw validationError('Tenant not found');
  const building = await getBuildingOwnedByUser(userId, tenant.building_id);
  const room = await getRoomOwnedByUser(userId, tenant.room_id);
  const invoiceMonth = normalizeMonthKey(data.invoice_month || currentMonthKey());
  const invoiceReferenceDate = `${invoiceMonth}-01`;
  const chargeProfile = pickChargeProfileForDate(await listTenantChargeHistory({ query }, [tenantId]), invoiceReferenceDate);
  const currentUnits = normalizeInteger(data.current_electricity_units, 'Current electricity units', { min: 0, max: 100000000 });
  const recurringChargeItemsBase = normalizeOtherChargeItems(
    Array.isArray(chargeProfile?.monthly_additional_charges) && chargeProfile.monthly_additional_charges.length
      ? chargeProfile.monthly_additional_charges
      : tenant.monthly_additional_charges
  );
  const nextInvoiceChargeItemsBase = normalizeOtherChargeItems(tenant.next_invoice_charge_items);
  const manualOtherChargeItems = normalizeOtherChargeItems(data.other_charge_items);
  const legacyOtherCharges = data.other_charge_items !== undefined
    ? 0
    : normalizeAmount(data.other_charges, 'Other charges', { allowZero: true, allowNegative: true });
  const dueDate = normalizeOptionalDateValue(data.due_date, 'Due date');

  const existingR = await query(
    `SELECT *
     FROM tenant_invoices
     WHERE tenant_id = $1 AND invoice_month = $2
     LIMIT 1`,
    [tenantId, invoiceMonth]
  );
  const existing = existingR.rows[0] || null;
  const existingOtherChargeItems = existing ? normalizeOtherChargeItems(existing.other_charge_items) : [];
  const roommateCount = existing && data.split_config === undefined
    ? Math.max(1, Number(existing.roommate_count_snapshot || 1))
    : await countRoomTenantsForInvoiceMonth(room.id, invoiceMonth);
  const defaultSplitEnabled = roommateCount > 1;
  const splitConfig = normalizeTenantInvoiceSplitConfig(
    data.split_config !== undefined ? data.split_config : (existing?.split_config || {}),
    defaultSplitEnabled
  );
  const recurringChargeItems = applySplitToOtherChargeItems(recurringChargeItemsBase, splitConfig.divide_other, roommateCount);
  const nextInvoiceChargeItems = applySplitToOtherChargeItems(nextInvoiceChargeItemsBase, splitConfig.divide_other, roommateCount);
  const carryForwardChargeItems = await buildTenantPendingCarryForwardItems(tenantId, invoiceMonth);
  const autoChargeItems = [...recurringChargeItems, ...(!existing ? nextInvoiceChargeItems : [])];
  const submittedNonCarryChargeItems = applySplitToOtherChargeItems(stripCarryForwardChargeItems(manualOtherChargeItems), splitConfig.divide_other, roommateCount);
  const existingNonCarryChargeItems = stripCarryForwardChargeItems(existingOtherChargeItems);
  const otherChargeItems = data.other_charge_items !== undefined
    ? (existing
        ? [...submittedNonCarryChargeItems, ...carryForwardChargeItems]
        : [...autoChargeItems, ...submittedNonCarryChargeItems, ...carryForwardChargeItems])
    : (existing
        ? [...(existingNonCarryChargeItems.length ? existingNonCarryChargeItems : autoChargeItems), ...carryForwardChargeItems]
        : [...autoChargeItems, ...carryForwardChargeItems]);
  const otherCharges = data.other_charge_items !== undefined || !existing
    ? sumOtherChargeItems(otherChargeItems)
    : num(existing.other_charges_snapshot);

  let previousUnits = Number((chargeProfile?.opening_electricity_units ?? tenant.opening_electricity_units) || 0);
  if (existing) previousUnits = Number(existing.previous_electricity_units || 0);
  else {
    const lastInvoice = await getLastInvoiceForTenant(tenantId);
    if (lastInvoice) previousUnits = Number(lastInvoice.current_electricity_units || 0);
  }
  if (currentUnits < previousUnits) throw validationError('Current electricity units cannot be less than previous units');

  const unitsUsed = currentUnits - previousUnits;
  const electricityUnitPrice = data.electricity_unit_price !== undefined
    ? normalizeAmount(data.electricity_unit_price, 'Electricity per unit price')
    : num((chargeProfile?.electricity_unit_price ?? tenant.electricity_unit_price) || 0);
  const baseRentAmount = data.rent_amount !== undefined ? normalizeAmount(data.rent_amount, 'Rent amount') : num((chargeProfile?.rent_amount ?? tenant.rent_amount) || 0);
  const baseSewerageCharge = data.sewerage_charge !== undefined ? normalizeAmount(data.sewerage_charge, 'Sewerage charge') : num((chargeProfile?.sewerage_charge ?? tenant.sewerage_charge) || 0);
  const baseWaterCharge = data.water_charge !== undefined ? normalizeAmount(data.water_charge, 'Water charge') : num((chargeProfile?.water_charge ?? tenant.water_charge) || 0);
  const baseCleaningCharge = data.cleaning_charge !== undefined ? normalizeAmount(data.cleaning_charge, 'Cleaning charge') : num((chargeProfile?.cleaning_charge ?? tenant.cleaning_charge) || 0);
  const baseElectricityAmount = Math.round((unitsUsed * electricityUnitPrice) * 100) / 100;
  const rentAmount = divideTenantChargeAmount(baseRentAmount, splitConfig.divide_rent, roommateCount);
  const sewerageCharge = divideTenantChargeAmount(baseSewerageCharge, splitConfig.divide_sewerage, roommateCount);
  const waterCharge = divideTenantChargeAmount(baseWaterCharge, splitConfig.divide_water, roommateCount);
  const cleaningCharge = divideTenantChargeAmount(baseCleaningCharge, splitConfig.divide_cleaning, roommateCount);
  const electricityAmount = divideTenantChargeAmount(baseElectricityAmount, splitConfig.divide_electricity, roommateCount);
  const totalAmount = Math.round((rentAmount + sewerageCharge + waterCharge + cleaningCharge + otherCharges + electricityAmount) * 100) / 100;
  const paymentStatus = normalizeTenantPaymentStatus(data.payment_status);
  let paidAmountInput = data.paid_amount !== undefined ? normalizeAmount(data.paid_amount, 'Paid amount', { allowZero: true, allowNegative: false }) : 0;
  if (paymentStatus === 'pending') paidAmountInput = 0;
  if (paymentStatus === 'paid') paidAmountInput = totalAmount;
  if (paymentStatus === 'partial_paid' && (paidAmountInput <= 0 || paidAmountInput >= totalAmount)) {
    throw validationError('Partial paid amount must be greater than 0 and less than total amount');
  }

  const result = await query(
    `INSERT INTO tenant_invoices (
      tenant_id, invoice_month, due_date, tenant_name_snapshot, building_name_snapshot, room_label_snapshot,
      contact_number_snapshot, rent_amount_snapshot, electricity_unit_price_snapshot, sewerage_charge_snapshot,
      water_charge_snapshot, cleaning_charge_snapshot, other_charges_snapshot, other_charge_items, previous_electricity_units,
      current_electricity_units, electricity_units_used, electricity_amount, total_amount, split_config, roommate_count_snapshot, payment_status, paid_amount, notes, updated_at
     ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12, $13, $14::jsonb,
      $15, $16, $17, $18, $19, $20::jsonb, $21, $22, $23, $24, NOW()
     )
     ON CONFLICT (tenant_id, invoice_month)
     DO UPDATE SET due_date = EXCLUDED.due_date,
                   tenant_name_snapshot = EXCLUDED.tenant_name_snapshot,
                   building_name_snapshot = EXCLUDED.building_name_snapshot,
                   room_label_snapshot = EXCLUDED.room_label_snapshot,
                   contact_number_snapshot = EXCLUDED.contact_number_snapshot,
                   rent_amount_snapshot = EXCLUDED.rent_amount_snapshot,
                   electricity_unit_price_snapshot = EXCLUDED.electricity_unit_price_snapshot,
                   sewerage_charge_snapshot = EXCLUDED.sewerage_charge_snapshot,
                   water_charge_snapshot = EXCLUDED.water_charge_snapshot,
                   cleaning_charge_snapshot = EXCLUDED.cleaning_charge_snapshot,
                   other_charges_snapshot = EXCLUDED.other_charges_snapshot,
                   other_charge_items = EXCLUDED.other_charge_items,
                   previous_electricity_units = EXCLUDED.previous_electricity_units,
                   current_electricity_units = EXCLUDED.current_electricity_units,
                   electricity_units_used = EXCLUDED.electricity_units_used,
                   electricity_amount = EXCLUDED.electricity_amount,
                   total_amount = EXCLUDED.total_amount,
                   split_config = EXCLUDED.split_config,
                   roommate_count_snapshot = EXCLUDED.roommate_count_snapshot,
                   payment_status = EXCLUDED.payment_status,
                   paid_amount = EXCLUDED.paid_amount,
                   notes = EXCLUDED.notes,
                   updated_at = NOW()
     RETURNING *`,
    [
      tenantId,
      invoiceMonth,
      dueDate,
      tenant.tenant_name,
      building?.name || 'Building',
      room?.room_label || 'Room',
      tenant.contact_number || null,
      rentAmount,
      electricityUnitPrice,
      sewerageCharge,
      waterCharge,
      cleaningCharge,
      otherCharges,
      JSON.stringify(otherChargeItems),
      previousUnits,
      currentUnits,
      unitsUsed,
      electricityAmount,
      totalAmount,
      JSON.stringify(splitConfig),
      roommateCount,
      paymentStatus,
      paidAmountInput,
      normalizeOptionalText(data.notes, 500),
    ]
  );
  if (!existing && nextInvoiceChargeItems.length) {
    await query(
      `UPDATE tenant_records
       SET next_invoice_charge_items = '[]'::jsonb,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [tenantId, userId]
    );
  }
  return mapInvoiceRow(result.rows[0]);
}

async function updateTenantInvoicePaymentStatus(userId, invoiceId, data = {}) {
  await ensureTenantTables();
  const invoice = await getInvoiceOwnedByUser(userId, invoiceId);
  if (!invoice) throw validationError('Invoice not found');

  const totalAmount = num(invoice.total_amount || 0);
  const paymentStatus = normalizeTenantPaymentStatus(data.payment_status);
  let paidAmountInput = data.paid_amount !== undefined
    ? normalizeAmount(data.paid_amount, 'Paid amount', { allowZero: true, allowNegative: false })
    : num(invoice.paid_amount || 0);

  if (paymentStatus === 'pending') paidAmountInput = 0;
  if (paymentStatus === 'paid') paidAmountInput = totalAmount;
  if (paymentStatus === 'partial_paid' && (paidAmountInput <= 0 || paidAmountInput >= totalAmount)) {
    throw validationError('Partial paid amount must be greater than 0 and less than total amount');
  }

  const result = await query(
    `UPDATE tenant_invoices
     SET payment_status = $1,
         paid_amount = $2,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [paymentStatus, paidAmountInput, invoiceId]
  );
  return mapInvoiceRow(result.rows[0]);
}

async function deleteTenantInvoice(userId, invoiceId) {
  await ensureTenantTables();
  const result = await query(
    `DELETE FROM tenant_invoices inv
     USING tenant_records t
     WHERE inv.id = $1 AND inv.tenant_id = t.id AND t.user_id = $2`,
    [invoiceId, userId]
  );
  return result.rowCount > 0;
}

function createGuidToken() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(2).toString('hex')}-${crypto.randomBytes(2).toString('hex')}-${crypto.randomBytes(2).toString('hex')}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeOptionalExpiryDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    date.setHours(23, 59, 59, 0);
    return date.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T23:59:59.000Z`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw validationError('Expiry date is invalid');
  return parsed.toISOString();
}

async function listTenantInvoiceShareLinks(userId, invoiceId) {
  await ensureTenantTables();
  const invoice = await getInvoiceOwnedByUser(userId, invoiceId);
  if (!invoice) throw validationError('Invoice not found');
  const result = await query(
    `SELECT id, invoice_id, token, expires_at, view_count, created_at, updated_at
     FROM tenant_invoice_share_links
     WHERE user_id = $1
       AND invoice_id = $2
     ORDER BY created_at DESC, id DESC`,
    [userId, invoiceId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    invoice_id: Number(row.invoice_id),
    token: String(row.token || ''),
    expires_at: row.expires_at || null,
    view_count: Number(row.view_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function createTenantInvoiceShareLink(userId, invoiceId, data = {}) {
  await ensureTenantTables();
  const invoice = await getInvoiceOwnedByUser(userId, invoiceId);
  if (!invoice) throw validationError('Invoice not found');
  const token = createGuidToken();
  const expiresAt = normalizeOptionalExpiryDateTime(data.expires_at);
  const result = await query(
    `INSERT INTO tenant_invoice_share_links (user_id, invoice_id, token, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, invoice_id, token, expires_at, view_count, created_at, updated_at`,
    [userId, invoiceId, token, expiresAt]
  );
  const row = result.rows[0] || null;
  return row ? {
    id: Number(row.id),
    invoice_id: Number(row.invoice_id),
    token: String(row.token || ''),
    expires_at: row.expires_at || null,
    view_count: Number(row.view_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  } : null;
}

async function listTenantInvoiceMonthShareLinks(userId, buildingId, invoiceMonth) {
  await ensureTenantTables();
  const building = await getBuildingOwnedByUser(userId, buildingId);
  if (!building) throw validationError('Building not found');
  const monthKey = normalizeMonthKey(invoiceMonth);
  const result = await query(
    `SELECT id, building_id, invoice_month, token, expires_at, view_count, created_at, updated_at
     FROM tenant_invoice_month_share_links
     WHERE user_id = $1
       AND building_id = $2
       AND invoice_month = $3
     ORDER BY created_at DESC, id DESC`,
    [userId, buildingId, monthKey]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    building_id: Number(row.building_id),
    invoice_month: String(row.invoice_month || ''),
    token: String(row.token || ''),
    expires_at: row.expires_at || null,
    view_count: Number(row.view_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function createTenantInvoiceMonthShareLink(userId, buildingId, data = {}) {
  await ensureTenantTables();
  const building = await getBuildingOwnedByUser(userId, buildingId);
  if (!building) throw validationError('Building not found');
  const invoiceMonth = normalizeMonthKey(data.invoice_month || currentMonthKey());
  const invoicesResult = await query(
    `SELECT inv.id
     FROM tenant_invoices inv
     INNER JOIN tenant_records t ON t.id = inv.tenant_id
     WHERE t.user_id = $1
       AND t.building_id = $2
       AND inv.invoice_month = $3
     LIMIT 1`,
    [userId, buildingId, invoiceMonth]
  );
  if (!invoicesResult.rows[0]) throw validationError('No invoices found for this month');
  const token = createGuidToken();
  const expiresAt = normalizeOptionalExpiryDateTime(data.expires_at);
  const result = await query(
    `INSERT INTO tenant_invoice_month_share_links (user_id, building_id, invoice_month, token, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, building_id, invoice_month, token, expires_at, view_count, created_at, updated_at`,
    [userId, buildingId, invoiceMonth, token, expiresAt]
  );
  const row = result.rows[0] || null;
  return row ? {
    id: Number(row.id),
    building_id: Number(row.building_id),
    invoice_month: String(row.invoice_month || ''),
    token: String(row.token || ''),
    expires_at: row.expires_at || null,
    view_count: Number(row.view_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  } : null;
}

async function deleteTenantInvoiceShareLink(userId, linkId) {
  await ensureTenantTables();
  const result = await query(
    `DELETE FROM tenant_invoice_share_links
     WHERE id = $1
       AND user_id = $2`,
    [linkId, userId]
  );
  return result.rowCount > 0;
}

async function deleteTenantInvoiceMonthShareLink(userId, linkId) {
  await ensureTenantTables();
  const result = await query(
    `DELETE FROM tenant_invoice_month_share_links
     WHERE id = $1
       AND user_id = $2`,
    [linkId, userId]
  );
  return result.rowCount > 0;
}

async function getPublicTenantInvoiceShareByToken(token) {
  await ensureTenantTables();
  const clean = String(token || '').trim();
  if (!clean) return null;
  const linkResult = await query(
    `SELECT l.*, inv.*, u.display_name AS owner_name
     FROM tenant_invoice_share_links l
     INNER JOIN tenant_invoices inv ON inv.id = l.invoice_id
     INNER JOIN users u ON u.id = l.user_id
     WHERE l.token = $1
     LIMIT 1`,
    [clean]
  );
  const row = linkResult.rows[0] || null;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  await query(
    `UPDATE tenant_invoice_share_links
     SET view_count = view_count + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [row.id]
  );
  return {
    token: clean,
    owner_name: String(row.owner_name || 'Owner'),
    expires_at: row.expires_at || null,
    view_count: Number(row.view_count || 0) + 1,
    invoice: mapInvoiceRow(row),
  };
}

async function getPublicTenantInvoiceMonthShareByToken(token) {
  await ensureTenantTables();
  const clean = String(token || '').trim();
  if (!clean) return null;
  const linkResult = await query(
    `SELECT l.*, b.name AS building_name, b.address AS building_address, u.display_name AS owner_name
     FROM tenant_invoice_month_share_links l
     INNER JOIN tenant_buildings b ON b.id = l.building_id
     INNER JOIN users u ON u.id = l.user_id
     WHERE l.token = $1
     LIMIT 1`,
    [clean]
  );
  const row = linkResult.rows[0] || null;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  const invoicesResult = await query(
    `SELECT inv.*
     FROM tenant_invoices inv
     INNER JOIN tenant_records t ON t.id = inv.tenant_id
     WHERE t.user_id = $1
       AND t.building_id = $2
       AND inv.invoice_month = $3
     ORDER BY COALESCE(inv.room_label_snapshot, ''), COALESCE(inv.tenant_name_snapshot, ''), inv.id`,
    [row.user_id, row.building_id, row.invoice_month]
  );
  const invoices = invoicesResult.rows.map((invoice) => mapInvoiceRow(invoice));
  if (!invoices.length) return null;
  await query(
    `UPDATE tenant_invoice_month_share_links
     SET view_count = view_count + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [row.id]
  );
  return {
    token: clean,
    owner_name: String(row.owner_name || 'Owner'),
    expires_at: row.expires_at || null,
    view_count: Number(row.view_count || 0) + 1,
    invoice_month: String(row.invoice_month || ''),
    building: {
      id: Number(row.building_id),
      name: String(row.building_name || 'Building'),
      address: row.building_address || null,
    },
    invoices,
  };
}

async function bulkCreateTenantInvoices(userId, buildingId, data = {}) {
  await ensureTenantTables();
  const building = await getBuildingOwnedByUser(userId, buildingId);
  if (!building) throw validationError('Building not found');
  const invoiceMonth = normalizeMonthKey(data.invoice_month || currentMonthKey());
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw validationError('No tenant invoice rows provided');

  const saved = [];
  for (const row of rows) {
    const tenantId = Number(row?.tenant_id || 0);
    if (!(tenantId > 0)) continue;
    const tenant = await getTenantOwnedByUser(userId, tenantId);
    if (!tenant || Number(tenant.building_id) !== Number(buildingId)) {
      throw validationError('One or more tenants do not belong to this building');
    }
    const invoice = await createOrUpdateTenantInvoice(userId, tenantId, {
      invoice_month: invoiceMonth,
      due_date: row?.due_date || data.due_date || '',
      current_electricity_units: row?.current_electricity_units,
      payment_status: row?.payment_status || 'pending',
      paid_amount: row?.paid_amount || 0,
      split_config: row?.split_config || {},
      other_charge_items: row?.other_charge_items || [],
      notes: row?.notes || '',
    });
    saved.push(invoice);
  }
  return {
    invoice_month: invoiceMonth,
    invoices_saved: saved.length,
    total_amount: Math.round(saved.reduce((sum, invoice) => sum + num(invoice.total_amount || 0), 0) * 100) / 100,
    invoices: saved,
  };
}

async function importTenantInvoiceRows(userId, tenantId, rows = []) {
  await ensureTenantTables();
  const tenant = await getTenantOwnedByUser(userId, tenantId);
  if (!tenant) throw validationError('Tenant not found');
  const building = await getBuildingOwnedByUser(userId, tenant.building_id);
  const room = await getRoomOwnedByUser(userId, tenant.room_id);
  const invoices = Array.isArray(rows) ? rows.filter((row) => String(row?.invoice_month || '').trim()) : [];
  if (!invoices.length) throw validationError('No valid invoice rows found in this sheet');

  return withTransaction(async (client) => {
    const sorted = [...invoices].sort((a, b) => String(a.invoice_month || '').localeCompare(String(b.invoice_month || '')));
    let imported = 0;
    let firstPreviousUnits = null;
    let latestEntry = null;

    for (const entry of sorted) {
      const invoiceMonth = normalizeMonthKey(entry.invoice_month);
      const dueDate = normalizeOptionalDateValue(entry.due_date, 'Due date');
      const previousUnits = normalizeInteger(entry.previous_electricity_units, 'Previous electricity units', { min: -100000000, max: 100000000 });
      const currentUnits = normalizeInteger(entry.current_electricity_units, 'Current electricity units', { min: 0, max: 100000000 });
      const unitsUsed = normalizeInteger(
        entry.electricity_units_used != null && entry.electricity_units_used !== ''
          ? entry.electricity_units_used
          : Math.max(0, currentUnits - previousUnits),
        'Electricity units used',
        { min: 0, max: 100000000 }
      );
      const electricityAmount = normalizeAmount(entry.electricity_amount, 'Electricity bill');
      const totalAmount = normalizeAmount(entry.total_amount, 'Total amount');
      const rentAmount = normalizeAmount(entry.rent_amount_snapshot, 'Monthly rent');
      const electricityUnitPrice = normalizeAmount(entry.electricity_unit_price_snapshot, 'Electricity per unit price');
      const sewerageCharge = normalizeAmount(entry.sewerage_charge_snapshot, 'Sewerage charge');
      const waterCharge = normalizeAmount(entry.water_charge_snapshot || 0, 'Water charge');
      const cleaningCharge = normalizeAmount(entry.cleaning_charge_snapshot, 'Cleaning charge');
      const otherCharges = normalizeAmount(entry.other_charges_snapshot, 'Other charges', { allowZero: true, allowNegative: true });
      const notes = normalizeOptionalText(entry.notes, 500);

      await client.query(
        `INSERT INTO tenant_invoices (
          tenant_id, invoice_month, due_date, tenant_name_snapshot, building_name_snapshot, room_label_snapshot,
          contact_number_snapshot, rent_amount_snapshot, electricity_unit_price_snapshot, sewerage_charge_snapshot,
          water_charge_snapshot, cleaning_charge_snapshot, other_charges_snapshot, other_charge_items, previous_electricity_units,
          current_electricity_units, electricity_units_used, electricity_amount, total_amount, payment_status, paid_amount, notes, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14::jsonb,
          $15, $16, $17, $18, $19, $20, $21, $22, NOW()
        )
        ON CONFLICT (tenant_id, invoice_month)
        DO UPDATE SET due_date = EXCLUDED.due_date,
                      tenant_name_snapshot = EXCLUDED.tenant_name_snapshot,
                      building_name_snapshot = EXCLUDED.building_name_snapshot,
                      room_label_snapshot = EXCLUDED.room_label_snapshot,
                      contact_number_snapshot = EXCLUDED.contact_number_snapshot,
                      rent_amount_snapshot = EXCLUDED.rent_amount_snapshot,
                      electricity_unit_price_snapshot = EXCLUDED.electricity_unit_price_snapshot,
                      sewerage_charge_snapshot = EXCLUDED.sewerage_charge_snapshot,
                      water_charge_snapshot = EXCLUDED.water_charge_snapshot,
                      cleaning_charge_snapshot = EXCLUDED.cleaning_charge_snapshot,
                      other_charges_snapshot = EXCLUDED.other_charges_snapshot,
                      other_charge_items = EXCLUDED.other_charge_items,
                      previous_electricity_units = EXCLUDED.previous_electricity_units,
                      current_electricity_units = EXCLUDED.current_electricity_units,
                      electricity_units_used = EXCLUDED.electricity_units_used,
                      electricity_amount = EXCLUDED.electricity_amount,
                      total_amount = EXCLUDED.total_amount,
                      payment_status = EXCLUDED.payment_status,
                      paid_amount = EXCLUDED.paid_amount,
                      notes = EXCLUDED.notes,
                      updated_at = NOW()`,
        [
          tenant.id,
          invoiceMonth,
          dueDate,
          tenant.tenant_name || 'Tenant',
          building?.name || 'Building',
          room?.room_label || 'Room',
          tenant.contact_number || null,
          rentAmount,
          electricityUnitPrice,
          sewerageCharge,
          waterCharge,
          cleaningCharge,
          otherCharges,
          JSON.stringify([]),
          previousUnits,
          currentUnits,
          unitsUsed,
          electricityAmount,
          totalAmount,
          'pending',
          0,
          notes,
        ]
      );
      if (firstPreviousUnits == null) firstPreviousUnits = previousUnits;
      latestEntry = {
        rent_amount: rentAmount,
        electricity_unit_price: electricityUnitPrice,
        sewerage_charge: sewerageCharge,
        water_charge: waterCharge,
        cleaning_charge: cleaningCharge,
        opening_electricity_units: currentUnits,
      };
      imported += 1;
    }

    if (firstPreviousUnits != null || latestEntry) {
      await client.query(
        `UPDATE tenant_records
         SET rent_amount = $1,
             electricity_unit_price = $2,
             sewerage_charge = $3,
             water_charge = $4,
             cleaning_charge = $5,
             opening_electricity_units = $6,
             updated_at = NOW()
         WHERE id = $7 AND user_id = $8`,
        [
          latestEntry?.rent_amount ?? num(tenant.rent_amount),
          latestEntry?.electricity_unit_price ?? num(tenant.electricity_unit_price),
          latestEntry?.sewerage_charge ?? num(tenant.sewerage_charge),
          latestEntry?.water_charge ?? num(tenant.water_charge),
          latestEntry?.cleaning_charge ?? num(tenant.cleaning_charge),
          latestEntry?.opening_electricity_units ?? firstPreviousUnits ?? Number(tenant.opening_electricity_units || 0),
          tenant.id,
          userId,
        ]
      );
    }

    return { imported };
  });
}

async function importTenantWorkbook(userId, buildingId, payload = {}) {
  await ensureTenantTables();
  const building = await getBuildingOwnedByUser(userId, buildingId);
  if (!building) throw validationError('Building not found');

  const roomInputs = Array.isArray(payload.rooms) ? payload.rooms : [];
  const tenantInputs = Array.isArray(payload.tenants) ? payload.tenants : [];
  const chargeInputs = Array.isArray(payload.charges) ? payload.charges : [];
  const invoiceInputs = Array.isArray(payload.invoices) ? payload.invoices : [];

  return withTransaction(async (client) => {
    const roomsR = await client.query(
      `SELECT id, building_id, room_label, floor_label, room_type, notes, is_active, created_at, updated_at
       FROM tenant_rooms
       WHERE building_id = $1
       ORDER BY id`,
      [buildingId]
    );
    const tenantsR = await client.query(
      `SELECT *
       FROM tenant_records
       WHERE user_id = $1 AND building_id = $2
       ORDER BY id`,
      [userId, buildingId]
    );
    const invoicesR = await client.query(
      `SELECT inv.id, inv.tenant_id, inv.invoice_month
       FROM tenant_invoices inv
       INNER JOIN tenant_records t ON t.id = inv.tenant_id
       WHERE t.user_id = $1 AND t.building_id = $2`,
      [userId, buildingId]
    );

    const rooms = roomsR.rows.map((row) => ({
      id: Number(row.id),
      room_label: row.room_label,
    }));
    const tenants = tenantsR.rows.map((row) => ({ ...mapTenantRow(row), _row: row }));
    const invoiceActivityByTenant = new Map();
    invoicesR.rows.forEach((row) => {
      const tenantId = Number(row.tenant_id);
      const key = importInvoiceMonthActivityKey(row.invoice_month);
      if (!key) return;
      const current = invoiceActivityByTenant.get(tenantId) || '';
      if (!current || key > current) invoiceActivityByTenant.set(tenantId, key);
    });
    const roomMap = new Map(rooms.map((room) => [normalizeImportLookup(room.room_label), room]));
    const touchedRoomIds = new Set();
    const touchedTenantIds = new Set();
    let roomsAdded = 0;
    let tenantsAdded = 0;
    let tenantsUpdated = 0;
    let invoicesImported = 0;
    let chargesLinked = 0;

    async function ensureRoom(roomLabel) {
      const normalizedLabel = tenantImportRoomLabel(roomLabel);
      if (!normalizedLabel) throw validationError('Room label is required for import');
      const key = normalizeImportLookup(normalizedLabel);
      if (roomMap.has(key)) return roomMap.get(key);
      const result = await client.query(
        `INSERT INTO tenant_rooms (building_id, room_label, is_active, updated_at)
         VALUES ($1, $2, TRUE, NOW())
         RETURNING id, room_label`,
        [buildingId, normalizedLabel]
      );
      const room = {
        id: Number(result.rows[0].id),
        room_label: result.rows[0].room_label,
      };
      roomMap.set(key, room);
      rooms.push(room);
      roomsAdded += 1;
      return room;
    }

    function findTenant(roomId, tenantName, startDate = '') {
      const nameKey = normalizeImportLookup(tenantImportName(tenantName));
      const startKey = String(startDate || '').trim();
      if (startKey) {
        const exact = tenants.find((tenant) => (
          Number(tenant.room_id) === Number(roomId)
          && normalizeImportLookup(tenant.tenant_name) === nameKey
          && String(tenant.start_date || '') === startKey
        ));
        if (exact) return exact;
      }
      const sameName = tenants
        .filter((tenant) => Number(tenant.room_id) === Number(roomId) && normalizeImportLookup(tenant.tenant_name) === nameKey)
        .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')) || Number(b.id) - Number(a.id));
      return sameName[0] || null;
    }

    async function saveImportedTenant(entry = {}) {
      const room = await ensureRoom(entry.room_label || entry.portion);
      touchedRoomIds.add(Number(room.id));
      const startDate = safeImportDate(entry.start_date, currentDateValue());
      const endDate = safeImportDate(entry.end_date, null);
      const tenantName = tenantImportName(entry.tenant_name);
      const existing = findTenant(room.id, tenantName, startDate);
      const notes = combineImportNotes([entry.notes]);
      const contractMonths = entry.contract_months == null || entry.contract_months === ''
        ? null
        : Math.max(0, Math.min(240, Number(entry.contract_months) || 0));
      const securityDeposit = num(entry.security_deposit || 0);
      const rentAmount = num(entry.rent_amount || 0);
      const electricityUnitPrice = num(entry.electricity_unit_price || 0);
      const sewerageCharge = num(entry.sewerage_charge || 0);
      const waterCharge = num(entry.water_charge || 0);
      const cleaningCharge = num(entry.cleaning_charge || 0);
      const openingUnits = Number.isFinite(Number(entry.opening_electricity_units))
        ? Math.round(Number(entry.opening_electricity_units) || 0)
        : 0;

      if (!existing) {
        const inserted = await client.query(
          `INSERT INTO tenant_records (
            user_id, building_id, room_id, tenant_name, start_date, end_date, contract_months, tenant_address, address_proof,
            contact_number, security_deposit, rent_amount, proof_attachments, photo_attachment,
            electricity_unit_price, sewerage_charge, water_charge, cleaning_charge, opening_electricity_units,
            is_active, notes, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, NULL,
            $9, $10, $11, '[]'::jsonb, NULL,
            $12, $13, $14, $15, $16,
            FALSE, $17, NOW()
          )
          RETURNING *`,
          [
            userId,
            buildingId,
            Number(room.id),
            tenantName,
            startDate,
            endDate,
            contractMonths,
            normalizeOptionalText(entry.tenant_address, 500),
            normalizeImportPhoneNumber(entry.contact_number),
            securityDeposit,
            rentAmount,
            electricityUnitPrice,
            sewerageCharge,
            waterCharge,
            cleaningCharge,
            openingUnits,
            notes,
          ]
        );
        const tenant = { ...mapTenantRow(inserted.rows[0]), _row: inserted.rows[0] };
        tenants.push(tenant);
        touchedTenantIds.add(tenant.id);
        tenantsAdded += 1;
        return tenant;
      }

      const updated = await client.query(
        `UPDATE tenant_records
         SET end_date = $1,
             tenant_address = $2,
             contact_number = $3,
             contract_months = $4,
             security_deposit = $5,
             rent_amount = $6,
             electricity_unit_price = $7,
             sewerage_charge = $8,
             water_charge = $9,
             cleaning_charge = $10,
             opening_electricity_units = $11,
             notes = $12,
             updated_at = NOW()
         WHERE id = $13
         RETURNING *`,
        [
          entry.end_date !== undefined ? endDate : existing.end_date,
          entry.tenant_address !== undefined ? normalizeOptionalText(entry.tenant_address, 500) : existing.tenant_address,
          entry.contact_number !== undefined ? normalizeImportPhoneNumber(entry.contact_number) : existing.contact_number,
          entry.contract_months !== undefined ? contractMonths : existing.contract_months,
          entry.security_deposit !== undefined ? securityDeposit : num(existing.security_deposit),
          entry.rent_amount !== undefined ? rentAmount : num(existing.rent_amount),
          entry.electricity_unit_price !== undefined ? electricityUnitPrice : num(existing.electricity_unit_price),
          entry.sewerage_charge !== undefined ? sewerageCharge : num(existing.sewerage_charge),
          entry.water_charge !== undefined ? waterCharge : num(existing.water_charge),
          entry.cleaning_charge !== undefined ? cleaningCharge : num(existing.cleaning_charge),
          entry.opening_electricity_units !== undefined ? openingUnits : Number(existing.opening_electricity_units || 0),
          entry.notes !== undefined ? notes : existing.notes,
          existing.id,
        ]
      );
      const tenant = { ...mapTenantRow(updated.rows[0]), _row: updated.rows[0] };
      const index = tenants.findIndex((item) => Number(item.id) === Number(tenant.id));
      if (index >= 0) tenants[index] = tenant;
      touchedTenantIds.add(tenant.id);
      tenantsUpdated += 1;
      return tenant;
    }

    for (const roomInput of roomInputs) {
      await ensureRoom(roomInput.room_label || roomInput.portion);
    }

    for (const entry of tenantInputs) {
      await saveImportedTenant(entry);
    }

    for (const entry of chargeInputs) {
      const room = await ensureRoom(entry.room_label || entry.portion);
      let tenant = findTenant(room.id, entry.tenant_name, entry.start_date);
      if (!tenant) {
        tenant = await saveImportedTenant({
          room_label: room.room_label,
          tenant_name: entry.tenant_name,
          start_date: entry.start_date || entry.implemented_on || currentDateValue(),
          tenant_address: '',
          contact_number: '',
          security_deposit: 0,
          rent_amount: 0,
          opening_electricity_units: 0,
          notes: entry.notes,
          contract_months: null,
        });
      }
      const combinedNotes = combineImportNotes([tenant.notes, entry.notes]);
      const updated = await client.query(
        `UPDATE tenant_records
         SET rent_amount = $1,
             electricity_unit_price = $2,
             sewerage_charge = $3,
             water_charge = $4,
             cleaning_charge = $5,
             notes = $6,
             updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [
          num(entry.rent_amount != null ? entry.rent_amount : tenant.rent_amount),
          num(entry.electricity_unit_price != null ? entry.electricity_unit_price : tenant.electricity_unit_price),
          num(entry.sewerage_charge != null ? entry.sewerage_charge : tenant.sewerage_charge),
          num(entry.water_charge != null ? entry.water_charge : tenant.water_charge),
          num(entry.cleaning_charge != null ? entry.cleaning_charge : tenant.cleaning_charge),
          combinedNotes,
          tenant.id,
        ]
      );
      const nextTenant = { ...mapTenantRow(updated.rows[0]), _row: updated.rows[0] };
      const index = tenants.findIndex((item) => Number(item.id) === Number(nextTenant.id));
      if (index >= 0) tenants[index] = nextTenant;
      touchedRoomIds.add(Number(room.id));
      touchedTenantIds.add(nextTenant.id);
      chargesLinked += 1;
    }

    const sortedInvoices = [...invoiceInputs].sort((a, b) => String(a.invoice_month || '').localeCompare(String(b.invoice_month || '')));
    for (const entry of sortedInvoices) {
      const room = await ensureRoom(entry.room_label || entry.portion);
      const inferredStartDate = safeImportDate(entry.start_date, `${String(entry.invoice_month || currentMonthKey())}-01`);
      let tenant = findTenant(room.id, entry.tenant_name, entry.start_date) || findTenant(room.id, entry.tenant_name, inferredStartDate);
      if (!tenant) {
        tenant = await saveImportedTenant({
          room_label: room.room_label,
          tenant_name: entry.tenant_name,
          start_date: inferredStartDate,
          contact_number: entry.contact_number_snapshot || '',
          security_deposit: 0,
          rent_amount: entry.rent_amount_snapshot || 0,
          electricity_unit_price: entry.electricity_unit_price_snapshot || 0,
          sewerage_charge: entry.sewerage_charge_snapshot || 0,
          water_charge: entry.water_charge_snapshot || 0,
          cleaning_charge: entry.cleaning_charge_snapshot || 0,
          opening_electricity_units: entry.previous_electricity_units || 0,
          notes: entry.tenant_notes || '',
        });
      }
      const invoiceNotes = combineImportNotes([entry.notes]);
      await client.query(
        `INSERT INTO tenant_invoices (
          tenant_id, invoice_month, due_date, tenant_name_snapshot, building_name_snapshot, room_label_snapshot,
          contact_number_snapshot, rent_amount_snapshot, electricity_unit_price_snapshot, sewerage_charge_snapshot,
          water_charge_snapshot, cleaning_charge_snapshot, other_charges_snapshot, other_charge_items, previous_electricity_units,
          current_electricity_units, electricity_units_used, electricity_amount, total_amount, payment_status, paid_amount, notes, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14::jsonb,
          $15, $16, $17, $18, $19, $20, $21, $22, NOW()
        )
        ON CONFLICT (tenant_id, invoice_month)
        DO UPDATE SET due_date = EXCLUDED.due_date,
                      tenant_name_snapshot = EXCLUDED.tenant_name_snapshot,
                      building_name_snapshot = EXCLUDED.building_name_snapshot,
                      room_label_snapshot = EXCLUDED.room_label_snapshot,
                      contact_number_snapshot = EXCLUDED.contact_number_snapshot,
                      rent_amount_snapshot = EXCLUDED.rent_amount_snapshot,
                      electricity_unit_price_snapshot = EXCLUDED.electricity_unit_price_snapshot,
                      sewerage_charge_snapshot = EXCLUDED.sewerage_charge_snapshot,
                      water_charge_snapshot = EXCLUDED.water_charge_snapshot,
                      cleaning_charge_snapshot = EXCLUDED.cleaning_charge_snapshot,
                      other_charges_snapshot = EXCLUDED.other_charges_snapshot,
                      other_charge_items = EXCLUDED.other_charge_items,
                      previous_electricity_units = EXCLUDED.previous_electricity_units,
                      current_electricity_units = EXCLUDED.current_electricity_units,
                      electricity_units_used = EXCLUDED.electricity_units_used,
                      electricity_amount = EXCLUDED.electricity_amount,
                      total_amount = EXCLUDED.total_amount,
                      payment_status = EXCLUDED.payment_status,
                      paid_amount = EXCLUDED.paid_amount,
                      notes = EXCLUDED.notes,
                      updated_at = NOW()`,
        [
          tenant.id,
          String(entry.invoice_month || '').trim(),
          safeImportDate(entry.due_date, null),
          tenantImportName(entry.tenant_name || tenant.tenant_name),
          building.name || 'Building',
          room.room_label || 'Room',
          String(entry.contact_number_snapshot || tenant.contact_number || '').trim() || null,
          num(entry.rent_amount_snapshot || 0),
          num(entry.electricity_unit_price_snapshot || 0),
          num(entry.sewerage_charge_snapshot || 0),
          num(entry.water_charge_snapshot || 0),
          num(entry.cleaning_charge_snapshot || 0),
          Math.round((Number(entry.other_charges_snapshot || 0) || 0) * 100) / 100,
          JSON.stringify([]),
          Math.round(Number(entry.previous_electricity_units || 0) || 0),
          Math.round(Number(entry.current_electricity_units || 0) || 0),
          Math.round(Number(entry.electricity_units_used || 0) || 0),
          Math.round((Number(entry.electricity_amount || 0) || 0) * 100) / 100,
          Math.round((Number(entry.total_amount || 0) || 0) * 100) / 100,
          'pending',
          0,
          invoiceNotes,
        ]
      );
      const invoiceKey = importInvoiceMonthActivityKey(entry.invoice_month);
      if (invoiceKey) {
        const current = invoiceActivityByTenant.get(tenant.id) || '';
        if (!current || invoiceKey > current) invoiceActivityByTenant.set(tenant.id, invoiceKey);
      }
      touchedRoomIds.add(Number(room.id));
      touchedTenantIds.add(tenant.id);
      invoicesImported += 1;
    }

    return {
      building_id: Number(buildingId),
      rooms_added: roomsAdded,
      tenants_added: tenantsAdded,
      tenants_updated: tenantsUpdated,
      invoices_imported: invoicesImported,
      charges_linked: chargesLinked,
      touched_tenant_count: touchedTenantIds.size,
      touched_room_count: touchedRoomIds.size,
    };
  });
}

module.exports = {
  listTenantsOverview,
  getTenantPortalRecordByPhone,
  getTenantPortalDashboard,
  createTenantInvoicePaymentRequest,
  getTenantInvoicePaymentRequestNotificationContext,
  getTenantPendingApprovalCount,
  reviewTenantInvoicePaymentRequest,
  createTenantBuilding,
  updateTenantBuilding,
  deleteTenantBuilding,
  createTenantRoom,
  updateTenantRoom,
  deleteTenantRoom,
  createTenantRecord,
  updateTenantRecord,
  deleteTenantRecord,
  createOrUpdateTenantInvoice,
  updateTenantInvoicePaymentStatus,
  bulkCreateTenantInvoices,
  deleteTenantInvoice,
  listTenantInvoiceShareLinks,
  createTenantInvoiceShareLink,
  deleteTenantInvoiceShareLink,
  getPublicTenantInvoiceShareByToken,
  listTenantInvoiceMonthShareLinks,
  createTenantInvoiceMonthShareLink,
  deleteTenantInvoiceMonthShareLink,
  getPublicTenantInvoiceMonthShareByToken,
  importTenantInvoiceRows,
};
