const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const source = fs.readFileSync(path.join(__dirname, '../db/postgres-core.js'), 'utf8');
function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.function('NOW', () => '2026-09-28');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE society_members (id INTEGER PRIMARY KEY, society_id INTEGER);
    INSERT INTO society_members VALUES (1, 10), (2, 20);
    CREATE TABLE society_function_contributors (
      id INTEGER PRIMARY KEY, society_id INTEGER, function_id INTEGER,
      member_id INTEGER REFERENCES society_members(id), outside_name TEXT, outside_phone TEXT,
      amount NUMERIC, contributed_on TEXT, notes TEXT, created_at TEXT, updated_at TEXT
    );
  `);
  const context = vm.createContext({
    query: async (sql, params) => ({ rows: db.prepare(sql).all(Object.fromEntries(params.map((v, i) => [`$${i + 1}`, v]))) }),
    getSocietyOwnedByUser: async (user, society) => user === 5 && society === 10 ? { id: 10 } : null,
    getSocietyFunctionOwnedBySociety: async (society, fn) => society === 10 && fn === 50 ? { id: 50 } : null,
    num: Number, formatDateOnlyValue: (value) => value,
    normalizeDateValue: (value) => value,
    normalizeAmount: (value) => { if (!(Number(value) > 0)) throw new Error('Invalid amount'); return Number(value); },
    validationError: (message) => new Error(message),
  });
  const mapStart = source.indexOf('function mapSocietyFunctionContributorRow(');
  const mapEnd = source.indexOf('function normalizeText(', mapStart);
  const normalizeEnd = source.indexOf('\nfunction ', source.indexOf('function normalizeOptionalText(', mapEnd) + 10);
  const start = source.indexOf('async function saveSocietyFunctionContributor(');
  const end = source.indexOf('async function deleteSocietyFunctionContributor(', start);
  vm.runInContext(source.slice(mapStart, normalizeEnd) + source.slice(start, end), context);
  return { save: context.saveSocietyFunctionContributor, db };
}

test('outside contribution saves without a member and returns editable identity', async (t) => {
  const { save, db } = setup(t);
  const result = await save(5, 10, 50, { contributor_type: 'outside', outside_name: '  Visiting Guest  ', outside_phone: '1234567890', amount: 250, contributed_on: '2026-09-28' });
  assert.equal(result.member_id, null);
  assert.equal(result.contributor_type, 'outside');
  assert.equal(result.outside_name, 'Visiting Guest');
  assert.equal(result.outside_phone, '1234567890');
  assert.equal(result.amount, 250);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM society_members').get().count, 2);
});

test('contributions can switch from member to outsider and back without stale identity fields', async (t) => {
  const { save } = setup(t);
  const entry = await save(5, 10, 50, { member_id: 1, amount: 100 });
  assert.equal(entry.contributor_type, 'member');
  const outside = await save(5, 10, 50, { contributor_type: 'outside', member_id: 1, outside_name: 'Guest', amount: 200 }, entry.id);
  assert.equal(outside.member_id, null);
  assert.equal(outside.outside_name, 'Guest');
  const member = await save(5, 10, 50, { contributor_type: 'member', member_id: 1, outside_name: 'Guest', amount: 300 }, entry.id);
  assert.equal(member.member_id, 1);
  assert.equal(member.outside_name, '');
  assert.equal(member.outside_phone, '');
});

test('outside name is required and existing member ownership checks still apply', async (t) => {
  const { save } = setup(t);
  await assert.rejects(save(5, 10, 50, { contributor_type: 'outside', outside_name: ' ', amount: 10 }), /name is required/);
  await assert.rejects(save(5, 10, 50, { member_id: 2, amount: 10 }), /Member not found/);
  await assert.rejects(save(5, 10, 50, { amount: 10 }), /Member is required/);
  await assert.rejects(save(6, 10, 50, { contributor_type: 'outside', outside_name: 'Guest', amount: 10 }), /Society not found/);
  await assert.rejects(save(5, 10, 99, { contributor_type: 'outside', outside_name: 'Guest', amount: 10 }), /Function not found/);
});

test('outside contributions participate in function totals alongside member contributions', async (t) => {
  const { save, db } = setup(t);
  await save(5, 10, 50, { member_id: 1, amount: 100 });
  await save(5, 10, 50, { contributor_type: 'outside', outside_name: 'Guest', amount: 250 });
  assert.equal(db.prepare('SELECT SUM(amount) AS total FROM society_function_contributors WHERE function_id = 50').get().total, 350);
});
