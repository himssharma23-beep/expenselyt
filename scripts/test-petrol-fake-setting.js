const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.function('NOW', () => '2026-09-30');
  db.exec(`
    CREATE TABLE petrol_divide_months (id INTEGER PRIMARY KEY, user_id INTEGER, month_key TEXT, petrol_price NUMERIC, fake_increase_pct NUMERIC DEFAULT 0, fake_entries_enabled BOOLEAN DEFAULT FALSE, updated_at TEXT);
    CREATE TABLE petrol_divide_month_members (month_id INTEGER);
    CREATE TABLE petrol_divide_entries (id INTEGER PRIMARY KEY, user_id INTEGER, month_id INTEGER, entry_date TEXT, remarks TEXT, distance_km NUMERIC, average_kmpl NUMERIC, petrol_price NUMERIC, petrol_used_litre NUMERIC, amount_used NUMERIC, self_share_amount NUMERIC, is_fake BOOLEAN, source_entry_id INTEGER);
    CREATE TABLE petrol_divide_entry_members (id INTEGER PRIMARY KEY, entry_id INTEGER, friend_id INTEGER, friend_name TEXT, share_amount NUMERIC);
    INSERT INTO petrol_divide_months (id,user_id,month_key,petrol_price,fake_entries_enabled) VALUES (1,7,'2026-09',100,TRUE),(2,7,'2026-10',100,FALSE);
    INSERT INTO petrol_divide_entries (id,user_id,month_id,entry_date,remarks,distance_km,average_kmpl,petrol_price,amount_used,is_fake) VALUES (1,7,1,'2026-09-01','Original',20,10,100,200,FALSE),(2,7,2,'2026-10-01','Original',20,10,100,200,FALSE);
  `);
  const query = async (sql, params = []) => {
    const bindings = Object.fromEntries(params.map((value, i) => [`$${i + 1}`, typeof value === 'boolean' ? Number(value) : value]));
    const rows = db.prepare(sql).all(bindings).map(row => {
      if ('fake_entries_enabled' in row) row.fake_entries_enabled = !!row.fake_entries_enabled;
      return row;
    });
    return { rows };
  };
  const context = vm.createContext({ module: { exports: {} }, require: name => name === './postgres' ? { query, withTransaction: fn => fn({ query }) } : require(name) });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../db/postgres-petrol.js'), 'utf8') + `
    ensureSchema = async () => {};
    getMonthRowTx = async (client, userId, monthKey) => (await client.query('SELECT * FROM petrol_divide_months WHERE user_id = $1 AND month_key = $2', [userId, monthKey])).rows[0];
    getPetrolDivideMonthTx = getMonthRowTx;
  `, context);
  return { db, context, query };
}

test('turning a month off removes only its fake entries and stops later regeneration', async t => {
  const { db, context, query } = setup(t);
  await context.syncMonthFakeEntriesTx({ query }, 7, 1, 10);
  assert.equal(db.prepare('SELECT count(*) AS n FROM petrol_divide_entries WHERE is_fake = TRUE').get().n, 1);
  await context.savePetrolDivideMonthConfig(7, { month_key: '2026-09', petrol_price: 100, fake_entries_enabled: false });
  await context.syncMonthFakeEntriesTx({ query }, 7, 1, 20);
  assert.equal(db.prepare('SELECT count(*) AS n FROM petrol_divide_entries WHERE is_fake = TRUE').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM petrol_divide_entries WHERE is_fake = FALSE').get().n, 2);
});

test('explicit generation enables only the chosen month, including a zero percent increase', async t => {
  const { db, context, query } = setup(t);
  await context.syncMonthFakeEntriesTx({ query }, 7, 2, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM petrol_divide_entries WHERE is_fake = TRUE').get().n, 0);
  await context.generatePetrolDivideFakeEntries(7, '2026-10', 0);
  assert.equal(db.prepare('SELECT fake_entries_enabled FROM petrol_divide_months WHERE id = 2').get().fake_entries_enabled, 1);
  assert.equal(db.prepare('SELECT amount_used FROM petrol_divide_entries WHERE month_id = 2 AND is_fake = TRUE').get().amount_used, 200);
});

test('config preserves omitted settings and validates boolean values', async t => {
  const { db, context } = setup(t);
  await context.savePetrolDivideMonthConfig(7, { month_key: '2026-10', petrol_price: 100 });
  assert.equal(db.prepare('SELECT fake_entries_enabled FROM petrol_divide_months WHERE id = 2').get().fake_entries_enabled, 0);
  await context.savePetrolDivideMonthConfig(7, { month_key: '2026-10', petrol_price: 100, fake_entries_enabled: true });
  assert.equal(db.prepare('SELECT count(*) AS n FROM petrol_divide_entries WHERE month_id = 2 AND is_fake = TRUE').get().n, 1);
  await assert.rejects(context.savePetrolDivideMonthConfig(7, { month_key: '2026-10', petrol_price: 100, fake_entries_enabled: 'false' }), /true or false/);
});
