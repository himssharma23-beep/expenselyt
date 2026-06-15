const crypto = require('crypto');
const { query, withTransaction } = require('./postgres');
const pgBillingDb = require('./postgres-billing');

function num(value) {
  return Number(value || 0);
}

function bool(value) {
  return !!value;
}

function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function isMissingLiveSplitFriendColumnError(err) {
  const message = String(err?.message || '').toLowerCase();
  return err?.code === '42703' && (
    message.includes('live_split_friends')
    || message.includes('linked_user_id')
    || message.includes('deleted_at')
    || message.includes('updated_at')
    || message.includes('updated_by')
  );
}

function duplicateError(message) {
  const err = new Error(message);
  err.statusCode = 409;
  return err;
}

function normalizeBankAccountId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCardId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDiscountPercent(value, fallback = 0) {
  if (value === '' || value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw validationError('Card discount must be between 0 and 100');
  }
  return parsed;
}

function normalizeDateValue(value, label = 'Date') {
  const str = String(value || '').trim();
  if (!str) throw validationError(`${label} is required`);
  const normalized = str.length >= 10 ? str.slice(0, 10) : str;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw validationError(`${label} must be in YYYY-MM-DD format`);
  return normalized;
}

function normalizeText(value, label, maxLength = 160) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) throw validationError(`${label} is required`);
  if (normalized.length > maxLength) throw validationError(`${label} must be ${maxLength} characters or fewer`);
  return normalized;
}

function normalizeOptionalText(value, maxLength = 80) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) throw validationError(`Text must be ${maxLength} characters or fewer`);
  return normalized;
}

function normalizeOptionalEmoji(value, maxLength = 12) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeAmount(value, label = 'Amount') {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw validationError(`${label} must be greater than 0`);
  return Math.round(amount * 100) / 100;
}

function validateFriendName(name) {
  const value = String(name || '').trim();
  if (!value) throw validationError('Friend name is required');
  if (value.length > 80) throw validationError('Friend name must be 80 characters or fewer');
  if (!/^[A-Za-z0-9 ]+$/.test(value)) throw validationError('Friend name can contain only letters, numbers, and spaces');
  return value.replace(/\s+/g, ' ');
}

function expandNameCandidates(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const parts = normalized.split(' ').filter(Boolean);
  const variants = [normalized];
  if (parts.length > 1) {
    variants.push(parts[0]);
    variants.push(parts[parts.length - 1]);
    variants.push(parts.slice(0, 2).join(' '));
  }
  return [...new Set(variants.map((item) => item.trim()).filter(Boolean))];
}

function expandHandleCandidates(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const base = raw.includes('@') ? raw.split('@')[0] : raw;
  if (!base) return [];
  const pieces = base
    .split(/[._\-\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const variants = [base, ...pieces];
  return [...new Set(variants.map((item) => item.trim()).filter(Boolean))];
}

function normalizeNameCandidate(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLiveSplitNameCandidates(inviteRow = {}) {
  const rawCandidates = [
    ...expandNameCandidates(inviteRow?.target_name),
    ...expandNameCandidates(inviteRow?.target_display_name),
    ...expandNameCandidates(inviteRow?.target_username),
    ...expandHandleCandidates(inviteRow?.target_username),
    ...expandHandleCandidates(inviteRow?.target_email),
  ];
  const normalized = [...new Set(
    rawCandidates
      .map((value) => normalizeNameCandidate(value))
      .filter(Boolean)
  )];
  const firstTokens = [...new Set(
    normalized
      .map((value) => String(value || '').split(' ')[0])
      .filter(Boolean)
  )];
  return { normalized, firstTokens };
}

function r2(value) {
  return Math.round(num(value) * 100) / 100;
}

const DEFAULT_EXPENSE_CATEGORY_LIBRARY = [
  { name: 'Food', icon: '🍜', subcategories: ['Lunch', 'Dinner', 'Eating out', 'Beverages'] },
  { name: 'Social Life', icon: '🧑‍🤝‍🧑', subcategories: ['Friend', 'Fellowship', 'Alumni', 'Dues'] },
  { name: 'Pets', icon: '🐶', subcategories: ['Food', 'Vet', 'Accessories', 'Grooming'] },
  { name: 'Transport', icon: '🚕', subcategories: ['Bus', 'Subway', 'Taxi', 'Car'] },
  { name: 'Culture', icon: '🖼️', subcategories: ['Books', 'Music', 'Apps', 'Movies'] },
  { name: 'Household', icon: '🪑', subcategories: ['Appliances', 'Furniture', 'Kitchen', 'Toiletries'] },
  { name: 'Apparel', icon: '🧥', subcategories: ['Clothing', 'Fashion', 'Shoes', 'Laundry'] },
  { name: 'Beauty', icon: '💄', subcategories: ['Cosmetics', 'Makeup', 'Accessories', 'Salon'] },
  { name: 'Health', icon: '🧘', subcategories: ['Healthy', 'Yoga', 'Hospital', 'Medicine'] },
  { name: 'Education', icon: '📙', subcategories: ['Schooling', 'Textbooks', 'School supplies', 'Courses'] },
  { name: 'Gift', icon: '🎁', subcategories: ['Birthday', 'Festival', 'Return gift', 'Charity'] },
  { name: 'Other', icon: '📦', subcategories: [] },
];

function liveSplitTextKey(value) {
  return String(value || '').trim().toLowerCase();
}

function liveSplitNormalizePersonName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function liveSplitFirstNameToken(value) {
  return liveSplitNormalizePersonName(value).split(' ')[0] || '';
}

function liveSplitEnsureRow(map, name, extra = {}) {
  const key = liveSplitNormalizePersonName(name);
  if (!key) return null;
  if (!map.has(key)) {
    map.set(key, { key, name: String(name || '').trim(), amount: 0, linked_user_id: null, friend_id: null, ...extra });
  }
  return map.get(key);
}

let expenseCategorySchemaEnsured = false;

async function ensureExpenseCategoryTables() {
  if (expenseCategorySchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS expense_categories (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      icon TEXT,
      is_global BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS expense_subcategories (
      id BIGSERIAL PRIMARY KEY,
      category_id BIGINT NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )`);
  await query(`ALTER TABLE expense_subcategories ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE`);
  await query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subcategory TEXT`);
  await query(`CREATE INDEX IF NOT EXISTS idx_expense_categories_visible ON expense_categories(user_id, is_global, deleted_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_expense_subcategories_category ON expense_subcategories(category_id, deleted_at)`);
  for (const item of DEFAULT_EXPENSE_CATEGORY_LIBRARY) {
    const existing = await query(
      `SELECT id
       FROM expense_categories
       WHERE user_id IS NULL
         AND is_global = TRUE
         AND deleted_at IS NULL
         AND lower(name) = lower($1)
       LIMIT 1`,
      [item.name]
    );
    let categoryId = existing.rows[0]?.id ? Number(existing.rows[0].id) : 0;
    if (!categoryId) {
      const inserted = await query(
        `INSERT INTO expense_categories (user_id, name, icon, is_global)
         VALUES (NULL, $1, $2, TRUE)
         RETURNING id`,
        [item.name, normalizeOptionalEmoji(item.icon)]
      );
      categoryId = Number(inserted.rows[0].id);
    } else {
      await query(
        `UPDATE expense_categories
         SET icon = COALESCE($2, icon),
             updated_at = NOW()
         WHERE id = $1`,
        [categoryId, normalizeOptionalEmoji(item.icon)]
      );
    }
    for (const sub of item.subcategories || []) {
      const subExisting = await query(
        `SELECT id
         FROM expense_subcategories
         WHERE category_id = $1
           AND user_id IS NULL
           AND deleted_at IS NULL
           AND lower(name) = lower($2)
         LIMIT 1`,
        [categoryId, sub]
      );
      if (!subExisting.rows[0]) {
        await query(
          `INSERT INTO expense_subcategories (category_id, user_id, name)
           VALUES ($1, NULL, $2)`,
          [categoryId, sub]
        );
      }
    }
  }
  expenseCategorySchemaEnsured = true;
}

async function getExpenseCategoryVisibleRows(userId) {
  await ensureExpenseCategoryTables();
  const categoryResult = await query(
    `SELECT id,
            user_id,
            name,
            icon,
            is_global,
            created_at,
            updated_at
     FROM expense_categories
     WHERE deleted_at IS NULL
       AND (is_global = TRUE OR user_id = $1)
     ORDER BY is_global DESC, lower(name), id`,
    [userId]
  );
  const categoryIds = categoryResult.rows.map((row) => Number(row.id)).filter(Boolean);
  let subcategoryRows = [];
  if (categoryIds.length) {
    const subResult = await query(
      `SELECT id, category_id, user_id, name, created_at, updated_at
       FROM expense_subcategories
       WHERE deleted_at IS NULL
         AND category_id = ANY($1::bigint[])
         AND (user_id IS NULL OR user_id = $2)
       ORDER BY lower(name), id`,
      [categoryIds, userId]
    );
    subcategoryRows = subResult.rows;
  }
  const subByCategory = new Map();
  subcategoryRows.forEach((row) => {
    const key = Number(row.category_id);
    if (!subByCategory.has(key)) subByCategory.set(key, []);
    subByCategory.get(key).push({
      id: Number(row.id),
      category_id: key,
      user_id: row.user_id ? Number(row.user_id) : null,
      name: String(row.name || '').trim(),
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_global: !row.user_id,
      can_edit: Number(row.user_id || 0) === Number(userId),
      can_delete: Number(row.user_id || 0) === Number(userId),
    });
  });
  return categoryResult.rows.map((row) => {
    const id = Number(row.id);
    return {
      id,
      user_id: row.user_id ? Number(row.user_id) : null,
      name: String(row.name || '').trim(),
      icon: row.icon || '',
      is_global: !!row.is_global,
      is_default: !!row.is_global,
      is_custom: !row.is_global,
      can_edit: !row.is_global,
      can_delete: !row.is_global,
      can_add_subcategories: true,
      created_at: row.created_at,
      updated_at: row.updated_at,
      subcategories: subByCategory.get(id) || [],
    };
  });
}

async function getExpenseCategoryLibrary(userId) {
  const visible = await getExpenseCategoryVisibleRows(userId);
  const legacyResult = await query(
    `SELECT DISTINCT category
     FROM expenses
     WHERE user_id = $1
       AND category IS NOT NULL
       AND btrim(category) <> ''
       AND deleted_at IS NULL
     ORDER BY category`,
    [userId]
  );
  const visibleKeys = new Set(visible.map((row) => String(row.name || '').trim().toLowerCase()));
  const legacy = legacyResult.rows
    .map((row) => String(row.category || '').trim())
    .filter(Boolean)
    .filter((value) => !visibleKeys.has(value.toLowerCase()))
    .map((value, index) => ({
      id: `legacy:${index}:${value.toLowerCase()}`,
      user_id: userId,
      name: value,
      icon: '📝',
      is_global: false,
      is_default: false,
      is_custom: false,
      is_legacy: true,
      can_edit: false,
      can_delete: false,
      can_add_subcategories: true,
      subcategories: [],
    }));
  const categories = [...new Set([...visible.map((row) => row.name), ...legacy.map((row) => row.name)])];
  return {
    categories,
    library: [...visible, ...legacy],
  };
}

async function createExpenseCategory(userId, data) {
  await ensureExpenseCategoryTables();
  const name = normalizeText(data?.name, 'Category name', 80);
  const icon = normalizeOptionalEmoji(data?.icon);
  const existing = await query(
    `SELECT id
     FROM expense_categories
     WHERE deleted_at IS NULL
       AND (is_global = TRUE OR user_id = $1)
       AND lower(name) = lower($2)
     LIMIT 1`,
    [userId, name]
  );
  if (existing.rows[0]) throw duplicateError('A category with this name already exists');
  await query(
    `INSERT INTO expense_categories (user_id, name, icon, is_global)
     VALUES ($1, $2, $3, FALSE)`,
    [userId, name, icon]
  );
  return getExpenseCategoryLibrary(userId);
}

async function updateExpenseCategory(userId, categoryId, data) {
  await ensureExpenseCategoryTables();
  const current = await query(
    `SELECT *
     FROM expense_categories
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [categoryId]
  );
  const row = current.rows[0];
  if (!row) throw validationError('Category not found');
  if (row.is_global || Number(row.user_id) !== Number(userId)) throw validationError('You can edit only your own categories');
  const name = data?.name !== undefined ? normalizeText(data.name, 'Category name', 80) : row.name;
  const icon = data?.icon !== undefined ? normalizeOptionalEmoji(data.icon) : row.icon;
  const conflict = await query(
    `SELECT id
     FROM expense_categories
     WHERE id <> $1
       AND deleted_at IS NULL
       AND (is_global = TRUE OR user_id = $2)
       AND lower(name) = lower($3)
     LIMIT 1`,
    [categoryId, userId, name]
  );
  if (conflict.rows[0]) throw duplicateError('A category with this name already exists');
  await query(
    `UPDATE expense_categories
     SET name = $1,
         icon = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [name, icon, categoryId]
  );
  return getExpenseCategoryLibrary(userId);
}

async function deleteExpenseCategory(userId, categoryId) {
  await ensureExpenseCategoryTables();
  const current = await query(
    `SELECT *
     FROM expense_categories
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [categoryId]
  );
  const row = current.rows[0];
  if (!row) throw validationError('Category not found');
  if (row.is_global || Number(row.user_id) !== Number(userId)) throw validationError('You can delete only your own categories');
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE expense_subcategories
       SET deleted_at = NOW(),
           updated_at = NOW()
       WHERE category_id = $1
         AND deleted_at IS NULL`,
      [categoryId]
    );
    await client.query(
      `UPDATE expense_categories
       SET deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [categoryId]
    );
  });
  return getExpenseCategoryLibrary(userId);
}

async function createExpenseSubcategory(userId, categoryId, data) {
  await ensureExpenseCategoryTables();
  const categoryResult = await query(
    `SELECT *
     FROM expense_categories
     WHERE id = $1
       AND deleted_at IS NULL
       AND (is_global = TRUE OR user_id = $2)
     LIMIT 1`,
    [categoryId, userId]
  );
  const category = categoryResult.rows[0];
  if (!category) throw validationError('Category not found');
  const name = normalizeText(data?.name, 'Subcategory name', 80);
  const existing = await query(
    `SELECT id
     FROM expense_subcategories
     WHERE category_id = $1
       AND (user_id IS NULL OR user_id = $3)
       AND deleted_at IS NULL
       AND lower(name) = lower($2)
     LIMIT 1`,
    [categoryId, name, userId]
  );
  if (existing.rows[0]) throw duplicateError('A subcategory with this name already exists');
  await query(
    `INSERT INTO expense_subcategories (category_id, user_id, name)
     VALUES ($1, $2, $3)`,
    [categoryId, category.is_global ? userId : userId, name]
  );
  return getExpenseCategoryLibrary(userId);
}

async function updateExpenseSubcategory(userId, subcategoryId, data) {
  await ensureExpenseCategoryTables();
  const current = await query(
    `SELECT sc.id,
            sc.category_id,
            sc.user_id AS subcategory_user_id,
            sc.name,
            c.user_id,
            c.is_global
     FROM expense_subcategories sc
     JOIN expense_categories c ON c.id = sc.category_id
     WHERE sc.id = $1
       AND sc.deleted_at IS NULL
       AND c.deleted_at IS NULL
     LIMIT 1`,
    [subcategoryId]
  );
  const row = current.rows[0];
  if (!row) throw validationError('Subcategory not found');
  if (Number(row.subcategory_user_id || 0) !== Number(userId)) throw validationError('You can edit only your own subcategories');
  const name = normalizeText(data?.name, 'Subcategory name', 80);
  const conflict = await query(
    `SELECT id
     FROM expense_subcategories
     WHERE id <> $1
       AND category_id = $2
       AND (user_id IS NULL OR user_id = $4)
       AND deleted_at IS NULL
       AND lower(name) = lower($3)
     LIMIT 1`,
    [subcategoryId, row.category_id, name, userId]
  );
  if (conflict.rows[0]) throw duplicateError('A subcategory with this name already exists');
  await query(
    `UPDATE expense_subcategories
     SET name = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [name, subcategoryId]
  );
  return getExpenseCategoryLibrary(userId);
}

async function deleteExpenseSubcategory(userId, subcategoryId) {
  await ensureExpenseCategoryTables();
  const current = await query(
    `SELECT sc.id,
            c.user_id,
            c.is_global,
            sc.user_id AS subcategory_user_id
     FROM expense_subcategories sc
     JOIN expense_categories c ON c.id = sc.category_id
     WHERE sc.id = $1
       AND sc.deleted_at IS NULL
       AND c.deleted_at IS NULL
     LIMIT 1`,
    [subcategoryId]
  );
  const row = current.rows[0];
  if (!row) throw validationError('Subcategory not found');
  if (Number(row.subcategory_user_id || 0) !== Number(userId)) throw validationError('You can delete only your own subcategories');
  await query(
    `UPDATE expense_subcategories
     SET deleted_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [subcategoryId]
  );
  return getExpenseCategoryLibrary(userId);
}

function liveSplitEnsureLinkedRow(map, linkedUserId, name, extra = {}) {
  const uid = Number(linkedUserId || 0);
  if (!(uid > 0)) return liveSplitEnsureRow(map, name, extra);
  const key = `u:${uid}`;
  if (!map.has(key)) {
    map.set(key, { key, name: String(name || '').trim(), amount: 0, linked_user_id: uid, friend_id: null, ...extra });
  }
  const row = map.get(key);
  if (!row.name && name) row.name = String(name).trim();
  if (!row.friend_id && extra.friend_id) row.friend_id = Number(extra.friend_id) || null;
  return row;
}

function liveSplitFindExistingLinkedRowByUserId(map, linkedUserId) {
  const uid = Number(linkedUserId || 0);
  if (!(uid > 0)) return null;
  return map.get(`u:${uid}`) || null;
}

function liveSplitFindExistingLinkedRowByName(map, name) {
  const key = liveSplitNormalizePersonName(name);
  if (!key) return null;
  for (const row of map.values()) {
    const rowKey = liveSplitNormalizePersonName(row?.name);
    if (!rowKey) continue;
    if (rowKey === key) return row;
    if (liveSplitFirstNameToken(rowKey) && liveSplitFirstNameToken(rowKey) === liveSplitFirstNameToken(key)) return row;
  }
  return null;
}

function liveSplitFindLinkedFriendByName(friends = [], friendName = '') {
  const nameKey = liveSplitNormalizePersonName(friendName);
  if (!nameKey) return null;
  const token = liveSplitFirstNameToken(nameKey);
  return friends.find((friend) => {
    const friendKey = liveSplitNormalizePersonName(
      friend?.linked_user_display_name || friend?.linked_user_username || friend?.name || ''
    );
    return friendKey === nameKey || (token && liveSplitFirstNameToken(friendKey) === token);
  }) || null;
}

function liveSplitIsLikelySelfPayerForOwnGroup(payer, splits = []) {
  const payerKey = liveSplitTextKey(payer);
  if (!payerKey) return false;
  if (payerKey === 'you') return true;
  const hasMatchInParticipants = (splits || []).some((split) => liveSplitTextKey(split?.friend_name) === payerKey);
  return !hasMatchInParticipants;
}

function computeLiveSplitDashboardSummary(userId, friends = [], groups = [], sharedGroups = []) {
  const meId = Number(userId || 0);
  const appFriends = (friends || []).filter((friend) => {
    const linkedId = Number(friend?.linked_user_id || 0);
    return linkedId > 0 && linkedId !== meId;
  });
  const friendById = new Map((friends || []).map((friend) => [Number(friend.id), friend]));
  const map = new Map();

  appFriends.forEach((friend) => {
    const linkedUserId = Number(friend?.linked_user_id || 0);
    const preferredName = String(friend?.linked_user_display_name || friend?.linked_user_username || friend?.name || '').trim();
    if (linkedUserId > 0) liveSplitEnsureLinkedRow(map, linkedUserId, preferredName, { friend_id: Number(friend.id) || null });
    else liveSplitEnsureRow(map, friend?.name || preferredName, { linked_user_id: linkedUserId || null, friend_id: Number(friend.id) || null });
  });

  (groups || []).forEach((group) => {
    const splits = Array.isArray(group?.splits) ? group.splits : [];
    const groupMode = String(group?.split_mode || '').trim().toLowerCase();
    const shareTargetByFriendId = new Map(
      (Array.isArray(group?.shared_targets) ? group.shared_targets : []).map((item) => [Number(item?.friend_id), Number(item?.target_user_id)])
    );
    const total = r2(group?.total_amount);
    const totalFriends = r2(splits.reduce((sum, split) => sum + num(split.share_amount), 0));
    const selfShare = r2(total - totalFriends);
    const payerName = String(group?.paid_by || '').trim();
    const payerNameKey = liveSplitTextKey(payerName);
    const selfIsPayer = liveSplitIsLikelySelfPayerForOwnGroup(payerName, splits);

    splits.forEach((split) => {
      const friendName = String(split?.friend_name || '').trim();
      const friendNameKey = liveSplitTextKey(friendName);
      const linkedFriend = friendById.get(Number(split?.friend_id));
      const linkedFriendLinkedUserId = Number(linkedFriend?.linked_user_id || 0);
      const shareTargetLinkedUserId = Number(shareTargetByFriendId.get(Number(split?.friend_id)) || 0);
      const splitLinkedUserIdRaw = Number(split?.linked_user_id || 0);
      const normalizedLinkedFriendUserId = linkedFriendLinkedUserId === meId ? 0 : linkedFriendLinkedUserId;
      let splitLinkedUserId = splitLinkedUserIdRaw;
      if (splitLinkedUserId === meId && shareTargetLinkedUserId > 0 && shareTargetLinkedUserId !== meId) {
        splitLinkedUserId = shareTargetLinkedUserId;
      }
      if (splitLinkedUserId === meId) splitLinkedUserId = 0;
      const linkedByUser = splitLinkedUserId > 0 ? liveSplitFindExistingLinkedRowByUserId(map, splitLinkedUserId) : null;
      let fallbackFriendByUser = splitLinkedUserId > 0
        ? appFriends.find((friend) => Number(friend?.linked_user_id) === splitLinkedUserId) || null
        : null;
      if (!fallbackFriendByUser) fallbackFriendByUser = liveSplitFindLinkedFriendByName(appFriends, friendName);
      if (!linkedFriend && !fallbackFriendByUser && !linkedByUser) return;
      const preferredLinkedName = String(
        linkedFriend?.linked_user_display_name
        || linkedFriend?.linked_user_username
        || fallbackFriendByUser?.linked_user_display_name
        || fallbackFriendByUser?.linked_user_username
        || linkedByUser?.name
        || friendName
        || fallbackFriendByUser?.name
        || ''
      ).trim();
      const row = (linkedFriend && normalizedLinkedFriendUserId > 0)
        ? liveSplitEnsureLinkedRow(map, normalizedLinkedFriendUserId, preferredLinkedName, { friend_id: Number(linkedFriend.id) || null })
        : linkedByUser
          || (fallbackFriendByUser
            ? liveSplitEnsureLinkedRow(map, splitLinkedUserId, preferredLinkedName, { friend_id: Number(fallbackFriendByUser?.id) || null })
            : liveSplitFindExistingLinkedRowByName(map, friendName));
      if (!row) return;
      const rowNameKey = liveSplitTextKey(row?.name || '');
      const linkedFriendNameKey = liveSplitTextKey(linkedFriend?.name || '');
      const fallbackNameKey = liveSplitTextKey(fallbackFriendByUser?.name || '');
      const splitIsPayer = !!payerNameKey && (
        payerNameKey === friendNameKey
        || (rowNameKey && payerNameKey === rowNameKey)
        || (linkedFriendNameKey && payerNameKey === linkedFriendNameKey)
        || (fallbackNameKey && payerNameKey === fallbackNameKey)
      );
      if (groupMode === 'settlement') {
        if (selfIsPayer) row.amount = r2(row.amount + num(split.share_amount));
        else if (splitIsPayer) row.amount = r2(row.amount - num(split.share_amount));
        return;
      }
      if (selfIsPayer) row.amount = r2(row.amount + num(split.share_amount));
      else if (splitIsPayer && selfShare > 0) row.amount = r2(row.amount - selfShare);
    });
  });

  (sharedGroups || []).forEach((group) => {
    const splits = Array.isArray(group?.splits) ? group.splits : [];
    const groupMode = String(group?.split_mode || '').trim().toLowerCase();
    const total = r2(group?.total_amount);
    const ownerName = String(group?.owner_name || 'Owner').trim() || 'Owner';
    const ownerUserId = Number(group?.owner_user_id || 0);
    const targetUserId = Number(group?.target_user_id || meId || 0);
    const sumSplit = r2(splits.reduce((sum, split) => sum + num(split.share_amount), 0));
    const ownerShare = r2(total - sumSplit);
    const participants = [
      {
        key: `owner:${ownerUserId || liveSplitTextKey(ownerName)}`,
        name: ownerName,
        share: ownerShare,
        linked_user_id: ownerUserId > 0 ? ownerUserId : null,
        friend_id: null,
      },
      ...splits.map((split, index) => ({
        key: `split:${Number(split?.id || 0) || index + 1}`,
        name: String(split?.friend_name || '').trim(),
        share: r2(split?.share_amount),
        linked_user_id: Number(split?.linked_user_id || 0) || null,
        friend_id: Number(split?.friend_id || 0) || null,
      })),
    ].filter((participant) => participant.name);
    if (!participants.length) return;

    const targetNameNorm = liveSplitNormalizePersonName(group?.friend_name || '');
    let selfParticipant = null;
    if (targetUserId > 0) selfParticipant = participants.find((participant) => Number(participant?.linked_user_id || 0) === targetUserId) || null;
    if (!selfParticipant && Number(group?.friend_id || 0) > 0) {
      selfParticipant = participants.find((participant) => Number(participant?.friend_id || 0) === Number(group.friend_id)) || null;
    }
    if (!selfParticipant && targetNameNorm) {
      selfParticipant = participants.find((participant) => {
        const nameNorm = liveSplitNormalizePersonName(participant?.name || '');
        return nameNorm && (nameNorm === targetNameNorm || (liveSplitFirstNameToken(nameNorm) && liveSplitFirstNameToken(nameNorm) === liveSplitFirstNameToken(targetNameNorm)));
      }) || null;
    }
    if (!selfParticipant && targetUserId > 0 && ownerUserId > 0 && ownerUserId === targetUserId) selfParticipant = participants[0];
    if (!selfParticipant) return;

    const payerRaw = String(group?.paid_by || '').trim();
    const payer = liveSplitTextKey(payerRaw) === 'you' ? ownerName : payerRaw;
    const payerNorm = liveSplitNormalizePersonName(payer);
    const payerParticipant = participants.find((participant) => {
      const nameNorm = liveSplitNormalizePersonName(participant?.name || '');
      return nameNorm && payerNorm && (nameNorm === payerNorm || (liveSplitFirstNameToken(nameNorm) && liveSplitFirstNameToken(nameNorm) === liveSplitFirstNameToken(payerNorm)));
    }) || null;
    const selfShare = r2(selfParticipant.share);
    const selfIsPayer = !!(payerParticipant && payerParticipant.key === selfParticipant.key);

    participants.forEach((participant) => {
      if (participant.key === selfParticipant.key) return;
      const participantLinkedId = Number(participant?.linked_user_id || 0);
      if (participantLinkedId > 0 && participantLinkedId === targetUserId) return;
      if (!(participantLinkedId > 0)) return;
      const linkedFriend = (friends || []).find((friend) => Number(friend?.linked_user_id || 0) === participantLinkedId) || null;
      if (!linkedFriend) return;
      const preferredName = String(
        linkedFriend?.linked_user_display_name
        || linkedFriend?.linked_user_username
        || participant?.name
        || linkedFriend?.name
        || ''
      ).trim();
      const row = liveSplitEnsureLinkedRow(map, participantLinkedId, preferredName, {
        friend_id: Number(linkedFriend?.id || participant?.friend_id || 0) || null,
      });
      if (!row || Number(row?.linked_user_id || 0) === meId) return;

      let delta = 0;
      if (groupMode === 'settlement') {
        if (selfIsPayer && selfShare > 0) delta = selfShare;
        else if (payerParticipant && payerParticipant.key === participant.key && selfShare > 0) delta = r2(0 - selfShare);
      } else {
        if (selfIsPayer) delta = r2(participant.share);
        else if (payerParticipant && payerParticipant.key === participant.key && selfShare > 0) delta = r2(0 - selfShare);
      }
      if (delta !== 0) row.amount = r2(row.amount + delta);
    });
  });

  const rows = [...map.values()]
    .map((row) => ({ ...row, amount: r2(row.amount) }))
    .filter((row) => Number(row?.linked_user_id || 0) > 0 && Number(row?.linked_user_id || 0) !== meId)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || String(a.name || '').localeCompare(String(b.name || '')));

  return {
    rows,
    totals: {
      oweToMe: r2(rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0)),
      iOwe: r2(rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0)),
      owedCount: rows.filter((row) => row.amount > 0.004).length,
      oweCount: rows.filter((row) => row.amount < -0.004).length,
    },
  };
}

async function reconcileLiveSplitLinksForOwner(ownerUserId, targetUserId = null) {
  const ownerId = Number(ownerUserId);
  if (!(ownerId > 0)) return;
  const targetId = targetUserId != null ? Number(targetUserId) : null;
  const inviteParams = [ownerId];
  let targetFilterSql = '';
  if (targetId && targetId > 0) {
    inviteParams.push(targetId);
    targetFilterSql = ` AND i.target_user_id = $${inviteParams.length}`;
  }

  const acceptedInvitesR = await query(
    `SELECT DISTINCT ON (i.target_user_id)
        i.target_user_id,
        i.target_name,
        u.display_name AS target_display_name,
        u.username AS target_username,
        u.email AS target_email
     FROM live_split_invites i
     LEFT JOIN users u ON u.id = i.target_user_id
     WHERE i.inviter_user_id = $1
       AND i.status = 'accepted'
       AND i.target_user_id IS NOT NULL
       ${targetFilterSql}
     ORDER BY i.target_user_id, i.id DESC`,
    inviteParams
  );

  for (const inviteRow of (acceptedInvitesR.rows || [])) {
    const linkedUserId = Number(inviteRow?.target_user_id || 0);
    if (!(linkedUserId > 0)) continue;
    const { normalized, firstTokens } = buildLiveSplitNameCandidates(inviteRow);
    if (!normalized.length) continue;
    await query(
      `UPDATE live_split_friends f
       SET linked_user_id = $1, updated_at = NOW(), updated_by = $2
       WHERE f.user_id = $2
         AND f.deleted_at IS NULL
         AND f.linked_user_id IS NULL
         AND (
           regexp_replace(lower(trim(COALESCE(f.name, ''))), '[^a-z0-9 ]', ' ', 'g') = ANY($3::text[])
           OR split_part(regexp_replace(lower(trim(COALESCE(f.name, ''))), '[^a-z0-9 ]', ' ', 'g'), ' ', 1) = ANY($4::text[])
           OR EXISTS (
             SELECT 1
             FROM live_split_splits s
             JOIN live_split_groups g ON g.id = s.group_id
             WHERE g.user_id = $2
               AND s.friend_id = f.id
               AND (
                 regexp_replace(lower(trim(COALESCE(s.friend_name, ''))), '[^a-z0-9 ]', ' ', 'g') = ANY($3::text[])
                 OR split_part(regexp_replace(lower(trim(COALESCE(s.friend_name, ''))), '[^a-z0-9 ]', ' ', 'g'), ' ', 1) = ANY($4::text[])
               )
           )
         )`,
      [linkedUserId, ownerId, normalized, firstTokens]
    );
  }
}

async function canonicalizeLiveSplitFriendRowsForOwner(ownerUserId) {
  const ownerId = Number(ownerUserId);
  if (!(ownerId > 0)) return;

  // Self-link should never exist; drop it so owner does not appear as a peer.
  await query(
    `UPDATE live_split_friends
     SET linked_user_id = NULL, updated_at = NOW(), updated_by = $1
     WHERE user_id = $1
       AND deleted_at IS NULL
       AND linked_user_id = $1`,
    [ownerId]
  );

  // Canonicalize duplicate friend rows that point to the same linked user.
  // Prefer row whose name matches linked user's display/username, otherwise lowest id.
  await query(
    `WITH ranked AS (
       SELECT
         f.id,
         f.name,
         f.deleted_at,
         f.linked_user_id,
         FIRST_VALUE(f.id) OVER (
           PARTITION BY f.linked_user_id
           ORDER BY
             CASE
               WHEN f.deleted_at IS NULL THEN 0 ELSE 1
             END,
             CASE
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.display_name, ''))) THEN 0
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.username, ''))) THEN 1
               ELSE 2
             END,
             f.id
         ) AS canonical_id,
         FIRST_VALUE(f.name) OVER (
           PARTITION BY f.linked_user_id
           ORDER BY
             CASE
               WHEN f.deleted_at IS NULL THEN 0 ELSE 1
             END,
             CASE
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.display_name, ''))) THEN 0
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.username, ''))) THEN 1
               ELSE 2
             END,
             f.id
         ) AS canonical_name
       FROM live_split_friends f
       LEFT JOIN users u ON u.id = f.linked_user_id
       WHERE f.user_id = $1
         AND f.linked_user_id IS NOT NULL
         AND f.linked_user_id <> $1
     )
     UPDATE live_split_splits s
     SET friend_id = r.canonical_id,
         friend_name = COALESCE(NULLIF(trim(r.canonical_name), ''), s.friend_name)
     FROM ranked r, live_split_groups g
     WHERE g.user_id = $1
       AND g.id = s.group_id
       AND s.friend_id = r.id
       AND r.canonical_id <> r.id`,
    [ownerId]
  );

  await query(
    `WITH ranked AS (
       SELECT
         f.id,
         f.deleted_at,
         f.linked_user_id,
         FIRST_VALUE(f.id) OVER (
           PARTITION BY f.linked_user_id
           ORDER BY
             CASE
               WHEN f.deleted_at IS NULL THEN 0 ELSE 1
             END,
             CASE
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.display_name, ''))) THEN 0
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.username, ''))) THEN 1
               ELSE 2
             END,
             f.id
        ) AS canonical_id
       FROM live_split_friends f
       LEFT JOIN users u ON u.id = f.linked_user_id
       WHERE f.user_id = $1
         AND f.linked_user_id IS NOT NULL
         AND f.linked_user_id <> $1
     )
     UPDATE live_split_group_shares gs
     SET friend_id = r.canonical_id,
         updated_at = NOW()
     FROM ranked r
     WHERE gs.owner_user_id = $1
       AND gs.friend_id = r.id
       AND r.canonical_id <> r.id`,
    [ownerId]
  );

  await query(
    `WITH ranked AS (
       SELECT
         f.id,
         f.deleted_at,
         f.linked_user_id,
         FIRST_VALUE(f.id) OVER (
           PARTITION BY f.linked_user_id
           ORDER BY
             CASE
               WHEN f.deleted_at IS NULL THEN 0 ELSE 1
             END,
             CASE
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.display_name, ''))) THEN 0
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.username, ''))) THEN 1
               ELSE 2
             END,
             f.id
         ) AS canonical_id
       FROM live_split_friends f
       LEFT JOIN users u ON u.id = f.linked_user_id
       WHERE f.user_id = $1
         AND f.linked_user_id IS NOT NULL
         AND f.linked_user_id <> $1
     )
     UPDATE live_split_trip_members tm
     SET friend_id = r.canonical_id
     FROM ranked r, live_split_trips t
     WHERE t.user_id = $1
       AND t.id = tm.trip_id
       AND tm.friend_id = r.id
       AND r.canonical_id <> r.id`,
    [ownerId]
  );

  await query(
    `WITH ranked AS (
       SELECT
         f.id,
         f.deleted_at,
         f.linked_user_id,
         FIRST_VALUE(f.id) OVER (
           PARTITION BY f.linked_user_id
           ORDER BY
             CASE
               WHEN f.deleted_at IS NULL THEN 0 ELSE 1
             END,
             CASE
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.display_name, ''))) THEN 0
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.username, ''))) THEN 1
               ELSE 2
             END,
             f.id
         ) AS canonical_id
       FROM live_split_friends f
       LEFT JOIN users u ON u.id = f.linked_user_id
       WHERE f.user_id = $1
         AND f.linked_user_id IS NOT NULL
         AND f.linked_user_id <> $1
     )
     UPDATE live_split_friend_activity a
     SET friend_id = r.canonical_id
     FROM ranked r
     WHERE a.owner_user_id = $1
       AND a.friend_id = r.id
       AND r.canonical_id <> r.id`,
    [ownerId]
  );
}

async function adjustBankBalance(userId, bankAccountId, delta, client = null) {
  const normalizedId = normalizeBankAccountId(bankAccountId);
  const amount = Number(delta || 0);
  if (!normalizedId || !amount) return;
  const run = client || { query };
  await run.query(
    `UPDATE bank_accounts
     SET balance = balance + $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3 AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL`,
    [amount, normalizedId, userId]
  );
}

function yearGuardSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `EXTRACT(YEAR FROM ${prefix}purchase_date)::int BETWEEN 2018 AND ${new Date().getFullYear() + 2}`;
}

function normalizeTripMemberKeyValue(value) {
  const key = String(value || '').trim();
  if (!key) return key;
  const memberMatch = key.match(/^m(.+)$/);
  if (memberMatch) return String(memberMatch[1]);
  const friendMatch = key.match(/^friend_(.+)$/);
  if (friendMatch) return String(friendMatch[1]);
  const userMatch = key.match(/^user_(.+)$/);
  if (userMatch) return `u${userMatch[1]}`;
  return key;
}

function normalizeTripSplitModeValue(value) {
  const mode = String(value || 'equal').trim().toLowerCase();
  if (!mode) return 'equal';
  if (mode === 'direct' || mode === 'direct_rs' || mode === 'direct_rupee' || mode === 'direct_inr') return 'amount';
  if (mode === 'parts_ratio' || mode === 'ratio' || mode === 'partsratio') return 'parts';
  if (mode === 'percentage') return 'percent';
  return mode;
}

function _finalizeSplitAmounts(amount, rows = []) {
  const normalizedAmount = Math.round(num(amount) * 100) / 100;
  const rounded = rows.map((row) => ({
    ...row,
    share_amount: Math.round(num(row.share_amount) * 100) / 100,
  }));
  if (!rounded.length) return rounded;
  const total = Math.round(rounded.reduce((sum, row) => sum + num(row.share_amount), 0) * 100) / 100;
  const diff = Math.round((normalizedAmount - total) * 100) / 100;
  rounded[0].share_amount = Math.round((num(rounded[0].share_amount) + diff) * 100) / 100;
  return rounded;
}

function _computeBulkTripShares(amount, mode, members, values = {}) {
  const amt = Math.round(num(amount) * 100) / 100;
  if (!Array.isArray(members) || !members.length) throw validationError('Select at least one member');
  if (mode === 'amount') throw validationError('Bulk share update does not support Direct Rs. Use Equal, Percent, Fraction, or Parts/Ratio.');
  if (mode === 'equal') {
    const base = Math.floor((amt / members.length) * 100) / 100;
    return _finalizeSplitAmounts(amt, members.map((member) => ({
      member_key: member.member_key,
      member_name: member.member_name,
      share_amount: base,
    })));
  }
  if (mode === 'percent') {
    const total = members.reduce((sum, member) => sum + num(values[member.member_key]), 0);
    if (Math.abs(total - 100) > 0.01) throw validationError(`Percent total must be 100. Current total is ${total.toFixed(2)}.`);
    return _finalizeSplitAmounts(amt, members.map((member) => ({
      member_key: member.member_key,
      member_name: member.member_name,
      share_amount: amt * (num(values[member.member_key]) / 100),
    })));
  }
  if (mode === 'fraction') {
    const total = members.reduce((sum, member) => sum + num(values[member.member_key]), 0);
    if (Math.abs(total - 1) > 0.001) throw validationError(`Fractions must total 1.0. Current total is ${total.toFixed(4)}.`);
    return _finalizeSplitAmounts(amt, members.map((member) => ({
      member_key: member.member_key,
      member_name: member.member_name,
      share_amount: amt * num(values[member.member_key]),
    })));
  }
  if (mode === 'parts') {
    const totalParts = members.reduce((sum, member) => sum + num(values[member.member_key]), 0);
    if (totalParts <= 0) throw validationError('Parts total must be greater than 0');
    return _finalizeSplitAmounts(amt, members.map((member) => ({
      member_key: member.member_key,
      member_name: member.member_name,
      share_amount: amt * (num(values[member.member_key]) / totalParts),
    })));
  }
  throw validationError('Unsupported split mode');
}

async function _loadNormalizedTripExpenses(client, tripId) {
  const expensesR = await client.query('SELECT * FROM trip_expenses WHERE trip_id = $1 ORDER BY expense_date DESC, id DESC', [tripId]);
  const expenses = [];
  for (const expense of expensesR.rows) {
    const splitsR = await client.query('SELECT * FROM trip_expense_splits WHERE expense_id = $1', [expense.id]);
    expenses.push({
      ...expense,
      amount: num(expense.amount),
      paid_by_key: normalizeTripMemberKeyValue(expense.paid_by_key),
      split_mode: normalizeTripSplitModeValue(expense.split_mode),
      splits: splitsR.rows.map((split) => ({
        ...split,
        member_key: normalizeTripMemberKeyValue(split.member_key),
        share_amount: num(split.share_amount),
      })),
    });
  }
  return expenses;
}

async function getExpenses(userId, filters = {}) {
  const params = [userId];
  let where = [`user_id = $1`, yearGuardSql()];

  if (filters.year) {
    params.push(String(filters.year));
    where.push(`to_char(purchase_date, 'YYYY') = $${params.length}`);
  }
  if (filters.month) {
    params.push(String(filters.month).padStart(2, '0'));
    where.push(`to_char(purchase_date, 'MM') = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(`(item_name ILIKE $${params.length} OR COALESCE(category, '') ILIKE $${params.length} OR COALESCE(subcategory, '') ILIKE $${params.length})`);
  }
  if (filters.spendType === 'extra') where.push('is_extra = TRUE');
  if (filters.spendType === 'fair') where.push('is_extra = FALSE');

  const result = await query(
    `SELECT *
     FROM expenses
     WHERE ${where.join(' AND ')} AND deleted_at IS NULL
     ORDER BY purchase_date DESC, id DESC`,
    params
  );
  return result.rows.map((row) => ({ ...row, amount: num(row.amount) }));
}

