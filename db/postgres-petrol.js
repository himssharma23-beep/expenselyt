const crypto = require('crypto');
const { query, withTransaction } = require('./postgres');

let schemaEnsured = false;

function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function n(v) {
  const value = Number(v);
  return Number.isFinite(value) ? value : 0;
}

function r2(v) {
  return Math.round(n(v) * 100) / 100;
}

function r1(v) {
  return Math.round(n(v) * 10) / 10;
}

function normalizeMonthKey(value, label = 'Month') {
  const key = String(value || '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) throw validationError(`${label} must be in YYYY-MM format`);
  return key;
}

function dateToYmd(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeDate(value, fallback = null) {
  if (value instanceof Date) {
    const fromDate = dateToYmd(value);
    if (fromDate) return fromDate;
  }
  const str = String(value || '').trim();
  if (!str) {
    if (fallback) return fallback;
    throw validationError('Date is required');
  }
  const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const dmyMatch = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  const parsed = new Date(str);
  const parsedYmd = dateToYmd(parsed);
  if (parsedYmd) return parsedYmd;
  throw validationError('Date must be in YYYY-MM-DD format');
}

function monthToDate(monthKey) {
  return `${monthKey}-01`;
}

async function ensureSchema() {
  // Run lightweight healing alters every time so newly added columns are available
  // even when server process is hot and schemaEnsured was already true.
  await query('ALTER TABLE IF EXISTS petrol_divide_months ADD COLUMN IF NOT EXISTS fake_increase_pct NUMERIC(7,2) NOT NULL DEFAULT 0');
  await query('ALTER TABLE IF EXISTS petrol_divide_entries ADD COLUMN IF NOT EXISTS self_share_amount NUMERIC(12,2) NOT NULL DEFAULT 0');
  if (schemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS petrol_divide_months (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month_key TEXT NOT NULL,
      petrol_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      fake_increase_pct NUMERIC(7,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, month_key)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS petrol_divide_month_members (
      id BIGSERIAL PRIMARY KEY,
      month_id BIGINT NOT NULL REFERENCES petrol_divide_months(id) ON DELETE CASCADE,
      friend_id BIGINT NOT NULL REFERENCES live_split_friends(id) ON DELETE CASCADE,
      friend_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (month_id, friend_id)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS petrol_divide_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month_id BIGINT NOT NULL REFERENCES petrol_divide_months(id) ON DELETE CASCADE,
      entry_date DATE NOT NULL,
      remarks TEXT,
      distance_km NUMERIC(12,2) NOT NULL,
      average_kmpl NUMERIC(12,2) NOT NULL,
      petrol_price NUMERIC(12,2) NOT NULL,
      petrol_used_litre NUMERIC(12,2) NOT NULL,
      amount_used NUMERIC(12,2) NOT NULL,
      self_share_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      is_fake BOOLEAN NOT NULL DEFAULT FALSE,
      source_entry_id BIGINT REFERENCES petrol_divide_entries(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS petrol_divide_entry_members (
      id BIGSERIAL PRIMARY KEY,
      entry_id BIGINT NOT NULL REFERENCES petrol_divide_entries(id) ON DELETE CASCADE,
      friend_id BIGINT NOT NULL REFERENCES live_split_friends(id) ON DELETE CASCADE,
      friend_name TEXT NOT NULL,
      share_amount NUMERIC(12,2) NOT NULL
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS petrol_divide_month_adjustments (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month_id BIGINT NOT NULL REFERENCES petrol_divide_months(id) ON DELETE CASCADE,
      friend_id BIGINT NOT NULL REFERENCES live_split_friends(id) ON DELETE CASCADE,
      friend_name TEXT NOT NULL,
      adjust_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (month_id, friend_id)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS petrol_divide_share_links (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month_id BIGINT NOT NULL REFERENCES petrol_divide_months(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      share_type TEXT NOT NULL DEFAULT 'entries',
      view_mode TEXT NOT NULL DEFAULT 'real',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    )`);
  await query('CREATE INDEX IF NOT EXISTS idx_petrol_divide_months_user_month ON petrol_divide_months(user_id, month_key DESC)');
  await query('CREATE INDEX IF NOT EXISTS idx_petrol_divide_entries_month ON petrol_divide_entries(month_id, entry_date DESC, id DESC)');
  await query('CREATE INDEX IF NOT EXISTS idx_petrol_divide_share_links_token ON petrol_divide_share_links(token)');
  schemaEnsured = true;
}

function normalizeFriendIds(values = []) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0))];
}

function calcEqualShares(amount, members = []) {
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  if (!list.length) return [];
  const base = r2(amount / list.length);
  const shares = list.map((member, idx) => ({
    ...member,
    share_amount: idx === 0 ? r2(amount - base * (list.length - 1)) : base,
  }));
  return shares;
}

function buildFakeEntryFromOriginal(original, pct) {
  const multiplier = 1 + (n(pct) / 100);
  const distance = r1(n(original.distance_km) * multiplier);
  // Fake scenario: distance increases, average decreases.
  const average = r1(Math.max(0.1, n(original.average_kmpl) * (1 - (n(pct) / 100))));
  const price = r2(n(original.petrol_price) * multiplier);
  const petrolUsed = average > 0 ? r2(distance / average) : 0;
  const amount = r2(petrolUsed * price);
  return {
    entry_date: normalizeDate(original.entry_date, ''),
    remarks: original.remarks ? String(original.remarks).trim() : 'Generated fake entry',
    distance_km: distance,
    average_kmpl: average,
    petrol_price: price,
    petrol_used_litre: petrolUsed,
    amount_used: amount,
  };
}

async function syncMonthFakeEntriesTx(client, userId, monthId, fakeIncreasePct) {
  const pct = r2(fakeIncreasePct);
  await client.query('DELETE FROM petrol_divide_entries WHERE user_id = $1 AND month_id = $2 AND is_fake = TRUE', [userId, monthId]);

  const originalsR = await client.query(
    `SELECT id, entry_date, remarks, distance_km, average_kmpl, petrol_price
     FROM petrol_divide_entries
     WHERE user_id = $1
       AND month_id = $2
       AND is_fake = FALSE
     ORDER BY entry_date, id`,
    [userId, monthId]
  );

  for (const original of (originalsR.rows || [])) {
    const membersR = await client.query(
      `SELECT friend_id, friend_name
       FROM petrol_divide_entry_members
       WHERE entry_id = $1
       ORDER BY id`,
      [Number(original.id)]
    );
    const members = (membersR.rows || []).map((row) => ({
      friend_id: Number(row.friend_id),
      friend_name: String(row.friend_name || '').trim() || 'Friend',
    })).filter((row) => row.friend_id > 0);

    const fake = buildFakeEntryFromOriginal(original, pct);
    const splitPeople = [
      { friend_id: 0, friend_name: 'You', is_self: true },
      ...members,
    ];
    const splitShares = calcEqualShares(fake.amount_used, splitPeople);
    const selfShare = r2((splitShares.find((s) => s.is_self) || {}).share_amount || 0);
    const friendShares = splitShares.filter((share) => Number(share.friend_id) > 0);

    const fakeR = await client.query(
      `INSERT INTO petrol_divide_entries (user_id, month_id, entry_date, remarks, distance_km, average_kmpl, petrol_price, petrol_used_litre, amount_used, self_share_amount, is_fake, source_entry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11)
       RETURNING id`,
      [
        userId,
        monthId,
        fake.entry_date,
        fake.remarks,
        fake.distance_km,
        fake.average_kmpl,
        fake.petrol_price,
        fake.petrol_used_litre,
        fake.amount_used,
        selfShare,
        Number(original.id),
      ]
    );
    const fakeId = Number(fakeR.rows[0].id);
    for (const share of friendShares) {
      await client.query(
        'INSERT INTO petrol_divide_entry_members (entry_id, friend_id, friend_name, share_amount) VALUES ($1,$2,$3,$4)',
        [fakeId, share.friend_id, share.friend_name, share.share_amount]
      );
    }
  }
}

async function getMonthRowTx(client, userId, monthKey) {
  const rowR = await client.query(
    'SELECT * FROM petrol_divide_months WHERE user_id = $1 AND month_key = $2 LIMIT 1',
    [userId, monthKey]
  );
  if (rowR.rows[0]) return rowR.rows[0];

  const prevR = await client.query(
    `SELECT * FROM petrol_divide_months
     WHERE user_id = $1 AND month_key < $2
     ORDER BY month_key DESC
     LIMIT 1`,
    [userId, monthKey]
  );
  const prev = prevR.rows[0] || null;

  const inserted = await client.query(
    `INSERT INTO petrol_divide_months (user_id, month_key, petrol_price)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, monthKey, prev ? r2(prev.petrol_price) : 0]
  );
  const month = inserted.rows[0];

  if (prev) {
    await client.query(
      `INSERT INTO petrol_divide_month_members (month_id, friend_id, friend_name)
       SELECT $1, mm.friend_id, mm.friend_name
       FROM petrol_divide_month_members mm
       WHERE mm.month_id = $2
       ON CONFLICT (month_id, friend_id) DO NOTHING`,
      [month.id, prev.id]
    );
  }

  return month;
}

async function getLiveSplitFriendsForUserTx(client, userId) {
  const r = await client.query(
    `SELECT f.id, f.name, f.linked_user_id,
            u.display_name AS linked_user_display_name,
            u.username AS linked_user_username
     FROM live_split_friends f
     LEFT JOIN users u ON u.id = f.linked_user_id
     WHERE f.user_id = $1
       AND f.deleted_at IS NULL
     ORDER BY lower(f.name), f.id`,
    [userId]
  );
  return (r.rows || []).map((row) => ({
    id: Number(row.id),
    name: row.name,
    linked_user_id: row.linked_user_id ? Number(row.linked_user_id) : null,
    linked_user_display_name: row.linked_user_display_name || null,
    linked_user_username: row.linked_user_username || null,
  }));
}

async function getMonthMembersTx(client, monthId) {
  const r = await client.query(
    `SELECT mm.friend_id, COALESCE(f.name, mm.friend_name) AS friend_name,
            f.linked_user_id, u.display_name AS linked_user_display_name, u.username AS linked_user_username
     FROM petrol_divide_month_members mm
     LEFT JOIN live_split_friends f ON f.id = mm.friend_id
     LEFT JOIN users u ON u.id = f.linked_user_id
     WHERE mm.month_id = $1
     ORDER BY lower(COALESCE(f.name, mm.friend_name)), mm.friend_id`,
    [monthId]
  );
  return (r.rows || []).map((row) => ({
    friend_id: Number(row.friend_id),
    friend_name: String(row.friend_name || '').trim(),
    linked_user_id: row.linked_user_id ? Number(row.linked_user_id) : null,
    linked_user_display_name: row.linked_user_display_name || null,
    linked_user_username: row.linked_user_username || null,
  }));
}

async function getMonthEntriesTx(client, monthId) {
  const entriesR = await client.query(
    `SELECT *
     FROM petrol_divide_entries
     WHERE month_id = $1
     ORDER BY entry_date DESC, id DESC`,
    [monthId]
  );
  const membersR = await client.query(
    `SELECT em.entry_id, em.friend_id, COALESCE(f.name, em.friend_name) AS friend_name, em.share_amount
     FROM petrol_divide_entry_members em
     LEFT JOIN live_split_friends f ON f.id = em.friend_id
     WHERE em.entry_id = ANY($1::bigint[])
     ORDER BY em.entry_id, em.id`,
    [(entriesR.rows || []).map((row) => Number(row.id)).filter((id) => id > 0)]
  );
  const memberMap = new Map();
  (membersR.rows || []).forEach((row) => {
    const eid = Number(row.entry_id);
    if (!memberMap.has(eid)) memberMap.set(eid, []);
    memberMap.get(eid).push({
      friend_id: Number(row.friend_id),
      friend_name: String(row.friend_name || '').trim(),
      share_amount: r2(row.share_amount),
    });
  });
  return (entriesR.rows || []).map((row) => {
    const selfShare = r2(row.self_share_amount);
    const members = memberMap.get(Number(row.id)) || [];
    if (selfShare > 0) {
      members.unshift({
        friend_id: 0,
        friend_name: 'You',
        share_amount: selfShare,
        is_self: true,
      });
    }
    return {
      id: Number(row.id),
      month_id: Number(row.month_id),
      entry_date: normalizeDate(row.entry_date, ''),
      remarks: row.remarks || '',
      distance_km: r1(row.distance_km),
      average_kmpl: r1(row.average_kmpl),
      petrol_price: r2(row.petrol_price),
      petrol_used_litre: r2(row.petrol_used_litre),
      amount_used: r2(row.amount_used),
      self_share_amount: selfShare,
      is_fake: !!row.is_fake,
      source_entry_id: row.source_entry_id ? Number(row.source_entry_id) : null,
      members,
    };
  });
}

async function getMonthAdjustmentsTx(client, userId, monthId) {
  const r = await client.query(
    `SELECT friend_id, COALESCE(f.name, a.friend_name) AS friend_name, adjust_amount, note
     FROM petrol_divide_month_adjustments a
     LEFT JOIN live_split_friends f ON f.id = a.friend_id
     WHERE a.user_id = $1
       AND a.month_id = $2
     ORDER BY lower(COALESCE(f.name, a.friend_name)), a.friend_id`,
    [userId, monthId]
  );
  return (r.rows || []).map((row) => ({
    friend_id: Number(row.friend_id),
    friend_name: String(row.friend_name || '').trim(),
    adjust_amount: r2(row.adjust_amount),
    note: row.note || '',
  }));
}

function buildMonthTotals(entries = [], adjustments = []) {
  const map = new Map();
  const ensure = (memberKey, friendId, friendName) => {
    const key = String(memberKey || '');
    if (!key) return null;
    const id = Number(friendId || 0);
    if (!map.has(key)) map.set(key, {
      friend_id: id > 0 ? id : 0,
      friend_name: String(friendName || 'Friend').trim() || 'Friend',
      real_total: 0,
      fake_total: 0,
      adjustment: 0,
      final_real: 0,
      final_fake: 0,
      final_total: 0,
    });
    return map.get(key);
  };

  (entries || []).forEach((entry) => {
    (entry.members || []).forEach((member) => {
      const mid = Number(member.friend_id || 0);
      const isSelf = !!member.is_self || !(mid > 0);
      const row = ensure(isSelf ? 'self' : `friend:${mid}`, isSelf ? 0 : mid, isSelf ? 'You' : member.friend_name);
      if (!row) return;
      if (entry.is_fake) row.fake_total = r2(row.fake_total + n(member.share_amount));
      else row.real_total = r2(row.real_total + n(member.share_amount));
    });
  });

  (adjustments || []).forEach((adj) => {
    const id = Number(adj.friend_id || 0);
    if (!(id > 0)) return;
    const row = ensure(`friend:${id}`, id, adj.friend_name);
    if (!row) return;
    row.adjustment = r2(n(adj.adjust_amount));
  });

  const rows = [...map.values()].map((row) => ({
    ...row,
    final_real: r2(row.real_total + row.adjustment),
    final_fake: r2(row.fake_total + row.adjustment),
    final_total: r2(row.real_total + row.fake_total + row.adjustment),
  })).sort((a, b) => {
    if (a.friend_id === 0 && b.friend_id !== 0) return -1;
    if (b.friend_id === 0 && a.friend_id !== 0) return 1;
    return a.friend_name.localeCompare(b.friend_name);
  });

  return rows;
}

async function getPetrolDivideMonth(userId, monthKeyInput) {
  await ensureSchema();
  const monthKey = normalizeMonthKey(monthKeyInput || new Date().toISOString().slice(0, 7));
  return withTransaction(async (client) => getPetrolDivideMonthTx(client, userId, monthKey));
}

async function getPetrolDivideMonthTx(client, userId, monthKeyInput) {
  const monthKey = normalizeMonthKey(monthKeyInput || new Date().toISOString().slice(0, 7));
  const month = await getMonthRowTx(client, userId, monthKey);
  const monthMembers = await getMonthMembersTx(client, Number(month.id));
  const entries = await getMonthEntriesTx(client, Number(month.id));
  const adjustments = await getMonthAdjustmentsTx(client, userId, Number(month.id));
  const totals = buildMonthTotals(entries, adjustments);
  const liveSplitFriends = await getLiveSplitFriendsForUserTx(client, userId);
  return {
    month: {
      id: Number(month.id),
      month_key: month.month_key,
      petrol_price: r2(month.petrol_price),
      fake_increase_pct: r2(month.fake_increase_pct || 0),
    },
    month_members: monthMembers,
    entries,
    adjustments,
    totals,
    live_split_friends: liveSplitFriends,
  };
}

async function getPetrolDivideMonths(userId) {
  await ensureSchema();
  const rowsR = await query(
    `SELECT m.month_key, m.petrol_price, m.fake_increase_pct,
            COUNT(DISTINCT mm.friend_id) AS members_count,
            COUNT(DISTINCT e.id) AS entries_count
     FROM petrol_divide_months m
     LEFT JOIN petrol_divide_month_members mm ON mm.month_id = m.id
     LEFT JOIN petrol_divide_entries e ON e.month_id = m.id
     WHERE m.user_id = $1
     GROUP BY m.id
     ORDER BY m.month_key DESC`,
    [userId]
  );

  const monthRows = rowsR.rows || [];
  const result = [];
  for (const row of monthRows) {
    const monthData = await getPetrolDivideMonth(userId, String(row.month_key));
    const total = r2((monthData.totals || []).reduce((sum, item) => sum + n(item.real_total), 0));
    result.push({
      month_key: String(row.month_key),
      petrol_price: r2(row.petrol_price),
      fake_increase_pct: r2(row.fake_increase_pct || 0),
      members_count: Number(row.members_count || 0),
      entries_count: Number(row.entries_count || 0),
      total_amount: total,
    });
  }
  return result;
}

async function deletePetrolDivideMonth(userId, monthKeyInput) {
  await ensureSchema();
  const monthKey = normalizeMonthKey(monthKeyInput);
  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM petrol_divide_months
       WHERE user_id = $1
         AND month_key = $2`,
      [userId, monthKey]
    );
  });
  return getPetrolDivideMonths(userId);
}

async function savePetrolDivideMonthConfig(userId, data = {}) {
  await ensureSchema();
  const monthKey = normalizeMonthKey(data.month_key);
  const petrolPrice = r2(data.petrol_price);
  if (!Number.isFinite(petrolPrice) || petrolPrice < 0) throw validationError('Petrol price must be 0 or more');
  const fakeIncreasePct = data.fake_increase_pct === undefined ? null : r2(data.fake_increase_pct);
  if (fakeIncreasePct !== null && (!Number.isFinite(fakeIncreasePct) || fakeIncreasePct < 0)) {
    throw validationError('Fake increase % must be 0 or more');
  }
  const friendIds = normalizeFriendIds(data.member_friend_ids || []);

  return withTransaction(async (client) => {
    const month = await getMonthRowTx(client, userId, monthKey);
    await client.query(
      'UPDATE petrol_divide_months SET petrol_price = $1, fake_increase_pct = COALESCE($2, fake_increase_pct), updated_at = NOW() WHERE id = $3',
      [petrolPrice, fakeIncreasePct, month.id]
    );

    if (friendIds.length) {
      const friendsR = await client.query(
        `SELECT id, name
         FROM live_split_friends
         WHERE user_id = $1
           AND deleted_at IS NULL
           AND id = ANY($2::bigint[])`,
        [userId, friendIds]
      );
      const friends = friendsR.rows || [];
      if (friends.length !== friendIds.length) throw validationError('Some selected members are invalid');
      await client.query('DELETE FROM petrol_divide_month_members WHERE month_id = $1', [month.id]);
      for (const friend of friends) {
        await client.query(
          'INSERT INTO petrol_divide_month_members (month_id, friend_id, friend_name) VALUES ($1, $2, $3)',
          [month.id, Number(friend.id), String(friend.name || '').trim() || 'Friend']
        );
      }
    }

    const freshMonthR = await client.query('SELECT * FROM petrol_divide_months WHERE id = $1 LIMIT 1', [month.id]);
    const freshMonth = freshMonthR.rows[0] || month;
    await syncMonthFakeEntriesTx(client, userId, Number(month.id), r2(freshMonth.fake_increase_pct || 0));
    return getPetrolDivideMonthTx(client, userId, monthKey);
  });
}

async function addPetrolDivideEntry(userId, data = {}) {
  await ensureSchema();
  const monthKey = normalizeMonthKey(data.month_key);
  const today = new Date().toISOString().slice(0, 10);
  const entryDate = normalizeDate(data.entry_date || today, today);
  if (String(entryDate).slice(0, 7) !== monthKey) {
    throw validationError('Entry date must be within selected month');
  }
  const remarks = String(data.remarks || '').trim();
  const distance = r1(data.distance_km);
  const average = r1(data.average_kmpl);
  if (!(distance > 0)) throw validationError('Distance must be greater than 0');
  if (!(average > 0)) throw validationError('Average must be greater than 0');

  return withTransaction(async (client) => {
    const month = await getMonthRowTx(client, userId, monthKey);
    const monthId = Number(month.id);
    const price = r2(data.petrol_price ?? month.petrol_price);
    if (!(price >= 0)) throw validationError('Petrol price must be 0 or more');

    const hasMemberIds = Array.isArray(data.member_friend_ids);
    let members = normalizeFriendIds(hasMemberIds ? data.member_friend_ids : []);
    if (!hasMemberIds && !members.length) {
      const mm = await getMonthMembersTx(client, monthId);
      members = mm.map((m) => Number(m.friend_id)).filter((id) => id > 0);
    }
    const friendRowsR = await client.query(
      `SELECT id, name
       FROM live_split_friends
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND id = ANY($2::bigint[])
       ORDER BY id`,
      [userId, members]
    );
    const friendRows = friendRowsR.rows || [];
    if (friendRows.length !== members.length) throw validationError('Some members are invalid');

    const petrolUsed = r2(distance / average);
    const amountUsed = r2(petrolUsed * price);
    const splitPeople = [
      { friend_id: 0, friend_name: 'You', is_self: true },
      ...friendRows.map((f) => ({ friend_id: Number(f.id), friend_name: String(f.name || '').trim() || 'Friend' })),
    ];
    const splitShares = calcEqualShares(amountUsed, splitPeople);
    const selfShare = r2((splitShares.find((s) => s.is_self) || {}).share_amount || 0);

    const entryR = await client.query(
      `INSERT INTO petrol_divide_entries (user_id, month_id, entry_date, remarks, distance_km, average_kmpl, petrol_price, petrol_used_litre, amount_used, self_share_amount, is_fake)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE)
       RETURNING id`,
      [userId, monthId, entryDate, remarks || null, distance, average, price, petrolUsed, amountUsed, selfShare]
    );
    const entryId = Number(entryR.rows[0].id);
    const shares = splitShares.filter((share) => Number(share.friend_id) > 0);
    for (const share of shares) {
      await client.query(
        'INSERT INTO petrol_divide_entry_members (entry_id, friend_id, friend_name, share_amount) VALUES ($1,$2,$3,$4)',
        [entryId, share.friend_id, share.friend_name, share.share_amount]
      );
    }

    await syncMonthFakeEntriesTx(client, userId, monthId, r2(month.fake_increase_pct || 0));
    return getPetrolDivideMonthTx(client, userId, monthKey);
  });
}

async function updatePetrolDivideEntry(userId, entryId, data = {}) {
  await ensureSchema();
  const eid = Number(entryId);
  if (!(eid > 0)) throw validationError('Entry is invalid');

  return withTransaction(async (client) => {
    const existingR = await client.query(
      `SELECT e.*, m.month_key
       FROM petrol_divide_entries e
       JOIN petrol_divide_months m ON m.id = e.month_id
       WHERE e.id = $1 AND e.user_id = $2
       LIMIT 1`,
      [eid, userId]
    );
    const existing = existingR.rows[0];
    if (!existing) throw validationError('Entry not found');
    if (existing.is_fake) throw validationError('Fake entries are auto-generated and cannot be edited directly');

    const monthKey = normalizeMonthKey(data.month_key || existing.month_key);
    const targetMonth = await getMonthRowTx(client, userId, monthKey);
    const entryDate = normalizeDate(data.entry_date || existing.entry_date);
    if (String(entryDate).slice(0, 7) !== monthKey) {
      throw validationError('Entry date must be within selected month');
    }
    const remarks = data.remarks !== undefined ? String(data.remarks || '').trim() : String(existing.remarks || '').trim();
    const distance = r1(data.distance_km ?? existing.distance_km);
    const average = r1(data.average_kmpl ?? existing.average_kmpl);
    if (!(distance > 0)) throw validationError('Distance must be greater than 0');
    if (!(average > 0)) throw validationError('Average must be greater than 0');
    const price = r2(data.petrol_price ?? existing.petrol_price);
    if (!(price >= 0)) throw validationError('Petrol price must be 0 or more');

    const hasMemberIds = Array.isArray(data.member_friend_ids);
    let members = normalizeFriendIds(hasMemberIds ? data.member_friend_ids : []);
    if (!hasMemberIds && !members.length) {
      const memberRows = await client.query('SELECT friend_id FROM petrol_divide_entry_members WHERE entry_id = $1 ORDER BY id', [eid]);
      members = (memberRows.rows || []).map((row) => Number(row.friend_id)).filter((id) => id > 0);
    }
    const friendRowsR = await client.query(
      `SELECT id, name
       FROM live_split_friends
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND id = ANY($2::bigint[])
       ORDER BY id`,
      [userId, members]
    );
    const friendRows = friendRowsR.rows || [];
    if (friendRows.length !== members.length) throw validationError('Some members are invalid');

    const petrolUsed = r2(distance / average);
    const amountUsed = r2(petrolUsed * price);
    const splitPeople = [
      { friend_id: 0, friend_name: 'You', is_self: true },
      ...friendRows.map((f) => ({ friend_id: Number(f.id), friend_name: String(f.name || '').trim() || 'Friend' })),
    ];
    const splitShares = calcEqualShares(amountUsed, splitPeople);
    const selfShare = r2((splitShares.find((s) => s.is_self) || {}).share_amount || 0);

    await client.query(
      `UPDATE petrol_divide_entries
       SET month_id = $1,
           entry_date = $2,
           remarks = $3,
           distance_km = $4,
           average_kmpl = $5,
           petrol_price = $6,
           petrol_used_litre = $7,
           amount_used = $8,
           self_share_amount = $9,
           updated_at = NOW()
       WHERE id = $10 AND user_id = $11`,
      [targetMonth.id, entryDate, remarks || null, distance, average, price, petrolUsed, amountUsed, selfShare, eid, userId]
    );

    await client.query('DELETE FROM petrol_divide_entry_members WHERE entry_id = $1', [eid]);
    const shares = splitShares.filter((share) => Number(share.friend_id) > 0);
    for (const share of shares) {
      await client.query(
        'INSERT INTO petrol_divide_entry_members (entry_id, friend_id, friend_name, share_amount) VALUES ($1,$2,$3,$4)',
        [eid, share.friend_id, share.friend_name, share.share_amount]
      );
    }

    const oldMonthId = Number(existing.month_id);
    const newMonthId = Number(targetMonth.id);
    const oldMonthR = await client.query('SELECT fake_increase_pct FROM petrol_divide_months WHERE id = $1 LIMIT 1', [oldMonthId]);
    const newMonthR = await client.query('SELECT fake_increase_pct FROM petrol_divide_months WHERE id = $1 LIMIT 1', [newMonthId]);
    await syncMonthFakeEntriesTx(client, userId, oldMonthId, r2(oldMonthR.rows[0]?.fake_increase_pct || 0));
    if (newMonthId !== oldMonthId) {
      await syncMonthFakeEntriesTx(client, userId, newMonthId, r2(newMonthR.rows[0]?.fake_increase_pct || 0));
    }

    return getPetrolDivideMonthTx(client, userId, monthKey);
  });
}

async function deletePetrolDivideEntry(userId, entryId) {
  await ensureSchema();
  const eid = Number(entryId);
  if (!(eid > 0)) throw validationError('Entry is invalid');
  return withTransaction(async (client) => {
    const rowR = await client.query(
      `SELECT m.month_key, e.month_id
       FROM petrol_divide_entries e
       JOIN petrol_divide_months m ON m.id = e.month_id
       WHERE e.id = $1 AND e.user_id = $2
       LIMIT 1`,
      [eid, userId]
    );
    const row = rowR.rows[0];
    if (!row) throw validationError('Entry not found');
    await client.query('DELETE FROM petrol_divide_entries WHERE id = $1 AND user_id = $2', [eid, userId]);
    const monthR = await client.query('SELECT fake_increase_pct FROM petrol_divide_months WHERE id = $1 LIMIT 1', [Number(row.month_id)]);
    await syncMonthFakeEntriesTx(client, userId, Number(row.month_id), r2(monthR.rows[0]?.fake_increase_pct || 0));
    return getPetrolDivideMonthTx(client, userId, row.month_key);
  });
}

async function generatePetrolDivideFakeEntries(userId, monthKeyInput, increasePctInput = 0) {
  await ensureSchema();
  const monthKey = normalizeMonthKey(monthKeyInput);
  const pct = r2(increasePctInput);
  if (!Number.isFinite(pct) || pct < 0) throw validationError('Increase percentage is invalid');

  return withTransaction(async (client) => {
    const month = await getMonthRowTx(client, userId, monthKey);
    const monthId = Number(month.id);
    await client.query(
      'UPDATE petrol_divide_months SET fake_increase_pct = $1, updated_at = NOW() WHERE id = $2',
      [pct, monthId]
    );
    await syncMonthFakeEntriesTx(client, userId, monthId, pct);

    return getPetrolDivideMonthTx(client, userId, monthKey);
  });
}

async function savePetrolDivideMonthAdjustments(userId, data = {}) {
  await ensureSchema();
  const monthKey = normalizeMonthKey(data.month_key);
  const adjustments = Array.isArray(data.adjustments) ? data.adjustments : [];

  return withTransaction(async (client) => {
    const month = await getMonthRowTx(client, userId, monthKey);
    await client.query('DELETE FROM petrol_divide_month_adjustments WHERE user_id = $1 AND month_id = $2', [userId, month.id]);

    for (const item of adjustments) {
      const friendId = Number(item?.friend_id || 0);
      if (!(friendId > 0)) continue;
      const friendR = await client.query(
        `SELECT id, name
         FROM live_split_friends
         WHERE user_id = $1
           AND deleted_at IS NULL
           AND id = $2
         LIMIT 1`,
        [userId, friendId]
      );
      const friend = friendR.rows[0] || null;
      if (!friend) continue;
      const adjustAmount = r2(item?.adjust_amount || 0);
      const note = String(item?.note || '').trim();
      await client.query(
        `INSERT INTO petrol_divide_month_adjustments (user_id, month_id, friend_id, friend_name, adjust_amount, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [userId, month.id, friendId, String(friend.name || '').trim() || 'Friend', adjustAmount, note || null]
      );
    }

    return getPetrolDivideMonthTx(client, userId, monthKey);
  });
}

async function createPetrolDivideShareLink(userId, data = {}) {
  await ensureSchema();
  const monthKey = normalizeMonthKey(data.month_key);
  const shareType = String(data.share_type || 'entries').toLowerCase() === 'summary' ? 'summary' : 'entries';
  const modeRaw = String(data.view_mode || 'real').toLowerCase();
  const viewMode = ['real', 'fake', 'both'].includes(modeRaw) ? modeRaw : 'real';
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const token = (typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(2).toString('hex')}-${crypto.randomBytes(2).toString('hex')}-${crypto.randomBytes(2).toString('hex')}-${crypto.randomBytes(6).toString('hex')}`;

  return withTransaction(async (client) => {
    const month = await getMonthRowTx(client, userId, monthKey);
    await client.query(
      `INSERT INTO petrol_divide_share_links (user_id, month_id, token, share_type, view_mode, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, month.id, token, shareType, viewMode, expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null]
    );
    return {
      token,
      share_type: shareType,
      view_mode: viewMode,
      month_key: monthKey,
    };
  });
}

