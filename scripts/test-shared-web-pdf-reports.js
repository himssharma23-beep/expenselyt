const assert = require('node:assert/strict');
const test = require('node:test');
const { buildWebReport } = require('../utils/web-pdf-reports');
const { buildStructuredPdfHtml } = require('../utils/shared-pdf-html');
const { createPdfReportApi } = require('../utils/pdf-report-api');
const fs = require('node:fs');
const path = require('node:path');

const entry = { id: 1, name: 'Sample', item_name: 'Milk', amount: 100, total: 100, fair: 100, extra: 0, count: 1, year: 2026, month: 9, purchase_date: '2026-09-01', entry_date: '2026-09-01', quantity: 2, unit: 'litres', is_auto: true, entry_value: 1, is_active: true };
const cycle = { id: 1, cycle_start: '2026-09-01', cycle_end: '2026-09-30', total_amount: 100, net_payable: 90, total_discount: 10, txns: [{ txn_date: '2026-09-01', description: 'Purchase', amount: 100, net_amount: 90 }] };
const record = { id: 1, name: 'Loan', principal: 1000, tenure_months: 10, annual_rate: 0, monthly_emi: 100, installments: [{ installment_no: 1, emi_amount: 100, paid_amount: 100, due_date: '2026-09-01' }] };
const group = { id: 1, session_id: 'session', heading: 'Dinner', divide_date: '2026-09-01', paid_by: 'You', total_amount: 100, splits: [{ friend_name: 'Friend', share_amount: 50 }] };
const trip = { id: 1, name: 'Holiday', start_date: '2026-09-01', status: 'completed', total_amount: 100, members: [{ id: 1, name: 'You', member_name: 'You' }], expenses: [{ amount: 100, expense_date: '2026-09-01', description: 'Meal', paid_by_name: 'You', splits: [{ member_name: 'You', share_amount: 100 }] }] };
const api = async () => ({ cards: [entry], cycles: [cycle], months: [entry], years: [entry], trackers: [entry], entries: [entry], summary: { days: 1, total_amount: 100 }, record, friends: [{ name: 'Friend', balance: 100 }], netBalance: 100, payments: [{ name: 'Rent', amount: 100 }], projectedDefaults: [], ccDues: [], emiDues: [] });
const cases = [
  ['petrolDownloadPdf', ['real'], { petrolData: { month: { month_key: '2026-09' }, entries: [{ entry_date: '2026-09-01', amount_used: 100, distance_km: 20 }], totals: [{ friend_name: 'You', final_real: 100 }] } }],
  ['downloadCreditCardsPdf'], ['downloadCcCyclePdf', [1, 1, 'Card']], ['downloadCcHistoryPdf', [1, 'Card']], ['downloadCcMonthlySummaryPdf', [1, 'Card', 2026]], ['downloadCcYearlySummaryPdf', [1, 'Card']],
  ['downloadPlannerPdf', [], { _plannerMonth: '2026-09' }],
  ['downloadTrackerMonthPdf', [1, 'Milk', 2026, 9]], ['downloadTrackersOverviewPdf', [2026, 9]],
  ['downloadFixedDepositsPdf', [], { deposits: [{ person_name: 'Owner', amount_deposited: 100, maturity_amount: 110 }] }],
  ['downloadHabitTrackersOverviewPdf', [2026, 9]], ['downloadHabitTrackerDetailPdf', [1, 'Habit', 2026, 9]],
  ['downloadFriendsPdf'], ['downloadFriendDetailPdf', [], { _loanFriend: { name: 'Friend' }, _loanBalance: { balance: 100 }, _loanAllTxns: [{ id: 1, txn_date: '2026-09-01', paid: 100, received: 0 }] }],
  ['downloadSplitHistoryPdf', [], { _divGroups: [group] }], ['downloadSplitSessionPdf', ['session'], { _divGroups: [group] }],
  ['downloadEmisPdf', [[record]]], ['downloadEmiDetailPdf', [1]], ['downloadTripsPdf', [[trip]]], ['downloadTripDetailPdfEnhanced', [], { _tripDetail: trip }],
  ['downloadBankHistoryPdf', [], { _bankHistoryState: { bank: { bank_name: 'Bank', balance: 100 } }, bankRows: [{ created_at: '2026-09-01T12:00:00Z', direction: 'credit', amount: 100, balance_after: 100 }] }],
  ['printReport', ['years'], { _rptYearsData: [entry] }], ['printReport', ['months'], { _rptMonthsData: [entry], reportDrillYear: 2026 }], ['printReport', ['expenses'], { _rptExpData: [entry], reportDrillYear: 2026, reportDrillMonth: 9 }],
  ['downloadTenantInvoicePdf', [1], { _tenantOverview: { invoices: [{ id: 1, tenant_name_snapshot: 'Tenant', invoice_month: '2026-09', total_amount: 100 }] } }],
  ['downloadTenantReportPdf', [1], { building: { name: 'Building' }, snapshot: { invoiceCount: 1, totalAmount: 100 } }],
  ['downloadTenantMonthInvoicesPdf', [1, '2026-09'], { building: { name: 'Building' }, monthInvoices: [{ tenant_name_snapshot: 'Tenant', total_amount: 100 }] }],
  ['liveSplitTripReport', [], { trip, events: [{ date: '2026-09-01', details: 'Meal', total: 100, participants: [{ name: 'You', paid: true, share: 100 }] }] }],
];
for (const [report, args = [], data = {}] of cases) {
  test(`${report} ${args[0] || ''}: shared definition renders with populated data`, async () => {
    const payload = await buildWebReport({ report, args, data }, api);
    assert.ok(payload.title);
    const html = buildStructuredPdfHtml(payload);
    assert.match(html, /<html/);
    assert.doesNotMatch(html, /\bundefined\b|\bNaN\b/);
    const mobilePayload = await buildWebReport(JSON.parse(JSON.stringify({ report, args, data })), api);
    assert.deepEqual(mobilePayload, payload);
  });
}
test('unknown report names are rejected rather than invoking arbitrary functions', async () => {
  await assert.rejects(buildWebReport({ report: 'constructor' }, api), /Unknown/);
});
test('report data reader disallows external URLs and non-report endpoints', async () => {
  const read = createPdfReportApi({ socket: { localPort: 3000 }, headers: {} });
  await assert.rejects(read('https://example.com'), /Unsupported/);
  await assert.rejects(read('/api/admin/users'), /Unsupported/);
  await assert.rejects(read('/api/cc/cards/../../admin'), /Invalid/);
});