async function getExpenseById(userId, id, client = null) {
  const run = client || { query };
  const result = await run.query(
    `SELECT *
     FROM expenses
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [id, userId]
  );
  const row = result.rows[0];
  return row ? { ...row, amount: num(row.amount) } : null;
}

async function getExpenseCategories(userId) {
  const library = await getExpenseCategoryLibrary(userId);
  return library.categories;
}

async function addExpense(userId, data) {
  const executor = async (client) => {
    const itemName = normalizeText(data.item_name, 'Expense name', 160);
    const category = normalizeOptionalText(data.category, 80);
    const subcategory = normalizeOptionalText(data.subcategory, 80);
    const amount = normalizeAmount(data.amount);
    const purchaseDate = normalizeDateValue(data.purchase_date, 'Purchase date');
    const bankAccountId = normalizeBankAccountId(data.bank_account_id);
    const result = await client.query(
      `INSERT INTO expenses (user_id, item_name, category, subcategory, amount, purchase_date, is_extra, bank_account_id, source, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [userId, itemName, category, subcategory, amount, purchaseDate, !!data.is_extra, bankAccountId, data.source || null, data.source_id || null]
    );
    if (bankAccountId) {
      await adjustBankBalance(userId, bankAccountId, -Math.abs(amount), client);
    }
    return Number(result.rows[0].id);
  };
  const client = arguments[2] || null;
  return client ? executor(client) : withTransaction(executor);
}

async function updateExpense(userId, id, data) {
  const executor = async (client) => {
    const current = await getExpenseById(userId, id, client);
    if (!current) throw validationError('Expense not found');
    const itemName = normalizeText(data.item_name, 'Expense name', 160);
    const category = normalizeOptionalText(data.category, 80);
    const subcategory = normalizeOptionalText(data.subcategory, 80);
    const nextAmount = normalizeAmount(data.amount);
    const purchaseDate = normalizeDateValue(data.purchase_date, 'Purchase date');
    const nextBankAccountId = normalizeBankAccountId(data.bank_account_id);
    const prevBankAccountId = normalizeBankAccountId(current.bank_account_id);
    const prevAmount = Math.abs(num(current.amount));
    if (prevBankAccountId) await adjustBankBalance(userId, prevBankAccountId, prevAmount, client);
    if (nextBankAccountId) await adjustBankBalance(userId, nextBankAccountId, -nextAmount, client);
    await client.query(
      `UPDATE expenses
       SET item_name = $1,
           category = $2,
           subcategory = $3,
           amount = $4,
           purchase_date = $5,
           is_extra = $6,
           bank_account_id = $7,
           source = COALESCE($8, source),
           source_id = COALESCE($9, source_id),
           updated_at = NOW()
       WHERE id = $10 AND user_id = $11`,
      [itemName, category, subcategory, nextAmount, purchaseDate, !!data.is_extra, nextBankAccountId, data.source || null, data.source_id || null, id, userId]
    );
  };
  const client = arguments[3] || null;
  return client ? executor(client) : withTransaction(executor);
}

async function deleteExpense(userId, id) {
  const executor = async (client) => {
    const current = await getExpenseById(userId, id, client);
    if (!current) return;
    if (normalizeBankAccountId(current.bank_account_id)) {
      await adjustBankBalance(userId, current.bank_account_id, Math.abs(num(current.amount)), client);
    }
    await client.query(
      `UPDATE expenses
       SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW(), updated_by = $1
       WHERE id = $2 AND user_id = $1`,
      [userId, id]
    );
  };
  const client = arguments[2] || null;
  return client ? executor(client) : withTransaction(executor);
}

async function bulkAddExpenses(userId, rows) {
  return withTransaction(async (client) => {
    let count = 0;
    for (const row of rows) {
     if (row.item_name && row.amount > 0) {
        const category = normalizeOptionalText(row.category, 80);
        const subcategory = normalizeOptionalText(row.subcategory, 80);
        await client.query(
          `INSERT INTO expenses (user_id, item_name, category, subcategory, amount, purchase_date, is_extra, bank_account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [userId, row.item_name, category, subcategory, row.amount, row.purchase_date, !!row.is_extra, normalizeBankAccountId(row.bank_account_id)]
        );
        count++;
      }
    }
    return count;
  });
}

async function getFriends(userId) {
  const result = await query(
    `SELECT
       f.*,
       u.display_name AS linked_user_display_name,
       u.username AS linked_user_username,
       COALESCE(SUM(lt.paid - lt.received), 0) AS balance
     FROM friends f
     LEFT JOIN users u
       ON u.id = f.linked_user_id
      AND u.deleted_at IS NULL
     LEFT JOIN loan_transactions lt
       ON lt.friend_id = f.id
      AND lt.user_id = $1
      AND lt.deleted_at IS NULL
     WHERE f.user_id = $1 AND f.deleted_at IS NULL
     GROUP BY f.id, u.display_name, u.username
     ORDER BY f.name`,
    [userId]
  );
  return result.rows.map((row) => ({
    ...row,
    linked_user_id: row.linked_user_id ? Number(row.linked_user_id) : null,
    balance: Math.round(num(row.balance) * 100) / 100,
  }));
}

async function addFriend(userId, name) {
  const safeName = validateFriendName(name);
  const result = await query(
    `INSERT INTO friends (user_id, name)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, safeName]
  );
  return Number(result.rows[0].id);
}

async function updateFriend(userId, id, name) {
  const safeName = validateFriendName(name);
  await query('UPDATE friends SET name = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND user_id = $2 AND deleted_at IS NULL', [safeName, userId, id]);
}

async function linkFriendToUser(userId, friendId, linkedUserId = null) {
  const friendR = await query(
    'SELECT id FROM friends WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1',
    [friendId, userId]
  );
  if (!friendR.rows[0]) throw new Error('Friend not found');
  let targetUserId = linkedUserId != null ? Number(linkedUserId) : null;
  if (targetUserId != null) {
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) throw validationError('Linked user is invalid');
    if (targetUserId === Number(userId)) throw validationError('You cannot link a friend to your own account');
    const userR = await query(
      'SELECT id FROM users WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL LIMIT 1',
      [targetUserId]
    );
    if (!userR.rows[0]) throw validationError('Linked user not found');
    const conflictR = await query(
      `SELECT f.id, f.name
       FROM friends f
       WHERE f.linked_user_id = $1
         AND f.deleted_at IS NULL
         AND f.id <> $2
       LIMIT 1`,
      [targetUserId, friendId]
    );
    if (conflictR.rows[0]) {
      throw validationError(`This app user is already linked to friend "${conflictR.rows[0].name}". Unlink it first.`);
    }
  } else {
    targetUserId = null;
  }
  await query(
    'UPDATE friends SET linked_user_id = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND user_id = $2',
    [targetUserId, userId, friendId]
  );
}

async function deleteFriend(userId, id) {
  await query(
    `UPDATE friends
     SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW(), updated_by = $1, is_active = FALSE
     WHERE id = $2 AND user_id = $1`,
    [userId, id]
  );
}

async function getLiveSplitFriends(userId) {
  try {
    await canonicalizeLiveSplitFriendRowsForOwner(Number(userId));
  } catch (err) {
    if (!isMissingLiveSplitFriendColumnError(err)) throw err;
  }
  let result;
  try {
    result = await query(
      `SELECT
         f.*,
         u.display_name AS linked_user_display_name,
         u.username AS linked_user_username,
         u.avatar_url AS linked_user_avatar_url
       FROM live_split_friends f
       LEFT JOIN users u
         ON u.id = f.linked_user_id
        AND u.deleted_at IS NULL
       WHERE f.user_id = $1 AND f.deleted_at IS NULL
       ORDER BY f.name`,
      [userId]
    );
  } catch (err) {
    if (!isMissingLiveSplitFriendColumnError(err)) throw err;
    result = await query(
      `SELECT
         f.id,
         f.user_id,
         f.name,
         f.linked_user_id,
         NULL::text AS linked_user_display_name,
         NULL::text AS linked_user_username,
         NULL::text AS linked_user_avatar_url
       FROM live_split_friends f
       WHERE f.user_id = $1
       ORDER BY f.name`,
      [userId]
    );
  }
  return result.rows.map((row) => ({
    ...row,
    linked_user_id: row.linked_user_id ? Number(row.linked_user_id) : null,
  }));
}

async function addLiveSplitFriend(userId, name) {
  const safeName = validateFriendName(name);
  return withTransaction(async (client) => {
    const activeR = await client.query(
      `SELECT id
       FROM live_split_friends
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND lower(trim(name)) = lower(trim($2))
       ORDER BY id ASC
       LIMIT 1`,
      [userId, safeName]
    );
    if (activeR.rows[0]?.id) {
      await reconcileLiveSplitLinksForOwner(Number(userId));
      await canonicalizeLiveSplitFriendRowsForOwner(Number(userId));
      return Number(activeR.rows[0].id);
    }

    const deletedR = await client.query(
      `SELECT id
       FROM live_split_friends
       WHERE user_id = $1
         AND deleted_at IS NOT NULL
         AND lower(trim(name)) = lower(trim($2))
       ORDER BY
         CASE WHEN linked_user_id IS NOT NULL THEN 0 ELSE 1 END,
         id ASC
       LIMIT 1`,
      [userId, safeName]
    );
    if (deletedR.rows[0]?.id) {
      await client.query(
        `UPDATE live_split_friends
         SET name = $1,
             deleted_at = NULL,
             deleted_by = NULL,
             is_active = TRUE,
             updated_at = NOW(),
             updated_by = $2
         WHERE id = $3
           AND user_id = $2`,
        [safeName, userId, Number(deletedR.rows[0].id)]
      );
      await reconcileLiveSplitLinksForOwner(Number(userId));
      await canonicalizeLiveSplitFriendRowsForOwner(Number(userId));
      return Number(deletedR.rows[0].id);
    }

    const result = await client.query(
      `INSERT INTO live_split_friends (user_id, name)
       VALUES ($1, $2)
       RETURNING id`,
      [userId, safeName]
    );
    await reconcileLiveSplitLinksForOwner(Number(userId));
    await canonicalizeLiveSplitFriendRowsForOwner(Number(userId));
    return Number(result.rows[0].id);
  });
}

async function updateLiveSplitFriend(userId, id, name) {
  const safeName = validateFriendName(name);
  await query(
    'UPDATE live_split_friends SET name = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND user_id = $2 AND deleted_at IS NULL',
    [safeName, userId, id]
  );
}

async function linkLiveSplitFriendToUser(userId, friendId, linkedUserId = null) {
  const friendR = await query(
    'SELECT id FROM live_split_friends WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1',
    [friendId, userId]
  );
  if (!friendR.rows[0]) throw new Error('Live split friend not found');
  let targetUserId = linkedUserId != null ? Number(linkedUserId) : null;
  if (targetUserId != null) {
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) throw validationError('Linked user is invalid');
    if (targetUserId === Number(userId)) throw validationError('You cannot link yourself');
    const userR = await query(
      'SELECT id FROM users WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL LIMIT 1',
      [targetUserId]
    );
    if (!userR.rows[0]) throw validationError('Linked user not found');
    const conflictR = await query(
      `SELECT f.id, f.name
       FROM live_split_friends f
       WHERE f.linked_user_id = $1
         AND f.user_id = $3
         AND f.deleted_at IS NULL
         AND f.id <> $2
       LIMIT 1`,
      [targetUserId, friendId, userId]
    );
    if (conflictR.rows[0]) {
      throw validationError(`This app user is already linked to Live Split user "${conflictR.rows[0].name}". Unlink first.`);
    }
  } else {
    targetUserId = null;
  }
  await query(
    'UPDATE live_split_friends SET linked_user_id = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND user_id = $2',
    [targetUserId, userId, friendId]
  );
  await canonicalizeLiveSplitFriendRowsForOwner(Number(userId));
}

async function deleteLiveSplitFriend(userId, id) {
  await query(
    `UPDATE live_split_friends
     SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW(), updated_by = $1, is_active = FALSE
     WHERE id = $2 AND user_id = $1`,
    [userId, id]
  );
}

function normalizeLiveSplitTripStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return ['active', 'completed'].includes(normalized) ? normalized : 'active';
}

function normalizeLiveSplitTripPermission(permission) {
  const normalized = String(permission || '').trim().toLowerCase();
  return ['owner', 'edit', 'view'].includes(normalized) ? normalized : 'edit';
}

async function getLiveSplitTripAccessRow(client, userId, tripId) {
  const uid = Number(userId);
  const tid = Number(tripId);
  if (!(uid > 0) || !(tid > 0)) return null;
  const result = await client.query(
    `SELECT t.*,
            CASE WHEN t.user_id = $1 THEN TRUE ELSE FALSE END AS is_owner
     FROM live_split_trips t
     WHERE t.id = $2
       AND (
         t.user_id = $1
         OR EXISTS (
           SELECT 1
           FROM live_split_trip_members m
           WHERE m.trip_id = t.id
             AND m.target_user_id = $1
         )
       )
     LIMIT 1`,
    [uid, tid]
  );
  return result.rows[0] || null;
}

async function normalizeLiveSplitTripMembersForOwner(client, ownerUserId, members = []) {
  const normalized = [];
  const seen = new Set();
  for (const member of (members || [])) {
    const requestedFriendId = Number(member?.friend_id || 0);
    const requestedTargetUserId = Number(member?.target_user_id || member?.linked_user_id || 0);
    const requestedName = String(member?.member_name || member?.name || '').trim();
    const permission = normalizeLiveSplitTripPermission(member?.permission);

    let friendRow = null;
    if (requestedFriendId > 0) {
      const friendResult = await client.query(
        `SELECT id, name, linked_user_id
         FROM live_split_friends
         WHERE user_id = $1
           AND id = $2
           AND deleted_at IS NULL
         LIMIT 1`,
        [ownerUserId, requestedFriendId]
      );
      friendRow = friendResult.rows[0] || null;
    }

    let memberName = requestedName || String(friendRow?.name || '').trim();
    let targetUserId = requestedTargetUserId > 0 ? requestedTargetUserId : Number(friendRow?.linked_user_id || 0);

    if (!memberName && targetUserId > 0) {
      const userResult = await client.query(
        `SELECT display_name, username
         FROM users
         WHERE id = $1
           AND is_active = TRUE
           AND deleted_at IS NULL
         LIMIT 1`,
        [targetUserId]
      );
      const row = userResult.rows[0] || null;
      memberName = String(row?.display_name || row?.username || '').trim();
    }

    memberName = memberName.replace(/\s+/g, ' ').trim();
    if (!memberName) continue;
    if (['you', 'me', 'self'].includes(memberName.toLowerCase())) continue;
    // If a friend is accidentally linked to owner account, keep the member entry
    // but avoid self-link so it does not get dropped from trip membership.
    if (targetUserId === Number(ownerUserId)) targetUserId = 0;

    const dedupeKey = targetUserId > 0 ? `u:${targetUserId}` : `n:${memberName.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalized.push({
      friend_id: friendRow ? Number(friendRow.id) : null,
      member_name: memberName,
      target_user_id: targetUserId > 0 ? targetUserId : null,
      permission,
    });
  }
  return normalized;
}

function isLiveSplitTripMembersPrimaryKeyError(err) {
  return err?.code === '23505' && String(err?.constraint || '').trim() === 'live_split_trip_members_pkey';
}

async function ensureLiveSplitTripMembersIdSequence(client) {
  await client.query(
    `SELECT setval(
       pg_get_serial_sequence('live_split_trip_members', 'id'),
       COALESCE((SELECT MAX(id) FROM live_split_trip_members), 0) + 1,
       FALSE
     )`
  );
}

async function insertLiveSplitTripMemberRow(client, params) {
  const sql = `INSERT INTO live_split_trip_members (trip_id, friend_id, member_name, target_user_id, permission, is_locked, updated_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`;
  try {
    await client.query(sql, params);
  } catch (err) {
    if (!isLiveSplitTripMembersPrimaryKeyError(err)) throw err;
    await ensureLiveSplitTripMembersIdSequence(client);
    await client.query(sql, params);
  }
}

async function createLiveSplitTrip(userId, data) {
  return withTransaction(async (client) => {
    const name = normalizeText(data?.name, 'Trip name', 120);
    const startDate = normalizeDateValue(data?.start_date, 'Start date');
    const endDate = data?.end_date ? normalizeDateValue(data.end_date, 'End date') : null;
    if (endDate && endDate < startDate) throw validationError('End date cannot be before start date');
    const showAddToExpenseOption = data?.show_add_to_expense_option !== false;
    const notes = data?.notes ? normalizeOptionalText(data.notes, 300) : null;
    const members = await normalizeLiveSplitTripMembersForOwner(client, userId, data?.members || []);

    const tripResult = await client.query(
      `INSERT INTO live_split_trips (user_id, name, start_date, end_date, status, show_add_to_expense_option, notes, updated_by)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $1)
       RETURNING id`,
      [userId, name, startDate, endDate, showAddToExpenseOption, notes]
    );
    const tripId = Number(tripResult.rows[0].id);

    await ensureLiveSplitTripMembersIdSequence(client);
    await insertLiveSplitTripMemberRow(client, [tripId, null, 'You', userId, 'owner', true, userId]);

    for (const member of members) {
      await insertLiveSplitTripMemberRow(client, [tripId, member.friend_id, member.member_name, member.target_user_id, member.permission, false, userId]);
    }

    return tripId;
  });
}

async function getLiveSplitTrips(userId) {
  const result = await query(
    `SELECT DISTINCT
       t.*,
       EXISTS (
         SELECT 1
         FROM expenses e
         WHERE e.user_id = $1
           AND e.source = 'live_split_trip'
           AND e.source_id = t.id
           AND e.deleted_at IS NULL
       ) AS added_to_expense,
       COALESCE((
         SELECT e.is_extra
         FROM expenses e
         WHERE e.user_id = $1
           AND e.source = 'live_split_trip'
           AND e.source_id = t.id
           AND e.deleted_at IS NULL
         ORDER BY e.id DESC
         LIMIT 1
       ), FALSE) AS added_to_expense_is_extra,
       CASE WHEN t.user_id = $1 THEN TRUE ELSE FALSE END AS is_owner
     FROM live_split_trips t
     LEFT JOIN live_split_trip_members m ON m.trip_id = t.id AND m.target_user_id = $1
     WHERE t.user_id = $1
        OR m.target_user_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM live_split_groups g
          JOIN live_split_group_shares share ON share.group_id = g.id
          WHERE g.trip_id = t.id
            AND share.target_user_id = $1
            AND share.owner_hidden_at IS NULL
            AND share.target_hidden_at IS NULL
        )
     ORDER BY t.start_date DESC, t.id DESC`,
    [userId]
  );

  const trips = [];
  for (const row of result.rows) {
    const [membersResult, statsResult] = await Promise.all([
      query(
        `SELECT m.*, u.avatar_url AS linked_user_avatar_url
         FROM live_split_trip_members m
         LEFT JOIN users u ON u.id = m.target_user_id AND u.deleted_at IS NULL
         WHERE m.trip_id = $1
         ORDER BY m.id`,
        [row.id]
      ),
      getLiveSplitTripExpenseStats({ query }, row.id, userId),
    ]);
    const stats = statsResult || {};
    trips.push({
      ...row,
      id: Number(row.id),
      user_id: Number(row.user_id),
      is_owner: bool(row.is_owner),
      status: normalizeLiveSplitTripStatus(row.status),
      added_to_expense: bool(row.added_to_expense),
      added_to_expense_is_extra: bool(row.added_to_expense_is_extra),
      show_add_to_expense_option: bool(row.show_add_to_expense_option),
      members: (membersResult.rows || []).map((member) => ({
        ...member,
        id: Number(member.id),
        trip_id: Number(member.trip_id),
        friend_id: member.friend_id ? Number(member.friend_id) : null,
        target_user_id: member.target_user_id ? Number(member.target_user_id) : null,
        is_locked: bool(member.is_locked),
      })),
      expense_count: Number(stats.expense_count || 0),
      settlement_count: Number(stats.settlement_count || 0),
      total_amount: num(stats.total_amount),
      my_share_amount: num(stats.my_share_amount),
      latest_divide_date: stats.latest_divide_date || null,
    });
  }

  return trips;
}

async function getLiveSplitTripExpenseStats(client, tripId, userId) {
  const tid = Number(tripId || 0);
  const uid = Number(userId || 0);
  if (!(tid > 0)) {
    return {
      expense_count: 0,
      total_amount: 0,
      settlement_count: 0,
      my_share_amount: 0,
      latest_divide_date: null,
    };
  }
  const statsResult = await client.query(
    `SELECT
       COUNT(*)::int AS expense_count,
       COALESCE(SUM(g.total_amount), 0) AS total_amount,
       COUNT(*) FILTER (WHERE lower(COALESCE(g.split_mode, '')) = 'settlement')::int AS settlement_count,
       COALESCE(SUM(
         CASE
           WHEN lower(COALESCE(g.split_mode, '')) = 'settlement' THEN 0
           WHEN g.user_id = $2 THEN (
             g.total_amount - COALESCE((
               SELECT SUM(s.share_amount)
               FROM live_split_splits s
               WHERE s.group_id = g.id
             ), 0)
           )
           ELSE COALESCE((
             SELECT fs.share_amount
             FROM live_split_group_shares share
             LEFT JOIN live_split_splits fs
               ON fs.group_id = g.id
              AND fs.friend_id = share.friend_id
             WHERE share.group_id = g.id
               AND share.target_user_id = $2
             ORDER BY share.id DESC
             LIMIT 1
           ), 0)
         END
       ), 0) AS my_share_amount,
       MAX(g.divide_date) AS latest_divide_date
     FROM live_split_groups g
     WHERE g.trip_id = $1`,
    [tid, uid]
  );
  const row = statsResult.rows[0] || {};
  return {
    expense_count: Number(row.expense_count || 0),
    total_amount: num(row.total_amount),
    settlement_count: Number(row.settlement_count || 0),
    my_share_amount: num(row.my_share_amount),
    latest_divide_date: row.latest_divide_date || null,
  };
}

async function updateLiveSplitTrip(userId, tripId, data = {}) {
  const uid = Number(userId);
  const tid = Number(tripId);
  if (!(tid > 0)) throw validationError('Trip not found');
  await withTransaction(async (client) => {
    const access = await getLiveSplitTripAccessRow(client, uid, tid);
    if (!access) throw validationError('Trip not found');
    if (Number(access.user_id) !== uid) throw validationError('Only trip owner can update trip');

    const fields = [];
    const params = [];
    if (data.name !== undefined) {
      params.push(normalizeText(data.name, 'Trip name', 120));
      fields.push(`name = $${params.length}`);
    }
    if (data.start_date !== undefined) {
      params.push(normalizeDateValue(data.start_date, 'Start date'));
      fields.push(`start_date = $${params.length}`);
    }
    if (data.end_date !== undefined) {
      params.push(data.end_date ? normalizeDateValue(data.end_date, 'End date') : null);
      fields.push(`end_date = $${params.length}`);
    }
    if (data.status !== undefined) {
      params.push(normalizeLiveSplitTripStatus(data.status));
      fields.push(`status = $${params.length}`);
    }
    if (data.notes !== undefined) {
      params.push(data.notes ? normalizeOptionalText(data.notes, 300) : null);
      fields.push(`notes = $${params.length}`);
    }
    if (data.show_add_to_expense_option !== undefined) {
      params.push(data.show_add_to_expense_option !== false);
      fields.push(`show_add_to_expense_option = $${params.length}`);
    }

    if (!fields.length) return;
    params.push(uid);
    fields.push(`updated_by = $${params.length}`);
    params.push(tid);
    await client.query(
      `UPDATE live_split_trips
       SET ${fields.join(', ')},
           updated_at = NOW()
       WHERE id = $${params.length}`,
      params
    );
  });
}

async function deleteLiveSplitTrip(userId, tripId) {
  const uid = Number(userId);
  const tid = Number(tripId);
  await withTransaction(async (client) => {
    const own = await client.query(
      `SELECT id
       FROM live_split_trips
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [tid, uid]
    );
    if (!own.rows[0]) throw validationError('Trip not found');
    await client.query('DELETE FROM live_split_trip_members WHERE trip_id = $1', [tid]);
    await client.query('DELETE FROM live_split_trips WHERE id = $1', [tid]);
  });
}

async function addLiveSplitTripMembers(userId, tripId, members = []) {
  const uid = Number(userId);
  const tid = Number(tripId);
  return withTransaction(async (client) => {
    const access = await getLiveSplitTripAccessRow(client, uid, tid);
    if (!access) throw validationError('Trip not found');
    if (Number(access.user_id) !== uid) throw validationError('Only trip owner can add members');

    const attempted = Array.isArray(members) ? members.length : 0;
    const normalized = await normalizeLiveSplitTripMembersForOwner(client, uid, members || []);
    if (!normalized.length) return { added: 0, attempted, normalized: 0, skipped: attempted };

    const existingResult = await client.query(
      `SELECT id, member_name, target_user_id
       FROM live_split_trip_members
       WHERE trip_id = $1`,
      [tid]
    );
    const existing = existingResult.rows || [];
    let added = 0;
    await ensureLiveSplitTripMembersIdSequence(client);
    for (const member of normalized) {
      const duplicate = existing.find((row) => (
        (Number(row.target_user_id || 0) > 0 && Number(member.target_user_id || 0) > 0 && Number(row.target_user_id) === Number(member.target_user_id))
        || String(row.member_name || '').trim().toLowerCase() === String(member.member_name || '').trim().toLowerCase()
      ));
      if (duplicate) continue;
      await insertLiveSplitTripMemberRow(client, [tid, member.friend_id, member.member_name, member.target_user_id, member.permission, false, uid]);
      added += 1;
    }
    return { added, attempted, normalized: normalized.length, skipped: Math.max(0, normalized.length - added) };
  });
}

async function removeLiveSplitTripMember(userId, tripId, memberId) {
  const uid = Number(userId);
  const tid = Number(tripId);
  const mid = Number(memberId);
  return withTransaction(async (client) => {
    const access = await getLiveSplitTripAccessRow(client, uid, tid);
    if (!access) throw validationError('Trip not found');
    if (Number(access.user_id) !== uid) throw validationError('Only trip owner can remove members');

    const memberResult = await client.query(
      `SELECT id, permission
       FROM live_split_trip_members
       WHERE id = $1
         AND trip_id = $2
       LIMIT 1`,
      [mid, tid]
    );
    const member = memberResult.rows[0] || null;
    if (!member) throw validationError('Member not found');
    if (String(member.permission || '').toLowerCase() === 'owner') throw validationError('Cannot remove trip owner');

    await client.query('DELETE FROM live_split_trip_members WHERE id = $1', [mid]);
    return { removed: true };
  });
}

