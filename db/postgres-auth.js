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
    `SELECT id, username, email, display_name, role, mobile, avatar_url, currency_code, locale_code, is_active,
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

  await query(
    `UPDATE users
     SET display_name = $1,
         email = $2,
         mobile = $3,
         avatar_url = $4,
         currency_code = $5,
         locale_code = $6,
         updated_at = NOW(),
         updated_by = $7
     WHERE id = $8`,
    [
      nextName,
      nextEmail,
      data.mobile != null ? (String(data.mobile).trim() || null) : (current.mobile || null),
      normalizedAvatar,
      currencyCode,
      localeCode,
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
      `INSERT INTO plans (name, description, price_monthly, price_yearly, is_free, is_active, auto_assign_on_signup)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        data.name,
        data.description || '',
        Number(data.price_monthly || 0),
        Number(data.price_yearly || 0),
        !!data.is_free,
        data.is_active != null ? !!data.is_active : true,
        !!data.auto_assign_on_signup,
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
    return ['dashboard', 'expenses', 'friends', 'divide', 'trips', 'reports', 'emi', 'emitracker', 'friendemis', 'creditcards', 'banks', 'planner', 'tracker', 'recurring', 'ailookup', 'admin'];
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
  findUserByMobile,
  findUserById,
  verifyPassword,
  updateUserProfile,
  changeUserPassword,
  getAllUsers,
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
