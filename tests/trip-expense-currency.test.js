const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { tripExpenseMoney } = require('../public/js/trip-expense-currency');
const gbp = { amount: 64102.56, unit_price: 500, original_currency_code: 'GBP', original_amount: 500, conversion_rate: 128.205128 };

test('GBP prices, totals and shares keep the selected currency with converted INR separately', () => {
  const money = tripExpenseMoney(gbp);
  assert.equal(money.price, '£500.00');
  assert.equal(money.total, '£500.00');
  assert.equal(money.converted, '₹64,102.56');
  assert.equal(money.share(32051.28), '£250.00');
});
test('saved original amounts determine shares without fetching a new exchange rate', () => {
  const money = tripExpenseMoney({ ...gbp, unit_price: 250, conversion_rate: 999 });
  assert.equal(money.price, '£250.00');
  assert.equal(money.total, '£500.00');
  assert.equal(money.share(64102.56 / 3), '£166.67');
});
test('old entries without original metadata and base-currency entries keep their amounts', () => {
  for (const expense of [
    { amount: 500, unit_price: 250 },
    { amount: 500, unit_price: 250, original_currency_code: 'GBP', original_amount: null },
    { amount: 500, unit_price: 250, original_currency_code: 'INR', original_amount: 500 },
  ]) {
    const money = tripExpenseMoney(expense);
    assert.equal(money.price, '₹250.00');
    assert.equal(money.total, '₹500.00');
    assert.equal(money.converted, null);
  }
});
test('currency and locale selection support other currencies, string values and zero', () => {
  assert.match(tripExpenseMoney({ ...gbp, original_currency_code: 'eur', original_amount: '500' }).total, /€500\.00/);
  const money = tripExpenseMoney({ ...gbp, amount: 0, original_amount: 0, unit_price: null }, 'USD', 'en-US');
  assert.equal(money.total, '£0.00');
  assert.equal(money.price, null);
  assert.equal(money.converted, '$0.00');
  assert.equal(money.share(0), '£0.00');
});
test('web total shows only the converted account amount while price keeps GBP', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const start = source.indexOf('function tripExpenseDisplayMoney(');
  const end = source.indexOf('function renderTripDetail()', start);
  const context = { tripExpenseMoney, _currentUser: { currency_code: 'INR' }, escHtml: value => String(value),
    fmtCur: value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value) };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const html = context.tripExpenseAmountHtml(gbp);
  assert.equal(html, '<div>₹64,102.56</div>');
  assert.equal(context.tripExpenseDisplayMoney(gbp).price, '£500.00');
});
const mobileFile = path.resolve(__dirname, '../../ExpenseManager_mobile/src/utils/tripExpenseCurrency.js');
test('mobile formatter stays identical to the web formatter', { skip: !fs.existsSync(mobileFile) }, () => {
  assert.equal(fs.readFileSync(mobileFile, 'utf8'), fs.readFileSync(path.join(__dirname, '../public/js/trip-expense-currency.js'), 'utf8'));
  const mobile = require(mobileFile).tripExpenseMoney(gbp);
  assert.equal(mobile.total, '£500.00');
  assert.equal(mobile.share(32051.28), '£250.00');
});
