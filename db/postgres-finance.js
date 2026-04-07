const { query, withTransaction } = require('./postgres');
const pgOpsDb = require('./postgres-ops');

function num(value) {
  return Number(value || 0);
}

function _localDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeBankAccountId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOptionalText(value, maxLength = 80) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    const err = new Error(`Value must be ${maxLength} characters or fewer`);
    err.statusCode = 400;
    throw err;
  }
  return normalized;
}

async function getCcCycleForDate(cardId, userId, txnDate, client = null) {
  const run = client || { query };
  const existing = await run.query(
    `SELECT *
     FROM cc_cycles
     WHERE card_id = $1 AND user_id = $2 AND cycle_start <= $3 AND cycle_end >= $4
     LIMIT 1`,
    [cardId, userId, txnDate, txnDate]
  );
  if (existing.rows[0]) return existing.rows[0];

  const cardR = await run.query('SELECT * FROM credit_cards WHERE id = $1 AND user_id = $2 LIMIT 1', [cardId, userId]);
  const card = cardR.rows[0];
  if (!card) return null;

  const dt = new Date(`${txnDate}T00:00:00`);
  const billGenDay = Number(card.bill_gen_day || 1);
  let cycleStart;
  let cycleEnd;
  if (dt.getDate() <= billGenDay) {
    cycleStart = _localDate(new Date(dt.getFullYear(), dt.getMonth() - 1, billGenDay + 1));
    cycleEnd = _localDate(new Date(dt.getFullYear(), dt.getMonth(), billGenDay));
  } else {
    cycleStart = _localDate(new Date(dt.getFullYear(), dt.getMonth(), billGenDay + 1));
    cycleEnd = _localDate(new Date(dt.getFullYear(), dt.getMonth() + 1, billGenDay));
  }

  const check = await run.query(
    `SELECT *
     FROM cc_cycles
     WHERE card_id = $1 AND user_id = $2 AND cycle_start = $3 AND cycle_end = $4
     LIMIT 1`,
    [cardId, userId, cycleStart, cycleEnd]
  );
  if (check.rows[0]) return check.rows[0];

  const dueEnd = new Date(`${cycleEnd}T00:00:00`);
  dueEnd.setDate(dueEnd.getDate() + Number(card.due_days || 20));
  const inserted = await run.query(
    `INSERT INTO cc_cycles (user_id, card_id, cycle_start, cycle_end, due_date, status)
     VALUES ($1, $2, $3, $4, $5, 'open')
     RETURNING *`,
    [userId, cardId, cycleStart, cycleEnd, _localDate(dueEnd)]
  );
  return inserted.rows[0];
}

async function updateCycleTotals(cycleId, client = null) {
  const run = client || { query };
  const cycleR = await run.query('SELECT manual_total_override FROM cc_cycles WHERE id = $1 LIMIT 1', [cycleId]);
  if (cycleR.rows[0]?.manual_total_override) return;
  const totalsR = await run.query(
    `SELECT
       COALESCE(SUM(amount), 0) AS total_amount,
       COALESCE(SUM(discount_amount), 0) AS total_discount,
       COALESCE(SUM(net_amount), 0) AS net_payable
     FROM cc_txns
     WHERE cycle_id = $1`,
    [cycleId]
  );
  await run.query(
    `UPDATE cc_cycles
     SET total_amount = $1, total_discount = $2, net_payable = $3
     WHERE id = $4`,
    [totalsR.rows[0]?.total_amount || 0, totalsR.rows[0]?.total_discount || 0, totalsR.rows[0]?.net_payable || 0, cycleId]
  );
}

async function autoMarkPastInstallmentsPaid(emiId, client = null) {
  const run = client || { query };
  await run.query(
    `UPDATE emi_installments
     SET paid_amount = emi_amount, paid_date = due_date
     WHERE emi_id = $1
       AND due_date < CURRENT_DATE
       AND COALESCE(paid_amount, 0) = 0`,
    [emiId]
  );
}

async function syncEmiRecordTotals(emiId, newMonthlyEmi, client = null) {
  const run = client || { query };
  const totalsR = await run.query(
    `SELECT COALESCE(SUM(emi_amount), 0) AS grand_total
     FROM emi_installments
     WHERE emi_id = $1`,
    [emiId]
  );
  const grandTotal = Math.round(num(totalsR.rows[0]?.grand_total) * 100) / 100;
  if (newMonthlyEmi !== undefined) {
    await run.query(
      `UPDATE emi_records
       SET grand_total = $1, total_amount = $1, monthly_emi = $2
       WHERE id = $3`,
      [grandTotal, newMonthlyEmi, emiId]
    );
    return;
  }
  await run.query(
    `UPDATE emi_records
     SET grand_total = $1, total_amount = $1
     WHERE id = $2`,
    [grandTotal, emiId]
  );
}

function computeEmiLiveTotals(record, installments) {
  const today = _localDate(new Date());
  const paidCount = installments.filter((item) => num(item.paid_amount) >= num(item.emi_amount) * 0.999).length;
  const partialCount = installments.filter((item) => num(item.paid_amount) > 0 && num(item.paid_amount) < num(item.emi_amount) * 0.999).length;
  const totalPaid = Math.round(installments.reduce((sum, item) => sum + num(item.paid_amount), 0) * 100) / 100;
  const grandTotal = Math.round(installments.reduce((sum, item) => sum + num(item.emi_amount), 0) * 100) / 100;
  const remaining = Math.round((grandTotal - totalPaid) * 100) / 100;
  const unpaid = installments.filter((item) => num(item.paid_amount) === 0);
  const freq = {};
  unpaid.forEach((item) => {
    const key = String(num(item.emi_amount));
    freq[key] = (freq[key] || 0) + 1;
  });
  const monthlyEmi = unpaid.length > 0
    ? Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0])
    : (installments[0] ? num(installments[0].emi_amount) : num(record.monthly_emi));

  let status = record.status;
  if (installments.length > 0) {
    if (paidCount === installments.length) status = 'completed';
    else if (record.start_date && record.start_date > today) status = 'pending';
    else if (record.start_date && record.start_date <= today) status = 'active';
  }
  return { grandTotal, monthlyEmi, totalPaid, remaining, paidCount, partialCount, status };
}

