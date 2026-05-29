const { query, withTransaction } = require('./postgres');
const { sendExpoPushNotifications, normalizeMessagePayload } = require('../utils/push-notifications');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MINUTES = 5;

let _schemaEnsured = false;
let _schemaPromise = null;
let _processorRunning = false;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonSafe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_err) {
    return fallback;
  }
}

function normalizeArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeIntegerArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function normalizePriority(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['low', 'normal', 'high', 'critical'].includes(normalized) ? normalized : 'normal';
}

function normalizeNotificationType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || 'general';
}

function normalizeStatus(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeTargetMode(value) {
  return normalizeStatus(value, ['all', 'selected_users', 'roles', 'topic', 'active_only', 'custom_filters'], 'all');
}

function normalizeSendMode(value) {
  return normalizeStatus(value, ['immediate', 'scheduled', 'recurring'], 'immediate');
}

function normalizeRecurrenceType(value) {
  return normalizeStatus(value, ['none', 'daily', 'weekly', 'monthly'], 'none');
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', 'n'].includes(normalized)) return false;
  return fallback;
}

function clampPageSize(value) {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(toNumber(value, DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE)));
}

function pageOffset(page, pageSize) {
  return Math.max(0, (Math.max(1, Math.trunc(toNumber(page, 1) || 1)) - 1) * pageSize);
}

function sanitizeNotificationPayload(payload = {}) {
  const message = normalizeMessagePayload({
    title: payload.title,
    body: payload.body || payload.message,
    data: payload.data || {},
  });
  return {
    title: message.title,
    body: message.body,
    data: message.data || {},
    image_url: String(payload.image_url || '').trim() || null,
    redirect_url: String(payload.redirect_url || payload.deep_link || '').trim() || null,
    notification_type: normalizeNotificationType(payload.notification_type),
    priority: normalizePriority(payload.priority),
    is_active: normalizeBoolean(payload.is_active, true),
  };
}

function normalizeTargetConfig(input = {}) {
  const targetMode = normalizeTargetMode(input.target_mode || input.mode);
  return {
    target_mode: targetMode,
    user_ids: normalizeIntegerArray(input.user_ids),
    roles: normalizeArray(input.roles),
    plan_ids: normalizeIntegerArray(input.plan_ids),
    topics: normalizeArray(input.topics),
    channels: normalizeArray(input.channels),
    active_only: normalizeBoolean(input.active_only, targetMode === 'active_only'),
    has_push_device: normalizeBoolean(input.has_push_device, false),
    search: String(input.search || '').trim(),
    created_from: String(input.created_from || '').trim() || null,
    created_to: String(input.created_to || '').trim() || null,
    last_seen_from: String(input.last_seen_from || '').trim() || null,
    last_seen_to: String(input.last_seen_to || '').trim() || null,
    custom_filters: input.custom_filters && typeof input.custom_filters === 'object' ? input.custom_filters : {},
  };
}

function buildSchedulePayload(input = {}) {
  const sendMode = normalizeSendMode(input.send_mode);
  const recurrenceType = normalizeRecurrenceType(input.recurrence_type);
  const recurrenceInterval = Math.max(1, Math.trunc(toNumber(input.recurrence_interval, 1) || 1));
  const timezone = String(input.timezone || 'Asia/Calcutta').trim() || 'Asia/Calcutta';
  const scheduleDate = String(input.schedule_date || '').trim() || null;
  const scheduleTime = String(input.schedule_time || '').trim() || null;
  const startDate = String(input.start_date || '').trim() || scheduleDate;
  const endDate = String(input.end_date || '').trim() || null;
  const scheduledFor = input.scheduled_for ? new Date(input.scheduled_for) : null;
  const expiryAt = input.expiry_at ? new Date(input.expiry_at) : null;
  return {
    send_mode: sendMode,
    recurrence_type: sendMode === 'recurring' ? recurrenceType : 'none',
    recurrence_interval: sendMode === 'recurring' ? recurrenceInterval : 1,
    timezone,
    schedule_date: scheduleDate,
    schedule_time: scheduleTime,
    start_date: startDate,
    end_date: endDate,
    scheduled_for: scheduledFor && !Number.isNaN(scheduledFor.getTime()) ? scheduledFor : null,
    expiry_at: expiryAt && !Number.isNaN(expiryAt.getTime()) ? expiryAt : null,
  };
}

