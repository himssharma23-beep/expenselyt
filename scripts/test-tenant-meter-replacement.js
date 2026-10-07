const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const backend = fs.readFileSync(path.join(__dirname, '../db/postgres-tenants.js'), 'utf8');
const files = ['../db/postgres-tenants.js', '../public/js/tenants.js', '../../ExpenseManager_mobile/src/screens/TenantsScreen.js'];
for (const file of files) {
  const target = path.resolve(__dirname, file);
  test(`${file}: new meter baseline and subsequent invoices preserve history`, { skip: !fs.existsSync(target) }, () => {
    const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    const end = source.indexOf('\n}\n') + 3;
    const context = vm.createContext({});
    vm.runInContext(source.slice(0, end), context);
    const previous = context.tenantMeterPreviousUnits;
    const room = { meter_replacements: [{ effective_month: '2026-10', starting_reading: 0 }, { effective_month: '2026-12', starting_reading: 5 }] };
    assert.equal(previous(room, '2026-10', { invoice_month: '2026-09', current_electricity_units: 9000 }, 400), 0);
    assert.equal(previous(room, '2026-11', { invoice_month: '2026-10', current_electricity_units: 125 }, 400), 125);
    assert.equal(previous(room, '2026-09', { invoice_month: '2026-08', current_electricity_units: 8700 }, 400), 8700);
    assert.equal(previous(room, '2026-12', { invoice_month: '2026-11', current_electricity_units: 240 }, 400), 5);
    assert.equal(previous(room, '2026-10', { invoice_month: '2026-10', current_electricity_units: 125 }, 400), 125);
    assert.equal(previous({}, '2026-09', null, 400), 400);
  });
}

function setup({ latest = '2026-09', owned = true } = {}) {
  let saved = null;
  const queries = [];
  const context = vm.createContext({
    ensureTenantTables: async () => {},
    getTenantOwnedByUser: async () => owned ? { room_id: 3 } : null,
    validationError: message => new Error(message),
    normalizeMonthKey: value => String(value || ''),
    normalizeInteger: (value, label, { min, max }) => {
      if (!Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('Invalid reading');
      return Number(value);
    },
    withTransaction: fn => fn({ query: async (sql, params) => {
      queries.push(sql);
      if (sql.startsWith('SELECT * FROM tenant_rooms')) return { rows: [{ meter_replacements: [] }] };
      if (sql.includes('MAX(inv.invoice_month)')) return { rows: [{ latest_month: latest }] };
      if (sql.startsWith('UPDATE tenant_rooms')) { saved = JSON.parse(params[0]); return { rows: [] }; }
      throw new Error('Unexpected query');
    } }),
  });
  vm.runInContext(backend.slice(backend.indexOf('async function replaceTenantMeter('), backend.indexOf('module.exports = {')), context);
  return { save: context.replaceTenantMeter, get saved() { return saved; }, queries };
}
test('replacement is stored on the room without updating existing invoices', async () => {
  const store = setup();
  await store.save(1, 2, { effective_month: '2026-10', starting_reading: '0' });
  assert.deepEqual(store.saved, [{ effective_month: '2026-10', starting_reading: 0 }]);
  assert.ok(store.queries.every(sql => !/UPDATE tenant_invoices|DELETE/.test(sql)));
});
test('ownership, already-billed months, invalid months and invalid readings are rejected', async () => {
  await assert.rejects(setup({ owned: false }).save(1, 2, {}), /Tenant not found/);
  await assert.rejects(setup().save(1, 2, { effective_month: '2026-09', starting_reading: 0 }), /after 2026-09/);
  await assert.rejects(setup().save(1, 2, { effective_month: '2026-13', starting_reading: 0 }), /valid billing month/);
  for (const reading of [-1, 1.5, '', null]) await assert.rejects(setup().save(1, 2, { effective_month: '2026-10', starting_reading: reading }));
});