async function loadInstallments(emiId, client = null) {
  const run = client || { query };
  const instR = await run.query(
    `SELECT *
     FROM emi_installments
     WHERE emi_id = $1
     ORDER BY installment_no`,
    [emiId]
  );
  return instR.rows.map((row) => ({
    ...row,
    installment_no: Number(row.installment_no),
    principal_component: num(row.principal_component),
    interest_component: num(row.interest_component),
    gst_amount: num(row.gst_amount),
    emi_amount: num(row.emi_amount),
    paid_amount: num(row.paid_amount),
  }));
}

async function insertEmiCcTxns(userId, emiId, client = null) {
  const run = client || { query };
  const recR = await run.query('SELECT * FROM emi_records WHERE id = $1 AND user_id = $2 LIMIT 1', [emiId, userId]);
  const rec = recR.rows[0];
  if (!rec || !rec.credit_card_id) return;

  const oldTxnsR = await run.query(
    `SELECT cycle_id
     FROM cc_txns
     WHERE source = 'emi' AND source_id = $1 AND user_id = $2`,
    [emiId, userId]
  );
  const affectedCycles = [...new Set(oldTxnsR.rows.map((row) => row.cycle_id).filter(Boolean))];
  await run.query(
    `DELETE FROM cc_txns
     WHERE source = 'emi' AND source_id = $1 AND user_id = $2`,
    [emiId, userId]
  );
  for (const cycleId of affectedCycles) await updateCycleTotals(cycleId, client);

  const installments = await loadInstallments(emiId, client);
  const updatedCycles = new Set();
  for (const inst of installments) {
    const cycle = await getCcCycleForDate(rec.credit_card_id, userId, inst.due_date, client);
    if (!cycle) continue;
    let inserted = false;
    if (num(inst.principal_component) > 0) {
      await run.query(
        `INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 'emi', $7)`,
        [userId, rec.credit_card_id, cycle.id, inst.due_date, `${rec.name} - Principal`, num(inst.principal_component), emiId]
      );
      updatedCycles.add(cycle.id);
      inserted = true;
    }
    if (num(inst.interest_component) > 0) {
      await run.query(
        `INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 'emi', $7)`,
        [userId, rec.credit_card_id, cycle.id, inst.due_date, `${rec.name} - Interest`, num(inst.interest_component), emiId]
      );
      updatedCycles.add(cycle.id);
      inserted = true;
    }
    if (num(inst.gst_amount) > 0) {
      let gstDate = inst.due_date;
      if (Number(rec.gst_month_offset || 0) === 1) {
        const gdt = new Date(`${inst.due_date}T00:00:00`);
        gdt.setMonth(gdt.getMonth() + 1);
        gstDate = _localDate(gdt);
      }
      const gstCycle = await getCcCycleForDate(rec.credit_card_id, userId, gstDate, client);
      if (gstCycle) {
        await run.query(
          `INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 'emi', $7)`,
          [userId, rec.credit_card_id, gstCycle.id, gstDate, `${rec.name} - GST`, num(inst.gst_amount), emiId]
        );
        updatedCycles.add(gstCycle.id);
      }
    }
    if (!inserted && num(inst.emi_amount) > 0) {
      await run.query(
        `INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 'emi', $7)`,
        [userId, rec.credit_card_id, cycle.id, inst.due_date, `${rec.name} - EMI`, num(inst.emi_amount), emiId]
      );
      updatedCycles.add(cycle.id);
    }
  }

  if (installments.length && num(rec.cc_processing_charge) > 0) {
    const firstInst = installments[0];
    const firstCycle = await getCcCycleForDate(rec.credit_card_id, userId, firstInst.due_date, client);
    if (firstCycle) {
      await run.query(
        `INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 'emi', $7)`,
        [userId, rec.credit_card_id, firstCycle.id, firstInst.due_date, `${rec.name} - File Processing`, num(rec.cc_processing_charge), emiId]
      );
      updatedCycles.add(firstCycle.id);
      if (num(rec.cc_processing_gst_pct) > 0) {
        const gstAmt = Math.round(num(rec.cc_processing_charge) * num(rec.cc_processing_gst_pct) / 100 * 100) / 100;
        await run.query(
          `INSERT INTO cc_txns (user_id, card_id, cycle_id, txn_date, description, amount, discount_pct, discount_amount, net_amount, source, source_id)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $6, 'emi', $7)`,
          [userId, rec.credit_card_id, firstCycle.id, firstInst.due_date, `${rec.name} - File Processing GST`, gstAmt, emiId]
        );
        updatedCycles.add(firstCycle.id);
      }
    }
  }

  for (const cycleId of updatedCycles) await updateCycleTotals(cycleId, client);
}

