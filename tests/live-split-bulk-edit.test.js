const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const bulk = require('../public/js/live-split-bulk-edit');
const original = { divide_date: '2026-10-31', details: 'Taxi', paid_by: 'You', finance_target: 'card', card_id: 9, bank_account_id: null, card_discount_pct: 5, total_amount: 200, splits: [{ friend_id: 5, share_amount: 100 }] };
const values = { divide_date: '2026-11-04', details: 'Travel', paid_by: 'You', finance_target: 'expense', bank_account_id: 8, card_id: null, card_discount_pct: 0 };
test('all 16 checkbox combinations change only the selected fields', () => {
  const keys = ['divide_date', 'details', 'paid_by', 'finance'];
  for (let bits = 0; bits < 16; bits++) {
    const selected = Object.fromEntries(keys.map((key, i) => [key, !!(bits & (1 << i))]));
    const row = bulk.apply(original, values, selected);
    for (const key of keys.slice(0, 3)) assert.equal(row[key], selected[key] ? values[key] : original[key]);
    assert.equal(row.finance_target, selected.finance ? 'expense' : 'card');
    assert.equal(row.card_id, selected.finance ? null : 9);
    assert.equal(row.bank_account_id, selected.finance ? 8 : null);
    assert.equal(row.total_amount, 200);
    assert.deepEqual(row.splits, original.splits);
  }
  assert.equal(original.details, 'Taxi');
});
test('date-only changes preserve different payers and payment sources', () => {
  for (const row of [original, { ...original, paid_by: 'Saurav Sharma', finance_target: 'none', card_id: null }]) {
    const next = bulk.apply(row, { ...values, paid_by: 'Harpreet' }, { divide_date: true });
    assert.deepEqual(next, { ...row, divide_date: values.divide_date });
  }
});
test('changing payer to another member clears account-owned sources without changing names or dates', () => {
  const next = bulk.apply(original, { ...values, paid_by: 'Harpreet' }, { paid_by: true });
  assert.equal(next.paid_by, 'Harpreet');
  assert.equal(next.finance_target, 'none');
  assert.equal(next.card_id, null);
  assert.equal(next.divide_date, original.divide_date);
  assert.equal(next.details, original.details);
});

function extract(source, name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end + 4);
}
const web = fs.readFileSync(path.resolve(__dirname, '../public/js/live-split.js'), 'utf8').replace(/\r\n/g, '\n');
const mobilePath = path.resolve(__dirname, '../../ExpenseManager_mobile/src/screens/LiveSplitScreen.js');
const mobile = fs.readFileSync(mobilePath, 'utf8').replace(/\r\n/g, '\n');

test('web header edits remain drafts until Apply and date selection preserves payers', () => {
  const state = { tripBulkEdit: { ...values, selected: { divide_date: true } }, tripBulkEditRows: [{ ...original }] };
  const ctx = vm.createContext({ state, liveSplitBulkEdit: bulk, renderTripBulkEditModal() {}, toLocalIsoDate: value => value, todayLocalIso: () => '2026-11-04', textKey: value => value.toLowerCase() });
  vm.runInContext(extract(web, 'setTripBulkEditHeaderField') + '\n' + extract(web, 'applyTripBulkEditHeaderToRows'), ctx);
  ctx.setTripBulkEditHeaderField('divide_date', '2026-11-05');
  assert.equal(state.tripBulkEditRows[0].divide_date, original.divide_date);
  ctx.applyTripBulkEditHeaderToRows();
  assert.deepEqual(state.tripBulkEditRows[0], { ...original, divide_date: '2026-11-05' });
});
test('mobile date-only Apply preserves payers and sources; editing headers does not apply', () => {
  let rows = [original];
  let date = '2026-11-04';
  const ctx = vm.createContext({ liveSplitBulkEdit: bulk, tripBulkEditSelected: { divide_date: true }, tripBulkEditName: '', tripBulkEditDate: date, tripBulkEditPaidBy: 'Harpreet', tripBulkEditFinanceTarget: 'none', tripBulkEditBankId: '', tripBulkEditCardId: '', tripBulkEditCardDiscount: '0', toLocalIsoDate: value => value, setTripBulkEditRows: fn => { rows = fn(rows); }, setTripBulkEditDate: value => { date = value; } });
  vm.runInContext(extract(mobile, 'applyTripBulkEditHeaderToRows') + '\n' + extract(mobile, 'setTripBulkEditHeaderField'), ctx);
  ctx.setTripBulkEditHeaderField('divide_date', '2026-11-05');
  assert.equal(date, '2026-11-05');
  assert.equal(rows[0].divide_date, original.divide_date);
  ctx.applyTripBulkEditHeaderToRows();
  assert.deepEqual(rows[0], { ...original, divide_date: '2026-11-04' });
});
test('web and mobile use identical field selection logic', () => {
  assert.equal(fs.readFileSync(path.resolve(__dirname, '../../ExpenseManager_mobile/src/utils/liveSplitBulkEdit.js'), 'utf8'), fs.readFileSync(path.resolve(__dirname, '../public/js/live-split-bulk-edit.js'), 'utf8'));
});
