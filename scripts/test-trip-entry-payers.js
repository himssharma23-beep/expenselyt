const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const [platform, file, call, ending] of [
  ['web', '../public/js/live-split.js', 'const savedEntry = await persistLiveSplitEntry({', '\n          });'],
  ['mobile', '../../ExpenseManager_mobile/src/screens/LiveSplitScreen.js', 'return persistLiveSplitDraftEntry({', '\n            });'],
]) {
  const target = path.resolve(__dirname, file);
  test(`${platform}: mixed payers and default payer are saved per row without posting friends' payments`, { skip: !fs.existsSync(target) }, async () => {
    const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    const saveStart = source.indexOf('async function saveLiveSplitTrip(');
    const start = source.indexOf('const rowPaidBy =', saveStart);
    const declarationEnd = source.indexOf('\n', source.indexOf('const rowPaidBySelf =', start));
    const callStart = source.indexOf(call, start);
    const callEnd = source.indexOf(ending, callStart) + ending.length;
    const body = source.slice(start, declarationEnd) + '\n' + source.slice(callStart, callEnd);
    const outputs = [];
    const context = vm.createContext({
      appliedPaidBy: 'You', appliedBulkDate: '2026-10-08', appliedFinanceTarget: 'card', appliedBankAccountId: null, appliedCardId: 7, appliedCardDiscountPct: 5,
      amountValue: 100, splitModeValue: 'equal', createdTripId: 9,
      participants: [{ key: 'self', share_value: 50 }, { key: '2', share_value: 50 }],
      form: { start_date: '2026-10-01' }, todayLocalIso: () => '2026-10-08', toLocalIsoDate: value => value,
      textKey: value => String(value).toLowerCase(), r2: Number,
      persistLiveSplitEntry: async payload => { outputs.push(payload); },
      persistLiveSplitDraftEntry: async payload => { outputs.push(payload); },
    });
    for (const payer of ['You', 'Friend A', 'Friend B', '']) {
      context.row = { paid_by: payer, item_name: 'Dinner', split_mode: 'equal' };
      await vm.runInContext(`(async () => { ${body} })()`, context);
    }
    assert.deepEqual(outputs.map(row => row.paid_by), ['You', 'Friend A', 'Friend B', 'You']);
    assert.deepEqual(outputs.map(row => row.finance_target), ['card', 'none', 'none', 'card']);
    assert.deepEqual(outputs.map(row => row.card_id), [7, null, null, 7]);
    assert.deepEqual(outputs.map(row => row.paid_by_key), ['self', '', '', 'self']);
    assert.ok(outputs.every(row => row.trip_id === 9 && row.total_amount === 100));
  });
}