async function insertEmiExpenses(userId, emiId, isExtra = 0, expenseCategory = null, client = null) {
  const run = client || { query };
  const recR = await run.query('SELECT * FROM emi_records WHERE id = $1 AND user_id = $2 LIMIT 1', [emiId, userId]);
  const rec = recR.rows[0];
  if (!rec) return;
  const category = normalizeOptionalText(expenseCategory, 80);
  await run.query(`DELETE FROM expenses WHERE source = 'emi' AND source_id = $1 AND user_id = $2`, [emiId, userId]);
  const installments = await loadInstallments(emiId, client);
  for (const inst of installments) {
    const dueDateText = typeof inst.due_date === 'string'
      ? inst.due_date
      : (inst.due_date instanceof Date ? inst.due_date.toISOString().slice(0, 10) : String(inst.due_date || ''));
    const expDate = `${dueDateText.slice(0, 7)}-01`;
    let amount = num(inst.emi_amount);
    if (Number(inst.installment_no) === 1 && num(rec.cc_processing_charge) > 0) {
      const procGst = num(rec.cc_processing_gst_pct) > 0
        ? Math.round(num(rec.cc_processing_charge) * num(rec.cc_processing_gst_pct) / 100 * 100) / 100
        : 0;
      amount = Math.round((amount + num(rec.cc_processing_charge) + procGst) * 100) / 100;
    }
    await run.query(
      `INSERT INTO expenses (user_id, item_name, category, amount, purchase_date, is_extra, source, source_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'emi', $7)`,
      [userId, `${rec.name} - Installment ${inst.installment_no}`, category, amount, expDate, !!isExtra, emiId]
    );
  }
  await run.query('UPDATE emi_records SET expenses_added = TRUE WHERE id = $1', [emiId]);
}

async function saveEmiRecord(userId, data) {
  const result = await query(
    `INSERT INTO emi_records (
       user_id, name, description, principal, annual_rate, tenure_months, monthly_emi, total_interest, gst_rate, total_gst,
       total_amount, grand_total, tag, credit_card_id, gst_month_offset, cc_processing_charge, cc_processing_gst_pct,
       for_friend, friend_name, planner_advance_month
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING id`,
    [
      userId, data.name, data.description || null, data.principal, data.annual_rate, data.tenure_months,
      data.monthly_emi, data.total_interest, data.gst_rate || 0, data.total_gst || 0,
      data.total_amount, data.grand_total, data.tag || null, data.credit_card_id || null,
      data.gst_month_offset || 0, data.cc_processing_charge || null, data.cc_processing_gst_pct || null,
      !!data.for_friend, data.friend_name || null, data.planner_advance_month ? 1 : 0,
    ]
  );
  return Number(result.rows[0].id);
}

async function enrichEmiRecord(record, client = null) {
  const installments = await loadInstallments(record.id, client);
  if (record.status === 'saved' && installments.length === 0) {
    return {
      ...record,
      principal: num(record.principal),
      annual_rate: num(record.annual_rate),
      monthly_emi: num(record.monthly_emi),
      total_interest: num(record.total_interest),
      total_gst: num(record.total_gst),
      total_amount: num(record.total_amount),
      grand_total: num(record.grand_total),
      cc_processing_charge: num(record.cc_processing_charge),
      cc_processing_gst_pct: num(record.cc_processing_gst_pct),
      installments: [],
      paidCount: 0,
      partialCount: 0,
      totalPaid: 0,
      remaining: num(record.grand_total),
      planner_advance_month: Number(record.planner_advance_month || 0),
      expenses_added: !!record.expenses_added,
      for_friend: !!record.for_friend,
    };
  }

  const live = computeEmiLiveTotals(record, installments);
  return {
    ...record,
    principal: num(record.principal),
    annual_rate: num(record.annual_rate),
    monthly_emi: live.monthlyEmi,
    total_interest: num(record.total_interest),
    total_gst: num(record.total_gst),
    total_amount: num(record.total_amount),
    grand_total: live.grandTotal,
    cc_processing_charge: num(record.cc_processing_charge),
    cc_processing_gst_pct: num(record.cc_processing_gst_pct),
    status: live.status,
    installments,
    paidCount: live.paidCount,
    partialCount: live.partialCount,
    totalPaid: live.totalPaid,
    remaining: live.remaining,
    planner_advance_month: Number(record.planner_advance_month || 0),
    expenses_added: !!record.expenses_added,
    for_friend: !!record.for_friend,
  };
}

async function getEmiRecords(userId, forFriend = 0) {
  const result = await query(
    `SELECT *
     FROM emi_records
     WHERE user_id = $1 AND for_friend = $2
     ORDER BY id DESC`,
    [userId, !!forFriend]
  );
  const rows = [];
  for (const record of result.rows) rows.push(await enrichEmiRecord(record));
  return rows;
}

async function getEmiRecord(userId, id) {
  const result = await query('SELECT * FROM emi_records WHERE id = $1 AND user_id = $2 LIMIT 1', [id, userId]);
  if (!result.rows[0]) return null;
  return enrichEmiRecord(result.rows[0]);
}

async function updateEmiRecord(userId, id, data) {
  const fields = [];
  const params = [];
  if (data.name !== undefined) { fields.push(`name = $${fields.length + 1}`); params.push(data.name); }
  if (data.description !== undefined) { fields.push(`description = $${fields.length + 1}`); params.push(data.description || null); }
  if (data.tag !== undefined) { fields.push(`tag = $${fields.length + 1}`); params.push(data.tag || null); }
  if (data.status !== undefined) { fields.push(`status = $${fields.length + 1}`); params.push(data.status); }
  if (data.credit_card_id !== undefined) { fields.push(`credit_card_id = $${fields.length + 1}`); params.push(data.credit_card_id || null); }
  if (data.gst_month_offset !== undefined) { fields.push(`gst_month_offset = $${fields.length + 1}`); params.push(data.gst_month_offset || 0); }
  if (data.friend_name !== undefined) { fields.push(`friend_name = $${fields.length + 1}`); params.push(data.friend_name || null); }
  if (data.planner_advance_month !== undefined) { fields.push(`planner_advance_month = $${fields.length + 1}`); params.push(data.planner_advance_month ? 1 : 0); }
  if (!fields.length) return;
  params.push(id, userId);
  await query(`UPDATE emi_records SET ${fields.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length}`, params);
}

