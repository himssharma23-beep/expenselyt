const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, monthlyUnits } = require('../db/tenant-inverter-meters');

test('monthly units exclude opening readings, combine intervals and keep months separate', () => {
  assert.deepEqual(monthlyUnits([
    { reading_date: '2026-09-01', reading: 100, units_used: null },
    { reading_date: '2026-09-30', reading: 120, units_used: 20 },
    { reading_date: '2026-10-01', reading: 120.1, units_used: '0.1' },
    { reading_date: '2026-10-06', reading: 120.3, units_used: '0.2' },
    { reading_date: '2026-11-01', reading: 150.3, units_used: 30 },
  ]), { '2026-09': 20, '2026-10': 0.3, '2026-11': 30 });
  assert.deepEqual(monthlyUnits([]), {});
});

test('current reading preview subtracts last reading and adds only the selected month total', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/tenants.js'), 'utf8');
  const elements = {
    inverterPreview9: { dataset: { previous: '120.1', months: JSON.stringify({ '2026-10': 20, '2026-09': 50 }) }, textContent: '' },
    inverterValue9: { value: '125.4' }, inverterDate9: { value: '2026-10-06' },
  };
  const context = vm.createContext({ document: { getElementById: id => elements[id] }, window: {} });
  vm.runInContext(source.slice(source.indexOf('function previewTenantInverterUnits(')), context);
  context.previewTenantInverterUnits(9);
  assert.match(elements.inverterPreview9.textContent, /125.4 - 120.1 = 5.3 units used/);
  assert.match(elements.inverterPreview9.textContent, /2026-10 total after saving: 25.3 units/);
  elements.inverterDate9.value = '2026-11-01';
  context.previewTenantInverterUnits(9);
  assert.match(elements.inverterPreview9.textContent, /2026-11 total after saving: 5.3 units/);
  elements.inverterValue9.value = '100'; context.previewTenantInverterUnits(9);
  assert.match(elements.inverterPreview9.textContent, /cannot be lower/);
  elements.inverterValue9.value = ''; context.previewTenantInverterUnits(9);
  assert.match(elements.inverterPreview9.textContent, /Enter the current reading/);
});

