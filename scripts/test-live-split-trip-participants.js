const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../db/postgres-core.js'), 'utf8');
const start = source.indexOf('async function assertLiveSplitTripParticipants(');
const end = source.indexOf('\nasync function syncSingleLiveSplitGroupShares(', start);
const context = vm.createContext({ validationError: (message) => new Error(message) });
vm.runInContext(source.slice(start, end), context);

const members = [
  { friend_id: null, member_name: 'You', permission: 'owner', target_user_id: 10 },
  { friend_id: 100, member_name: 'Old name', permission: 'edit', target_user_id: 20 },
  { friend_id: 200, member_name: 'Guest', permission: 'view', target_user_id: null },
];
const client = { query: async () => ({ rows: members }) };
const validate = (splits) => context.assertLiveSplitTripParticipants(client, 42, splits);

test('accepts a trip member through another friend record linked to the same account', async () => {
  await validate([{ friend_id: 999, friend_name: 'New name', linked_user_id: 20 }]);
});

test('accepts the trip owner when another member records the expense', async () => {
  await validate([{ friend_id: 888, friend_name: 'Owner display name', linked_user_id: 10 }]);
});

test('keeps existing friend ID and unlinked guest name matching', async () => {
  await validate([{ friend_id: 100, friend_name: 'Renamed' }]);
  await validate([{ friend_id: 777, friend_name: ' guest ' }]);
});

test('rejects a linked account outside the trip', async () => {
  await assert.rejects(validate([{ friend_id: 999, friend_name: 'Outsider', linked_user_id: 30 }]), /trip members only/);
});

test('does not accept an outsider using the owner placeholder name', async () => {
  await assert.rejects(validate([{ friend_id: 999, friend_name: 'You' }]), /trip members only/);
});

test('allows self-only entries and does not restrict non-trip splits', async () => {
  await validate([]);
  await context.assertLiveSplitTripParticipants({ query: () => { throw new Error('Unexpected query'); } }, null, []);
});
