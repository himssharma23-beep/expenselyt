const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildTripPaymentObligations } = require('../utils/trip-payment-obligations');
const source = fs.readFileSync(require('node:path').join(__dirname, '../db/postgres-core.js'), 'utf8');
const ledgerSource = source.slice(source.indexOf('async function getLiveSplitTripLedgerForUser('), source.indexOf('async function normalizeLiveSplitTripMembersForOwner('));
async function ledger(groups, viewer = 1) {
  const context = vm.createContext({
    num: value => Number(value || 0), bool: Boolean, buildTripPaymentObligations,
    normalizeLiveSplitTripStatus: value => value || 'active',
    getLiveSplitTripAccessRow: async () => ({id: 9, user_id: 1, status: 'active'}),
    getLiveSplitTripExpenseStats: async () => ({}),
    query: async sql => ({rows: sql.includes('SELECT m.*') ? [] : groups}),
  });
  vm.runInContext(ledgerSource, context);
  return JSON.parse(JSON.stringify(await context.getLiveSplitTripLedgerForUser(viewer, 9))).payment_obligations;
}
const meal = (id, total, payer = 'You', mode = 'equal', share = total / 2) => ({
  id, user_id: 1, owner_name: 'Navjot Singh', trip_id: 9, total_amount: total, paid_by: payer, split_mode: mode,
  splits: [{friend_id: 2, linked_user_id: 2, friend_name: 'Himanshu Sharma', share_amount: share}],
});

test('trip ledger shows who owes whom for the supplied two-expense example, for either viewer', async () => {
  for (const viewer of [1, 2]) {
    assert.deepEqual(await ledger([meal(1, 452), meal(2, 420)], viewer), [{from_key:'u:2', from_name:'Himanshu Sharma', to_key:'u:1', to_name:'Navjot Singh', amount:436}]);
  }
});

test('repayments reduce, clear, or reverse outstanding debts', async () => {
  const expenses = [meal(1,452), meal(2,420)];
  assert.equal((await ledger([...expenses,meal(3,100,'Himanshu Sharma','settlement',100)]))[0].amount,336);
  assert.deepEqual(await ledger([...expenses,meal(3,436,'Himanshu Sharma','settlement',436)]),[]);
  const reversed = await ledger([...expenses,meal(3,500,'Himanshu Sharma','settlement',500)]);
  assert.equal(reversed[0].from_name,'Navjot Singh');
  assert.equal(reversed[0].amount,64);
});

test('opposing expenses net only between the same pair', async () => {
  assert.equal((await ledger([meal(1,200),meal(2,100,'Himanshu Sharma')]))[0].amount,50);
  const a={key:'u:1',name:'Same name'}, b={key:'u:2',name:'Same name'}, c={key:'u:3',name:'C'};
  const result=buildTripPaymentObligations([{from:a,to:b,amount:0.1},{from:a,to:b,amount:0.2},{from:c,to:b,amount:40},{from:a,to:a,amount:100}]);
  assert.equal(result.length,2);
  assert.equal(result.find(row=>row.from_key==='u:1').amount,0.3);
});

test('empty trips have no outstanding payments', async () => {
  assert.deepEqual(await ledger([]),[]);
});
