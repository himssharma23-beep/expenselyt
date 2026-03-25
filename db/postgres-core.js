const crypto = require('crypto');
const { query, withTransaction } = require('./postgres');

function num(value) {
  return Number(value || 0);
}

function bool(value) {
  return !!value;
}

function yearGuardSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `EXTRACT(YEAR FROM ${prefix}purchase_date)::int BETWEEN 2018 AND ${new Date().getFullYear() + 2}`;
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
    where.push(`item_name ILIKE $${params.length}`);
  }
  if (filters.spendType === 'extra') where.push('is_extra = TRUE');
  if (filters.spendType === 'fair') where.push('is_extra = FALSE');

  const result = await query(
    `SELECT *
     FROM expenses
     WHERE ${where.join(' AND ')}
     ORDER BY purchase_date DESC, id DESC`,
    params
  );
  return result.rows.map((row) => ({ ...row, amount: num(row.amount) }));
}

async function addExpense(userId, data) {
  const result = await query(
    `INSERT INTO expenses (user_id, item_name, amount, purchase_date, is_extra)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, data.item_name, data.amount, data.purchase_date, !!data.is_extra]
  );
  return Number(result.rows[0].id);
}

async function updateExpense(userId, id, data) {
  await query(
    `UPDATE expenses
     SET item_name = $1,
         amount = $2,
         purchase_date = $3,
         is_extra = $4,
         updated_at = NOW()
     WHERE id = $5 AND user_id = $6`,
    [data.item_name, data.amount, data.purchase_date, !!data.is_extra, id, userId]
  );
}

async function deleteExpense(userId, id) {
  await query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function bulkAddExpenses(userId, rows) {
  return withTransaction(async (client) => {
    let count = 0;
    for (const row of rows) {
      if (row.item_name && row.amount > 0) {
        await client.query(
          `INSERT INTO expenses (user_id, item_name, amount, purchase_date, is_extra)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, row.item_name, row.amount, row.purchase_date, !!row.is_extra]
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
       COALESCE(SUM(lt.paid - lt.received), 0) AS balance
     FROM friends f
     LEFT JOIN loan_transactions lt ON lt.friend_id = f.id
     WHERE f.user_id = $1
     GROUP BY f.id
     ORDER BY f.name`,
    [userId]
  );
  return result.rows.map((row) => ({ ...row, balance: Math.round(num(row.balance) * 100) / 100 }));
}

async function addFriend(userId, name) {
  const result = await query(
    `INSERT INTO friends (user_id, name)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, String(name).trim()]
  );
  return Number(result.rows[0].id);
}

async function updateFriend(userId, id, name) {
  await query('UPDATE friends SET name = $1 WHERE id = $2 AND user_id = $3', [String(name).trim(), id, userId]);
}

async function deleteFriend(userId, id) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM loan_transactions WHERE friend_id = $1 AND user_id = $2', [id, userId]);
    await client.query('DELETE FROM friends WHERE id = $1 AND user_id = $2', [id, userId]);
  });
}

async function getLoanTransactions(userId, friendId) {
  const result = await query(
    `SELECT *
     FROM loan_transactions
     WHERE user_id = $1 AND friend_id = $2
     ORDER BY txn_date DESC, id DESC`,
    [userId, friendId]
  );
  return result.rows.map((row) => ({ ...row, paid: num(row.paid), received: num(row.received) }));
}

async function addLoanTransaction(userId, data) {
  const result = await query(
    `INSERT INTO loan_transactions (user_id, friend_id, txn_date, details, paid, received)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, data.friend_id, data.txn_date, data.details, data.paid || 0, data.received || 0]
  );
  return Number(result.rows[0].id);
}

async function updateLoanTransaction(userId, id, data) {
  await query(
    `UPDATE loan_transactions
     SET txn_date = $1, details = $2, paid = $3, received = $4
     WHERE id = $5 AND user_id = $6`,
    [data.txn_date, data.details, data.paid || 0, data.received || 0, id, userId]
  );
}

async function deleteLoanTransaction(userId, id) {
  await query('DELETE FROM loan_transactions WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function getDivideGroups(userId) {
  const result = await query(
    `SELECT
       g.*,
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
    await client.query('DELETE FROM divide_splits WHERE group_id = $1', [id]);
    await client.query('DELETE FROM divide_groups WHERE id = $1', [id]);
  });
}

