const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');

function functionSource(source, name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, `Missing ${name}`);
  const end = source.indexOf('\n}', match.index);
  assert.ok(end > match.index);
  return source.slice(match.index, end + 2);
}
const backend = fs.readFileSync(path.resolve(__dirname, '../db/postgres-tenants.js'), 'utf8').replace(/\r\n/g, '\n');
const history = [
  { effective_from: '2026-12-01', effective_to: null, rent_amount: 13000 },
  { effective_from: '2026-11-04', effective_to: '2026-11-30', rent_amount: 12000, monthly_additional_charges: [] },
  { effective_from: '2026-07-02', effective_to: '2026-11-03', rent_amount: 10500 },
];

for (const file of ['../db/postgres-tenants.js', '../public/js/tenants.js', '../../ExpenseManager_mobile/src/screens/TenantsScreen.js']) {
  test(`${file}: invoice rates follow effective dates, including mid-month changes`, () => {
    const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
    const context = vm.createContext({ todayISO: () => '2026-11-04', tenantLocalDateValue: () => '2026-11-04' });
    const isBackend = file.includes('/db/');
    const pickName = isBackend ? 'pickChargeProfileForDate' : 'tenantChargeProfileForMonth';
    vm.runInContext(functionSource(source, 'tenantInvoiceReferenceDate') + '\n' + functionSource(source, pickName), context);
    const ref = context.tenantInvoiceReferenceDate;
    assert.equal(ref('2026-11', '2026-11-04'), '2026-11-04');
    assert.equal(ref('2026-10', '2026-11-04'), '2026-10-31');
    assert.equal(ref('2026-12', '2026-11-04'), '2026-12-01');
    assert.equal(ref('2028-02', '2028-03-04'), '2028-02-29');
    assert.equal(ref('2026-13', '2026-11-04'), '');
    const pick = (month) => isBackend
      ? context[pickName](history, ref(month, '2026-11-04'))
      : context[pickName]({ charge_history: history }, month);
    assert.equal(pick('2026-11').rent_amount, 12000);
    assert.equal(pick('2026-10').rent_amount, 10500);
    assert.equal(pick('2026-12').rent_amount, 13000);
    if (isBackend) assert.equal(context[pickName](history, '2026-11-03').rent_amount, 10500);
  });
}

function invoiceStore(existing = null) {
  let saved;
  const context = vm.createContext({
    ensureTenantTables: async () => {},
    getTenantOwnedByUser: async () => ({ building_id: 1, room_id: 2, rent_amount: 13000, monthly_additional_charges: [{ detail: 'Future charge', amount: 500 }] }),
    getBuildingOwnedByUser: async () => ({}),
    getRoomOwnedByUser: async () => ({ id: 2 }),
    currentDateValue: () => '2026-11-04',
    listTenantChargeHistory: async () => history,
    countRoomTenantsForInvoiceMonth: async () => 1,
    getSameRoomInvoiceForMonth: async () => null,
    getLastInvoiceForTenant: async () => null,
    buildTenantPendingCarryForwardItems: async () => [],
    normalizeMonthKey: value => value,
    normalizeInteger: value => Number(value || 0),
    normalizeAmount: value => Number(value || 0),
    normalizeOtherChargeItems: items => items || [],
    normalizeOptionalDateValue: value => value || null,
    normalizeOptionalText: value => value || null,
    normalizeTenantInvoiceSplitConfig: () => ({}),
    applySplitToOtherChargeItems: items => items,
    stripCarryForwardChargeItems: items => items,
    sumOtherChargeItems: items => items.reduce((sum, item) => sum + item.amount, 0),
    normalizeTenantPaymentStatus: () => 'pending',
    divideTenantChargeAmount: value => value,
    num: value => Number(value || 0),
    mapInvoiceRow: row => row,
    query: async (sql, params) => {
      if (sql.includes('SELECT *') && sql.includes('FROM tenant_invoices')) return { rows: existing ? [existing] : [] };
      if (sql.includes('INSERT INTO tenant_invoices')) {
        saved = { rent_amount_snapshot: params[7], total_amount: params[19], other_charge_items: JSON.parse(params[13]) };
        return { rows: [saved] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  });
  for (const name of ['tenantMeterPreviousUnits', 'tenantInvoiceReferenceDate', 'pickChargeProfileForDate', 'createOrUpdateTenantInvoice']) {
    vm.runInContext(functionSource(backend, name), context);
  }
  return context.createOrUpdateTenantInvoice;
}

test('new and regenerated November invoices persist the new rent, without future recurring charges', async () => {
  for (const existing of [null, { previous_electricity_units: 0, roommate_count_snapshot: 1, other_charge_items: [] }]) {
    const result = await invoiceStore(existing)(1, 3, { invoice_month: '2026-11', current_electricity_units: 0 });
    assert.equal(result.rent_amount_snapshot, 12000);
    assert.equal(result.total_amount, 12000);
    assert.equal(result.other_charge_items.length, 0);
  }
});

test('historical invoice generation and explicit rent overrides remain supported', async () => {
  assert.equal((await invoiceStore()(1, 3, { invoice_month: '2026-10', current_electricity_units: 0 })).rent_amount_snapshot, 10500);
  assert.equal((await invoiceStore()(1, 3, { invoice_month: '2026-11', current_electricity_units: 0, rent_amount: 11500 })).rent_amount_snapshot, 11500);
});
