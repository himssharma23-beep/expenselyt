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
    const groupResult = await client.query(
      `INSERT INTO divide_groups (user_id, divide_date, details, paid_by, total_amount, heading, session_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, data.divide_date, data.details, data.paid_by, data.total_amount, data.heading || null, data.session_id || null]
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
        [userId, loan.friend_id, data.divide_date, `Split: ${data.details}`, loan.paid, loan.received]
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
  const q = `%${search}%`;
  const result = await query(
    `SELECT id, username, display_name
     FROM users
     WHERE (username ILIKE $1 OR display_name ILIKE $1)
       AND id != $2
       AND is_active = TRUE
     LIMIT 10`,
    [q, excludeUserId]
  );
  return result.rows;
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
  createShareLink,
  getShareLinks,
  deleteShareLink,
  getPublicShareData,
};
