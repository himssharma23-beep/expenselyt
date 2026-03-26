const { query, withTransaction } = require('./postgres');

function num(value) {
  return Number(value || 0);
}

function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function normalizeText(value, label, maxLength = 120) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) throw validationError(`${label} is required`);
  if (normalized.length > maxLength) throw validationError(`${label} must be ${maxLength} characters or fewer`);
  return normalized;
}

function normalizeCardLast4(value) {
  const last4 = String(value || '').trim();
  if (!/^\d{4}$/.test(last4)) throw validationError('Last 4 digits must be exactly 4 numbers');
  return last4;
}

function normalizeBankAccountId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function adjustBankBalance(userId, bankAccountId, delta, client = null) {
  const targetBankId = normalizeBankAccountId(bankAccountId);
  const amount = Number(delta || 0);
  if (!targetBankId || !amount) return;
  const run = client || { query };
  await run.query(
    `UPDATE bank_accounts
     SET balance = balance + $1, updated_at = NOW(), updated_by = $3
     WHERE id = $2 AND user_id = $3 AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL`,
    [amount, targetBankId, userId]
  );
}

async function getDefaultBankAccountId(userId, client = null) {
  const run = client || { query };
  const result = await run.query(
    `SELECT id
     FROM bank_accounts
     WHERE user_id = $1 AND is_default = TRUE AND COALESCE(is_active, TRUE) = TRUE AND deleted_at IS NULL
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}

function _localDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCcCyclePeriod(billGenDay) {
  const today = new Date();
  const day = today.getDate();
  const y = today.getFullYear();
  const m = today.getMonth();
  let cycleStart;
  let cycleEnd;
  if (day <= billGenDay) {
    cycleStart = _localDate(new Date(y, m - 1, billGenDay + 1));
    cycleEnd = _localDate(new Date(y, m, billGenDay));
  } else {
    cycleStart = _localDate(new Date(y, m, billGenDay + 1));
    cycleEnd = _localDate(new Date(y, m + 1, billGenDay));
  }
  return { cycleStart, cycleEnd };
}

async function getOrCreateCurrentCycle(cardId, userId, client = null) {
  const run = client || { query };
  const today = _localDate(new Date());
  let cycleR = await run.query(
    `SELECT *
     FROM cc_cycles
     WHERE card_id = $1 AND user_id = $2 AND status = 'open' AND cycle_start <= $3 AND cycle_end >= $4
     LIMIT 1`,
    [cardId, userId, today, today]
  );
  if (cycleR.rows[0]) return cycleR.rows[0];
  const cardR = await run.query('SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 LIMIT 1', [cardId, userId]);
  const card = cardR.rows[0];
  if (!card) return null;
  const { cycleStart, cycleEnd } = getCcCyclePeriod(card.bill_gen_day || 1);
  const dueDate = new Date(`${cycleEnd}T00:00:00`);
  dueDate.setDate(dueDate.getDate() + (card.due_days || 20));
  const existingR = await run.query(
    `SELECT *
     FROM cc_cycles
     WHERE card_id = $1 AND user_id = $2 AND cycle_start = $3 AND cycle_end = $4
     LIMIT 1`,
    [cardId, userId, cycleStart, cycleEnd]
  );
  if (existingR.rows[0]) return existingR.rows[0];
  const insertR = await run.query(
    `INSERT INTO cc_cycles (user_id, card_id, cycle_start, cycle_end, due_date, status)
     VALUES ($1, $2, $3, $4, $5, 'open')
     RETURNING *`,
    [userId, cardId, cycleStart, cycleEnd, _localDate(dueDate)]
  );
  return insertR.rows[0];
}

async function updateCycleTotals(cycleId, client = null) {
  const run = client || { query };
  const cycleR = await run.query('SELECT manual_total_override FROM cc_cycles WHERE id = $1 LIMIT 1', [cycleId]);
  if (cycleR.rows[0]?.manual_total_override) return;
  const totalsR = await run.query(
    `SELECT
       COUNT(*)::int AS txn_count,
       COALESCE(SUM(amount), 0) AS total_amount,
       COALESCE(SUM(discount_amount), 0) AS total_discount,
       COALESCE(SUM(net_amount), 0) AS net_payable
     FROM cc_txns
     WHERE cycle_id = $1`,
    [cycleId]
  );
  const totals = totalsR.rows[0];
  if (!totals || !totals.txn_count) return;
  await run.query(
    `UPDATE cc_cycles
     SET total_amount = $1, total_discount = $2, net_payable = $3
     WHERE id = $4`,
    [totals.total_amount, totals.total_discount, totals.net_payable, cycleId]
  );
}

async function autoClosePastCcCycles(userId, cardId = null) {
  const today = _localDate(new Date());
  const params = cardId ? [userId, today, cardId] : [userId, today];
  const result = await query(
    `SELECT id, net_payable, paid_amount, paid_date
     FROM cc_cycles
     WHERE user_id = $1 AND status = 'open' AND cycle_end < $2${cardId ? ' AND card_id = $3' : ''}`,
    params
  );
  for (const cycle of result.rows) {
    const paid = num(cycle.paid_amount);
    const due = num(cycle.net_payable);
    const status = paid >= due - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'billed';
    await query(
      `UPDATE cc_cycles
       SET status = $1, paid_amount = $2, paid_date = $3, closed_at = COALESCE(closed_at, NOW())
       WHERE id = $4`,
      [status, paid, cycle.paid_date || null, cycle.id]
    );
  }
}

async function addCreditCard(userId, card) {
  const bankName = normalizeText(card.bank_name, 'Bank name', 80);
  const cardName = normalizeText(card.card_name, 'Card name', 80);
  const last4 = normalizeCardLast4(card.last4);
  const result = await query(
    `INSERT INTO credit_cards (user_id, bank_name, card_name, last4, expiry_month, expiry_year, bill_gen_day, due_days, default_discount_pct, credit_limit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [userId, bankName, cardName, last4, card.expiry_month || null, card.expiry_year || null, card.bill_gen_day || 1, card.due_days || 20, card.default_discount_pct || 0, card.credit_limit || 0]
  );
  return Number(result.rows[0].id);
}

async function updateCreditCard(userId, id, card) {
  const bankName = normalizeText(card.bank_name, 'Bank name', 80);
  const cardName = normalizeText(card.card_name, 'Card name', 80);
  const last4 = normalizeCardLast4(card.last4);
  await query(
    `UPDATE credit_cards
     SET bank_name = $1, card_name = $2, last4 = $3, expiry_month = $4, expiry_year = $5,
         bill_gen_day = $6, due_days = $7, default_discount_pct = $8, credit_limit = $9
     WHERE id = $10 AND user_id = $11`,
    [bankName, cardName, last4, card.expiry_month || null, card.expiry_year || null, card.bill_gen_day || 1, card.due_days || 20, card.default_discount_pct || 0, card.credit_limit || 0, id, userId]
  );
}

async function deleteCreditCard(userId, id) {
  await query('DELETE FROM credit_cards WHERE id = $1 AND user_id = $2', [id, userId]);
}

async function getCreditCards(userId) {
  await autoClosePastCcCycles(userId);
  const cardsR = await query(
    `SELECT *
     FROM credit_cards
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC`,
    [userId]
  );
  const cards = [];
  for (const card of cardsR.rows) {
    const today = _localDate(new Date());
    const [cycleR, totalsR] = await Promise.all([
      query(
        `SELECT *
         FROM cc_cycles
         WHERE card_id = $1 AND user_id = $2 AND status = 'open' AND cycle_start <= $3 AND cycle_end >= $4
         LIMIT 1`,
        [card.id, userId, today, today]
      ),
      query(
        `SELECT COALESCE(SUM(amount),0) AS total_spent, COALESCE(SUM(net_amount),0) AS total_net, COUNT(*)::int AS txn_count
         FROM cc_txns
         WHERE card_id = $1 AND user_id = $2`,
        [card.id, userId]
      ),
    ]);
    cards.push({
      ...card,
      credit_limit: num(card.credit_limit),
      default_discount_pct: num(card.default_discount_pct),
      currentCycle: cycleR.rows[0] || null,
      totalSpent: num(totalsR.rows[0]?.total_spent),
      totalNet: num(totalsR.rows[0]?.total_net),
      totalTxns: Number(totalsR.rows[0]?.txn_count || 0),
    });
  }
  return cards;
}

async function addCcTxn(userId, txn) {
  return withTransaction(async (client) => {
    const cardR = await client.query('SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 LIMIT 1', [txn.card_id, userId]);
    const card = cardR.rows[0];
    if (!card) throw new Error('Card not found');
    const cycle = await getOrCreateCurrentCycle(txn.card_id, userId, client);
    if (!cycle) throw new Error('Could not get billing cycle');
    const discPct = txn.discount_pct != null ? parseFloat(txn.discount_pct) : num(card.default_discount_pct);
    const amount = parseFloat(txn.amount);
    const discAmt = Math.round(amount * discPct / 100 * 100) / 100;
    const netAmt = Math.round(amount * 100) / 100;
    const result = await client.query(
      `INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [userId, txn.card_id, cycle.id, txn.txn_date, txn.description, amount, discPct, discAmt, netAmt, txn.source || 'manual', txn.source_id || null]
    );
    await updateCycleTotals(cycle.id, client);
    return Number(result.rows[0].id);
  });
}

async function getCcCurrentCycle(userId, cardId) {
  await autoClosePastCcCycles(userId, cardId);
  const cardR = await query('SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 LIMIT 1', [cardId, userId]);
  const card = cardR.rows[0];
  if (!card) return null;
  const cycle = await getOrCreateCurrentCycle(cardId, userId);
  if (!cycle) return { card, cycle: null, txns: [] };
  const txnsR = await query('SELECT * FROM cc_txns WHERE cycle_id = $1 ORDER BY txn_date ASC, id ASC', [cycle.id]);
  return { card, cycle, txns: txnsR.rows.map((row) => ({ ...row, amount: num(row.amount), discount_pct: num(row.discount_pct), discount_amount: num(row.discount_amount), net_amount: num(row.net_amount) })) };
}

async function getCcCycles(userId, cardId) {
  await autoClosePastCcCycles(userId, cardId);
  const cyclesR = await query('SELECT * FROM cc_cycles WHERE card_id = $1 AND user_id = $2 ORDER BY cycle_start DESC', [cardId, userId]);
  const cycles = [];
  for (const cycle of cyclesR.rows) {
    const txnsR = await query('SELECT * FROM cc_txns WHERE cycle_id = $1 ORDER BY txn_date ASC', [cycle.id]);
    cycles.push({
      ...cycle,
      total_amount: num(cycle.total_amount),
      total_discount: num(cycle.total_discount),
      net_payable: num(cycle.net_payable),
      paid_amount: num(cycle.paid_amount),
      txns: txnsR.rows.map((row) => ({ ...row, amount: num(row.amount), discount_pct: num(row.discount_pct), discount_amount: num(row.discount_amount), net_amount: num(row.net_amount) })),
    });
  }
  return cycles;
}

async function getCcMonthlySummary(userId, cardId, year) {
  const params = year ? [cardId, userId, String(year)] : [cardId, userId];
  const result = await query(
    `SELECT to_char(cycle_end, 'YYYY-MM') AS month,
            COALESCE(SUM(total_amount), 0) AS total_amount,
            COALESCE(SUM(total_discount), 0) AS total_discount,
            COALESCE(SUM(net_payable), 0) AS net_payable,
            COALESCE(SUM((SELECT COUNT(*) FROM cc_txns t WHERE t.cycle_id = cy.id)), 0) AS txn_count
     FROM cc_cycles cy
     WHERE card_id = $1 AND user_id = $2 AND status != 'open'${year ? " AND to_char(cycle_end, 'YYYY') = $3" : ''}
     GROUP BY month
     ORDER BY month DESC`,
    params
  );
  return result.rows.map((row) => ({ ...row, total_amount: num(row.total_amount), total_discount: num(row.total_discount), net_payable: num(row.net_payable), txn_count: Number(row.txn_count || 0) }));
}

async function getCcYearlySummary(userId, cardId) {
  const result = await query(
    `SELECT to_char(cycle_end, 'YYYY') AS year,
            COALESCE(SUM(total_amount), 0) AS total_amount,
            COALESCE(SUM(total_discount), 0) AS total_discount,
            COALESCE(SUM(net_payable), 0) AS net_payable,
            COALESCE(SUM((SELECT COUNT(*) FROM cc_txns t WHERE t.cycle_id = cy.id)), 0) AS txn_count,
            COUNT(*)::int AS cycle_count
     FROM cc_cycles cy
     WHERE card_id = $1 AND user_id = $2 AND status != 'open'
     GROUP BY year
     ORDER BY year DESC`,
    [cardId, userId]
  );
  return result.rows.map((row) => ({ ...row, total_amount: num(row.total_amount), total_discount: num(row.total_discount), net_payable: num(row.net_payable), txn_count: Number(row.txn_count || 0), cycle_count: Number(row.cycle_count || 0) }));
}

async function getCcAvailableYears(userId, cardId) {
  const result = await query(
    `SELECT DISTINCT to_char(cycle_end, 'YYYY') AS year
     FROM cc_cycles
     WHERE card_id = $1 AND user_id = $2 AND status != 'open'
     ORDER BY year DESC`,
    [cardId, userId]
  );
  return result.rows.map((row) => parseInt(row.year, 10));
}

async function updateCcTxn(userId, id, txn) {
  const existingR = await query('SELECT * FROM cc_txns WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
  const existing = existingR.rows[0];
  if (!existing) throw new Error('Transaction not found');
  const discPct = txn.discount_pct != null ? parseFloat(txn.discount_pct) : num(existing.discount_pct);
  const amount = txn.amount != null ? parseFloat(txn.amount) : num(existing.amount);
  const discAmt = Math.round(amount * discPct / 100 * 100) / 100;
  const netAmt = Math.round(amount * 100) / 100;
  await query(
    `UPDATE cc_txns
     SET txn_date = $1, description = $2, amount = $3, discount_pct = $4, discount_amount = $5, net_amount = $6
     WHERE id = $7 AND user_id = $8`,
    [txn.txn_date || existing.txn_date, txn.description || existing.description, amount, discPct, discAmt, netAmt, id, userId]
  );
  if (existing.cycle_id) await updateCycleTotals(existing.cycle_id);
}

async function deleteCcTxn(userId, id) {
  const txnR = await query('SELECT * FROM cc_txns WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
  const txn = txnR.rows[0];
  if (!txn) return;
  await query('DELETE FROM cc_txns WHERE id = $1 AND user_id = $2', [id, userId]);
  if (txn.cycle_id) await updateCycleTotals(txn.cycle_id);
}

async function addCcTxnToCycle(userId, cycleId, txn) {
  return withTransaction(async (client) => {
    const cycleR = await client.query('SELECT * FROM cc_cycles WHERE id = $1 AND user_id = $2 LIMIT 1', [cycleId, userId]);
    const cycle = cycleR.rows[0];
    if (!cycle) throw new Error('Cycle not found');
    const cardR = await client.query('SELECT * FROM credit_cards WHERE id = $1 LIMIT 1', [cycle.card_id]);
    const card = cardR.rows[0];
    const discPct = txn.discount_pct != null ? parseFloat(txn.discount_pct) : num(card?.default_discount_pct);
    const amount = parseFloat(txn.amount);
    const discAmt = Math.round(amount * discPct / 100 * 100) / 100;
    const netAmt = Math.round(amount * 100) / 100;
    const result = await client.query(
      `INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [userId, cycle.card_id, cycleId, txn.txn_date, txn.description, amount, discPct, discAmt, netAmt, txn.source || 'manual', txn.source_id || null]
    );
    await updateCycleTotals(cycleId, client);
    return Number(result.rows[0].id);
  });
}

async function bulkAddCcTxnsToCycle(userId, cycleId, txns, discountPct = null) {
  return withTransaction(async (client) => {
    const cycleR = await client.query('SELECT * FROM cc_cycles WHERE id = $1 AND user_id = $2 LIMIT 1', [cycleId, userId]);
    const cycle = cycleR.rows[0];
    if (!cycle) throw new Error('Cycle not found');
    const cardR = await client.query('SELECT * FROM credit_cards WHERE id = $1 LIMIT 1', [cycle.card_id]);
    const card = cardR.rows[0];
    let count = 0;
    for (const txn of txns || []) {
      const description = String(txn.description || '').trim();
      const amount = parseFloat(txn.amount) || 0;
      const txnDate = txn.txn_date;
      if (!description || amount <= 0 || !txnDate) continue;
      if (txnDate < cycle.cycle_start || txnDate > cycle.cycle_end) {
        throw new Error(`Transaction date ${txnDate} is outside cycle ${cycle.cycle_start} to ${cycle.cycle_end}`);
      }
      const nextDiscount = discountPct != null
        ? parseFloat(discountPct)
        : (txn.discount_pct != null ? parseFloat(txn.discount_pct) : num(card?.default_discount_pct));
      const discAmt = Math.round(amount * nextDiscount / 100 * 100) / 100;
      const netAmt = Math.round(amount * 100) / 100;
      await client.query(
        `INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',NULL)`,
        [userId, cycle.card_id, cycleId, txnDate, description, amount, nextDiscount, discAmt, netAmt]
      );
      count++;
    }
    await updateCycleTotals(cycleId, client);
    return count;
  });
}

async function deleteCcCycle(userId, cycleId) {
  await withTransaction(async (client) => {
    const cycleR = await client.query('SELECT * FROM cc_cycles WHERE id = $1 AND user_id = $2 LIMIT 1', [cycleId, userId]);
    if (!cycleR.rows[0]) return;
    await client.query('DELETE FROM cc_txns WHERE cycle_id = $1 AND user_id = $2', [cycleId, userId]);
    await client.query('DELETE FROM cc_cycles WHERE id = $1 AND user_id = $2', [cycleId, userId]);
  });
}

async function updateCcCycle(userId, cycleId, data) {
  const cycleR = await query('SELECT * FROM cc_cycles WHERE id = $1 AND user_id = $2 LIMIT 1', [cycleId, userId]);
  const cycle = cycleR.rows[0];
  if (!cycle) throw new Error('Cycle not found');
  const fields = [];
  const params = [];
  let totalAmount = null;
  if (data.cycle_start) { fields.push(`cycle_start = $${fields.length + 1}`); params.push(data.cycle_start); }
  if (data.cycle_end) { fields.push(`cycle_end = $${fields.length + 1}`); params.push(data.cycle_end); }
  if (data.due_date) { fields.push(`due_date = $${fields.length + 1}`); params.push(data.due_date); }
  if (data.total_amount !== undefined && data.total_amount !== null && data.total_amount !== '') {
    totalAmount = Math.max(0, parseFloat(data.total_amount) || 0);
    fields.push(`total_amount = $${fields.length + 1}`); params.push(totalAmount);
    fields.push(`net_payable = $${fields.length + 1}`); params.push(totalAmount);
    fields.push(`manual_total_override = $${fields.length + 1}`); params.push(true);
  }
  if (data.status) {
    const nextStatus = String(data.status);
    const nextNet = totalAmount !== null ? totalAmount : num(cycle.net_payable);
    if (nextStatus === 'paid') {
      fields.push(`status = $${fields.length + 1}`); params.push('paid');
      fields.push(`paid_amount = $${fields.length + 1}`); params.push(nextNet);
      fields.push(`paid_date = $${fields.length + 1}`); params.push(data.paid_date || cycle.paid_date || _localDate(new Date()));
      fields.push(`closed_at = NOW()`);
    } else if (nextStatus === 'billed') {
      fields.push(`status = $${fields.length + 1}`); params.push('billed');
      fields.push(`paid_amount = $${fields.length + 1}`); params.push(0);
      fields.push(`paid_date = $${fields.length + 1}`); params.push(null);
      fields.push(`closed_at = COALESCE(closed_at, NOW())`);
    } else if (nextStatus === 'open') {
      fields.push(`status = $${fields.length + 1}`); params.push('open');
      fields.push(`paid_amount = $${fields.length + 1}`); params.push(0);
      fields.push(`paid_date = $${fields.length + 1}`); params.push(null);
      fields.push(`closed_at = NULL`);
    }
  }
  if (!fields.length) return;
  params.push(cycleId, userId);
  await query(`UPDATE cc_cycles SET ${fields.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length}`, params);
}

async function closeCcCycle(userId, cycleId, paidAmount, paidDate, bankAccountId = null) {
  await withTransaction(async (client) => {
    const cycleR = await client.query('SELECT * FROM cc_cycles WHERE id = $1 AND user_id = $2 LIMIT 1', [cycleId, userId]);
    const cycle = cycleR.rows[0];
    if (!cycle) throw new Error('Cycle not found');
    const paid = parseFloat(paidAmount) || 0;
    const previousPaid = num(cycle.paid_amount);
    const status = paid >= num(cycle.net_payable) - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'billed';
    await client.query(
      `UPDATE cc_cycles
       SET status = $1, paid_amount = $2, paid_date = $3, closed_at = NOW()
       WHERE id = $4`,
      [status, paid, paidDate || null, cycleId]
    );
    const diff = paid - previousPaid;
    const targetBankId = normalizeBankAccountId(bankAccountId) || await getDefaultBankAccountId(userId, client);
    if (diff !== 0 && targetBankId) {
      await adjustBankBalance(userId, targetBankId, -diff, client);
    }
    await getOrCreateCurrentCycle(cycle.card_id, userId, client);
  });
}

async function importHistoricalCycles(userId, cardId, rows) {
  return withTransaction(async (client) => {
    const cardR = await client.query('SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 LIMIT 1', [cardId, userId]);
    const card = cardR.rows[0];
    if (!card) throw new Error('Card not found');
    let count = 0;
    for (const row of rows || []) {
      if (!row.amount || row.amount <= 0) continue;
      const y = parseInt(row.year, 10);
      const m = parseInt(row.month, 10);
      const cycleStart = _localDate(new Date(y, m - 2, Number(card.bill_gen_day) + 1));
      const cycleEnd = _localDate(new Date(y, m - 1, Number(card.bill_gen_day)));
      const dueDate = _localDate(new Date(y, m - 1, Number(card.bill_gen_day) + Number(card.due_days || 20)));
      const existsR = await client.query(
        `SELECT id
         FROM cc_cycles
         WHERE card_id = $1 AND user_id = $2 AND cycle_start = $3 AND cycle_end = $4
         LIMIT 1`,
        [cardId, userId, cycleStart, cycleEnd]
      );
      if (existsR.rows[0]) continue;
      const paidDate = row.paid_date || dueDate;
      await client.query(
        `INSERT INTO cc_cycles (
           user_id, card_id, cycle_start, cycle_end, due_date, total_amount, total_discount, net_payable,
           paid_amount, paid_date, status, manual_total_override, closed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,0,$6,$6,$7,'closed',TRUE,$7)`,
        [userId, cardId, cycleStart, cycleEnd, dueDate, row.amount, paidDate]
      );
      count++;
    }
    return count;
  });
}

async function getCcDuesForMonth(userId, month, cardId = null) {
  const params = cardId ? [userId, month, cardId] : [userId, month];
  const result = await query(
    `SELECT cy.*, cc.card_name, cc.bank_name, cc.last4,
            (SELECT COUNT(*)::int FROM cc_txns t WHERE t.cycle_id = cy.id) AS txn_count
     FROM cc_cycles cy
     JOIN credit_cards cc ON cc.id = cy.card_id
     WHERE cy.user_id = $1
       AND to_char(cy.due_date, 'YYYY-MM') = $2
       AND cy.status IN ('open', 'billed', 'partial')${cardId ? ' AND cy.card_id = $3' : ''}
     ORDER BY cy.due_date ASC`,
    params
  );
  return result.rows.map((row) => ({
    ...row,
    card_id: Number(row.card_id),
    net_payable: num(row.net_payable),
    paid_amount: num(row.paid_amount),
    total_amount: num(row.total_amount),
    total_discount: num(row.total_discount),
    txn_count: Number(row.txn_count || 0),
  }));
}

module.exports = {
  addCreditCard,
  updateCreditCard,
  deleteCreditCard,
  getCreditCards,
  addCcTxn,
  getCcCurrentCycle,
  getCcCycles,
  getCcMonthlySummary,
  getCcYearlySummary,
  getCcAvailableYears,
  updateCcTxn,
  deleteCcTxn,
  addCcTxnToCycle,
  bulkAddCcTxnsToCycle,
  deleteCcCycle,
  updateCcCycle,
  closeCcCycle,
  importHistoricalCycles,
  getCcDuesForMonth,
};