async function addLiveSplitTripToExpense(userId, tripId, data = {}) {
  const uid = Number(userId);
  const tid = Number(tripId);
  if (!(tid > 0)) throw validationError('Trip not found');
  return withTransaction(async (client) => {
    const access = await getLiveSplitTripAccessRow(client, uid, tid);
    if (!access) throw validationError('Trip not found');
    const stats = await getLiveSplitTripExpenseStats(client, tid, uid);
    const totalAmount = normalizeAmount(stats.total_amount || 0);
    const myShareAmount = normalizeAmount(stats.my_share_amount || 0);
    if (!(myShareAmount > 0)) throw validationError('Your trip share is zero, so nothing can be added to expenses');
    const tripName = String(access.name || 'Live Split Trip').trim() || 'Live Split Trip';
    const purchaseDate = stats.latest_divide_date || access.end_date || access.start_date || new Date().toISOString().slice(0, 10);
    const isExtra = String(data?.expense_type || '').trim().toLowerCase() === 'extra';
    const existingR = await client.query(
      `SELECT id
       FROM expenses
       WHERE user_id = $1
         AND source = 'live_split_trip'
         AND source_id = $2
         AND deleted_at IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [uid, tid]
    );
    if (existingR.rows[0]?.id) {
      await client.query(
        `UPDATE expenses
         SET item_name = $1,
             category = $2,
             amount = $3,
             purchase_date = $4,
             is_extra = $5,
             updated_at = NOW(),
             updated_by = $6
          WHERE id = $7`,
        [tripName, 'Live Split Trip', myShareAmount, purchaseDate, isExtra, uid, Number(existingR.rows[0].id)]
      );
      return { id: Number(existingR.rows[0].id), total_amount: totalAmount, my_share_amount: myShareAmount, updated: true, is_extra: isExtra };
    }
    const insertR = await client.query(
      `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, source, source_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'live_split_trip', $7, $1, $1)
       RETURNING id`,
      [uid, tripName, 'Live Split Trip', myShareAmount, purchaseDate, isExtra, tid]
    );
    return { id: Number(insertR.rows[0].id), total_amount: totalAmount, my_share_amount: myShareAmount, updated: false, is_extra: isExtra };
  });
}

async function getLiveSplitGroups(userId) {
  await canonicalizeLiveSplitFriendRowsForOwner(Number(userId));
  const result = await query(
    `SELECT
       g.*,
       COALESCE((
         SELECT json_agg(
           json_build_object(
             'friend_id', dgs.friend_id,
             'target_user_id', dgs.target_user_id
           )
           ORDER BY dgs.friend_id
         )
         FROM live_split_group_shares dgs
         WHERE dgs.group_id = g.id
       ), '[]'::json) AS shared_targets,
       COALESCE(
         json_agg(
           json_build_object(
             'id', s.id,
             'group_id', s.group_id,
             'friend_id', s.friend_id,
             'friend_name', s.friend_name,
             'linked_user_id', COALESCE(
               NULLIF(lf.linked_user_id, g.user_id),
               (
                 SELECT dgs.target_user_id
                 FROM live_split_group_shares dgs
                 WHERE dgs.group_id = g.id
                   AND dgs.friend_id = s.friend_id
                 ORDER BY dgs.id DESC
                 LIMIT 1
               ),
               (
                 SELECT f2.linked_user_id
                 FROM live_split_friends f2
                 WHERE f2.user_id = g.user_id
                   AND f2.deleted_at IS NULL
                   AND f2.linked_user_id IS NOT NULL
                   AND f2.linked_user_id <> g.user_id
                   AND (
                     lower(trim(f2.name)) = lower(trim(COALESCE(s.friend_name, '')))
                     OR split_part(regexp_replace(lower(trim(f2.name)), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
                        = split_part(regexp_replace(lower(trim(COALESCE(s.friend_name, ''))), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
                   )
                 ORDER BY
                   CASE WHEN lower(trim(f2.name)) = lower(trim(COALESCE(s.friend_name, ''))) THEN 0 ELSE 1 END,
                   f2.id
                 LIMIT 1
               )
             ),
             'share_amount', s.share_amount,
             'is_paid', s.is_paid
           )
           ORDER BY s.id
         ) FILTER (WHERE s.id IS NOT NULL),
         '[]'::json
       ) AS splits
     FROM live_split_groups g
     LEFT JOIN live_split_splits s ON s.group_id = g.id
     LEFT JOIN live_split_friends lf ON lf.id = s.friend_id
     WHERE g.user_id = $1
     GROUP BY g.id
     ORDER BY g.divide_date DESC, g.id DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    ...row,
    total_amount: num(row.total_amount),
    owner_added_to_expense: bool(row.owner_added_to_expense),
    shared_targets: (row.shared_targets || []).map((item) => ({
      friend_id: Number(item.friend_id),
      target_user_id: Number(item.target_user_id),
    })),
    splits: (row.splits || []).map((split) => ({
      ...split,
      linked_user_id: split.linked_user_id ? Number(split.linked_user_id) : null,
      share_amount: num(split.share_amount),
      is_paid: bool(split.is_paid),
    })),
  }));
}

async function getLiveSplitGroupActivities(groupId) {
  const result = await query(
    `SELECT a.id, a.group_id, a.actor_user_id, a.action, a.summary, a.created_at,
            u.display_name AS actor_name, u.username AS actor_username
     FROM live_split_group_activity a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.group_id = $1
     ORDER BY a.created_at DESC, a.id DESC`,
    [groupId]
  );
  return result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    group_id: Number(row.group_id),
    actor_user_id: row.actor_user_id ? Number(row.actor_user_id) : null,
  }));
}

async function logLiveSplitGroupActivity(client, { groupId, actorUserId = null, action, summary = null }) {
  await client.query(
    `INSERT INTO live_split_group_activity (group_id, actor_user_id, action, summary)
     VALUES ($1, $2, $3, $4)`,
    [groupId, actorUserId || null, String(action || '').trim() || 'updated', summary || null]
  );
}

async function logLiveSplitFriendActivities(client, {
  ownerUserId,
  groupId = null,
  actorUserId = null,
  action,
  summary = null,
  expenseDetails = null,
  divideDate = null,
  totalAmount = null,
  splits = [],
}) {
  const uniqueSplits = [];
  const seen = new Set();
  for (const split of (splits || [])) {
    const friendId = Number(split?.friend_id || 0);
    if (!(friendId > 0) || seen.has(friendId)) continue;
    seen.add(friendId);
    uniqueSplits.push({
      friend_id: friendId,
      friend_name: String(split?.friend_name || '').trim() || 'Friend',
    });
  }
  for (const split of uniqueSplits) {
    await client.query(
      `INSERT INTO live_split_friend_activity
         (owner_user_id, friend_id, group_id, actor_user_id, action, summary, expense_details, divide_date, total_amount, friend_name_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        Number(ownerUserId),
        split.friend_id,
        groupId ? Number(groupId) : null,
        actorUserId || null,
        String(action || '').trim() || 'updated',
        summary || null,
        expenseDetails ? String(expenseDetails).trim() : null,
        divideDate || null,
        totalAmount != null ? num(totalAmount) : null,
        split.friend_name,
      ]
    );
  }
}

function liveSplitShareMap(splits = []) {
  const map = new Map();
  (splits || []).forEach((split) => {
    const key = String(split?.friend_name || '').trim().toLowerCase();
    if (!key) return;
    map.set(key, {
      name: String(split?.friend_name || '').trim(),
      share_amount: num(split?.share_amount),
    });
  });
  return map;
}

function areAllLiveSplitSharesEqual(splits = []) {
  const amounts = (splits || []).map((split) => num(split?.share_amount)).filter((value) => value >= 0);
  if (amounts.length < 2) return false;
  const first = amounts[0];
  return amounts.every((value) => Math.abs(value - first) <= 0.009);
}

function describeLiveSplitChanges(previousGroup, nextGroup) {
  const changes = [];
  const prevDetails = String(previousGroup?.details || '').trim();
  const nextDetails = String(nextGroup?.details || '').trim();
  if (prevDetails !== nextDetails) changes.push(`renamed it from "${prevDetails || '-'}" to "${nextDetails || '-'}"`);

  const prevDate = String(previousGroup?.divide_date || '').slice(0, 10);
  const nextDate = String(nextGroup?.divide_date || '').slice(0, 10);
  if (prevDate !== nextDate) changes.push(`changed the date from ${prevDate || '-'} to ${nextDate || '-'}`);

  const prevAmount = num(previousGroup?.total_amount);
  const nextAmount = num(nextGroup?.total_amount);
  if (Math.abs(prevAmount - nextAmount) > 0.009) changes.push(`changed the amount from ${prevAmount.toFixed(2)} to ${nextAmount.toFixed(2)}`);

  const prevPaidBy = String(previousGroup?.paid_by || '').trim();
  const nextPaidBy = String(nextGroup?.paid_by || '').trim();
  if (prevPaidBy !== nextPaidBy) changes.push(`changed the payer from ${prevPaidBy || '-'} to ${nextPaidBy || '-'}`);

  const prevShares = liveSplitShareMap(previousGroup?.splits || []);
  const nextShares = liveSplitShareMap(nextGroup?.splits || []);
  const allNames = [...new Set([...prevShares.keys(), ...nextShares.keys()])];
  const nextSplitList = nextGroup?.splits || [];
  if (areAllLiveSplitSharesEqual(nextSplitList)) {
    const equalNames = nextSplitList.map((split) => String(split?.friend_name || '').trim()).filter(Boolean);
    if (equalNames.length) changes.push(`split it equally with ${equalNames.join(', ')}`);
  }
  allNames.forEach((key) => {
    const prev = prevShares.get(key);
    const next = nextShares.get(key);
    if (!prev && next) {
      changes.push(`added ${next.name} with a share of ${next.share_amount.toFixed(2)}`);
      return;
    }
    if (prev && !next) {
      changes.push(`removed ${prev.name}`);
      return;
    }
    if (prev && next && Math.abs(num(prev.share_amount) - num(next.share_amount)) > 0.009) {
      changes.push(`changed ${next.name}'s share from ${num(prev.share_amount).toFixed(2)} to ${num(next.share_amount).toFixed(2)}`);
    }
  });

  return changes;
}

function buildLiveSplitActivitySentence(action, expenseName, changes = []) {
  const safeName = String(expenseName || 'Live Split expense').trim();
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (normalizedAction === 'created') {
    return `created "${safeName}"`;
  }
  if (normalizedAction === 'deleted') {
    return `deleted "${safeName}"`;
  }
  if (!changes.length) {
    return `updated "${safeName}" without changing any values`;
  }
  return `updated "${safeName}" by ${changes.join(', ')}`;
}

function liveSplitModeLabel(mode) {
  const key = String(mode || '').trim().toLowerCase();
  if (key === 'settlement') return 'Settlement';
  if (key === 'equal') return 'Equal';
  if (key === 'percent') return '% Percent';
  if (key === 'fraction') return 'Fraction';
  if (key === 'parts') return 'Parts/Ratio';
  return 'Direct Rs';
}

function inferLiveSplitModeLabel(mode, splits = []) {
  if (String(mode || '').trim().toLowerCase() === 'settlement') return 'Settlement';
  const list = Array.isArray(splits) ? splits : [];
  const shares = list
    .map((split) => num(split?.share_amount))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (shares.length > 1) {
    const first = shares[0];
    const allEqual = shares.every((value) => Math.abs(value - first) <= 0.009);
    if (allEqual) return 'Equal';
  }
  return liveSplitModeLabel(mode);
}

async function getLiveSplitGroupDetailForUser(userId, groupId) {
  const uid = Number(userId);
  const gid = Number(groupId);
  const groupResult = await query(
    `SELECT g.*,
            owner.display_name AS owner_name,
            owner.username AS owner_username,
            CASE
              WHEN g.user_id = $1 THEN g.owner_added_to_expense
              ELSE COALESCE((
                SELECT share.added_to_expense
                FROM live_split_group_shares share
                WHERE share.group_id = g.id
                  AND share.target_user_id = $1
                LIMIT 1
              ), FALSE)
            END AS added_to_expense,
            EXISTS (
              SELECT 1
              FROM live_split_group_shares share
              WHERE share.group_id = g.id
                AND share.target_user_id = $1
                AND share.owner_hidden_at IS NULL
                AND share.target_hidden_at IS NULL
            ) AS is_shared_to_user
     FROM live_split_groups g
     JOIN users owner ON owner.id = g.user_id
     WHERE g.id = $2
       AND (
         g.user_id = $1
         OR EXISTS (
           SELECT 1
           FROM live_split_group_shares share
           WHERE share.group_id = g.id
             AND share.target_user_id = $1
             AND share.owner_hidden_at IS NULL
             AND share.target_hidden_at IS NULL
         )
       )
     LIMIT 1`,
    [uid, gid]
  );
  const row = groupResult.rows[0];
  if (!row) return null;

  const splitsResult = await query(
    `SELECT s.id, s.group_id, s.friend_id, s.friend_name, s.share_amount, s.is_paid,
            f.linked_user_id
     FROM live_split_splits s
     LEFT JOIN live_split_friends f ON f.id = s.friend_id
     WHERE s.group_id = $1
     ORDER BY s.id`,
    [gid]
  );
  const activities = await getLiveSplitGroupActivities(gid);
  const splits = splitsResult.rows.map((split) => ({
    ...split,
    id: Number(split.id),
    group_id: Number(split.group_id),
    friend_id: Number(split.friend_id),
    linked_user_id: split.linked_user_id ? Number(split.linked_user_id) : null,
    share_amount: num(split.share_amount),
    is_paid: bool(split.is_paid),
  }));

  return {
    ...row,
    id: Number(row.id),
    user_id: Number(row.user_id),
    total_amount: num(row.total_amount),
    updated_by: row.updated_by ? Number(row.updated_by) : null,
    can_edit: true,
    can_delete: true,
    is_owner: Number(row.user_id) === uid,
    added_to_expense: bool(row.added_to_expense),
    owner_name: String(row.owner_name || row.owner_username || 'Owner').trim(),
    splits,
    activities,
  };
}

async function markLiveSplitExpenseAdded(userId, groupId, added = true) {
  const uid = Number(userId);
  const gid = Number(groupId);
  if (!(gid > 0)) throw validationError('Group not found');
  return withTransaction(async (client) => {
    const ownResult = await client.query(
      `SELECT id
       FROM live_split_groups
       WHERE id = $2
         AND user_id = $1
       LIMIT 1`,
      [uid, gid]
    );
    if (ownResult.rows[0]) {
      await client.query(
        `UPDATE live_split_groups
         SET owner_added_to_expense = $1,
             updated_at = NOW(),
             updated_by = $2
         WHERE id = $3`,
        [!!added, uid, gid]
      );
      return { success: true, scope: 'owner' };
    }
    const shareResult = await client.query(
      `UPDATE live_split_group_shares
       SET added_to_expense = $1,
           updated_at = NOW()
       WHERE group_id = $2
         AND target_user_id = $3
       RETURNING id`,
      [!!added, gid, uid]
    );
    if (!shareResult.rows[0]) throw new Error('Not found');
    return { success: true, scope: 'shared' };
  });
}

async function getLiveSplitFriendActivities(userId, friendId, limit = 60) {
  const uid = Number(userId);
  const fid = Number(friendId);
  const cappedLimit = Math.max(1, Math.min(200, Number(limit) || 60));
  const friendResult = await query(
    `SELECT id, name, linked_user_id
     FROM live_split_friends
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [uid, fid]
  );
  const selectedFriend = friendResult.rows[0];
  if (!selectedFriend) throw new Error('Live split friend not found');

  const linkedUserId = Number(selectedFriend.linked_user_id || 0);
  const friendName = String(selectedFriend.name || '').trim();
  const friendNameNorm = friendName.toLowerCase();
  const friendNameFirstToken = friendNameNorm.split(/\s+/).filter(Boolean)[0] || '';

  const result = await query(
    `SELECT a.id, a.owner_user_id, a.friend_id, a.group_id, a.actor_user_id, a.action, a.summary,
            a.expense_details, a.divide_date, a.total_amount, a.friend_name_snapshot, a.created_at,
            u.display_name AS actor_name, u.username AS actor_username
     FROM live_split_friend_activity a
     JOIN live_split_friends f ON f.id = a.friend_id
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.owner_user_id = $1
       AND (
         a.friend_id = $2
         OR (
           $4 > 0
           AND f.user_id = $1
           AND f.deleted_at IS NULL
           AND f.linked_user_id = $4
         )
         OR (
           $4 = 0
           AND $5 <> ''
           AND f.user_id = $1
           AND f.deleted_at IS NULL
           AND (
             lower(trim(COALESCE(f.name, ''))) = $5
             OR (
               $6 <> ''
               AND split_part(lower(trim(COALESCE(f.name, ''))), ' ', 1) = $6
             )
           )
         )
       )
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $3`,
    [uid, fid, cappedLimit, linkedUserId, friendNameNorm, friendNameFirstToken]
  );
  return result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    owner_user_id: Number(row.owner_user_id),
    friend_id: Number(row.friend_id),
    group_id: row.group_id ? Number(row.group_id) : null,
    actor_user_id: row.actor_user_id ? Number(row.actor_user_id) : null,
    total_amount: row.total_amount == null ? null : num(row.total_amount),
  }));
}

async function addLiveSplitGroup(userId, data) {
  return withTransaction(async (client) => {
    const divideDate = normalizeDateValue(data.divide_date, 'Divide date');
    const tripId = Number(data.trip_id || 0) > 0 ? Number(data.trip_id) : null;
    const ownerUserId = Number(userId);
    const normalizedSplits = await normalizeLiveSplitGroupSplitsForOwner(client, ownerUserId, data.splits || []);
    if (!data.allow_duplicate) {
      await assertNoDuplicateLiveSplitGroup(client, ownerUserId, {
        divide_date: divideDate,
        total_amount: data.total_amount,
        splits: normalizedSplits,
      });
    }
    if (tripId) {
      const trip = await getLiveSplitTripAccessRow(client, userId, tripId);
      if (!trip) throw validationError('Live split trip not found');
      if (normalizeLiveSplitTripStatus(trip.status) !== 'active') throw validationError('Trip is completed. Re-open it to add expenses.');
      await assertLiveSplitTripParticipants(client, tripId, normalizedSplits);
      await assertLiveSplitTripPayerAllowed(client, tripId, data.paid_by);
    }
    const groupResult = await client.query(
      `INSERT INTO live_split_groups (user_id, divide_date, details, paid_by, total_amount, heading, session_id, split_mode, trip_id, owner_added_to_expense)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [userId, divideDate, data.details, data.paid_by, data.total_amount, data.heading || null, data.session_id || null, String(data.split_mode || 'equal'), tripId, !!data.owner_added_to_expense]
    );
    const groupId = Number(groupResult.rows[0].id);
    await insertLiveSplitSplitsWithSequenceRecovery(client, groupId, normalizedSplits);
    await logLiveSplitGroupActivity(client, {
      groupId,
      actorUserId: userId,
      action: 'created',
      summary: buildLiveSplitActivitySentence('created', String(data.details || data.heading || 'Live Split expense').trim()),
    });
    await logLiveSplitFriendActivities(client, {
      ownerUserId,
      groupId,
      actorUserId: userId,
      action: 'created',
      summary: buildLiveSplitActivitySentence('created', String(data.details || data.heading || 'Live Split expense').trim()),
      expenseDetails: String(data.details || data.heading || 'Live Split expense').trim(),
      divideDate,
      totalAmount: data.total_amount,
      splits: normalizedSplits,
    });
    return groupId;
  });
}

async function normalizeLiveSplitGroupSplitsForOwner(client, ownerUserId, splits = []) {
  const normalized = [];
  for (const split of (splits || [])) {
    const requestedFriendId = Number(split?.friend_id);
    const requestedName = String(split?.friend_name || '').trim();
    if (!requestedName) continue;
    let friendRow = null;
    if (requestedFriendId > 0) {
      const friendResult = await client.query(
        `SELECT id, name, linked_user_id, deleted_at
         FROM live_split_friends
         WHERE user_id = $1
           AND id = $2
         LIMIT 1`,
        [ownerUserId, requestedFriendId]
      );
      friendRow = friendResult.rows[0] || null;
    }
    if (!friendRow || friendRow.deleted_at) {
      const activeByName = await client.query(
        `SELECT id, name, linked_user_id
         FROM live_split_friends
         WHERE user_id = $1
           AND lower(name) = lower($2)
           AND deleted_at IS NULL
         ORDER BY id DESC
         LIMIT 1`,
        [ownerUserId, requestedName]
      );
      friendRow = activeByName.rows[0] || friendRow;
    }
    if (!friendRow) continue;
    normalized.push({
      friend_id: Number(friendRow.id),
      friend_name: requestedName || String(friendRow.name || '').trim(),
      linked_user_id: friendRow.linked_user_id ? Number(friendRow.linked_user_id) : null,
      share_amount: num(split?.share_amount),
    });
  }
  return normalized.filter((split) => split.friend_id > 0 && split.friend_name && split.share_amount >= 0);
}

function normalizeLiveSplitPayerName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeLiveSplitDuplicateDetails(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildLiveSplitDuplicateSignature(ownerUserId, totalAmount, splits = [], paidBy = '', details = '') {
  const normalizedTotal = Math.round(num(totalAmount) * 100) / 100;
  const normalizedShares = (splits || [])
    .map((split) => Math.round(num(split?.share_amount) * 100) / 100)
    .filter((value) => value >= 0)
    .sort((a, b) => a - b);
  const splitSum = Math.round(normalizedShares.reduce((sum, value) => sum + value, 0) * 100) / 100;
  const ownerShare = Math.round((normalizedTotal - splitSum) * 100) / 100;
  const signatureShares = [...normalizedShares, ownerShare].sort((a, b) => a - b);
  const participantTokens = [
    Number(ownerUserId || 0) > 0 ? `user:${Number(ownerUserId)}` : 'user:0',
    ...(splits || []).map((split) => {
      const linkedUserId = Number(split?.linked_user_id || 0);
      if (linkedUserId > 0) return `user:${linkedUserId}`;
      const friendId = Number(split?.friend_id || 0);
      return friendId > 0 ? `friend:${friendId}` : `name:${String(split?.friend_name || '').trim().toLowerCase()}`;
    }),
  ].sort();
  return {
    totalAmount: normalizedTotal,
    participantCount: participantTokens.length,
    participantKey: participantTokens.join('|'),
    sharesKey: signatureShares.map((value) => value.toFixed(2)).join('|'),
    paidByKey: normalizeLiveSplitPayerName(paidBy),
    detailsKey: normalizeLiveSplitDuplicateDetails(details),
  };
}

async function insertLiveSplitSplitsWithSequenceRecovery(client, groupId, normalizedSplits = []) {
  for (const split of normalizedSplits) {
    try {
      await client.query(
        `INSERT INTO live_split_splits (group_id, friend_id, friend_name, share_amount)
         VALUES ($1, $2, $3, $4)`,
        [groupId, split.friend_id, split.friend_name, split.share_amount]
      );
    } catch (err) {
      const isSequenceDrift = err?.code === '23505' && String(err?.constraint || '') === 'live_split_splits_pkey';
      if (!isSequenceDrift) throw err;
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence('live_split_splits', 'id'),
           COALESCE((SELECT MAX(id) FROM live_split_splits), 0) + 1,
           false
         )`
      );
      await client.query(
        `INSERT INTO live_split_splits (group_id, friend_id, friend_name, share_amount)
         VALUES ($1, $2, $3, $4)`,
        [groupId, split.friend_id, split.friend_name, split.share_amount]
      );
    }
  }
}

async function runLiveSplitGroupShareUpsertWithRecovery(client, sql, params = []) {
  await client.query('SAVEPOINT live_split_group_shares_seq_fix');
  try {
    const result = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT live_split_group_shares_seq_fix');
    return result;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT live_split_group_shares_seq_fix');
    const isSequenceDrift = err?.code === '23505' && String(err?.constraint || '') === 'live_split_group_shares_pkey';
    if (!isSequenceDrift) {
      await client.query('RELEASE SAVEPOINT live_split_group_shares_seq_fix');
      throw err;
    }
    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('live_split_group_shares', 'id'),
         COALESCE((SELECT MAX(id) FROM live_split_group_shares), 0) + 1,
         false
       )`
    );
    const result = await client.query(sql, params);
    await client.query('RELEASE SAVEPOINT live_split_group_shares_seq_fix');
    return result;
  }
}

async function assertNoDuplicateLiveSplitGroup(client, userId, data, excludeGroupId = null) {
  const divideDate = normalizeDateValue(data.divide_date, 'Divide date');
  const target = buildLiveSplitDuplicateSignature(userId, data.total_amount, data.splits || [], data.paid_by, data.details);
  const params = [Number(userId), divideDate];
  let excludeSql = '';
  if (Number(excludeGroupId || 0) > 0) {
    params.push(Number(excludeGroupId));
    excludeSql = ` AND g.id <> $${params.length}`;
  }
  const result = await client.query(
    `SELECT
       g.id,
       g.user_id,
       g.details,
       g.paid_by,
       g.divide_date,
       g.total_amount,
       owner.display_name AS owner_name,
       COALESCE(
          json_agg(
            json_build_object(
              'friend_id', s.friend_id,
              'friend_name', s.friend_name,
              'linked_user_id', COALESCE(
                NULLIF(lf.linked_user_id, g.user_id),
                (
                  SELECT dgs.target_user_id
                  FROM live_split_group_shares dgs
                  WHERE dgs.group_id = g.id
                    AND dgs.friend_id = s.friend_id
                  ORDER BY dgs.id DESC
                  LIMIT 1
                )
              ),
              'share_amount', s.share_amount
            )
            ORDER BY s.share_amount, s.id
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS splits
      FROM live_split_groups g
      JOIN users owner ON owner.id = g.user_id
      LEFT JOIN live_split_splits s ON s.group_id = g.id
      LEFT JOIN live_split_friends lf ON lf.id = s.friend_id
     WHERE g.divide_date = $2
       AND g.split_mode <> 'settlement'
       ${excludeSql}
       AND (
         g.user_id = $1
         OR EXISTS (
           SELECT 1
           FROM live_split_group_shares share
           WHERE share.group_id = g.id
             AND share.target_user_id = $1
             AND share.owner_hidden_at IS NULL
             AND share.target_hidden_at IS NULL
         )
       )
     GROUP BY g.id, owner.display_name
     ORDER BY g.id DESC`,
    params
  );

  for (const row of result.rows || []) {
    const candidate = buildLiveSplitDuplicateSignature(row.user_id, row.total_amount, row.splits || [], row.paid_by, row.details);
    if (candidate.totalAmount !== target.totalAmount) continue;
    if (candidate.participantCount !== target.participantCount) continue;
    if (candidate.participantKey !== target.participantKey) continue;
    if (candidate.sharesKey !== target.sharesKey) continue;
    if (candidate.paidByKey !== target.paidByKey) continue;
    if (candidate.detailsKey !== target.detailsKey) continue;
    const ownerName = String(row.owner_name || '').trim() || 'Someone';
    const details = String(row.details || 'this split').trim();
    throw duplicateError(`This live split expense looks already added on ${row.divide_date} for ${candidate.totalAmount.toFixed(2)} with the same participant split. Existing item: "${details}" by ${ownerName}.`);
  }
}

async function assertLiveSplitTripPayerAllowed(client, tripId, paidBy) {
  const tid = Number(tripId || 0);
  if (!(tid > 0)) return;
  const payerKey = normalizeLiveSplitPayerName(paidBy);
  if (!payerKey || payerKey === 'you') return;
  const membersResult = await client.query(
    `SELECT member_name
     FROM live_split_trip_members
     WHERE trip_id = $1`,
    [tid]
  );
  const allowedNames = new Set(
    (membersResult.rows || [])
      .map((member) => normalizeLiveSplitPayerName(member?.member_name))
      .filter(Boolean)
  );
  if (!allowedNames.has(payerKey)) throw validationError('Trip split payer must be you or one of the trip members');
}

async function assertLiveSplitTripParticipants(client, tripId, normalizedSplits = []) {
  const tid = Number(tripId || 0);
  if (!(tid > 0)) return;
  const membersResult = await client.query(
    `SELECT friend_id, member_name, permission
     FROM live_split_trip_members
     WHERE trip_id = $1`,
    [tid]
  );
  const allowedFriendIds = new Set();
  const allowedNames = new Set();
  for (const member of (membersResult.rows || [])) {
    if (String(member?.permission || '').toLowerCase() === 'owner') continue;
    const fid = Number(member?.friend_id || 0);
    if (fid > 0) allowedFriendIds.add(fid);
    const memberName = String(member?.member_name || '').trim().toLowerCase();
    if (memberName) allowedNames.add(memberName);
  }
  const invalid = (normalizedSplits || []).filter((split) => {
    const fid = Number(split?.friend_id || 0);
    const name = String(split?.friend_name || '').trim().toLowerCase();
    if (fid > 0 && allowedFriendIds.has(fid)) return false;
    if (name && allowedNames.has(name)) return false;
    return true;
  });
  if (invalid.length) throw validationError('Trip split participants must be selected from trip members only');
}

async function syncSingleLiveSplitGroupShares(client, ownerUserId, groupId, friendIds = []) {
  const participantRows = await client.query(
    `SELECT DISTINCT s.friend_id, f.linked_user_id
     FROM live_split_splits s
     JOIN live_split_friends f ON f.id = s.friend_id
     WHERE s.group_id = $1
       AND f.user_id = $2
       AND f.deleted_at IS NULL`,
    [groupId, ownerUserId]
  );
  const participantMap = new Map();
  participantRows.rows.forEach((row) => {
    participantMap.set(Number(row.friend_id), row.linked_user_id ? Number(row.linked_user_id) : null);
  });
  const eligibleFriendIds = [...new Set((friendIds || []).map((id) => Number(id)).filter((id) => participantMap.get(id)))];
  for (const friendId of eligibleFriendIds) {
    const targetUserId = participantMap.get(friendId);
    if (!targetUserId) continue;
    await runLiveSplitGroupShareUpsertWithRecovery(client,
      `INSERT INTO live_split_group_shares (group_id, owner_user_id, friend_id, target_user_id, shared_by_user_id, owner_hidden_at, target_hidden_at, updated_at)
       VALUES ($1, $2, $3, $4, $2, NULL, NULL, NOW())
       ON CONFLICT (group_id, target_user_id)
       DO UPDATE SET friend_id = EXCLUDED.friend_id,
                     shared_by_user_id = EXCLUDED.shared_by_user_id,
                     owner_hidden_at = NULL,
                     target_hidden_at = NULL,
                     updated_at = NOW()`,
      [groupId, ownerUserId, friendId, targetUserId]
    );
  }
  const hiddenFriendIds = [...participantMap.keys()].filter((friendId) => !eligibleFriendIds.includes(friendId));
  if (hiddenFriendIds.length) {
    await client.query(
      `UPDATE live_split_group_shares
       SET owner_hidden_at = NOW(), updated_at = NOW()
       WHERE owner_user_id = $1
         AND group_id = $2
         AND friend_id = ANY($3::bigint[])`,
      [ownerUserId, groupId, hiddenFriendIds]
    );
  }
}

async function updateLiveSplitGroup(userId, groupId, data) {
  const uid = Number(userId);
  const gid = Number(groupId);
  return withTransaction(async (client) => {
    const divideDate = normalizeDateValue(data.divide_date, 'Divide date');
    const accessResult = await client.query(
      `SELECT g.id, g.user_id, g.divide_date, g.details, g.paid_by, g.total_amount, g.split_mode, g.trip_id
       FROM live_split_groups g
       WHERE g.id = $2
         AND (
           g.user_id = $1
           OR EXISTS (
             SELECT 1
             FROM live_split_group_shares share
             WHERE share.group_id = g.id
               AND share.target_user_id = $1
               AND share.owner_hidden_at IS NULL
               AND share.target_hidden_at IS NULL
           )
         )
       LIMIT 1`,
      [uid, gid]
    );
    const group = accessResult.rows[0];
    if (!group) throw new Error('Not found');
    const nextTripId = data.trip_id === undefined
      ? (group.trip_id ? Number(group.trip_id) : null)
      : (Number(data.trip_id || 0) > 0 ? Number(data.trip_id) : null);
    if (nextTripId) {
      const trip = await getLiveSplitTripAccessRow(client, uid, nextTripId);
      if (!trip) throw validationError('Live split trip not found');
      if (normalizeLiveSplitTripStatus(trip.status) !== 'active') throw validationError('Trip is completed. Re-open it to edit expenses.');
    }
    const ownerUserId = Number(group.user_id);
    const currentSplitsResult = await client.query(
      `SELECT friend_id, friend_name, share_amount
       FROM live_split_splits
       WHERE group_id = $1
       ORDER BY id`,
      [gid]
    );
    const normalizedSplits = await normalizeLiveSplitGroupSplitsForOwner(client, ownerUserId, data.splits || []);
    if (!data.allow_duplicate) {
      await assertNoDuplicateLiveSplitGroup(client, uid, {
        divide_date: divideDate,
        total_amount: data.total_amount,
        splits: normalizedSplits,
      }, gid);
    }
    if (nextTripId) {
      await assertLiveSplitTripParticipants(client, nextTripId, normalizedSplits);
      await assertLiveSplitTripPayerAllowed(client, nextTripId, data.paid_by);
    }
    const previousState = {
      divide_date: group.divide_date,
      details: group.details,
      paid_by: group.paid_by,
      total_amount: num(group.total_amount),
      splits: currentSplitsResult.rows.map((split) => ({
        friend_id: Number(split.friend_id),
        friend_name: String(split.friend_name || '').trim(),
        share_amount: num(split.share_amount),
      })),
    };
    const nextState = {
      divide_date: divideDate,
      details: data.details,
      paid_by: data.paid_by,
      total_amount: num(data.total_amount),
      splits: normalizedSplits,
      split_mode: String(data.split_mode || 'amount'),
    };
    const activitySummary = `updated the "${String(data.details || group.details || 'Live Split expense').trim()}"\nnew amount="${num(data.total_amount).toFixed(2)}"\nsplit type="${inferLiveSplitModeLabel(data.split_mode || 'amount', normalizedSplits)}"`;
    const activitySplits = [
      ...previousState.splits,
      ...normalizedSplits,
    ];

    await client.query(
      `UPDATE live_split_groups
       SET divide_date = $1,
           details = $2,
           paid_by = $3,
           total_amount = $4,
           heading = $5,
           split_mode = $6,
           trip_id = $7,
           owner_added_to_expense = FALSE,
           updated_at = NOW(),
           updated_by = $8
       WHERE id = $9`,
      [
        divideDate,
        data.details,
        data.paid_by,
        num(data.total_amount),
        data.heading || null,
        String(data.split_mode || 'equal'),
        nextTripId,
        uid,
        gid,
      ]
    );
    await client.query(
      `UPDATE live_split_group_shares
       SET added_to_expense = FALSE,
           updated_at = NOW()
       WHERE group_id = $1`,
      [gid]
    );
    await client.query('DELETE FROM live_split_splits WHERE group_id = $1', [gid]);
    for (const split of normalizedSplits) {
      await client.query(
        `INSERT INTO live_split_splits (group_id, friend_id, friend_name, share_amount)
         VALUES ($1, $2, $3, $4)`,
        [gid, split.friend_id, split.friend_name, split.share_amount]
      );
    }
    const linkedFriendIds = normalizedSplits
      .filter((split) => Number(split.friend_id) > 0)
      .map((split) => Number(split.friend_id));
    await syncSingleLiveSplitGroupShares(client, ownerUserId, gid, linkedFriendIds);
    await logLiveSplitGroupActivity(client, {
      groupId: gid,
      actorUserId: uid,
      action: 'edited',
      summary: activitySummary,
    });
    await logLiveSplitFriendActivities(client, {
      ownerUserId,
      groupId: gid,
      actorUserId: uid,
      action: 'edited',
      summary: activitySummary,
      expenseDetails: String(data.details || group.details || 'Live Split expense').trim(),
      divideDate,
      totalAmount: data.total_amount,
      splits: activitySplits,
    });
    return gid;
  });
}