async function deleteEmiRecord(userId, id) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM emi_installments WHERE emi_id = $1', [id]);
    await client.query(`DELETE FROM cc_txns WHERE source = 'emi' AND source_id = $1 AND user_id = $2`, [id, userId]);
    await client.query(`DELETE FROM expenses WHERE source = 'emi' AND source_id = $1 AND user_id = $2`, [id, userId]);
    await client.query('DELETE FROM emi_records WHERE id = $1 AND user_id = $2', [id, userId]);
  });
}

async function updateInstallmentAmount(userId, instId, emiAmount) {
  await withTransaction(async (client) => {
    const instR = await client.query(
      `SELECT i.*
       FROM emi_installments i
       JOIN emi_records r ON r.id = i.emi_id
       WHERE i.id = $1 AND r.user_id = $2
       LIMIT 1`,
      [instId, userId]
    );
    const inst = instR.rows[0];
    if (!inst) throw new Error('Installment not found');
    await client.query(
      `UPDATE emi_installments
       SET emi_amount = $1, principal_component = -1, interest_component = -1
       WHERE id = $2`,
      [emiAmount, instId]
    );
    await syncEmiRecordTotals(inst.emi_id, undefined, client);
  });
}

async function updateInstallmentComponents(userId, instId, data) {
  await withTransaction(async (client) => {
    const instR = await client.query(
      `SELECT i.*
       FROM emi_installments i
       JOIN emi_records r ON r.id = i.emi_id
       WHERE i.id = $1 AND r.user_id = $2
       LIMIT 1`,
      [instId, userId]
    );
    const inst = instR.rows[0];
    if (!inst) throw new Error('Installment not found');
    await client.query(
      `UPDATE emi_installments
       SET emi_amount = $1, interest_component = $2, principal_component = $3
       WHERE id = $4`,
      [data.emi_amount, data.interest_component, data.principal_component, instId]
    );
    await syncEmiRecordTotals(inst.emi_id, undefined, client);
  });
}

async function bulkUpdateInstallmentAmount(userId, emiId, emiAmount) {
  await withTransaction(async (client) => {
    const recR = await client.query('SELECT id FROM emi_records WHERE id = $1 AND user_id = $2 LIMIT 1', [emiId, userId]);
    if (!recR.rows[0]) throw new Error('EMI not found');
    await client.query(
      `UPDATE emi_installments
       SET emi_amount = $1, principal_component = -1, interest_component = -1
       WHERE emi_id = $2 AND COALESCE(paid_amount, 0) = 0`,
      [emiAmount, emiId]
    );
    await syncEmiRecordTotals(emiId, emiAmount, client);
  });
}

