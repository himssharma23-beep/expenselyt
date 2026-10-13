const { test } = require('node:test');
const assert = require('node:assert/strict');
const { syncSourceBankPayment } = require('../db/source-bank-payment');
const { personalShare, bankMovement } = require('../db/live-split-finance');

function fixture() {
  const balances = new Map([[1, 1000], [2, 2000]]);
  const history = new Map();
  const links = new Map();
  let sequence = 0;
  const client = { query: async (sql, args = []) => {
    if (sql.startsWith('CREATE TABLE') || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM source_bank_payments')) return { rows: links.has(args.join(':')) ? [links.get(args.join(':'))] : [] };
    if (sql.startsWith('SELECT id FROM bank_accounts')) return { rows: args[0] === 9 ? args[1].filter(id => balances.has(id)).map(id => ({ id })) : [] };
    if (sql.startsWith('DELETE FROM bank_account_history')) { history.delete(args[0]); return { rows: [] }; }
    if (sql.startsWith('UPDATE bank_account_history')) {
      const row = history.get(args[5]);
      Object.assign(row, { note: args[0], amount: args[1], direction: args[2], balance_before: row.balance_after - args[4] });
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO source_bank_payments')) {
      links.set(args.slice(0, 3).join(':'), { bank_account_id: args[3], amount: args[4], history_id: args[5] });
      return { rows: [] };
    }
    throw new Error(`Unhandled SQL: ${sql}`);
  } };
  const adjust = async (user, bank, delta, transaction) => {
    assert.equal(transaction, client);
    assert.equal(user, 9);
    const before = balances.get(bank);
    balances.set(bank, before + delta);
    const id = ++sequence;
    history.set(id, { bank, balance_before: before, balance_after: before + delta, amount: Math.abs(delta) });
    return id;
  };
  const sync = (changes = {}) => syncSourceBankPayment(client, adjust, {
    source: 'live_split', sourceId: 10, userId: 9, bankId: 1, amount: -100, note: 'Dinner', ...changes,
  });
  return { balances, history, sync, client, adjust };
}

test('same entry saved repeatedly debits once and retains one bank entry', async () => {
  const db = fixture();
  await db.sync(); await db.sync(); await db.sync({ note: 'Renamed dinner' });
  assert.equal(db.balances.get(1), 900);
  assert.equal(db.history.size, 1);
  assert.equal([...db.history.values()][0].note, 'Renamed dinner');
});

test('increase and decrease update the balance by the difference', async () => {
  const db = fixture(); await db.sync(); await db.sync({ amount: -160 });
  assert.equal(db.balances.get(1), 840);
  await db.sync({ amount: -40 });
  assert.equal(db.balances.get(1), 960);
  assert.equal(db.history.size, 1);
  assert.equal([...db.history.values()][0].amount, 40);
});

test('changing bank restores old bank and charges new bank exactly once', async () => {
  const db = fixture(); await db.sync(); await db.sync({ bankId: 2, amount: -150 });
  assert.equal(db.balances.get(1), 1000);
  assert.equal(db.balances.get(2), 1850);
  assert.equal(db.history.size, 1);
});

test('deletion restores balance, removes history and is safe to repeat', async () => {
  const db = fixture(); await db.sync();
  await db.sync({ bankId: null, amount: 0 }); await db.sync({ bankId: null, amount: 0 });
  assert.equal(db.balances.get(1), 1000); assert.equal(db.history.size, 0);
});

test('received settlement can change amount, direction and be deleted', async () => {
  const db = fixture(); await db.sync({ amount: 100 }); await db.sync({ amount: 150 });
  assert.equal(db.balances.get(1), 1150);
  await db.sync({ amount: -50 }); assert.equal(db.balances.get(1), 950);
  await db.sync({ bankId: null, amount: 0 }); assert.equal(db.balances.get(1), 1000);
  assert.equal(db.history.size, 0);
});

test('existing trip payment is adopted without debiting its original amount again', async () => {
  const db = fixture(); db.balances.set(1, 900);
  await db.sync({ source: 'trip_expense', amount: -150, previous: { bank_account_id: 1, amount: -100 } });
  assert.equal(db.balances.get(1), 850);
});

test('rejects someone else’s account before changing balances', async () => {
  const db = fixture(); await assert.rejects(db.sync({ userId: 8 }), /Bank account not found/);
  assert.equal(db.balances.get(1), 1000); assert.equal(db.history.size, 0);
});

test('share calculations distinguish expense shares from bank payments', () => {
  const group = { user_id: 9, total_amount: 100, paid_by: 'You', split_mode: 'equal' };
  const splits = [{ linked_user_id: 12, share_amount: 40 }];
  assert.equal(personalShare(group, splits, 9), 60);
  assert.equal(personalShare(group, splits, 12), 40);
  assert.equal(bankMovement(group), -100);
  assert.equal(bankMovement({ ...group, paid_by: 'Friend' }), 0);
  assert.equal(bankMovement({ ...group, paid_by: 'Friend', split_mode: 'settlement' }), 100);
  assert.equal(personalShare({ ...group, split_mode: 'settlement' }, splits, 9), 0);
});

test('Own Trip ledger keeps the same source across create, edits and deletion', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../db/postgres-core'), 'utf8');
  const start = source.indexOf('async function syncTripExpenseLedger(');
  const end = source.indexOf('async function removeTripExpenseLedgerLinks(', start);
  const db = fixture();
  const context = vm.createContext({
    mapTripExpenseRow: row => row, num: value => Number(value || 0),
    normalizeBankAccountId: value => Number(value) || null,
    TRIP_EXPENSE_SOURCE: 'trip_expense', syncSourceBankPayment,
    adjustBankBalance: db.adjust, pgBillingDb: { getCcTxnBySource: async () => null },
  });
  vm.runInContext(source.slice(start, end), context);
  const original = { id: 20, bank_account_id: 1, amount: 100, details: 'Hotel' };
  const edited = { ...original, amount: 150 };
  await context.syncTripExpenseLedger(9, null, original, db.client);
  await context.syncTripExpenseLedger(9, original, edited, db.client);
  await context.syncTripExpenseLedger(9, edited, edited, db.client);
  assert.equal(db.balances.get(1), 850);
  assert.equal(db.history.size, 1);
  await context.syncTripExpenseLedger(9, edited, null, db.client);
  assert.equal(db.balances.get(1), 1000);
  assert.equal(db.history.size, 0);
});
