const { query, withTransaction } = require('./postgres');

function num(value) {
  return Number(value || 0);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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

function _parseDateInput(value, label = 'Date') {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return new Date(value.getTime());
    throw validationError(`${label} is invalid`);
  }
  const raw = String(value || '').trim();
  if (!raw) throw validationError(`${label} is required`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const dmy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmy) {
    return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  throw validationError(`${label} is invalid`);
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

function getCcCyclePeriodForDate(billGenDay, refDate) {
  const date = _parseDateInput(refDate, 'Transaction date');
  const day = date.getDate();
  const y = date.getFullYear();
  const m = date.getMonth();
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

function getCcDueDate(cycleEnd, dueDays) {
  const dueDate = _parseDateInput(cycleEnd, 'Cycle end date');
  dueDate.setDate(dueDate.getDate() + Number(dueDays || 20));
  return _localDate(dueDate);
}

function normalizeCcDateValue(value, label = 'Date') {
  return _localDate(_parseDateInput(value, label));
}

function normalizeCcDateValueOrEmpty(value, label = 'Date') {
  if (value == null || value === '') return '';
  return normalizeCcDateValue(value, label);
}

function getNextCcCyclePeriod(period, billGenDay) {
  const nextDate = _parseDateInput(period.cycleEnd, 'Cycle end date');
  nextDate.setDate(nextDate.getDate() + 1);
  return getCcCyclePeriodForDate(billGenDay, nextDate);
}

function addDaysToIsoDate(value, days) {
  const date = _parseDateInput(value, 'Date');
  date.setDate(date.getDate() + Number(days || 0));
  return _localDate(date);
}

async function lockCyclePeriod(run, userId, cardId, cycleStart, cycleEnd) {
  await run.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [`cc_cycle:${userId}:${cardId}`, `${cycleStart}:${cycleEnd}`]
  );
}

async function findExactCycle(run, cardId, userId, cycleStart, cycleEnd, excludeId = null) {
  const existingR = await run.query(
    `SELECT *
     FROM cc_cycles
     WHERE card_id = $1 AND user_id = $2 AND cycle_start = $3 AND cycle_end = $4
       ${excludeId ? 'AND id != $5' : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    excludeId
      ? [cardId, userId, cycleStart, cycleEnd, excludeId]
      : [cardId, userId, cycleStart, cycleEnd]
  );
  return existingR.rows[0] || null;
}

async function mergeCycleInto(run, userId, sourceCycleId, targetCycleId) {
  const sourceId = Number(sourceCycleId);
  const targetId = Number(targetCycleId);
  if (!(sourceId > 0) || !(targetId > 0) || sourceId === targetId) return targetId;

  await run.query(
    `UPDATE cc_txns
     SET cycle_id = $1
     WHERE user_id = $2
       AND cycle_id = $3`,
    [targetId, userId, sourceId]
  );
  await run.query(
    `DELETE FROM cc_cycles
     WHERE id = $1
       AND user_id = $2`,
    [sourceId, userId]
  );
  await updateCycleTotals(targetId, run);
  return targetId;
}

async function collapseOverlappingHistoricalCycles(userId, cardId, card, client) {
  const historyR = await client.query(
    `SELECT *
     FROM cc_cycles
     WHERE user_id = $1
       AND card_id = $2
       AND status != 'open'
     ORDER BY cycle_start ASC, cycle_end ASC, created_at ASC, id ASC`,
    [userId, cardId]
  );
  const cycles = historyR.rows;
  if (cycles.length < 2) return;

  let anchor = null;
  let anchorStart = '';
  let anchorEnd = '';
  const mergeIds = [];

  const flushCluster = async () => {
    if (!anchor) return;
    if (mergeIds.length) {
      await client.query(
        `UPDATE cc_cycles
         SET cycle_start = $1,
             cycle_end = $2,
             due_date = $3
         WHERE id = $4
           AND user_id = $5`,
        [anchorStart, anchorEnd, getCcDueDate(anchorEnd, card.due_days || 20), anchor.id, userId]
      );
      for (const cycleId of mergeIds) {
        await mergeCycleInto(client, userId, cycleId, anchor.id);
      }
      await updateCycleTotals(anchor.id, client);
    }
    anchor = null;
    anchorStart = '';
    anchorEnd = '';
    mergeIds.length = 0;
  };

  for (const cycle of cycles) {
    if (!anchor) {
      anchor = cycle;
      anchorStart = normalizeCcDateValueOrEmpty(cycle.cycle_start, 'Cycle start');
      anchorEnd = normalizeCcDateValueOrEmpty(cycle.cycle_end, 'Cycle end');
      continue;
    }
    const cycleStart = normalizeCcDateValueOrEmpty(cycle.cycle_start, 'Cycle start');
    const cycleEnd = normalizeCcDateValueOrEmpty(cycle.cycle_end, 'Cycle end');
    const overlaps = cycleStart <= String(anchorEnd || '');
    if (overlaps) {
      if (cycleStart < anchorStart) anchorStart = cycleStart;
      if (cycleEnd > anchorEnd) anchorEnd = cycleEnd;
      mergeIds.push(Number(cycle.id));
      continue;
    }
    await flushCluster();
    anchor = cycle;
    anchorStart = normalizeCcDateValueOrEmpty(cycle.cycle_start, 'Cycle start');
    anchorEnd = normalizeCcDateValueOrEmpty(cycle.cycle_end, 'Cycle end');
  }

  await flushCluster();
}

async function getOrCreateCycleForPeriod(cardId, userId, cycleStart, cycleEnd, dueDays, client = null) {
  const run = client || { query };
  await lockCyclePeriod(run, userId, cardId, cycleStart, cycleEnd);
  const existing = await findExactCycle(run, cardId, userId, cycleStart, cycleEnd);
  if (existing) return existing;
  const today = _localDate(new Date());
  const status = cycleEnd < today ? 'billed' : 'open';
  const insertR = await run.query(
    `INSERT INTO cc_cycles (user_id, card_id, cycle_start, cycle_end, due_date, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, cardId, cycleStart, cycleEnd, getCcDueDate(cycleEnd, dueDays), status]
  );
  return insertR.rows[0];
}

async function rebalanceOpenCycleForCard(userId, cardId, card, client) {
  const today = _localDate(new Date());
  const expectedCurrent = getCcCyclePeriod(card.bill_gen_day || 1);
  const expectedCurrentStart = normalizeCcDateValue(expectedCurrent.cycleStart, 'Cycle start');
  const expectedCurrentEnd = normalizeCcDateValue(expectedCurrent.cycleEnd, 'Cycle end');
  const cyclesR = await client.query(
    `SELECT *
     FROM cc_cycles
     WHERE card_id = $1
       AND user_id = $2
     ORDER BY cycle_start ASC, created_at ASC, id ASC`,
    [cardId, userId]
  );
  const cycles = cyclesR.rows;
  const openCycles = cycles.filter((cycle) => String(cycle.status) === 'open');
  const historicalCycles = cycles.filter((cycle) => String(cycle.status) !== 'open');

  const historicalSeed = [...historicalCycles]
    .filter((cycle) => normalizeCcDateValue(cycle.cycle_end, 'Cycle end') < expectedCurrentStart)
    .sort((a, b) => normalizeCcDateValue(b.cycle_end, 'Cycle end').localeCompare(normalizeCcDateValue(a.cycle_end, 'Cycle end')) || normalizeCcDateValue(a.cycle_start, 'Cycle start').localeCompare(normalizeCcDateValue(b.cycle_start, 'Cycle start')) || Number(a.id || 0) - Number(b.id || 0))[0] || null;

  let primaryHistorical = null;
  let targetHistoricalStart = '';
  let targetHistoricalEnd = '';
  if (historicalSeed) {
    const clusterFloor = addDaysToIsoDate(historicalSeed.cycle_end, -35);
    const overlappingHistorical = historicalCycles
      .filter((cycle) => normalizeCcDateValue(cycle.cycle_end, 'Cycle end') >= clusterFloor)
      .filter((cycle) => normalizeCcDateValue(cycle.cycle_start, 'Cycle start') <= normalizeCcDateValue(historicalSeed.cycle_end, 'Cycle end'))
      .filter((cycle) => normalizeCcDateValue(cycle.cycle_end, 'Cycle end') < expectedCurrentStart)
      .sort((a, b) => normalizeCcDateValue(a.cycle_start, 'Cycle start').localeCompare(normalizeCcDateValue(b.cycle_start, 'Cycle start')) || Number(a.id || 0) - Number(b.id || 0));

    primaryHistorical = overlappingHistorical[0] || historicalSeed;
    targetHistoricalStart = overlappingHistorical.reduce(
      (minValue, cycle) => {
        const cycleStart = normalizeCcDateValue(cycle.cycle_start, 'Cycle start');
        return (!minValue || cycleStart < minValue) ? cycleStart : minValue;
      },
      normalizeCcDateValueOrEmpty(primaryHistorical.cycle_start, 'Cycle start')
    );
    targetHistoricalEnd = overlappingHistorical.reduce(
      (maxValue, cycle) => {
        const cycleEnd = normalizeCcDateValue(cycle.cycle_end, 'Cycle end');
        return (!maxValue || cycleEnd > maxValue) ? cycleEnd : maxValue;
      },
      normalizeCcDateValueOrEmpty(primaryHistorical.cycle_end, 'Cycle end')
    );
    if (
      normalizeCcDateValue(primaryHistorical.cycle_start, 'Cycle start') !== targetHistoricalStart
      || normalizeCcDateValue(primaryHistorical.cycle_end, 'Cycle end') !== targetHistoricalEnd
      || normalizeCcDateValue(primaryHistorical.due_date, 'Due date') !== getCcDueDate(targetHistoricalEnd, card.due_days || 20)
    ) {
      await client.query(
        `UPDATE cc_cycles
         SET cycle_start = $1,
             cycle_end = $2,
             due_date = $3
         WHERE id = $4
           AND user_id = $5`,
        [targetHistoricalStart, targetHistoricalEnd, getCcDueDate(targetHistoricalEnd, card.due_days || 20), primaryHistorical.id, userId]
      );
    }
    for (const cycle of overlappingHistorical) {
      if (Number(cycle.id) === Number(primaryHistorical.id)) continue;
      await mergeCycleInto(client, userId, cycle.id, primaryHistorical.id);
    }
    const refreshedPrimaryR = await client.query('SELECT * FROM cc_cycles WHERE id = $1 AND user_id = $2 LIMIT 1', [primaryHistorical.id, userId]);
    primaryHistorical = refreshedPrimaryR.rows[0] || primaryHistorical;
  }

  const desiredCurrentStart = primaryHistorical?.cycle_end ? addDaysToIsoDate(normalizeCcDateValue(primaryHistorical.cycle_end, 'Cycle end'), 1) : expectedCurrentStart;
  const desiredCurrentPeriod = getCcCyclePeriodForDate(card.bill_gen_day || 1, desiredCurrentStart);
  const desiredCurrentEnd = normalizeCcDateValue(desiredCurrentPeriod.cycleEnd, 'Cycle end');

  let activeCycle = openCycles.find((cycle) => normalizeCcDateValue(cycle.cycle_start, 'Cycle start') === desiredCurrentStart && normalizeCcDateValue(cycle.cycle_end, 'Cycle end') === desiredCurrentEnd) || null;
  if (!activeCycle) {
    activeCycle = openCycles.find((cycle) => normalizeCcDateValue(cycle.cycle_start, 'Cycle start') <= today && normalizeCcDateValue(cycle.cycle_end, 'Cycle end') >= today) || null;
  }
  if (!activeCycle && openCycles.length) {
    activeCycle = [...openCycles]
      .sort((a, b) => normalizeCcDateValue(a.cycle_start, 'Cycle start').localeCompare(normalizeCcDateValue(b.cycle_start, 'Cycle start')) || Number(a.id || 0) - Number(b.id || 0))[0];
  }
  if (!activeCycle) {
    activeCycle = await getOrCreateCycleForPeriod(
      cardId,
      userId,
      desiredCurrentStart,
      desiredCurrentEnd,
      card.due_days || 20,
      client
    );
  }
  if (!activeCycle) return;

  const activeExactConflict = await findExactCycle(
    client,
    cardId,
    userId,
    desiredCurrentStart,
    desiredCurrentEnd,
    activeCycle.id
  );
  if (activeExactConflict) {
    activeCycle = await mergeCycleInto(client, userId, activeCycle.id, activeExactConflict.id);
  }

  await client.query(
    `UPDATE cc_cycles
     SET cycle_start = $1,
         cycle_end = $2,
         due_date = $3,
         status = 'open',
         closed_at = NULL
     WHERE id = $4
       AND user_id = $5`,
    [desiredCurrentStart, desiredCurrentEnd, getCcDueDate(desiredCurrentEnd, card.due_days || 20), activeCycle.id, userId]
  );

  if (primaryHistorical) {
    await client.query(
      `UPDATE cc_txns
       SET cycle_id = $1
       WHERE user_id = $2
         AND card_id = $3
         AND cycle_id = $4
         AND txn_date >= $5
         AND txn_date <= $6`,
      [primaryHistorical.id, userId, cardId, activeCycle.id, normalizeCcDateValue(primaryHistorical.cycle_start, 'Cycle start'), normalizeCcDateValue(primaryHistorical.cycle_end, 'Cycle end')]
    );
    await client.query(
      `UPDATE cc_txns
       SET cycle_id = $1
       WHERE user_id = $2
         AND card_id = $3
         AND cycle_id = $4
         AND txn_date >= $5
         AND txn_date <= $6`,
      [activeCycle.id, userId, cardId, primaryHistorical.id, desiredCurrentStart, desiredCurrentEnd]
    );
  }

  for (const cycle of openCycles) {
    if (Number(cycle.id) === Number(activeCycle.id)) continue;
    if (primaryHistorical) {
      await client.query(
        `UPDATE cc_txns
         SET cycle_id = $1
         WHERE user_id = $2
           AND card_id = $3
           AND cycle_id = $4
           AND txn_date >= $5
           AND txn_date <= $6`,
        [primaryHistorical.id, userId, cardId, cycle.id, normalizeCcDateValue(primaryHistorical.cycle_start, 'Cycle start'), normalizeCcDateValue(primaryHistorical.cycle_end, 'Cycle end')]
      );
    }
    await client.query(
      `UPDATE cc_txns
       SET cycle_id = $1
       WHERE user_id = $2
         AND card_id = $3
         AND cycle_id = $4
         AND txn_date >= $5
         AND txn_date <= $6`,
      [activeCycle.id, userId, cardId, cycle.id, desiredCurrentStart, desiredCurrentEnd]
    );
    const txnCountR = await client.query(
      `SELECT COUNT(*)::int AS txn_count
       FROM cc_txns
       WHERE user_id = $1
         AND cycle_id = $2`,
      [userId, cycle.id]
    );
    if (Number(txnCountR.rows[0]?.txn_count || 0) === 0) {
      await client.query(
        `DELETE FROM cc_cycles
         WHERE id = $1
           AND user_id = $2`,
        [cycle.id, userId]
      );
    }
  }

  if (primaryHistorical?.id) await updateCycleTotals(primaryHistorical.id, client);
  await updateCycleTotals(activeCycle.id, client);
}

async function reconcileCycleTransactions(userId, cycle, card, client = null) {
  const run = client || { query };
  if (!cycle || !card) return { cycle, affectedCycleIds: [] };
  const txnsR = await run.query(
    `SELECT *
     FROM cc_txns
     WHERE cycle_id = $1 AND user_id = $2
     ORDER BY txn_date ASC, id ASC`,
    [cycle.id, userId]
  );
  const affectedCycleIds = new Set([Number(cycle.id)]);
  for (const txn of txnsR.rows) {
    const txnDate = normalizeCcDateValue(txn.txn_date, 'Transaction date');
    if (txnDate >= cycle.cycle_start && txnDate <= cycle.cycle_end) continue;
    const targetPeriod = getCcCyclePeriodForDate(card.bill_gen_day || 1, txnDate);
    const targetCycle = await getOrCreateCycleForPeriod(
      card.id,
      userId,
      targetPeriod.cycleStart,
      targetPeriod.cycleEnd,
      card.due_days || 20,
      client
    );
    if (Number(targetCycle.id) === Number(cycle.id)) continue;
    await run.query(
      `UPDATE cc_txns
       SET cycle_id = $1
       WHERE id = $2 AND user_id = $3`,
      [targetCycle.id, txn.id, userId]
    );
    affectedCycleIds.add(Number(targetCycle.id));
  }
  for (const cycleId of affectedCycleIds) {
    await updateCycleTotals(cycleId, client);
  }
  const refreshedCycleR = await run.query('SELECT * FROM cc_cycles WHERE id = $1 AND user_id = $2 LIMIT 1', [cycle.id, userId]);
  return { cycle: refreshedCycleR.rows[0] || cycle, affectedCycleIds: Array.from(affectedCycleIds) };
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
  return getOrCreateCycleForPeriod(cardId, userId, cycleStart, cycleEnd, card.due_days || 20, client);
}

async function getCurrentCycleSnapshot(cardId, userId, card, client = null) {
  const run = client || { query };
  if (!card) return null;
  const { cycleStart, cycleEnd } = getCcCyclePeriod(card.bill_gen_day || 1);
  const exactR = await run.query(
    `SELECT *
     FROM cc_cycles
     WHERE card_id = $1
       AND user_id = $2
       AND cycle_start = $3
       AND cycle_end = $4
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [cardId, userId, cycleStart, cycleEnd]
  );
  if (exactR.rows[0]) return exactR.rows[0];

  const today = _localDate(new Date());
  const fallbackR = await run.query(
    `SELECT *
     FROM cc_cycles
     WHERE card_id = $1
       AND user_id = $2
       AND status = 'open'
       AND cycle_start <= $3
       AND cycle_end >= $4
     ORDER BY cycle_start DESC, created_at DESC, id DESC
     LIMIT 1`,
    [cardId, userId, today, today]
  );
  return fallbackR.rows[0] || null;
}

async function updateCycleTotals(cycleId, client = null) {
  const run = client || { query };
  const cycleR = await run.query('SELECT manual_total_override, status FROM cc_cycles WHERE id = $1 LIMIT 1', [cycleId]);
  const cycle = cycleR.rows[0];
  if (!cycle) return;
  if (cycle.manual_total_override && cycle.status !== 'open') return;
  const totalsR = await run.query(
    `SELECT
       COUNT(*)::int AS txn_count,
       COALESCE(SUM(amount), 0) AS total_amount,
       COALESCE(SUM(discount_amount), 0) AS total_discount,
       COALESCE(SUM(amount), 0) AS net_payable
     FROM cc_txns
     WHERE cycle_id = $1`,
    [cycleId]
  );
  const totals = totalsR.rows[0];
  await run.query(
    `UPDATE cc_cycles
     SET total_amount = $1, total_discount = $2, net_payable = $3
     WHERE id = $4`,
    [totals?.total_amount || 0, totals?.total_discount || 0, totals?.net_payable || 0, cycleId]
  );
}

async function autoClosePastCcCycles(userId, cardId = null, client = null) {
  const run = client || { query };
  const today = _localDate(new Date());
  const params = cardId ? [userId, today, cardId] : [userId, today];
  const result = await run.query(
    `SELECT id, net_payable, paid_amount, paid_date
     FROM cc_cycles
     WHERE user_id = $1 AND status = 'open' AND cycle_end < $2${cardId ? ' AND card_id = $3' : ''}`,
    params
  );
  for (const cycle of result.rows) {
    const paid = num(cycle.paid_amount);
    const due = num(cycle.total_amount || cycle.net_payable);
    const status = paid >= due - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'billed';
    await run.query(
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
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE credit_cards
        SET bank_name = $1, card_name = $2, last4 = $3, expiry_month = $4, expiry_year = $5,
            bill_gen_day = $6, due_days = $7, default_discount_pct = $8, credit_limit = $9
        WHERE id = $10 AND user_id = $11`,
      [bankName, cardName, last4, card.expiry_month || null, card.expiry_year || null, card.bill_gen_day || 1, card.due_days || 20, card.default_discount_pct || 0, card.credit_limit || 0, id, userId]
    );
    const updatedCardR = await client.query(
      'SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 LIMIT 1',
      [id, userId]
    );
    const updatedCard = updatedCardR.rows[0] || { ...card, id: Number(id) || id };
    await rebalanceOpenCycleForCard(userId, id, updatedCard, client);
  });
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
    const { cycle, totals } = await withTransaction(async (client) => {
      const cycle = await getCurrentCycleSnapshot(card.id, userId, card, client);
      const totalsR = await client.query(
          `SELECT COALESCE(SUM(amount),0) AS total_spent, COALESCE(SUM(amount),0) AS total_net, COUNT(*)::int AS txn_count
           FROM cc_txns
           WHERE card_id = $1 AND user_id = $2`,
          [card.id, userId]
      );
      return { cycle: cycle || null, totals: totalsR.rows[0] || {} };
    });
    cards.push({
      ...card,
      credit_limit: num(card.credit_limit),
      default_discount_pct: num(card.default_discount_pct),
      currentCycle: cycle,
      totalSpent: num(totals?.total_spent),
      totalNet: num(totals?.total_net),
      totalTxns: Number(totals?.txn_count || 0),
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
    const discAmt = roundMoney(amount * discPct / 100);
    const netAmt = roundMoney(amount);
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
  return withTransaction(async (client) => {
    await autoClosePastCcCycles(userId, cardId);
    const cardR = await client.query('SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 LIMIT 1', [cardId, userId]);
    const card = cardR.rows[0];
    if (!card) return null;
    let cycle = await getCurrentCycleSnapshot(cardId, userId, card, client);
    if (!cycle) return { card, cycle: null, txns: [] };
    if (cycle.status === 'open') {
      await updateCycleTotals(cycle.id, client);
      const refreshedCycleR = await client.query('SELECT * FROM cc_cycles WHERE id = $1 LIMIT 1', [cycle.id]);
      cycle = refreshedCycleR.rows[0] || cycle;
    }
    const txnsR = await client.query('SELECT * FROM cc_txns WHERE cycle_id = $1 ORDER BY txn_date ASC, id ASC', [cycle.id]);
    return {
      card,
      cycle: cycle ? { ...cycle, net_payable: num(cycle.total_amount || cycle.net_payable) } : cycle,
      txns: txnsR.rows.map((row) => ({ ...row, amount: num(row.amount), discount_pct: num(row.discount_pct), discount_amount: num(row.discount_amount), net_amount: num(row.amount) })),
    };
  });
}

async function getCcCycles(userId, cardId) {
  return withTransaction(async (client) => {
    await autoClosePastCcCycles(userId, cardId);
    const cardR = await client.query('SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 LIMIT 1', [cardId, userId]);
    if (!cardR.rows[0]) return [];
    const cyclesR = await client.query('SELECT * FROM cc_cycles WHERE card_id = $1 AND user_id = $2 ORDER BY cycle_start DESC, created_at DESC, id DESC', [cardId, userId]);
    const cycles = [];
    for (let cycle of cyclesR.rows) {
      if (cycle.status === 'open') {
        await updateCycleTotals(cycle.id, client);
        const refreshedCycleR = await client.query('SELECT * FROM cc_cycles WHERE id = $1 LIMIT 1', [cycle.id]);
        cycle = refreshedCycleR.rows[0] || cycle;
      }
      const txnsR = await client.query('SELECT * FROM cc_txns WHERE cycle_id = $1 ORDER BY txn_date ASC', [cycle.id]);
      cycles.push({
        ...cycle,
        total_amount: num(cycle.total_amount),
        total_discount: num(cycle.total_discount),
        net_payable: num(cycle.total_amount || cycle.net_payable),
        paid_amount: num(cycle.paid_amount),
        txns: txnsR.rows.map((row) => ({ ...row, amount: num(row.amount), discount_pct: num(row.discount_pct), discount_amount: num(row.discount_amount), net_amount: num(row.amount) })),
      });
    }
    return cycles;
  });
}

async function getCcCycleById(userId, cycleId) {
  return withTransaction(async (client) => {
    const cycleR = await client.query(
      'SELECT * FROM cc_cycles WHERE id = $1 AND user_id = $2 LIMIT 1',
      [cycleId, userId]
    );
    let cycle = cycleR.rows[0];
    if (!cycle) return null;
    const cardR = await client.query(
      'SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 LIMIT 1',
      [cycle.card_id, userId]
    );
    const card = cardR.rows[0] || null;
    if (cycle.status === 'open') {
      await updateCycleTotals(cycle.id, client);
      const refreshedCycleR = await client.query('SELECT * FROM cc_cycles WHERE id = $1 LIMIT 1', [cycle.id]);
      cycle = refreshedCycleR.rows[0] || cycle;
    }
    const txnsR = await client.query(
      'SELECT * FROM cc_txns WHERE cycle_id = $1 ORDER BY txn_date ASC, id ASC',
      [cycle.id]
    );
    return {
      card,
      cycle: {
        ...cycle,
        total_amount: num(cycle.total_amount),
        total_discount: num(cycle.total_discount),
        net_payable: num(cycle.total_amount || cycle.net_payable),
        paid_amount: num(cycle.paid_amount),
      },
      txns: txnsR.rows.map((row) => ({
        ...row,
        amount: num(row.amount),
        discount_pct: num(row.discount_pct),
        discount_amount: num(row.discount_amount),
        net_amount: num(row.amount),
      })),
    };
  });
}

async function getCcMonthlySummary(userId, cardId, year) {
  const params = year ? [cardId, userId, String(year)] : [cardId, userId];
  const result = await query(
    `SELECT to_char(cycle_end, 'YYYY-MM') AS month,
            COALESCE(SUM(total_amount), 0) AS total_amount,
            COALESCE(SUM(total_discount), 0) AS total_discount,
            COALESCE(SUM(total_amount), 0) AS net_payable,
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
            COALESCE(SUM(total_amount), 0) AS net_payable,
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

async function repairCreditCardTxnCycles(userId, cardId = null) {
  return withTransaction(async (client) => {
    const params = cardId ? [userId, cardId] : [userId];
    const cardsR = await client.query(
      `SELECT *
       FROM credit_cards
       WHERE user_id = $1
         AND is_active = TRUE${cardId ? ' AND id = $2' : ''}
       ORDER BY id ASC`,
      params
    );
    const summary = [];

    for (const card of cardsR.rows) {
      const txnsR = await client.query(
        `SELECT id, cycle_id, txn_date
         FROM cc_txns
         WHERE user_id = $1
           AND card_id = $2
         ORDER BY txn_date ASC, id ASC`,
        [userId, card.id]
      );

      const affectedCycleIds = new Set();
      let movedCount = 0;

      for (const txn of txnsR.rows) {
        const txnDate = normalizeCcDateValue(txn.txn_date, 'Transaction date');
        const targetPeriod = getCcCyclePeriodForDate(card.bill_gen_day || 1, txnDate);
        const targetCycle = await getOrCreateCycleForPeriod(
          card.id,
          userId,
          targetPeriod.cycleStart,
          targetPeriod.cycleEnd,
          card.due_days || 20,
          client
        );
        if (!targetCycle) continue;

        const currentCycleId = Number(txn.cycle_id || 0);
        const targetCycleId = Number(targetCycle.id);
        affectedCycleIds.add(targetCycleId);
        if (currentCycleId > 0) affectedCycleIds.add(currentCycleId);
        if (currentCycleId === targetCycleId) continue;

        await client.query(
          `UPDATE cc_txns
           SET cycle_id = $1
           WHERE id = $2
             AND user_id = $3`,
          [targetCycleId, txn.id, userId]
        );
        movedCount += 1;
      }

      for (const cycleId of affectedCycleIds) {
        await updateCycleTotals(cycleId, client);
      }

      summary.push({
        card_id: Number(card.id),
        card_name: card.card_name,
        checked_count: txnsR.rows.length,
        moved_count: movedCount,
      });
    }

    return summary;
  });
}

async function repairCreditCardCycles(userId, cardId) {
  return withTransaction(async (client) => {
    const cardR = await client.query(
      `SELECT *
       FROM credit_cards
       WHERE id = $1
         AND user_id = $2
         AND is_active = TRUE
       LIMIT 1`,
      [cardId, userId]
    );
    const card = cardR.rows[0];
    if (!card) throw new Error('Card not found');
    await rebalanceOpenCycleForCard(userId, card.id, card, client);
    await collapseOverlappingHistoricalCycles(userId, card.id, card, client);
    await autoClosePastCcCycles(userId, card.id, client);
    const currentCycleR = await client.query(
      `SELECT *
       FROM cc_cycles
       WHERE card_id = $1
         AND user_id = $2
         AND status = 'open'
       ORDER BY cycle_start ASC, created_at ASC, id ASC`,
      [card.id, userId]
    );
    const cycleCountR = await client.query(
      `SELECT COUNT(*)::int AS cycle_count
       FROM cc_cycles
       WHERE card_id = $1
         AND user_id = $2`,
      [card.id, userId]
    );
    const currentCycle = currentCycleR.rows[0] || null;
    return {
      card_id: Number(card.id),
      card_name: card.card_name,
      current_cycle: currentCycle ? {
        id: Number(currentCycle.id),
        cycle_start: currentCycle.cycle_start,
        cycle_end: currentCycle.cycle_end,
        due_date: currentCycle.due_date,
        status: currentCycle.status,
      } : null,
      cycle_count: Number(cycleCountR.rows[0]?.cycle_count || 0),
    };
  });
}

async function updateCcTxn(userId, id, txn) {
  const existingR = await query('SELECT * FROM cc_txns WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
  const existing = existingR.rows[0];
  if (!existing) throw new Error('Transaction not found');
  const discPct = txn.discount_pct != null ? parseFloat(txn.discount_pct) : num(existing.discount_pct);
  const amount = txn.amount != null ? parseFloat(txn.amount) : num(existing.amount);
  const discAmt = roundMoney(amount * discPct / 100);
  const netAmt = roundMoney(amount);
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
    const discAmt = roundMoney(amount * discPct / 100);
    const netAmt = roundMoney(amount);
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
      const discAmt = roundMoney(amount * nextDiscount / 100);
      const netAmt = roundMoney(amount);
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
    const nextNet = totalAmount !== null ? totalAmount : num(cycle.total_amount || cycle.net_payable);
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
    const due = num(cycle.total_amount || cycle.net_payable);
    const status = paid >= due - 0.01 ? 'paid' : paid > 0 ? 'partial' : 'billed';
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
         ) VALUES ($1,$2,$3,$4,$5,$6,0,$6,$6,$7,'closed',TRUE,NOW())`,
        [userId, cardId, cycleStart, cycleEnd, dueDate, row.amount, paidDate]
      );
      count++;
    }
    return count;
  });
}

async function getCcTxnBySource(userId, source, sourceId) {
  const result = await query(
    `SELECT id, card_id, discount_pct FROM cc_txns WHERE user_id = $1 AND source = $2 AND source_id = $3 LIMIT 1`,
    [userId, source, sourceId]
  );
  return result.rows[0] || null;
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
    net_payable: num(row.total_amount || row.net_payable),
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
  getCcCycleById,
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
  getCcTxnBySource,
  repairCreditCardTxnCycles,
  repairCreditCardCycles,
};
