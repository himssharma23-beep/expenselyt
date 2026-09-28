const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const web = fs.readFileSync(path.join(__dirname, '../public/js/live-split.js'), 'utf8');
const friends = [
  { id: 1, name: 'test', linked_user_id: null },
  { id: 2, name: 'Registered', linked_user_id: 20 },
  { id: 3, name: 'Me', linked_user_id: 10 },
];
const helpers = web.slice(web.indexOf('  function ensureRow('), web.indexOf('  function findExistingLinkedRowByName('));
function context() {
  return vm.createContext({
    window: { _currentUser: { id: 10 } },
    state: { friends, rows: [] },
    r2: (value) => Math.round(Number(value || 0) * 100) / 100,
    isSelfLinkedEntity: (row) => Number(row.linked_user_id) === 10,
    reconcileVisibleLiveSplitRows: (rows) => rows,
    collapseMirroredLiveSplitAliases: (rows) => rows,
  });
}

test('web main list includes an unregistered friend with no expenses', () => {
  const ctx = context();
  vm.runInContext(web.slice(web.indexOf('  function buildVisibleLiveSplitRows('), web.indexOf('  function reconcileVisibleLiveSplitRows(')), ctx);
  const rows = ctx.buildVisibleLiveSplitRows();
  assert.deepEqual(Array.from(rows, (row) => row.friend_id), [1, 2]);
  assert.equal(rows[0].name, 'test');
  assert.equal(rows[0].amount, 0);
});

test('web summary includes both registered and unregistered friends, excluding self', () => {
  const ctx = context();
  vm.runInContext(helpers + web.slice(web.indexOf('  function computeLiveSplitRows('), web.indexOf('  function buildVisibleLiveSplitRows(')), ctx);
  const result = ctx.computeLiveSplitRows(friends, [], []);
  assert.deepEqual(Array.from(result.rows, (row) => row.friend_id).sort(), [1, 2]);
});

const mobilePath = path.resolve(__dirname, '../../ExpenseManager_mobile/src/screens/LiveSplitScreen.js');
test('mobile main summary includes an unregistered friend before signup', { skip: !fs.existsSync(mobilePath) }, () => {
  const source = fs.readFileSync(mobilePath, 'utf8');
  const start = source.indexOf('function computeRows(');
  const end = source.indexOf('\nfunction ', start + 1);
  const ctx = context();
  vm.runInContext(helpers + source.slice(start, end), ctx);
  const result = ctx.computeRows(friends, [], [], 'Me', 'me', 10);
  assert.deepEqual(Array.from(result.rows, (row) => row.friend_id).sort(), [1, 2]);
  assert.equal(result.rows.find((row) => row.friend_id === 1).amount, 0);
});

test('adding an unregistered email succeeds even if invitation delivery fails', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
  const start = source.indexOf("router.post('/live-split/invite',");
  const end = source.indexOf("router.post('/live-split/invite-user',", start);
  let handler;
  let savedName;
  let savedInvite;
  const ctx = vm.createContext({
    router: { post: (_route, callback) => { handler = callback; } },
    isEmailAddress: () => true,
    process: { env: {} },
    pgDb: { findUserById: async () => ({ display_name: 'Sender' }), findUserByEmail: async () => null },
    deriveInviteName: () => 'test',
    buildLiveSplitInviteRegisterUrl: () => 'https://example.com/register',
    getCoreDb: () => ({
      getLiveSplitFriends: async () => [],
      addLiveSplitFriend: async (_id, name) => { savedName = name; },
      createLiveSplitInvite: async (invite) => { savedInvite = invite; return { invite_token: 'token' }; },
    }),
    sendLiveSplitInviteEmail: async () => { throw new Error('Mail unavailable'); },
  });
  vm.runInContext(source.slice(start, end), ctx);
  let response;
  let status = 200;
  const res = { status: (value) => { status = value; return res; }, json: (body) => { response = body; } };
  await handler({ body: { target: 'test@yopmail.com' }, session: { userId: 10 }, protocol: 'https', get: () => 'example.com' }, res);
  assert.equal(status, 200);
  assert.equal(response.success, true);
  assert.equal(response.invite_sent, false);
  assert.equal(savedName, 'test');
  assert.equal(savedInvite.targetEmail, 'test@yopmail.com');
});