async function deleteLiveSplitGroup(userId, id) {
  await withTransaction(async (client) => {
    const own = await client.query(
      `SELECT g.id, g.user_id, g.details, g.divide_date, g.total_amount
       FROM live_split_groups g
       WHERE g.id = $2
         AND (
           g.user_id = $1
           OR EXISTS (
             SELECT 1
             FROM live_split_group_shares share
             WHERE share.group_id = g.id
               AND share.target_user_id = $1
               AND share.owner_hidden_at IS NULL
               AND share.target_hidden_at IS NULL
           )
         )
       LIMIT 1`,
      [userId, id]
    );
    if (!own.rows[0]) throw new Error('Not found');
    const splitsResult = await client.query(
      `SELECT friend_id, friend_name, share_amount
       FROM live_split_splits
       WHERE group_id = $1
       ORDER BY id`,
      [id]
    );
    const activitySummary = buildLiveSplitActivitySentence('deleted', String(own.rows[0].details || 'Live Split expense').trim());
    await logLiveSplitGroupActivity(client, {
      groupId: Number(id),
      actorUserId: userId,
      action: 'deleted',
      summary: activitySummary,
    });
    await logLiveSplitFriendActivities(client, {
      ownerUserId: Number(own.rows[0].user_id || userId),
      groupId: Number(id),
      actorUserId: userId,
      action: 'deleted',
      summary: activitySummary,
      expenseDetails: String(own.rows[0].details || 'Live Split expense').trim(),
      divideDate: own.rows[0].divide_date,
      totalAmount: own.rows[0].total_amount,
      splits: splitsResult.rows.map((split) => ({
        friend_id: Number(split.friend_id),
        friend_name: String(split.friend_name || '').trim(),
        share_amount: num(split.share_amount),
      })),
    });
    await client.query('DELETE FROM live_split_group_shares WHERE group_id = $1', [id]);
    await client.query('DELETE FROM live_split_splits WHERE group_id = $1', [id]);
    await client.query('DELETE FROM live_split_groups WHERE id = $1', [id]);
  });
}

async function syncLiveSplitSessionShares(userId, sessionKey, friendIds = []) {
  const normalizedSessionKey = String(sessionKey || '').trim();
  if (!normalizedSessionKey) throw validationError('Session is required');
  const ids = [...new Set((friendIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  return withTransaction(async (client) => {
    const groupsR = await client.query(
      `SELECT id, session_id
       FROM live_split_groups
       WHERE user_id = $1
         AND (session_id = $2 OR ($2 LIKE '_solo_%' AND id = NULLIF(REPLACE($2, '_solo_', ''), '')::bigint))`,
      [userId, normalizedSessionKey]
    );
    const groups = groupsR.rows;
    if (!groups.length) throw new Error('Live split session not found');
    const groupIds = groups.map((row) => Number(row.id));

    const participantsR = await client.query(
      `SELECT DISTINCT s.group_id, s.friend_id, f.linked_user_id
       FROM live_split_splits s
       JOIN live_split_friends f ON f.id = s.friend_id
       WHERE s.group_id = ANY($1::bigint[])
         AND f.user_id = $2
         AND f.deleted_at IS NULL`,
      [groupIds, userId]
    );
    const participantMap = new Map();
    participantsR.rows.forEach((row) => {
      const friendId = Number(row.friend_id);
      if (!participantMap.has(friendId)) participantMap.set(friendId, []);
      participantMap.get(friendId).push({
        group_id: Number(row.group_id),
        target_user_id: row.linked_user_id ? Number(row.linked_user_id) : null,
      });
    });

    const eligibleFriendIds = ids.filter((friendId) => {
      const rows = participantMap.get(friendId) || [];
      return rows.some((row) => row.target_user_id);
    });
    const targetUserIds = [...new Set(eligibleFriendIds.flatMap((friendId) => {
      const rows = participantMap.get(friendId) || [];
      return rows.map((row) => row.target_user_id).filter(Boolean);
    }))];

    for (const friendId of eligibleFriendIds) {
      const rows = participantMap.get(friendId) || [];
      for (const row of rows) {
        if (!row.target_user_id) continue;
        await runLiveSplitGroupShareUpsertWithRecovery(client,
          `INSERT INTO live_split_group_shares (group_id, owner_user_id, friend_id, target_user_id, shared_by_user_id, owner_hidden_at, target_hidden_at, updated_at)
           VALUES ($1, $2, $3, $4, $2, NULL, NULL, NOW())
           ON CONFLICT (group_id, target_user_id)
           DO UPDATE SET friend_id = EXCLUDED.friend_id,
                         shared_by_user_id = EXCLUDED.shared_by_user_id,
                         owner_hidden_at = NULL,
                         target_hidden_at = NULL,
                         updated_at = NOW()`,
          [row.group_id, userId, friendId, row.target_user_id]
        );
      }
    }

    const allParticipantFriendIds = [...participantMap.keys()];
    const hiddenFriendIds = allParticipantFriendIds.filter((friendId) => !eligibleFriendIds.includes(friendId));
    if (hiddenFriendIds.length) {
      await client.query(
        `UPDATE live_split_group_shares
         SET owner_hidden_at = NOW(), updated_at = NOW()
         WHERE owner_user_id = $1
           AND group_id = ANY($2::bigint[])
           AND friend_id = ANY($3::bigint[])`,
        [userId, groupIds, hiddenFriendIds]
      );
    }

    return { shared_friend_ids: eligibleFriendIds, target_user_ids: targetUserIds };
  });
}

async function getReceivedLiveSplitShares(userId) {
  const ownerRowsR = await query(
    `SELECT DISTINCT g.user_id
     FROM live_split_groups g
     JOIN live_split_splits s ON s.group_id = g.id
     LEFT JOIN live_split_friends f
       ON f.id = s.friend_id
      AND f.user_id = g.user_id
     LEFT JOIN live_split_friends f2
       ON f2.user_id = g.user_id
      AND f2.deleted_at IS NULL
      AND f2.linked_user_id = $1::bigint
      AND (
        lower(trim(f2.name)) = lower(trim(COALESCE(s.friend_name, '')))
        OR split_part(regexp_replace(lower(trim(f2.name)), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
           = split_part(regexp_replace(lower(trim(COALESCE(s.friend_name, ''))), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
      )
     WHERE COALESCE(NULLIF(f.linked_user_id, g.user_id), 0) = $1::bigint
        OR f2.id IS NOT NULL`,
    [userId]
  );
  for (const row of (ownerRowsR.rows || [])) {
    const ownerId = Number(row?.user_id || 0);
    if (ownerId > 0) await canonicalizeLiveSplitFriendRowsForOwner(ownerId);
  }

  const shareHydrationSql = `INSERT INTO live_split_group_shares (group_id, owner_user_id, friend_id, target_user_id, shared_by_user_id)
     SELECT DISTINCT
       g.id,
       g.user_id,
       COALESCE(f2.id, f.id, s.friend_id) AS friend_id,
       $1::bigint AS target_user_id,
       g.user_id AS shared_by_user_id
     FROM live_split_groups g
     JOIN live_split_splits s ON s.group_id = g.id
     LEFT JOIN live_split_friends f
       ON f.id = s.friend_id
      AND f.user_id = g.user_id
      AND f.deleted_at IS NULL
     LEFT JOIN live_split_friends f2
       ON f2.user_id = g.user_id
      AND f2.deleted_at IS NULL
      AND f2.linked_user_id = $1::bigint
      AND (
        lower(trim(f2.name)) = lower(trim(COALESCE(s.friend_name, '')))
        OR split_part(regexp_replace(lower(trim(f2.name)), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
           = split_part(regexp_replace(lower(trim(COALESCE(s.friend_name, ''))), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
      )
     LEFT JOIN live_split_group_shares gs
       ON gs.group_id = g.id
      AND gs.target_user_id = $1::bigint
     WHERE gs.id IS NULL
       AND (
         COALESCE(NULLIF(f.linked_user_id, g.user_id), 0) = $1::bigint
         OR f2.id IS NOT NULL
       )
     ON CONFLICT (group_id, target_user_id)
     DO UPDATE SET friend_id = EXCLUDED.friend_id,
                   shared_by_user_id = EXCLUDED.shared_by_user_id,
                   owner_hidden_at = NULL,
                   target_hidden_at = NULL,
                   updated_at = NOW()`;
  try {
    await query(shareHydrationSql, [userId]);
  } catch (err) {
    const isSequenceDrift = err?.code === '23505' && String(err?.constraint || '') === 'live_split_group_shares_pkey';
    if (!isSequenceDrift) throw err;
    await query(
      `SELECT setval(
         pg_get_serial_sequence('live_split_group_shares', 'id'),
         COALESCE((SELECT MAX(id) FROM live_split_group_shares), 0) + 1,
         false
       )`
    );
    await query(shareHydrationSql, [userId]);
  }

  const normalizeSplits = (raw) => {
    if (Array.isArray(raw)) return raw;
    if (!raw) return [];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return [];
  };
  const mapRows = (rows) => rows.map((row) => ({
    ...row,
    owner_user_id: Number(row.owner_user_id),
    friend_id: Number(row.friend_id),
    target_user_id: Number(row.target_user_id),
    trip_id: row.trip_id ? Number(row.trip_id) : null,
    total_amount: num(row.total_amount),
    friend_share_amount: num(row.friend_share_amount),
    owner_added_to_expense: bool(row.owner_added_to_expense),
    added_to_expense: bool(row.added_to_expense),
    splits: normalizeSplits(row.splits).map((split) => ({
      ...split,
      linked_user_id: split.linked_user_id ? Number(split.linked_user_id) : null,
      share_amount: num(split.share_amount),
      is_paid: bool(split.is_paid),
    })),
  }));

  try {
    const result = await query(
      `SELECT
         g.id,
         g.trip_id,
         g.divide_date,
         g.details,
         g.paid_by,
         g.total_amount,
         g.split_mode,
         g.heading,
         g.session_id,
         g.owner_added_to_expense,
         owner.id AS owner_user_id,
         owner.display_name AS owner_name,
         share.friend_id,
         share.target_user_id,
         share.added_to_expense,
         fs.friend_name,
         fs.share_amount AS friend_share_amount,
         COALESCE(
           json_agg(
             json_build_object(
               'id', s.id,
               'friend_id', s.friend_id,
               'friend_name', s.friend_name,
               'linked_user_id', COALESCE(
                 NULLIF(lf.linked_user_id, g.user_id),
                 (
                   SELECT dgs.target_user_id
                   FROM live_split_group_shares dgs
                   WHERE dgs.group_id = g.id
                     AND dgs.friend_id = s.friend_id
                   ORDER BY dgs.id DESC
                   LIMIT 1
                 ),
                 (
                   SELECT f2.linked_user_id
                   FROM live_split_friends f2
                   WHERE f2.user_id = g.user_id
                     AND f2.deleted_at IS NULL
                     AND f2.linked_user_id IS NOT NULL
                     AND f2.linked_user_id <> g.user_id
                     AND (
                       lower(trim(f2.name)) = lower(trim(COALESCE(s.friend_name, '')))
                       OR split_part(regexp_replace(lower(trim(f2.name)), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
                          = split_part(regexp_replace(lower(trim(COALESCE(s.friend_name, ''))), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
                     )
                   ORDER BY
                     CASE WHEN lower(trim(f2.name)) = lower(trim(COALESCE(s.friend_name, ''))) THEN 0 ELSE 1 END,
                     f2.id
                   LIMIT 1
                 )
               ),
               'share_amount', s.share_amount,
               'is_paid', s.is_paid
             )
             ORDER BY s.id
           ) FILTER (WHERE s.id IS NOT NULL),
           '[]'::json
         ) AS splits
       FROM live_split_group_shares share
       JOIN live_split_groups g ON g.id = share.group_id
       JOIN users owner ON owner.id = share.owner_user_id
       LEFT JOIN live_split_splits fs
         ON fs.group_id = g.id
        AND fs.friend_id = share.friend_id
       LEFT JOIN live_split_splits s ON s.group_id = g.id
       LEFT JOIN live_split_friends lf ON lf.id = s.friend_id
       WHERE share.target_user_id = $1
         AND share.owner_hidden_at IS NULL
         AND share.target_hidden_at IS NULL
       GROUP BY g.id, owner.id, owner.display_name, share.friend_id, share.target_user_id, fs.friend_name, fs.share_amount
       ORDER BY g.divide_date DESC, g.id DESC`,
      [userId]
    );
    return mapRows(result.rows || []);
  } catch (error) {
    const fallback = await query(
      `SELECT
         g.id,
         g.trip_id,
         g.divide_date,
         g.details,
         g.paid_by,
         g.total_amount,
         g.split_mode,
         g.heading,
         g.session_id,
         g.owner_added_to_expense,
         owner.id AS owner_user_id,
         owner.display_name AS owner_name,
         share.friend_id,
         share.target_user_id,
         share.added_to_expense,
         fs.friend_name,
         fs.share_amount AS friend_share_amount,
         '[]'::json AS splits
       FROM live_split_group_shares share
       JOIN live_split_groups g ON g.id = share.group_id
       JOIN users owner ON owner.id = share.owner_user_id
       LEFT JOIN live_split_splits fs
         ON fs.group_id = g.id
        AND fs.friend_id = share.friend_id
       WHERE share.target_user_id = $1
         AND share.owner_hidden_at IS NULL
         AND share.target_hidden_at IS NULL
       ORDER BY g.divide_date DESC, g.id DESC`,
      [userId]
    );
    const rows = mapRows(fallback.rows || []);
    for (const row of rows) {
      const splitsResult = await query(
        `SELECT
           s.id,
           s.friend_id,
           s.friend_name,
           COALESCE(
             NULLIF(lf.linked_user_id, $2::bigint),
             (
               SELECT dgs.target_user_id
               FROM live_split_group_shares dgs
               WHERE dgs.group_id = s.group_id
                 AND dgs.friend_id = s.friend_id
               ORDER BY dgs.id DESC
               LIMIT 1
             ),
             (
               SELECT f2.linked_user_id
               FROM live_split_friends f2
               WHERE f2.user_id = $2::bigint
                 AND f2.deleted_at IS NULL
                 AND f2.linked_user_id IS NOT NULL
                 AND f2.linked_user_id <> $2::bigint
                 AND (
                   lower(trim(f2.name)) = lower(trim(COALESCE(s.friend_name, '')))
                   OR split_part(regexp_replace(lower(trim(f2.name)), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
                      = split_part(regexp_replace(lower(trim(COALESCE(s.friend_name, ''))), '[^a-z0-9 ]', ' ', 'g'), ' ', 1)
                 )
               ORDER BY
                 CASE WHEN lower(trim(f2.name)) = lower(trim(COALESCE(s.friend_name, ''))) THEN 0 ELSE 1 END,
                 f2.id
               LIMIT 1
             )
           ) AS linked_user_id,
           s.share_amount,
           s.is_paid
         FROM live_split_splits s
         LEFT JOIN live_split_friends lf ON lf.id = s.friend_id
         WHERE s.group_id = $1
         ORDER BY s.id`,
        [row.id, Number(row.owner_user_id || 0)]
      );
      row.splits = (splitsResult.rows || []).map((split) => ({
        ...split,
        linked_user_id: split.linked_user_id ? Number(split.linked_user_id) : null,
        share_amount: num(split.share_amount),
        is_paid: bool(split.is_paid),
      }));
    }
    return rows;
  }
}

async function hideReceivedLiveSplitShare(userId, ownerUserId, sessionKey) {
  const normalizedSessionKey = String(sessionKey || '').trim();
  if (!normalizedSessionKey) throw validationError('Session is required');
  await query(
    `UPDATE live_split_group_shares share
     SET target_hidden_at = NOW(), updated_at = NOW()
     FROM live_split_groups g
     WHERE share.group_id = g.id
       AND share.target_user_id = $1
       AND share.owner_user_id = $2
       AND (g.session_id = $3 OR ($3 LIKE '_solo_%' AND g.id = NULLIF(REPLACE($3, '_solo_', ''), '')::bigint))`,
    [userId, ownerUserId, normalizedSessionKey]
  );
}

async function getLoanTransactions(userId, friendId) {
  const result = await query(
    `SELECT *
     FROM loan_transactions
     WHERE user_id = $1 AND friend_id = $2 AND deleted_at IS NULL
     ORDER BY txn_date DESC, id DESC`,
    [userId, friendId]
  );
  return result.rows.map((row) => ({ ...row, paid: num(row.paid), received: num(row.received) }));
}

async function addLoanTransaction(userId, data) {
  const details = normalizeText(data.details, 'Transaction details', 240);
  const txnDate = normalizeDateValue(data.txn_date, 'Transaction date');
  const paid = Math.max(0, num(data.paid));
  const received = Math.max(0, num(data.received));
  if (!Number(data.friend_id)) throw validationError('Friend is required');
  if (paid <= 0 && received <= 0) throw validationError('Enter a paid or received amount');
  const result = await query(
    `INSERT INTO loan_transactions (user_id, friend_id, txn_date, details, paid, received)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, data.friend_id, txnDate, details, paid, received]
  );
  return Number(result.rows[0].id);
}

async function updateLoanTransaction(userId, id, data) {
  const details = normalizeText(data.details, 'Transaction details', 240);
  const txnDate = normalizeDateValue(data.txn_date, 'Transaction date');
  const paid = Math.max(0, num(data.paid));
  const received = Math.max(0, num(data.received));
  if (paid <= 0 && received <= 0) throw validationError('Enter a paid or received amount');
  await query(
    `UPDATE loan_transactions
     SET txn_date = $1, details = $2, paid = $3, received = $4, updated_at = NOW(), updated_by = $6
     WHERE id = $5 AND user_id = $6`,
    [txnDate, details, paid, received, id, userId]
  );
}

async function deleteLoanTransaction(userId, id) {
  await query(
    `UPDATE loan_transactions
     SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW(), updated_by = $1
     WHERE id = $2 AND user_id = $1`,
    [userId, id]
  );
}

async function getDivideGroups(userId) {
  const result = await query(
    `SELECT
       g.*,
       COALESCE((
         SELECT json_agg(
           json_build_object(
             'friend_id', dgs.friend_id,
             'target_user_id', dgs.target_user_id
           )
           ORDER BY dgs.friend_id
         )
         FROM divide_group_shares dgs
         WHERE dgs.group_id = g.id
           AND dgs.owner_hidden_at IS NULL
           AND dgs.target_hidden_at IS NULL
       ), '[]'::json) AS shared_targets,
       COALESCE(
         json_agg(
           json_build_object(
             'id', s.id,
             'group_id', s.group_id,
             'friend_id', s.friend_id,
             'friend_name', s.friend_name,
             'share_amount', s.share_amount,
             'is_paid', s.is_paid
           )
           ORDER BY s.id
         ) FILTER (WHERE s.id IS NOT NULL),
         '[]'::json
       ) AS splits
     FROM divide_groups g
     LEFT JOIN divide_splits s ON s.group_id = g.id
     WHERE g.user_id = $1
     GROUP BY g.id
     ORDER BY g.divide_date DESC, g.id DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    ...row,
    total_amount: num(row.total_amount),
    shared_targets: (row.shared_targets || []).map((item) => ({
      friend_id: Number(item.friend_id),
      target_user_id: Number(item.target_user_id),
    })),
    splits: (row.splits || []).map((split) => ({ ...split, share_amount: num(split.share_amount), is_paid: bool(split.is_paid) })),
  }));
}

async function addDivideGroup(userId, data) {
  return withTransaction(async (client) => {
    const divideDate = normalizeDateValue(data.divide_date, 'Divide date');
    const groupResult = await client.query(
      `INSERT INTO divide_groups (user_id, divide_date, details, paid_by, total_amount, heading, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, divideDate, data.details, data.paid_by, data.total_amount, data.heading || null, data.session_id || null]
    );
    const groupId = Number(groupResult.rows[0].id);
    for (const split of data.splits || []) {
      await client.query(
        `INSERT INTO divide_splits (group_id, friend_id, friend_name, share_amount)
         VALUES ($1, $2, $3, $4)`,
        [groupId, split.friend_id, split.friend_name, split.share_amount]
      );
    }
    for (const loan of data.auto_loans || []) {
      await client.query(
        `INSERT INTO loan_transactions (user_id, friend_id, txn_date, details, paid, received)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, loan.friend_id, divideDate, `Split: ${data.details}`, loan.paid, loan.received]
      );
    }
    return groupId;
  });
}

async function deleteDivideGroup(userId, id) {
  await withTransaction(async (client) => {
    const own = await client.query('SELECT id FROM divide_groups WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
    if (!own.rows[0]) throw new Error('Not found');
    await client.query('DELETE FROM divide_group_shares WHERE group_id = $1', [id]);
    await client.query('DELETE FROM divide_splits WHERE group_id = $1', [id]);
    await client.query('DELETE FROM divide_groups WHERE id = $1', [id]);
  });
}

async function syncDivideSessionShares(userId, sessionKey, friendIds = []) {
  const normalizedSessionKey = String(sessionKey || '').trim();
  if (!normalizedSessionKey) throw validationError('Session is required');
  const ids = [...new Set((friendIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  return withTransaction(async (client) => {
    const groupsR = await client.query(
      `SELECT id, session_id
       FROM divide_groups
       WHERE user_id = $1
         AND (session_id = $2 OR ($2 LIKE '_solo_%' AND id = NULLIF(REPLACE($2, '_solo_', ''), '')::bigint))`,
      [userId, normalizedSessionKey]
    );
    const groups = groupsR.rows;
    if (!groups.length) throw new Error('Split session not found');
    const groupIds = groups.map((row) => Number(row.id));

    const participantsR = await client.query(
      `SELECT DISTINCT s.group_id, s.friend_id, f.linked_user_id
       FROM divide_splits s
       JOIN friends f ON f.id = s.friend_id
       WHERE s.group_id = ANY($1::bigint[])
         AND f.user_id = $2
         AND f.deleted_at IS NULL`,
      [groupIds, userId]
    );
    const participantMap = new Map();
    participantsR.rows.forEach((row) => {
      const friendId = Number(row.friend_id);
      if (!participantMap.has(friendId)) participantMap.set(friendId, []);
      participantMap.get(friendId).push({
        group_id: Number(row.group_id),
        target_user_id: row.linked_user_id ? Number(row.linked_user_id) : null,
      });
    });

    const eligibleFriendIds = ids.filter((friendId) => {
      const rows = participantMap.get(friendId) || [];
      return rows.some((row) => row.target_user_id);
    });
    const targetUserIds = [...new Set(eligibleFriendIds.flatMap((friendId) => {
      const rows = participantMap.get(friendId) || [];
      return rows.map((row) => row.target_user_id).filter(Boolean);
    }))];

    for (const friendId of eligibleFriendIds) {
      const rows = participantMap.get(friendId) || [];
      for (const row of rows) {
        if (!row.target_user_id) continue;
        await client.query(
          `INSERT INTO divide_group_shares (group_id, owner_user_id, friend_id, target_user_id, shared_by_user_id, owner_hidden_at, target_hidden_at, updated_at)
           VALUES ($1, $2, $3, $4, $2, NULL, NULL, NOW())
           ON CONFLICT (group_id, target_user_id)
           DO UPDATE SET friend_id = EXCLUDED.friend_id,
                         shared_by_user_id = EXCLUDED.shared_by_user_id,
                         owner_hidden_at = NULL,
                         target_hidden_at = NULL,
                         updated_at = NOW()`,
          [row.group_id, userId, friendId, row.target_user_id]
        );
      }
    }

    const allParticipantFriendIds = [...participantMap.keys()];
    const hiddenFriendIds = allParticipantFriendIds.filter((friendId) => !eligibleFriendIds.includes(friendId));
    if (hiddenFriendIds.length) {
      await client.query(
        `UPDATE divide_group_shares
         SET owner_hidden_at = NOW(), updated_at = NOW()
         WHERE owner_user_id = $1
           AND group_id = ANY($2::bigint[])
           AND friend_id = ANY($3::bigint[])`,
        [userId, groupIds, hiddenFriendIds]
      );
    }

    return { shared_friend_ids: eligibleFriendIds, target_user_ids: targetUserIds };
  });
}

async function getReceivedDivideShares(userId) {
  const result = await query(
    `SELECT
       g.id,
       g.divide_date,
       g.details,
       g.paid_by,
       g.total_amount,
       g.heading,
       g.session_id,
       owner.id AS owner_user_id,
       owner.display_name AS owner_name,
       share.friend_id,
       share.target_user_id,
       fs.friend_name,
       fs.share_amount AS friend_share_amount,
       COALESCE(
         json_agg(
           json_build_object(
             'id', s.id,
             'friend_id', s.friend_id,
             'friend_name', s.friend_name,
             'share_amount', s.share_amount,
             'is_paid', s.is_paid
           )
           ORDER BY s.id
         ) FILTER (WHERE s.id IS NOT NULL),
         '[]'::json
       ) AS splits
     FROM divide_group_shares share
     JOIN divide_groups g ON g.id = share.group_id
     JOIN users owner ON owner.id = share.owner_user_id
     LEFT JOIN divide_splits fs
       ON fs.group_id = g.id
      AND fs.friend_id = share.friend_id
     LEFT JOIN divide_splits s ON s.group_id = g.id
     WHERE share.target_user_id = $1
       AND share.owner_hidden_at IS NULL
       AND share.target_hidden_at IS NULL
     GROUP BY g.id, owner.id, owner.display_name, share.friend_id, share.target_user_id, fs.friend_name, fs.share_amount
     ORDER BY g.divide_date DESC, g.id DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    ...row,
    owner_user_id: Number(row.owner_user_id),
    friend_id: Number(row.friend_id),
    target_user_id: Number(row.target_user_id),
    total_amount: num(row.total_amount),
    friend_share_amount: num(row.friend_share_amount),
    splits: (row.splits || []).map((split) => ({ ...split, share_amount: num(split.share_amount), is_paid: bool(split.is_paid) })),
  }));
}

async function hideReceivedDivideShare(userId, ownerUserId, sessionKey) {
  const normalizedSessionKey = String(sessionKey || '').trim();
  if (!normalizedSessionKey) throw validationError('Session is required');
  await query(
    `UPDATE divide_group_shares share
     SET target_hidden_at = NOW(), updated_at = NOW()
     FROM divide_groups g
     WHERE share.group_id = g.id
       AND share.target_user_id = $1
       AND share.owner_user_id = $2
       AND (g.session_id = $3 OR ($3 LIKE '_solo_%' AND g.id = NULLIF(REPLACE($3, '_solo_', ''), '')::bigint))`,
    [userId, ownerUserId, normalizedSessionKey]
  );
}

async function getDashboardData(userId, year) {
  const yearStr = String(year || new Date().getFullYear());
  const currentYear = String(new Date().getFullYear());
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

  const [monthlyTotalsR, monthlyByTypeR, topItemsR, spendBreakdownR, yearTotalR, monthTotalR, recentExpensesR, yearsR] = await Promise.all([
    query(
      `SELECT to_char(purchase_date, 'MM') AS month, SUM(amount) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()} AND deleted_at IS NULL
       GROUP BY month ORDER BY month`,
      [userId, yearStr]
    ),
    query(
      `SELECT to_char(purchase_date, 'MM') AS month, is_extra, SUM(amount) AS total
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND deleted_at IS NULL
       GROUP BY month, is_extra
       ORDER BY month`,
      [userId, yearStr]
    ),
    query(
      `SELECT item_name, SUM(amount) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()} AND deleted_at IS NULL
       GROUP BY item_name
       ORDER BY total DESC
       LIMIT 10`,
      [userId, yearStr]
    ),
    query(
      `SELECT is_extra, SUM(amount) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()} AND deleted_at IS NULL
       GROUP BY is_extra`,
      [userId, yearStr]
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()} AND deleted_at IS NULL`,
      [userId, yearStr]
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND to_char(purchase_date, 'MM') = $3 AND deleted_at IS NULL`,
      [userId, currentYear, currentMonth]
    ),
    query(
      `SELECT *
       FROM expenses
       WHERE user_id = $1 AND ${yearGuardSql()} AND deleted_at IS NULL
       ORDER BY purchase_date DESC, id DESC
       LIMIT 5`,
      [userId]
    ),
    query(
      `SELECT DISTINCT to_char(purchase_date, 'YYYY') AS year
       FROM expenses
       WHERE user_id = $1 AND EXTRACT(YEAR FROM purchase_date)::int BETWEEN 2018 AND $2 AND deleted_at IS NULL
       ORDER BY year DESC`,
      [userId, new Date().getFullYear() + 1]
    )
  ]);

  let liveSplitFriends = [];
  let liveSplitGroups = [];
  let liveSplitSharedGroups = [];
  try {
    [liveSplitFriends, liveSplitGroups, liveSplitSharedGroups] = await Promise.all([
      getLiveSplitFriends(userId),
      getLiveSplitGroups(userId),
      getReceivedLiveSplitShares(userId),
    ]);
  } catch (err) {
    console.error('[dashboard] live split summary fallback:', err?.message || err);
  }

  const liveSplitSummary = computeLiveSplitDashboardSummary(
    userId,
    Array.isArray(liveSplitFriends) ? liveSplitFriends : [],
    Array.isArray(liveSplitGroups) ? liveSplitGroups : [],
    Array.isArray(liveSplitSharedGroups) ? liveSplitSharedGroups : []
  );
  const totalOwed = liveSplitSummary.totals.oweToMe;
  const totalOwe = liveSplitSummary.totals.iOwe;
  const years = yearsR.rows.map((row) => row.year);
  if (!years.includes(yearStr)) years.unshift(yearStr);

  return {
    monthlyTotals: monthlyTotalsR.rows.map((row) => ({ ...row, total: num(row.total), count: Number(row.count) })),
    monthlyByType: monthlyByTypeR.rows.map((row) => ({ ...row, total: num(row.total), is_extra: bool(row.is_extra) })),
    topItems: topItemsR.rows.map((row) => ({ ...row, total: num(row.total), count: Number(row.count) })),
    spendBreakdown: spendBreakdownR.rows.map((row) => ({ ...row, total: num(row.total), count: Number(row.count), is_extra: bool(row.is_extra) })),
    yearTotal: { total: num(yearTotalR.rows[0]?.total), count: Number(yearTotalR.rows[0]?.count || 0) },
    monthTotal: { total: num(monthTotalR.rows[0]?.total), count: Number(monthTotalR.rows[0]?.count || 0) },
    totalOwed: Math.round(totalOwed * 100) / 100,
    totalOwe: Math.round(totalOwe * 100) / 100,
    owedCount: Number(liveSplitSummary.totals.owedCount || 0),
    oweCount: Number(liveSplitSummary.totals.oweCount || 0),
    friendCount: Number(liveSplitSummary.rows.length || 0),
    balanceSource: 'live_split',
    recentExpenses: recentExpensesR.rows.map((row) => ({ ...row, amount: num(row.amount) })),
    years,
    selectedYear: yearStr,
  };
}

async function getPublicSiteStats() {
  const [usersResult, expensesResult, metricsResult] = await Promise.all([
    query(
      `SELECT COUNT(*)::bigint AS total
       FROM users
       WHERE deleted_at IS NULL
         AND is_active = TRUE`
    ),
    query(
      `SELECT COUNT(*)::bigint AS total
       FROM expenses
       WHERE deleted_at IS NULL`
    ),
    query(
      `SELECT metric_key, metric_value, updated_at
       FROM public_site_metrics`
    ),
  ]);
  const metricMap = new Map((metricsResult.rows || []).map((row) => [
    String(row.metric_key || '').trim(),
    {
      value: Number(row.metric_value || 0),
      updated_at: row.updated_at || null,
    },
  ]));
  return {
    unique_users: Number(usersResult.rows?.[0]?.total || 0),
    expense_items: Number(expensesResult.rows?.[0]?.total || 0),
    app_downloads: Number(metricMap.get('app_downloads')?.value || 0),
    daily_visitors: Number(metricMap.get('daily_visitors')?.value || 0),
    updated_at: metricMap.get('daily_visitors')?.updated_at || metricMap.get('app_downloads')?.updated_at || null,
  };
}

async function getAdminExpenseStats() {
  const [expenseResult, usersResult] = await Promise.all([
    query(
      `SELECT COUNT(*)::bigint AS total
       FROM expenses
       WHERE deleted_at IS NULL`
    ),
    query(
      `SELECT
         u.id,
         u.username,
         u.display_name,
         u.email,
         u.mobile,
         COUNT(e.id)::bigint AS expense_items
       FROM users u
       LEFT JOIN expenses e
         ON e.user_id = u.id
        AND e.deleted_at IS NULL
       WHERE u.deleted_at IS NULL
       GROUP BY u.id, u.username, u.display_name, u.email, u.mobile
       ORDER BY COUNT(e.id) DESC, lower(coalesce(u.display_name, u.username, '')) ASC`
    ),
  ]);
  return {
    expense_items: Number(expenseResult.rows?.[0]?.total || 0),
    users: (usersResult.rows || []).map((row) => ({
      id: Number(row.id),
      username: row.username || '',
      display_name: row.display_name || '',
      email: row.email || '',
      mobile: row.mobile || '',
      expense_items: Number(row.expense_items || 0),
    })),
  };
}

async function upsertPublicSiteMetrics(data = {}) {
  const entries = Object.entries(data || {})
    .map(([key, value]) => [String(key || '').trim(), Number(value)])
    .filter(([key, value]) => key && Number.isFinite(value) && value >= 0);
  if (!entries.length) return getPublicSiteStats();
  await withTransaction(async (client) => {
    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO public_site_metrics (metric_key, metric_value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (metric_key)
         DO UPDATE SET metric_value = EXCLUDED.metric_value,
                       updated_at = NOW()`,
        [key, Math.round(value)]
      );
    }
  });
  return getPublicSiteStats();
}

async function getReportYears(userId) {
  const result = await query(
    `SELECT
       to_char(purchase_date, 'YYYY') AS year,
       SUM(amount) AS total,
       SUM(CASE WHEN is_extra = FALSE THEN amount ELSE 0 END) AS fair,
       SUM(CASE WHEN is_extra = TRUE THEN amount ELSE 0 END) AS extra,
       COUNT(*) AS count
     FROM expenses
     WHERE user_id = $1 AND ${yearGuardSql()} AND deleted_at IS NULL
     GROUP BY year
     ORDER BY year DESC`,
    [userId]
  );
  return result.rows.map((row) => ({ ...row, total: num(row.total), fair: num(row.fair), extra: num(row.extra), count: Number(row.count) }));
}