function partsToMap(parts = []) {
  return parts.reduce((acc, part) => {
    if (part?.type && part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
}

function zonedDateTimeToUtc(dateString, timeString, timeZone) {
  if (!dateString) return null;
  const [year, month, day] = String(dateString).split('-').map((value) => Number(value));
  const [hour, minute] = String(timeString || '00:00').split(':').map((value) => Number(value));
  if (![year, month, day].every(Number.isFinite)) return null;
  const utcGuess = new Date(Date.UTC(year, (month || 1) - 1, day || 1, Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = partsToMap(formatter.formatToParts(utcGuess));
  const zonedAsUtc = Date.UTC(
    Number(parts.year || year),
    Math.max(0, Number(parts.month || month) - 1),
    Number(parts.day || day),
    Number(parts.hour || hour || 0),
    Number(parts.minute || minute || 0),
    Number(parts.second || 0)
  );
  const desiredAsUtc = Date.UTC(year, (month || 1) - 1, day || 1, Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0, 0);
  return new Date(utcGuess.getTime() - (zonedAsUtc - desiredAsUtc));
}

function computeScheduledAt(schedule = {}) {
  if (schedule?.scheduled_for instanceof Date && !Number.isNaN(schedule.scheduled_for.getTime())) {
    return schedule.scheduled_for;
  }
  if (schedule?.schedule_date) {
    return zonedDateTimeToUtc(schedule.schedule_date, schedule.schedule_time || '00:00', schedule.timezone || 'UTC');
  }
  return new Date();
}

function computeNextRecurringRun(schedule = {}, fromDate = new Date()) {
  const recurrenceType = normalizeRecurrenceType(schedule.recurrence_type);
  if (recurrenceType === 'none') return null;
  const interval = Math.max(1, Math.trunc(toNumber(schedule.recurrence_interval, 1) || 1));
  const base = new Date(fromDate);
  if (recurrenceType === 'daily') {
    base.setUTCDate(base.getUTCDate() + interval);
  } else if (recurrenceType === 'weekly') {
    base.setUTCDate(base.getUTCDate() + (7 * interval));
  } else if (recurrenceType === 'monthly') {
    base.setUTCMonth(base.getUTCMonth() + interval);
  }
  if (schedule.end_date) {
    const endAt = zonedDateTimeToUtc(schedule.end_date, schedule.schedule_time || '23:59', schedule.timezone || 'UTC');
    if (endAt && base > endAt) return null;
  }
  return base;
}

function normalizeCampaignRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    title: row.title || '',
    body: row.body || '',
    image_url: row.image_url || null,
    redirect_url: row.redirect_url || null,
    notification_type: row.notification_type || 'general',
    priority: row.priority || 'normal',
    status: row.status || 'draft',
    is_active: row.is_active !== false,
    send_mode: row.send_mode || 'immediate',
    recurrence_type: row.recurrence_type || 'none',
    recurrence_interval: Number(row.recurrence_interval || 1),
    schedule_date: row.schedule_date || null,
    schedule_time: row.schedule_time || null,
    timezone: row.timezone || 'UTC',
    scheduled_for: row.scheduled_for || null,
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    expiry_at: row.expiry_at || null,
    template_id: row.template_id != null ? Number(row.template_id) : null,
    target_mode: row.target_mode || 'all',
    target_config: parseJsonSafe(row.target_config, {}),
    payload_data: parseJsonSafe(row.payload_data, {}),
    created_by: row.created_by != null ? Number(row.created_by) : null,
    created_by_name: row.created_by_name || null,
    updated_by: row.updated_by != null ? Number(row.updated_by) : null,
    updated_by_name: row.updated_by_name || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    deleted_at: row.deleted_at || null,
    total_recipients: Number(row.total_recipients || 0),
    pending_count: Number(row.pending_count || 0),
    sent_count: Number(row.sent_count || 0),
    failed_count: Number(row.failed_count || 0),
    retry_count: Number(row.retry_count || 0),
    last_sent_at: row.last_sent_at || null,
    last_processed_at: row.last_processed_at || null,
    latest_schedule_status: row.latest_schedule_status || null,
  };
}

function normalizeTemplateRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name || '',
    description: row.description || '',
    title: row.title || '',
    body: row.body || '',
    image_url: row.image_url || null,
    redirect_url: row.redirect_url || null,
    notification_type: row.notification_type || 'general',
    priority: row.priority || 'normal',
    payload_data: parseJsonSafe(row.payload_data, {}),
    is_active: row.is_active !== false,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function ensureSchema() {
  if (_schemaEnsured) return;
  if (_schemaPromise) return _schemaPromise;
  _schemaPromise = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS notification_templates (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        image_url TEXT,
        redirect_url TEXT,
        notification_type TEXT NOT NULL DEFAULT 'general',
        priority TEXT NOT NULL DEFAULT 'normal',
        payload_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_templates_active ON notification_templates (is_active, created_at DESC) WHERE deleted_at IS NULL`);

    await query(`
      CREATE TABLE IF NOT EXISTS notification_campaigns (
        id BIGSERIAL PRIMARY KEY,
        template_id BIGINT REFERENCES notification_templates(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        image_url TEXT,
        redirect_url TEXT,
        notification_type TEXT NOT NULL DEFAULT 'general',
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'draft',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        send_mode TEXT NOT NULL DEFAULT 'immediate',
        recurrence_type TEXT NOT NULL DEFAULT 'none',
        recurrence_interval INTEGER NOT NULL DEFAULT 1,
        schedule_date TEXT,
        schedule_time TEXT,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        scheduled_for TIMESTAMPTZ,
        start_date TEXT,
        end_date TEXT,
        expiry_at TIMESTAMPTZ,
        target_mode TEXT NOT NULL DEFAULT 'all',
        target_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        payload_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        total_recipients INTEGER NOT NULL DEFAULT 0,
        pending_count INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_sent_at TIMESTAMPTZ,
        last_processed_at TIMESTAMPTZ,
        created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_campaigns_status ON notification_campaigns (status, is_active, scheduled_for) WHERE deleted_at IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_campaigns_created ON notification_campaigns (created_at DESC) WHERE deleted_at IS NULL`);

    await query(`
      CREATE TABLE IF NOT EXISTS notification_schedules (
        id BIGSERIAL PRIMARY KEY,
        notification_id BIGINT NOT NULL REFERENCES notification_campaigns(id) ON DELETE CASCADE,
        run_at TIMESTAMPTZ NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        recurrence_type TEXT NOT NULL DEFAULT 'none',
        recurrence_interval INTEGER NOT NULL DEFAULT 1,
        start_date TEXT,
        end_date TEXT,
        schedule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_schedules_due ON notification_schedules (status, run_at) WHERE deleted_at IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_schedules_notification ON notification_schedules (notification_id, created_at DESC) WHERE deleted_at IS NULL`);

    await query(`
      CREATE TABLE IF NOT EXISTS notification_recipients (
        id BIGSERIAL PRIMARY KEY,
        notification_id BIGINT NOT NULL REFERENCES notification_campaigns(id) ON DELETE CASCADE,
        schedule_id BIGINT REFERENCES notification_schedules(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        targeting_reason TEXT,
        payload_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        device_count INTEGER NOT NULL DEFAULT 0,
        success_device_count INTEGER NOT NULL DEFAULT 0,
        failed_device_count INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TIMESTAMPTZ,
        last_error TEXT,
        queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        failed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        UNIQUE (notification_id, schedule_id, user_id)
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_recipients_status ON notification_recipients (status, next_retry_at, created_at) WHERE deleted_at IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_recipients_user ON notification_recipients (user_id, created_at DESC) WHERE deleted_at IS NULL`);

    await query(`
      CREATE TABLE IF NOT EXISTS notification_delivery_logs (
        id BIGSERIAL PRIMARY KEY,
        notification_id BIGINT NOT NULL REFERENCES notification_campaigns(id) ON DELETE CASCADE,
        schedule_id BIGINT REFERENCES notification_schedules(id) ON DELETE CASCADE,
        recipient_id BIGINT REFERENCES notification_recipients(id) ON DELETE CASCADE,
        user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
        device_token_id BIGINT REFERENCES push_device_tokens(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        provider_message_id TEXT,
        status TEXT NOT NULL,
        attempt_no INTEGER NOT NULL DEFAULT 1,
        error_message TEXT,
        response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_notification ON notification_delivery_logs (notification_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_user ON notification_delivery_logs (user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_status ON notification_delivery_logs (status, created_at DESC)`);

    await query(`
      CREATE TABLE IF NOT EXISTS notification_topic_memberships (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        channel TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      )
    `);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_topic_memberships_unique_active ON notification_topic_memberships (user_id, lower(topic), lower(COALESCE(channel, ''))) WHERE deleted_at IS NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_notification_topic_memberships_topic ON notification_topic_memberships (lower(topic), lower(COALESCE(channel, ''))) WHERE deleted_at IS NULL`);

    _schemaEnsured = true;
    _schemaPromise = null;
  })().catch((err) => {
    _schemaPromise = null;
    throw err;
  });
  return _schemaPromise;
}

async function listUsersForTargeting(options = {}) {
  await ensureSchema();
  const pageSize = clampPageSize(options.page_size || 20);
  const offset = pageOffset(options.page || 1, pageSize);
  const search = String(options.search || '').trim().toLowerCase();
  const role = String(options.role || '').trim().toLowerCase();
  const planId = Number(options.plan_id || 0) || null;
  const activeOnly = normalizeBoolean(options.active_only, false);
  const params = [];
  const where = ['u.deleted_at IS NULL'];
  if (activeOnly) where.push('u.is_active = TRUE');
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      lower(COALESCE(u.display_name, '')) LIKE $${params.length}
      OR lower(COALESCE(u.username, '')) LIKE $${params.length}
      OR lower(COALESCE(u.email, '')) LIKE $${params.length}
      OR COALESCE(u.mobile, '') LIKE $${params.length}
    )`);
  }
  if (role) {
    params.push(role);
    where.push(`lower(COALESCE(u.role, '')) = $${params.length}`);
  }
  if (planId) {
    params.push(planId);
    where.push(`sub.plan_id = $${params.length}`);
  }
  params.push(pageSize, offset);
  const result = await query(
    `SELECT
       u.id,
       u.display_name,
       u.username,
       u.email,
       u.mobile,
       u.role,
       u.is_active,
       sub.plan_id,
       pl.name AS plan_name,
       COALESCE(dev.device_count, 0) AS push_device_count,
       dev.last_seen_at AS push_last_seen_at,
       COUNT(*) OVER() AS total_count
     FROM users u
     LEFT JOIN LATERAL (
       SELECT us.plan_id
       FROM user_subscriptions us
       WHERE us.user_id = u.id
         AND COALESCE(us.status, 'active') = 'active'
       ORDER BY COALESCE(us.end_date, us.start_date) DESC NULLS LAST, us.id DESC
       LIMIT 1
     ) sub ON TRUE
     LEFT JOIN plans pl ON pl.id = sub.plan_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS device_count, MAX(last_seen_at) AS last_seen_at
       FROM push_device_tokens pdt
       WHERE pdt.user_id = u.id
         AND pdt.deleted_at IS NULL
     ) dev ON TRUE
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(dev.last_seen_at, u.created_at) DESC, u.id DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const total = Number(result.rows[0]?.total_count || 0);
  return {
    users: result.rows.map((row) => ({
      id: Number(row.id),
      display_name: row.display_name || '',
      username: row.username || '',
      email: row.email || '',
      mobile: row.mobile || '',
      role: row.role || 'user',
      is_active: row.is_active !== false,
      plan_id: row.plan_id != null ? Number(row.plan_id) : null,
      plan_name: row.plan_name || null,
      push_device_count: Number(row.push_device_count || 0),
      push_last_seen_at: row.push_last_seen_at || null,
    })),
    pagination: {
      page: Math.max(1, Math.trunc(toNumber(options.page, 1) || 1)),
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function upsertTemplate(input = {}, actorUserId = null, templateId = null) {
  await ensureSchema();
  const payload = sanitizeNotificationPayload(input);
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Template name is required');
  const description = String(input.description || '').trim() || null;
  const data = payload.data || {};
  if (templateId) {
    const result = await query(
      `UPDATE notification_templates
       SET name = $1,
           description = $2,
           title = $3,
           body = $4,
           image_url = $5,
           redirect_url = $6,
           notification_type = $7,
           priority = $8,
           payload_data = $9::jsonb,
           is_active = $10,
           updated_by = $11,
           updated_at = NOW()
       WHERE id = $12
         AND deleted_at IS NULL
       RETURNING *`,
      [name, description, payload.title, payload.body, payload.image_url, payload.redirect_url, payload.notification_type, payload.priority, JSON.stringify(data), payload.is_active, actorUserId, templateId]
    );
    return normalizeTemplateRow(result.rows[0] || null);
  }
  const result = await query(
    `INSERT INTO notification_templates
       (name, description, title, body, image_url, redirect_url, notification_type, priority, payload_data, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $11)
     RETURNING *`,
    [name, description, payload.title, payload.body, payload.image_url, payload.redirect_url, payload.notification_type, payload.priority, JSON.stringify(data), payload.is_active, actorUserId]
  );
  return normalizeTemplateRow(result.rows[0] || null);
}

async function listTemplates(options = {}) {
  await ensureSchema();
  const search = String(options.search || '').trim().toLowerCase();
  const params = [];
  const where = ['deleted_at IS NULL'];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(lower(name) LIKE $${params.length} OR lower(title) LIKE $${params.length} OR lower(body) LIKE $${params.length})`);
  }
  const result = await query(
    `SELECT *
     FROM notification_templates
     WHERE ${where.join(' AND ')}
     ORDER BY updated_at DESC, id DESC`,
    params
  );
  return result.rows.map((row) => normalizeTemplateRow(row));
}

async function softDeleteTemplate(templateId, actorUserId = null) {
  await ensureSchema();
  await query(
    `UPDATE notification_templates
     SET deleted_at = NOW(),
         updated_by = $2,
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [templateId, actorUserId]
  );
  return true;
}

async function getTemplate(templateId) {
  await ensureSchema();
  const result = await query(`SELECT * FROM notification_templates WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [templateId]);
  return normalizeTemplateRow(result.rows[0] || null);
}

async function saveCampaign(input = {}, actorUserId = null, campaignId = null) {
  await ensureSchema();
  const payload = sanitizeNotificationPayload(input);
  const target = normalizeTargetConfig(input.targeting || input.target_config || {});
  const schedule = buildSchedulePayload(input.schedule || input);
  const status = normalizeStatus(input.status || '', ['draft', 'queued', 'scheduled', 'processing', 'completed', 'cancelled', 'failed'], schedule.send_mode === 'immediate' ? 'queued' : 'draft');
  const templateId = input.template_id ? Number(input.template_id) : null;
  const scheduledFor = computeScheduledAt(schedule);
  const campaignValues = [
    templateId,
    payload.title,
    payload.body,
    payload.image_url,
    payload.redirect_url,
    payload.notification_type,
    payload.priority,
    status,
    payload.is_active,
    schedule.send_mode,
    schedule.recurrence_type,
    schedule.recurrence_interval,
    schedule.schedule_date,
    schedule.schedule_time,
    schedule.timezone,
    scheduledFor ? scheduledFor.toISOString() : null,
    schedule.start_date,
    schedule.end_date,
    schedule.expiry_at ? schedule.expiry_at.toISOString() : null,
    target.target_mode,
    JSON.stringify(target),
    JSON.stringify(payload.data || {}),
    actorUserId,
  ];
  const campaign = await withTransaction(async (client) => {
    let saved;
    if (campaignId) {
      const result = await client.query(
        `UPDATE notification_campaigns
         SET template_id = $1,
             title = $2,
             body = $3,
             image_url = $4,
             redirect_url = $5,
             notification_type = $6,
             priority = $7,
             status = $8,
             is_active = $9,
             send_mode = $10,
             recurrence_type = $11,
             recurrence_interval = $12,
             schedule_date = $13,
             schedule_time = $14,
             timezone = $15,
             scheduled_for = $16,
             start_date = $17,
             end_date = $18,
             expiry_at = $19,
             target_mode = $20,
             target_config = $21::jsonb,
             payload_data = $22::jsonb,
             updated_by = $23,
             updated_at = NOW()
         WHERE id = $24
           AND deleted_at IS NULL
         RETURNING *`,
        [...campaignValues, campaignId]
      );
      saved = result.rows[0];
      if (!saved) throw new Error('Notification not found');
      await client.query(
        `UPDATE notification_schedules
         SET deleted_at = NOW(),
             updated_at = NOW()
         WHERE notification_id = $1
           AND status IN ('pending', 'running')
           AND deleted_at IS NULL`,
        [campaignId]
      );
    } else {
      const result = await client.query(
        `INSERT INTO notification_campaigns
           (template_id, title, body, image_url, redirect_url, notification_type, priority, status, is_active, send_mode, recurrence_type, recurrence_interval, schedule_date, schedule_time, timezone, scheduled_for, start_date, end_date, expiry_at, target_mode, target_config, payload_data, created_by, updated_by)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb, $22::jsonb, $23, $23)
         RETURNING *`,
        campaignValues
      );
      saved = result.rows[0];
    }

    if (saved && payload.is_active && status !== 'draft' && status !== 'cancelled') {
      const scheduleStatus = schedule.send_mode === 'immediate' ? 'pending' : 'pending';
      await client.query(
        `INSERT INTO notification_schedules
           (notification_id, run_at, timezone, recurrence_type, recurrence_interval, start_date, end_date, schedule_config, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
        [
          saved.id,
          scheduledFor ? scheduledFor.toISOString() : new Date().toISOString(),
          schedule.timezone,
          schedule.recurrence_type,
          schedule.recurrence_interval,
          schedule.start_date,
          schedule.end_date,
          JSON.stringify({
            send_mode: schedule.send_mode,
            schedule_date: schedule.schedule_date,
            schedule_time: schedule.schedule_time,
            timezone: schedule.timezone,
            expiry_at: schedule.expiry_at ? schedule.expiry_at.toISOString() : null,
          }),
          scheduleStatus,
        ]
      );
    }
    return saved;
  });
  return getCampaignById(campaign.id);
}

async function getCampaignById(campaignId) {
  await ensureSchema();
  const result = await query(
    `SELECT
       c.*,
       cu.display_name AS created_by_name,
       uu.display_name AS updated_by_name,
       (
         SELECT ns.status
         FROM notification_schedules ns
         WHERE ns.notification_id = c.id
           AND ns.deleted_at IS NULL
         ORDER BY ns.created_at DESC, ns.id DESC
         LIMIT 1
       ) AS latest_schedule_status
     FROM notification_campaigns c
     LEFT JOIN users cu ON cu.id = c.created_by
     LEFT JOIN users uu ON uu.id = c.updated_by
     WHERE c.id = $1
       AND c.deleted_at IS NULL
     LIMIT 1`,
    [campaignId]
  );
  const campaign = normalizeCampaignRow(result.rows[0] || null);
  if (!campaign) return null;
  const [schedulesResult, recipientsResult] = await Promise.all([
    query(
      `SELECT *
       FROM notification_schedules
       WHERE notification_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`,
      [campaignId]
    ),
    query(
      `SELECT
         nr.*,
         u.display_name,
         u.email
       FROM notification_recipients nr
       JOIN users u ON u.id = nr.user_id
       WHERE nr.notification_id = $1
         AND nr.deleted_at IS NULL
       ORDER BY nr.created_at DESC, nr.id DESC
       LIMIT 200`,
      [campaignId]
    ),
  ]);
  campaign.schedules = schedulesResult.rows.map((row) => ({
    id: Number(row.id),
    run_at: row.run_at || null,
    timezone: row.timezone || 'UTC',
    recurrence_type: row.recurrence_type || 'none',
    recurrence_interval: Number(row.recurrence_interval || 1),
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    schedule_config: parseJsonSafe(row.schedule_config, {}),
    status: row.status || 'pending',
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    last_error: row.last_error || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }));
  campaign.recipients = recipientsResult.rows.map((row) => ({
    id: Number(row.id),
    user_id: Number(row.user_id),
    display_name: row.display_name || '',
    email: row.email || '',
    status: row.status || 'pending',
    targeting_reason: row.targeting_reason || null,
    device_count: Number(row.device_count || 0),
    success_device_count: Number(row.success_device_count || 0),
    failed_device_count: Number(row.failed_device_count || 0),
    retry_count: Number(row.retry_count || 0),
    next_retry_at: row.next_retry_at || null,
    last_error: row.last_error || null,
    sent_at: row.sent_at || null,
    delivered_at: row.delivered_at || null,
    failed_at: row.failed_at || null,
    created_at: row.created_at || null,
  }));
  return campaign;
}

async function listCampaigns(options = {}) {
  await ensureSchema();
  const pageSize = clampPageSize(options.page_size || 15);
  const offset = pageOffset(options.page || 1, pageSize);
  const status = String(options.status || '').trim().toLowerCase();
  const search = String(options.search || '').trim().toLowerCase();
  const params = [];
  const where = ['c.deleted_at IS NULL'];
  if (status && status !== 'all') {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(lower(c.title) LIKE $${params.length} OR lower(c.body) LIKE $${params.length})`);
  }
  params.push(pageSize, offset);
  const result = await query(
    `SELECT
       c.*,
       cu.display_name AS created_by_name,
       uu.display_name AS updated_by_name,
       (
         SELECT ns.status
         FROM notification_schedules ns
         WHERE ns.notification_id = c.id
           AND ns.deleted_at IS NULL
         ORDER BY ns.created_at DESC, ns.id DESC
         LIMIT 1
       ) AS latest_schedule_status,
       COUNT(*) OVER() AS total_count
     FROM notification_campaigns c
     LEFT JOIN users cu ON cu.id = c.created_by
     LEFT JOIN users uu ON uu.id = c.updated_by
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(c.scheduled_for, c.created_at) DESC, c.id DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const total = Number(result.rows[0]?.total_count || 0);
  return {
    campaigns: result.rows.map((row) => normalizeCampaignRow(row)),
    pagination: {
      page: Math.max(1, Math.trunc(toNumber(options.page, 1) || 1)),
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function softDeleteCampaign(campaignId, actorUserId = null) {
  await ensureSchema();
  await query(
    `UPDATE notification_campaigns
     SET deleted_at = NOW(),
         updated_by = $2,
         updated_at = NOW(),
         status = 'cancelled'
     WHERE id = $1
       AND deleted_at IS NULL`,
    [campaignId, actorUserId]
  );
  await query(
    `UPDATE notification_schedules
     SET deleted_at = NOW(),
         updated_at = NOW(),
         status = 'cancelled'
     WHERE notification_id = $1
       AND deleted_at IS NULL`,
    [campaignId]
  );
  return true;
}

async function duplicateCampaign(campaignId, actorUserId = null) {
  const existing = await getCampaignById(campaignId);
  if (!existing) throw new Error('Notification not found');
  return saveCampaign({
    ...existing,
    title: `${existing.title} (Copy)`,
    status: 'draft',
    schedule: {
      ...existing,
      send_mode: 'immediate',
      recurrence_type: 'none',
      schedule_date: null,
      schedule_time: null,
      scheduled_for: null,
    },
  }, actorUserId, null);
}

async function cancelScheduledCampaign(campaignId, actorUserId = null) {
  await ensureSchema();
  await query(
    `UPDATE notification_campaigns
     SET status = 'cancelled',
         updated_by = $2,
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL`,
    [campaignId, actorUserId]
  );
  await query(
    `UPDATE notification_schedules
     SET status = 'cancelled',
         updated_at = NOW(),
         completed_at = NOW()
     WHERE notification_id = $1
       AND status IN ('pending', 'running')
       AND deleted_at IS NULL`,
    [campaignId]
  );
  await query(
    `UPDATE notification_recipients
     SET status = 'cancelled',
         updated_at = NOW()
     WHERE notification_id = $1
       AND status IN ('pending', 'processing')
       AND deleted_at IS NULL`,
    [campaignId]
  );
  return getCampaignById(campaignId);
}

async function listDeviceTokens(options = {}) {
  await ensureSchema();
  const pageSize = clampPageSize(options.page_size || 20);
  const offset = pageOffset(options.page || 1, pageSize);
  const search = String(options.search || '').trim().toLowerCase();
  const params = [];
  const where = ['pdt.deleted_at IS NULL'];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      lower(COALESCE(u.display_name, '')) LIKE $${params.length}
      OR lower(COALESCE(u.email, '')) LIKE $${params.length}
      OR lower(COALESCE(pdt.platform, '')) LIKE $${params.length}
      OR lower(COALESCE(pdt.device_name, '')) LIKE $${params.length}
      OR lower(COALESCE(pdt.expo_push_token, '')) LIKE $${params.length}
    )`);
  }
  params.push(pageSize, offset);
  const result = await query(
    `SELECT
       pdt.*,
       u.display_name,
       u.email,
       COUNT(*) OVER() AS total_count
     FROM push_device_tokens pdt
     JOIN users u ON u.id = pdt.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY pdt.last_seen_at DESC NULLS LAST, pdt.id DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const total = Number(result.rows[0]?.total_count || 0);
  return {
    devices: result.rows.map((row) => ({
      id: Number(row.id),
      user_id: Number(row.user_id),
      display_name: row.display_name || '',
      email: row.email || '',
      platform: row.platform || null,
      device_name: row.device_name || null,
      app_version: row.app_version || null,
      token_preview: String(row.expo_push_token || '').slice(0, 18) + '...',
      last_seen_at: row.last_seen_at || null,
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
    })),
    pagination: {
      page: Math.max(1, Math.trunc(toNumber(options.page, 1) || 1)),
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function buildTargetUsers(targetConfig = {}) {
  const config = normalizeTargetConfig(targetConfig);
  const params = [];
  const where = ['u.deleted_at IS NULL'];
  if (config.active_only || config.target_mode === 'active_only') where.push('u.is_active = TRUE');
  if (config.target_mode === 'selected_users' && config.user_ids.length) {
    params.push(config.user_ids);
    where.push(`u.id = ANY($${params.length}::bigint[])`);
  }
  if (config.roles.length) {
    params.push(config.roles.map((value) => value.toLowerCase()));
    where.push(`lower(COALESCE(u.role, '')) = ANY($${params.length}::text[])`);
  }
  if (config.plan_ids.length) {
    params.push(config.plan_ids);
    where.push(`sub.plan_id = ANY($${params.length}::bigint[])`);
  }
  if (config.search) {
    params.push(`%${config.search.toLowerCase()}%`);
    where.push(`(
      lower(COALESCE(u.display_name, '')) LIKE $${params.length}
      OR lower(COALESCE(u.username, '')) LIKE $${params.length}
      OR lower(COALESCE(u.email, '')) LIKE $${params.length}
    )`);
  }
  if (config.has_push_device) where.push('COALESCE(dev.device_count, 0) > 0');
  if (config.created_from) {
    params.push(config.created_from);
    where.push(`u.created_at >= $${params.length}::timestamptz`);
  }
  if (config.created_to) {
    params.push(config.created_to);
    where.push(`u.created_at <= $${params.length}::timestamptz`);
  }
  if (config.last_seen_from) {
    params.push(config.last_seen_from);
    where.push(`dev.last_seen_at >= $${params.length}::timestamptz`);
  }
  if (config.last_seen_to) {
    params.push(config.last_seen_to);
    where.push(`dev.last_seen_at <= $${params.length}::timestamptz`);
  }
  if (config.topics.length) {
    params.push(config.topics.map((value) => value.toLowerCase()));
    if (config.channels.length) {
      params.push(config.channels.map((value) => value.toLowerCase()));
      where.push(`EXISTS (
        SELECT 1
        FROM notification_topic_memberships ntm
        WHERE ntm.user_id = u.id
          AND ntm.deleted_at IS NULL
          AND ntm.is_active = TRUE
          AND lower(ntm.topic) = ANY($${params.length - 1}::text[])
          AND lower(COALESCE(ntm.channel, '')) = ANY($${params.length}::text[])
      )`);
    } else {
      where.push(`EXISTS (
        SELECT 1
        FROM notification_topic_memberships ntm
        WHERE ntm.user_id = u.id
          AND ntm.deleted_at IS NULL
          AND ntm.is_active = TRUE
          AND lower(ntm.topic) = ANY($${params.length}::text[])
      )`);
    }
  } else if (config.channels.length) {
    params.push(config.channels.map((value) => value.toLowerCase()));
    where.push(`EXISTS (
      SELECT 1
      FROM notification_topic_memberships ntm
      WHERE ntm.user_id = u.id
        AND ntm.deleted_at IS NULL
        AND ntm.is_active = TRUE
        AND lower(COALESCE(ntm.channel, '')) = ANY($${params.length}::text[])
    )`);
  }
  const result = await query(
    `SELECT
       u.id,
       u.display_name,
       u.email,
       COALESCE(dev.device_count, 0) AS device_count
     FROM users u
     LEFT JOIN LATERAL (
       SELECT us.plan_id
       FROM user_subscriptions us
       WHERE us.user_id = u.id
         AND COALESCE(us.status, 'active') = 'active'
       ORDER BY COALESCE(us.end_date, us.start_date) DESC NULLS LAST, us.id DESC
       LIMIT 1
     ) sub ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS device_count, MAX(last_seen_at) AS last_seen_at
       FROM push_device_tokens pdt
       WHERE pdt.user_id = u.id
         AND pdt.deleted_at IS NULL
     ) dev ON TRUE
     WHERE ${where.join(' AND ')}
     ORDER BY u.id`,
    params
  );
  return result.rows.map((row) => ({
    user_id: Number(row.id),
    display_name: row.display_name || '',
    email: row.email || '',
    device_count: Number(row.device_count || 0),
  }));
}

async function queueRecipientsForSchedule(campaign, scheduleId) {
  const users = await buildTargetUsers(campaign.target_config || {});
  if (!users.length) return { users: [], inserted: 0 };
  let inserted = 0;
  await withTransaction(async (client) => {
    for (const user of users) {
      const result = await client.query(
        `INSERT INTO notification_recipients
           (notification_id, schedule_id, user_id, targeting_reason, payload_data, status, device_count)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6)
         ON CONFLICT (notification_id, schedule_id, user_id) DO NOTHING`,
        [
          campaign.id,
          scheduleId,
          user.user_id,
          `mode:${campaign.target_mode || 'all'}`,
          JSON.stringify(campaign.payload_data || {}),
          user.device_count,
        ]
      );
      inserted += Number(result.rowCount || 0);
    }
    await client.query(
      `UPDATE notification_campaigns
       SET total_recipients = (
             SELECT COUNT(*)
             FROM notification_recipients nr
             WHERE nr.notification_id = $1
               AND nr.deleted_at IS NULL
           ),
           pending_count = (
             SELECT COUNT(*)
             FROM notification_recipients nr
             WHERE nr.notification_id = $1
               AND nr.deleted_at IS NULL
               AND nr.status IN ('pending', 'processing')
           ),
           updated_at = NOW()
       WHERE id = $1`,
      [campaign.id]
    );
  });
  return { users, inserted };
}

async function listPendingRecipients(scheduleId, limit = 100) {
  const result = await query(
    `SELECT nr.*, u.display_name, u.email
     FROM notification_recipients nr
     JOIN users u ON u.id = nr.user_id
     WHERE nr.schedule_id = $1
       AND nr.deleted_at IS NULL
       AND (
         nr.status = 'pending'
         OR (nr.status = 'failed' AND nr.retry_count < $3 AND COALESCE(nr.next_retry_at, NOW()) <= NOW())
       )
     ORDER BY nr.id
     LIMIT $2`,
    [scheduleId, limit, MAX_RETRY_ATTEMPTS]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    notification_id: Number(row.notification_id),
    schedule_id: row.schedule_id != null ? Number(row.schedule_id) : null,
    user_id: Number(row.user_id),
    display_name: row.display_name || '',
    email: row.email || '',
    retry_count: Number(row.retry_count || 0),
    device_count: Number(row.device_count || 0),
    payload_data: parseJsonSafe(row.payload_data, {}),
  }));
}

async function getPushDevicesForUsers(userIds = []) {
  const normalized = normalizeIntegerArray(userIds);
  if (!normalized.length) return [];
  const result = await query(
    `SELECT id, user_id, expo_push_token AS token, platform, device_name, app_version
     FROM push_device_tokens
     WHERE deleted_at IS NULL
       AND user_id = ANY($1::bigint[])`,
    [normalized]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    user_id: Number(row.user_id),
    token: row.token,
    platform: row.platform || null,
    device_name: row.device_name || null,
    app_version: row.app_version || null,
  }));
}

async function createInAppNotification(userId, campaign, recipientId) {
  const data = {
    ...(campaign.payload_data || {}),
    campaign_id: campaign.id,
    recipient_id: recipientId,
    image_url: campaign.image_url || null,
    redirect_url: campaign.redirect_url || null,
  };
  const result = await query(
    `INSERT INTO user_notifications
       (user_id, type, dedupe_key, title, body, target_screen, target_params, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      userId,
      'admin_push_campaign',
      `${campaign.id}:${recipientId}`,
      campaign.title,
      campaign.body,
      campaign.redirect_url || null,
      JSON.stringify({ url: campaign.redirect_url || null }),
      JSON.stringify(data),
    ]
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

async function writeDeliveryLog(entry = {}) {
  await query(
    `INSERT INTO notification_delivery_logs
       (notification_id, schedule_id, recipient_id, user_id, device_token_id, provider, provider_message_id, status, attempt_no, error_message, response_payload, delivered_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
    [
      entry.notification_id,
      entry.schedule_id,
      entry.recipient_id,
      entry.user_id,
      entry.device_token_id,
      entry.provider || 'unknown',
      entry.provider_message_id || null,
      entry.status || 'failed',
      Math.max(1, Math.trunc(toNumber(entry.attempt_no, 1) || 1)),
      entry.error_message || null,
      JSON.stringify(entry.response_payload || {}),
      entry.delivered_at || null,
    ]
  );
}

async function finalizeRecipientStatus(recipientId, summary = {}) {
  const sent = Number(summary.success_count || 0) > 0;
  const failed = !sent;
  const retryCount = Math.max(0, Math.trunc(toNumber(summary.retry_count, 0) || 0));
  const nextRetryAt = failed && retryCount < MAX_RETRY_ATTEMPTS
    ? new Date(Date.now() + (RETRY_DELAY_MINUTES * retryCount || RETRY_DELAY_MINUTES) * 60 * 1000)
    : null;
  await query(
    `UPDATE notification_recipients
     SET status = $2,
         success_device_count = $3,
         failed_device_count = $4,
         retry_count = $5,
         next_retry_at = $6,
         last_error = $7,
         sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
         delivered_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE delivered_at END,
         failed_at = CASE WHEN $2 = 'failed' AND $6 IS NULL THEN NOW() ELSE failed_at END,
         updated_at = NOW()
     WHERE id = $1`,
    [
      recipientId,
      sent ? 'sent' : 'failed',
      Number(summary.success_count || 0),
      Number(summary.failed_count || 0),
      retryCount,
      nextRetryAt ? nextRetryAt.toISOString() : null,
      summary.last_error || null,
    ]
  );
}

async function refreshCampaignCounters(campaignId) {
  await query(
    `UPDATE notification_campaigns c
     SET total_recipients = stats.total_recipients,
         pending_count = stats.pending_count,
         sent_count = stats.sent_count,
         failed_count = stats.failed_count,
         retry_count = stats.retry_count,
         last_processed_at = NOW(),
         last_sent_at = CASE WHEN stats.sent_count > 0 THEN NOW() ELSE c.last_sent_at END,
         status = CASE
           WHEN c.status = 'cancelled' THEN c.status
           WHEN stats.pending_count > 0 THEN 'processing'
           WHEN stats.failed_count > 0 AND stats.sent_count = 0 THEN 'failed'
           ELSE 'completed'
         END,
         updated_at = NOW()
     FROM (
       SELECT
         COUNT(*) AS total_recipients,
         COUNT(*) FILTER (WHERE status IN ('pending', 'processing')) AS pending_count,
         COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
         COALESCE(SUM(retry_count), 0) AS retry_count
       FROM notification_recipients
       WHERE notification_id = $1
         AND deleted_at IS NULL
     ) stats
     WHERE c.id = $1`,
    [campaignId]
  );
}

async function getNextRecipientRetryAt(scheduleId) {
  const result = await query(
    `SELECT MIN(COALESCE(next_retry_at, NOW())) AS next_run_at
     FROM notification_recipients
     WHERE schedule_id = $1
       AND deleted_at IS NULL
       AND (
         status IN ('pending', 'processing')
         OR (status = 'failed' AND next_retry_at IS NOT NULL AND retry_count < $2)
       )`,
    [scheduleId, MAX_RETRY_ATTEMPTS]
  );
  return result.rows[0]?.next_run_at || null;
}

async function lockNextDueSchedule() {
  await ensureSchema();
  const result = await query(
    `WITH next_schedule AS (
       SELECT ns.id
       FROM notification_schedules ns
       JOIN notification_campaigns c ON c.id = ns.notification_id
       WHERE ns.deleted_at IS NULL
         AND c.deleted_at IS NULL
         AND c.is_active = TRUE
         AND ns.status = 'pending'
         AND ns.run_at <= NOW()
       ORDER BY ns.run_at ASC, ns.id ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE notification_schedules ns
     SET status = 'running',
         started_at = NOW(),
         updated_at = NOW()
     FROM next_schedule
     WHERE ns.id = next_schedule.id
     RETURNING ns.*`
  );
  return result.rows[0] || null;
}

async function completeSchedule(scheduleId, campaign, scheduleRow, lastError = null) {
  const nextRun = campaign.send_mode === 'recurring'
    ? computeNextRecurringRun({
        recurrence_type: scheduleRow.recurrence_type,
        recurrence_interval: scheduleRow.recurrence_interval,
        end_date: scheduleRow.end_date,
        schedule_time: campaign.schedule_time,
        timezone: scheduleRow.timezone,
      }, new Date(scheduleRow.run_at))
    : null;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE notification_schedules
       SET status = $2,
           completed_at = NOW(),
           updated_at = NOW(),
           last_error = $3
       WHERE id = $1`,
      [scheduleId, lastError ? 'failed' : 'completed', lastError]
    );
    if (nextRun && !lastError && campaign.is_active && campaign.status !== 'cancelled') {
      await client.query(
        `INSERT INTO notification_schedules
           (notification_id, run_at, timezone, recurrence_type, recurrence_interval, start_date, end_date, schedule_config, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending')`,
        [
          campaign.id,
          nextRun.toISOString(),
          scheduleRow.timezone,
          scheduleRow.recurrence_type,
          scheduleRow.recurrence_interval,
          scheduleRow.start_date,
          scheduleRow.end_date,
          JSON.stringify(parseJsonSafe(scheduleRow.schedule_config, {})),
        ]
      );
      await client.query(
        `UPDATE notification_campaigns
         SET status = 'scheduled',
             scheduled_for = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [campaign.id, nextRun.toISOString()]
      );
    }
  });
}

async function processSchedule(scheduleRow) {
  const campaign = await getCampaignById(scheduleRow.notification_id);
  if (!campaign || !campaign.is_active || campaign.status === 'cancelled') {
    await query(`UPDATE notification_schedules SET status = 'cancelled', completed_at = NOW(), updated_at = NOW() WHERE id = $1`, [scheduleRow.id]);
    return;
  }
  if (campaign.expiry_at && new Date(campaign.expiry_at).getTime() < Date.now()) {
    await query(`UPDATE notification_campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [campaign.id]);
    await query(`UPDATE notification_schedules SET status = 'cancelled', completed_at = NOW(), updated_at = NOW(), last_error = 'Notification expired before delivery' WHERE id = $1`, [scheduleRow.id]);
    return;
  }
  await queueRecipientsForSchedule(campaign, scheduleRow.id);
  const recipients = await listPendingRecipients(scheduleRow.id, 250);
  if (!recipients.length) {
    await refreshCampaignCounters(campaign.id);
    await completeSchedule(scheduleRow.id, campaign, scheduleRow, null);
    return;
  }
  const devices = await getPushDevicesForUsers(recipients.map((recipient) => recipient.user_id));
  const devicesByUserId = new Map();
  devices.forEach((device) => {
    const list = devicesByUserId.get(device.user_id) || [];
    list.push(device);
    devicesByUserId.set(device.user_id, list);
  });

  const messages = [];
  for (const recipient of recipients) {
    await createInAppNotification(recipient.user_id, campaign, recipient.id);
    const recipientDevices = devicesByUserId.get(recipient.user_id) || [];
    if (!recipientDevices.length) {
      await writeDeliveryLog({
        notification_id: campaign.id,
        schedule_id: scheduleRow.id,
        recipient_id: recipient.id,
        user_id: recipient.user_id,
        provider: 'none',
        status: 'failed',
        attempt_no: recipient.retry_count + 1,
        error_message: 'No active device tokens',
      });
      await finalizeRecipientStatus(recipient.id, {
        success_count: 0,
        failed_count: 1,
        retry_count: recipient.retry_count + 1,
        last_error: 'No active device tokens',
      });
      continue;
    }
    for (const device of recipientDevices) {
      messages.push({
        to: device.token,
        title: campaign.title,
        body: campaign.body,
        platform: device.platform,
        user_id: recipient.user_id,
        data: {
          ...(campaign.payload_data || {}),
          campaign_id: campaign.id,
          recipient_id: recipient.id,
          image_url: campaign.image_url || '',
          redirect_url: campaign.redirect_url || '',
        },
        meta: {
          recipient_id: recipient.id,
          schedule_id: scheduleRow.id,
          notification_id: campaign.id,
          device_token_id: device.id,
          token: device.token,
        },
      });
    }
  }

  if (messages.length) {
    const delivery = await sendExpoPushNotifications(messages);
    const summaryByRecipient = new Map();
    for (const result of (delivery.results || [])) {
      const recipientId = Number(result?.meta?.recipient_id || 0);
      if (!recipientId) continue;
      const current = summaryByRecipient.get(recipientId) || { success_count: 0, failed_count: 0, retry_count: 0, last_error: null };
      if (result.success) current.success_count += 1;
      else {
        current.failed_count += 1;
        current.last_error = result.error || current.last_error;
      }
      current.retry_count = Math.max(current.retry_count, Number(result?.meta?.retry_count || 0));
      summaryByRecipient.set(recipientId, current);
      await writeDeliveryLog({
        notification_id: campaign.id,
        schedule_id: scheduleRow.id,
        recipient_id: recipientId,
        user_id: result?.meta?.user_id || null,
        device_token_id: result?.meta?.device_token_id || null,
        provider: result.provider || 'unknown',
        provider_message_id: result.provider_message_id || null,
        status: result.success ? 'sent' : 'failed',
        attempt_no: Number(result?.meta?.attempt_no || 1),
        error_message: result.error || null,
        response_payload: result.response || {},
        delivered_at: result.success ? new Date().toISOString() : null,
      });
    }
    for (const recipient of recipients) {
      const summary = summaryByRecipient.get(recipient.id);
      if (!summary) continue;
      await finalizeRecipientStatus(recipient.id, {
        success_count: summary.success_count,
        failed_count: summary.failed_count,
        retry_count: recipient.retry_count + (summary.failed_count > 0 && summary.success_count === 0 ? 1 : 0),
        last_error: summary.last_error,
      });
    }
  }

  await refreshCampaignCounters(campaign.id);
  const refreshedCampaign = await getCampaignById(campaign.id);
  if (Number(refreshedCampaign?.pending_count || 0) > 0) {
    const nextRunAt = await getNextRecipientRetryAt(scheduleRow.id);
    await query(
      `UPDATE notification_schedules
       SET status = 'pending',
           run_at = COALESCE($2, NOW() + INTERVAL '5 minutes'),
           updated_at = NOW(),
           last_error = NULL
       WHERE id = $1`,
      [scheduleRow.id, nextRunAt]
    );
    await query(
      `UPDATE notification_campaigns
       SET status = 'processing',
           updated_at = NOW()
       WHERE id = $1`,
      [campaign.id]
    );
    return;
  }
  await completeSchedule(scheduleRow.id, refreshedCampaign, scheduleRow, null);
}

async function processDueNotifications() {
  await ensureSchema();
  if (_processorRunning) return { skipped: true };
  _processorRunning = true;
  let processed = 0;
  try {
    while (true) {
      const scheduleRow = await lockNextDueSchedule();
      if (!scheduleRow) break;
      try {
        await processSchedule(scheduleRow);
      } catch (err) {
        await query(
          `UPDATE notification_schedules
           SET status = 'failed',
               completed_at = NOW(),
               updated_at = NOW(),
               last_error = $2
           WHERE id = $1`,
          [scheduleRow.id, err?.message || 'Notification processing failed']
        );
        await query(
          `UPDATE notification_campaigns
           SET status = 'failed',
               updated_at = NOW()
           WHERE id = $1`,
          [scheduleRow.notification_id]
        );
      }
      processed += 1;
      if (processed >= 10) break;
    }
  } finally {
    _processorRunning = false;
  }
  return { processed };
}

async function sendTestNotification(input = {}, actorUserId = null) {
  await ensureSchema();
  const userId = Number(input.user_id || actorUserId || 0);
  if (!userId) throw new Error('User is required');
  const payload = sanitizeNotificationPayload(input);
  const devices = await getPushDevicesForUsers([userId]);
  if (!devices.length) throw new Error('Selected user has no active device tokens');
  const delivery = await sendExpoPushNotifications(devices.map((device) => ({
    to: device.token,
    title: payload.title,
    body: payload.body,
    platform: device.platform,
    user_id: userId,
    data: payload.data,
    meta: {
      user_id: userId,
      device_token_id: device.id,
      attempt_no: 1,
    },
  })));
  return {
    success: delivery.ok,
    sent_count: delivery.sent || 0,
    errors: delivery.errors || [],
    results: delivery.results || [],
  };
}

async function getDashboardSummary() {
  await ensureSchema();
  const [campaignStats, todayStats, scheduleStats, recentResult] = await Promise.all([
    query(
      `SELECT
         COUNT(*) AS total_notifications,
         COUNT(*) FILTER (WHERE status = 'scheduled' AND is_active = TRUE) AS active_scheduled_jobs
       FROM notification_campaigns
       WHERE deleted_at IS NULL`
    ),
    query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS sent_today,
         COUNT(*) FILTER (WHERE status = 'failed' AND created_at::date = CURRENT_DATE) AS failed_today,
         COUNT(*) FILTER (WHERE status = 'sent') AS total_sent_logs,
         COUNT(*) FILTER (WHERE status = 'failed') AS total_failed_logs
       FROM notification_delivery_logs`
    ),
    query(
      `SELECT COUNT(*) AS pending_deliveries
       FROM notification_recipients
       WHERE deleted_at IS NULL
         AND status IN ('pending', 'processing')`
    ),
    query(
      `SELECT id, title, status, created_at, scheduled_for, sent_count, failed_count
       FROM notification_campaigns
       WHERE deleted_at IS NULL
       ORDER BY COALESCE(last_processed_at, created_at) DESC, id DESC
       LIMIT 8`
    ),
  ]);
  const totalSentLogs = Number(todayStats.rows[0]?.total_sent_logs || 0);
  const totalFailedLogs = Number(todayStats.rows[0]?.total_failed_logs || 0);
  const denominator = totalSentLogs + totalFailedLogs;
  return {
    total_notifications: Number(campaignStats.rows[0]?.total_notifications || 0),
    sent_today: Number(todayStats.rows[0]?.sent_today || 0),
    failed_today: Number(todayStats.rows[0]?.failed_today || 0),
    delivery_success_percent: denominator ? Number(((totalSentLogs / denominator) * 100).toFixed(1)) : 100,
    active_scheduled_jobs: Number(campaignStats.rows[0]?.active_scheduled_jobs || 0),
    pending_deliveries: Number(scheduleStats.rows[0]?.pending_deliveries || 0),
    recent_activity: recentResult.rows.map((row) => ({
      id: Number(row.id),
      title: row.title || '',
      status: row.status || 'draft',
      created_at: row.created_at || null,
      scheduled_for: row.scheduled_for || null,
      sent_count: Number(row.sent_count || 0),
      failed_count: Number(row.failed_count || 0),
    })),
  };
}

async function listDeliveryLogs(options = {}) {
  await ensureSchema();
  const pageSize = clampPageSize(options.page_size || 20);
  const offset = pageOffset(options.page || 1, pageSize);
  const search = String(options.search || '').trim().toLowerCase();
  const status = String(options.status || '').trim().toLowerCase();
  const fromDate = String(options.from_date || '').trim();
  const toDate = String(options.to_date || '').trim();
  const campaignId = Number(options.notification_id || 0) || null;
  const params = [];
  const where = ['1=1'];
  if (status && status !== 'all') {
    params.push(status);
    where.push(`lower(ndl.status) = $${params.length}`);
  }
  if (campaignId) {
    params.push(campaignId);
    where.push(`ndl.notification_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      lower(COALESCE(c.title, '')) LIKE $${params.length}
      OR lower(COALESCE(u.display_name, '')) LIKE $${params.length}
      OR lower(COALESCE(u.email, '')) LIKE $${params.length}
      OR lower(COALESCE(ndl.error_message, '')) LIKE $${params.length}
    )`);
  }
  if (fromDate) {
    params.push(fromDate);
    where.push(`ndl.created_at >= $${params.length}::timestamptz`);
  }
  if (toDate) {
    params.push(toDate);
    where.push(`ndl.created_at <= $${params.length}::timestamptz`);
  }
  params.push(pageSize, offset);
  const result = await query(
    `SELECT
       ndl.*,
       c.title AS notification_title,
       u.display_name,
       u.email,
       COUNT(*) OVER() AS total_count
     FROM notification_delivery_logs ndl
     LEFT JOIN notification_campaigns c ON c.id = ndl.notification_id
     LEFT JOIN users u ON u.id = ndl.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY ndl.created_at DESC, ndl.id DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );
  const total = Number(result.rows[0]?.total_count || 0);
  return {
    logs: result.rows.map((row) => ({
      id: Number(row.id),
      notification_id: row.notification_id != null ? Number(row.notification_id) : null,
      notification_title: row.notification_title || '',
      schedule_id: row.schedule_id != null ? Number(row.schedule_id) : null,
      recipient_id: row.recipient_id != null ? Number(row.recipient_id) : null,
      user_id: row.user_id != null ? Number(row.user_id) : null,
      display_name: row.display_name || '',
      email: row.email || '',
      provider: row.provider || 'unknown',
      provider_message_id: row.provider_message_id || null,
      status: row.status || 'failed',
      attempt_no: Number(row.attempt_no || 1),
      error_message: row.error_message || null,
      response_payload: parseJsonSafe(row.response_payload, {}),
      delivered_at: row.delivered_at || null,
      created_at: row.created_at || null,
    })),
    pagination: {
      page: Math.max(1, Math.trunc(toNumber(options.page, 1) || 1)),
      page_size: pageSize,
      total,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

async function exportDeliveryLogsCsv(options = {}) {
  const result = await listDeliveryLogs({ ...options, page: 1, page_size: 1000 });
  const rows = [
    ['Notification', 'User', 'Email', 'Provider', 'Status', 'Attempt', 'Delivered At', 'Created At', 'Error'],
    ...result.logs.map((row) => [
      row.notification_title,
      row.display_name,
      row.email,
      row.provider,
      row.status,
      String(row.attempt_no || 1),
      row.delivered_at || '',
      row.created_at || '',
      row.error_message || '',
    ]),
  ];
  return rows
    .map((columns) => columns.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

module.exports = {
  ensureSchema,
  listUsersForTargeting,
  listTemplates,
  getTemplate,
  upsertTemplate,
  softDeleteTemplate,
  listCampaigns,
  getCampaignById,
  saveCampaign,
  softDeleteCampaign,
  duplicateCampaign,
  cancelScheduledCampaign,
  listDeviceTokens,
  sendTestNotification,
  getDashboardSummary,
  listDeliveryLogs,
  exportDeliveryLogsCsv,
  processDueNotifications,
};