async function getDashboardData(userId, year) {
  const yearStr = String(year || new Date().getFullYear());
  const currentYear = String(new Date().getFullYear());
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

  const [monthlyTotalsR, monthlyByTypeR, topItemsR, spendBreakdownR, yearTotalR, monthTotalR, recentExpensesR, yearsR, friends] = await Promise.all([
    query(
      `SELECT to_char(purchase_date, 'MM') AS month, SUM(amount) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()}
       GROUP BY month ORDER BY month`,
      [userId, yearStr]
    ),
    query(
      `SELECT to_char(purchase_date, 'MM') AS month, is_extra, SUM(amount) AS total
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2
       GROUP BY month, is_extra
       ORDER BY month`,
      [userId, yearStr]
    ),
    query(
      `SELECT item_name, SUM(amount) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()}
       GROUP BY item_name
       ORDER BY total DESC
       LIMIT 10`,
      [userId, yearStr]
    ),
    query(
      `SELECT is_extra, SUM(amount) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()}
       GROUP BY is_extra`,
      [userId, yearStr]
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()}`,
      [userId, yearStr]
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
       FROM expenses
       WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND to_char(purchase_date, 'MM') = $3`,
      [userId, currentYear, currentMonth]
    ),
    query(
      `SELECT *
       FROM expenses
       WHERE user_id = $1 AND ${yearGuardSql()}
       ORDER BY purchase_date DESC, id DESC
       LIMIT 5`,
      [userId]
    ),
    query(
      `SELECT DISTINCT to_char(purchase_date, 'YYYY') AS year
       FROM expenses
       WHERE user_id = $1 AND EXTRACT(YEAR FROM purchase_date)::int BETWEEN 2018 AND $2
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
     WHERE user_id = $1 AND ${yearGuardSql()}
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
     WHERE user_id = $1 AND to_char(purchase_date, 'YYYY') = $2 AND ${yearGuardSql()}
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
    const [membersR, totalsR, sharesR, paidR] = await Promise.all([
      query('SELECT * FROM trip_members WHERE trip_id = $1', [row.id]),
      query('SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS cnt FROM trip_expenses WHERE trip_id = $1', [row.id]),
      query(
        `SELECT tes.member_key, COALESCE(SUM(tes.share_amount),0) AS total_share
         FROM trip_expense_splits tes
         JOIN trip_expenses te ON te.id = tes.expense_id
         WHERE te.trip_id = $1
         GROUP BY tes.member_key`,
        [row.id]
      ),
      query('SELECT paid_by_key, COALESCE(SUM(amount),0) AS total_paid FROM trip_expenses WHERE trip_id = $1 GROUP BY paid_by_key', [row.id]),
    ]);
    const members = membersR.rows;
    let myKey = 'self';
    if (!row.is_owner) {
      const myMember = members.find((member) => String(member.linked_user_id) === String(userId));
      if (myMember) {
        myKey = myMember.friend_id != null ? String(myMember.friend_id) : myMember.linked_user_id != null ? `u${myMember.linked_user_id}` : 'self';
      }
    }
    const selfShare = num(sharesR.rows.find((share) => share.member_key === myKey)?.total_share);
    const selfPaid = num(paidR.rows.find((paid) => paid.paid_by_key === myKey)?.total_paid);
    trips.push({
      ...row,
      is_owner: bool(row.is_owner),
      members,
      totalExpenses: Math.round(num(totalsR.rows[0]?.total) * 100) / 100,
      expenseCount: Number(totalsR.rows[0]?.cnt || 0),
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

  const [tripR, membersR, expensesR] = await Promise.all([
    query('SELECT * FROM trips WHERE id = $1 LIMIT 1', [tripId]),
    query('SELECT * FROM trip_members WHERE trip_id = $1', [tripId]),
    query('SELECT * FROM trip_expenses WHERE trip_id = $1 ORDER BY expense_date DESC, id DESC', [tripId]),
  ]);
  const trip = tripR.rows[0];
  const expenses = [];
  for (const expense of expensesR.rows) {
    const splitsR = await query('SELECT * FROM trip_expense_splits WHERE expense_id = $1', [expense.id]);
    expenses.push({ ...expense, amount: num(expense.amount), splits: splitsR.rows.map((split) => ({ ...split, share_amount: num(split.share_amount) })) });
  }
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
  if (!(await _checkTripEdit(userId, tripId))) throw new Error('Trip not found');
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
  if (!exp || !(await _checkTripEdit(userId, exp.trip_id))) throw new Error('Not found');
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
  if (!exp || !(await _checkTripEdit(userId, exp.trip_id))) throw new Error('Not found');
  await withTransaction(async (client) => {
    await client.query('DELETE FROM trip_expense_splits WHERE expense_id = $1', [expenseId]);
    await client.query('DELETE FROM trip_expenses WHERE id = $1', [expenseId]);
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
    let sql = `SELECT * FROM loan_transactions WHERE user_id = $1 AND friend_id = $2`;
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
  addExpense,
  updateExpense,
  deleteExpense,
  bulkAddExpenses,
  getFriends,
  addFriend,
  updateFriend,
  deleteFriend,
  getLoanTransactions,
  addLoanTransaction,
  updateLoanTransaction,
  deleteLoanTransaction,
  getDivideGroups,
  addDivideGroup,
  deleteDivideGroup,
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
