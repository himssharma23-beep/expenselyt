const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');

const source = fs.readFileSync(path.join(__dirname, '../db/postgres-core.js'), 'utf8');
function functionSource(name, next) {
  return source.slice(source.indexOf(`async function ${name}(`), source.indexOf(`async function ${next}(`));
}

function connectionFixture({ fail = false, alreadyLinked = false } = {}) {
  const calls = [];
  const target = { id: 20, email: 'friend@example.com', mobile: '+91 12345', display_name: 'Friend' };
  let invite;
  let committed = false;
  const client = { query: async (sql, params) => {
    const text = sql.replace(/\s+/g, ' ').trim();
    calls.push({ text, params });
    if (text.startsWith('SELECT pg_advisory')) return { rows: [] };
    if (text.startsWith('SELECT 1 FROM live_split_friends')) return { rows: alreadyLinked ? [{}] : [] };
    if (text.startsWith('SELECT id, invite_token')) return { rows: [] };
    if (text.startsWith('INSERT INTO live_split_invites')) {
      invite = { id: 7, inviter_user_id: params[0], target_user_id: params[1], invite_token: params[2], target_email: params[3], target_phone: params[4], status: 'pending' };
      return { rows: [invite] };
    }
    if (text.startsWith('SELECT * FROM users')) return { rows: [target] };
    if (text.startsWith('SELECT * FROM live_split_invites')) return { rows: [invite] };
    if (text.startsWith('SELECT id, display_name, username')) return { rows: [{ id: 10, display_name: 'Sender' }] };
    if (text.startsWith('SELECT id FROM live_split_friends')) return { rows: [{ id: params[0] === 10 ? 101 : 202 }] };
    if (fail && text.startsWith('UPDATE live_split_friends') && params[0] === 10) throw new Error('Reverse link failed');
    return { rows: [] };
  } };
  const context = vm.createContext({
    crypto: { randomUUID: () => 'token' },
    validationError: (message) => new Error(message),
    withTransaction: async (work) => { const result = await work(client); committed = true; return result; },
  });
  vm.runInContext(functionSource('createLiveSplitInvite', 'connectPendingLiveSplitFriends'), context);
  vm.runInContext(functionSource('acceptLiveSplitInvite', 'rejectLiveSplitInvite'), context);
  return { context, calls, committed: () => committed };
}

test('matched friend links both sides and shares historical splits before success', async () => {
  const { context, calls, committed } = connectionFixture();
  const result = await context.createLiveSplitInvite({ inviterUserId: 10, targetUserId: 20 });
  assert.equal(result.connected, true);
  assert.equal(result.friend_id, 101);
  assert.equal(result.reverse_friend_id, 202);
  const updates = calls.filter(({ text }) => text.startsWith('UPDATE live_split_friends'));
  assert.equal(updates.length, 2);
  assert.deepEqual(Array.from(updates[0].params).slice(0, 2), [20, 10]);
  assert.deepEqual(Array.from(updates[1].params), [10, 20, 202]);
  assert.ok(calls.some(({ text }) => text.startsWith('INSERT INTO live_split_group_shares')));
  assert.ok(calls.some(({ text }) => text.includes("SET status = 'accepted'")));
  assert.equal(committed(), true);
});

test('failure linking the recipient prevents committing the connection', async () => {
  const fixture = connectionFixture({ fail: true });
  await assert.rejects(fixture.context.createLiveSplitInvite({ inviterUserId: 10, targetUserId: 20 }), /Reverse link failed/);
  assert.equal(fixture.committed(), false);
});

test('repeated additions of an already connected pair do not create another invite', async () => {
  const { context, calls } = connectionFixture({ alreadyLinked: true });
  const result = await context.createLiveSplitInvite({ inviterUserId: 10, targetUserId: 20 });
  assert.equal(result.already_linked, true);
  assert.equal(calls.some(({ text }) => text.startsWith('INSERT')), false);
});

test('unregistered contacts remain pending and self additions are rejected', async () => {
  const { context, calls } = connectionFixture();
  const result = await context.createLiveSplitInvite({ inviterUserId: 10, targetEmail: 'new@example.com' });
  assert.equal(result.connected, undefined);
  assert.equal(calls.some(({ text }) => text.startsWith('UPDATE live_split_friends')), false);
  await assert.rejects(context.createLiveSplitInvite({ inviterUserId: 10, targetUserId: 10 }), /yourself/);
});

test('pending matching uses email or normalized phone, never name or blank contacts', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.function('regexp_replace', (value, pattern, replacement, flags) => String(value).replace(new RegExp(pattern, flags), replacement));
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, mobile TEXT, display_name TEXT, deleted_at TEXT);
    CREATE TABLE live_split_invites (id INTEGER PRIMARY KEY, inviter_user_id INTEGER, target_user_id INTEGER, target_email TEXT, target_phone TEXT, status TEXT);
    INSERT INTO users VALUES (10, 'sender@example.com', '', 'Sender', NULL),
      (20, 'friend@example.com', '+91 12345', 'Friend', NULL),
      (30, '', '', 'Friend', NULL), (40, 'deleted@example.com', '', 'Deleted', 'today');
    INSERT INTO live_split_invites VALUES
      (1, 10, NULL, ' FRIEND@EXAMPLE.COM ', NULL, 'pending'),
      (2, 10, NULL, NULL, '+91-12345', 'pending'),
      (3, 10, NULL, '', '', 'pending'),
      (4, 10, 30, 'friend@example.com', NULL, 'pending'),
      (5, 10, NULL, 'deleted@example.com', NULL, 'pending'),
      (6, 10, NULL, 'sender@example.com', NULL, 'pending');
  `);
  const linked = [];
  const context = vm.createContext({
    query: async (sql, params) => ({ rows: db.prepare(sql).all({ $1: params[0] }) }),
    acceptLiveSplitInvite: async (userId, inviteId) => linked.push([userId, inviteId]),
  });
  vm.runInContext(functionSource('connectPendingLiveSplitFriends', 'getLiveSplitInviteByToken'), context);
  await context.connectPendingLiveSplitFriends(20);
  assert.deepEqual(linked, [[20, 1], [20, 2]]);
  linked.length = 0;
  await context.connectPendingLiveSplitFriends(10);
  assert.deepEqual(linked, [[20, 1], [20, 2], [30, 4]]);
});
