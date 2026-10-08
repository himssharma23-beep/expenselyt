const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
for (const platform of ['web','mobile']) {
  test(`${platform}: adding funds posts a delta and rejects invalid amounts`, async () => {
    const source = fs.readFileSync(path.join(__dirname, platform === 'web' ? '../public/js/app.js' : '../../ExpenseManager_mobile/src/screens/BanksScreen.js'),'utf8');
    const calls = [];
    let refreshed = 0;
    const amountInput = {value:'250.50'};
    const context = vm.createContext({
      bankAddAmountBusy:false, addAmountBank:{id:7,balance:1000},
      document:{getElementById:id=>id==='bankAddAmount'?amountInput:id==='bankAddNote'?{value:'Deposit'}:{}},
      api:async(url,options)=>{calls.push({url,body:options.body});return {success:true};},
      post:async(url,body)=>{calls.push({url,body});},
      closeModal:()=>{},setAddAmountBank:()=>{},toast:()=>{},Alert:{alert:()=>{}},
      loadBankAccounts:async()=>refreshed++,load:async()=>refreshed++,
    });
    const start = source.indexOf(platform === 'web'?'async function saveBankAddAmount(':'async function addBankAmount(');
    const end = source.indexOf(platform === 'web'?'function startBalanceEdit(':'async function updateBalance(',start);
    vm.runInContext(source.slice(start,end),context);
    const save = async amount => {amountInput.value=String(amount);return platform==='web'?context.saveBankAddAmount(7):context.addBankAmount(Number(amount),'Deposit');};
    await save(250.5);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'/api/bank-accounts/adjust-balance');
    assert.equal(calls[0].body.bank_account_id,7);
    assert.equal(calls[0].body.amount,250.5);
    assert.equal(calls[0].body.note,'Deposit');
    assert.equal(refreshed,1);
    for (const value of [0,-1,'',NaN,Infinity]) await save(value);
    assert.equal(calls.length,1);
  });
}
