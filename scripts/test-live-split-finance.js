const test = require('node:test');
const assert = require('node:assert/strict');
const { syncLiveSplitFinance } = require('../db/live-split-finance');
const fs = require('node:fs');
const vm = require('node:vm');
const coreSource = fs.readFileSync(require.resolve('../db/postgres-core'), 'utf8');
const dateContext = vm.createContext({ Date });
vm.runInContext(coreSource.slice(coreSource.indexOf('function formatDateOnlyValue('), coreSource.indexOf('function mapSocietyExpenseRow(')), dateContext);

function fixture() {
  let state = {
    group: { id: 10, user_id: 9, details: 'Dinner', total_amount: 100, paid_by: 'You', split_mode: 'equal', divide_date: '2026-10-13' },
    splits: [{ linked_user_id: 12, share_amount: 40 }],
    banks: { 1: 1000 }, links: [], history: [], expenses: [], cards: [], sequence: 0, remainingGroup: null,
  };
  let failExpense = false;
  const client = { query: async (sql, args = []) => {
    if (sql.startsWith('CREATE TABLE') || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.startsWith('SELECT g.*')) return { rows: [state.group] };
    if (sql.startsWith('SELECT s.*')) return { rows: state.splits };
    if (sql.startsWith('SELECT id FROM live_split_groups')) return { rows: state.remainingGroup ? [{ id: state.remainingGroup }] : [] };
    if (/^UPDATE (source_bank_payments|expenses|cc_txns) SET source_id/.test(sql)) {
      const rows = sql.startsWith('UPDATE expenses') ? state.expenses : sql.startsWith('UPDATE cc_txns') ? state.cards : state.links;
      for (const row of rows) if (row.source === 'payment_manager' && row.source_id === args[1]) row.source_id = args[0];
      return { rows: [] };
    }
    if (sql.startsWith('SELECT * FROM source_bank_payments')) {
      const source = sql.includes("'payment_manager'") ? 'payment_manager' : sql.includes("'live_split'") ? 'live_split' : args[0];
      return { rows: state.links.filter(row => row.source === source && row.source_id === (args.length === 3 ? args[1] : args[0]) && (args.length !== 3 || row.user_id === args[2])).map(row => ({ ...row })) };
    }
    if (sql.startsWith('SELECT id FROM bank_accounts')) return { rows: args[0] === 9 ? args[1].filter(id => id in state.banks).map(id => ({ id })) : [] };
    if (sql.startsWith('INSERT INTO source_bank_payments')) {
      const row = { source: args[0], source_id: args[1], user_id: args[2], bank_account_id: args[3], amount: args[4], history_id: args[5] };
      state.links = state.links.filter(old => old.source !== row.source || old.user_id !== row.user_id);
      state.links.push(row); return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM bank_account_history')) { state.history = state.history.filter(row => row.id !== args[0]); return { rows: [] }; }
    if (sql.startsWith('UPDATE bank_account_history')) {
      Object.assign(state.history.find(row => row.id === args[5]), { amount: args[1], direction: args[2] }); return { rows: [] };
    }
    if (sql.startsWith('SELECT * FROM expenses')) return { rows: state.expenses.filter(row => row.source === (sql.includes("'payment_manager'") ? 'payment_manager' : 'live_split') && row.source_id === args[0] && !row.deleted_at).map(row => ({ ...row })) };
    if (sql.startsWith('UPDATE live_split_groups') || sql.startsWith('UPDATE live_split_group_shares')) return { rows: [] };
    throw Error(`Unexpected SQL: ${sql}`);
  } };
  const deps = {
    formatDateOnlyValue: dateContext.formatDateOnlyValue,
    adjustBankBalance: async (uid, bank, delta, transaction) => {
      assert.equal(transaction, client);
      state.banks[bank] += delta;
      const id = ++state.sequence;
      state.history.push({ id, amount: Math.abs(delta) }); return id;
    },
    addExpense: async (uid, data, transaction) => {
      assert.equal(transaction, client);
      assert.match(data.purchase_date, /^\d{4}-\d{2}-\d{2}$/);
      if (failExpense) throw Error('Expense write failed');
      const id = ++state.sequence; state.expenses.push({ ...data, id, user_id: uid }); return id;
    },
    updateExpense: async (uid, id, data, transaction) => {
      assert.equal(transaction, client);
      assert.match(data.purchase_date, /^\d{4}-\d{2}-\d{2}$/);
      if (failExpense) throw Error('Expense write failed');
      Object.assign(state.expenses.find(row => row.id === id && row.user_id === uid), data);
    },
    deleteExpense: async (uid, id, transaction) => {
      assert.equal(transaction, client);
      state.expenses.find(row => row.id === id && row.user_id === uid).deleted_at = true;
    },
    billing: {
      getCcTxnBySource: async (uid, source, id, transaction) => {
        assert.equal(transaction, client); return state.cards.find(row => row.source === source && row.source_id === id);
      },
      addCcTxn: async (uid, data, transaction) => {
        assert.match(data.txn_date, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(transaction, client); state.cards.push({ ...data, id: ++state.sequence });
      },
      updateCcTxn: async (uid, id, data, transaction) => {
        assert.match(data.txn_date, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(transaction, client); Object.assign(state.cards.find(row => row.id === id), data);
      },
      deleteCcTxn: async (uid, id, transaction) => {
        assert.equal(transaction, client); state.cards = state.cards.filter(row => row.id !== id);
      },
    },
  };
  return {
    state: () => state,
    fail: () => { failExpense = true; },
    save: async (changes = {}, finance = null, remove = false) => {
      const before = structuredClone(state);
      try { Object.assign(state.group, changes); await syncLiveSplitFinance(client, deps, state.group.id, finance, remove); }
      catch (error) { state = before; throw error; }
    },
  };
}

test('bank payment and personal share update in place and are removed together', async () => {
  const db = fixture();
  await db.save({}, { bank_account_id: 1, add_expense: true });
  assert.equal(db.state().banks[1], 900);
  assert.equal(db.state().expenses[0].amount, 60);
  const id = db.state().expenses[0].id;
  await db.save({ total_amount: 160 }); await db.save({ details: 'Renamed dinner' });
  assert.equal(db.state().banks[1], 840);
  assert.equal(db.state().history.length, 1);
  assert.equal(db.state().expenses.length, 1);
  assert.equal(db.state().expenses[0].id, id);
  assert.equal(db.state().expenses[0].amount, 120);
  await db.save({}, null, true);
  assert.equal(db.state().banks[1], 1000);
  assert.equal(db.state().history.length, 0);
  assert.equal(db.state().expenses[0].deleted_at, true);
});

test('database Date objects preserve the default calendar day when creating and editing a split', async () => {
  const db = fixture();
  await db.save({ divide_date: new Date(2026, 9, 13) }, { card_id: 7, add_expense: true });
  assert.equal(db.state().expenses[0].purchase_date, '2026-10-13');
  assert.equal(db.state().cards[0].txn_date, '2026-10-13');
  await db.save({ divide_date: new Date(2026, 9, 14), total_amount: 150 });
  assert.equal(db.state().expenses[0].purchase_date, '2026-10-14');
  assert.equal(db.state().cards[0].txn_date, '2026-10-14');
});

test('received settlement updates its bank credit and deletion reverses it', async () => {
  const db = fixture();
  await db.save({ split_mode: 'settlement', paid_by: 'Friend' }, { bank_account_id: 1 });
  await db.save({ total_amount: 150 });
  assert.equal(db.state().banks[1], 1150);
  assert.equal(db.state().expenses.length, 0);
  await db.save({}, null, true);
  assert.equal(db.state().banks[1], 1000);
  assert.equal(db.state().history.length, 0);
});

test('failed expense update rolls back the source, bank balance, history and link', async () => {
  const db = fixture();
  await db.save({}, { bank_account_id: 1, add_expense: true });
  const before = structuredClone(db.state()); db.fail();
  await assert.rejects(db.save({ total_amount: 150 }), /Expense write failed/);
  assert.deepEqual(db.state(), before);
});

test('card transaction is updated rather than added again, and deleted with source', async () => {
  const db = fixture();
  await db.save({}, { card_id: 7, add_expense: true });
  const id = db.state().cards[0].id;
  await db.save({ total_amount: 150 }); await db.save({ total_amount: 150 });
  assert.equal(db.state().cards.length, 1);
  assert.equal(db.state().cards[0].id, id);
  assert.equal(db.state().cards[0].amount, 150);
  await db.save({}, null, true); assert.equal(db.state().cards.length, 0);
});

test('linked participant expenses follow their share, including removal from split', async () => {
  const db = fixture();
  db.state().expenses.push({ id: 50, user_id: 12, source: 'live_split', source_id: 10, amount: 40 });
  db.state().splits[0].share_amount = 25;
  await db.save(); assert.equal(db.state().expenses[0].amount, 25);
  db.state().splits = [];
  await db.save(); assert.equal(db.state().expenses[0].deleted_at, true);
});

test('payment manager retains the real payment until the last debt is deleted', async () => {
  const db = fixture();
  Object.assign(db.state().group, { session_id: 'manager-9-test', total_amount: 40 });
  db.state().remainingGroup = 11;
  db.state().banks[1] = 900;
  db.state().history.push({ id: 50, amount: 100 });
  db.state().links.push({ source: 'payment_manager', source_id: 10, user_id: 9, bank_account_id: 1, amount: -100, history_id: 50 });
  db.state().expenses.push({ id: 51, user_id: 9, source: 'payment_manager', source_id: 10, amount: 60 });
  await db.save({}, null, true);
  assert.equal(db.state().banks[1], 900);
  assert.equal(db.state().links[0].source_id, 11);
  assert.equal(db.state().expenses[0].source_id, 11);
  db.state().remainingGroup = null;
  await db.save({ id: 11 }, null, true);
  assert.equal(db.state().banks[1], 1000);
  assert.equal(db.state().history.length, 0);
  assert.equal(db.state().expenses[0].deleted_at, true);
});
