const crypto = require('crypto');
const { query, withTransaction } = require('./postgres');

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

function normalizeBankAccountId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
         f.linked_user_id,
         FIRST_VALUE(f.id) OVER (
           PARTITION BY f.linked_user_id
           ORDER BY
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
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.display_name, ''))) THEN 0
               WHEN lower(trim(f.name)) = lower(trim(COALESCE(u.username, ''))) THEN 1
               ELSE 2
             END,
             f.id
         ) AS canonical_name
       FROM live_split_friends f
       LEFT JOIN users u ON u.id = f.linked_user_id
       WHERE f.user_id = $1
         AND f.deleted_at IS NULL
         AND f.linked_user_id IS NOT NULL
         AND f.linked_user_id <> $1
     )
     UPDATE live_split_splits s
     SET friend_id = r.canonical_id,
         friend_name = COALESCE(NULLIF(trim(r.canonical_name), ''), s.friend_name)
     FROM ranked r
     JOIN live_split_groups g ON g.id = s.group_id
     WHERE g.user_id = $1
       AND s.friend_id = r.id
       AND r.canonical_id <> r.id`,
    [ownerId]
  );

  await query(
    `WITH ranked AS (
       SELECT
         f.id,
         f.linked_user_id,
         FIRST_VALUE(f.id) OVER (
           PARTITION BY f.linked_user_id
           ORDER BY
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
         AND f.deleted_at IS NULL
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
    where.push(`(item_name ILIKE $${params.length} OR COALESCE(category, '') ILIKE $${params.length})`);
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

async function getExpenseById(userId, id) {
  const result = await query(
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
  const result = await query(
    `SELECT DISTINCT category
     FROM expenses
     WHERE user_id = $1 AND category IS NOT NULL AND btrim(category) <> '' AND deleted_at IS NULL
     ORDER BY category`,
    [userId]
  );
  return result.rows.map((row) => String(row.category || '').trim()).filter(Boolean);
}

async function addExpense(userId, data) {
  return withTransaction(async (client) => {
    const itemName = normalizeText(data.item_name, 'Expense name', 160);
    const category = normalizeOptionalText(data.category, 80);
    const amount = normalizeAmount(data.amount);
    const purchaseDate = normalizeDateValue(data.purchase_date, 'Purchase date');
    const bankAccountId = normalizeBankAccountId(data.bank_account_id);
    const result = await client.query(
      `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, bank_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, itemName, category, amount, purchaseDate, !!data.is_extra, bankAccountId]
    );
    if (bankAccountId) {
      await adjustBankBalance(userId, bankAccountId, -Math.abs(amount), client);
    }
    return Number(result.rows[0].id);
  });
}

async function updateExpense(userId, id, data) {
  await withTransaction(async (client) => {
    const current = await getExpenseById(userId, id);
    if (!current) throw validationError('Expense not found');
    const itemName = normalizeText(data.item_name, 'Expense name', 160);
    const category = normalizeOptionalText(data.category, 80);
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
           amount = $3,
           purchase_date = $4,
           is_extra = $5,
           bank_account_id = $6,
           updated_at = NOW()
       WHERE id = $7 AND user_id = $8`,
      [itemName, category, nextAmount, purchaseDate, !!data.is_extra, nextBankAccountId, id, userId]
    );
  });
}

async function deleteExpense(userId, id) {
  await withTransaction(async (client) => {
    const current = await getExpenseById(userId, id);
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
  });
}

async function bulkAddExpenses(userId, rows) {
  return withTransaction(async (client) => {
    let count = 0;
    for (const row of rows) {
     if (row.item_name && row.amount > 0) {
        const category = normalizeOptionalText(row.category, 80);
        await client.query(
          `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, bank_account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, row.item_name, category, row.amount, row.purchase_date, !!row.is_extra, normalizeBankAccountId(row.bank_account_id)]
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
  const result = await query(
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
  return result.rows.map((row) => ({
    ...row,
    linked_user_id: row.linked_user_id ? Number(row.linked_user_id) : null,
  }));
}

async function addLiveSplitFriend(userId, name) {
  const safeName = validateFriendName(name);
  const result = await query(
    `INSERT INTO live_split_friends (user_id, name)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, safeName]
  );
  return Number(result.rows[0].id);
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

async function createLiveSplitTrip(userId, data) {
  return withTransaction(async (client) => {
    const name = normalizeText(data?.name, 'Trip name', 120);
    const startDate = normalizeDateValue(data?.start_date, 'Start date');
    const endDate = data?.end_date ? normalizeDateValue(data.end_date, 'End date') : null;
    if (endDate && endDate < startDate) throw validationError('End date cannot be before start date');
    const notes = data?.notes ? normalizeOptionalText(data.notes, 300) : null;
    const members = await normalizeLiveSplitTripMembersForOwner(client, userId, data?.members || []);

    const tripResult = await client.query(
      `INSERT INTO live_split_trips (user_id, name, start_date, end_date, status, notes, updated_by)
       VALUES ($1, $2, $3, $4, 'active', $5, $1)
       RETURNING id`,
      [userId, name, startDate, endDate, notes]
    );
    const tripId = Number(tripResult.rows[0].id);

    await client.query(
      `INSERT INTO live_split_trip_members (trip_id, friend_id, member_name, target_user_id, permission, is_locked, updated_by)
       VALUES ($1, NULL, $2, $3, 'owner', TRUE, $3)`,
      [tripId, 'You', userId]
    );

    for (const member of members) {
      await client.query(
        `INSERT INTO live_split_trip_members (trip_id, friend_id, member_name, target_user_id, permission, is_locked, updated_by)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
        [tripId, member.friend_id, member.member_name, member.target_user_id, member.permission, userId]
      );
    }

    return tripId;
  });
}

async function getLiveSplitTrips(userId) {
  const result = await query(
    `SELECT DISTINCT
       t.*,
       CASE WHEN t.user_id = $1 THEN TRUE ELSE FALSE END AS is_owner
     FROM live_split_trips t
     LEFT JOIN live_split_trip_members m ON m.trip_id = t.id AND m.target_user_id = $1
     WHERE t.user_id = $1 OR m.target_user_id IS NOT NULL
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
      query(
        `SELECT COUNT(*)::int AS expense_count,
                COALESCE(SUM(total_amount), 0) AS total_amount,
                COUNT(*) FILTER (WHERE split_mode = 'settlement')::int AS settlement_count
         FROM live_split_groups
         WHERE trip_id = $1`,
        [row.id]
      ),
    ]);
    const stats = statsResult.rows[0] || {};
    trips.push({
      ...row,
      id: Number(row.id),
      user_id: Number(row.user_id),
      is_owner: bool(row.is_owner),
      status: normalizeLiveSplitTripStatus(row.status),
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
    });
  }

  return trips;
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
    for (const member of normalized) {
      const duplicate = existing.find((row) => (
        (Number(row.target_user_id || 0) > 0 && Number(member.target_user_id || 0) > 0 && Number(row.target_user_id) === Number(member.target_user_id))
        || String(row.member_name || '').trim().toLowerCase() === String(member.member_name || '').trim().toLowerCase()
      ));
      if (duplicate) continue;
      await client.query(
        `INSERT INTO live_split_trip_members (trip_id, friend_id, member_name, target_user_id, permission, is_locked, updated_by)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
        [tid, member.friend_id, member.member_name, member.target_user_id, member.permission, uid]
      );
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

async function getLiveSplitGroups(userId) {
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
    owner_name: String(row.owner_name || row.owner_username || 'Owner').trim(),
    splits,
    activities,
  };
}

async function getLiveSplitFriendActivities(userId, friendId, limit = 60) {
  const uid = Number(userId);
  const fid = Number(friendId);
  const cappedLimit = Math.max(1, Math.min(200, Number(limit) || 60));
  const friendResult = await query(
    `SELECT id, name
     FROM live_split_friends
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [uid, fid]
  );
  if (!friendResult.rows[0]) throw new Error('Live split friend not found');

  const result = await query(
    `SELECT a.id, a.owner_user_id, a.friend_id, a.group_id, a.actor_user_id, a.action, a.summary,
            a.expense_details, a.divide_date, a.total_amount, a.friend_name_snapshot, a.created_at,
            u.display_name AS actor_name, u.username AS actor_username
     FROM live_split_friend_activity a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.owner_user_id = $1
       AND a.friend_id = $2
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $3`,
    [uid, fid, cappedLimit]
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
    if (!normalizedSplits.length) throw validationError('At least one participant is required');
    if (tripId) {
      const trip = await getLiveSplitTripAccessRow(client, userId, tripId);
      if (!trip) throw validationError('Live split trip not found');
      if (normalizeLiveSplitTripStatus(trip.status) !== 'active') throw validationError('Trip is completed. Re-open it to add expenses.');
      await assertLiveSplitTripParticipants(client, tripId, normalizedSplits);
    }
    const groupResult = await client.query(
      `INSERT INTO live_split_groups (user_id, divide_date, details, paid_by, total_amount, heading, session_id, split_mode, trip_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [userId, divideDate, data.details, data.paid_by, data.total_amount, data.heading || null, data.session_id || null, String(data.split_mode || 'equal'), tripId]
    );
    const groupId = Number(groupResult.rows[0].id);
    for (const split of normalizedSplits) {
      await client.query(
        `INSERT INTO live_split_splits (group_id, friend_id, friend_name, share_amount)
         VALUES ($1, $2, $3, $4)`,
      [groupId, split.friend_id, split.friend_name, split.share_amount]
      );
    }
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
      share_amount: num(split?.share_amount),
    });
  }
  return normalized.filter((split) => split.friend_id > 0 && split.friend_name && split.share_amount >= 0);
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
    await client.query(
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
    if (!normalizedSplits.length) throw validationError('At least one participant is required');
    if (nextTripId) await assertLiveSplitTripParticipants(client, nextTripId, normalizedSplits);
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
        await client.query(
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
  await query(
    `INSERT INTO live_split_group_shares (group_id, owner_user_id, friend_id, target_user_id, shared_by_user_id)
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
                   updated_at = NOW()`,
    [userId]
  );

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
         g.heading,
         g.session_id,
         owner.id AS owner_user_id,
         owner.display_name AS owner_name,
         share.friend_id,
         share.target_user_id,
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
           NULL::bigint AS linked_user_id,
           s.share_amount,
           s.is_paid
         FROM live_split_splits s
         WHERE s.group_id = $1
         ORDER BY s.id`,
        [row.id]
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

  const [monthlyTotalsR, monthlyByTypeR, topItemsR, spendBreakdownR, yearTotalR, monthTotalR, recentExpensesR, yearsR, friends] = await Promise.all([
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
    ),
    getFriends(userId),
  ]);

  const totalOwed = friends.reduce((sum, friend) => sum + (friend.balance > 0 ? friend.balance : 0), 0);
  const totalOwe = friends.reduce((sum, friend) => sum + (friend.balance < 0 ? Math.abs(friend.balance) : 0), 0);
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
    friendCount: friends.length,
    recentExpenses: recentExpensesR.rows.map((row) => ({ ...row, amount: num(row.amount) })),
    years,
    selectedYear: yearStr,
  };
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
  return !!(member.rows[0] && member.rows[0].permission !== 'view');
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
    client.query('SELECT * FROM trip_members WHERE trip_id = $1', [tripId]),
    _loadNormalizedTripExpenses(client, tripId),
  ]);

  return { ...trip, members: membersR.rows, expenses };
}

function _buildTripSettlementSnapshot(trip, friendIdOverrides = {}) {
  const peopleMap = {};
  for (const member of (trip.members || [])) {
    const key = member.friend_id != null ? String(member.friend_id) : member.linked_user_id != null ? `u${member.linked_user_id}` : 'self';
    peopleMap[key] = {
      key,
      name: member.member_name,
      friendId: member.friend_id || friendIdOverrides[key] || null,
      totalShare: 0,
      totalGave: 0,
    };
  }

  for (const expense of (trip.expenses || [])) {
    for (const split of (expense.splits || [])) {
      if (peopleMap[split.member_key]) peopleMap[split.member_key].totalShare += num(split.share_amount);
    }
    if (peopleMap[expense.paid_by_key]) peopleMap[expense.paid_by_key].totalGave += num(expense.amount);
  }

  return peopleMap;
}

async function createTrip(userId, data) {
  return withTransaction(async (client) => {
    const tripResult = await client.query(
      `INSERT INTO trips (user_id, name, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, data.name.trim(), data.start_date, data.end_date || null]
    );
    const tripId = Number(tripResult.rows[0].id);
    await client.query(`INSERT INTO trip_members (trip_id, friend_id, member_name) VALUES ($1, NULL, $2)`, [tripId, 'You']);
    for (const member of (data.members || [])) {
      await client.query(
        `INSERT INTO trip_members (trip_id, friend_id, member_name, linked_user_id, permission)
         VALUES ($1, $2, $3, $4, $5)`,
        [tripId, member.friend_id || null, member.member_name, member.linked_user_id || null, member.permission || 'edit']
      );
    }
    return tripId;
  });
}

async function getTrips(userId) {
  const tripsResult = await query(
    `SELECT DISTINCT
       t.*,
       CASE WHEN t.user_id = $1 THEN TRUE ELSE FALSE END AS is_owner
     FROM trips t
     LEFT JOIN trip_members m ON m.trip_id = t.id AND m.linked_user_id = $2
     WHERE t.user_id = $3 OR m.linked_user_id IS NOT NULL
     ORDER BY t.start_date DESC, t.id DESC`,
    [userId, userId, userId]
  );

  const trips = [];
  for (const row of tripsResult.rows) {
    const [membersR, expenses] = await Promise.all([
      query('SELECT * FROM trip_members WHERE trip_id = $1', [row.id]),
      _loadNormalizedTripExpenses({ query }, row.id),
    ]);
    const members = membersR.rows;
    let myKey = 'self';
    if (!row.is_owner) {
      const myMember = members.find((member) => String(member.linked_user_id) === String(userId));
      if (myMember) {
        myKey = myMember.friend_id != null ? String(myMember.friend_id) : myMember.linked_user_id != null ? `u${myMember.linked_user_id}` : 'self';
      }
    }
    let totalExpenses = 0;
    let selfShare = 0;
    let selfPaid = 0;
    for (const expense of expenses) {
      totalExpenses += num(expense.amount);
      if (expense.paid_by_key === myKey) selfPaid += num(expense.amount);
      for (const split of (expense.splits || [])) {
        if (split.member_key === myKey) selfShare += num(split.share_amount);
      }
    }
    trips.push({
      ...row,
      is_owner: bool(row.is_owner),
      members,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      expenseCount: expenses.length,
      selfNet: Math.round((selfPaid - selfShare) * 100) / 100,
    });
  }
  return trips;
}

async function getTripById(userId, tripId) {
  const [ownerR, memberR] = await Promise.all([
    query('SELECT id FROM trips WHERE id = $1 AND user_id = $2 LIMIT 1', [tripId, userId]),
    query('SELECT * FROM trip_members WHERE trip_id = $1 AND linked_user_id = $2 LIMIT 1', [tripId, userId]),
  ]);
  const isOwner = !!ownerR.rows[0];
  const myMember = memberR.rows[0] || null;
  if (!isOwner && !myMember) return null;

  const [tripR, membersR, expenses] = await Promise.all([
    query('SELECT * FROM trips WHERE id = $1 LIMIT 1', [tripId]),
    query('SELECT * FROM trip_members WHERE trip_id = $1', [tripId]),
    _loadNormalizedTripExpenses({ query }, tripId),
  ]);
  const trip = tripR.rows[0];
  return { ...trip, members: membersR.rows, expenses, isOwner, userPermission: isOwner ? 'owner' : (myMember?.permission || 'edit') };
}

async function updateTrip(userId, id, data) {
  const fields = [];
  const params = [];
  if (data.name !== undefined) { params.push(data.name.trim()); fields.push(`name = $${params.length}`); }
  if (data.start_date !== undefined) { params.push(data.start_date); fields.push(`start_date = $${params.length}`); }
  if (data.end_date !== undefined) { params.push(data.end_date || null); fields.push(`end_date = $${params.length}`); }
  if (data.status !== undefined) { params.push(data.status); fields.push(`status = $${params.length}`); }
  if (fields.length === 0) return;
  params.push(id, userId);
  await query(`UPDATE trips SET ${fields.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length}`, params);
}

async function deleteTrip(userId, id) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM trip_expense_splits WHERE expense_id IN (SELECT id FROM trip_expenses WHERE trip_id = $1)', [id]);
    await client.query('DELETE FROM trip_expenses WHERE trip_id = $1', [id]);
    await client.query('DELETE FROM trip_members WHERE trip_id = $1', [id]);
    await client.query('DELETE FROM trips WHERE id = $1 AND user_id = $2', [id, userId]);
  });
}

async function addTripExpense(userId, tripId, data) {
  await _assertTripExpenseEditable(userId, tripId);
  return withTransaction(async (client) => {
    const expR = await client.query(
      `INSERT INTO trip_expenses (trip_id, paid_by_key, paid_by_name, details, amount, expense_date, split_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [tripId, data.paid_by_key, data.paid_by_name, data.details, data.amount, data.expense_date, data.split_mode || 'equal']
    );
    const expId = Number(expR.rows[0].id);
    for (const split of (data.splits || [])) {
      await client.query(
        `INSERT INTO trip_expense_splits (expense_id, member_key, member_name, share_amount)
         VALUES ($1, $2, $3, $4)`,
        [expId, split.member_key, split.member_name, split.share_amount]
      );
    }
    return expId;
  });
}

async function updateTripExpense(userId, expenseId, data) {
  const expR = await query('SELECT id, trip_id FROM trip_expenses WHERE id = $1 LIMIT 1', [expenseId]);
  const exp = expR.rows[0];
  if (!exp) throw new Error('Not found');
  await _assertTripExpenseEditable(userId, exp.trip_id);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE trip_expenses
       SET paid_by_key = $1, paid_by_name = $2, details = $3, amount = $4, expense_date = $5, split_mode = $6
       WHERE id = $7`,
      [data.paid_by_key, data.paid_by_name, data.details, data.amount, data.expense_date, data.split_mode || 'equal', expenseId]
    );
    await client.query('DELETE FROM trip_expense_splits WHERE expense_id = $1', [expenseId]);
    for (const split of (data.splits || [])) {
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
  await _assertTripExpenseEditable(userId, exp.trip_id);
  await withTransaction(async (client) => {
    await client.query('DELETE FROM trip_expense_splits WHERE expense_id = $1', [expenseId]);
    await client.query('DELETE FROM trip_expenses WHERE id = $1', [expenseId]);
  });
}

async function finalizeTrip(userId, tripId, data = {}) {
  return withTransaction(async (client) => {
    const trip = await _loadTripFinalizeData(userId, tripId, client);
    const today = normalizeDateValue(data.txn_date || new Date().toISOString().slice(0, 10), 'Trip finalization date');
    const expenseCategory = normalizeOptionalText(data.category, 80);
    const peopleMap = _buildTripSettlementSnapshot(trip, data.friend_ids || {});

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

    const self = peopleMap.self;
    if (self && self.totalShare > 0) {
      await client.query(
        `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, source, source_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'trip', $7, $1, $1)`,
        [userId, trip.name, expenseCategory, Math.round(self.totalShare * 100) / 100, today, !!data.is_extra, tripId]
      );
    }

    for (const [key, person] of Object.entries(peopleMap)) {
      if (key === 'self') continue;
      const friendId = Number(person.friendId || 0);
      if (!friendId) continue;
      const net = person.totalGave - person.totalShare;
      const paid = net < -0.005 ? Math.round(Math.abs(net) * 100) / 100 : 0;
      const received = net > 0.005 ? Math.round(net * 100) / 100 : 0;
      if (paid === 0 && received === 0) continue;
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
  await query('UPDATE trip_members SET linked_user_id = $1, permission = $2 WHERE id = $3', [linkedUserId || null, permission || 'edit', memberId]);
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
             OR (
               i.target_user_id IS NULL
               AND lower(f.name) = lower(COALESCE(i.target_name, ''))
             )
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
  const token = crypto.randomBytes(20).toString('hex');
  await query(
    `INSERT INTO share_links (user_id, token, link_type, filters, expires_at)
     VALUES ($1, $2, $3, $4::text, $5)`,
    [userId, token, data.link_type || 'friends', data.filters ? JSON.stringify(data.filters) : null, data.expires_at || null]
  );
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
  let friends = await getFriends(link.user_id);
  if (filters.friend_ids && filters.friend_ids.length > 0) {
    const friendIdSet = new Set(filters.friend_ids.map((value) => String(value)));
    friends = friends.filter((friend) => friendIdSet.has(String(friend.id)));
  }

  const ownerR = await query('SELECT display_name FROM users WHERE id = $1 LIMIT 1', [link.user_id]);
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
    owner_name: ownerR.rows[0]?.display_name || null,
    filters,
    friends: friendsWithData,
    expires_at: link.expires_at,
  };
}

module.exports = {
  getExpenses,
  getExpenseCategories,
  getExpenseById,
  addExpense,
  updateExpense,
  deleteExpense,
  bulkAddExpenses,
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
  addLiveSplitGroup,
  updateLiveSplitGroup,
  deleteLiveSplitGroup,
  syncLiveSplitSessionShares,
  getReceivedLiveSplitShares,
  hideReceivedLiveSplitShare,
  getDashboardData,
  getReportYears,
  getReportMonths,
  createTrip,
  getTrips,
  getTripById,
  updateTrip,
  deleteTrip,
  addTripExpense,
  updateTripExpense,
  deleteTripExpense,
  finalizeTrip,
  toggleMemberLock,
  linkTripMember,
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
};