function filterEntriesByMode(entries = [], mode = 'real') {
  if (mode === 'both') return entries;
  if (mode === 'fake') return (entries || []).filter((entry) => !!entry.is_fake);
  return (entries || []).filter((entry) => !entry.is_fake);
}

async function getPetrolDivideShareByToken(token) {
  await ensureSchema();
  const clean = String(token || '').trim();
  if (!clean) return null;

  const linkR = await query(
    `SELECT l.*, m.month_key, u.display_name AS owner_name
     FROM petrol_divide_share_links l
     JOIN petrol_divide_months m ON m.id = l.month_id
     JOIN users u ON u.id = l.user_id
     WHERE l.token = $1
     LIMIT 1`,
    [clean]
  );
  const link = linkR.rows[0] || null;
  if (!link) return null;
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return null;

  const ownerName = String(link.owner_name || 'Owner').trim() || 'Owner';
  const data = await getPetrolDivideMonth(Number(link.user_id), String(link.month_key));
  const mode = String(link.view_mode || 'real').toLowerCase();
  const filteredEntries = filterEntriesByMode(data.entries || [], mode);

  // Replace "You" (self entries) with the actual owner's display name
  const namedEntries = filteredEntries.map((entry) => ({
    ...entry,
    members: (entry.members || []).map((m) => ({
      ...m,
      friend_name: (m.is_self || m.friend_name === 'You') ? ownerName : m.friend_name,
    })),
  }));

  const totals = buildMonthTotals(namedEntries, data.adjustments || []).map((row) => ({
    ...row,
    friend_name: row.friend_name === 'You' ? ownerName : row.friend_name,
  }));

  return {
    owner_name: ownerName,
    month_key: link.month_key,
    share_type: link.share_type,
    view_mode: mode,
    petrol_price: data.month?.petrol_price || 0,
    entries: link.share_type === 'entries' ? namedEntries : [],
    totals,
  };
}

