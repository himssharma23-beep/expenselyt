const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const source = fs.readFileSync(path.join(__dirname, '../db/postgres-ops.js'), 'utf8');
function extract(start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }
const original = { name: 'Milk', unit: 'litre', price_per_unit: 62, default_qty: 1,
  is_active: true, auto_add_to_expense: true, expense_bank_account_id: 4, expense_category: 'Milk' };
const edited = { ...original, name: 'New milk', unit: 'bottle', price_per_unit: 80, default_qty: 2,
  expense_bank_account_id: 5, expense_category: 'Groceries' };

function setup(t, { empty = false } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.function('NOW', () => '2026-09-28T12:00:00');
  db.function('jsonb_build_object', { varargs: true }, (...args) => JSON.stringify(Object.fromEntries(
    Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]])
  )));
  db.exec(`
    CREATE TABLE daily_trackers (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, unit TEXT,
      price_per_unit NUMERIC, default_qty NUMERIC, is_active INTEGER, auto_add_to_expense INTEGER,
      expense_bank_account_id INTEGER, expense_category TEXT, updated_at TEXT, updated_by INTEGER);
    CREATE TABLE daily_tracker_prices (id INTEGER PRIMARY KEY, tracker_id INTEGER, user_id INTEGER,
      effective_from TEXT, price_per_unit NUMERIC, settings TEXT, created_by INTEGER, updated_by INTEGER,
      updated_at TEXT, UNIQUE(tracker_id, effective_from));
    CREATE TABLE daily_entries (id INTEGER PRIMARY KEY, tracker_id INTEGER, user_id INTEGER,
      entry_date TEXT, quantity NUMERIC, amount NUMERIC, is_auto INTEGER, tracker_settings TEXT,
      added_to_expense INTEGER DEFAULT 0, UNIQUE(tracker_id, entry_date));
    INSERT INTO daily_trackers VALUES (1, 10, 'Milk', 'litre', 62, 1, 1, 1, 4, 'Milk', NULL, 10);
  `);
  if (!empty) db.exec(`INSERT INTO daily_entries (tracker_id, user_id, entry_date, quantity, amount, is_auto) VALUES
    (1, 10, '2026-08-15', 1, 62, 1), (1, 10, '2026-09-27', 1, 62, 1),
    (1, 10, '2026-09-28', 3, 186, 0), (1, 10, '2026-09-29', 1, 62, 1),
    (1, 10, '2026-09-30', 3, 186, 0);`);
  let fail = false;
  const query = async (sql, params = []) => {
    if (fail && sql.includes('UPDATE daily_trackers')) throw new Error('Simulated failure');
    // Run the actual persistence SQL using SQLite, translating PostgreSQL syntax only.
    sql = sql.replace(/::(?:jsonb|text|numeric)/g, '').replace(/ FOR UPDATE/g, '')
      .replace('UPDATE daily_entries e ', 'UPDATE daily_entries AS e ')
      .replace("$3 || jsonb_build_object('price_per_unit', price_per_unit)", "json_patch($3, jsonb_build_object('price_per_unit', price_per_unit))");
    if (sql.includes('UPDATE daily_entries AS e SET tracker_settings')) {
      sql = sql.replace('SET tracker_settings =', 'SET tracker_settings = json_patch(')
        .replace('|| jsonb_build_object', ', jsonb_build_object')
        .replace('WHERE e.user_id', ') WHERE e.user_id');
    }
    const statement = db.prepare(sql);
    statement.setAllowUnknownNamedParameters(true);
    const bindings = Object.fromEntries(params.map((value, i) => [`$${i + 1}`, typeof value === 'boolean' ? Number(value) : value]));
    const rows = statement.all(bindings).map((row) => {
      for (const key of ['tracker_settings', 'settings']) if (row[key]) row[key] = JSON.parse(row[key]);
      return row;
    });
    return { rows };
  };
  const context = vm.createContext({
    query, Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-28T12:00:00'])); } },
    withTransaction: async (work) => {
      db.exec('BEGIN');
      try { const value = await work({ query }); db.exec('COMMIT'); return value; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    num: Number, normalizeDateValue: (value) => value, _localDate: (date) => date.toISOString().slice(0, 10),
    dbDateToYmd: (value) => value, normalizeText: (value) => value,
    normalizePositiveAmount: Number, normalizeOptionalText: (value) => value || null,
    normalizeBankAccountId: (value) => value || null, validationError: (message) => new Error(message),
  });
  vm.runInContext(extract('const TRACKER_PRICE_BASELINE_DATE', 'async function getDefaultBankAccountId(')
    + extract('async function updateDailyTracker(', 'async function getDailyMonthSummary('), context);
  return { context, query, db, fail: () => { fail = true; },
    entry: async (date) => (await query('SELECT * FROM daily_entries WHERE entry_date = $1', [date])).rows[0] };
}

test('edits preserve past/today entries and apply metadata, price and quantity only to future days', async (t) => {
  const { context, entry } = setup(t);
  await context.updateDailyTracker(10, 1, edited);
  for (const date of ['2026-08-15', '2026-09-27', '2026-09-28']) {
    const row = await entry(date);
    assert.equal(row.amount, date.endsWith('28') ? 186 : 62);
    assert.equal(row.tracker_settings.name, 'Milk');
    assert.equal(row.tracker_settings.unit, 'litre');
    assert.equal(row.tracker_settings.expense_bank_account_id, 4);
  }
  const future = await entry('2026-09-29');
  assert.equal(future.quantity, 2);
  assert.equal(future.amount, 160);
  assert.equal(future.tracker_settings.unit, 'bottle');
  assert.equal((await entry('2026-09-30')).quantity, 3); // Keep manually entered quantity.
  assert.equal((await entry('2026-09-30')).amount, 240);
});

test('multiple same-day edits never overwrite historical metadata or rate', async (t) => {
  const { context, entry } = setup(t);
  await context.updateDailyTracker(10, 1, edited);
  await context.updateDailyTracker(10, 1, { ...edited, price_per_unit: 100 });
  await context.upsertDailyEntry(10, 1, '2026-09-27', 2, false);
  assert.equal((await entry('2026-09-27')).amount, 124);
  assert.equal((await entry('2026-09-27')).tracker_settings.name, 'Milk');
  assert.equal((await entry('2026-09-29')).amount, 200);
});

test('autofill resolves the old and new defaults separately for each date', async (t) => {
  const { context, entry, db } = setup(t);
  await context.updateDailyTracker(10, 1, edited);
  db.exec("DELETE FROM daily_entries WHERE entry_date IN ('2026-09-27', '2026-09-29')");
  await context.autoFillDailyEntries(10, 1, 2026, 9);
  assert.equal((await entry('2026-09-27')).amount, 62);
  assert.equal((await entry('2026-09-27')).quantity, 1);
  assert.equal((await entry('2026-09-29')).amount, 160);
});

test('trackers without past entries use edited settings for any newly filled date', async (t) => {
  const { context, entry } = setup(t, { empty: true });
  await context.updateDailyTracker(10, 1, edited);
  await context.autoFillDailyEntries(10, 1, 2026, 8);
  assert.equal((await entry('2026-08-01')).amount, 160);
  assert.equal((await entry('2026-08-01')).tracker_settings.name, 'New milk');
});

test('zero default quantities remain zero and disabling preserves history', async (t) => {
  const { context, entry } = setup(t);
  await context.updateDailyTracker(10, 1, { ...edited, default_qty: 0 });
  assert.equal((await entry('2026-09-29')).amount, 0);
  await context.updateDailyTracker(10, 1, { ...edited, is_active: false });
  assert.equal(await entry('2026-09-29'), undefined);
  assert.equal((await entry('2026-09-27')).amount, 62);
});

test('failed or unauthorized edits do not partially modify tracker history', async (t) => {
  const { context, query, fail, entry } = setup(t);
  await assert.rejects(context.updateDailyTracker(99, 1, edited), /Tracker not found/);
  fail();
  await assert.rejects(context.updateDailyTracker(10, 1, edited), /Simulated failure/);
  assert.equal((await entry('2026-09-27')).tracker_settings, null);
  assert.equal((await query('SELECT * FROM daily_tracker_prices')).rows.length, 0);
});