async function getReportMonths(userId, year) {
  const result = await query(
    `SELECT
       to_char(purchase_date, 'MM') AS month,
       SUM(amount) AS total,
       SUM(CASE WHEN is_extra = FALSE THEN amount ELSE 0 END) AS fair,
       SUM(CASE WHEN is_extra = TRUE THEN amount ELSE 0 END) AS extra,
       COUNT(*) AS count
     FROM expenses
     WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()} AND deleted_at IS NULL
     GROUP BY month
     ORDER BY month`,
    [userId, String(year)]
  );
  return result.rows.map((row) => ({ ...row, total: num(row.total), fair: num(row.fair), extra: num(row.extra), count: Number(row.count) }));
}

async function _checkTripEdit(userId, tripId) {
  const owner = await query('SELECT id FROM trips WHERE id = $1 AND user_id = $2 LIMIT 1', [tripId, userId]);
  if (owner.rows[0]) return true;
  const member = await query('SELECT permission FROM trip_members WHERE trip_id = $1 AND linked_user_id = $2 LIMIT 1', [tripId, userId]);
  return !!(member.rows[0] && publicTripPermission(member.rows[0].permission) !== 'view');
}

async function _getTripStatus(tripId, client = null) {
  const run = client || { query };
  const tripR = await run.query('SELECT status FROM trips WHERE id = $1 LIMIT 1', [tripId]);
  return tripR.rows[0]?.status || null;
}

async function _assertTripExpenseEditable(userId, tripId, client = null) {
  if (!(await _checkTripEdit(userId, tripId))) throw new Error('Trip not found');
  const status = await _getTripStatus(tripId, client);
  if (status === 'completed') throw validationError('Re-open the trip before changing expenses');
}

async function _loadTripFinalizeData(userId, tripId, client) {
  const tripR = await client.query(
    `SELECT id, user_id, name, status
     FROM trips
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [tripId, userId]
  );
  const trip = tripR.rows[0];
  if (!trip) throw new Error('Trip not found');

  const [membersR, expenses] = await Promise.all([
    client.query(
      `SELECT *
       FROM trip_members
       WHERE trip_id = $1
         AND permission NOT IN ('share_view', 'share_edit')`,
      [tripId]
    ),
    _loadNormalizedTripExpenses(client, tripId),
  ]);

  return { ...trip, members: membersR.rows, expenses };
}

function _buildTripSettlementSnapshot(trip, friendIdOverrides = {}, selfMemberKey = null) {
  const peopleMap = {};
  const explicitSelfKey = String(selfMemberKey || '').trim();
  const aliasToCanonical = new Map();
  for (const member of (trip.members || [])) {
    const memberKey = member.friend_id != null
      ? String(member.friend_id)
      : member.linked_user_id != null
        ? `u${member.linked_user_id}`
        : member.id != null
          ? `m${member.id}`
          : 'self';
    const stableIdKey = member.id != null ? String(member.id) : '';
    const key = explicitSelfKey && memberKey === explicitSelfKey ? 'self' : memberKey;
    peopleMap[key] = {
      key,
      name: member.member_name,
      friendId: member.friend_id || friendIdOverrides[memberKey] || friendIdOverrides[key] || null,
      totalShare: 0,
      totalGave: 0,
    };
    aliasToCanonical.set(String(memberKey), key);
    if (stableIdKey) aliasToCanonical.set(stableIdKey, key);
  }

  for (const expense of (trip.expenses || [])) {
    for (const split of (expense.splits || [])) {
      const rawSplitKey = String(split.member_key || '');
      const splitKey = aliasToCanonical.get(rawSplitKey)
        || (explicitSelfKey && rawSplitKey === explicitSelfKey ? 'self' : rawSplitKey);
      if (peopleMap[splitKey]) peopleMap[splitKey].totalShare += num(split.share_amount);
    }
    const rawPaidByKey = String(expense.paid_by_key || '');
    const paidByKey = aliasToCanonical.get(rawPaidByKey)
      || (explicitSelfKey && rawPaidByKey === explicitSelfKey ? 'self' : rawPaidByKey);
    if (peopleMap[paidByKey]) peopleMap[paidByKey].totalGave += num(expense.amount);
  }

  return peopleMap;
}

const TRIP_ALLOWED_STATUSES = new Set(['pending', 'upcoming', 'ongoing', 'completed', 'cancelled']);

function normalizeTripStatus(value, fallback = 'upcoming') {
  const status = String(value || fallback).trim().toLowerCase();
  if (!TRIP_ALLOWED_STATUSES.has(status)) throw validationError('Trip status is invalid');
  return status;
}

function normalizeTripDistance(value) {
  if (value === undefined || value === null || value === '') return null;
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance < 0) throw validationError('Total distance must be 0 or more');
  return Math.round(distance * 100) / 100;
}

function normalizeTripMembers(members) {
  if (!Array.isArray(members)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const member of members) {
    const memberName = normalizeOptionalText(typeof member === 'string' ? member : member?.member_name, 80);
    if (!memberName) continue;
    const key = memberName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({
      member_name: memberName,
      friend_id: typeof member === 'string' ? null : (member?.friend_id != null ? Number(member.friend_id) || null : null),
      linked_user_id: typeof member === 'string' ? null : (member?.linked_user_id != null ? Number(member.linked_user_id) || null : null),
      permission: typeof member === 'string' ? 'edit' : String(member?.permission || 'edit').trim().toLowerCase(),
    });
  }
  return cleaned;
}

function isTripAccessOnlyPermission(permission) {
  const raw = String(permission || '').trim().toLowerCase();
  return raw === 'share_view' || raw === 'share_edit';
}

function normalizeTripStoredPermission(permission, fallback = 'edit') {
  const raw = String(permission || fallback).trim().toLowerCase();
  if (['view', 'edit', 'share_view', 'share_edit'].includes(raw)) return raw;
  return fallback;
}

function normalizeTripSharedUserPermission(permission, fallback = 'view') {
  const raw = String(permission || fallback).trim().toLowerCase();
  return raw === 'edit' ? 'share_edit' : 'share_view';
}

function publicTripPermission(permission) {
  const raw = normalizeTripStoredPermission(permission, 'view');
  if (raw === 'share_edit') return 'edit';
  if (raw === 'share_view') return 'view';
  return raw;
}

function normalizeTripExpenseType(value) {
  return normalizeText(value || 'Other', 'Expense type', 60);
}

function normalizeCoreCurrencyCode(code, fallback = 'INR') {
  const raw = String(code || fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(raw)) throw validationError('Currency code is invalid');
  return raw;
}

async function getUserCurrencyCode(userId, client = null) {
  const run = client || { query };
  const result = await run.query('SELECT currency_code FROM users WHERE id = $1 LIMIT 1', [userId]);
  return normalizeCoreCurrencyCode(result.rows[0]?.currency_code || 'INR');
}

async function getAdminCurrencyRates() {
  const result = await query(
    `SELECT currency_code, rate_to_inr, is_active, updated_at
     FROM currency_rates
     ORDER BY currency_code ASC`
  );
  return result.rows.map((row) => ({
    currency_code: normalizeCoreCurrencyCode(row.currency_code),
    rate_to_inr: Number(row.rate_to_inr),
    is_active: !!row.is_active,
    updated_at: row.updated_at,
  }));
}

async function upsertAdminCurrencyRate(data = {}) {
  const currencyCode = normalizeCoreCurrencyCode(data.currency_code);
  const rateToInr = Number(data.rate_to_inr);
  if (!Number.isFinite(rateToInr) || rateToInr <= 0) throw validationError('Rate to INR must be greater than 0');
  const isActive = data.is_active === undefined ? true : !!data.is_active;
  await query(
    `INSERT INTO currency_rates (currency_code, rate_to_inr, is_active, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (currency_code) DO UPDATE
     SET rate_to_inr = EXCLUDED.rate_to_inr,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
    [currencyCode, Math.round(rateToInr * 1000000) / 1000000, isActive]
  );
  return { success: true };
}

async function deleteAdminCurrencyRate(currencyCode) {
  const code = normalizeCoreCurrencyCode(currencyCode);
  if (code === 'INR') throw validationError('INR cannot be deleted');
  await query('DELETE FROM currency_rates WHERE currency_code = $1', [code]);
}

async function getAvailableCurrencyRates(userId) {
  const userCurrencyCode = await getUserCurrencyCode(userId);
  const rows = await getAdminCurrencyRates();
  const activeRows = rows.filter((row) => row.is_active || row.currency_code === userCurrencyCode || row.currency_code === 'INR');
  const rateMap = new Map(activeRows.map((row) => [row.currency_code, Number(row.rate_to_inr)]));
  if (!rateMap.has('INR')) rateMap.set('INR', 1);
  if (!rateMap.has(userCurrencyCode)) {
    if (userCurrencyCode === 'INR') rateMap.set('INR', 1);
    else rateMap.set(userCurrencyCode, 1);
  }
  const defaultRate = Number(rateMap.get(userCurrencyCode) || 1);
  return {
    base_currency_code: 'INR',
    user_currency_code: userCurrencyCode,
    currencies: Array.from(rateMap.entries())
      .map(([currencyCode, rateToInr]) => ({
        currency_code: currencyCode,
        rate_to_inr: rateToInr,
        conversion_rate_to_default: currencyCode === userCurrencyCode
          ? 1
          : Math.round((rateToInr / defaultRate) * 1000000) / 1000000,
      }))
      .sort((a, b) => a.currency_code.localeCompare(b.currency_code)),
  };
}

function mapTripExpenseRow(row) {
  const quantity = row.quantity == null ? null : num(row.quantity);
  const unitPrice = row.unit_price == null ? null : num(row.unit_price);
  const amount = num(row.amount);
  return {
    id: Number(row.id),
    trip_id: Number(row.trip_id),
    expense_type: row.expense_type || 'Other',
    details: row.details || '',
    quantity,
    unit_price: unitPrice,
    amount,
    original_currency_code: row.original_currency_code || null,
    original_amount: row.original_amount == null ? null : num(row.original_amount),
    conversion_rate: row.conversion_rate == null ? null : Number(row.conversion_rate),
    expense_date: row.expense_date,
    notes: row.notes || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeTripExpensePayload(data = {}, userCurrencyCode = 'INR') {
  const details = normalizeText(data.details || data.item_name, 'Expense detail', 160);
  const expenseType = normalizeTripExpenseType(data.expense_type);
  const expenseDate = normalizeDateValue(data.expense_date || new Date().toISOString().slice(0, 10), 'Expense date');
  const defaultCurrencyCode = normalizeCoreCurrencyCode(userCurrencyCode || 'INR');
  const originalCurrencyCode = normalizeCoreCurrencyCode(data.original_currency_code || defaultCurrencyCode);
  const originalAmount = data.original_amount === undefined || data.original_amount === null || data.original_amount === ''
    ? null
    : normalizeAmount(data.original_amount, 'Original amount');
  const conversionRate = data.conversion_rate === undefined || data.conversion_rate === null || data.conversion_rate === ''
    ? null
    : Number(data.conversion_rate);
  if (conversionRate != null && (!Number.isFinite(conversionRate) || conversionRate <= 0)) {
    throw validationError('Conversion rate must be greater than 0');
  }
  const quantity = data.quantity === undefined || data.quantity === null || data.quantity === '' ? null : Number(data.quantity);
  if (quantity != null && (!Number.isFinite(quantity) || quantity <= 0)) throw validationError('Quantity must be greater than 0');
  const unitPrice = data.unit_price === undefined || data.unit_price === null || data.unit_price === '' ? null : Number(data.unit_price);
  if (unitPrice != null && (!Number.isFinite(unitPrice) || unitPrice < 0)) throw validationError('Price must be 0 or more');
  const derivedAmount = originalAmount != null
    ? originalCurrencyCode === defaultCurrencyCode
      ? originalAmount
      : (conversionRate != null ? originalAmount * conversionRate : null)
    : null;
  const amountInput = data.amount !== undefined && data.amount !== null && data.amount !== ''
    ? data.amount
    : (derivedAmount != null ? derivedAmount : (quantity != null && unitPrice != null ? quantity * unitPrice : 0));
  const amount = normalizeAmount(
    amountInput,
    'Expense total'
  );
  if (originalCurrencyCode !== defaultCurrencyCode && originalAmount != null && conversionRate == null) {
    throw validationError(`Conversion rate is required for ${originalCurrencyCode} expenses`);
  }
  const paidByKey = normalizeTripMemberKeyValue(data.paid_by_key || 'self') || 'self';
  const paidByName = normalizeText(data.paid_by_name || 'You', 'Paid by', 80);
  const splitMode = normalizeTripSplitModeValue(data.split_mode || 'equal');
  const rawSplits = Array.isArray(data.splits) ? data.splits : [];
  const splits = rawSplits.length
    ? rawSplits.map((split) => ({
        member_key: normalizeTripMemberKeyValue(split?.member_key || ''),
        member_name: normalizeText(split?.member_name || 'Member', 'Member name', 80),
        share_amount: normalizeAmount(split?.share_amount, 'Share amount'),
      }))
    : [{
        member_key: paidByKey,
        member_name: paidByName,
        share_amount: amount,
      }];
  const totalShares = Math.round(splits.reduce((sum, split) => sum + num(split.share_amount), 0) * 100) / 100;
  if (Math.abs(totalShares - amount) > 0.05) throw validationError('Split total must match expense total');
  return {
    details,
    expense_type: expenseType,
    quantity: quantity == null ? 1 : Math.round(quantity * 100) / 100,
    unit_price: unitPrice == null ? amount : Math.round(unitPrice * 100) / 100,
    amount,
    original_currency_code: originalCurrencyCode,
    original_amount: originalAmount == null ? amount : originalAmount,
    conversion_rate: originalCurrencyCode === defaultCurrencyCode
      ? 1
      : Math.round((conversionRate || 0) * 1000000) / 1000000,
    expense_date: expenseDate,
    notes: normalizeOptionalText(data.notes, 300),
    paid_by_key: paidByKey,
    paid_by_name: paidByName,
    split_mode: splitMode,
    splits,
  };
}

function normalizeTripItineraryTitle(value) {
  return normalizeText(value, 'Itinerary title', 140);
}

function normalizeTripItineraryTime(value, fieldLabel) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) throw validationError(`${fieldLabel} is invalid`);
  const [hourText, minuteText] = text.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw validationError(`${fieldLabel} is invalid`);
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function normalizeTripItineraryPayload(data = {}) {
  const itineraryDate = normalizeDateValue(data.itinerary_date || data.date, 'Itinerary date');
  const startTime = normalizeTripItineraryTime(data.start_time, 'Start time');
  const endTime = normalizeTripItineraryTime(data.end_time, 'End time');
  if (startTime && endTime && startTime > endTime) throw validationError('End time cannot be before start time');
  return {
    title: normalizeTripItineraryTitle(data.title || data.name),
    itinerary_date: itineraryDate,
    start_time: startTime,
    end_time: endTime,
    location: normalizeOptionalText(data.location, 140),
    notes: normalizeOptionalText(data.notes, 400),
  };
}

async function _assertTripOwner(userId, tripId, client = { query }) {
  const tripR = await client.query('SELECT id FROM trips WHERE id = $1 AND user_id = $2 LIMIT 1', [tripId, userId]);
  if (!tripR.rows[0]) throw validationError('Trip not found');
}

async function createTrip(userId, data) {
  return withTransaction(async (client) => {
    const destination = normalizeText(data.destination || data.name, 'Destination', 120);
    const startDate = normalizeDateValue(data.start_date, 'Start date');
    const endDate = data.end_date ? normalizeDateValue(data.end_date, 'End date') : null;
    if (endDate && endDate < startDate) throw validationError('End date cannot be before start date');
    const status = normalizeTripStatus(data.status, 'upcoming');
    const category = normalizeOptionalText(data.category, 60);
    const transportMode = normalizeOptionalText(data.transport_mode, 60);
    const totalDistance = normalizeTripDistance(data.total_distance);
    const notes = normalizeOptionalText(data.notes, 300);
    const members = normalizeTripMembers(data.members);
    const tripResult = await client.query(
      `INSERT INTO trips (user_id, name, destination, start_date, end_date, status, category, transport_mode, total_distance, notes, updated_at)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING id`,
      [userId, destination, startDate, endDate, status, category, transportMode, totalDistance, notes]
    );
    const tripId = Number(tripResult.rows[0].id);
    for (const member of members) {
      await client.query(
        `INSERT INTO trip_members (trip_id, friend_id, member_name, linked_user_id, permission)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tripId,
          member.friend_id || null,
          member.member_name,
          member.linked_user_id || null,
          normalizeTripStoredPermission(member.permission, 'edit'),
        ]
      );
    }
    return tripId;
  });
}

async function getTrips(userId) {
  const tripsResult = await query(
    `WITH accessible_trips AS (
       SELECT t.id AS trip_id, TRUE AS is_owner, 'owner'::text AS user_permission
       FROM trips t
       WHERE t.user_id = $1
       UNION ALL
       SELECT t.id AS trip_id,
              FALSE AS is_owner,
              CASE
               WHEN EXISTS (
                  SELECT 1
                  FROM trip_members tm2
                  WHERE tm2.trip_id = t.id
                    AND tm2.linked_user_id = $1
                    AND tm2.permission IN ('edit', 'share_edit')
                ) THEN 'edit'
                ELSE 'view'
              END AS user_permission
       FROM trips t
       WHERE t.user_id <> $1
         AND EXISTS (
           SELECT 1
           FROM trip_members tm
           WHERE tm.trip_id = t.id
             AND tm.linked_user_id = $1
             AND COALESCE(tm.permission, '') <> ''
         )
     )
     SELECT
       t.*,
       at.is_owner,
       at.user_permission,
       COALESCE(owner_u.display_name, owner_u.username, 'User') AS owner_name,
       COALESCE(t.destination, t.name) AS destination_name,
       COALESCE(exp.total_expenditure, 0) AS total_expenditure,
       COALESCE(exp.expense_count, 0) AS expense_count,
       COALESCE(mem.members_json, '[]'::json) AS members_json,
       COALESCE(share.member_share_totals_json, '[]'::json) AS member_share_totals_json,
       COALESCE(shared.shared_users_json, '[]'::json) AS shared_users_json
     FROM accessible_trips at
     JOIN trips t ON t.id = at.trip_id
     JOIN users owner_u ON owner_u.id = t.user_id
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(amount), 0) AS total_expenditure,
         COUNT(*) AS expense_count
       FROM trip_expenses
       WHERE trip_id = t.id
         AND lower(COALESCE(split_mode, '')) <> 'settlement'
     ) exp ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(
         json_agg(json_build_object('id', id, 'member_name', member_name, 'friend_id', friend_id, 'linked_user_id', linked_user_id, 'permission', permission) ORDER BY id),
         '[]'::json
        ) AS members_json
        FROM trip_members
        WHERE trip_id = t.id
          AND permission NOT IN ('share_view', 'share_edit')
      ) mem ON TRUE
     LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'member_key', tm.id::text,
              'member_name', tm.member_name,
              'share_total', COALESCE((
                SELECT SUM(tes.share_amount)
                FROM trip_expenses te
                JOIN trip_expense_splits tes ON tes.expense_id = te.id
                WHERE te.trip_id = t.id
                  AND (
                    tes.member_key = tm.id::text
                    OR tes.member_key = ('m' || tm.id::text)
                    OR LOWER(BTRIM(COALESCE(tes.member_name, ''))) = LOWER(BTRIM(COALESCE(tm.member_name, '')))
                  )
              ), 0)
            )
            ORDER BY tm.id
          ),
          '[]'::json
        ) AS member_share_totals_json
        FROM trip_members tm
        WHERE tm.trip_id = t.id
          AND tm.permission NOT IN ('share_view', 'share_edit')
      ) share ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(
         json_agg(
           json_build_object(
             'id', tm.id,
             'linked_user_id', tm.linked_user_id,
             'member_name', tm.member_name,
             'permission', CASE WHEN tm.permission = 'share_edit' THEN 'edit' ELSE 'view' END,
             'display_name', COALESCE(u.display_name, u.username, tm.member_name),
             'username', u.username
           )
           ORDER BY tm.id
         ),
         '[]'::json
       ) AS shared_users_json
       FROM trip_members tm
       LEFT JOIN users u ON u.id = tm.linked_user_id
       WHERE tm.trip_id = t.id
         AND tm.permission IN ('share_view', 'share_edit')
      ) shared ON TRUE
     ORDER BY t.start_date DESC, t.id DESC`,
    [userId]
  );

  return tripsResult.rows.map((row) => ({
    ...row,
    is_owner: !!row.is_owner,
    isOwner: !!row.is_owner,
    userPermission: row.user_permission || (row.is_owner ? 'owner' : 'view'),
    owner_name: row.owner_name || null,
    destination: row.destination_name,
    total_distance: row.total_distance == null ? null : num(row.total_distance),
    totalExpenditure: Math.round(num(row.total_expenditure) * 100) / 100,
    total_expenditure: Math.round(num(row.total_expenditure) * 100) / 100,
    expenseCount: Number(row.expense_count || 0),
    expense_count: Number(row.expense_count || 0),
    members: Array.isArray(row.members_json) ? row.members_json : [],
    shared_users: Array.isArray(row.shared_users_json)
      ? row.shared_users_json.map((item) => ({
          id: Number(item?.id || 0),
          linked_user_id: Number(item?.linked_user_id || 0) || null,
          member_name: item?.member_name || '',
          display_name: item?.display_name || item?.member_name || '',
          username: item?.username || '',
          permission: item?.permission || 'view',
        }))
      : [],
    member_share_totals: Array.isArray(row.member_share_totals_json)
      ? row.member_share_totals_json.map((item) => ({
          member_key: String(item?.member_key || ''),
          member_name: item?.member_name || '',
          share_total: Math.round(num(item?.share_total) * 100) / 100,
        }))
      : [],
  }));
}

async function getTripById(userId, tripId) {
  const [tripR, membersR, sharedUsersR, expenses, itineraryR] = await Promise.all([
    query(
      `SELECT
         t.*,
         CASE WHEN t.user_id = $1 THEN TRUE ELSE FALSE END AS is_owner,
         CASE
           WHEN t.user_id = $1 THEN 'owner'
           WHEN EXISTS (
             SELECT 1
             FROM trip_members tm
             WHERE tm.trip_id = t.id
               AND tm.linked_user_id = $1
               AND tm.permission IN ('edit', 'share_edit')
           ) THEN 'edit'
           ELSE 'view'
         END AS user_permission,
         COALESCE(owner_u.display_name, owner_u.username, 'User') AS owner_name
       FROM trips t
       JOIN users owner_u ON owner_u.id = t.user_id
       WHERE t.id = $2
         AND (
           t.user_id = $1
           OR EXISTS (
             SELECT 1
             FROM trip_members tm
             WHERE tm.trip_id = t.id
               AND tm.linked_user_id = $1
               AND COALESCE(tm.permission, '') <> ''
           )
         )
       LIMIT 1`,
      [userId, tripId]
    ),
    query(
      `SELECT id, member_name, friend_id, linked_user_id, permission, is_locked
       FROM trip_members
       WHERE trip_id = $1
         AND permission NOT IN ('share_view', 'share_edit')
       ORDER BY id`,
      [tripId]
    ),
    query(
      `SELECT
         tm.id,
         tm.linked_user_id,
         tm.member_name,
         CASE WHEN tm.permission = 'share_edit' THEN 'edit' ELSE 'view' END AS permission,
         COALESCE(u.display_name, u.username, tm.member_name) AS display_name,
         u.username
       FROM trip_members tm
       LEFT JOIN users u ON u.id = tm.linked_user_id
       WHERE tm.trip_id = $1
         AND tm.permission IN ('share_view', 'share_edit')
       ORDER BY tm.id`,
      [tripId]
    ),
    _loadNormalizedTripExpenses({ query }, tripId),
    query(
      `SELECT id, title, itinerary_date, start_time, end_time, location, notes, created_at, updated_at
       FROM trip_itinerary_items
       WHERE trip_id = $1
       ORDER BY itinerary_date ASC, start_time ASC NULLS LAST, id ASC`,
      [tripId]
    ),
  ]);
  const trip = tripR.rows[0];
  if (!trip) return null;
  const expenseTypeMap = new Map();
  for (const expense of expenses) {
    const isSettlement = normalizeTripSplitModeValue(expense.split_mode) === 'settlement';
    const normalizedItem = {
      id: Number(expense.id),
      trip_id: Number(expense.trip_id),
      expense_type: expense.expense_type || (isSettlement ? 'Settlement' : 'Other'),
      details: expense.details || '',
      quantity: expense.quantity == null ? null : num(expense.quantity),
      unit_price: expense.unit_price == null ? null : num(expense.unit_price),
      amount: num(expense.amount),
      original_currency_code: expense.original_currency_code || null,
      original_amount: expense.original_amount == null ? null : num(expense.original_amount),
      conversion_rate: expense.conversion_rate == null ? null : Number(expense.conversion_rate),
      expense_date: expense.expense_date,
      notes: expense.notes || null,
      created_at: expense.created_at,
      updated_at: expense.updated_at,
      paid_by_key: normalizeTripMemberKeyValue(expense.paid_by_key),
      paid_by_name: expense.paid_by_name || 'You',
      split_mode: normalizeTripSplitModeValue(expense.split_mode),
      splits: (expense.splits || []).map((split) => ({
        member_key: normalizeTripMemberKeyValue(split.member_key),
        member_name: split.member_name,
        share_amount: num(split.share_amount),
      })),
    };
    if (!isSettlement) {
      const key = normalizedItem.expense_type || 'Other';
      if (!expenseTypeMap.has(key)) expenseTypeMap.set(key, { type: key, total: 0, items: [] });
      const group = expenseTypeMap.get(key);
      group.total += num(expense.amount);
      group.items.push(normalizedItem);
    }
  }
  const expense_groups = Array.from(expenseTypeMap.values()).map((group) => ({
    ...group,
    total: Math.round(group.total * 100) / 100,
  }));
  const grandTotal = expense_groups.reduce((sum, group) => sum + num(group.total), 0);
  return {
    ...trip,
    destination: trip.destination || trip.name,
    total_distance: trip.total_distance == null ? null : num(trip.total_distance),
    members: membersR.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      friend_id: row.friend_id == null ? null : Number(row.friend_id),
      linked_user_id: row.linked_user_id == null ? null : Number(row.linked_user_id),
      permission: publicTripPermission(row.permission || 'edit'),
      is_locked: !!row.is_locked,
    })),
    shared_users: sharedUsersR.rows.map((row) => ({
      id: Number(row.id),
      linked_user_id: row.linked_user_id == null ? null : Number(row.linked_user_id),
      member_name: row.member_name || '',
      display_name: row.display_name || row.member_name || '',
      username: row.username || '',
      permission: row.permission || 'view',
    })),
    itinerary_items: itineraryR.rows.map((row) => ({
      id: Number(row.id),
      title: row.title || '',
      itinerary_date: row.itinerary_date,
      start_time: row.start_time ? String(row.start_time).slice(0, 5) : null,
      end_time: row.end_time ? String(row.end_time).slice(0, 5) : null,
      location: row.location || null,
      notes: row.notes || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    expenses: expenses.map((expense) => ({
      ...expense,
      expense_type: expense.expense_type || (normalizeTripSplitModeValue(expense.split_mode) === 'settlement' ? 'Settlement' : 'Other'),
    })),
    expense_groups,
    grand_total: Math.round(grandTotal * 100) / 100,
    isOwner: !!trip.is_owner,
    is_owner: !!trip.is_owner,
    userPermission: trip.user_permission || (trip.is_owner ? 'owner' : 'view'),
    owner_name: trip.owner_name || null,
  };
}

async function updateTrip(userId, id, data) {
  await withTransaction(async (client) => {
    const currentR = await client.query('SELECT * FROM trips WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
    const current = currentR.rows[0];
    if (!current) throw validationError('Trip not found');

    const destination = data.destination !== undefined || data.name !== undefined
      ? normalizeText(data.destination || data.name, 'Destination', 120)
      : (current.destination || current.name);
    const startDate = data.start_date !== undefined
      ? normalizeDateValue(data.start_date, 'Start date')
      : current.start_date;
    const endDate = data.end_date !== undefined
      ? (data.end_date ? normalizeDateValue(data.end_date, 'End date') : null)
      : current.end_date;
    if (endDate && endDate < startDate) throw validationError('End date cannot be before start date');
    const status = data.status !== undefined ? normalizeTripStatus(data.status) : current.status;
    const category = data.category !== undefined ? normalizeOptionalText(data.category, 60) : current.category;
    const transportMode = data.transport_mode !== undefined ? normalizeOptionalText(data.transport_mode, 60) : current.transport_mode;
    const totalDistance = data.total_distance !== undefined ? normalizeTripDistance(data.total_distance) : (current.total_distance == null ? null : num(current.total_distance));
    const notes = data.notes !== undefined ? normalizeOptionalText(data.notes, 300) : current.notes;

    await client.query(
      `UPDATE trips
       SET name = $1,
           destination = $1,
           start_date = $2,
           end_date = $3,
           status = $4,
           category = $5,
           transport_mode = $6,
           total_distance = $7,
           notes = $8,
           updated_at = NOW()
       WHERE id = $9 AND user_id = $10`,
      [destination, startDate, endDate, status, category, transportMode, totalDistance, notes, id, userId]
    );

    if (data.members !== undefined) {
      const members = normalizeTripMembers(data.members);
      await client.query(
        `DELETE FROM trip_members
         WHERE trip_id = $1
           AND permission NOT IN ('share_view', 'share_edit')`,
        [id]
      );
      for (const member of members) {
        await client.query(
          `INSERT INTO trip_members (trip_id, friend_id, member_name, linked_user_id, permission)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            id,
            member.friend_id || null,
            member.member_name,
            member.linked_user_id || null,
            normalizeTripStoredPermission(member.permission, 'edit'),
          ]
        );
      }
    }
  });
}

async function deleteTrip(userId, id) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM trip_itinerary_items WHERE trip_id = $1', [id]);
    await client.query('DELETE FROM trip_expense_splits WHERE expense_id IN (SELECT id FROM trip_expenses WHERE trip_id = $1)', [id]);
    await client.query('DELETE FROM trip_expenses WHERE trip_id = $1', [id]);
    await client.query('DELETE FROM trip_members WHERE trip_id = $1', [id]);
    await client.query('DELETE FROM trips WHERE id = $1 AND user_id = $2', [id, userId]);
  });
}

async function addTripItineraryItem(userId, tripId, data) {
  await _assertTripOwner(userId, tripId);
  return withTransaction(async (client) => {
    const payload = normalizeTripItineraryPayload(data);
    const result = await client.query(
      `INSERT INTO trip_itinerary_items (trip_id, title, itinerary_date, start_time, end_time, location, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [tripId, payload.title, payload.itinerary_date, payload.start_time, payload.end_time, payload.location, payload.notes]
    );
    await client.query('UPDATE trips SET updated_at = NOW() WHERE id = $1', [tripId]);
    return Number(result.rows[0].id);
  });
}

async function updateTripItineraryItem(userId, itemId, data) {
  return withTransaction(async (client) => {
    const currentR = await client.query(
      `SELECT ti.id, ti.trip_id
       FROM trip_itinerary_items ti
       JOIN trips t ON t.id = ti.trip_id
       WHERE ti.id = $1 AND t.user_id = $2
       LIMIT 1`,
      [itemId, userId]
    );
    const current = currentR.rows[0];
    if (!current) throw validationError('Itinerary item not found');
    const payload = normalizeTripItineraryPayload(data);
    await client.query(
      `UPDATE trip_itinerary_items
       SET title = $1,
           itinerary_date = $2,
           start_time = $3,
           end_time = $4,
           location = $5,
           notes = $6,
           updated_at = NOW()
       WHERE id = $7`,
      [payload.title, payload.itinerary_date, payload.start_time, payload.end_time, payload.location, payload.notes, itemId]
    );
    await client.query('UPDATE trips SET updated_at = NOW() WHERE id = $1', [current.trip_id]);
  });
}

async function deleteTripItineraryItem(userId, itemId) {
  return withTransaction(async (client) => {
    const currentR = await client.query(
      `SELECT ti.id, ti.trip_id
       FROM trip_itinerary_items ti
       JOIN trips t ON t.id = ti.trip_id
       WHERE ti.id = $1 AND t.user_id = $2
       LIMIT 1`,
      [itemId, userId]
    );
    const current = currentR.rows[0];
    if (!current) throw validationError('Itinerary item not found');
    await client.query('DELETE FROM trip_itinerary_items WHERE id = $1', [itemId]);
    await client.query('UPDATE trips SET updated_at = NOW() WHERE id = $1', [current.trip_id]);
  });
}

async function addTripExpense(userId, tripId, data) {
  await _assertTripOwner(userId, tripId);
  return withTransaction(async (client) => {
    const userCurrencyCode = await getUserCurrencyCode(userId, client);
    const payload = normalizeTripExpensePayload(data, userCurrencyCode);
    const expR = await client.query(
      `INSERT INTO trip_expenses (
         trip_id, paid_by_key, paid_by_name, details, amount, expense_date, split_mode,
         expense_type, quantity, unit_price, notes, original_currency_code, original_amount, conversion_rate, updated_at
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
        RETURNING id`,
      [tripId, payload.paid_by_key, payload.paid_by_name, payload.details, payload.amount, payload.expense_date, payload.split_mode, payload.expense_type, payload.quantity, payload.unit_price, payload.notes, payload.original_currency_code, payload.original_amount, payload.conversion_rate]
    );
    const expenseId = Number(expR.rows[0].id);
    for (const split of payload.splits) {
      await client.query(
        `INSERT INTO trip_expense_splits (expense_id, member_key, member_name, share_amount)
         VALUES ($1, $2, $3, $4)`,
        [expenseId, split.member_key, split.member_name, split.share_amount]
      );
    }
    return expenseId;
  });
}

async function updateTripExpense(userId, expenseId, data) {
  const expR = await query('SELECT id, trip_id FROM trip_expenses WHERE id = $1 LIMIT 1', [expenseId]);
  const exp = expR.rows[0];
  if (!exp) throw new Error('Not found');
  await _assertTripOwner(userId, exp.trip_id);
  await withTransaction(async (client) => {
    const userCurrencyCode = await getUserCurrencyCode(userId, client);
    const payload = normalizeTripExpensePayload(data, userCurrencyCode);
    await client.query(
      `UPDATE trip_expenses
       SET paid_by_key = $1,
           paid_by_name = $2,
           details = $3,
           amount = $4,
           expense_date = $5,
           split_mode = $6,
           expense_type = $7,
           quantity = $8,
           unit_price = $9,
           notes = $10,
           original_currency_code = $11,
           original_amount = $12,
           conversion_rate = $13,
           updated_at = NOW()
       WHERE id = $14`,
      [payload.paid_by_key, payload.paid_by_name, payload.details, payload.amount, payload.expense_date, payload.split_mode, payload.expense_type, payload.quantity, payload.unit_price, payload.notes, payload.original_currency_code, payload.original_amount, payload.conversion_rate, expenseId]
    );
    await client.query('DELETE FROM trip_expense_splits WHERE expense_id = $1', [expenseId]);
    for (const split of payload.splits) {
      await client.query(
        `INSERT INTO trip_expense_splits (expense_id, member_key, member_name, share_amount)
         VALUES ($1, $2, $3, $4)`,
        [expenseId, split.member_key, split.member_name, split.share_amount]
      );
    }
  });
}

async function deleteTripExpense(userId, expenseId) {
  const expR = await query('SELECT id, trip_id FROM trip_expenses WHERE id = $1 LIMIT 1', [expenseId]);
  const exp = expR.rows[0];
  if (!exp) throw new Error('Not found');
  await _assertTripOwner(userId, exp.trip_id);
  await withTransaction(async (client) => {
    await client.query('DELETE FROM trip_expense_splits WHERE expense_id = $1', [expenseId]);
    await client.query('DELETE FROM trip_expenses WHERE id = $1', [expenseId]);
  });
}

async function deleteAllTripExpenses(userId, tripId) {
  await _assertTripOwner(userId, tripId);
  await withTransaction(async (client) => {
    await client.query(
      'DELETE FROM trip_expense_splits WHERE expense_id IN (SELECT id FROM trip_expenses WHERE trip_id = $1)',
      [tripId]
    );
    await client.query('DELETE FROM trip_expenses WHERE trip_id = $1', [tripId]);
  });
}

async function bulkUpdateTripExpenseShares(userId, tripId, data = {}) {
  await _assertTripOwner(userId, tripId);
  const splitMode = normalizeTripSplitModeValue(data.split_mode || 'equal');
  const requestedKeys = Array.isArray(data.member_keys) ? data.member_keys.map((key) => normalizeTripMemberKeyValue(key)).filter(Boolean) : [];
  const rawValues = data.split_values && typeof data.split_values === 'object' ? data.split_values : {};
  const normalizedValues = Object.entries(rawValues).reduce((acc, [key, value]) => {
    const normalizedKey = normalizeTripMemberKeyValue(key);
    if (normalizedKey) acc[String(normalizedKey)] = num(value);
    return acc;
  }, {});
  await withTransaction(async (client) => {
    const membersR = await client.query(
      `SELECT id, member_name
       FROM trip_members
       WHERE trip_id = $1
         AND permission NOT IN ('share_view', 'share_edit')
       ORDER BY id`,
      [tripId]
    );
    const memberRows = membersR.rows.map((member) => ({
      member_key: String(member.id),
      member_name: member.member_name,
    }));
    const selectedMembers = requestedKeys.length
      ? memberRows.filter((member) => requestedKeys.includes(String(member.member_key)))
      : memberRows;
    if (!selectedMembers.length) throw validationError('Select at least one member');
    const values = selectedMembers.reduce((acc, member) => {
      const key = String(member.member_key);
      acc[key] = num(normalizedValues[key]);
      return acc;
    }, {});
    const expenses = await _loadNormalizedTripExpenses(client, tripId);
    if (!expenses.length) return;
    for (const expense of expenses) {
      const splits = _computeBulkTripShares(expense.amount, splitMode, selectedMembers, values);
      await client.query(
        `UPDATE trip_expenses
         SET split_mode = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [splitMode, expense.id]
      );
      await client.query('DELETE FROM trip_expense_splits WHERE expense_id = $1', [expense.id]);
      for (const split of splits) {
        await client.query(
          `INSERT INTO trip_expense_splits (expense_id, member_key, member_name, share_amount)
           VALUES ($1, $2, $3, $4)`,
          [expense.id, split.member_key, split.member_name, split.share_amount]
        );
      }
    }
  });
}

