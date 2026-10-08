const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const targets = [
  ['web', path.join(__dirname, '../public/js/live-split.js')],
  ['mobile', path.join(__dirname, '../../ExpenseManager_mobile/src/screens/LiveSplitScreen.js')],
];
for (const [platform, file] of targets) {
  test(`${platform}: saved split modes take precedence over equal or uneven amounts`, { skip: !fs.existsSync(file) }, () => {
    const source = fs.readFileSync(file, 'utf8');
    const start = source.indexOf('function inferEditSplitMode(');
    const end = source.indexOf('function buildEditSplitValuesForMode(', start);
    const context = vm.createContext({ r2: value => Math.round(Number(value) * 100) / 100 });
    vm.runInContext(source.slice(start, end), context);
    for (const mode of ['equal', 'percent', 'fraction', 'parts', 'amount']) {
      assert.equal(context.inferEditSplitMode(100, { owner: 50, friend: 50 }, mode), mode);
      assert.equal(context.inferEditSplitMode(100, { owner: 30, friend: 70 }, mode), mode);
    }
    assert.equal(context.inferEditSplitMode(100, { owner: 50, friend: 50 }, ''), 'equal');
    assert.equal(context.inferEditSplitMode(100, { owner: 30, friend: 70 }, ''), 'amount');
  });

  test(`${platform}: editing amount or description preserves split mode and custom values`, { skip: !fs.existsSync(file) }, () => {
    const source = fs.readFileSync(file, 'utf8');
    for (const mode of ['equal', 'percent', 'fraction', 'parts', 'amount']) {
      const values = { owner: 30, friend: 70 };
      const form = { splitMode: mode, splitValues: values, amount: '100', total_amount: 100 };
      let current = form;
      const context = vm.createContext({
        window: {}, state: { editExpense: form },
        renderExpenseEditorModal: () => {},
        setEditExpense: update => { current = update(current); },
      });
      if (platform === 'web') {
        const start = source.indexOf('window.liveSplitEditExpenseField =');
        vm.runInContext(source.slice(start, source.indexOf('window.liveSplitEditExpenseSplit =', start)), context);
        context.window.liveSplitEditExpenseField('total_amount', '250');
        context.window.liveSplitEditExpenseField('details', 'Updated');
        assert.equal(current.total_amount, '250');
      } else {
        const start = source.indexOf('function updateEditExpense(');
        vm.runInContext(source.slice(start, source.indexOf('function changeEditMode(', start)), context);
        context.updateEditExpense('amount', '250');
        context.updateEditExpense('details', 'Updated');
        assert.equal(current.amount, '250');
      }
      assert.equal(current.details, 'Updated');
      assert.equal(current.splitMode, mode);
      assert.equal(current.splitValues, values);
    }
  });
}