async function activateEmiWithSchedule(userId, emiId, startDate, schedule, addExpenses = false, expenseType = 0, expenseCategory = null) {
  await withTransaction(async (client) => {
    const recR = await client.query('SELECT * FROM emi_records WHERE id = $1 AND user_id = $2 LIMIT 1', [emiId, userId]);
    const rec = recR.rows[0];
    if (!rec) throw new Error('EMI not found');
    await client.query('DELETE FROM emi_installments WHERE emi_id = $1', [emiId]);
    for (let idx = 0; idx < schedule.length; idx++) {
      const item = schedule[idx];
      const dt = new Date(`${startDate}T00:00:00`);
      dt.setMonth(dt.getMonth() + idx);
      await client.query(
        `INSERT INTO emi_installments (emi_id, installment_no, due_date, principal_component, interest_component, gst_amount, emi_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          emiId,
          item.installment_no || idx + 1,
          _localDate(dt),
          item.principal_component,
          item.interest_component,
          item.gst_amount || 0,
          item.emi_amount,
        ]
      );
    }
    const grandTotal = Math.round(schedule.reduce((sum, item) => sum + num(item.emi_amount), 0) * 100) / 100;
    const monthlyEmi = schedule.length ? num(schedule[0].emi_amount) : num(rec.monthly_emi);
    await client.query(
      `UPDATE emi_records
       SET status = 'active', start_date = $1, grand_total = $2, total_amount = $2, monthly_emi = $3
       WHERE id = $4`,
      [startDate, grandTotal, monthlyEmi, emiId]
    );
    await autoMarkPastInstallmentsPaid(emiId, client);
    await insertEmiCcTxns(userId, emiId, client);
    if (addExpenses) await insertEmiExpenses(userId, emiId, expenseType, expenseCategory, client);
    else {
      await client.query(`DELETE FROM expenses WHERE source = 'emi' AND source_id = $1 AND user_id = $2`, [emiId, userId]);
      await client.query('UPDATE emi_records SET expenses_added = FALSE WHERE id = $1', [emiId]);
    }
  });
}

async function activateEmi(userId, emiId, startDate, addExpenses = false, expenseType = 0, expenseCategory = null) {
  await withTransaction(async (client) => {
    const recR = await client.query('SELECT * FROM emi_records WHERE id = $1 AND user_id = $2 LIMIT 1', [emiId, userId]);
    const rec = recR.rows[0];
    if (!rec) throw new Error('EMI not found');
    await client.query('DELETE FROM emi_installments WHERE emi_id = $1', [emiId]);
    const rate = num(rec.annual_rate) / 12 / 100;
    let balance = num(rec.principal);
    for (let m = 1; m <= Number(rec.tenure_months); m++) {
      const interest = Math.round(balance * rate * 100) / 100;
      const principal = Math.round((num(rec.monthly_emi) - interest) * 100) / 100;
      const gst = Math.round(interest * (num(rec.gst_rate) / 100) * 100) / 100;
      const emiAmount = Math.round((num(rec.monthly_emi) + gst) * 100) / 100;
      const due = new Date(`${startDate}T00:00:00`);
      due.setMonth(due.getMonth() + (m - 1));
      await client.query(
        `INSERT INTO emi_installments (emi_id, installment_no, due_date, principal_component, interest_component, gst_amount, emi_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [emiId, m, _localDate(due), Math.max(0, principal), interest, gst, emiAmount]
      );
      balance = Math.max(0, Math.round((balance - principal) * 100) / 100);
    }
    await client.query(`UPDATE emi_records SET status = 'active', start_date = $1 WHERE id = $2`, [startDate, emiId]);
    await autoMarkPastInstallmentsPaid(emiId, client);
    await insertEmiCcTxns(userId, emiId, client);
    if (addExpenses) await insertEmiExpenses(userId, emiId, expenseType, expenseCategory, client);
    else {
      await client.query(`DELETE FROM expenses WHERE source = 'emi' AND source_id = $1 AND user_id = $2`, [emiId, userId]);
      await client.query('UPDATE emi_records SET expenses_added = FALSE WHERE id = $1', [emiId]);
    }
  });
}

async function payInstallment(userId, instId, paidAmount, paidDate, notes, bankAccountId) {
  await withTransaction(async (client) => {
    const instR = await client.query(
      `SELECT i.*
       FROM emi_installments i
       JOIN emi_records r ON r.id = i.emi_id
       WHERE i.id = $1 AND r.user_id = $2
       LIMIT 1`,
      [instId, userId]
    );
    const inst = instR.rows[0];
    if (!inst) throw new Error('Installment not found');
    const nextPaid = Math.max(0, num(paidAmount));
    const prevPaid = num(inst.paid_amount);
    const prevBankId = normalizeBankAccountId(inst.bank_account_id);
    const nextBankId = nextPaid > 0
      ? normalizeBankAccountId(bankAccountId != null ? bankAccountId : inst.bank_account_id)
      : null;
    await client.query(
      `UPDATE emi_installments
       SET paid_amount = $1, paid_date = $2, notes = $3, bank_account_id = $4
       WHERE id = $5`,
      [nextPaid, nextPaid > 0 ? (paidDate || _localDate(new Date())) : null, notes || null, nextBankId, instId]
    );
    if (prevBankId && nextBankId && prevBankId === nextBankId) {
      const diff = nextPaid - prevPaid;
      if (diff !== 0) {
        await client.query(
          `UPDATE bank_accounts
           SET balance = balance - $1
           WHERE id = $2 AND user_id = $3`,
          [diff, nextBankId, userId]
        );
      }
    } else {
      if (prevBankId && prevPaid > 0) {
        await client.query(
          `UPDATE bank_accounts
           SET balance = balance + $1
           WHERE id = $2 AND user_id = $3`,
          [prevPaid, prevBankId, userId]
        );
      }
      if (nextBankId && nextPaid > 0) {
        await client.query(
          `UPDATE bank_accounts
           SET balance = balance - $1
           WHERE id = $2 AND user_id = $3`,
          [nextPaid, nextBankId, userId]
        );
      }
    }
    const allR = await client.query(
      `SELECT id, emi_amount, paid_amount
       FROM emi_installments
       WHERE emi_id = $1`,
      [inst.emi_id]
    );
    const allPaid = allR.rows.every((row) => {
      const paid = Number(row.id) === Number(instId) ? nextPaid : num(row.paid_amount);
      return paid >= num(row.emi_amount) * 0.999;
    });
    await client.query(`UPDATE emi_records SET status = $1 WHERE id = $2`, [allPaid ? 'completed' : 'active', inst.emi_id]);
  });
}

async function getEmiMonthSummary(userId, yearMonth) {
  const result = await query(
    `SELECT i.*, r.name, r.tag, r.user_id
     FROM emi_installments i
     JOIN emi_records r ON r.id = i.emi_id
     WHERE r.user_id = $1 AND to_char(i.due_date, 'YYYY-MM') = $2
     ORDER BY i.due_date, r.name`,
    [userId, yearMonth]
  );
  const installments = result.rows.map((row) => ({
    ...row,
    principal_component: num(row.principal_component),
    interest_component: num(row.interest_component),
    gst_amount: num(row.gst_amount),
    emi_amount: num(row.emi_amount),
    paid_amount: num(row.paid_amount),
  }));
  return {
    installments,
    totalDue: Math.round(installments.reduce((sum, item) => sum + item.emi_amount, 0) * 100) / 100,
    totalPaid: Math.round(installments.reduce((sum, item) => sum + item.paid_amount, 0) * 100) / 100,
  };
}

async function addEmiExpensesManual(userId, emiId, expenseType = 0, expenseCategory = null) {
  const recR = await query('SELECT * FROM emi_records WHERE id = $1 AND user_id = $2 LIMIT 1', [emiId, userId]);
  const rec = recR.rows[0];
  if (!rec) throw new Error('EMI not found');
  if (!['active', 'completed'].includes(rec.status)) throw new Error('EMI must be active to add expenses');
  await withTransaction(async (client) => {
    await insertEmiExpenses(userId, emiId, expenseType, expenseCategory, client);
  });
}

async function addEmiToCreditCardManual(userId, emiId, creditCardId, gstMonthOffset = 0) {
  const recR = await query('SELECT * FROM emi_records WHERE id = $1 AND user_id = $2 LIMIT 1', [emiId, userId]);
  const rec = recR.rows[0];
  if (!rec) throw new Error('EMI not found');
  if (!['active', 'completed', 'pending'].includes(rec.status)) throw new Error('EMI must be active to add credit card billing');
  const cardR = await query(
    `SELECT *
     FROM credit_cards
     WHERE id = $1 AND user_id = $2 AND is_active = TRUE
     LIMIT 1`,
    [creditCardId, userId]
  );
  if (!cardR.rows[0]) throw new Error('Credit card not found');
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE emi_records
       SET credit_card_id = $1, gst_month_offset = $2
       WHERE id = $3 AND user_id = $4`,
      [creditCardId, parseInt(gstMonthOffset, 10) || 0, emiId, userId]
    );
    await insertEmiCcTxns(userId, emiId, client);
  });
}

async function importEmiFromExcel(userId, emiData, installments) {
  return withTransaction(async (client) => {
    const principal = Math.round(installments.reduce((sum, item) => sum + num(item.principal_component), 0) * 100) / 100;
    const totalInterest = Math.round(installments.reduce((sum, item) => sum + num(item.interest_component), 0) * 100) / 100;
    const totalGst = Math.round(installments.reduce((sum, item) => sum + num(item.gst_amount || 0), 0) * 100) / 100;
    const grandTotal = Math.round(installments.reduce((sum, item) => sum + num(item.emi_amount), 0) * 100) / 100;
    const totalAmount = Math.round((principal + totalInterest) * 100) / 100;
    const monthlyEmi = installments[0] ? num(installments[0].emi_amount) : 0;
    const startDate = emiData.start_date || installments[0]?.due_date || null;

    const recR = await client.query(
      `INSERT INTO emi_records (
         user_id, name, description, principal, annual_rate, tenure_months, monthly_emi, total_interest, gst_rate, total_gst,
         total_amount, grand_total, tag, status, start_date, for_friend, friend_name
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15,$16)
       RETURNING id`,
      [
        userId, emiData.name, emiData.description || null, principal, emiData.annual_rate || 0,
        installments.length, monthlyEmi, totalInterest, emiData.gst_rate || 0, totalGst,
        totalAmount, grandTotal, emiData.tag || null, startDate, !!emiData.for_friend, emiData.friend_name || null,
      ]
    );
    const emiId = Number(recR.rows[0].id);
    for (const inst of installments) {
      const paid = num(inst.paid_amount);
      await client.query(
        `INSERT INTO emi_installments (
           emi_id, installment_no, due_date, principal_component, interest_component, gst_amount, emi_amount, paid_amount, paid_date
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          emiId, inst.installment_no, inst.due_date, inst.principal_component, inst.interest_component,
          inst.gst_amount || 0, inst.emi_amount, paid, paid > 0 ? inst.due_date : null,
        ]
      );
    }
    await autoMarkPastInstallmentsPaid(emiId, client);
    const unpaidR = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM emi_installments
       WHERE emi_id = $1 AND COALESCE(paid_amount, 0) < emi_amount * 0.999`,
      [emiId]
    );
    if (Number(unpaidR.rows[0]?.n || 0) === 0) {
      await client.query(`UPDATE emi_records SET status = 'completed' WHERE id = $1`, [emiId]);
    }
    return { id: emiId };
  });
}

async function getEmiDuesForMonth(userId, month) {
  const [year, monthNo] = month.split('-').map(Number);
  const nextDate = new Date(year, monthNo, 1);
  const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
  const result = await query(
    `SELECT i.*, r.name AS emi_name, r.id AS emi_record_id, r.status AS emi_status
     FROM emi_installments i
     JOIN emi_records r ON r.id = i.emi_id
     WHERE r.user_id = $1
       AND (
         (COALESCE(r.planner_advance_month, 0) = 0 AND to_char(i.due_date, 'YYYY-MM') = $2)
         OR
         (COALESCE(r.planner_advance_month, 0) = 1 AND to_char(i.due_date, 'YYYY-MM') = $3)
       )
       AND (r.credit_card_id IS NULL OR r.credit_card_id = 0)
       AND r.status IN ('active', 'pending', 'completed')
     ORDER BY i.due_date, r.name`,
    [userId, month, nextMonth]
  );
  return result.rows.map((row) => ({
    ...row,
    principal_component: num(row.principal_component),
    interest_component: num(row.interest_component),
    gst_amount: num(row.gst_amount),
    emi_amount: num(row.emi_amount),
    paid_amount: num(row.paid_amount),
    emi_record_id: Number(row.emi_record_id),
  }));
}

async function getPreviewDataForMonth(userId, month, billingDb = null) {
  const [yr, mo] = month.split('-').map(Number);
  const [defaults, recurringEntries, trackerItems, emiAll, accounts, cardsR] = await Promise.all([
    pgOpsDb.getDefaultPayments(userId),
    pgOpsDb.getRecurringEntries(userId),
    pgOpsDb.getDailyTrackerPlannerItems(userId, month, { includeAutoAddToExpense: true }),
    getEmiDuesForMonth(userId, month),
    pgOpsDb.getBankAccounts(userId),
    query('SELECT * FROM credit_cards WHERE user_id = $1', [userId]),
  ]);

  const projectedDefaults = defaults.filter((row) => row.is_active).map((dp) => {
    const dueDay = Math.min(dp.due_day || 1, new Date(yr, mo, 0).getDate());
    let bankAccountId = dp.bank_account_id || null;
    if (dp.auto_detect_bank) {
      const defaultBank = accounts.find((item) => item.is_default);
      if (defaultBank) bankAccountId = defaultBank.id;
    }
    return {
      ...dp,
      due_date: `${month}-${String(dueDay).padStart(2, '0')}`,
      month,
      status: 'pending',
      paid_amount: 0,
      default_payment_id: dp.id,
      bank_account_id: bankAccountId,
      is_projected: 1,
    };
  });

  const projectedRecurring = recurringEntries
    .filter((entry) => entry.is_active && entry.type === 'expense' && !entry.card_id)
    .filter((entry) => {
      const interval = Math.max(1, parseInt(entry.interval_months, 10) || 1);
      if (interval <= 1) return true;
      const startMonth = entry.start_month || month;
      if (month < startMonth) return false;
      const [startY, startM] = startMonth.split('-').map(Number);
      const diffMonths = (yr - startY) * 12 + (mo - startM);
      return diffMonths >= 0 && diffMonths % interval === 0;
    })
    .map((entry) => ({
      id: `proj_rec_${entry.id}`,
      recurring_entry_id: entry.id,
      name: entry.description,
      amount: num(entry.amount),
      due_date: `${month}-01`,
      month,
      status: 'pending',
      paid_amount: 0,
      bank_account_id: null,
      is_projected: 1,
    }));

  const projectedTrackerItems = trackerItems.map((item) => ({
    id: `proj_tracker_${item.daily_tracker_id}_${item.tracker_source_month}`,
    ...item,
    paid_amount: 0,
    status: 'pending',
    bank_account_id: null,
    is_projected: 1,
  }));

  const emiDues = emiAll.filter((item) =>
    (item.emi_status === 'active' || item.emi_status === 'pending') &&
    num(item.paid_amount) < num(item.emi_amount) * 0.999
  );

  const projectedCcDues = [];
  for (const card of cardsR.rows) {
    const actualDueCycle = billingDb ? await billingDb.getCcDuesForMonth(userId, month, card.id) : [];
    if (actualDueCycle[0]) {
      projectedCcDues.push({ ...actualDueCycle[0], is_projected: 0 });
      continue;
    }

    const billGenDay = Number(card.bill_gen_day || 1);
    const dueDays = Number(card.due_days || 20);
    for (let offset = -2; offset <= 1; offset++) {
      const cycleEndDate = new Date(yr, mo - 1 + offset, billGenDay);
      const dueDateObj = new Date(cycleEndDate);
      dueDateObj.setDate(dueDateObj.getDate() + dueDays);
      const dueDateStr = _localDate(dueDateObj);
      if (dueDateStr.slice(0, 7) !== month) continue;

      const cycleStartStr = _localDate(new Date(yr, mo - 1 + offset - 1, billGenDay + 1));
      const cycleEndStr = _localDate(cycleEndDate);
      const matchingR = await query(
        `SELECT id, net_payable, paid_amount, status
         FROM cc_cycles
         WHERE card_id = $1 AND user_id = $2 AND cycle_start = $3 AND cycle_end = $4
         LIMIT 1`,
        [card.id, userId, cycleStartStr, cycleEndStr]
      );
      const matching = matchingR.rows[0];
      if (matching && ['paid', 'closed'].includes(matching.status)) break;

      let recentNet = 0;
      if (!matching) {
        const recentR = await query(
          `SELECT net_payable
           FROM cc_cycles
           WHERE card_id = $1 AND user_id = $2 AND status IN ('open','billed','partial','paid')
           ORDER BY cycle_start DESC
           LIMIT 1`,
          [card.id, userId]
        );
        recentNet = num(recentR.rows[0]?.net_payable);
      }

      projectedCcDues.push({
        id: matching?.id || `proj_cc_${card.id}`,
        card_id: Number(card.id),
        card_name: card.card_name,
        bank_name: card.bank_name,
        last4: card.last4,
        cycle_start: cycleStartStr,
        cycle_end: cycleEndStr,
        due_date: dueDateStr,
        net_payable: matching ? num(matching.net_payable) : recentNet,
        paid_amount: matching ? num(matching.paid_amount) : 0,
        status: matching ? matching.status : 'open',
        txn_count: 0,
        is_projected: matching ? 0 : 1,
      });
      break;
    }
  }

  return {
    projectedDefaults: [...projectedDefaults, ...projectedRecurring, ...projectedTrackerItems],
    emiDues,
    projectedCcDues,
  };
}

async function getUserFinancialSummary(userId) {
  const today = _localDate(new Date());
  const currentMonth = today.slice(0, 7);
  const [banks, expYearlyR, expMonthlyR, expCategoryR, recentExpensesR, friendsR, emisR, cardsR, tripsR, plannerPaymentsR, defaultsR] = await Promise.all([
    pgOpsDb.getBankAccounts(userId),
    query(`SELECT to_char(purchase_date, 'YYYY') AS year, COALESCE(SUM(amount),0) AS total, COALESCE(SUM(CASE WHEN is_extra THEN amount ELSE 0 END),0) AS extra, COALESCE(SUM(CASE WHEN NOT is_extra THEN amount ELSE 0 END),0) AS fair, COUNT(*)::int AS count FROM expenses WHERE user_id = $1 AND deleted_at IS NULL GROUP BY year ORDER BY year DESC`, [userId]),
    query(`SELECT to_char(purchase_date, 'YYYY-MM') AS month, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count FROM expenses WHERE user_id = $1 AND deleted_at IS NULL AND purchase_date >= (CURRENT_DATE - INTERVAL '6 months') GROUP BY month ORDER BY month DESC`, [userId]),
    query(`SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS category, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS count FROM expenses WHERE user_id = $1 AND deleted_at IS NULL GROUP BY category ORDER BY total DESC LIMIT 20`, [userId]),
    query(`SELECT purchase_date, item_name, amount, is_extra FROM expenses WHERE user_id = $1 AND deleted_at IS NULL ORDER BY purchase_date DESC LIMIT 30`, [userId]),
    query('SELECT id, name FROM friends WHERE user_id = $1 AND deleted_at IS NULL', [userId]),
    query(`SELECT r.name, r.status, r.principal, r.annual_rate, r.tenure_months, r.monthly_emi, r.start_date, COUNT(i.id)::int AS total_installments, COALESCE(SUM(CASE WHEN i.paid_amount >= i.emi_amount * 0.99 THEN 1 ELSE 0 END),0)::int AS paid_count, COALESCE(SUM(CASE WHEN i.paid_amount < i.emi_amount * 0.99 THEN i.emi_amount ELSE 0 END),0) AS remaining_amount FROM emi_records r LEFT JOIN emi_installments i ON i.emi_id = r.id WHERE r.user_id = $1 GROUP BY r.id ORDER BY r.id DESC`, [userId]),
    query('SELECT id, card_name, bank_name, last4, credit_limit FROM credit_cards WHERE user_id = $1', [userId]),
    query(`SELECT t.name, t.status, t.start_date, t.end_date, COUNT(e.id)::int AS expense_count, COALESCE(SUM(e.amount),0) AS total_amount FROM trips t LEFT JOIN trip_expenses e ON e.trip_id = t.id WHERE t.user_id = $1 GROUP BY t.id ORDER BY t.id DESC LIMIT 10`, [userId]),
    query(`SELECT name, amount, due_date FROM monthly_payments WHERE user_id = $1 AND month = $2 AND deleted_at IS NULL AND COALESCE(is_skipped, FALSE) = FALSE`, [userId, currentMonth]),
    query(`SELECT name, amount, due_day, category FROM default_payments WHERE user_id = $1 AND deleted_at IS NULL AND is_active = TRUE`, [userId]),
  ]);

  const friendSummaries = [];
  for (const friend of friendsR.rows) {
    const rowR = await query(
      `SELECT COALESCE(SUM(paid),0) AS total_paid, COALESCE(SUM(received),0) AS total_received
       FROM loan_transactions
       WHERE user_id = $1 AND friend_id = $2 AND deleted_at IS NULL`,
      [userId, friend.id]
    );
    const totalPaid = num(rowR.rows[0]?.total_paid);
    const totalReceived = num(rowR.rows[0]?.total_received);
    friendSummaries.push({ name: friend.name, you_paid: totalPaid, you_received: totalReceived, net_balance: totalPaid - totalReceived });
  }

  const ccSummaries = [];
  for (const card of cardsR.rows) {
    const cycleR = await query(`SELECT net_payable, total_amount AS total_spent, status, cycle_start, cycle_end, due_date FROM cc_cycles WHERE card_id = $1 AND user_id = $2 ORDER BY cycle_start DESC LIMIT 1`, [card.id, userId]);
    ccSummaries.push({
      ...card,
      credit_limit: num(card.credit_limit),
      current_cycle: cycleR.rows[0] ? { ...cycleR.rows[0], net_payable: num(cycleR.rows[0].net_payable), total_spent: num(cycleR.rows[0].total_spent) } : null,
    });
  }

  return {
    as_of: today,
    current_month: currentMonth,
    bank_accounts: banks,
    total_bank_balance: banks.reduce((sum, bank) => sum + num(bank.balance), 0),
    total_spendable: banks.reduce((sum, bank) => sum + (num(bank.balance) - num(bank.min_balance)), 0),
    expense_by_year: expYearlyR.rows.map((row) => ({ ...row, total: num(row.total), extra: num(row.extra), fair: num(row.fair), count: Number(row.count) })),
    expense_last_6_months: expMonthlyR.rows.map((row) => ({ ...row, total: num(row.total), count: Number(row.count) })),
    expense_by_category: expCategoryR.rows.map((row) => ({ ...row, total: num(row.total), count: Number(row.count) })),
    recent_expenses: recentExpensesR.rows.map((row) => ({ ...row, amount: num(row.amount), is_extra: !!row.is_extra })),
    friends_loan_summary: friendSummaries,
    emis: emisR.rows.map((row) => ({ ...row, principal: num(row.principal), annual_rate: num(row.annual_rate), monthly_emi: num(row.monthly_emi), remaining_amount: num(row.remaining_amount), total_installments: Number(row.total_installments), paid_count: Number(row.paid_count) })),
    credit_cards: ccSummaries,
    active_trips: tripsR.rows.map((row) => ({ ...row, total_amount: num(row.total_amount), expense_count: Number(row.expense_count) })),
    current_month_planner: plannerPaymentsR.rows.map((row) => ({ ...row, amount: num(row.amount) })),
    recurring_defaults: defaultsR.rows.map((row) => ({ ...row, amount: num(row.amount) })),
  };
}

module.exports = {
  saveEmiRecord,
  getEmiRecords,
  getEmiRecord,
  updateEmiRecord,
  deleteEmiRecord,
  activateEmi,
  payInstallment,
  getEmiMonthSummary,
  updateInstallmentAmount,
  updateInstallmentComponents,
  bulkUpdateInstallmentAmount,
  activateEmiWithSchedule,
  addEmiExpensesManual,
  addEmiToCreditCardManual,
  importEmiFromExcel,
  getEmiDuesForMonth,
  getPreviewDataForMonth,
  getUserFinancialSummary,
};
