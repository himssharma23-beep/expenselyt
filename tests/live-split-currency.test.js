const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {liveSplitCurrencyScope,formatLiveSplitMoney}=require('../public/js/live-split-currency');
const {liveSplitWriteCurrency}=require('../db/live-split-currency');

test('a Canadian viewer sees an INR source balance in rupees without relabelling or changing its value',()=>{
 const shared=[{id:1,currency_code:'INR',total_amount:305251.53}];
 const scope=liveSplitCurrencyScope([],shared,[],'CAD');
 assert.equal(scope.currency,'INR');assert.equal(scope.sharedGroups[0].total_amount,305251.53);
 assert.equal(formatLiveSplitMoney(-305251.53,scope.currency),'-₹3,05,251.53');
 assert.equal(shared[0].total_amount,305251.53);
});
test('INR and CAD are independent balance scopes rather than a mixed numeric sum',()=>{
 const own=[{id:1,currency_code:'CAD',total_amount:25}],shared=[{id:2,currency_code:'INR',total_amount:305251.53}];
 const inr=liveSplitCurrencyScope(own,shared,[],'CAD','INR');assert.deepEqual(inr.groups,[]);assert.deepEqual(inr.sharedGroups,shared);
 const cad=liveSplitCurrencyScope(own,shared,[],'CAD','CAD');assert.deepEqual(cad.groups,own);assert.deepEqual(cad.sharedGroups,[]);assert.equal(formatLiveSplitMoney(25,cad.currency),'$25.00');
});
test('saved source currency survives later viewer preference changes and scopes trips consistently',()=>{
 const trip={id:2,currency_code:'INR',total_amount:500};
 const scope=liveSplitCurrencyScope([{currency_code:'INR'}],[],[trip],'CAD','INR');assert.equal(scope.trips[0],trip);
 assert.equal(liveSplitCurrencyScope([{currency_code:'INR'}],[],[],'GBP').currency,'INR');
});
test('settlements can retain INR for a CAD account and trip expenses inherit the trip currency',async()=>{
 const client={query:async(sql)=>({rows:[{currency_code:sql.includes('live_split_trips')?'INR':'CAD'}]})};
 assert.equal(await liveSplitWriteCurrency(client,1,{currency_code:'INR'}),'INR');
 assert.equal(await liveSplitWriteCurrency(client,1,{},null),'CAD');
 assert.equal(await liveSplitWriteCurrency(client,1,{currency_code:'CAD'},7),'INR');
 await assert.rejects(()=>liveSplitWriteCurrency(client,1,{currency_code:'not-money'}),/Invalid split currency/);
});
test('web and mobile use identical currency selection and formatting',()=>{
 assert.equal(fs.readFileSync('public/js/live-split-currency.js','utf8'),fs.readFileSync('C:/P/ExpenseManager_mobile/src/utils/liveSplitCurrency.js','utf8'));
});
