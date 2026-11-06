const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {liveSplitCurrencyScope,liveSplitCurrencySections,liveSplitHomeRows,liveSplitConvertedTotals,formatLiveSplitMoney}=require('../public/js/live-split-currency');
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

test('all original currencies appear automatically without hiding balances or mixing totals',()=>{
 const own=[{id:1,currency_code:'CAD',total_amount:25}];
 const shared=[{id:2,currency_code:'INR',total_amount:305251.53}];
 const trips=[{id:3,currency_code:'GBP',total_amount:40}];
 const before=JSON.stringify({own,shared,trips});
 const sections=liveSplitCurrencySections(own,shared,trips,'CAD');
 assert.deepEqual(sections.map(section=>section.currency),['CAD','GBP','INR']);
 assert.deepEqual(sections.flatMap(section=>section.groups),own);
 assert.deepEqual(sections.flatMap(section=>section.sharedGroups),shared);
 assert.deepEqual(sections.flatMap(section=>section.trips),trips);
 assert.equal(sections.find(section=>section.currency==='INR').sharedGroups[0].total_amount,305251.53);
 assert.equal(JSON.stringify({own,shared,trips}),before);
});

test('automatic sections omit unused account currencies and retain an empty state for new users',()=>{
 assert.deepEqual(liveSplitCurrencySections([],[],[],'CAD').map(section=>section.currency),['CAD']);
 assert.deepEqual(liveSplitCurrencySections([],[{currency_code:'INR'}],[],'CAD').map(section=>section.currency),['INR']);
});

test('top totals convert every native balance into the viewer currency without changing rows',()=>{
 const rows=[{currency_code:'INR',amount:-6800},{currency_code:'CAD',amount:25},{currency_code:'GBP',amount:10}];
 const rates=[{currency_code:'CAD',rate_to_inr:68},{currency_code:'GBP',rate_to_inr:136}];
 const before=JSON.stringify(rows);
 assert.deepEqual(liveSplitConvertedTotals(rows,'CAD',rates),{currency:'CAD',complete:true,missing:[],oweToMe:45,iOwe:100,net:-55});
 assert.deepEqual(liveSplitConvertedTotals(rows,'INR',rates),{currency:'INR',complete:true,missing:[],oweToMe:3060,iOwe:6800,net:-3740});
 assert.equal(JSON.stringify(rows),before);
});

test('a missing source or target exchange rate never produces an incorrect partial total',()=>{
 const result=liveSplitConvertedTotals([{currency_code:'INR',amount:6800},{currency_code:'CAD',amount:25}],'CAD',[]);
 assert.equal(result.complete,false);assert.deepEqual(result.missing,['CAD']);assert.equal(result.net,null);
 assert.equal(result.oweToMe,null);assert.equal(result.iOwe,null);
 assert.equal(liveSplitConvertedTotals([{currency_code:'CAD',amount:25}],'CAD',[]).net,25);
 assert.equal(liveSplitConvertedTotals([{currency_code:'INR',amount:1}],'CAD',[{currency_code:'CAD',rate_to_inr:0}]).complete,false);
});

test('native friend rows include CAD and INR activity, with settled friends shown once',()=>{
 const sections=[
  {currency:'INR',rows:[{friend_id:1,name:'Indian friend',amount:-6800},{friend_id:2,name:'Canadian friend',amount:0},{friend_id:3,name:'Settled friend',amount:0}]},
  {currency:'CAD',rows:[{friend_id:1,name:'Indian friend',amount:0},{friend_id:2,name:'Canadian friend',amount:25},{friend_id:3,name:'Settled friend',amount:0}]},
 ];
 const rows=liveSplitHomeRows(sections,'CAD');
 assert.equal(rows.length,3);
 assert.equal(rows.find(row=>row.friend_id===1).currency_code,'INR');
 assert.equal(rows.find(row=>row.friend_id===2).currency_code,'CAD');
 assert.equal(rows.find(row=>row.friend_id===3).currency_code,'CAD');
 assert.equal(liveSplitConvertedTotals(rows,'CAD',[{currency_code:'CAD',rate_to_inr:68}]).net,-75);
});

test('the combined top total does not depend on the friend visibility filter',()=>{
 const rows=[{currency_code:'INR',amount:-6800},{currency_code:'CAD',amount:25},{currency_code:'CAD',amount:0}];
 const rates=[{currency_code:'CAD',rate_to_inr:68}];
 assert.deepEqual(liveSplitConvertedTotals(rows,'CAD',rates),liveSplitConvertedTotals(rows.filter(row=>row.amount),'CAD',rates));
});

test('mobile totals use the updated authenticated profile over a stale screen profile',()=>{
 const source=fs.readFileSync('C:/P/ExpenseManager_mobile/src/screens/LiveSplitScreen.js','utf8');
 const declaration=source.match(/const accountTotals = useMemo\([^\n]+/);
 assert.ok(declaration);
 const rows=[{currency_code:'INR',amount:6800},{currency_code:'CAD',amount:25}];
 const run=(authenticatedUser,currentUser)=>{
   const context=vm.createContext({authenticatedUser,currentUser,allVisibleSummaryRows:rows,currencyRates:[{currency_code:'CAD',rate_to_inr:68}],liveSplitConvertedTotals,useMemo:fn=>fn()});
   return vm.runInContext(declaration[0]+'\naccountTotals;',context);
 };
 assert.equal(run({currency_code:'CAD'},{currency_code:'INR'}).currency,'CAD');
 assert.equal(run({currency_code:'CAD'},{currency_code:'INR'}).net,125);
 assert.equal(run({currency_code:'INR'},{currency_code:'CAD'}).net,8500);
 assert.equal(run(null,{currency_code:'CAD'}).net,125);
});
