const { test } = require('node:test');
const assert = require('node:assert/strict');
let rows = [];
let list;
const sent = [];
for (const [path, exports] of [
  ['../db/postgres', { query: async () => ({ rows }) }],
  ['../db/trip-checklist', { load: async () => list }],
  ['../utils/user-push-events', { createAndSendUserNotification: async (user, payload) => { sent.push({ user, payload }); } }],
]) require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports };
const { runTripChecklistReminders } = require('../utils/trip-checklist-reminders');
test('scheduler sends only outstanding personal items with a trip link and dedupe key', async () => {
  rows = [{ trip_id: 1, user_id: '20', enabled: true, start_date: '2026-11-10', days_before: 3,
    frequency: 'daily', time: '09:00', timezone: 'Asia/Kolkata', status: 'upcoming', destination: 'Goa' }];
  list = { items: [{ id: '1', title: 'Passport' }, { id: '2', title: 'Charger' }],
    participants: [{ user_id: 20, remaining: 1, checked_items: ['1'] }] };
  await runTripChecklistReminders(new Date('2026-11-08T04:00:00Z'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].user.id, '20');
  assert.match(sent[0].payload.body, /Charger/);
  assert.doesNotMatch(sent[0].payload.body, /Passport/);
  assert.deepEqual(sent[0].payload.target_params, { tripId: 1 });
  assert.match(sent[0].payload.dedupe_key, /^trip-packing:1:/);
});
test('scheduler skips completed checklists, removed participants, and cancelled trips', async () => {
  const before = sent.length;
  list.participants[0].remaining = 0;
  await runTripChecklistReminders(new Date('2026-11-08T04:00:00Z'));
  list.participants = [];
  await runTripChecklistReminders(new Date('2026-11-08T04:00:00Z'));
  rows[0].status = 'cancelled';
  await runTripChecklistReminders(new Date('2026-11-08T04:00:00Z'));
  assert.equal(sent.length, before);
});
test('owner reminders still cover guest checklists without creating an owner traveller', async () => {
  rows[0].status = 'upcoming';
  list.participants = [{ user_id: null, can_check: true, remaining: 1, checked_items: ['1'] }];
  const before = sent.length;
  await runTripChecklistReminders(new Date('2026-11-08T04:00:00Z'));
  assert.equal(sent.length, before + 1);
  assert.match(sent.at(-1).payload.body, /Charger/);
});
