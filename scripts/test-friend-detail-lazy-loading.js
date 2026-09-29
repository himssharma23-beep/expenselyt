const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../public/js/live-split.js'), 'utf8');
function webContext() {
  const calls = [];
  const events = [{ trip_id: 11, delta: 10 }];
  const grouped = [['June', { events, total: 10 }], ['May', { events: [{ trip_id: 22 }], total: 20 }]];
  const context = vm.createContext({
    friendDetailView: { grouped, row: { name: 'Friend' }, rowFriendId: 5, rowRefToken: '5' },
    state: {}, window: {},
    findVisibleRow: () => ({ name: 'Friend' }), resolveFriendIdForRow: () => 5,
    buildRowEvents: () => events, groupEventsByMonth: () => grouped,
    r2: Number, n: Number, escHtml: String, fmtCur: String,
    getLiveSplitFriendPdfDateBounds: () => ({ min: '2026-05-01', max: '2026-06-30' }),
    openModal: (title, html) => { context.html = html; },
    fetchTripLedger: async (id) => { calls.push(id); },
    renderFriendMonthContent: () => '<table>entries</table>',
    api: async (url) => { calls.push(url); return { activities: [] }; },
    friendActivityHtml: () => 'activity',
  });
  vm.runInContext(source.slice(source.indexOf('  async function toggleFriendMonth('), source.indexOf('  async function openTripDetails(')), context);
  return { context, calls };
}
function element(open = false) {
  const nodes = {};
  return { open, dataset: {}, isConnected: true, nodes, querySelector: (key) => nodes[key] ||= {} };
}

test('web opens with empty collapsed month/activity bodies and no detail requests', async () => {
  const { context, calls } = webContext();
  await context.openRowDetails('5');
  assert.equal(calls.length, 0);
  assert.equal((context.html.match(/<details /g) || []).length, 3);
  assert.doesNotMatch(context.html, /<details[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(context.html, /<table/);
});
test('web loads only the expanded month and reuses it when reopened', async () => {
  const { context, calls } = webContext();
  const section = element();
  await context.toggleFriendMonth(section, 0);
  assert.deepEqual(calls, []);
  section.open = true;
  await context.toggleFriendMonth(section, 0);
  assert.deepEqual(calls, [11]);
  section.open = false;
  await context.toggleFriendMonth(section, 0);
  section.open = true;
  await context.toggleFriendMonth(section, 0);
  assert.deepEqual(calls, [11]);
});
test('web activity is fetched only on first expansion', async () => {
  const { context, calls } = webContext();
  const section = element();
  await context.toggleFriendActivity(section);
  assert.deepEqual(calls, []);
  section.open = true;
  await context.toggleFriendActivity(section);
  await context.toggleFriendActivity(section);
  assert.deepEqual(calls, ['/api/live-split/friends/5/activity']);
});
test('web failed month can retry and stale results do not render', async () => {
  const { context } = webContext();
  const section = element(true);
  context.fetchTripLedger = async () => { throw new Error('offline'); };
  await context.toggleFriendMonth(section, 0);
  assert.equal(section.dataset.loaded, undefined);
  assert.equal(section.dataset.loading, undefined);
  context.fetchTripLedger = async () => { context.friendDetailView = {}; };
  await context.toggleFriendMonth(section, 0);
  assert.equal(section.dataset.loaded, undefined);
});

const mobilePath = path.resolve(__dirname, '../../ExpenseManager_mobile/src/screens/LiveSplitScreen.js');
test('mobile loads only the selected month, caches it, and ignores a previous friend response', { skip: !fs.existsSync(mobilePath) }, async () => {
  const mobile = fs.readFileSync(mobilePath, 'utf8');
  const calls = [];
  const context = vm.createContext({
    expandedDetailMonths: new Set(), loadingDetailMonths: new Set(),
    loadedDetailMonths: { current: new Set() }, pendingDetailMonths: { current: new Set() },
    detailLoadSession: { current: 1 }, rowDetailTripLedgers: {},
    Alert: { alert: () => assert.fail('Unexpected load failure') },
    get: async (url) => { calls.push(url); return { trip: { id: 11 } }; },
  });
  context.setExpandedDetailMonths = (fn) => { context.expandedDetailMonths = fn(context.expandedDetailMonths); };
  context.setLoadingDetailMonths = (fn) => { context.loadingDetailMonths = fn(context.loadingDetailMonths); };
  context.setRowDetailTripLedgers = (fn) => { context.rowDetailTripLedgers = fn(context.rowDetailTripLedgers); };
  const start = mobile.indexOf('  async function toggleDetailMonth(');
  vm.runInContext(mobile.slice(start, mobile.indexOf('  const detailCurrentBalance', start)), context);
  await context.toggleDetailMonth('June', { events: [{ trip_id: 11 }, { trip_id: 11 }] });
  assert.deepEqual(calls, ['/api/live-split/trips/11/ledger']);
  await context.toggleDetailMonth('June', { events: [{ trip_id: 11 }] });
  await context.toggleDetailMonth('June', { events: [{ trip_id: 11 }] });
  assert.equal(calls.length, 1);
  context.get = async () => { context.detailLoadSession.current++; return { trip: { id: 22 } }; };
  await context.toggleDetailMonth('May', { events: [{ trip_id: 22 }] });
  assert.equal(context.rowDetailTripLedgers[22], undefined);
});
