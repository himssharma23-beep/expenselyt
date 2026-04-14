const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query, withTransaction } = require('./postgres');

const DEFAULT_LOCALE_BY_CURRENCY = {
  INR: 'en-IN',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  AED: 'en-AE',
  CAD: 'en-CA',
  AUD: 'en-AU',
  SGD: 'en-SG',
  JPY: 'ja-JP',
  CNY: 'zh-CN',
};

function normalizeCurrencyCode(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function normalizeLocaleCode(locale, currencyCode) {
  const cleaned = String(locale || '').trim().replace(/_/g, '-');
  if (/^[a-z]{2,3}(?:-[A-Z]{2})?$/i.test(cleaned)) return cleaned;
  return DEFAULT_LOCALE_BY_CURRENCY[currencyCode] || 'en-US';
}

function normalizeUser(row) {
  if (!row) return null;
  const currencyCode = normalizeCurrencyCode(row.currency_code) || 'INR';
  return {
    ...row,
    apple_user_id: row.apple_user_id || null,
    currency_code: currencyCode,
    locale_code: normalizeLocaleCode(row.locale_code, currencyCode),
  };
}

function normalizePlan(row) {
  if (!row) return null;
  return {
    ...row,
    price_monthly: Number(row.price_monthly || 0),
    price_yearly: Number(row.price_yearly || 0),
    ai_query_limit: row.ai_query_limit != null ? Number(row.ai_query_limit) : -1,
  };
}

function normalizeSubscription(row) {
  if (!row) return null;
  return {
    ...row,
    plan_id: row.plan_id != null ? Number(row.plan_id) : row.plan_id,
    user_id: row.user_id != null ? Number(row.user_id) : row.user_id,
    id: row.id != null ? Number(row.id) : row.id,
  };
}

function normalizeMobile(mobile) {
  const cleaned = String(mobile || '').trim();
  if (!cleaned) return null;
  return cleaned;
}

async function createUser(username, email, password, displayName, preferences = {}, mobile = null) {
  const hash = bcrypt.hashSync(password, 10);
  const currencyCode = normalizeCurrencyCode(preferences.currency_code) || 'INR';
  const localeCode = normalizeLocaleCode(preferences.locale_code, currencyCode);
  const normalizedMobile = normalizeMobile(mobile);
  const result = await query(
    `INSERT INTO users (username, email, password_hash, display_name, currency_code, locale_code, mobile)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      String(username).toLowerCase().trim(),
      String(email).toLowerCase().trim(),
      hash,
      String(displayName).trim(),
      currencyCode,
      localeCode,
      normalizedMobile,
    ]
  );
  return Number(result.rows[0].id);
}

async function findUserByUsername(username) {
  const result = await query(
    `SELECT *
     FROM users
     WHERE lower(username) = lower($1)
       AND deleted_at IS NULL
     LIMIT 1`,
    [String(username || '').trim()]
  );
  return normalizeUser(result.rows[0] || null);
}

async function findUserByEmail(email) {
  const result = await query(
    `SELECT *
     FROM users
     WHERE lower(email) = lower($1)
       AND deleted_at IS NULL
     LIMIT 1`,
    [String(email || '').trim()]
  );
  return normalizeUser(result.rows[0] || null);
}

async function findUserByAppleUserId(appleUserId) {
  const normalized = String(appleUserId || '').trim();
  if (!normalized) return null;
  const result = await query(
    `SELECT *
     FROM users
     WHERE apple_user_id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [normalized]
  );
  return normalizeUser(result.rows[0] || null);
}

async function findUserByMobile(mobile) {
  const cleaned = String(mobile || '').trim();
  if (!cleaned) return null;
  const result = await query(
    `SELECT *
     FROM users
     WHERE regexp_replace(COALESCE(mobile, ''), '[^0-9+]', '', 'g') = regexp_replace($1, '[^0-9+]', '', 'g')
       AND deleted_at IS NULL
     LIMIT 1`,
    [cleaned]
  );
  return normalizeUser(result.rows[0] || null);
}

async function findUserById(id) {
  const result = await query(
    `SELECT id, username, email, display_name, role, mobile, avatar_url, apple_user_id, currency_code, locale_code, is_active,
            created_at, updated_at, deleted_at, created_by, updated_by, deleted_by
     FROM users
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return normalizeUser(result.rows[0] || null);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

async function updateUserProfile(userId, data) {
  const currentResult = await query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [userId]);
  const current = currentResult.rows[0];
  if (!current) throw new Error('User not found');

  const nextEmail = data.email != null ? String(data.email).toLowerCase().trim() : current.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) throw new Error('Invalid email address');

  const duplicate = await query(
    'SELECT id FROM users WHERE lower(email) = lower($1) AND id != $2 AND deleted_at IS NULL LIMIT 1',
    [nextEmail, userId]
  );
  if (duplicate.rows[0]) throw new Error('Email already registered');

  const nextName = data.display_name != null ? String(data.display_name).trim() : current.display_name;
  if (!nextName) throw new Error('Display name is required');
  const currencyCode = normalizeCurrencyCode(data.currency_code != null ? data.currency_code : current.currency_code) || 'INR';
  const localeCode = normalizeLocaleCode(data.locale_code != null ? data.locale_code : current.locale_code, currencyCode);

  const avatarUrl = data.avatar_url != null ? String(data.avatar_url).trim() : (current.avatar_url || null);
  const normalizedAvatar = avatarUrl || null;
  if (normalizedAvatar && !/^https?:\/\//i.test(normalizedAvatar) && !normalizedAvatar.startsWith('/')) {
    throw new Error('Profile picture must be a valid URL or uploaded file');
  }

  const nextAppleUserId = data.apple_user_id !== undefined
    ? (String(data.apple_user_id || '').trim() || null)
    : (current.apple_user_id || null);

  if (nextAppleUserId) {
    const duplicateAppleUser = await query(
      'SELECT id FROM users WHERE apple_user_id = $1 AND id != $2 AND deleted_at IS NULL LIMIT 1',
      [nextAppleUserId, userId]
    );
    if (duplicateAppleUser.rows[0]) throw new Error('This Apple account is already linked to another user');
  }

  await query(
    `UPDATE users
     SET display_name = $1,
         email = $2,
         mobile = $3,
         avatar_url = $4,
         currency_code = $5,
         locale_code = $6,
         apple_user_id = $7,
         updated_at = NOW(),
         updated_by = $8
     WHERE id = $9`,
    [
      nextName,
      nextEmail,
      data.mobile != null ? (String(data.mobile).trim() || null) : (current.mobile || null),
      normalizedAvatar,
      currencyCode,
      localeCode,
      nextAppleUserId,
      userId,
      userId,
    ]
  );

  return findUserById(userId);
}

async function changeUserPassword(userId, currentPassword, newPassword) {
  const result = await query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1', [userId]);
  const user = result.rows[0];
  if (!user) throw new Error('User not found');
  if (!currentPassword || !verifyPassword(currentPassword, user.password_hash)) {
    throw new Error('Current password is incorrect');
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  await query(
    'UPDATE users SET password_hash = $1, updated_at = NOW(), updated_by = $2 WHERE id = $2',
    [bcrypt.hashSync(String(newPassword), 10), userId]
  );
  return true;
}

async function getAllUsers() {
  const result = await query(
    `SELECT
       u.id,
       u.username,
       u.email,
       u.display_name,
       u.role,
       u.mobile,
       u.is_active,
       u.created_at,
       u.updated_at,
       u.deleted_at,
       u.created_by,
       u.updated_by,
       u.deleted_by,
       s.id AS subscription_id,
       s.plan_id AS subscription_plan_id,
       s.billing_cycle AS subscription_billing_cycle,
       s.start_date AS subscription_start_date,
       s.end_date AS subscription_end_date,
       s.status AS subscription_status,
       s.created_at AS subscription_created_at,
       p.name AS subscription_plan_name
     FROM users u
     LEFT JOIN LATERAL (
       SELECT *
       FROM user_subscriptions s
       WHERE s.user_id = u.id AND s.status = 'active'
       ORDER BY s.id DESC
       LIMIT 1
     ) s ON TRUE
     LEFT JOIN plans p ON p.id = s.plan_id
     ORDER BY u.id`
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    username: row.username,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    mobile: row.mobile,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    updated_by: row.updated_by != null ? Number(row.updated_by) : null,
    deleted_by: row.deleted_by != null ? Number(row.deleted_by) : null,
    subscription: row.subscription_id ? {
      id: Number(row.subscription_id),
      plan_id: Number(row.subscription_plan_id),
      billing_cycle: row.subscription_billing_cycle,
      start_date: row.subscription_start_date,
      end_date: row.subscription_end_date,
      status: row.subscription_status,
      created_at: row.subscription_created_at,
      plan_name: row.subscription_plan_name,
    } : null,
  }));
}

function normalizeExpoPushToken(token) {
  const value = String(token || '').trim();
  if (!value) return null;
  if (!/^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(value)) return null;
  return value;
}

async function upsertPushDeviceToken(userId, data = {}) {
  const token = normalizeExpoPushToken(data.token || data.expo_push_token);
  if (!token) throw new Error('Valid Expo push token is required');
  const platform = String(data.platform || '').trim().toLowerCase().slice(0, 20) || null;
  const deviceName = String(data.device_name || data.deviceLabel || '').trim().slice(0, 120) || null;
  const appVersion = String(data.app_version || '').trim().slice(0, 40) || null;
  await query(
    `INSERT INTO push_device_tokens (user_id, expo_push_token, platform, device_name, app_version, last_seen_at, deleted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NULL, NOW())
     ON CONFLICT (expo_push_token)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       platform = EXCLUDED.platform,
       device_name = EXCLUDED.device_name,
       app_version = EXCLUDED.app_version,
       last_seen_at = NOW(),
       deleted_at = NULL,
       updated_at = NOW()`,
    [userId, token, platform, deviceName, appVersion]
  );
  return { success: true, token };
}

async function deactivatePushDeviceToken(userId, token) {
  const normalized = normalizeExpoPushToken(token);
  if (!normalized) return false;
  const result = await query(
    `UPDATE push_device_tokens
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1
       AND expo_push_token = $2
       AND deleted_at IS NULL`,
    [userId, normalized]
  );
  return (result.rowCount || 0) > 0;
}

async function getAdminPushUsers(search = '') {
  const trimmed = String(search || '').trim();
  const params = [];
  let whereSql = `WHERE u.deleted_at IS NULL`;
  if (trimmed) {
    params.push(`%${trimmed}%`);
    whereSql += ` AND (
      u.display_name ILIKE $${params.length}
      OR u.username ILIKE $${params.length}
      OR u.email ILIKE $${params.length}
    )`;
  }
  const result = await query(
    `SELECT
       u.id,
       u.display_name,
       u.username,
       u.email,
       u.is_active,
       COUNT(t.id) FILTER (WHERE t.deleted_at IS NULL) AS push_device_count,
       MAX(t.last_seen_at) FILTER (WHERE t.deleted_at IS NULL) AS push_last_seen_at
     FROM users u
     LEFT JOIN push_device_tokens t ON t.user_id = u.id
     ${whereSql}
     GROUP BY u.id
     ORDER BY
       COUNT(t.id) FILTER (WHERE t.deleted_at IS NULL) DESC,
       lower(u.display_name) ASC
     LIMIT 200`,
    params
  );
  const users = result.rows.map((row) => ({
    id: Number(row.id),
    display_name: row.display_name,
    username: row.username,
    email: row.email,
    is_active: !!row.is_active,
    push_device_count: Number(row.push_device_count || 0),
    push_last_seen_at: row.push_last_seen_at || null,
  }));
  const userIds = users.map((row) => row.id);
  const devicesByUser = new Map();
  if (userIds.length) {
    const devicesResult = await query(
      `SELECT
         user_id,
         platform,
         device_name,
         app_version,
         last_seen_at
       FROM push_device_tokens
       WHERE user_id = ANY($1::bigint[])
         AND deleted_at IS NULL
       ORDER BY user_id, last_seen_at DESC, id DESC`,
      [userIds]
    );
    for (const row of devicesResult.rows) {
      const userId = Number(row.user_id);
      if (!devicesByUser.has(userId)) devicesByUser.set(userId, []);
      devicesByUser.get(userId).push({
        platform: row.platform || null,
        device_name: row.device_name || null,
        app_version: row.app_version || null,
        last_seen_at: row.last_seen_at || null,
      });
    }
  }
  return users.map((user) => ({
    ...user,
    devices: devicesByUser.get(user.id) || [],
  }));
}

async function getPushTokensForUsers(userIds = []) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!ids.length) return [];
  const result = await query(
    `SELECT
       t.user_id,
       t.expo_push_token,
       t.platform,
       t.device_name,
       u.display_name,
       u.username
     FROM push_device_tokens t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN user_notification_preferences p ON p.user_id = u.id
     WHERE t.user_id = ANY($1::bigint[])
       AND t.deleted_at IS NULL
       AND u.deleted_at IS NULL
       AND u.is_active = TRUE
       AND COALESCE(p.push_enabled, TRUE) = TRUE
     ORDER BY u.display_name, t.id`,
    [ids]
  );
  return result.rows.map((row) => ({
    user_id: Number(row.user_id),
    token: row.expo_push_token,
    platform: row.platform || null,
    device_name: row.device_name || null,
    display_name: row.display_name,
    username: row.username,
  }));
}

async function getBasicUsersByIds(userIds = []) {
  const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!ids.length) return [];
  const result = await query(
    `SELECT id, username, email, display_name, role, currency_code, locale_code, is_active
     FROM users
     WHERE id = ANY($1::bigint[])
       AND deleted_at IS NULL`,
    [ids]
  );
  return result.rows.map((row) => normalizeUser({
    ...row,
    id: Number(row.id),
    is_active: !!row.is_active,
  }));
}

async function getAllActiveUsersForEmail() {
  const result = await query(
    `SELECT id, username, email, display_name, role, currency_code, locale_code, is_active
     FROM users
     WHERE deleted_at IS NULL
       AND is_active = TRUE
     ORDER BY id`
  );
  return result.rows.map((row) => normalizeUser({
    ...row,
    id: Number(row.id),
    is_active: !!row.is_active,
  }));
}

async function markEmailNotificationSent(userId, notificationKey, monthKey = null, payload = null) {
  await query(
    `INSERT INTO email_notification_log (user_id, notification_key, month_key, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [userId, String(notificationKey || '').trim(), monthKey || null, payload ? JSON.stringify(payload) : null]
  );
}

async function hasEmailNotificationBeenSent(userId, notificationKey, monthKey = null) {
  const result = await query(
    `SELECT id
     FROM email_notification_log
     WHERE user_id = $1
       AND notification_key = $2
       AND COALESCE(month_key, '') = COALESCE($3, '')
     LIMIT 1`,
    [userId, String(notificationKey || '').trim(), monthKey || null]
  );
  return !!result.rows[0];
}

async function ensureUserNotificationPreferences(userId) {
  await query(
    `INSERT INTO user_notification_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function getUserNotificationPreferences(userId) {
  await ensureUserNotificationPreferences(userId);
  const result = await query(
    `SELECT user_id, push_enabled, created_at, updated_at
     FROM user_notification_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  const row = result.rows[0] || {};
  return {
    user_id: Number(userId),
    push_enabled: row.push_enabled !== false,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function updateUserNotificationPreferences(userId, data = {}) {
  await ensureUserNotificationPreferences(userId);
  if (data.push_enabled !== undefined) {
    await query(
      `UPDATE user_notification_preferences
       SET push_enabled = $1,
           updated_at = NOW()
       WHERE user_id = $2`,
      [!!data.push_enabled, userId]
    );
  }
  return getUserNotificationPreferences(userId);
}

async function createUserNotification(userId, payload = {}) {
  const type = String(payload.type || '').trim();
  const title = String(payload.title || '').trim();
  const body = String(payload.body || '').trim();
  if (!type) throw new Error('Notification type is required');
  if (!title) throw new Error('Notification title is required');
  if (!body) throw new Error('Notification body is required');

  const targetScreen = String(payload.target_screen || '').trim() || null;
  const dedupeKey = String(payload.dedupe_key || '').trim() || null;
  const targetParams = payload.target_params && typeof payload.target_params === 'object' ? payload.target_params : {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};

  const insert = await query(
    `INSERT INTO user_notifications (user_id, type, dedupe_key, title, body, target_screen, target_params, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING
     RETURNING id, user_id, type, dedupe_key, title, body, target_screen, target_params, data, is_read, read_at, pushed_at, created_at`,
    [userId, type, dedupeKey, title, body, targetScreen, JSON.stringify(targetParams), JSON.stringify(data)]
  );
  const row = insert.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    type: row.type,
    dedupe_key: row.dedupe_key || null,
    title: row.title,
    body: row.body,
    target_screen: row.target_screen || null,
    target_params: row.target_params || {},
    data: row.data || {},
    is_read: !!row.is_read,
    read_at: row.read_at || null,
    pushed_at: row.pushed_at || null,
    created_at: row.created_at || null,
  };
}

async function markUserNotificationPushed(userId, notificationId) {
  if (!notificationId) return false;
  const result = await query(
    `UPDATE user_notifications
     SET pushed_at = COALESCE(pushed_at, NOW())
     WHERE id = $1
       AND user_id = $2`,
    [notificationId, userId]
  );
  return (result.rowCount || 0) > 0;
}

async function getUnreadNotificationCount(userId) {
  const result = await query(
    `SELECT COUNT(*)::int AS unread_count
     FROM user_notifications
     WHERE user_id = $1
       AND is_read = FALSE`,
    [userId]
  );
  return Number(result.rows[0]?.unread_count || 0);
}

async function listUserNotifications(userId, options = {}) {
  const limit = Math.min(100, Math.max(1, Number(options.limit || 50)));
  const offset = Math.max(0, Number(options.offset || 0));
  const result = await query(
    `SELECT id, user_id, type, dedupe_key, title, body, target_screen, target_params, data, is_read, read_at, pushed_at, created_at
     FROM user_notifications
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    user_id: Number(row.user_id),
    type: row.type,
    dedupe_key: row.dedupe_key || null,
    title: row.title,
    body: row.body,
    target_screen: row.target_screen || null,
    target_params: row.target_params || {},
    data: row.data || {},
    is_read: !!row.is_read,
    read_at: row.read_at || null,
    pushed_at: row.pushed_at || null,
    created_at: row.created_at || null,
  }));
}

async function markUserNotificationRead(userId, notificationId, isRead = true) {
  const result = await query(
    `UPDATE user_notifications
     SET is_read = $1,
         read_at = CASE WHEN $1 THEN NOW() ELSE NULL END
     WHERE id = $2
       AND user_id = $3
     RETURNING id, is_read, read_at`,
    [!!isRead, notificationId, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    is_read: !!row.is_read,
    read_at: row.read_at || null,
  };
}

async function markAllUserNotificationsRead(userId, isRead = true) {
  const result = await query(
    `UPDATE user_notifications
     SET is_read = $1,
         read_at = CASE WHEN $1 THEN NOW() ELSE NULL END
     WHERE user_id = $2
       AND is_read <> $1`,
    [!!isRead, userId]
  );
  return Number(result.rowCount || 0);
}

async function getAllActiveUsersForNotifications() {
  const result = await query(
    `SELECT
       u.id,
       u.username,
       u.email,
       u.display_name,
       u.role,
       u.currency_code,
       u.locale_code,
       u.is_active,
       COALESCE(p.push_enabled, TRUE) AS push_enabled
     FROM users u
     LEFT JOIN user_notification_preferences p ON p.user_id = u.id
     WHERE u.deleted_at IS NULL
       AND u.is_active = TRUE
     ORDER BY u.id`
  );
  return result.rows.map((row) => ({
    ...normalizeUser({
      ...row,
      id: Number(row.id),
      is_active: !!row.is_active,
    }),
    push_enabled: row.push_enabled !== false,
  }));
}

async function updateUserAdmin(id, data, actorUserId = null) {
  const fields = [];
  const params = [];
  if (data.role !== undefined) {
    params.push(data.role);
    fields.push(`role = $${params.length}`);
  }
  if (data.mobile !== undefined) {
    params.push(data.mobile || null);
    fields.push(`mobile = $${params.length}`);
  }
  if (data.is_active !== undefined) {
    params.push(!!data.is_active);
    fields.push(`is_active = $${params.length}`);
  }
  if (data.display_name !== undefined) {
    params.push(String(data.display_name).trim());
    fields.push(`display_name = $${params.length}`);
  }
  params.push(actorUserId);
  fields.push(`updated_by = $${params.length}`);
  fields.push('updated_at = NOW()');
  if (fields.length === 0) return;
  params.push(id);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
}

async function resetUserPassword(id, newHash) {
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, id]);
}

async function softDeleteUser(id, actorUserId) {
  if (!actorUserId) throw new Error('Actor is required');
  const targetResult = await query('SELECT id, role, deleted_at FROM users WHERE id = $1 LIMIT 1', [id]);
  const target = targetResult.rows[0];
  if (!target) throw new Error('User not found');
  if (target.deleted_at) return false;
  if (Number(target.id) === Number(actorUserId) && target.role === 'admin') {
    const adminCountResult = await query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND deleted_at IS NULL AND is_active = TRUE"
    );
    if (Number(adminCountResult.rows[0]?.count || 0) <= 1) {
      throw new Error('You cannot delete the last active admin account');
    }
  }
  await query(
    `UPDATE users
     SET is_active = FALSE,
         deleted_at = NOW(),
         deleted_by = $2,
         updated_at = NOW(),
         updated_by = $2
     WHERE id = $1`,
    [id, actorUserId]
  );
  return true;
}

async function restoreUser(id, actorUserId) {
  await query(
    `UPDATE users
     SET is_active = TRUE,
         deleted_at = NULL,
         deleted_by = NULL,
         updated_at = NOW(),
         updated_by = $2
     WHERE id = $1`,
    [id, actorUserId]
  );
  return true;
}

async function getPlans() {
  const result = await query(
    `SELECT
       p.*,
       COALESCE(array_agg(pp.page_key ORDER BY pp.id) FILTER (WHERE pp.page_key IS NOT NULL), '{}') AS pages
     FROM plans p
     LEFT JOIN plan_pages pp ON pp.plan_id = p.id
     GROUP BY p.id
     ORDER BY p.id`
  );
  return result.rows.map((row) => ({
    ...normalizePlan(row),
    id: Number(row.id),
    pages: row.pages || [],
  }));
}

async function createPlan(data) {
  return withTransaction(async (client) => {
    if (data.auto_assign_on_signup) {
      await client.query('UPDATE plans SET auto_assign_on_signup = FALSE');
    }
    const result = await client.query(
      `INSERT INTO plans (name, description, price_monthly, price_yearly, is_free, is_active, auto_assign_on_signup, ai_query_limit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        data.name,
        data.description || '',
        Number(data.price_monthly || 0),
        Number(data.price_yearly || 0),
        !!data.is_free,
        data.is_active != null ? !!data.is_active : true,
        !!data.auto_assign_on_signup,
        data.ai_query_limit != null ? Number(data.ai_query_limit) : -1,
      ]
    );
    const planId = Number(result.rows[0].id);
    for (const page of (data.pages || [])) {
      await client.query('INSERT INTO plan_pages (plan_id, page_key) VALUES ($1, $2)', [planId, page]);
    }
    return planId;
  });
}

async function updatePlan(id, data) {
  await withTransaction(async (client) => {
    const fields = [];
    const params = [];
    if (data.name !== undefined) {
      params.push(data.name);
      fields.push(`name = $${params.length}`);
    }
    if (data.description !== undefined) {
      params.push(data.description);
      fields.push(`description = $${params.length}`);
    }
    if (data.price_monthly !== undefined) {
      params.push(Number(data.price_monthly));
      fields.push(`price_monthly = $${params.length}`);
    }
    if (data.price_yearly !== undefined) {
      params.push(Number(data.price_yearly));
      fields.push(`price_yearly = $${params.length}`);
    }
    if (data.is_free !== undefined) {
      params.push(!!data.is_free);
      fields.push(`is_free = $${params.length}`);
    }
    if (data.is_active !== undefined) {
      params.push(!!data.is_active);
      fields.push(`is_active = $${params.length}`);
    }
    if (data.auto_assign_on_signup !== undefined) {
      if (data.auto_assign_on_signup) {
        await client.query('UPDATE plans SET auto_assign_on_signup = FALSE WHERE id != $1', [id]);
      }
      params.push(!!data.auto_assign_on_signup);
      fields.push(`auto_assign_on_signup = $${params.length}`);
    }
    if (data.ai_query_limit !== undefined) {
      params.push(Number(data.ai_query_limit));
      fields.push(`ai_query_limit = $${params.length}`);
    }
    if (fields.length > 0) {
      params.push(id);
      await client.query(`UPDATE plans SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    }
    if (data.pages !== undefined) {
      await client.query('DELETE FROM plan_pages WHERE plan_id = $1', [id]);
      for (const page of data.pages) {
        await client.query('INSERT INTO plan_pages (plan_id, page_key) VALUES ($1, $2)', [id, page]);
      }
    }
  });
}

async function deletePlan(id) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM plan_pages WHERE plan_id = $1', [id]);
    await client.query('DELETE FROM plans WHERE id = $1', [id]);
  });
}

async function getSubscriptions() {
  const result = await query(
    `SELECT
       s.*,
       u.username,
       u.email,
       u.display_name,
       p.name AS plan_name
     FROM user_subscriptions s
     JOIN users u ON u.id = s.user_id
     JOIN plans p ON p.id = s.plan_id
     ORDER BY s.id DESC`
  );
  return result.rows.map((row) => ({
    ...normalizeSubscription(row),
    username: row.username,
    email: row.email,
    display_name: row.display_name,
    plan_name: row.plan_name,
  }));
}

async function createSubscription(data) {
  const result = await query(
    `INSERT INTO user_subscriptions (user_id, plan_id, billing_cycle, start_date, end_date, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      data.user_id,
      data.plan_id,
      data.billing_cycle || 'monthly',
      data.start_date,
      data.end_date || null,
      data.status || 'active',
    ]
  );
  return Number(result.rows[0].id);
}

async function assignSignupPlanToUser(userId) {
  const planResult = await query(
    `SELECT id
     FROM plans
     WHERE is_active = TRUE AND auto_assign_on_signup = TRUE
     ORDER BY id DESC
     LIMIT 1`
  );
  const plan = planResult.rows[0];
  if (!plan) return null;

  const existing = await query(
    `SELECT id
     FROM user_subscriptions
     WHERE user_id = $1 AND status = 'active'
     LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]) return null;

  return createSubscription({
    user_id: userId,
    plan_id: Number(plan.id),
    billing_cycle: 'lifetime',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: null,
    status: 'active',
  });
}

async function updateSubscription(id, data) {
  const fields = [];
  const params = [];
  if (data.status !== undefined) {
    params.push(data.status);
    fields.push(`status = $${params.length}`);
  }
  if (data.end_date !== undefined) {
    params.push(data.end_date || null);
    fields.push(`end_date = $${params.length}`);
  }
  if (data.billing_cycle !== undefined) {
    params.push(data.billing_cycle);
    fields.push(`billing_cycle = $${params.length}`);
  }
  if (data.plan_id !== undefined) {
    params.push(data.plan_id);
    fields.push(`plan_id = $${params.length}`);
  }
  if (fields.length === 0) return;
  params.push(id);
  await query(`UPDATE user_subscriptions SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
}

async function deleteSubscription(id) {
  await query('DELETE FROM user_subscriptions WHERE id = $1', [id]);
}

async function getUserAccessiblePages(userId) {
  const userResult = await query('SELECT role FROM users WHERE id = $1 LIMIT 1', [userId]);
  const user = userResult.rows[0];
  if (!user) return ['dashboard'];
  if (user.role === 'admin') {
    return ['dashboard', 'expenses', 'friends', 'divide', 'livesplit', 'petroldivide', 'trips', 'reports', 'emi', 'emitracker', 'friendemis', 'creditcards', 'banks', 'planner', 'tracker', 'recurring', 'ailookup', 'notifications', 'admin'];
  }

  const pages = new Set(['dashboard']);
  const result = await query(
    `SELECT DISTINCT pp.page_key
     FROM plan_pages pp
     JOIN plans p ON p.id = pp.plan_id
     LEFT JOIN user_subscriptions s
       ON s.plan_id = p.id
      AND s.user_id = $1
      AND s.status = 'active'
      AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
     WHERE (p.is_free = TRUE AND p.is_active = TRUE) OR s.id IS NOT NULL`,
    [userId]
  );
  for (const row of result.rows) {
    pages.add(row.page_key);
  }
  return [...pages];
}

async function generateOtp(userId, purpose, channel) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await withTransaction(async (client) => {
    await client.query(
      'UPDATE otps SET used = TRUE WHERE user_id = $1 AND purpose = $2 AND used = FALSE',
      [userId, purpose]
    );
    await client.query(
      `INSERT INTO otps (user_id, otp_code, purpose, channel, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, code, purpose, channel || 'email', expiresAt]
    );
  });
  return code;
}

async function createPasswordReset(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await withTransaction(async (client) => {
    await client.query(
      'UPDATE password_resets SET used = TRUE WHERE user_id = $1 AND used = FALSE',
      [userId]
    );
    await client.query(
      `INSERT INTO password_resets (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, token, expiresAt]
    );
  });
  return token;
}

async function useOtp(userId, code, purpose) {
  const result = await query(
    `SELECT id
     FROM otps
     WHERE user_id = $1
       AND otp_code = $2
       AND purpose = $3
       AND used = FALSE
       AND expires_at > NOW()
     ORDER BY id DESC
     LIMIT 1`,
    [userId, String(code || '').trim(), purpose]
  );
  const otp = result.rows[0];
  if (!otp) return false;
  await query('UPDATE otps SET used = TRUE WHERE id = $1', [otp.id]);
  return true;
}

async function getPasswordResetByToken(token) {
  const result = await query(
    `SELECT *
     FROM password_resets
     WHERE token = $1
       AND used = FALSE
       AND expires_at > NOW()
     LIMIT 1`,
    [token]
  );
  return result.rows[0] || null;
}

async function usePasswordReset(token, newHash) {
  return withTransaction(async (client) => {
    const resetResult = await client.query(
      `SELECT *
       FROM password_resets
       WHERE token = $1
         AND used = FALSE
         AND expires_at > NOW()
       LIMIT 1`,
      [token]
    );
    const reset = resetResult.rows[0];
    if (!reset) return false;

    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, reset.user_id]);
    await client.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [reset.id]);
    return true;
  });
}

module.exports = {
  createUser,
  findUserByUsername,
  findUserByEmail,
  findUserByAppleUserId,
  findUserByMobile,
  findUserById,
  verifyPassword,
  updateUserProfile,
  changeUserPassword,
  getAllUsers,
  getBasicUsersByIds,
  getAllActiveUsersForEmail,
  getAllActiveUsersForNotifications,
  markEmailNotificationSent,
  hasEmailNotificationBeenSent,
  normalizeExpoPushToken,
  upsertPushDeviceToken,
  deactivatePushDeviceToken,
  getAdminPushUsers,
  getPushTokensForUsers,
  ensureUserNotificationPreferences,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
  createUserNotification,
  markUserNotificationPushed,
  getUnreadNotificationCount,
  listUserNotifications,
  markUserNotificationRead,
  markAllUserNotificationsRead,
  updateUserAdmin,
  resetUserPassword,
  softDeleteUser,
  restoreUser,
  getPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getSubscriptions,
  createSubscription,
  assignSignupPlanToUser,
  updateSubscription,
  deleteSubscription,
  getUserAccessiblePages,
  generateOtp,
  createPasswordReset,
  useOtp,
  getPasswordResetByToken,
  usePasswordReset,
};
