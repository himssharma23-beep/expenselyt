const { test } = require('node:test');
const assert = require('node:assert/strict');
const { participants, validateReminder, dueSlot } = require('../utils/trip-checklist');

const trip = { id: 1, user_id: 10, owner_name: 'Owner', isOwner: false, userPermission: 'view',
  start_date: '2026-11-10', status: 'upcoming', members: [
    { id: 1, member_name: 'Owner again', linked_user_id: 10 },
    { id: 2, member_name: 'Alice', linked_user_id: 20 },
    { id: 3, member_name: 'Guest' },
  ] };
const reminder = { enabled: true, days_before: 9, frequency: 'daily', time: '09:00', timezone: 'Asia/Kolkata' };
test('each linked user has one independent checklist and can only check their own', () => {
  const people = participants(trip, 20);
  assert.equal(people.length, 3);
  assert.deepEqual(people.filter(p => p.can_check).map(p => p.key), ['u:20']);
  assert.deepEqual(participants({ ...trip, isOwner: true }, 10).filter(p => p.can_check).map(p => p.key), ['u:10', 'g:guest']);
});
test('guest keys survive member row recreation', () => {
  assert.equal(participants(trip, 10)[2].key, participants({ ...trip, members: [{ id: 99, member_name: ' Guest ' }] }, 10)[0].key);
});
const fourMemberTrip = { ...trip, user_id: 10, owner_name: 'Himanshu Sharma', isOwner: true,
  members: ['Himanshu', 'Harpreet', 'Deepak', 'Gaurav'].map((member_name, id) => ({ id, member_name })) };
test('four listed members produce exactly four checklists even when owner has a different display name', () => {
  const people = participants(fourMemberTrip, 10);
  assert.deepEqual(people.map(p => p.name), ['Himanshu', 'Harpreet', 'Deepak', 'Gaurav']);
  assert.equal(people.some(p => p.key === 'u:10'), false);
  assert.equal(participants({ ...fourMemberTrip, members: [] }, 10).length, 0);
});
test('duplicate linked accounts get one checklist with the member roster display name', () => {
  const people = participants({ ...trip, members: [...trip.members, { member_name: 'Alice duplicate', linked_user_id: 20 }] }, 20);
  assert.equal(people.length, 3);
  assert.equal(people.filter(p => p.user_id === 20).length, 1);
});
test('reminder validates schedule and timezone', () => {
  assert.equal(validateReminder(reminder).timezone, 'Asia/Kolkata');
  for (const patch of [{ days_before: -1 }, { days_before: 1.5 }, { days_before: 366 }, { time: '24:00' }, { frequency: 'hourly' }, { timezone: 'Invalid/Zone' }, { enabled: 'false' }]) {
    assert.throws(() => validateReminder({ ...reminder, ...patch }));
  }
});
test('reminders respect the selected local date and time, not server timezone', () => {
  assert.equal(dueSlot(trip, reminder, new Date('2026-10-31T12:00:00Z')), null);
  assert.equal(dueSlot(trip, reminder, new Date('2026-11-01T03:29:00Z')), null);
  assert.ok(dueSlot(trip, reminder, new Date('2026-11-01T03:30:00Z')));
});
test('daily, weekly and once have stable dedupe slots, including catchup', () => {
  const date = day => new Date(`2026-11-${String(day).padStart(2, '0')}T04:00:00Z`);
  assert.notEqual(dueSlot(trip, reminder, date(1)), dueSlot(trip, reminder, date(2)));
  const weekly = { ...reminder, frequency: 'weekly' };
  assert.equal(dueSlot(trip, weekly, date(1)), dueSlot(trip, weekly, date(7)));
  assert.notEqual(dueSlot(trip, weekly, date(7)), dueSlot(trip, weekly, date(8)));
  const once = { ...reminder, frequency: 'once' };
  assert.equal(dueSlot(trip, once, date(1)), dueSlot(trip, once, date(10)));
});
test('disabled, finished and past trips do not remind', () => {
  const now = new Date('2026-11-10T04:00:00Z');
  assert.equal(dueSlot(trip, { ...reminder, enabled: false }, now), null);
  for (const status of ['completed', 'cancelled']) assert.equal(dueSlot({ ...trip, status }, reminder, now), null);
  assert.equal(dueSlot(trip, reminder, new Date('2026-11-11T04:00:00Z')), null);
});

