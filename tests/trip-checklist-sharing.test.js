const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tripChecklistMemberOptions, matchTripChecklistMember } = require('../public/js/trip-checklist-identity');
const { participants } = require('../utils/trip-checklist');
const trip = { id: 1, isOwner: false, user_id: 10, members: [
  { member_name: 'Deepak' }, { member_name: 'Harpreet' },
] };
test('name suggestions support short trip names, prefer linked accounts, and avoid ambiguity', () => {
  const members = tripChecklistMemberOptions(trip);
  assert.equal(matchTripChecklistMember({ id: 20, display_name: 'Deepak Kataria' }, members), 'g:deepak');
  assert.equal(matchTripChecklistMember({ id: 30, display_name: 'Navjot Singh' }, members), '');
  assert.equal(matchTripChecklistMember({ display_name: 'Deepak Kataria' }, [...members, { key: 'g:deepak singh', name: 'Deepak Singh' }]), '');
  assert.equal(matchTripChecklistMember({ id: 20, display_name: 'Deepak Kataria' }, [{ key: 'u:20', name: 'DK', user_id: 20 }, ...members]), 'u:20');
});
test('shared view user can check only assigned member when allowed; revoking blocks it', () => {
  const shared = { ...trip, shared_users: [{ linked_user_id: 20, checklist_member_key: 'g:deepak', checklist_can_check: true }] };
  const people = participants(shared, 20);
  assert.equal(people.length, 2);
  assert.deepEqual(people.filter(p => p.can_check).map(p => p.key), ['g:deepak']);
  assert.equal(people[0].user_id, 20);
  assert.equal(participants({ ...shared, shared_users: [{ ...shared.shared_users[0], checklist_can_check: false }] }, 20).some(p => p.can_check), false);
  assert.equal(participants({ ...shared, isOwner: true }, 10).filter(p => p.can_check).length, 2);
});
test('share edit permission alone never permits checking a guest checklist', () => {
  assert.equal(participants({ ...trip, shared_users: [{ linked_user_id: 20, permission: 'edit', checklist_can_check: false }] }, 20).some(p => p.can_check), false);
});
let calls = [], owned = true, existing = false, taken = false;
let roster = trip.members;
const query = async (sql, params) => {
  calls.push({ sql, params });
  if (sql.includes('SELECT id FROM trips')) return { rows: owned ? [{ id: 1 }] : [] };
  if (sql.includes('FROM users WHERE id')) return { rows: [{ id: 20, display_name: 'Deepak Kataria', username: 'deepak' }] };
  if (sql.includes('SELECT member_name, linked_user_id')) return { rows: roster };
  if (sql.includes('linked_user_id <>')) return { rows: taken ? [{ id: 88 }] : [] };
  if (sql.includes('SELECT id') && sql.includes('FROM trip_members')) return { rows: existing ? [{ id: 77 }] : [] };
  return { rows: [{ id: 77 }] };
};
for (const [name, exports] of [['../db/postgres', { query }], ['../db/postgres-billing', {}], ['../db/source-bank-payment', {}]]) {
  require.cache[require.resolve(name)] = { id: require.resolve(name), filename: require.resolve(name), loaded: true, exports };
}
const core = require('../db/postgres-core');
test('sharing persists checklist permission separately from view permission', async () => {
  calls = [];
  await core.shareTripWithUser(10, 1, 20, 'view', { can_check: true, member_key: 'g:deepak' });
  const write = calls.find(c => c.sql.includes('INSERT INTO trip_members'));
  assert.deepEqual(write.params, [1, 'Deepak Kataria', 20, 'share_view', true, 'g:deepak']);
});
test('existing share can revoke checkbox permission', async () => {
  calls = []; existing = true;
  await core.shareTripWithUser(10, 1, 20, 'view', { can_check: false, member_key: 'g:deepak' });
  const write = calls.find(c => c.sql.includes('UPDATE trip_members'));
  assert.deepEqual(write.params, ['Deepak Kataria', 'share_view', 77, false, 'g:deepak']);
  existing = false;
});
test('rejects nonmembers, another linked account, duplicate assignments, and nonowners', async () => {
  await assert.rejects(core.shareTripWithUser(10, 1, 20, 'view', { can_check: true, member_key: 'g:outsider' }));
  roster = [{ member_name: 'Deepak', linked_user_id: 99 }];
  await assert.rejects(core.shareTripWithUser(10, 1, 20, 'view', { can_check: true, member_key: 'u:99' }));
  roster = trip.members; taken = true;
  await assert.rejects(core.shareTripWithUser(10, 1, 20, 'view', { can_check: true, member_key: 'g:deepak' }), /already assigned/);
  taken = false; owned = false;
  await assert.rejects(core.shareTripWithUser(99, 1, 20, 'view', { can_check: true, member_key: 'g:deepak' }), /Trip not found/);
  owned = true;
});
