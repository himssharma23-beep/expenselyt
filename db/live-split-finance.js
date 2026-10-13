const { ensureSourceBankPayments, syncSourceBankPayment } = require('./source-bank-payment');

const money = value => Math.round(Number(value || 0) * 100) / 100;
function personalShare(group, splits, userId) {
  if (String(group.split_mode).toLowerCase() === 'settlement') return 0;
  if (Number(group.user_id) === Number(userId)) {
    return Math.max(0, money(Number(group.total_amount) - splits.filter(row => Number(row.linked_user_id) !== Number(userId)).reduce((sum, row) => sum + Number(row.share_amount), 0)));
  }
  return money(splits.filter(row => Number(row.linked_user_id) === Number(userId)).reduce((sum, row) => sum + Number(row.share_amount), 0));
}
function bankMovement(group) {
  const payer = String(group.paid_by || '').trim().toLowerCase();
  const ownerPays = ['you', String(group.owner_name || '').toLowerCase(), String(group.owner_username || '').toLowerCase()].filter(Boolean).includes(payer);
  return ownerPays ? -money(group.total_amount) : String(group.split_mode).toLowerCase() === 'settlement' ? money(group.total_amount) : 0;
}

async function syncLiveSplitFinance(client, deps, groupId, finance = null, remove = false) {
  const group = (await client.query(`SELECT g.*, u.display_name AS owner_name, u.username AS owner_username
    FROM live_split_groups g JOIN users u ON u.id = g.user_id WHERE g.id = $1 FOR UPDATE OF g`, [groupId])).rows[0];
  if (!group) throw new Error('Split entry not found');
  // PostgreSQL DATE values can arrive as local-midnight Date objects.
  // Expense/card writers expect a calendar-date string, not Date.toString().
  group.divide_date = deps.formatDateOnlyValue(group.divide_date);
  const ownerId = Number(group.user_id);
  if (finance?.bank_account_id && finance?.card_id) throw new Error('Choose one payment source');
  const splits = (await client.query(`SELECT s.*, f.linked_user_id FROM live_split_splits s
    LEFT JOIN live_split_friends f ON f.id = s.friend_id WHERE s.group_id = $1`, [groupId])).rows;
  await ensureSourceBankPayments(client);
  // Payment-manager debts are not payments. Keep the posting's payment until
  // its last debt is removed, moving the link if its anchor group is deleted.
  if (remove) {
    const remaining = String(group.session_id || '').startsWith('manager-')
      ? (await client.query(`SELECT id FROM live_split_groups WHERE user_id = $1 AND session_id = $2
          AND id <> $3 ORDER BY id LIMIT 1 FOR UPDATE`, [ownerId, group.session_id, groupId])).rows[0]
      : null;
    if (remaining) {
      await client.query("UPDATE source_bank_payments SET source_id = $1 WHERE source = 'payment_manager' AND source_id = $2", [remaining.id, groupId]);
      await client.query("UPDATE expenses SET source_id = $1 WHERE source = 'payment_manager' AND source_id = $2", [remaining.id, groupId]);
      await client.query("UPDATE cc_txns SET source_id = $1 WHERE source = 'payment_manager' AND source_id = $2", [remaining.id, groupId]);
    } else {
    const managerLinks = (await client.query("SELECT * FROM source_bank_payments WHERE source = 'payment_manager' AND source_id = $1", [groupId])).rows;
    for (const link of managerLinks) await syncSourceBankPayment(client, deps.adjustBankBalance, {
      source: 'payment_manager', sourceId: groupId, userId: Number(link.user_id), bankId: null, amount: 0, note: `Deleted split: ${group.details}`,
    });
    const managerExpenses = (await client.query("SELECT * FROM expenses WHERE source = 'payment_manager' AND source_id = $1 AND deleted_at IS NULL FOR UPDATE", [groupId])).rows;
    for (const expense of managerExpenses) await deps.deleteExpense(Number(expense.user_id), expense.id, client);
    const managerCard = await deps.billing.getCcTxnBySource(ownerId, 'payment_manager', groupId, client);
    if (managerCard) await deps.billing.deleteCcTxn(ownerId, managerCard.id, client);
    }
  }
  const bankLinks = (await client.query("SELECT * FROM source_bank_payments WHERE source = 'live_split' AND source_id = $1", [groupId])).rows;
  if (finance?.bank_account_id && !bankLinks.some(row => Number(row.user_id) === ownerId)) {
    bankLinks.push({ user_id: ownerId, bank_account_id: Number(finance.bank_account_id) });
  }
  for (const link of bankLinks) {
    await syncSourceBankPayment(client, deps.adjustBankBalance, {
      source: 'live_split', sourceId: groupId, userId: Number(link.user_id),
      bankId: remove ? null : link.bank_account_id,
      amount: remove ? 0 : bankMovement(group), note: `Split: ${group.details}`,
    });
  }

  const expenses = (await client.query("SELECT * FROM expenses WHERE source = 'live_split' AND source_id = $1 AND deleted_at IS NULL ORDER BY id FOR UPDATE", [groupId])).rows;
  const seenUsers = new Set();
  for (const expense of expenses) {
    const uid = Number(expense.user_id);
    const share = remove ? 0 : personalShare(group, splits, uid);
    if (!share || seenUsers.has(uid)) await deps.deleteExpense(uid, expense.id, client);
    else {
      await deps.updateExpense(uid, expense.id, { ...expense, item_name: group.details, amount: share, purchase_date: group.divide_date }, client);
      seenUsers.add(uid);
    }
  }
  if (!remove && finance?.add_expense && !seenUsers.has(ownerId)) {
    const share = personalShare(group, splits, ownerId);
    if (share > 0) await deps.addExpense(ownerId, { item_name: group.details, amount: share, purchase_date: group.divide_date,
      category: finance.category || null, is_extra: !!finance.is_extra, source: 'live_split', source_id: groupId }, client);
  }
  const card = await deps.billing.getCcTxnBySource(ownerId, 'live_split', groupId, client);
  const cardId = Number(card?.card_id || finance?.card_id) || null;
  if (cardId) {
    const amount = remove ? 0 : Math.max(0, -bankMovement(group));
    if (!amount) { if (card) await deps.billing.deleteCcTxn(ownerId, card.id, client); }
    else {
      const payload = { card_id: cardId, txn_date: group.divide_date, description: group.details, amount,
        discount_pct: Number(card?.discount_pct ?? finance?.card_discount_pct ?? 0), source: 'live_split', source_id: groupId };
      if (card) await deps.billing.updateCcTxn(ownerId, card.id, payload, client);
      else await deps.billing.addCcTxn(ownerId, payload, client);
    }
  }
  // Derive flags from real linked records instead of resetting them on every edit.
  if (expenses.length || finance?.add_expense || remove) {
  await client.query(`UPDATE live_split_groups g SET owner_added_to_expense = EXISTS (
    SELECT 1 FROM expenses e WHERE e.source = 'live_split' AND e.source_id = g.id AND e.user_id = g.user_id AND e.deleted_at IS NULL)
    WHERE g.id = $1`, [groupId]);
  await client.query(`UPDATE live_split_group_shares s SET added_to_expense = EXISTS (
    SELECT 1 FROM expenses e WHERE e.source = 'live_split' AND e.source_id = s.group_id AND e.user_id = s.target_user_id AND e.deleted_at IS NULL)
    WHERE s.group_id = $1`, [groupId]);
  }
}

module.exports = { personalShare, bankMovement, syncLiveSplitFinance };
