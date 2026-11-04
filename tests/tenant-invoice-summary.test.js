const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const summary = require('../public/js/tenant-invoice-summary');

const invoice = (name, rent, previous, current, extra, units, electricity, total, other = []) => ({
  tenant_name_snapshot: name, invoice_month: '2026-11', rent_amount_snapshot: rent,
  cleaning_charge_snapshot: 150, water_charge_snapshot: 0,
  previous_electricity_units: previous, current_electricity_units: current,
  extra_electricity_units: extra, electricity_units_used: units, electricity_amount: electricity,
  total_amount: total, other_charge_items: other,
  other_charges_snapshot: other.reduce((sum, item) => sum + item.amount, 0),
});
const invoices = [
  invoice('Deeksha', 12000, 3101, 3128, 49, 76, 760, 12910),
  invoice('Poonam', 11500, 4107, 4385, -49, 229, 2061, 14111, [{ detail: 'car wash', amount: 400 }]),
  invoice('Kajal', 10000, 398, 485, 0, 87, 870, 11020),
  invoice('Dimple', 12000, 7726, 7844, 0, 118, 1180, 13330),
];
test('matches the sample breakdown and totals, including signed extra electricity units', () => {
  const result = summary.build(invoices, '2026-11');
  assert.equal(result.tenants[0].text, 'Deeksha\nRent - 12000\nGarbage - 150\nWater - 0\nElectricity - 3128 - 3101 (+49) = 76 => 760\nTotal - 12910');
  assert.match(result.tenants.find(t => t.name === 'Poonam').text, /car wash - 400\nElectricity - 4385 - 4107 \(-49\) = 229 => 2061/);
  assert.match(result.tenants.find(t => t.name === 'Kajal').text, /485 - 398 = 87 => 870/);
  assert.equal(result.total, 51371);
  assert.equal(result.totalsText, 'Deeksha - 12910, Dimple - 13330, Kajal - 11020, Poonam - 14111\nTotal - 51371');
  assert.equal(result.text, [...result.tenants.map(t => t.text), result.totalsText].join('\n\n'));
});
test('selects only the chosen month and preserves saved historical amounts', () => {
  const source = [...invoices, { ...invoices[0], invoice_month: '2026-10', rent_amount_snapshot: 10500, total_amount: 11410 }];
  const before = JSON.stringify(source);
  assert.equal(summary.build(source, '2026-11').tenants.length, 4);
  const result = summary.build(source, '2026-10');
  assert.equal(result.total, 11410);
  assert.match(result.text, /Rent - 10500/);
  assert.equal(JSON.stringify(source), before);
  assert.equal(summary.build(source, '2026-09').text, '');
});
test('keeps sewerage, custom charges, decimal amounts and legacy unitemized charges', () => {
  const row = { ...invoices[0], sewerage_charge_snapshot: 25.5, other_charges_snapshot: 150, other_charge_items: [{ detail: 'Milk', amount: 100.25 }] };
  const text = summary.build([row], '2026-11').text;
  assert.match(text, /Sewerage - 25.5\nMilk - 100.25\nOther charges - 49.75/);
});
test('web and mobile use identical summary formatting', () => {
  const mobilePath = path.resolve(__dirname, '../../ExpenseManager_mobile/src/utils/tenantInvoiceSummary.js');
  assert.equal(fs.readFileSync(mobilePath, 'utf8'), fs.readFileSync(path.resolve(__dirname, '../public/js/tenant-invoice-summary.js'), 'utf8'));
  assert.deepEqual(require(mobilePath).build(invoices, '2026-11'), summary.build(invoices, '2026-11'));
});
