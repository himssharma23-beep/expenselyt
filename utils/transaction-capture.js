const crypto = require('crypto');
const db = require('../db/transaction-capture');
const core = require('../db/postgres-core');
const ops = require('../db/postgres-ops');
const billing = require('../db/postgres-billing');
const { error, parseText, redact, canAutoSave, validDate } = require('./capture-policy');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
function serialize(row) { return { ...row.payload, id: String(row.id), source: row.method, status: row.status, expense_id: row.expense_id, created_at: row.created_at, updated_at: row.updated_at }; }
function createService({ parseAi }) {
  async function ingest(userId, method, raw, options = {}) {
    const access = await db.assertMethod(userId, method);
    const base = parseText(raw, options.receivedAt);
    if (/\b(?:otp|verification code|one.time password)\b/i.test(String(raw))) throw error('Verification messages are excluded.', 422);
    const fingerprint = hash(base.reference && base.amount > 0 ? `${base.currency}|${base.reference.toLowerCase()}|${base.transaction_direction}|${base.amount}`
      : `${method}|${options.externalId || base.raw_text.toLowerCase()}`);
    const prior = await db.query('SELECT * FROM transaction_capture_items WHERE user_id=$1 AND fingerprint=$2',[userId,fingerprint]);
    if(prior.rows[0]) return { ...serialize(prior.rows[0]),duplicate:true };
    let suggestion = base;
    if (options.ai === true) {
      await db.assertMethod(userId, 'ai_read');
      const [banks, cards] = await Promise.all([ops.getBankAccounts(userId), billing.getCreditCards(userId)]);
      const ai = await parseAi(redact(raw), banks, cards);
      suggestion = { ...base, ...ai, raw_text: base.raw_text, parsed_text: base.parsed_text,
        transaction_direction: base.transaction_direction, reference: base.reference,
        date_inferred: base.date_inferred, currency: base.currency, account_last4: base.account_last4 };
      if (!validDate(suggestion.purchase_date)) suggestion.purchase_date = base.purchase_date;
      if (base.amount > 0) suggestion.amount = base.amount;
    }
    suggestion.amount = Number(suggestion.amount) || 0;
    if (!Number.isFinite(suggestion.amount) || suggestion.amount <= 0 || suggestion.amount > 999999999999) throw error('No valid transaction amount found.', 422);
    // Reference keys deduplicate the same bank/payment alert across all sources.
    const row = await db.withTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId]);
      await db.assertMethod(userId,method,true,client);
      if(options.ai === true) await db.assertMethod(userId,'ai_read',true,client);
      const existing = await client.query('SELECT * FROM transaction_capture_items WHERE user_id=$1 AND fingerprint=$2', [userId, fingerprint]);
      if (existing.rows[0]) return { ...existing.rows[0], duplicate: true };
      // Similar alerts are flagged for review rather than silently discarding legitimate equal payments.
      const similar = await client.query(`SELECT id FROM transaction_capture_items WHERE user_id=$1
        AND payload->>'purchase_date'=$2 AND payload->>'amount'=$3 AND lower(payload->>'merchant')=lower($4) AND status<>'ignored' LIMIT 1`,
        [userId, suggestion.purchase_date, String(suggestion.amount), suggestion.merchant || '']);
      if (similar.rows.length) suggestion.possible_duplicate_id = String(similar.rows[0].id);
      const inserted = await client.query(`INSERT INTO transaction_capture_items(user_id,method,fingerprint,payload) VALUES($1,$2,$3,$4) RETURNING *`, [userId, method, fingerprint, JSON.stringify(suggestion)]);
      return inserted.rows[0];
    });
    if (!row.duplicate && !suggestion.possible_duplicate_id && canAutoSave(suggestion, access.permissions, access.preferences)) {
      await confirm(userId, row.id, suggestion, true);
      const refreshed = await db.query('SELECT * FROM transaction_capture_items WHERE id=$1 AND user_id=$2', [row.id, userId]);
      return serialize(refreshed.rows[0]);
    }
    return { ...serialize(row), duplicate: !!row.duplicate };
  }
  async function confirm(userId, id, data, automatic = false) {
    await db.ensureSchema();
    return db.withTransaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [userId]);
      const { rows } = await client.query('SELECT * FROM transaction_capture_items WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, userId]);
      const row = rows[0];
      if (!row) throw error('Capture not found.', 404);
      const currentAccess = await db.assertMethod(userId, row.method, true, client);
      if(automatic && !canAutoSave(row.payload,currentAccess.permissions,currentAccess.preferences)) return {id:null,not_added:true};
      if (row.status === 'added') return { id: row.expense_id, already_added: true };
      if (row.status !== 'pending') throw error('Only pending captures can be added.');
      if (row.payload.transaction_direction !== 'debit' && !(row.payload.transaction_direction === 'unknown' && data.confirm_expense === true)) throw error('Credits, transfers, refunds and failed/pending transactions cannot be added as expenses.', 422);
      if (!validDate(data.purchase_date) || !Number.isFinite(Number(data.amount)) || !(Number(data.amount) > 0) || !String(data.item_name || '').trim()) throw error('Valid name, amount and date are required.');
      const discountPct = Number(data.card_discount_pct || 0);
      if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) throw error('Card discount must be between 0 and 100.');
      const user = await client.query('SELECT currency_code FROM users WHERE id=$1', [userId]);
      if (row.payload.currency && row.payload.currency !== (user.rows[0]?.currency_code || 'INR')) throw error('Convert this transaction to your account currency before adding it manually.', 422);
      if (data.card_id && data.bank_account_id) throw error('Select either a bank account or a credit card.');
      if (data.card_id) {
        const card = await client.query('SELECT id FROM credit_cards WHERE id=$1 AND user_id=$2', [data.card_id,userId]);
        if (!card.rows.length) throw error('Credit card not found.',404);
      }
      if (data.bank_account_id) {
        const bank = await client.query('SELECT id FROM bank_accounts WHERE id=$1 AND user_id=$2 AND is_active=TRUE', [data.bank_account_id, userId]);
        if (!bank.rows.length) throw error('Bank account not found.', 404);
      }
      const expenseId = await core.addExpense(userId, { item_name: String(data.item_name).slice(0,160), amount: Number(data.amount),
        purchase_date: data.purchase_date, category: String(data.category || '').slice(0,80), is_extra: !!data.is_extra,
        bank_account_id: data.bank_account_id || null, source: 'smart_capture', source_id: row.id }, client);
      if (data.card_id) await billing.addCcTxn(userId,{ card_id:data.card_id,txn_date:data.purchase_date,description:data.item_name,amount:Number(data.amount),discount_pct:discountPct,source:'expense',source_id:expenseId },client);
      await client.query(`UPDATE transaction_capture_items SET status='added',expense_id=$1,payload=payload || $2::jsonb,updated_at=NOW() WHERE id=$3`, [expenseId, JSON.stringify({ item_name: data.item_name, amount: Number(data.amount), purchase_date: data.purchase_date, category: data.category || '', bank_account_id: data.bank_account_id || null, card_id:data.card_id || null }), id]);
      return { id: expenseId };
    });
  }
  return { ingest, confirm };
}
module.exports = { createService, serialize, hash };