async function finalizeTrip(userId, tripId, data = {}) {
  return withTransaction(async (client) => {
    const trip = await _loadTripFinalizeData(userId, tripId, client);
    const today = normalizeDateValue(data.txn_date || new Date().toISOString().slice(0, 10), 'Trip finalization date');
    const expenseCategory = normalizeOptionalText(data.category, 80);
    const peopleMap = _buildTripSettlementSnapshot(trip, data.friend_ids || {}, data.self_member_key || null);
    const liveSplitFriendIds = Object.entries(data.live_split_friend_ids || {}).reduce((acc, [key, value]) => {
      const friendId = Number(value || 0);
      if (friendId > 0) acc[String(key)] = friendId;
      return acc;
    }, {});
    const settlementSessionPrefix = `trip-finalize-${Number(tripId)}-`;

    await client.query(
      `UPDATE expenses
       SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW(), updated_by = $1
       WHERE user_id = $1 AND source = 'trip' AND source_id = $2 AND deleted_at IS NULL`,
      [userId, tripId]
    );
    await client.query(
      `UPDATE loan_transactions
       SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW(), updated_by = $1
       WHERE user_id = $1 AND source = 'trip' AND source_id = $2 AND deleted_at IS NULL`,
      [userId, tripId]
    );
    await client.query(
      `DELETE FROM live_split_groups
       WHERE user_id = $1
         AND split_mode = 'settlement'
         AND session_id LIKE $2`,
      [userId, `${settlementSessionPrefix}%`]
    );

    const self = peopleMap.self;
    if (data.add_self_expense !== false && self && self.totalShare > 0) {
      await client.query(
        `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, source, source_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'trip', $7, $1, $1)`,
        [userId, trip.name, expenseCategory, Math.round(self.totalShare * 100) / 100, today, !!data.is_extra, tripId]
      );
    }

    for (const [key, person] of Object.entries(peopleMap)) {
      if (key === 'self') continue;
      const net = person.totalGave - person.totalShare;
      const settlementAmount = Math.round(Math.abs(net) * 100) / 100;
      if (!(settlementAmount > 0.005)) continue;

      const liveSplitFriendId = Number(liveSplitFriendIds[key] || 0);
      if (liveSplitFriendId > 0) {
        const friendResult = await client.query(
          `SELECT id, name, linked_user_id
           FROM live_split_friends
           WHERE user_id = $1
             AND id = $2
             AND deleted_at IS NULL
           LIMIT 1`,
          [userId, liveSplitFriendId]
        );
        const liveFriend = friendResult.rows[0];
        if (!liveFriend) throw validationError(`Live Split friend mapping is invalid for ${person.name}`);

        const groupResult = await client.query(
          `INSERT INTO live_split_groups (user_id, divide_date, details, paid_by, total_amount, heading, session_id, split_mode, trip_id, owner_added_to_expense)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'settlement', NULL, FALSE)
           RETURNING id`,
          [
            userId,
            today,
            `Trip settlement: ${trip.name}`,
            net < 0 ? 'You' : String(liveFriend.name || person.name || 'Friend').trim(),
            settlementAmount,
            `Trip ${trip.name}`,
            `${settlementSessionPrefix}${key}`,
          ]
        );
        const groupId = Number(groupResult.rows[0].id);
        await client.query(
          `INSERT INTO live_split_splits (group_id, friend_id, friend_name, share_amount)
           VALUES ($1, $2, $3, $4)`,
          [groupId, Number(liveFriend.id), String(liveFriend.name || person.name || 'Friend').trim(), settlementAmount]
        );
        if (Number(liveFriend.linked_user_id || 0) > 0 && Number(liveFriend.linked_user_id || 0) !== Number(userId)) {
          await client.query(
            `INSERT INTO live_split_group_shares (group_id, owner_user_id, friend_id, target_user_id, shared_by_user_id, owner_hidden_at, target_hidden_at, updated_at)
             VALUES ($1, $2, $3, $4, $2, NULL, NULL, NOW())
             ON CONFLICT (group_id, target_user_id)
             DO UPDATE SET friend_id = EXCLUDED.friend_id,
                           shared_by_user_id = EXCLUDED.shared_by_user_id,
                           owner_hidden_at = NULL,
                           target_hidden_at = NULL,
                           updated_at = NOW()`,
            [groupId, userId, Number(liveFriend.id), Number(liveFriend.linked_user_id)]
          );
        }
        continue;
      }

      const friendId = Number(person.friendId || 0);
      if (!friendId) continue;
      const paid = net < -0.005 ? settlementAmount : 0;
      const received = net > 0.005 ? settlementAmount : 0;
      await client.query(
        `INSERT INTO loan_transactions (user_id, friend_id, txn_date, details, paid, received, source, source_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'trip', $7, $1, $1)`,
        [userId, friendId, today, `Trip: ${trip.name}`, paid, received, tripId]
      );
    }

    await client.query(
      `UPDATE trips
       SET status = 'completed', updated_at = NOW(), updated_by = $1
       WHERE id = $2 AND user_id = $1`,
      [userId, tripId]
    );

    return { success: true };
  });
}

async function toggleMemberLock(userId, memberId) {
  const result = await query(
    `SELECT m.id, m.is_locked
     FROM trip_members m
     JOIN trips t ON t.id = m.trip_id
     WHERE m.id = $1 AND t.user_id = $2
     LIMIT 1`,
    [memberId, userId]
  );
  const member = result.rows[0];
  if (!member) throw new Error('Not found');
  await query('UPDATE trip_members SET is_locked = $1 WHERE id = $2', [!member.is_locked, memberId]);
}

async function linkTripMember(ownerId, memberId, linkedUserId, permission) {
  const result = await query(
    `SELECT m.*
     FROM trip_members m
     JOIN trips t ON t.id = m.trip_id
     WHERE m.id = $1 AND t.user_id = $2
     LIMIT 1`,
    [memberId, ownerId]
  );
  if (!result.rows[0]) throw new Error('Member not found');
  await query('UPDATE trip_members SET linked_user_id = $1, permission = $2 WHERE id = $3', [linkedUserId || null, normalizeTripStoredPermission(permission, 'edit'), memberId]);
}

async function getTripSharedUsers(ownerId, tripId) {
  const tripR = await query('SELECT id FROM trips WHERE id = $1 AND user_id = $2 LIMIT 1', [tripId, ownerId]);
  if (!tripR.rows[0]) throw new Error('Trip not found');
  const result = await query(
    `SELECT
       tm.id,
       tm.linked_user_id,
       tm.member_name,
       CASE WHEN tm.permission = 'share_edit' THEN 'edit' ELSE 'view' END AS permission,
       COALESCE(u.display_name, u.username, tm.member_name) AS display_name,
       u.username
     FROM trip_members tm
     LEFT JOIN users u ON u.id = tm.linked_user_id
     WHERE tm.trip_id = $1
       AND tm.permission IN ('share_view', 'share_edit')
     ORDER BY tm.id`,
    [tripId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    linked_user_id: row.linked_user_id == null ? null : Number(row.linked_user_id),
    member_name: row.member_name || '',
    display_name: row.display_name || row.member_name || '',
    username: row.username || '',
    permission: row.permission || 'view',
  }));
}

async function shareTripWithUser(ownerId, tripId, targetUserId, permission = 'view') {
  const uid = Number(targetUserId || 0);
  if (!(uid > 0)) throw validationError('Select a valid app user');
  if (uid === Number(ownerId || 0)) throw validationError('You cannot share a trip with yourself');
  const tripR = await query('SELECT id FROM trips WHERE id = $1 AND user_id = $2 LIMIT 1', [tripId, ownerId]);
  if (!tripR.rows[0]) throw new Error('Trip not found');
  const userR = await query('SELECT id, display_name, username FROM users WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL LIMIT 1', [uid]);
  const target = userR.rows[0];
  if (!target) throw validationError('Selected user was not found');
  const storedPermission = normalizeTripSharedUserPermission(permission, 'view');
  const label = String(target.display_name || target.username || 'User').trim() || 'User';
  const existingR = await query(
    `SELECT id
     FROM trip_members
     WHERE trip_id = $1
       AND linked_user_id = $2
       AND permission IN ('share_view', 'share_edit')
     LIMIT 1`,
    [tripId, uid]
  );
  if (existingR.rows[0]) {
    await query(
      `UPDATE trip_members
       SET member_name = $1,
           permission = $2
       WHERE id = $3`,
      [label, storedPermission, Number(existingR.rows[0].id)]
    );
    return Number(existingR.rows[0].id);
  }
  const result = await query(
    `INSERT INTO trip_members (trip_id, friend_id, member_name, linked_user_id, permission)
     VALUES ($1, NULL, $2, $3, $4)
     RETURNING id`,
    [tripId, label, uid, storedPermission]
  );
  return Number(result.rows[0].id);
}

async function unshareTripWithUser(ownerId, tripId, shareRowId) {
  const tripR = await query('SELECT id FROM trips WHERE id = $1 AND user_id = $2 LIMIT 1', [tripId, ownerId]);
  if (!tripR.rows[0]) throw new Error('Trip not found');
  const result = await query(
    `DELETE FROM trip_members
     WHERE id = $1
       AND trip_id = $2
       AND permission IN ('share_view', 'share_edit')
     RETURNING id`,
    [shareRowId, tripId]
  );
  if (!result.rows[0]) throw validationError('Shared user not found');
}

async function createTripInvite(ownerId, tripId, memberId) {
  const tripR = await query('SELECT * FROM trips WHERE id = $1 AND user_id = $2 LIMIT 1', [tripId, ownerId]);
  if (!tripR.rows[0]) throw new Error('Trip not found');
  const memberR = await query('SELECT * FROM trip_members WHERE id = $1 AND trip_id = $2 LIMIT 1', [memberId, tripId]);
  if (!memberR.rows[0]) throw new Error('Member not found');
  const token = crypto.randomBytes(20).toString('hex');
  const exp = new Date();
  exp.setDate(exp.getDate() + 7);
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM trip_invites WHERE trip_id = $1 AND member_id = $2 AND status = 'pending'`, [tripId, memberId]);
    await client.query(
      `INSERT INTO trip_invites (trip_id, member_id, created_by, token, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tripId, memberId, ownerId, token, exp.toISOString().split('T')[0]]
    );
  });
  return token;
}

async function getTripInviteByToken(token) {
  const result = await query(
    `SELECT i.*, t.name AS trip_name, u.display_name AS owner_name, m.member_name
     FROM trip_invites i
     JOIN trips t ON t.id = i.trip_id
     JOIN users u ON u.id = i.created_by
     JOIN trip_members m ON m.id = i.member_id
     WHERE i.token = $1
     LIMIT 1`,
    [token]
  );
  return result.rows[0] || null;
}

async function acceptTripInvite(userId, token) {
  return withTransaction(async (client) => {
    const inviteR = await client.query('SELECT * FROM trip_invites WHERE token = $1 LIMIT 1', [token]);
    const invite = inviteR.rows[0];
    if (!invite) throw new Error('Invalid invite');
    if (invite.status !== 'pending') throw new Error('Invite already used');
    if (invite.expires_at && invite.expires_at < new Date().toISOString().split('T')[0]) throw new Error('Invite expired');
    await client.query('UPDATE trip_members SET linked_user_id = $1 WHERE id = $2', [userId, invite.member_id]);
    await client.query(`UPDATE trip_invites SET status = 'accepted', accepted_by = $1 WHERE id = $2`, [userId, invite.id]);
    return Number(invite.trip_id);
  });
}

async function searchUsers(search, excludeUserId) {
  if (!search || search.length < 2) return [];
  const raw = String(search || '').trim();
  const q = `%${raw}%`;
  const digitsOnly = raw.replace(/\D/g, '');
  const hasPhoneDigits = digitsOnly.length >= 4;
  const phoneDigitsLike = hasPhoneDigits ? `%${digitsOnly}%` : null;
  const result = await query(
    `SELECT id, username, display_name, email, mobile
     FROM users
     WHERE (
       username ILIKE $1
       OR display_name ILIKE $1
       OR email ILIKE $1
       OR ($2::text IS NOT NULL AND regexp_replace(COALESCE(mobile, ''), '[^0-9]', '', 'g') LIKE $2::text)
     )
       AND id != $3
       AND is_active = TRUE
       AND deleted_at IS NULL
     LIMIT 10`,
    [q, phoneDigitsLike, excludeUserId]
  );
  return result.rows;
}

async function createLiveSplitInvite({
  inviterUserId,
  targetUserId = null,
  targetEmail = null,
  targetPhone = null,
  targetName = null,
}) {
  const inviterId = Number(inviterUserId);
  const userId = targetUserId != null ? Number(targetUserId) : null;
  const email = targetEmail ? String(targetEmail).trim().toLowerCase() : null;
  const phone = targetPhone ? String(targetPhone).trim() : null;
  const name = targetName ? String(targetName).trim() : null;
  const nextInviteToken = crypto.randomUUID();
  if (!inviterId || (!userId && !email && !phone)) throw validationError('Invalid invite target');
  if (userId && userId === inviterId) throw validationError('You cannot invite yourself');

  if (userId) {
    const linkedAlready = await query(
      `SELECT 1
       FROM live_split_friends
       WHERE user_id = $1
         AND linked_user_id = $2
         AND deleted_at IS NULL
       LIMIT 1`,
      [inviterId, userId]
    );
    if (linkedAlready.rows[0]) {
      throw validationError('User is already in your Live Split list');
    }
  }

  const existing = await query(
    `SELECT id, invite_token
     FROM live_split_invites
     WHERE inviter_user_id = $1
       AND status = 'pending'
       AND (
         (target_user_id IS NOT NULL AND target_user_id = $2)
         OR ($3::text IS NOT NULL AND lower(target_email) = lower($3::text))
         OR ($4::text IS NOT NULL AND target_phone = $4::text)
       )
     ORDER BY id DESC
    LIMIT 1`,
    [inviterId, userId, email, phone]
  );
  if (existing.rows[0]) {
    const inviteId = Number(existing.rows[0].id);
    let inviteToken = String(existing.rows[0].invite_token || '').trim();
    if (!inviteToken) {
      const updated = await query(
        `UPDATE live_split_invites
         SET invite_token = $2
         WHERE id = $1
         RETURNING invite_token`,
        [inviteId, nextInviteToken]
      );
      inviteToken = String(updated.rows[0]?.invite_token || nextInviteToken).trim();
    }
    return { id: inviteId, invite_token: inviteToken };
  }

  const inserted = await query(
    `INSERT INTO live_split_invites (inviter_user_id, target_user_id, invite_token, target_email, target_phone, target_name, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id, invite_token`,
    [inviterId, userId, nextInviteToken, email, phone, name]
  );
  return {
    id: Number(inserted.rows[0].id),
    invite_token: String(inserted.rows[0].invite_token || nextInviteToken).trim(),
  };
}

async function getLiveSplitInviteByToken(inviteToken) {
  const token = String(inviteToken || '').trim();
  if (!token) return null;
  const result = await query(
    `SELECT i.*, u.display_name AS inviter_display_name, u.username AS inviter_username
     FROM live_split_invites i
     JOIN users u ON u.id = i.inviter_user_id
     WHERE i.invite_token = $1
     LIMIT 1`,
    [token]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    inviter_user_id: Number(row.inviter_user_id),
    target_user_id: row.target_user_id ? Number(row.target_user_id) : null,
  };
}

async function bindLiveSplitInviteToUser(inviteToken, userId) {
  const token = String(inviteToken || '').trim();
  const uid = Number(userId);
  if (!token || !uid) return false;
  const result = await query(
    `UPDATE live_split_invites
     SET target_user_id = COALESCE(target_user_id, $2)
     WHERE invite_token = $1
       AND status = 'pending'
     RETURNING id`,
    [token, uid]
  );
  return Boolean(result.rows[0]);
}

async function getIncomingLiveSplitInvites(userId, email = '', mobile = '') {
  const uid = Number(userId);
  const em = String(email || '').trim().toLowerCase();
  const phoneDigits = String(mobile || '').replace(/\D/g, '');
  const result = await query(
    `SELECT i.*, u.display_name AS inviter_display_name, u.username AS inviter_username, u.avatar_url AS inviter_avatar_url
     FROM live_split_invites i
     JOIN users u ON u.id = i.inviter_user_id
     WHERE i.status = 'pending'
       AND i.inviter_user_id <> $1
       AND NOT EXISTS (
         SELECT 1
         FROM live_split_friends f
         WHERE f.user_id = i.inviter_user_id
           AND f.linked_user_id = $1
           AND f.deleted_at IS NULL
       )
       AND (
         i.target_user_id = $1
         OR ($2::text <> '' AND lower(i.target_email) = lower($2::text))
         OR ($3::text <> '' AND regexp_replace(COALESCE(i.target_phone,''), '[^0-9]', '', 'g') = $3::text)
       )
     ORDER BY i.created_at DESC`,
    [uid, em, phoneDigits]
  );
  return result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    inviter_user_id: Number(row.inviter_user_id),
    target_user_id: row.target_user_id ? Number(row.target_user_id) : null,
  }));
}

async function getOutgoingLiveSplitInvites(userId) {
  const uid = Number(userId);
  const result = await query(
    `SELECT i.*, u.display_name AS target_display_name, u.username AS target_username
     FROM live_split_invites i
     LEFT JOIN users u ON u.id = i.target_user_id
     WHERE i.inviter_user_id = $1
       AND i.status = 'pending'
       AND NOT EXISTS (
         SELECT 1
         FROM live_split_friends f
         WHERE f.user_id = $1
           AND (
             (i.target_user_id IS NOT NULL AND f.linked_user_id = i.target_user_id)
            )
           AND f.deleted_at IS NULL
       )
     ORDER BY i.created_at DESC`,
    [uid]
  );
  return result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    inviter_user_id: Number(row.inviter_user_id),
    target_user_id: row.target_user_id ? Number(row.target_user_id) : null,
  }));
}

async function getLiveSplitInviteByIdForInviter(userId, inviteId) {
  const uid = Number(userId);
  const iid = Number(inviteId);
  const result = await query(
    `SELECT i.*, u.display_name AS target_display_name, u.username AS target_username, u.email AS target_user_email, u.mobile AS target_user_mobile
     FROM live_split_invites i
     LEFT JOIN users u ON u.id = i.target_user_id
     WHERE i.id = $1
       AND i.inviter_user_id = $2
       AND i.status = 'pending'
     LIMIT 1`,
    [iid, uid]
  );
  return result.rows[0] || null;
}