// Exercise the database boundary with isolated dependencies; no real account data is changed.
let queries = [];
let accessible = trip;
let itemExists = true;
let summaryRows = [];
const fakeQuery = async (sql, params) => {
  queries.push({ sql, params });
  if (sql.startsWith('SELECT i.trip_id')) return { rows: summaryRows };
  if (sql.startsWith('SELECT id, title')) return { rows: [{ id: '1', title: 'Passport' }, { id: '2', title: 'Charger' }] };
  if (sql.startsWith('SELECT c.item_id')) return { rows: [{ item_id: '1', participant_key: 'u:20' }] };
  if (sql.startsWith('SELECT enabled')) return { rows: [] };
  return { rows: itemExists ? [{ id: '1' }] : [] };
};
for (const [path, exports] of [
  ['../db/postgres', { query: fakeQuery }],
  ['../db/postgres-core', { getTripById: async () => accessible }],
]) require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports };
const db = require('../db/trip-checklist');
test('grid totals exclude stale owner checks and count each shared item only once', () => {
  const summary = db.summarize(fourMemberTrip, [
    { id: '1', participant_key: 'g:himanshu' },
    { id: '1', participant_key: 'u:10' },
    { id: '2', participant_key: null },
  ], 10);
  assert.equal(summary.member_count, 4);
  assert.equal(summary.item_count, 2);
  assert.equal(summary.total_checks, 8);
  assert.equal(summary.complete, 1);
  assert.equal(summary.remaining, 7);
  assert.equal(summary.percent, 13);
});
test('trip grid summaries use one batched query and keep trips separate', async () => {
  queries = [];
  summaryRows = [{ trip_id: 1, id: '1', participant_key: 'g:himanshu' }];
  const trips = await db.summarizeTrips(10, [fourMemberTrip, { ...fourMemberTrip, id: 2 }]);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [[1, 2]]);
  assert.equal(trips[0].packing_summary.percent, 25);
  assert.equal(trips[1].packing_summary.item_count, 0);
  assert.equal(trips[1].packing_summary.ready_members, 0);
  queries = [];
  assert.deepEqual(await db.summarizeTrips(10, []), []);
  assert.equal(queries.length, 0);
});
test('API state gives independent completion percentages for all users', async () => {
  const list = await db.load(20, 1);
  assert.deepEqual(list.participants.map(p => p.percent), [0, 50, 0]);
  assert.equal(list.participants[1].remaining, 1);
  assert.equal(list.can_edit, false);
  assert.equal(list.can_remind, true);
});
test('authorization rejects other users checks, read-only list edits and outsiders reminders', async () => {
  await assert.rejects(db.check(20, 1, 1, { participant_key: 'u:10', checked: true }), { statusCode: 403 });
  await assert.rejects(db.editItem(20, 1, null, { title: 'Shoes' }), { statusCode: 403 });
  await assert.rejects(db.saveReminder(99, 1, reminder), { statusCode: 403 });
  await assert.rejects(db.check(20, 1, 1, { participant_key: 'u:20', checked: 'false' }), { statusCode: 400 });
});
test('checks are scoped to trip and update just one participant', async () => {
  queries = [];
  await db.check(20, 1, 1, { participant_key: 'u:20', checked: true });
  assert.deepEqual(queries[0].params, [1, 1]);
  assert.deepEqual(queries[1].params, [1, 'u:20']);
  assert.match(queries[1].sql, /ON CONFLICT DO NOTHING/);
  itemExists = false;
  await assert.rejects(db.check(20, 1, 999, { participant_key: 'u:20', checked: true }), { statusCode: 404 });
  itemExists = true;
});
test('no access to checklist data after trip access is removed', async () => {
  accessible = null;
  await assert.rejects(db.load(20, 1), { statusCode: 404 });
  accessible = trip;
});
test('check endpoint enforces shared checklist allow and deny permissions', async () => {
  accessible = { ...trip, shared_users: [{ linked_user_id: 99, checklist_can_check: true, checklist_member_key: 'g:guest' }] };
  await db.check(99, 1, 1, { participant_key: 'g:guest', checked: true });
  await assert.rejects(db.check(99, 1, 1, { participant_key: 'u:20', checked: true }), { statusCode: 403 });
  accessible.shared_users[0].checklist_can_check = false;
  await assert.rejects(db.check(99, 1, 1, { participant_key: 'g:guest', checked: true }), { statusCode: 403 });
  accessible = trip;
});