function setup({ ownTenant = true, ownMeter = true, ownBuilding = true, allowedRooms = [3, 4], latest = { reading_date: '2026-10-01', reading: '12.5' } } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('CREATE')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM tenant_buildings')) return { rows: ownBuilding ? [{ id: params[0] }] : [] };
    if (sql.startsWith('SELECT id, room_id')) return { rows: ownTenant ? [{ id: 2, room_id: 3, building_id: 5 }] : [] };
    if (sql.startsWith('SELECT r.id')) return { rows: params[0].filter(id => allowedRooms.includes(id)).map(id => ({ id })) };
    if (sql.startsWith('INSERT INTO tenant_inverter_meters')) return { rows: [{ id: 9, tenant_id: params[2], name: params[3] }] };
    if (sql.startsWith('INSERT INTO tenant_inverter_meter_rooms')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM tenant_inverter_meters')) return { rows: ownMeter ? [{ id: 9 }] : [] };
    if (sql.startsWith('SELECT reading_date')) return { rows: latest ? [latest] : [] };
    if (sql.startsWith('INSERT INTO tenant_inverter_readings')) return { rows: [{ id: 10, reading: params[2] }] };
    if (sql.startsWith('SELECT m.*')) return { rows: [{ id: 9, readings: [] }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  return { store: createStore({ query, withTransaction: fn => fn({ query }), ensureTenantTables: async () => {} }), calls };
}
const opening = { name: 'Inverter 1', scope: 'tenant', reading_date: '2026-10-01', reading: '0' };
test('dedicated meter stores opening reading and never changes invoices', async () => {
  const { store, calls } = setup();
  const meter = await store.create(1, 2, opening);
  assert.equal(meter.tenant_id, 2);
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT INTO tenant_inverter_readings')).params, [9, '2026-10-01', 0, '']);
  assert.ok(calls.every(call => !/tenant_invoices|UPDATE tenant_records/.test(call.sql)));
});
test('shared meter links selected rooms once and is not dedicated to one tenant', async () => {
  const { store, calls } = setup();
  const meter = await store.create(1, 2, { ...opening, scope: 'shared', room_ids: [3, 4, 4] });
  assert.equal(meter.tenant_id, null);
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT INTO tenant_inverter_meter_rooms')).params, [9, [3, 4]]);
});
test('rejects rooms outside the building/account, missing current room, and unowned tenant', async () => {
  await assert.rejects(setup().store.create(1, 2, { ...opening, scope: 'shared', room_ids: [3, 99] }), /this building/);
  await assert.rejects(setup().store.create(1, 2, { ...opening, scope: 'shared', room_ids: [4] }), /this tenant/);
  await assert.rejects(setup({ ownTenant: false }).store.create(1, 2, opening), /Tenant not found/);
  await assert.rejects(setup({ ownTenant: false }).store.list(1, 2), /Tenant not found/);
});
test('only owned meters accept chronologically increasing cumulative readings', async () => {
  const { store, calls } = setup();
  const row = await store.addReading(1, 9, { reading_date: '2026-10-06', reading: '15.75', note: 'Checked' });
  assert.equal(row.reading, 15.75);
  assert.ok(calls.some(call => call.sql.includes('FOR UPDATE') && call.params[1] === 1));
  await assert.rejects(store.addReading(1, 9, { reading_date: '2026-10-01', reading: 20 }), /after the latest/);
  await assert.rejects(store.addReading(1, 9, { reading_date: '2026-10-06', reading: 5 }), /lower than/);
  await assert.rejects(setup({ ownMeter: false }).store.addReading(1, 9, { reading_date: '2026-10-06', reading: 20 }), /Meter not found/);
});
test('rejects invalid dates, readings, names and sharing mode', async () => {
  for (const reading of ['', null, -1, 'NaN', 'Infinity', '1.123', 100000001]) {
    await assert.rejects(setup().store.create(1, 2, { ...opening, reading }), /reading/);
  }
  for (const reading_date of ['2026-02-30', 'invalid', '2026-13-01']) {
    await assert.rejects(setup().store.create(1, 2, { ...opening, reading_date }), /valid reading date/);
  }
  await assert.rejects(setup().store.create(1, 2, { ...opening, name: ' ' }), /Meter name/);
  await assert.rejects(setup().store.create(1, 2, { ...opening, scope: 'invalid' }), /Choose/);
});
test('history lookup is account scoped and includes room-shared meters with calculated usage', async () => {
  const { store, calls } = setup();
  await store.list(1, 2);
  const history = calls.find(call => call.sql.startsWith('SELECT m.*'));
  assert.deepEqual(history.params, [1, 2, 3, null]);
  assert.match(history.sql, /m.user_id = \$1/);
  assert.match(history.sql, /mr.room_id = \$3/);
  assert.match(history.sql, /LAG\(reading\)/);
});

test('building tab lists all building meters without requiring a tenant', async () => {
  const { store, calls } = setup({ ownTenant: false });
  await store.list(1, null, 5);
  assert.deepEqual(calls.find(call => call.sql.startsWith('SELECT m.*')).params, [1, null, null, 5]);
  await assert.rejects(setup({ ownBuilding: false }).store.list(1, null, 5), /Building not found/);
});

test('building tab creates shared meters for vacant rooms and validates dedicated assignments', async () => {
  const { store, calls } = setup({ ownTenant: false });
  await store.create(1, null, { ...opening, scope: 'shared', room_ids: [4] }, 5);
  assert.deepEqual(calls.find(call => call.sql.startsWith('INSERT INTO tenant_inverter_meter_rooms')).params, [9, [4]]);
  const dedicated = await setup().store.create(1, null, { ...opening, tenant_id: 2 }, 5);
  assert.equal(dedicated.tenant_id, 2);
  await assert.rejects(setup().store.create(1, null, opening, 5), /Select a tenant/);
  await assert.rejects(setup().store.create(1, null, { ...opening, tenant_id: 2 }, 6), /this building/);
  await assert.rejects(setup({ ownBuilding: false }).store.create(1, null, { ...opening, scope: 'shared', room_ids: [4] }, 5), /Building not found/);
});