test('report data reads forward web cookies and mobile authorization to the local server', async t => {
  const http = require('node:http');
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, cookie: req.headers.cookie, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ cards: [] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const socket = { localPort: server.address().port };
  await createPdfReportApi({ socket, headers: { cookie: 'session=test-web' } })('/api/cc/cards');
  await createPdfReportApi({ socket, headers: { authorization: 'Bearer test-mobile' } })('/api/cc/cards');
  assert.equal(requests[0].cookie, 'session=test-web');
  assert.equal(requests[1].authorization, 'Bearer test-mobile');
  assert.equal(requests[0].url, requests[1].url);
});

const mobileRoot = path.resolve(__dirname, '../../ExpenseManager_mobile/src');
test('every named mobile report is covered by the shared report registry tests', { skip: !fs.existsSync(mobileRoot) }, () => {
  const covered = new Set(cases.map(([name]) => name));
  for (const file of fs.readdirSync(path.join(mobileRoot, 'screens')).filter(file => file.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(mobileRoot, 'screens', file), 'utf8');
    for (const match of source.matchAll(/shareWebReport\(['"]([^'"]+)['"]/g)) assert.ok(covered.has(match[1]), `${file}: ${match[1]} needs registry coverage`);
    assert.doesNotMatch(source, /await shareStructuredPdf\(|await shareReportPdf\(|function build\w*PdfHtml\(/, file);
  }
  const society = fs.readFileSync(path.join(mobileRoot, 'services/societyPdf.js'), 'utf8');
  assert.doesNotMatch(society, /shareHtmlPdf\(|buildFunctionPdfHtml/);
});
