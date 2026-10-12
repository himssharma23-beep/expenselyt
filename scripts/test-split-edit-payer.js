const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const backend = fs.readFileSync(path.join(__dirname, '../db/postgres-core.js'), 'utf8');
const context = vm.createContext({validationError: message => new Error(message)});
for (const [start, end] of [
  ['function normalizeLiveSplitPayerName(', 'function normalizeLiveSplitDuplicateDetails('],
  ['async function assertLiveSplitTripPayerAllowed(', 'async function assertLiveSplitTripParticipants('],
]) vm.runInContext(backend.slice(backend.indexOf(start), backend.indexOf(end)), context);

test('trip payer validation accepts member identities and entry-owner aliases but rejects outsiders', async () => {
  const client = {query: async (sql, params) => {
    assert.deepEqual(Array.from(params), [9, 21]);
    assert.match(sql, /local_friend.user_id = \$2/);
    assert.match(sql, /WHERE m.trip_id = \$1/);
    return {rows: [
      {member_name: 'You', display_name: 'Trip Creator', username: 'creator'},
      {member_name: 'Old nickname', friend_name: 'Updated name', display_name: 'Member Name', local_friend_name: 'My friend alias'},
      {member_name: 'Entry Creator', display_name: 'Entry Creator', username: 'entry_creator'},
    ]};
  }};
  for (const name of ['You', 'Trip Creator', 'Entry Creator', 'entry_creator', 'Old nickname', 'Updated name', 'Member Name', 'My friend alias', '  MEMBER   NAME ']) {
    await context.assertLiveSplitTripPayerAllowed(client, 9, name, 21);
  }
  await assert.rejects(context.assertLiveSplitTripPayerAllowed(client, 9, 'Unrelated person', 21), /payer must be/);
  await context.assertLiveSplitTripPayerAllowed({query: () => {throw Error('unexpected query');}}, null, 'Ordinary split payer', 21);
});

test('create and update validation use the entry owner, including edits by another shared member', () => {
  assert.match(backend, /assertLiveSplitTripPayerAllowed\(client, tripId, data.paid_by, ownerUserId\)/);
  assert.match(backend, /const ownerUserId = Number\(group.user_id\)/);
  assert.match(backend, /assertLiveSplitTripPayerAllowed\(client, nextTripId, data.paid_by, ownerUserId\)/);
});

for (const [platform, file] of [
  ['web', '../public/js/live-split.js'],
  ['mobile', '../../ExpenseManager_mobile/src/screens/LiveSplitScreen.js'],
]) test(`${platform}: editing saves the entry owner as You and preserves another payer`, () => {
  const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  const start = source.indexOf('async function saveEditedExpense(');
  const paidBy = source.indexOf('paid_by:', start) + 'paid_by:'.length;
  const end = source.indexOf(',\n', paidBy);
  const expression = source.slice(paidBy, end).trim();
  for (const key of ['owner:21', 'friend:34']) {
    const name = key === 'owner:21' ? 'Entry Creator' : 'Friend';
    const result = vm.runInNewContext(`(${expression})`, {
      payer: {key, name}, matchedPayer: {key, name}, payerName: name,
      form: {owner_key: 'owner:21'}, editExpense: {ownerKey: 'owner:21'},
    });
    assert.equal(result, key === 'owner:21' ? 'You' : 'Friend');
  }
});