async function acceptLiveSplitInvite(userId, inviteId, me = {}) {
  const uid = Number(userId);
  return withTransaction(async (client) => {
    const expandNameCandidates = (value = '') => {
      const raw = String(value || '').trim();
      if (!raw) return [];
      const normalized = raw.replace(/\s+/g, ' ').trim();
      if (!normalized) return [];
      const parts = normalized.split(' ').filter(Boolean);
      const variants = [normalized];
      if (parts.length > 1) {
        variants.push(parts[0]);
        variants.push(parts[parts.length - 1]);
        variants.push(parts.slice(0, 2).join(' '));
      }
      return [...new Set(variants.map((item) => item.trim()).filter(Boolean))];
    };
    const expandHandleCandidates = (value = '') => {
      const raw = String(value || '').trim();
      if (!raw) return [];
      const base = raw.includes('@') ? raw.split('@')[0] : raw;
      if (!base) return [];
      const pieces = base
        .split(/[._\-\s]+/)
        .map((part) => part.trim())
        .filter(Boolean);
      const variants = [base, ...pieces];
      return [...new Set(variants.map((item) => item.trim()).filter(Boolean))];
    };

    const inviteR = await client.query('SELECT * FROM live_split_invites WHERE id = $1 LIMIT 1', [inviteId]);
    const invite = inviteR.rows[0];
    if (!invite) throw new Error('Invite not found');
    if (invite.status !== 'pending') throw new Error('Invite already processed');
    const myEmail = String(me.email || '').trim().toLowerCase();
    const myPhoneDigits = String(me.mobile || '').replace(/\D/g, '');
    const targetEmail = String(invite.target_email || '').trim().toLowerCase();
    const targetPhoneDigits = String(invite.target_phone || '').replace(/\D/g, '');
    const allowed = Number(invite.target_user_id) === uid
      || (myEmail && targetEmail && myEmail === targetEmail)
      || (myPhoneDigits && targetPhoneDigits && myPhoneDigits === targetPhoneDigits);
    if (!allowed) throw new Error('Invite is not for this user');

    const inviterId = Number(invite.inviter_user_id);
    if (inviterId === uid) throw new Error('Invalid invite');
    const myUsername = String(me.username || '').trim();
    const name = String(me.display_name || me.username || invite.target_name || 'Friend').trim();
    const inviterUserR = await client.query(
      `SELECT id, display_name, username
       FROM users
       WHERE id = $1
         AND deleted_at IS NULL
       LIMIT 1`,
      [inviterId]
    );
    const inviterDisplay = String(inviterUserR.rows[0]?.display_name || inviterUserR.rows[0]?.username || 'User').trim();

    const relatedInvitesR = await client.query(
      `SELECT id, target_name
       FROM live_split_invites
       WHERE inviter_user_id = $1
         AND status = 'pending'
         AND (
           target_user_id = $2
           OR ($3::text <> '' AND lower(target_email) = lower($3::text))
           OR ($4::text <> '' AND regexp_replace(COALESCE(target_phone,''), '[^0-9]', '', 'g') = $4::text)
         )`,
      [inviterId, uid, myEmail, myPhoneDigits]
    );
    const relatedInvites = relatedInvitesR.rows || [];

    const candidateNames = [...new Set(
      [
        ...expandNameCandidates(name),
        ...expandNameCandidates(myUsername),
        ...expandNameCandidates(invite.target_name),
        ...relatedInvites.flatMap((item) => expandNameCandidates(item.target_name)),
        ...expandHandleCandidates(myUsername),
        ...expandHandleCandidates(myEmail),
        ...expandHandleCandidates(targetEmail),
      ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )];

    const linkedRowsR = await client.query(
      `SELECT id
       FROM live_split_friends
       WHERE user_id = $1
         AND linked_user_id = $2
         AND deleted_at IS NULL`,
      [inviterId, uid]
    );
    const linkedIds = linkedRowsR.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

    let nameIds = [];
    if (candidateNames.length) {
      const nameRowsR = await client.query(
        `SELECT id
         FROM live_split_friends
         WHERE user_id = $1
           AND deleted_at IS NULL
           AND lower(name) = ANY($2::text[])`,
        [inviterId, candidateNames]
      );
      nameIds = nameRowsR.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
    }

    let friendIds = [...new Set([...linkedIds, ...nameIds])];
    if (!friendIds.length) {
      const insertR = await client.query(
        'INSERT INTO live_split_friends (user_id, name) VALUES ($1, $2) RETURNING id',
        [inviterId, name]
      );
      friendIds = [Number(insertR.rows[0].id)];
    }

    await client.query(
      `UPDATE live_split_friends
       SET linked_user_id = $1, updated_at = NOW(), updated_by = $1
       WHERE user_id = $2
         AND id = ANY($3::bigint[])
         AND deleted_at IS NULL`,
      [uid, inviterId, friendIds]
    );

    // Backfill split participants that were saved under short-name aliases
    // (for example "Rohit" vs "Rohit Sharma"), so old splits map to this app user.
    if (candidateNames.length) {
      const aliasRowsR = await client.query(
        `UPDATE live_split_friends f
         SET linked_user_id = $1, updated_at = NOW(), updated_by = $1
         WHERE f.user_id = $2
           AND f.deleted_at IS NULL
           AND (
             lower(f.name) = ANY($3::text[])
             OR EXISTS (
               SELECT 1
               FROM live_split_splits s
               JOIN live_split_groups g ON g.id = s.group_id
               WHERE g.user_id = $2
                 AND s.friend_id = f.id
                 AND lower(trim(s.friend_name)) = ANY($3::text[])
             )
           )
         RETURNING f.id`,
        [uid, inviterId, candidateNames]
      );
      const aliasIds = aliasRowsR.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
      if (aliasIds.length) {
        friendIds = [...new Set([...friendIds, ...aliasIds])];
      }
    }
    const friendId = friendIds[0];

    // Ensure reciprocal linked friend exists for accepter as well,
    // so inviter appears in "Select Friends" list on both sides.
    const reverseLinkedR = await client.query(
      `SELECT id FROM live_split_friends
       WHERE user_id = $1 AND linked_user_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [uid, inviterId]
    );
    let reverseFriendId = reverseLinkedR.rows[0] ? Number(reverseLinkedR.rows[0].id) : null;
    if (!reverseLinkedR.rows[0]) {
      const reverseNameR = await client.query(
        `SELECT id FROM live_split_friends
         WHERE user_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL
         LIMIT 1`,
        [uid, inviterDisplay]
      );
      reverseFriendId = reverseNameR.rows[0] ? Number(reverseNameR.rows[0].id) : null;
      if (!reverseFriendId) {
        const reverseInsertR = await client.query(
          'INSERT INTO live_split_friends (user_id, name) VALUES ($1, $2) RETURNING id',
          [uid, inviterDisplay]
        );
        reverseFriendId = Number(reverseInsertR.rows[0].id);
      }
      await client.query(
        'UPDATE live_split_friends SET linked_user_id = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND user_id = $2',
        [inviterId, uid, reverseFriendId]
      );
    }

    // Backfill shared visibility for historical splits that were created
    // before this invite was accepted.
    await client.query(
      `INSERT INTO live_split_group_shares (group_id, owner_user_id, friend_id, target_user_id, shared_by_user_id)
       SELECT DISTINCT g.id, g.user_id, s.friend_id, $1::bigint, $2::bigint
       FROM live_split_groups g
       JOIN live_split_splits s ON s.group_id = g.id
       LEFT JOIN live_split_group_shares gs
         ON gs.group_id = g.id
        AND gs.target_user_id = $1::bigint
       WHERE g.user_id = $2::bigint
         AND s.friend_id = ANY($3::bigint[])
         AND gs.id IS NULL
       ON CONFLICT (group_id, target_user_id)
       DO UPDATE SET friend_id = EXCLUDED.friend_id,
                     shared_by_user_id = EXCLUDED.shared_by_user_id,
                     owner_hidden_at = NULL,
                     target_hidden_at = NULL,
                     updated_at = NOW()`,
      [uid, inviterId, friendIds]
    );

    await client.query(
      `UPDATE live_split_invites
       SET status = 'accepted', accepted_by = $1, responded_at = NOW(), target_user_id = COALESCE(target_user_id, $1)
       WHERE inviter_user_id = $2
         AND status = 'pending'
         AND (
           id = $3
           OR target_user_id = $1
           OR ($4::text <> '' AND lower(target_email) = lower($4::text))
           OR ($5::text <> '' AND regexp_replace(COALESCE(target_phone,''), '[^0-9]', '', 'g') = $5::text)
         )`,
      [uid, inviterId, inviteId, myEmail, myPhoneDigits]
    );
    return {
      friend_id: friendId,
      inviter_user_id: inviterId,
      inviter_name: inviterDisplay,
      reverse_friend_id: reverseFriendId,
    };
  });
}

async function rejectLiveSplitInvite(userId, inviteId, me = {}) {
  const uid = Number(userId);
  const myEmail = String(me.email || '').trim().toLowerCase();
  const myPhoneDigits = String(me.mobile || '').replace(/\D/g, '');
  const result = await query(
    `UPDATE live_split_invites
     SET status = 'rejected', responded_at = NOW(), target_user_id = COALESCE(target_user_id, $1)
     WHERE id = $2
       AND status = 'pending'
       AND (
         target_user_id = $1
         OR ($3::text <> '' AND lower(target_email) = lower($3::text))
         OR ($4::text <> '' AND regexp_replace(COALESCE(target_phone,''), '[^0-9]', '', 'g') = $4::text)
       )
     RETURNING id`,
    [uid, inviteId, myEmail, myPhoneDigits]
  );
  if (!result.rows[0]) throw new Error('Invite not found');
}

async function cancelLiveSplitInviteForInviter(userId, inviteId) {
  const uid = Number(userId);
  const iid = Number(inviteId);
  const result = await query(
    `UPDATE live_split_invites
     SET status = 'cancelled', responded_at = NOW()
     WHERE id = $1
       AND inviter_user_id = $2
       AND status = 'pending'
     RETURNING id`,
    [iid, uid]
  );
  if (!result.rows[0]) throw new Error('Pending invite not found');
}

async function createShareLink(userId, data) {
  const token = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(20).toString('hex');
  const params = [
    userId,
    token,
    data.link_type || 'friends',
    data.filters ? JSON.stringify(data.filters) : null,
    data.expires_at || null,
  ];
  const sql = `INSERT INTO share_links (user_id, token, link_type, filters, expires_at)
               VALUES ($1, $2, $3, $4::text, $5)`;
  try {
    await query(sql, params);
  } catch (err) {
    const isPrimaryKeyError = err?.code === '23505' && String(err?.constraint || '').trim() === 'share_links_pkey';
    if (!isPrimaryKeyError) throw err;
    await query(
      `SELECT setval(
         pg_get_serial_sequence('share_links', 'id'),
         COALESCE((SELECT MAX(id) FROM share_links), 0) + 1,
         FALSE
       )`
    );
    await query(sql, params);
  }
  return token;
}

async function getShareLinks(userId) {
  const result = await query('SELECT * FROM share_links WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return result.rows;
}

async function deleteShareLink(userId, id) {
  await query('DELETE FROM share_links WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function getPublicShareData(token) {
  const linkR = await query('SELECT * FROM share_links WHERE token = $1 LIMIT 1', [token]);
  const link = linkR.rows[0];
  if (!link) return null;
  if (link.expires_at && link.expires_at < new Date().toISOString().split('T')[0]) return null;
  await query('UPDATE share_links SET view_count = view_count + 1 WHERE id = $1', [link.id]);

  const filters = link.filters ? JSON.parse(link.filters) : {};
  const ownerR = await query('SELECT display_name FROM users WHERE id = $1 LIMIT 1', [link.user_id]);

  if (String(link.link_type || '').trim().toLowerCase() === 'trip_detail') {
    const tripId = Number(filters.trip_id || 0);
    if (!tripId) return null;
    const trip = await getTripById(link.user_id, tripId);
    if (!trip) return null;
    return {
      link_type: 'trip_detail',
      owner_name: ownerR.rows[0]?.display_name || null,
      filters,
      trip,
      expires_at: link.expires_at,
    };
  }

  let friends = await getFriends(link.user_id);
  if (filters.friend_ids && filters.friend_ids.length > 0) {
    const friendIdSet = new Set(filters.friend_ids.map((value) => String(value)));
    friends = friends.filter((friend) => friendIdSet.has(String(friend.id)));
  }
  const friendsWithData = [];
  for (const friend of friends) {
    const params = [link.user_id, friend.id];
    let sql = `SELECT * FROM loan_transactions WHERE user_id = $1 AND friend_id = $2 AND deleted_at IS NULL`;
    if (filters.year) {
      params.push(String(filters.year));
      sql += ` AND to_char(txn_date, 'YYYY') = $${params.length}`;
    }
    if (filters.month) {
      params.push(String(filters.month).padStart(2, '0'));
      sql += ` AND to_char(txn_date, 'MM') = $${params.length}`;
    }
    sql += ' ORDER BY txn_date DESC';
    const txnsR = await query(sql, params);
    friendsWithData.push({
      ...friend,
      transactions: txnsR.rows.map((row) => ({ ...row, paid: num(row.paid), received: num(row.received) })),
    });
  }

  return {
    link_type: link.link_type || 'friends',
    owner_name: ownerR.rows[0]?.display_name || null,
    filters,
    friends: friendsWithData,
    expires_at: link.expires_at,
  };
}

let societySchemaEnsured = false;
let schoolKidSchemaEnsured = false;

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function normalizeMonthKey(value, label = 'Month') {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) throw validationError(`${label} must be in YYYY-MM format`);
  return normalized;
}

function normalizePhoneNumber(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.length > 30) throw validationError('Phone number must be 30 characters or fewer');
  if (!/^[0-9+\-() ]+$/.test(normalized)) throw validationError('Phone number contains invalid characters');
  return normalized;
}

function normalizePropertyType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!['home', 'shop'].includes(normalized)) throw validationError('Property type must be home or shop');
  return normalized;
}

async function ensureSocietyTables() {
  if (societySchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS societies (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      location TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, name)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS society_members (
      id BIGSERIAL PRIMARY KEY,
      society_id BIGINT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      member_name TEXT NOT NULL,
      phone_number TEXT,
      unit_label TEXT NOT NULL,
      property_type TEXT NOT NULL DEFAULT 'home',
      monthly_due NUMERIC(12,2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`ALTER TABLE society_members ADD COLUMN IF NOT EXISTS monthly_due NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await query(`
    CREATE TABLE IF NOT EXISTS society_contributions (
      id BIGSERIAL PRIMARY KEY,
      society_id BIGINT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      member_id BIGINT NOT NULL REFERENCES society_members(id) ON DELETE CASCADE,
      month_key TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid_on DATE,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (society_id, member_id, month_key)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS society_expenses (
      id BIGSERIAL PRIMARY KEY,
      society_id BIGINT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      expense_date DATE NOT NULL,
      month_key TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS society_payment_requests (
      id BIGSERIAL PRIMARY KEY,
      society_id BIGINT NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
      member_id BIGINT NOT NULL REFERENCES society_members(id) ON DELETE CASCADE,
      month_key TEXT NOT NULL,
      requested_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      requested_paid_on DATE,
      member_note TEXT,
      request_source TEXT NOT NULL DEFAULT 'society_portal',
      status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT,
      reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`ALTER TABLE society_payment_requests ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await query(`ALTER TABLE society_payment_requests ADD COLUMN IF NOT EXISTS request_source TEXT NOT NULL DEFAULT 'society_portal'`);
  await query(`ALTER TABLE society_payment_requests ADD COLUMN IF NOT EXISTS review_note TEXT`);
  await query(`ALTER TABLE society_payment_requests ADD COLUMN IF NOT EXISTS reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE society_payment_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`);
  await query(`CREATE INDEX IF NOT EXISTS idx_societies_user_id ON societies(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_society_members_society_id ON society_members(society_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_society_contributions_society_month ON society_contributions(society_id, month_key)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_society_expenses_society_month ON society_expenses(society_id, month_key)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_society_payment_requests_society_status ON society_payment_requests(society_id, status, month_key)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_society_payment_requests_member_month ON society_payment_requests(member_id, month_key, status)`);
  societySchemaEnsured = true;
}

function normalizeSocietyAmount(value, label = 'Amount', { allowZero = true } = {}) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw validationError(`${label} is invalid`);
  if (allowZero ? amount < 0 : amount <= 0) throw validationError(`${label} must be ${allowZero ? '0 or more' : 'greater than 0'}`);
  return Math.round(amount * 100) / 100;
}

function mapSocietyPaymentRequestRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    society_id: Number(row.society_id),
    member_id: Number(row.member_id),
    month_key: row.month_key || '',
    requested_amount: num(row.requested_amount || 0),
    requested_paid_on: row.requested_paid_on || null,
    member_note: row.member_note || '',
    request_source: row.request_source || 'society_portal',
    status: row.status || 'pending',
    review_note: row.review_note || '',
    reviewed_by: row.reviewed_by != null ? Number(row.reviewed_by) : null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function normalizeSocietyPortalPhoneDigits(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(-10);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function getSocietyOwnedByUser(userId, societyId) {
  await ensureSocietyTables();
  const result = await query(
    `SELECT id, user_id, name, location, created_at, updated_at
     FROM societies
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [societyId, userId]
  );
  return result.rows[0] || null;
}

async function listSocieties(userId) {
  await ensureSocietyTables();
  const result = await query(
    `SELECT s.id,
            s.name,
            s.location,
            s.created_at,
            s.updated_at,
            COALESCE(m.member_count, 0) AS member_count,
            COALESCE(c.total_collected, 0) AS total_collected,
            COALESCE(e.total_spent, 0) AS total_spent,
            COALESCE(c.latest_month_key, e.latest_month_key, '') AS latest_month_key
     FROM societies s
     LEFT JOIN (
       SELECT society_id, COUNT(*) AS member_count
       FROM society_members
       GROUP BY society_id
     ) m ON m.society_id = s.id
     LEFT JOIN (
       SELECT society_id, SUM(amount) AS total_collected, MAX(month_key) AS latest_month_key
       FROM society_contributions
       GROUP BY society_id
     ) c ON c.society_id = s.id
     LEFT JOIN (
       SELECT society_id, SUM(amount) AS total_spent, MAX(month_key) AS latest_month_key
       FROM society_expenses
       GROUP BY society_id
     ) e ON e.society_id = s.id
     WHERE s.user_id = $1
     ORDER BY lower(s.name), s.id`,
    [userId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    location: row.location || '',
    member_count: Number(row.member_count || 0),
    total_collected: num(row.total_collected),
    total_spent: num(row.total_spent),
    latest_month_key: row.latest_month_key || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function createSociety(userId, data = {}) {
  await ensureSocietyTables();
  const name = normalizeText(data.name, 'Society name', 120);
  const location = normalizeOptionalText(data.location, 160);
  const result = await query(
    `INSERT INTO societies (user_id, name, location, updated_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, user_id, name, location, created_at, updated_at`,
    [userId, name, location]
  );
  return result.rows[0];
}

async function updateSociety(userId, societyId, data = {}) {
  await ensureSocietyTables();
  const current = await getSocietyOwnedByUser(userId, societyId);
  if (!current) throw validationError('Society not found');
  const name = data.name !== undefined ? normalizeText(data.name, 'Society name', 120) : current.name;
  const location = data.location !== undefined ? normalizeOptionalText(data.location, 160) : current.location;
  const result = await query(
    `UPDATE societies
     SET name = $1, location = $2, updated_at = NOW()
     WHERE id = $3 AND user_id = $4
     RETURNING id, user_id, name, location, created_at, updated_at`,
    [name, location, societyId, userId]
  );
  return result.rows[0] || null;
}

async function deleteSociety(userId, societyId) {
  await ensureSocietyTables();
  const society = await getSocietyOwnedByUser(userId, societyId);
  if (!society) throw validationError('Society not found');
  return withTransaction(async (client) => {
    const result = await client.query('DELETE FROM societies WHERE id = $1 AND user_id = $2', [societyId, userId]);
    return result.rowCount > 0;
  });
}

async function addSocietyMember(userId, societyId, data = {}) {
  const society = await getSocietyOwnedByUser(userId, societyId);
  if (!society) throw validationError('Society not found');
  const result = await query(
    `INSERT INTO society_members (society_id, member_name, phone_number, unit_label, property_type, monthly_due, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING id, society_id, member_name, phone_number, unit_label, property_type, monthly_due, is_active, created_at, updated_at`,
    [
      societyId,
      normalizeText(data.member_name, 'Member name', 120),
      normalizePhoneNumber(data.phone_number),
      normalizeText(data.unit_label, 'House number or shop name', 120),
      normalizePropertyType(data.property_type),
      normalizeSocietyAmount(data.monthly_due, 'Monthly due'),
      data.is_active !== false,
    ]
  );
  return result.rows[0];
}

async function updateSocietyMember(userId, societyId, memberId, data = {}) {
  const society = await getSocietyOwnedByUser(userId, societyId);
  if (!society) throw validationError('Society not found');
  const currentR = await query(
    `SELECT id, member_name, phone_number, unit_label, property_type, monthly_due, is_active
     FROM society_members
     WHERE id = $1 AND society_id = $2
     LIMIT 1`,
    [memberId, societyId]
  );
  const current = currentR.rows[0];
  if (!current) throw validationError('Society member not found');
  const result = await query(
    `UPDATE society_members
     SET member_name = $1,
         phone_number = $2,
         unit_label = $3,
         property_type = $4,
         monthly_due = $5,
         is_active = $6,
         updated_at = NOW()
     WHERE id = $7 AND society_id = $8
     RETURNING id, society_id, member_name, phone_number, unit_label, property_type, monthly_due, is_active, created_at, updated_at`,
    [
      data.member_name !== undefined ? normalizeText(data.member_name, 'Member name', 120) : current.member_name,
      data.phone_number !== undefined ? normalizePhoneNumber(data.phone_number) : current.phone_number,
      data.unit_label !== undefined ? normalizeText(data.unit_label, 'House number or shop name', 120) : current.unit_label,
      data.property_type !== undefined ? normalizePropertyType(data.property_type) : current.property_type,
      data.monthly_due !== undefined ? normalizeSocietyAmount(data.monthly_due, 'Monthly due') : normalizeSocietyAmount(current.monthly_due, 'Monthly due'),
      data.is_active !== undefined ? !!data.is_active : !!current.is_active,
      memberId,
      societyId,
    ]
  );
  return result.rows[0] || null;
}

async function deleteSocietyMember(userId, societyId, memberId) {
  const society = await getSocietyOwnedByUser(userId, societyId);
  if (!society) throw validationError('Society not found');
  const result = await query('DELETE FROM society_members WHERE id = $1 AND society_id = $2', [memberId, societyId]);
  return result.rowCount > 0;
}

async function getSocietyMemberPortalRecordByPhone(phone) {
  await ensureSocietyTables();
  const localPhone = normalizeSocietyPortalPhoneDigits(phone);
  if (!localPhone || localPhone.length !== 10) return null;
  const result = await query(
    `SELECT m.id,
            m.society_id,
            m.member_name,
            m.phone_number,
            m.unit_label,
            m.property_type,
            m.monthly_due,
            m.is_active,
            s.user_id,
            s.name AS society_name,
            s.location AS society_location
     FROM society_members m
     INNER JOIN societies s ON s.id = m.society_id
     WHERE m.is_active = TRUE
       AND RIGHT(REGEXP_REPLACE(COALESCE(m.phone_number, ''), '[^0-9]', '', 'g'), 10) = $1
     ORDER BY m.updated_at DESC, m.id DESC
     LIMIT 1`,
    [localPhone]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    society_id: Number(row.society_id),
    user_id: Number(row.user_id),
    member_name: row.member_name || '',
    phone_number: row.phone_number || '',
    unit_label: row.unit_label || '',
    property_type: row.property_type || 'home',
    monthly_due: num(row.monthly_due),
    is_active: !!row.is_active,
    society_name: row.society_name || '',
    society_location: row.society_location || '',
  };
}

async function createSocietyContributionPaymentRequestByMember(memberId, data = {}) {
  await ensureSocietyTables();
  return withTransaction(async (client) => {
    const memberResult = await client.query(
      `SELECT m.id,
              m.society_id,
              m.member_name,
              m.monthly_due,
              m.is_active
       FROM society_members m
       WHERE m.id = $1
       LIMIT 1`,
      [memberId]
    );
    const member = memberResult.rows[0];
    if (!member || !member.is_active) throw validationError('Society member not found');

    const monthKey = normalizeMonthKey(data.month_key || currentMonthKey());
    const requestedAmount = normalizeSocietyAmount(data.requested_amount != null ? data.requested_amount : data.amount, 'Requested amount', { allowZero: false });
    const requestedPaidOn = data.requested_paid_on ? normalizeDateValue(data.requested_paid_on, 'Paid on') : (data.paid_on ? normalizeDateValue(data.paid_on, 'Paid on') : null);
    const memberNote = normalizeOptionalText(data.member_note != null ? data.member_note : data.notes, 500);

    const approvedContributionResult = await client.query(
      `SELECT amount
       FROM society_contributions
       WHERE society_id = $1
         AND member_id = $2
         AND month_key = $3
       LIMIT 1`,
      [member.society_id, member.id, monthKey]
    );
    const approvedContribution = approvedContributionResult.rows[0];
    if (approvedContribution && num(approvedContribution.amount) >= requestedAmount) {
      throw validationError('This month is already marked as paid for this member');
    }

    const pendingResult = await client.query(
      `SELECT *
       FROM society_payment_requests
       WHERE society_id = $1
         AND member_id = $2
         AND month_key = $3
         AND status = 'pending'
       ORDER BY id DESC
       LIMIT 1`,
      [member.society_id, member.id, monthKey]
    );
    if (pendingResult.rows[0]) return mapSocietyPaymentRequestRow(pendingResult.rows[0]);

    const inserted = await client.query(
      `INSERT INTO society_payment_requests (
        society_id, member_id, month_key, requested_amount, requested_paid_on, member_note, request_source, status, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'society_portal', 'pending', NOW()
      )
      RETURNING *`,
      [member.society_id, member.id, monthKey, requestedAmount, requestedPaidOn, memberNote]
    );
    return mapSocietyPaymentRequestRow(inserted.rows[0]);
  });
}

async function getSocietyContributionPaymentRequestNotificationContext(requestId) {
  await ensureSocietyTables();
  const result = await query(
    `SELECT req.id,
            req.society_id,
            req.member_id,
            req.month_key,
            req.requested_amount,
            req.requested_paid_on,
            req.member_note,
            req.status,
            req.requested_at,
            m.member_name,
            m.phone_number,
            m.unit_label,
            m.property_type,
            m.monthly_due,
            s.user_id AS owner_user_id,
            s.name AS society_name,
            s.location AS society_location,
            u.display_name AS owner_name,
            u.email AS owner_email,
            u.mobile AS owner_mobile,
            u.currency_code,
            u.locale_code
     FROM society_payment_requests req
     INNER JOIN society_members m ON m.id = req.member_id
     INNER JOIN societies s ON s.id = req.society_id
     LEFT JOIN users u ON u.id = s.user_id
     WHERE req.id = $1
     LIMIT 1`,
    [requestId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    request_id: Number(row.id),
    society_id: Number(row.society_id),
    member_id: Number(row.member_id),
    month_key: row.month_key || '',
    requested_amount: num(row.requested_amount || 0),
    requested_paid_on: row.requested_paid_on || null,
    member_note: row.member_note || '',
    status: row.status || 'pending',
    requested_at: row.requested_at || null,
    member_name: row.member_name || '',
    phone_number: row.phone_number || '',
    unit_label: row.unit_label || '',
    property_type: row.property_type || 'home',
    monthly_due: num(row.monthly_due || 0),
    owner_user_id: Number(row.owner_user_id || 0),
    owner_name: row.owner_name || '',
    owner_email: row.owner_email || '',
    owner_mobile: row.owner_mobile || '',
    society_name: row.society_name || '',
    society_location: row.society_location || '',
    currency_code: row.currency_code || 'INR',
    locale_code: row.locale_code || 'en-IN',
  };
}

async function getSocietyPendingApprovalCount(userId) {
  await ensureSocietyTables();
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM society_payment_requests req
     INNER JOIN societies s ON s.id = req.society_id
     WHERE s.user_id = $1
       AND req.status = 'pending'`,
    [userId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function reviewSocietyContributionPaymentRequest(userId, requestId, data = {}) {
  await ensureSocietyTables();
  return withTransaction(async (client) => {
    const requestResult = await client.query(
      `SELECT req.*,
              s.user_id AS owner_user_id,
              m.monthly_due
       FROM society_payment_requests req
       INNER JOIN societies s ON s.id = req.society_id
       INNER JOIN society_members m ON m.id = req.member_id
       WHERE req.id = $1
         AND s.user_id = $2
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
      `UPDATE society_payment_requests
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
      await client.query(
        `INSERT INTO society_contributions (society_id, member_id, month_key, amount, paid_on, notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (society_id, member_id, month_key)
         DO UPDATE SET amount = EXCLUDED.amount,
                       paid_on = EXCLUDED.paid_on,
                       notes = EXCLUDED.notes,
                       updated_at = NOW()`,
        [
          requestRow.society_id,
          requestRow.member_id,
          requestRow.month_key,
          num(requestRow.requested_amount),
          requestRow.requested_paid_on || null,
          requestRow.member_note || 'Approved from society portal',
        ]
      );
    }
    return {
      request: mapSocietyPaymentRequestRow(requestUpdate.rows[0]),
    };
  });
}

async function saveSocietyContribution(userId, societyId, memberId, data = {}) {
  const society = await getSocietyOwnedByUser(userId, societyId);
  if (!society) throw validationError('Society not found');
  const memberR = await query(
    `SELECT id FROM society_members WHERE id = $1 AND society_id = $2 LIMIT 1`,
    [memberId, societyId]
  );
  if (!memberR.rows[0]) throw validationError('Society member not found');
  const monthKey = normalizeMonthKey(data.month_key || currentMonthKey());
  const rawAmount = Number(data.amount || 0);
  if (!Number.isFinite(rawAmount) || rawAmount < 0) throw validationError('Contribution amount must be 0 or more');
  const amount = Math.round(rawAmount * 100) / 100;
  const paidOn = data.paid_on ? normalizeDateValue(data.paid_on, 'Paid on') : null;
  const notes = data.notes != null ? normalizeOptionalText(data.notes, 500) : null;
  if (amount === 0) {
    await query(
      `DELETE FROM society_contributions
       WHERE society_id = $1 AND member_id = $2 AND month_key = $3`,
      [societyId, memberId, monthKey]
    );
    return { deleted: true, member_id: Number(memberId), month_key: monthKey, amount: 0 };
  }
  const result = await query(
    `INSERT INTO society_contributions (society_id, member_id, month_key, amount, paid_on, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (society_id, member_id, month_key)
     DO UPDATE SET amount = EXCLUDED.amount,
                   paid_on = EXCLUDED.paid_on,
                   notes = EXCLUDED.notes,
                   updated_at = NOW()
     RETURNING id, society_id, member_id, month_key, amount, paid_on, notes, created_at, updated_at`,
    [societyId, memberId, monthKey, amount, paidOn, notes]
  );
  return result.rows[0];
}

async function addSocietyExpense(userId, societyId, data = {}) {
  const society = await getSocietyOwnedByUser(userId, societyId);
  if (!society) throw validationError('Society not found');
  const expenseDate = normalizeDateValue(data.expense_date || new Date().toISOString().slice(0, 10), 'Expense date');
  const result = await query(
    `INSERT INTO society_expenses (society_id, expense_date, month_key, title, category, amount, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING id, society_id, expense_date, month_key, title, category, amount, notes, created_at, updated_at`,
    [
      societyId,
      expenseDate,
      normalizeMonthKey(data.month_key || expenseDate.slice(0, 7)),
      normalizeText(data.title, 'Expense title', 160),
      normalizeOptionalText(data.category, 80),
      normalizeAmount(data.amount, 'Expense amount'),
      normalizeOptionalText(data.notes, 500),
    ]
  );
  return result.rows[0];
}

async function updateSocietyExpense(userId, societyId, expenseId, data = {}) {
  const society = await getSocietyOwnedByUser(userId, societyId);
  if (!society) throw validationError('Society not found');
  const currentR = await query(
    `SELECT id, expense_date, month_key, title, category, amount, notes
     FROM society_expenses
     WHERE id = $1 AND society_id = $2
     LIMIT 1`,
    [expenseId, societyId]
  );
  const current = currentR.rows[0];
  if (!current) throw validationError('Society expense not found');
  const expenseDate = data.expense_date !== undefined ? normalizeDateValue(data.expense_date, 'Expense date') : current.expense_date;
  const result = await query(
    `UPDATE society_expenses
     SET expense_date = $1,
         month_key = $2,
         title = $3,
         category = $4,
         amount = $5,
         notes = $6,
         updated_at = NOW()
     WHERE id = $7 AND society_id = $8
     RETURNING id, society_id, expense_date, month_key, title, category, amount, notes, created_at, updated_at`,
    [
      expenseDate,
      data.month_key !== undefined ? normalizeMonthKey(data.month_key) : String(expenseDate).slice(0, 7),
      data.title !== undefined ? normalizeText(data.title, 'Expense title', 160) : current.title,
      data.category !== undefined ? normalizeOptionalText(data.category, 80) : current.category,
      data.amount !== undefined ? normalizeAmount(data.amount, 'Expense amount') : num(current.amount),
      data.notes !== undefined ? normalizeOptionalText(data.notes, 500) : current.notes,
      expenseId,
      societyId,
    ]
  );
  return result.rows[0] || null;
}

async function deleteSocietyExpense(userId, societyId, expenseId) {
  const society = await getSocietyOwnedByUser(userId, societyId);
  if (!society) throw validationError('Society not found');
  const result = await query('DELETE FROM society_expenses WHERE id = $1 AND society_id = $2', [expenseId, societyId]);
  return result.rowCount > 0;
}

async function getSocietyDetail(userId, societyId, options = {}) {
  const society = await getSocietyOwnedByUser(userId, societyId);
  if (!society) throw validationError('Society not found');
  const [membersR, contributionsR, expensesR, requestsR] = await Promise.all([
    query(
      `SELECT id, society_id, member_name, phone_number, unit_label, property_type, monthly_due, is_active, created_at, updated_at
       FROM society_members
       WHERE society_id = $1
       ORDER BY lower(member_name), lower(unit_label), id`,
      [societyId]
    ),
    query(
      `SELECT id, society_id, member_id, month_key, amount, paid_on, notes, created_at, updated_at
       FROM society_contributions
       WHERE society_id = $1
       ORDER BY month_key DESC, member_id ASC`,
      [societyId]
    ),
    query(
      `SELECT id, society_id, expense_date, month_key, title, category, amount, notes, created_at, updated_at
       FROM society_expenses
       WHERE society_id = $1
       ORDER BY expense_date DESC, id DESC`,
      [societyId]
    ),
    query(
      `SELECT id, society_id, member_id, month_key, requested_amount, requested_paid_on, member_note, request_source, status, review_note, reviewed_by, reviewed_at, created_at, updated_at
       FROM society_payment_requests
       WHERE society_id = $1
       ORDER BY created_at DESC, id DESC`,
      [societyId]
    ),
  ]);
  const members = membersR.rows.map((row) => ({
    id: Number(row.id),
    society_id: Number(row.society_id),
    member_name: row.member_name,
    phone_number: row.phone_number || '',
    unit_label: row.unit_label,
    property_type: row.property_type,
    monthly_due: num(row.monthly_due),
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const contributions = contributionsR.rows.map((row) => ({
    id: Number(row.id),
    society_id: Number(row.society_id),
    member_id: Number(row.member_id),
    month_key: row.month_key,
    amount: num(row.amount),
    paid_on: row.paid_on,
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const expenses = expensesR.rows.map((row) => ({
    id: Number(row.id),
    society_id: Number(row.society_id),
    expense_date: row.expense_date,
    month_key: row.month_key,
    title: row.title,
    category: row.category || '',
    amount: num(row.amount),
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const paymentRequests = requestsR.rows.map(mapSocietyPaymentRequestRow);
  const monthCandidates = [
    ...contributions.map((item) => item.month_key),
    ...expenses.map((item) => item.month_key),
    ...paymentRequests.map((item) => item.month_key),
  ].filter(Boolean);
  const selectedMonth = options.month ? normalizeMonthKey(options.month) : (monthCandidates.sort().slice(-1)[0] || currentMonthKey());
  const matrixMonths = [...new Set([...monthCandidates, selectedMonth])].sort();
  const contributionByMemberMonth = new Map(contributions.map((item) => [`${item.member_id}:${item.month_key}`, item]));
  const latestRequestByMemberMonth = new Map();
  paymentRequests.forEach((request) => {
    const key = `${request.member_id}:${request.month_key}`;
    if (!latestRequestByMemberMonth.has(key)) latestRequestByMemberMonth.set(key, request);
  });
  const membersWithContributions = members.map((member) => {
    const selectedContribution = contributionByMemberMonth.get(`${member.id}:${selectedMonth}`) || null;
    const selectedRequest = latestRequestByMemberMonth.get(`${member.id}:${selectedMonth}`) || null;
    const contributionsByMonth = {};
    const requestsByMonth = {};
    matrixMonths.forEach((monthKey) => {
      const found = contributionByMemberMonth.get(`${member.id}:${monthKey}`);
      contributionsByMonth[monthKey] = found ? num(found.amount) : 0;
      requestsByMonth[monthKey] = latestRequestByMemberMonth.get(`${member.id}:${monthKey}`) || null;
    });
    return {
      ...member,
      selected_month_due: num(member.monthly_due),
      selected_month_amount: selectedContribution ? num(selectedContribution.amount) : 0,
      selected_month_paid_on: selectedContribution?.paid_on || null,
      selected_month_notes: selectedContribution?.notes || '',
      selected_month_pending: Math.max(0, Math.round((num(member.monthly_due) - num(selectedContribution ? selectedContribution.amount : 0)) * 100) / 100),
      selected_month_status: selectedContribution && num(selectedContribution.amount) > 0 ? 'paid' : (num(member.monthly_due) <= 0 ? 'not_set' : 'pending'),
      selected_month_request: selectedRequest,
      selected_month_request_status: selectedRequest?.status || '',
      contributions_by_month: contributionsByMonth,
      requests_by_month: requestsByMonth,
      total_contributed: contributions
        .filter((item) => item.member_id === member.id)
        .reduce((sum, item) => Math.round((sum + num(item.amount)) * 100) / 100, 0),
    };
  });
  const monthExpenses = expenses.filter((item) => item.month_key === selectedMonth);
  const monthContributionTotal = membersWithContributions.reduce((sum, member) => Math.round((sum + num(member.selected_month_amount)) * 100) / 100, 0);
  const monthDueTotal = membersWithContributions.reduce((sum, member) => Math.round((sum + num(member.selected_month_due)) * 100) / 100, 0);
  const monthExpenseTotal = monthExpenses.reduce((sum, item) => Math.round((sum + num(item.amount)) * 100) / 100, 0);
  const overallContributionTotal = contributions.reduce((sum, item) => Math.round((sum + num(item.amount)) * 100) / 100, 0);
  const overallExpenseTotal = expenses.reduce((sum, item) => Math.round((sum + num(item.amount)) * 100) / 100, 0);
  const paidMembers = membersWithContributions.filter((member) => num(member.selected_month_amount) > 0);
  const paidMemberIds = new Set(paidMembers.map((member) => Number(member.id)));
  const pendingMembers = membersWithContributions.filter((member) => !paidMemberIds.has(Number(member.id)));
  const monthSummary = matrixMonths.map((monthKey) => {
    const collected = contributions.filter((item) => item.month_key === monthKey).reduce((sum, item) => Math.round((sum + num(item.amount)) * 100) / 100, 0);
    const spent = expenses.filter((item) => item.month_key === monthKey).reduce((sum, item) => Math.round((sum + num(item.amount)) * 100) / 100, 0);
    const paidCount = membersWithContributions.filter((member) => {
      const amount = num((member.contributions_by_month || {})[monthKey] || 0);
      return amount > 0;
    }).length;
    return {
      month_key: monthKey,
      collected,
      spent,
      balance: Math.round((collected - spent) * 100) / 100,
      paid_count: paidCount,
      due_total: membersWithContributions.reduce((sum, member) => Math.round((sum + num(member.monthly_due)) * 100) / 100, 0),
    };
  }).sort((a, b) => a.month_key.localeCompare(b.month_key));
  return {
    society: {
      id: Number(society.id),
      name: society.name,
      location: society.location || '',
      created_at: society.created_at,
      updated_at: society.updated_at,
    },
    selected_month: selectedMonth,
    matrix_months: matrixMonths,
    members: membersWithContributions,
    contributions,
    payment_requests: paymentRequests,
    pending_payment_requests: paymentRequests.filter((item) => String(item.status || '').toLowerCase() === 'pending'),
    expenses,
    month_expenses: monthExpenses,
    month_summary: monthSummary,
    payment_status: {
      paid_members: paidMembers,
      pending_members: pendingMembers,
      paid_count: paidMembers.length,
      pending_count: pendingMembers.length,
      due_total: monthDueTotal,
      pending_total: Math.max(0, Math.round((monthDueTotal - monthContributionTotal) * 100) / 100),
      collection_ratio: monthDueTotal > 0 ? Math.round((monthContributionTotal / monthDueTotal) * 10000) / 100 : 0,
    },
    totals: {
      member_count: members.length,
      selected_month_due: monthDueTotal,
      selected_month_collected: monthContributionTotal,
      selected_month_spent: monthExpenseTotal,
      selected_month_balance: Math.round((monthContributionTotal - monthExpenseTotal) * 100) / 100,
      overall_collected: overallContributionTotal,
      overall_spent: overallExpenseTotal,
      overall_balance: Math.round((overallContributionTotal - overallExpenseTotal) * 100) / 100,
    },
  };
}

async function getSocietyMemberPortalDashboard(memberId) {
  await ensureSocietyTables();
  const memberResult = await query(
    `SELECT m.id,
            m.society_id,
            m.member_name,
            m.phone_number,
            m.unit_label,
            m.property_type,
            m.monthly_due,
            m.is_active,
            s.user_id,
            s.name AS society_name,
            s.location AS society_location
     FROM society_members m
     INNER JOIN societies s ON s.id = m.society_id
     WHERE m.id = $1
     LIMIT 1`,
    [memberId]
  );
  const memberRow = memberResult.rows[0];
  if (!memberRow || !memberRow.is_active) return null;

  const detail = await getSocietyDetail(Number(memberRow.user_id), Number(memberRow.society_id), {
    month: currentMonthKey(),
  });
  const member = (detail.members || []).find((item) => Number(item.id) === Number(memberId));
  if (!member) return null;

  const requests = (detail.payment_requests || []).filter((item) => Number(item.member_id) === Number(memberId));
  const monthKeys = [...new Set([currentMonthKey(), ...(detail.matrix_months || [])])].sort().reverse();
  const contributionHistory = monthKeys.map((monthKey) => {
    const amount = num((member.contributions_by_month || {})[monthKey] || 0);
    const request = (member.requests_by_month || {})[monthKey] || null;
    const due = num(member.monthly_due || 0);
    let status = 'pending';
    if (amount > 0) status = 'paid';
    else if (request && String(request.status || '').toLowerCase() === 'pending') status = 'approval_pending';
    else if (request && String(request.status || '').toLowerCase() === 'rejected') status = 'rejected';
    return {
      month_key: monthKey,
      amount,
      due_amount: due,
      paid_on: monthKey === detail.selected_month ? member.selected_month_paid_on || null : null,
      status,
      request,
    };
  });

  const latestPaid = contributionHistory.find((item) => item.status === 'paid' && item.amount > 0) || null;
  const currentMonthItem = contributionHistory.find((item) => item.month_key === currentMonthKey()) || null;
  const pendingMonths = contributionHistory.filter((item) => item.status === 'pending' && item.due_amount > 0);
  const recentExpenses = (detail.expenses || []).slice(0, 8);

  return {
    society: detail.society,
    member: {
      id: Number(member.id),
      member_name: member.member_name || '',
      phone_number: member.phone_number || '',
      unit_label: member.unit_label || '',
      property_type: member.property_type || 'home',
      monthly_due: num(member.monthly_due || 0),
    },
    summary: {
      my_total: num(member.total_contributed || 0),
      pending_amount: currentMonthItem?.request && String(currentMonthItem.request.status || '').toLowerCase() === 'pending'
        ? num(currentMonthItem.request.requested_amount || 0)
        : 0,
      last_paid_month: latestPaid?.month_key || '',
      pending_month_count: contributionHistory.filter((item) => ['pending', 'approval_pending'].includes(String(item.status || '').toLowerCase())).length,
      current_month: currentMonthKey(),
    },
    contribution_history: contributionHistory,
    pending_requests: requests.filter((item) => String(item.status || '').toLowerCase() === 'pending'),
    payment_requests: requests,
    expenses: detail.expenses || [],
    recent_expenses: recentExpenses,
    month_summary: detail.month_summary || [],
    totals: detail.totals || {},
    payment_status: detail.payment_status || {},
  };
}

function normalizeSchoolKidAmount(value, label = 'Amount', { allowZero = true } = {}) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw validationError(`${label} is invalid`);
  if (allowZero ? amount < 0 : amount <= 0) throw validationError(`${label} must be ${allowZero ? '0 or more' : 'greater than 0'}`);
  return Math.round(amount * 100) / 100;
}

function normalizeSchoolKidAge(value) {
  if (value === '' || value == null) return null;
  const age = Number(value);
  if (!Number.isInteger(age) || age < 0 || age > 30) throw validationError('Age must be a whole number between 0 and 30');
  return age;
}

function normalizeSchoolKidDateOfBirth(value) {
  if (value === '' || value == null) return null;
  const normalized = normalizeDateValue(value, 'Date of birth');
  const derivedAge = deriveSchoolKidAgeFromDateOfBirth(normalized);
  if (derivedAge == null) throw validationError('Date of birth is invalid');
  if (derivedAge < 0) throw validationError('Date of birth cannot be in the future');
  if (derivedAge > 30) throw validationError('Date of birth must be within the last 30 years');
  return normalized;
}

function schoolKidDateToIso(value) {
  if (value === '' || value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())).toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())).toISOString().slice(0, 10);
}

function deriveSchoolKidAgeFromDateOfBirth(value) {
  const normalized = schoolKidDateToIso(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(birthDate.getTime())
    || birthDate.getUTCFullYear() !== year
    || birthDate.getUTCMonth() !== month - 1
    || birthDate.getUTCDate() !== day
  ) {
    return null;
  }
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (birthDate.getTime() > todayUtc.getTime()) return -1;
  let age = todayUtc.getUTCFullYear() - year;
  if (
    todayUtc.getUTCMonth() < birthDate.getUTCMonth()
    || (todayUtc.getUTCMonth() === birthDate.getUTCMonth() && todayUtc.getUTCDate() < birthDate.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

function normalizeAcademicYear(value) {
  const normalized = String(value || '').trim();
  if (!normalized) throw validationError('Academic year is required');
  if (normalized.length > 20) throw validationError('Academic year must be 20 characters or fewer');
  return normalized;
}

function parseAcademicYearStart(value) {
  const match = String(value || '').match(/(\d{4})/);
  return match ? Number(match[1]) : 0;
}

function schoolClassRank(label) {
  const normalized = String(label || '').trim().toLowerCase();
  const map = {
    playway: 0,
    play: 0,
    nursery: 1,
    lkg: 2,
    ukg: 3,
    '1st': 4,
    '2nd': 5,
    '3rd': 6,
    '4th': 7,
    '5th': 8,
    '6th': 9,
    '7th': 10,
    '8th': 11,
    '9th': 12,
    '10th': 13,
    '11th': 14,
    '12th': 15,
  };
  if (map[normalized] != null) return map[normalized];
  const numMatch = normalized.match(/^(\d{1,2})/);
  if (numMatch) return 100 + Number(numMatch[1]);
  return 999;
}

function sortSchoolKidClassRows(rows = []) {
  return [...rows].sort((a, b) => {
    const kidCmp = String(a.kid_name || '').localeCompare(String(b.kid_name || ''));
    if (kidCmp) return kidCmp;
    const schoolCmp = String(a.school_name || '').localeCompare(String(b.school_name || ''));
    if (schoolCmp) return schoolCmp;
    const yearCmp = parseAcademicYearStart(a.academic_year) - parseAcademicYearStart(b.academic_year);
    if (yearCmp) return yearCmp;
    const classCmp = schoolClassRank(a.class_label) - schoolClassRank(b.class_label);
    if (classCmp) return classCmp;
    return Number(a.id || 0) - Number(b.id || 0);
  });
}

async function ensureSchoolKidTables() {
  if (schoolKidSchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS school_kids (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kid_name TEXT NOT NULL,
      age_years INTEGER,
      date_of_birth DATE,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, kid_name)
    )`);
  await query(`ALTER TABLE school_kids ADD COLUMN IF NOT EXISTS date_of_birth DATE`);
  await query(`
    CREATE TABLE IF NOT EXISTS school_kid_classes (
      id BIGSERIAL PRIMARY KEY,
      kid_id BIGINT NOT NULL REFERENCES school_kids(id) ON DELETE CASCADE,
      school_name TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      class_label TEXT NOT NULL,
      expected_monthly_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      bus_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      other_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (kid_id, school_name, academic_year, class_label)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS school_kid_expenses (
      id BIGSERIAL PRIMARY KEY,
      kid_id BIGINT NOT NULL REFERENCES school_kids(id) ON DELETE CASCADE,
      class_id BIGINT NOT NULL REFERENCES school_kid_classes(id) ON DELETE CASCADE,
      expense_date DATE NOT NULL,
      item_name TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_school_kids_user_id ON school_kids(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_school_kid_classes_kid_id ON school_kid_classes(kid_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_school_kid_expenses_kid_id ON school_kid_expenses(kid_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_school_kid_expenses_class_id ON school_kid_expenses(class_id)`);
  schoolKidSchemaEnsured = true;
}

async function getSchoolKidOwnedByUser(userId, kidId) {
  await ensureSchoolKidTables();
  const result = await query(
    `SELECT id, user_id, kid_name, age_years, date_of_birth, details, created_at, updated_at
     FROM school_kids
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [kidId, userId]
  );
  return result.rows[0] || null;
}

async function getSchoolKidClassOwnedByUser(userId, kidId, classId) {
  await ensureSchoolKidTables();
  const result = await query(
    `SELECT c.id,
            c.kid_id,
            c.school_name,
            c.academic_year,
            c.class_label,
            c.expected_monthly_fee,
            c.bus_fee,
            c.other_fee,
            c.details,
            c.created_at,
            c.updated_at
     FROM school_kid_classes c
     INNER JOIN school_kids k ON k.id = c.kid_id
     WHERE c.id = $1 AND c.kid_id = $2 AND k.user_id = $3
     LIMIT 1`,
    [classId, kidId, userId]
  );
  return result.rows[0] || null;
}

async function listSchoolKids(userId) {
  await ensureSchoolKidTables();
  const result = await query(
    `SELECT k.id,
            k.kid_name,
            k.age_years,
            k.date_of_birth,
            k.details,
            k.created_at,
            k.updated_at,
            COALESCE(cls.class_count, 0) AS class_count,
            COALESCE(exp.total_expense, 0) AS total_expense
     FROM school_kids k
     LEFT JOIN (
       SELECT kid_id, COUNT(*) AS class_count
       FROM school_kid_classes
       GROUP BY kid_id
     ) cls ON cls.kid_id = k.id
     LEFT JOIN (
       SELECT kid_id, SUM(amount) AS total_expense
       FROM school_kid_expenses
       GROUP BY kid_id
     ) exp ON exp.kid_id = k.id
     WHERE k.user_id = $1
     ORDER BY lower(k.kid_name), k.id`,
    [userId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    kid_name: row.kid_name,
    age_years: row.date_of_birth ? deriveSchoolKidAgeFromDateOfBirth(row.date_of_birth) : (row.age_years != null ? Number(row.age_years) : null),
    date_of_birth: schoolKidDateToIso(row.date_of_birth),
    details: row.details || '',
    class_count: Number(row.class_count || 0),
    total_expense: num(row.total_expense),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function createSchoolKid(userId, data = {}) {
  await ensureSchoolKidTables();
  const dateOfBirth = normalizeSchoolKidDateOfBirth(data.date_of_birth);
  const fallbackAge = dateOfBirth ? null : normalizeSchoolKidAge(data.age_years);
  const result = await query(
    `INSERT INTO school_kids (user_id, kid_name, age_years, date_of_birth, details, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id, user_id, kid_name, age_years, date_of_birth, details, created_at, updated_at`,
    [
      userId,
      normalizeText(data.kid_name, 'Kid name', 120),
      fallbackAge,
      dateOfBirth,
      normalizeOptionalText(data.details, 500),
    ]
  );
  const row = result.rows[0];
  return {
    ...row,
    age_years: row?.date_of_birth ? deriveSchoolKidAgeFromDateOfBirth(row.date_of_birth) : (row?.age_years != null ? Number(row.age_years) : null),
    date_of_birth: schoolKidDateToIso(row?.date_of_birth),
  };
}

async function updateSchoolKid(userId, kidId, data = {}) {
  const current = await getSchoolKidOwnedByUser(userId, kidId);
  if (!current) throw validationError('Kid not found');
  const nextDateOfBirth = data.date_of_birth !== undefined
    ? normalizeSchoolKidDateOfBirth(data.date_of_birth)
    : (current.date_of_birth || null);
  const nextAgeYears = data.date_of_birth !== undefined
    ? (nextDateOfBirth ? null : (data.age_years !== undefined ? normalizeSchoolKidAge(data.age_years) : current.age_years))
    : (data.age_years !== undefined ? normalizeSchoolKidAge(data.age_years) : current.age_years);
  const result = await query(
    `UPDATE school_kids
     SET kid_name = $1,
         age_years = $2,
         date_of_birth = $3,
         details = $4,
         updated_at = NOW()
     WHERE id = $5 AND user_id = $6
     RETURNING id, user_id, kid_name, age_years, date_of_birth, details, created_at, updated_at`,
    [
      data.kid_name !== undefined ? normalizeText(data.kid_name, 'Kid name', 120) : current.kid_name,
      nextAgeYears,
      nextDateOfBirth,
      data.details !== undefined ? normalizeOptionalText(data.details, 500) : current.details,
      kidId,
      userId,
    ]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...row,
    age_years: row.date_of_birth ? deriveSchoolKidAgeFromDateOfBirth(row.date_of_birth) : (row.age_years != null ? Number(row.age_years) : null),
    date_of_birth: schoolKidDateToIso(row.date_of_birth),
  };
}

async function deleteSchoolKid(userId, kidId) {
  await ensureSchoolKidTables();
  return withTransaction(async (client) => {
    const expenseIdsR = await client.query(
      `SELECT e.id
       FROM school_kid_expenses e
       INNER JOIN school_kids k ON k.id = e.kid_id
       WHERE e.kid_id = $1 AND k.user_id = $2`,
      [kidId, userId]
    );
    await removeSchoolKidExpenseLedgerLinks(userId, expenseIdsR.rows.map((row) => Number(row.id)), client);
    const result = await client.query('DELETE FROM school_kids WHERE id = $1 AND user_id = $2', [kidId, userId]);
    return result.rowCount > 0;
  });
}

async function addSchoolKidClass(userId, kidId, data = {}) {
  const kid = await getSchoolKidOwnedByUser(userId, kidId);
  if (!kid) throw validationError('Kid not found');
  const result = await query(
    `INSERT INTO school_kid_classes (
       kid_id, school_name, academic_year, class_label,
       expected_monthly_fee, bus_fee, other_fee, details, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING id, kid_id, school_name, academic_year, class_label, expected_monthly_fee, bus_fee, other_fee, details, created_at, updated_at`,
    [
      kidId,
      normalizeText(data.school_name, 'School name', 160),
      normalizeAcademicYear(data.academic_year),
      normalizeText(data.class_label, 'Class', 60),
      normalizeSchoolKidAmount(data.expected_monthly_fee, 'Expected monthly fee'),
      normalizeSchoolKidAmount(data.bus_fee, 'Bus fee'),
      normalizeSchoolKidAmount(data.other_fee, 'Other fee'),
      normalizeOptionalText(data.details, 500),
    ]
  );
  return result.rows[0];
}

async function updateSchoolKidClass(userId, kidId, classId, data = {}) {
  const current = await getSchoolKidClassOwnedByUser(userId, kidId, classId);
  if (!current) throw validationError('Class not found');
  const result = await query(
    `UPDATE school_kid_classes
     SET school_name = $1,
         academic_year = $2,
         class_label = $3,
         expected_monthly_fee = $4,
         bus_fee = $5,
         other_fee = $6,
         details = $7,
         updated_at = NOW()
     WHERE id = $8 AND kid_id = $9
     RETURNING id, kid_id, school_name, academic_year, class_label, expected_monthly_fee, bus_fee, other_fee, details, created_at, updated_at`,
    [
      data.school_name !== undefined ? normalizeText(data.school_name, 'School name', 160) : current.school_name,
      data.academic_year !== undefined ? normalizeAcademicYear(data.academic_year) : current.academic_year,
      data.class_label !== undefined ? normalizeText(data.class_label, 'Class', 60) : current.class_label,
      data.expected_monthly_fee !== undefined ? normalizeSchoolKidAmount(data.expected_monthly_fee, 'Expected monthly fee') : num(current.expected_monthly_fee),
      data.bus_fee !== undefined ? normalizeSchoolKidAmount(data.bus_fee, 'Bus fee') : num(current.bus_fee),
      data.other_fee !== undefined ? normalizeSchoolKidAmount(data.other_fee, 'Other fee') : num(current.other_fee),
      data.details !== undefined ? normalizeOptionalText(data.details, 500) : current.details,
      classId,
      kidId,
    ]
  );
  return result.rows[0] || null;
}

async function deleteSchoolKidClass(userId, kidId, classId) {
  const current = await getSchoolKidClassOwnedByUser(userId, kidId, classId);
  if (!current) throw validationError('Class not found');
  return withTransaction(async (client) => {
    const expenseIdsR = await client.query(
      `SELECT id
       FROM school_kid_expenses
       WHERE kid_id = $1 AND class_id = $2`,
      [kidId, classId]
    );
    await removeSchoolKidExpenseLedgerLinks(userId, expenseIdsR.rows.map((row) => Number(row.id)), client);
    const result = await client.query('DELETE FROM school_kid_classes WHERE id = $1 AND kid_id = $2', [classId, kidId]);
    return result.rowCount > 0;
  });
}

const SCHOOL_KID_EXPENSE_SOURCE = 'school_kid_expense';

async function listLinkedExpenseRowsBySource(userId, sourceId, client) {
  const result = await client.query(
    `SELECT id, category, subcategory, is_extra, bank_account_id
     FROM expenses
     WHERE user_id = $1
       AND source = $2
       AND source_id = $3
       AND deleted_at IS NULL
     ORDER BY id DESC`,
    [userId, SCHOOL_KID_EXPENSE_SOURCE, sourceId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    category: row.category || '',
    subcategory: row.subcategory || '',
    is_extra: !!row.is_extra,
    bank_account_id: row.bank_account_id != null ? Number(row.bank_account_id) : null,
  }));
}

async function syncSchoolKidExpenseLedger(userId, schoolExpense, input = {}, client) {
  const linkedExpenseRows = await listLinkedExpenseRowsBySource(userId, schoolExpense.id, client);
  const linkedExpenseRow = linkedExpenseRows[0] || null;
  const linkedCcTxn = await pgBillingDb.getCcTxnBySource(userId, SCHOOL_KID_EXPENSE_SOURCE, schoolExpense.id, client);
  const addToExpense = input.add_to_expense !== undefined
    ? !!input.add_to_expense
    : !!(linkedExpenseRow || linkedCcTxn);
  const bankAccountId = input.bank_account_id !== undefined
    ? normalizeBankAccountId(input.bank_account_id)
    : (linkedCcTxn?.id ? null : normalizeBankAccountId(linkedExpenseRow?.bank_account_id));
  const cardId = input.card_id !== undefined
    ? normalizeCardId(input.card_id)
    : normalizeCardId(linkedCcTxn?.card_id);
  const expenseType = input.expense_type !== undefined
    ? (String(input.expense_type || 'fair').trim().toLowerCase() === 'extra' ? 'extra' : 'fair')
    : (linkedExpenseRow?.is_extra ? 'extra' : 'fair');
  const cardDiscountPct = input.card_discount_pct !== undefined
    ? normalizeDiscountPercent(input.card_discount_pct, 0)
    : num(linkedCcTxn?.discount_pct);
  if (bankAccountId && cardId) throw validationError('Choose either a bank or a card for add to expense');

  if (!addToExpense) {
    if (linkedCcTxn?.id) await pgBillingDb.deleteCcTxn(userId, linkedCcTxn.id, client);
    for (const linkedExpense of linkedExpenseRows) {
      await deleteExpense(userId, linkedExpense.id, client);
    }
    return;
  }

  const expensePayload = {
    item_name: schoolExpense.item_name,
    category: input.category !== undefined
      ? (normalizeOptionalText(input.category, 80) || 'Education')
      : (linkedExpenseRow?.category || 'Education'),
    subcategory: input.subcategory !== undefined
      ? normalizeOptionalText(input.subcategory, 80)
      : (linkedExpenseRow?.subcategory || 'School Kids'),
    amount: schoolExpense.amount,
    purchase_date: schoolExpense.expense_date,
    is_extra: expenseType === 'extra',
    bank_account_id: cardId ? null : bankAccountId,
    source: SCHOOL_KID_EXPENSE_SOURCE,
    source_id: schoolExpense.id,
  };

  if (linkedExpenseRow?.id) await updateExpense(userId, linkedExpenseRow.id, expensePayload, client);
  else await addExpense(userId, expensePayload, client);

  for (const extraExpense of linkedExpenseRows.slice(1)) {
    await deleteExpense(userId, extraExpense.id, client);
  }

  if (!cardId) {
    if (linkedCcTxn?.id) await pgBillingDb.deleteCcTxn(userId, linkedCcTxn.id, client);
    return;
  }

  if (linkedCcTxn?.id && Number(linkedCcTxn.card_id || 0) === cardId) {
    await pgBillingDb.updateCcTxn(userId, linkedCcTxn.id, {
      txn_date: schoolExpense.expense_date,
      description: schoolExpense.item_name,
      amount: schoolExpense.amount,
      discount_pct: cardDiscountPct,
    }, client);
    return;
  }

  if (linkedCcTxn?.id) await pgBillingDb.deleteCcTxn(userId, linkedCcTxn.id, client);
  await pgBillingDb.addCcTxn(userId, {
    card_id: cardId,
    txn_date: schoolExpense.expense_date,
    description: schoolExpense.item_name,
    amount: schoolExpense.amount,
    discount_pct: cardDiscountPct,
    source: SCHOOL_KID_EXPENSE_SOURCE,
    source_id: schoolExpense.id,
  }, client);
}

async function removeSchoolKidExpenseLedgerLinks(userId, expenseIds = [], client) {
  const normalized = [...new Set((expenseIds || []).map((value) => Number(value)).filter((value) => value > 0))];
  for (const expenseId of normalized) {
    const linkedCcTxn = await pgBillingDb.getCcTxnBySource(userId, SCHOOL_KID_EXPENSE_SOURCE, expenseId, client);
    if (linkedCcTxn?.id) await pgBillingDb.deleteCcTxn(userId, linkedCcTxn.id, client);
    const linkedExpenseIds = await listLinkedExpenseRowsBySource(userId, expenseId, client);
    for (const linkedExpense of linkedExpenseIds) {
      await deleteExpense(userId, linkedExpense.id, client);
    }
  }
}

async function getSchoolKidExpenseLedgerMeta(userId, expenseIds = []) {
  const normalized = [...new Set((expenseIds || []).map((value) => Number(value)).filter((value) => value > 0))];
  if (!normalized.length) return new Map();
  const [expenseLinksR, cardLinksR] = await Promise.all([
    query(
      `SELECT DISTINCT ON (source_id)
          source_id,
          id,
          is_extra,
          bank_account_id
       FROM expenses
       WHERE user_id = $1
         AND source = $2
         AND source_id = ANY($3::bigint[])
         AND deleted_at IS NULL
       ORDER BY source_id, id DESC`,
      [userId, SCHOOL_KID_EXPENSE_SOURCE, normalized]
    ),
    query(
      `SELECT DISTINCT ON (source_id)
          source_id,
          id,
          card_id,
          discount_pct
       FROM cc_txns
       WHERE user_id = $1
         AND source = $2
         AND source_id = ANY($3::bigint[])
       ORDER BY source_id, id DESC`,
      [userId, SCHOOL_KID_EXPENSE_SOURCE, normalized]
    ),
  ]);
  const meta = new Map();
  for (const row of expenseLinksR.rows || []) {
    meta.set(Number(row.source_id), {
      add_to_expense: true,
      expense_entry_id: Number(row.id),
      category: row.category || 'Education',
      subcategory: row.subcategory || 'School Kids',
      expense_type: row.is_extra ? 'extra' : 'fair',
      bank_account_id: row.bank_account_id != null ? Number(row.bank_account_id) : null,
      card_id: null,
      card_discount_pct: 0,
      cc_txn_id: null,
    });
  }
  for (const row of cardLinksR.rows || []) {
    const key = Number(row.source_id);
    const current = meta.get(key) || {
      add_to_expense: true,
      expense_entry_id: null,
      category: 'Education',
      subcategory: 'School Kids',
      expense_type: 'fair',
      bank_account_id: null,
      card_id: null,
      card_discount_pct: 0,
      cc_txn_id: null,
    };
    current.card_id = row.card_id != null ? Number(row.card_id) : null;
    current.card_discount_pct = num(row.discount_pct);
    current.cc_txn_id = Number(row.id);
    current.bank_account_id = null;
    meta.set(key, current);
  }
  return meta;
}

async function addSchoolKidExpense(userId, kidId, data = {}) {
  const kid = await getSchoolKidOwnedByUser(userId, kidId);
  if (!kid) throw validationError('Kid not found');
  const classId = Number(data.class_id || 0);
  const classRow = await getSchoolKidClassOwnedByUser(userId, kidId, classId);
  if (!classRow) throw validationError('Class not found');
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO school_kid_expenses (kid_id, class_id, expense_date, item_name, amount, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, kid_id, class_id, expense_date, item_name, amount, notes, created_at, updated_at`,
      [
        kidId,
        classId,
        normalizeDateValue(data.expense_date || new Date().toISOString().slice(0, 10), 'Expense date'),
        normalizeText(data.item_name, 'Expense item', 160),
        normalizeAmount(data.amount, 'Expense amount'),
        normalizeOptionalText(data.notes, 500),
      ]
    );
    const expense = result.rows[0];
    await syncSchoolKidExpenseLedger(userId, expense, data, client);
    return expense;
  });
}

async function updateSchoolKidExpense(userId, kidId, expenseId, data = {}) {
  const kid = await getSchoolKidOwnedByUser(userId, kidId);
  if (!kid) throw validationError('Kid not found');
  const currentR = await query(
    `SELECT e.id, e.kid_id, e.class_id, e.expense_date, e.item_name, e.amount, e.notes
     FROM school_kid_expenses e
     INNER JOIN school_kids k ON k.id = e.kid_id
     WHERE e.id = $1 AND e.kid_id = $2 AND k.user_id = $3
     LIMIT 1`,
    [expenseId, kidId, userId]
  );
  const current = currentR.rows[0];
  if (!current) throw validationError('Expense not found');
  const classId = data.class_id !== undefined ? Number(data.class_id || 0) : Number(current.class_id);
  const classRow = await getSchoolKidClassOwnedByUser(userId, kidId, classId);
  if (!classRow) throw validationError('Class not found');
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE school_kid_expenses
       SET class_id = $1,
           expense_date = $2,
           item_name = $3,
           amount = $4,
           notes = $5,
           updated_at = NOW()
       WHERE id = $6 AND kid_id = $7
       RETURNING id, kid_id, class_id, expense_date, item_name, amount, notes, created_at, updated_at`,
      [
        classId,
        data.expense_date !== undefined ? normalizeDateValue(data.expense_date, 'Expense date') : current.expense_date,
        data.item_name !== undefined ? normalizeText(data.item_name, 'Expense item', 160) : current.item_name,
        data.amount !== undefined ? normalizeAmount(data.amount, 'Expense amount') : num(current.amount),
        data.notes !== undefined ? normalizeOptionalText(data.notes, 500) : current.notes,
        expenseId,
        kidId,
      ]
    );
    const expense = result.rows[0] || null;
    if (expense) await syncSchoolKidExpenseLedger(userId, expense, data, client);
    return expense;
  });
}

async function deleteSchoolKidExpense(userId, kidId, expenseId) {
  const kid = await getSchoolKidOwnedByUser(userId, kidId);
  if (!kid) throw validationError('Kid not found');
  return withTransaction(async (client) => {
    await removeSchoolKidExpenseLedgerLinks(userId, [expenseId], client);
    const result = await client.query(
      `DELETE FROM school_kid_expenses
       WHERE id = $1 AND kid_id = $2`,
      [expenseId, kidId]
    );
    return result.rowCount > 0;
  });
}

async function replaceSchoolKidClassExpenses(userId, kidId, classId, expenses = []) {
  const classRow = await getSchoolKidClassOwnedByUser(userId, kidId, classId);
  if (!classRow) throw validationError('Class not found');
  return withTransaction(async (client) => {
    const existingR = await client.query(
      `SELECT id
       FROM school_kid_expenses
       WHERE kid_id = $1 AND class_id = $2`,
      [kidId, classId]
    );
    await removeSchoolKidExpenseLedgerLinks(userId, existingR.rows.map((row) => Number(row.id)), client);
    await client.query('DELETE FROM school_kid_expenses WHERE kid_id = $1 AND class_id = $2', [kidId, classId]);
    let inserted = 0;
    for (const item of expenses) {
      await client.query(
        `INSERT INTO school_kid_expenses (kid_id, class_id, expense_date, item_name, amount, notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          kidId,
          classId,
          normalizeDateValue(item.expense_date || new Date().toISOString().slice(0, 10), 'Expense date'),
          normalizeText(item.item_name, 'Expense item', 160),
          normalizeAmount(item.amount, 'Expense amount'),
          normalizeOptionalText(item.notes, 500),
        ]
      );
      inserted++;
    }
    return { success: true, inserted };
  });
}

async function getSchoolKidsOverview(userId) {
  await ensureSchoolKidTables();
  const [kidsR, classesR, expensesR] = await Promise.all([
    query(
      `SELECT id, kid_name, age_years, date_of_birth, details, created_at, updated_at
       FROM school_kids
       WHERE user_id = $1
       ORDER BY lower(kid_name), id`,
      [userId]
    ),
    query(
      `SELECT c.id, c.kid_id, c.school_name, c.academic_year, c.class_label,
              c.expected_monthly_fee, c.bus_fee, c.other_fee, c.details,
              c.created_at, c.updated_at, k.kid_name
       FROM school_kid_classes c
       INNER JOIN school_kids k ON k.id = c.kid_id
       WHERE k.user_id = $1
       ORDER BY lower(k.kid_name), c.academic_year, lower(c.school_name), lower(c.class_label), c.id`,
      [userId]
    ),
    query(
      `SELECT e.id, e.kid_id, e.class_id, e.expense_date, e.item_name, e.amount, e.notes,
              e.created_at, e.updated_at
       FROM school_kid_expenses e
       INNER JOIN school_kids k ON k.id = e.kid_id
       WHERE k.user_id = $1
       ORDER BY e.expense_date DESC, e.id DESC`,
      [userId]
    ),
  ]);
  const kids = kidsR.rows.map((row) => ({
    id: Number(row.id),
    kid_name: row.kid_name,
    age_years: row.date_of_birth ? deriveSchoolKidAgeFromDateOfBirth(row.date_of_birth) : (row.age_years != null ? Number(row.age_years) : null),
    date_of_birth: schoolKidDateToIso(row.date_of_birth),
    details: row.details || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const classRows = classesR.rows.map((row) => ({
    id: Number(row.id),
    kid_id: Number(row.kid_id),
    kid_name: row.kid_name,
    school_name: row.school_name,
    academic_year: row.academic_year,
    class_label: row.class_label,
    expected_monthly_fee: num(row.expected_monthly_fee),
    bus_fee: num(row.bus_fee),
    other_fee: num(row.other_fee),
    details: row.details || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const expenses = expensesR.rows.map((row) => ({
    id: Number(row.id),
    kid_id: Number(row.kid_id),
    class_id: Number(row.class_id),
    expense_date: row.expense_date,
    item_name: row.item_name,
    amount: num(row.amount),
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const expenseLedgerMeta = await getSchoolKidExpenseLedgerMeta(userId, expenses.map((row) => row.id));
  const expensesByClass = new Map();
  expenses.forEach((expense) => {
    const ledger = expenseLedgerMeta.get(expense.id);
    const list = expensesByClass.get(expense.class_id) || [];
    list.push({
      ...expense,
      add_to_expense: !!ledger?.add_to_expense,
      expense_entry_id: ledger?.expense_entry_id || null,
      category: ledger?.category || 'Education',
      subcategory: ledger?.subcategory || 'School Kids',
      expense_type: ledger?.expense_type || 'fair',
      bank_account_id: ledger?.bank_account_id || null,
      card_id: ledger?.card_id || null,
      card_discount_pct: ledger?.card_discount_pct || 0,
      cc_txn_id: ledger?.cc_txn_id || null,
    });
    expensesByClass.set(expense.class_id, list);
  });
  const enrichedClassRows = sortSchoolKidClassRows(classRows.map((row) => {
    const classExpenses = expensesByClass.get(row.id) || [];
    return {
      ...row,
      total_expense: classExpenses.reduce((sum, item) => Math.round((sum + num(item.amount)) * 100) / 100, 0),
      expense_count: classExpenses.length,
    };
  }));
  const classesByKid = new Map();
  enrichedClassRows.forEach((row) => {
    const list = classesByKid.get(row.kid_id) || [];
    list.push(row);
    classesByKid.set(row.kid_id, list);
  });
  const kidsWithRows = kids.map((kid) => {
    const rows = classesByKid.get(kid.id) || [];
    return {
      ...kid,
      total_expense: rows.reduce((sum, row) => Math.round((sum + num(row.total_expense)) * 100) / 100, 0),
      class_count: rows.length,
      class_rows: rows,
    };
  });
  return {
    kids: kidsWithRows,
    class_rows: enrichedClassRows,
    grand_total: kidsWithRows.reduce((sum, kid) => Math.round((sum + num(kid.total_expense)) * 100) / 100, 0),
  };
}

async function getSchoolKidDetail(userId, kidId) {
  const kid = await getSchoolKidOwnedByUser(userId, kidId);
  if (!kid) throw validationError('Kid not found');
  const [classesR, expensesR] = await Promise.all([
    query(
      `SELECT id, kid_id, school_name, academic_year, class_label,
              expected_monthly_fee, bus_fee, other_fee, details, created_at, updated_at
       FROM school_kid_classes
       WHERE kid_id = $1
       ORDER BY academic_year, lower(school_name), lower(class_label), id`,
      [kidId]
    ),
    query(
      `SELECT id, kid_id, class_id, expense_date, item_name, amount, notes, created_at, updated_at
       FROM school_kid_expenses
       WHERE kid_id = $1
       ORDER BY expense_date DESC, id DESC`,
      [kidId]
    ),
  ]);
  const classes = classesR.rows.map((row) => ({
    id: Number(row.id),
    kid_id: Number(row.kid_id),
    school_name: row.school_name,
    academic_year: row.academic_year,
    class_label: row.class_label,
    expected_monthly_fee: num(row.expected_monthly_fee),
    bus_fee: num(row.bus_fee),
    other_fee: num(row.other_fee),
    details: row.details || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const expenses = expensesR.rows.map((row) => ({
    id: Number(row.id),
    kid_id: Number(row.kid_id),
    class_id: Number(row.class_id),
    expense_date: row.expense_date,
    item_name: row.item_name,
    amount: num(row.amount),
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  const expenseLedgerMeta = await getSchoolKidExpenseLedgerMeta(userId, expenses.map((row) => row.id));
  const enrichedExpenses = expenses.map((expense) => {
    const ledger = expenseLedgerMeta.get(expense.id);
    return {
      ...expense,
      add_to_expense: !!ledger?.add_to_expense,
      expense_entry_id: ledger?.expense_entry_id || null,
      expense_type: ledger?.expense_type || 'fair',
      bank_account_id: ledger?.bank_account_id || null,
      card_id: ledger?.card_id || null,
      card_discount_pct: ledger?.card_discount_pct || 0,
      cc_txn_id: ledger?.cc_txn_id || null,
    };
  });
  const expensesByClass = new Map();
  enrichedExpenses.forEach((expense) => {
    const list = expensesByClass.get(expense.class_id) || [];
    list.push(expense);
    expensesByClass.set(expense.class_id, list);
  });
  const classRows = sortSchoolKidClassRows(classes.map((row) => {
    const classExpenses = expensesByClass.get(row.id) || [];
    const monthTotals = {};
    classExpenses.forEach((expense) => {
      const monthKey = String(expense.expense_date || '').slice(0, 7);
      monthTotals[monthKey] = Math.round(((monthTotals[monthKey] || 0) + num(expense.amount)) * 100) / 100;
    });
    const monthSummary = Object.keys(monthTotals).sort().map((monthKey) => ({
      month_key: monthKey,
      total: monthTotals[monthKey],
    }));
    return {
      ...row,
      kid_name: kid.kid_name,
      total_expense: classExpenses.reduce((sum, item) => Math.round((sum + num(item.amount)) * 100) / 100, 0),
      expense_count: classExpenses.length,
      month_summary: monthSummary,
      expenses: classExpenses,
      expected_annual_total: Math.round(((num(row.expected_monthly_fee) + num(row.bus_fee) + num(row.other_fee)) * 12) * 100) / 100,
    };
  }));
  return {
    kid: {
      id: Number(kid.id),
      kid_name: kid.kid_name,
      age_years: kid.date_of_birth ? deriveSchoolKidAgeFromDateOfBirth(kid.date_of_birth) : (kid.age_years != null ? Number(kid.age_years) : null),
      date_of_birth: schoolKidDateToIso(kid.date_of_birth),
      details: kid.details || '',
      created_at: kid.created_at,
      updated_at: kid.updated_at,
    },
    classes: classRows,
    expenses: enrichedExpenses,
    total_expense: classRows.reduce((sum, row) => Math.round((sum + num(row.total_expense)) * 100) / 100, 0),
    school_options: [...new Set(classRows.map((row) => row.school_name).filter(Boolean))],
    year_options: [...new Set(classRows.map((row) => row.academic_year).filter(Boolean))].sort((a, b) => parseAcademicYearStart(a) - parseAcademicYearStart(b)),
  };
}

module.exports = {
  computeLiveSplitDashboardSummary,
  getExpenses,
  getExpenseCategories,
  getExpenseCategoryLibrary,
  getExpenseById,
  addExpense,
  updateExpense,
  deleteExpense,
  bulkAddExpenses,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  createExpenseSubcategory,
  updateExpenseSubcategory,
  deleteExpenseSubcategory,
  getFriends,
  addFriend,
  updateFriend,
  linkFriendToUser,
  deleteFriend,
  getLiveSplitFriends,
  getLiveSplitFriendActivities,
  addLiveSplitFriend,
  updateLiveSplitFriend,
  linkLiveSplitFriendToUser,
  deleteLiveSplitFriend,
  getLiveSplitTrips,
  createLiveSplitTrip,
  updateLiveSplitTrip,
  deleteLiveSplitTrip,
  addLiveSplitTripMembers,
  removeLiveSplitTripMember,
  addLiveSplitTripToExpense,
  getLoanTransactions,
  addLoanTransaction,
  updateLoanTransaction,
  deleteLoanTransaction,
  getDivideGroups,
  addDivideGroup,
  deleteDivideGroup,
  syncDivideSessionShares,
  getReceivedDivideShares,
  hideReceivedDivideShare,
  getLiveSplitGroups,
  getLiveSplitGroupDetailForUser,
  markLiveSplitExpenseAdded,
  addLiveSplitGroup,
  updateLiveSplitGroup,
  deleteLiveSplitGroup,
  syncLiveSplitSessionShares,
  getReceivedLiveSplitShares,
  hideReceivedLiveSplitShare,
  getDashboardData,
  getPublicSiteStats,
  getAdminExpenseStats,
  getAdminCurrencyRates,
  upsertAdminCurrencyRate,
  deleteAdminCurrencyRate,
  getAvailableCurrencyRates,
  upsertPublicSiteMetrics,
  getReportYears,
  getReportMonths,
  createTrip,
  getTrips,
  getTripById,
  updateTrip,
  deleteTrip,
  addTripItineraryItem,
  updateTripItineraryItem,
  deleteTripItineraryItem,
  addTripExpense,
  updateTripExpense,
  deleteTripExpense,
  deleteAllTripExpenses,
  bulkUpdateTripExpenseShares,
  finalizeTrip,
  toggleMemberLock,
  linkTripMember,
  getTripSharedUsers,
  shareTripWithUser,
  unshareTripWithUser,
  createTripInvite,
  getTripInviteByToken,
  acceptTripInvite,
  searchUsers,
  createLiveSplitInvite,
  getLiveSplitInviteByToken,
  getIncomingLiveSplitInvites,
  getOutgoingLiveSplitInvites,
  getLiveSplitInviteByIdForInviter,
  bindLiveSplitInviteToUser,
  acceptLiveSplitInvite,
  rejectLiveSplitInvite,
  cancelLiveSplitInviteForInviter,
  createShareLink,
  getShareLinks,
  deleteShareLink,
  getPublicShareData,
  listSocieties,
  getSocietyDetail,
  createSociety,
  updateSociety,
  deleteSociety,
  addSocietyMember,
  updateSocietyMember,
  deleteSocietyMember,
  getSocietyMemberPortalRecordByPhone,
  getSocietyMemberPortalDashboard,
  saveSocietyContribution,
  createSocietyContributionPaymentRequestByMember,
  getSocietyContributionPaymentRequestNotificationContext,
  getSocietyPendingApprovalCount,
  reviewSocietyContributionPaymentRequest,
  addSocietyExpense,
  updateSocietyExpense,
  deleteSocietyExpense,
  listSchoolKids,
  getSchoolKidsOverview,
  getSchoolKidDetail,
  createSchoolKid,
  updateSchoolKid,
  deleteSchoolKid,
  addSchoolKidClass,
  updateSchoolKidClass,
  deleteSchoolKidClass,
  addSchoolKidExpense,
  updateSchoolKidExpense,
  deleteSchoolKidExpense,
  replaceSchoolKidClassExpenses,
};