async function getPetrolDivideMonthlySettlements(userId, monthKeyInput, viewModeInput = 'real') {
  await ensureSchema();
  const monthKey = normalizeMonthKey(monthKeyInput);
  const mode = String(viewModeInput || 'real').toLowerCase();
  const data = await getPetrolDivideMonth(userId, monthKey);
  const rows = (data.totals || []).map((row) => {
    let amount = row.final_real;
    if (mode === 'fake') amount = row.final_fake;
    else if (mode === 'both') amount = row.final_total;
    return {
      friend_id: Number(row.friend_id),
      friend_name: row.friend_name,
      amount: r2(amount),
    };
  }).filter((row) => row.friend_id > 0 && row.amount > 0);
  return {
    month_key: monthKey,
    settlements: rows,
  };
}

module.exports = {
  getPetrolDivideMonths,
  getPetrolDivideMonth,
  deletePetrolDivideMonth,
  savePetrolDivideMonthConfig,
  addPetrolDivideEntry,
  updatePetrolDivideEntry,
  deletePetrolDivideEntry,
  generatePetrolDivideFakeEntries,
  savePetrolDivideMonthAdjustments,
  createPetrolDivideShareLink,
  getPetrolDivideShareByToken,
  getPetrolDivideMonthlySettlements,
  monthToDate,
};
