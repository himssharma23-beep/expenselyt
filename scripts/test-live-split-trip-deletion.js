const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const source = fs.readFileSync(path.join(__dirname, '../db/postgres-core.js'), 'utf8');
const start = source.indexOf('async function deleteLiveSplitTrip(');
const end = source.indexOf('\nasync function addLiveSplitTripMembers(', start);

function fixture(t, failOnTripDelete = false) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  // Match the production foreign keys, including the trip's SET NULL behavior.
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE live_split_trips (id INTEGER PRIMARY KEY, user_id INTEGER);
    CREATE TABLE live_split_trip_members (
      id INTEGER PRIMARY KEY,
      trip_id INTEGER REFERENCES live_split_trips(id) ON DELETE CASCADE
    );
    CREATE TABLE live_split_groups (
      id INTEGER PRIMARY KEY, user_id INTEGER,
      trip_id INTEGER REFERENCES live_split_trips(id) ON DELETE SET NULL
    );
    CREATE TABLE live_split_splits (
      id INTEGER PRIMARY KEY,
      group_id INTEGER REFERENCES live_split_groups(id) ON DELETE CASCADE
    );
    CREATE TABLE live_split_group_shares (
      id INTEGER PRIMARY KEY,
      group_id INTEGER REFERENCES live_split_groups(id) ON DELETE CASCADE
    );
    INSERT INTO live_split_trips VALUES (1, 10), (2, 10);
    INSERT INTO live_split_trip_members VALUES (1, 1), (2, 2);
    INSERT INTO live_split_groups VALUES
      (101, 10, 1), (102, 20, 1), (103, 10, 2), (104, 10, NULL);
    INSERT INTO live_split_splits VALUES (1, 101), (2, 102), (3, 103), (4, 104);
    INSERT INTO live_split_group_shares VALUES (1, 101), (2, 102), (3, 103), (4, 104);
  `);
  const context = vm.createContext({
    validationError: (message) => new Error(message),
    withTransaction: async (work) => {
      db.exec('BEGIN');
      try {
        await work({ query: async (sql, params) => {
          if (failOnTripDelete && sql.startsWith('DELETE FROM live_split_trips ')) {
            throw new Error('Simulated deletion failure');
          }
          // SQLite runs the same deletion SQL; row locking is PostgreSQL-only.
          const statement = db.prepare(sql.replace(/\s+FOR UPDATE\s*$/, ''));
          const bindings = Object.fromEntries(params.map((value, i) => [`$${i + 1}`, value]));
          return { rows: statement.all(bindings) };
        } });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    remove: context.deleteLiveSplitTrip,
    ids: (table) => db.prepare(`SELECT id FROM ${table} ORDER BY id`).all().map((row) => row.id),
  };
}

test('deleting a trip removes owner and participant entries from friends, preserving unrelated entries', async (t) => {
  const { remove, ids } = fixture(t);
  await remove(10, 1);
  assert.deepEqual(ids('live_split_trips'), [2]);
  assert.deepEqual(ids('live_split_trip_members'), [2]);
  assert.deepEqual(ids('live_split_groups'), [103, 104]);
  assert.deepEqual(ids('live_split_splits'), [3, 4]);
  assert.deepEqual(ids('live_split_group_shares'), [3, 4]);
});

test('a non-owner cannot delete the trip or its friend entries', async (t) => {
  const { remove, ids } = fixture(t);
  await assert.rejects(remove(20, 1), /Trip not found/);
  assert.deepEqual(ids('live_split_trips'), [1, 2]);
  assert.deepEqual(ids('live_split_groups'), [101, 102, 103, 104]);
  assert.deepEqual(ids('live_split_splits'), [1, 2, 3, 4]);
  assert.deepEqual(ids('live_split_group_shares'), [1, 2, 3, 4]);
});

test('a failure rolls back trip entries, friend shares, and membership together', async (t) => {
  const { remove, ids } = fixture(t, true);
  await assert.rejects(remove(10, 1), /Simulated deletion failure/);
  assert.deepEqual(ids('live_split_trips'), [1, 2]);
  assert.deepEqual(ids('live_split_trip_members'), [1, 2]);
  assert.deepEqual(ids('live_split_groups'), [101, 102, 103, 104]);
  assert.deepEqual(ids('live_split_splits'), [1, 2, 3, 4]);
  assert.deepEqual(ids('live_split_group_shares'), [1, 2, 3, 4]);
});
