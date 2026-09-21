const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/live-split.js'), 'utf8');
const code = source.slice(source.indexOf('  function getTripScanCurrentUser('), source.indexOf('  function tripCreateSelectedFriends('));

function setup(userDeclaration = 'let _currentUser = { id: 20 };') {
  const requests = [];
  const errors = [];
  const context = vm.createContext({
    window: {},
    state: { tripSaveBusy: false, friends: [
      { id: 100, name: 'Owner', linked_user_id: 10 },
      { id: 200, name: 'Guest' },
    ] },
    fetchTripLedger: async () => ({
      id: 42, name: 'Trip', is_owner: false, members: [
        { permission: 'owner', target_user_id: 10, member_name: 'You' },
        { permission: 'edit', target_user_id: 20, member_name: 'Current user' },
        { permission: 'view', friend_id: 200, member_name: 'Guest' },
      ],
    }),
    ensureFinanceOptionsLoaded: async () => {},
    createInitialTripForm: () => ({}),
    toLocalIsoDate: (value) => value,
    todayLocalIso: () => '2026-09-19',
    textKey: (value) => String(value).trim().toLowerCase(),
    renderTripCreateModal() {},
    toast: (message) => errors.push(message),
    api: async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/auth/me') return { id: 20 };
      throw new Error('Unexpected friend mutation');
    },
  });
  vm.runInContext(userDeclaration + '\n' + code, context);
  return { context, requests, errors };
}

test('popup scanner reads the global lexical user without a window property', async () => {
  const { context, requests, errors } = setup();
  assert.equal(context.window._currentUser, undefined);
  await context.openTripScanModal(42);
  assert.deepEqual([...context.state.tripCreate.selected], ['100', '200']);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
});

test('friend resolver never creates or links the current user', async () => {
  const { context, requests } = setup();
  assert.equal(await context.ensureTripScanFriend({ target_user_id: 20 }), null);
  assert.deepEqual(requests, []);
});

test('missing local user falls back to the authenticated account endpoint', async () => {
  const { context, requests, errors } = setup('');
  await context.openTripScanModal(42);
  assert.deepEqual([...context.state.tripCreate.selected], ['100', '200']);
  assert.deepEqual(requests.map((request) => request.url), ['/api/auth/me']);
  assert.deepEqual(errors, []);
});

test('unresolved identity blocks friend mutations', async () => {
  const { context, requests } = setup('');
  await assert.rejects(context.ensureTripScanFriend({ target_user_id: 20 }), /identify your account/);
  assert.deepEqual(requests, []);
});
