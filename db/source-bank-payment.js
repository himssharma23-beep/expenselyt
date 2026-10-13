// Called inside the source entry's transaction. Amounts are signed bank movements.
async function ensureSourceBankPayments(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS source_bank_payments (
    source TEXT NOT NULL, source_id BIGINT NOT NULL, user_id BIGINT NOT NULL REFERENCES users(id),
    bank_account_id BIGINT REFERENCES bank_accounts(id), amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    history_id BIGINT, PRIMARY KEY (source, source_id, user_id)
  )`);
}

async function syncSourceBankPayment(client, adjustBankBalance, { source, sourceId, userId, bankId, amount, note, previous }) {
  await ensureSourceBankPayments(client);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bank-source:${source}:${sourceId}:${userId}`]);
  const stored = (await client.query('SELECT * FROM source_bank_payments WHERE source = $1 AND source_id = $2 AND user_id = $3 FOR UPDATE', [source, sourceId, userId])).rows[0];
  const old = stored || previous || {};
  const oldBank = Number(old.bank_account_id) || null;
  const nextBank = Number(bankId) || null;
  const oldAmount = Number(old.amount || 0);
  const nextAmount = nextBank ? Math.round(Number(amount || 0) * 100) / 100 : 0;
  if (!Number.isFinite(nextAmount)) throw new Error('Invalid bank payment amount');
  // Lock both accounts in deterministic order, including for a change of bank.
  const ids = [...new Set([oldBank, nextBank].filter(Boolean))].sort((a, b) => a - b);
  const accounts = ids.length ? (await client.query('SELECT id FROM bank_accounts WHERE user_id = $1 AND id = ANY($2::bigint[]) ORDER BY id FOR UPDATE', [userId, ids])).rows : [];
  if (ids.some(id => !accounts.some(row => Number(row.id) === id))) throw new Error('Bank account not found');
  let historyId = old.history_id || null;
  if (oldBank && oldBank !== nextBank && oldAmount) {
    const refundHistoryId = await adjustBankBalance(userId, oldBank, -oldAmount, client, { note });
    if (!refundHistoryId) throw new Error('Previous bank account is unavailable');
    if (refundHistoryId) await client.query('DELETE FROM bank_account_history WHERE id = $1 AND user_id = $2', [refundHistoryId, userId]);
  }
  const delta = nextAmount - (oldBank === nextBank ? oldAmount : 0);
  if (nextBank && delta) {
    const newHistoryId = await adjustBankBalance(userId, nextBank, delta, client, { note });
    if (!newHistoryId) throw new Error('Bank account is unavailable');
    if (historyId) await client.query('DELETE FROM bank_account_history WHERE id = $1 AND user_id = $2', [historyId, userId]);
    historyId = newHistoryId;
  }
  if (!nextBank || !nextAmount) {
    if (historyId) await client.query('DELETE FROM bank_account_history WHERE id = $1 AND user_id = $2', [historyId, userId]);
    historyId = null;
  } else if (historyId) {
    await client.query(`UPDATE bank_account_history SET note = $1, amount = $2, direction = $3,
      entry_type = $4, balance_before = balance_after - $5 WHERE id = $6 AND user_id = $7`,
    [note, Math.abs(nextAmount), nextAmount > 0 ? 'credit' : 'debit', nextAmount > 0 ? 'fund_added' : 'fund_removed', nextAmount, historyId, userId]);
  }
  await client.query(`INSERT INTO source_bank_payments (source, source_id, user_id, bank_account_id, amount, history_id)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source, source_id, user_id)
    DO UPDATE SET bank_account_id = EXCLUDED.bank_account_id, amount = EXCLUDED.amount, history_id = EXCLUDED.history_id`,
  [source, sourceId, userId, nextBank, nextAmount, historyId]);
}

module.exports = { ensureSourceBankPayments, syncSourceBankPayment };
