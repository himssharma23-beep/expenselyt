const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildLiveSplitFriendPdfPayload } = require('../utils/live-split-friend-pdf');
const { buildStructuredPdfHtml } = require('../utils/shared-pdf-html');

test('current balance stays constant when the selected period changes', () => {
  const input = { row: { name: 'Friend', amount: -1594.4 }, fromDate: '2026-09-01', toDate: '2026-09-30', scoped: { filteredEvents: [{ date: '2026-09-19', delta: 20975 }], total: 999 } };
  const september = buildLiveSplitFriendPdfPayload(input);
  const june = buildLiveSplitFriendPdfPayload({ ...input, fromDate: '2026-06-01', toDate: '2026-06-30', scoped: { filteredEvents: [{ date: '2026-06-09', delta: -2485.39 }] } });
  assert.deepEqual(september.totals.cards[0], june.totals.cards[0]);
  assert.equal(september.totals.cards[0].label, 'Overall to pay');
  assert.match(september.totals.cards[0].value, /1,594\.40/);
  assert.equal(september.totals.cards[2].label, 'Selected range to receive');
  assert.match(september.totals.cards[2].value, /20,975\.00/);
  assert.equal(june.totals.cards[2].label, 'Selected range to pay');
  assert.match(june.totals.cards[2].value, /2,485\.39/);
  const html = buildStructuredPdfHtml(september);
  assert.match(html, /Overall to pay/);
  assert.match(html, /Selected range to receive/);
  assert.doesNotMatch(html, />Fair<|>Extra</);
});

test('settled current balance and signed period entries remain distinct', () => {
  const payload = buildLiveSplitFriendPdfPayload({ row: { amount: 0 }, scoped: { filteredEvents: [{ delta: 10 }, { delta: -5 }] } });
  assert.equal(payload.totals.cards[0].label, 'Overall settled');
  assert.equal(payload.totals.cards[2].label, 'Selected range to receive');
  assert.match(payload.tables[0].rows[0][4], /^\+/);
  assert.match(payload.tables[0].rows[1][4], /^-/);
});

const mobileFile = path.resolve(__dirname, '../../ExpenseManager_mobile/src/screens/LiveSplitScreen.js');
test('actual web and mobile export handlers submit identical reports', { skip: !fs.existsSync(mobileFile) }, async () => {
  const row = { name: 'Friend', linked_user_id: 9, amount: -1594.4 };
  const events = [{ date: '2026-09-19', delta: 20975, details: 'September entry' }];
  const scoped = { filteredEvents: events, tripSections: [], total: 20975 };
  const common = { buildRowEvents: () => events, buildLiveSplitFriendPdfScopedData: () => scoped, toLocalIsoDate: value => value };
  let webReport;
  const web = vm.createContext({ ...common, findVisibleRow: () => row, loadTripLedgersForSummaryEvents: async () => {}, getLiveSplitFriendPdfDateBounds: () => ({ min: '2026-09-01', max: '2026-09-30' }), _currentUser: { currency_code: 'INR' }, toast: () => assert.fail('Unexpected web error'), renderSharedPdfFileWindow: async report => { webReport = report; } });
  const webSource = fs.readFileSync(path.join(__dirname, '../public/js/live-split.js'), 'utf8');
  vm.runInContext(webSource.slice(webSource.indexOf('  async function liveSplitDownloadFriendPdf('), webSource.indexOf('  function liveSplitApplyFriendPdfPreset(')), web);
  await web.liveSplitDownloadFriendPdf('friend', '2026-09-01', '2026-09-30');
  let mobileReport;
  const mobile = vm.createContext({ ...common, detailsRow: row, rowDetailTripLedgers: {}, groups: [], sharedGroups: [], liveTrips: [], friends: [], userName: 'Me', currentUser: { id: 1, currency_code: 'INR' }, setDetailPdfBusy: () => {}, setShowDetailPdfModal: () => {}, sanitizePdfFilename: value => value, Alert: { alert: (...args) => assert.fail(args.join(': ')) }, shareSharedTemplatePdf: async (template, payload) => { mobileReport = { template, payload }; } });
  const mobileSource = fs.readFileSync(mobileFile, 'utf8');
  vm.runInContext(mobileSource.slice(mobileSource.indexOf('  async function exportLiveSplitFriendPdf('), mobileSource.indexOf('  async function saveTripManageSettings(')), mobile);
  await mobile.exportLiveSplitFriendPdf('2026-09-01', '2026-09-30');
  assert.deepEqual(JSON.parse(JSON.stringify(webReport)), JSON.parse(JSON.stringify(mobileReport)));
  assert.equal(buildStructuredPdfHtml(buildLiveSplitFriendPdfPayload(webReport.payload)), buildStructuredPdfHtml(buildLiveSplitFriendPdfPayload(mobileReport.payload)));
});
