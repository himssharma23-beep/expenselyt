const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {bankEntryDate}=require('../utils/bank-entry-date');
const parser=require('C:/P/ExpenseManager_mobile/node_modules/@babel/parser');
function extract(file,name) {
 const source=fs.readFileSync(file,'utf8');
 const ast=parser.parse(source,{sourceType:'unambiguous',plugins:['jsx']});
 let found;
 function walk(n) {if(!n || typeof n!=='object')return;if(n.type==='FunctionDeclaration' && n.id.name===name)found=n; for(const [key,value] of Object.entries(n)){if(['loc','start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(walk);else if(value && typeof value==='object')walk(value);}}
 walk(ast);assert.ok(found,name);return source.slice(found.start,found.end);
}
test('transaction dates are real calendar dates; legacy requests can omit the date',()=>{
 assert.equal(bankEntryDate('2026-09-30'),'2026-09-30');
 assert.equal(bankEntryDate('2024-02-29'),'2024-02-29');
 assert.equal(bankEntryDate(undefined),null);
 for(const date of ['', '2026-02-30', '2026-13-01','10/12/2026','2026-10-12T00:00:00Z']) assert.throws(()=>bankEntryDate(date),{statusCode:400});
});
test('top-up persists the date separately from creation time and increases balance atomically',async()=>{
 const calls=[];
 const client={query:async(sql,params)=>{calls.push({sql,params});return {rows:sql.includes('SELECT balance')?[{balance:100}]:sql.includes('RETURNING id')?[{id:9}]:[]};}};
 let transactions=0;
 const context=vm.createContext({bankEntryDate,normalizeBankAccountId:Number,num:Number,withTransaction:async cb=>{transactions++;return cb(client);}});
 vm.runInContext(extract('db/postgres-core.js','adjustBankBalance'),context);
 assert.equal(await context.adjustBankBalance(1,2,25,null,{transaction_date:'2026-09-30'}),9);
 assert.equal(transactions,1);
 assert.equal(calls.find(c=>c.sql.includes('UPDATE bank_accounts')).params[0],125);
 const insert=calls.find(c=>c.sql.includes('INSERT INTO bank_account_history'));
 assert.equal(insert.params[8],'2026-09-30');
 assert.ok(!insert.sql.includes('created_at'));
 calls.length=0;
 await assert.rejects(context.adjustBankBalance(1,2,25,null,{transaction_date:'2026-02-30'}));
 assert.equal(calls.length,0);
});
for(const [platform,file,name,invoke] of [
 ['web bank','public/js/app.js','saveBankAddAmount','saveBankAddAmount(2)'],
 ['web expenses','public/js/app.js','saveExpense','saveExpense(null)'],
 ['mobile bank','C:/P/ExpenseManager_mobile/src/screens/BanksScreen.js','addBankAmount',"addBankAmount(25,'Deposit','2026-09-30')"],
 ['mobile expenses','C:/P/ExpenseManager_mobile/src/screens/ExpensesScreen.js','saveIncome','saveIncome()'],
]) test(`${platform} sends the chosen date through the top-up API`,async()=>{
 const payloads=[];
 const api=async(url,options)=>{if(options)payloads.push({url,...options});return {success:true,accounts:[]};};
 const values={bankAddAmount:'25',bankAddDate:'2026-09-30',bankAddNote:'Deposit',eIncomeAmount:'25',eIncomeBank:'2',eIncomeDate:'2026-09-30'};
 const bank={id:2,balance:100,bank_name:'Bank'};
 const context=vm.createContext({api,post:(url,body)=>api(url,{method:'POST',body}),window:{_expenseEntryMode:'income'},document:{getElementById:id=>({value:values[id]})},bankAddAmountBusy:false,_bankAccounts:[bank],_expenseIncomeHistoryCacheUserId:null,_expenseIncomeHistoryCache:[],selectedBank:bank,addAmountBank:bank,amount:'25',transactionDate:'2026-09-30',fmtCur:String,bankLabel:()=> 'Bank',setSaving:()=>{},setAddAmountBank:()=>{},onAdded:()=>{},load:()=>{},loadBankAccounts:()=>{},loadExpenses:()=>{},closeModal:()=>{},toast:()=>{},Alert:{alert:()=>{}}});
 vm.runInContext(extract(file,name),context);
 await vm.runInContext(invoke,context);
 assert.equal(payloads.length,1);
 assert.equal(payloads[0].url,'/api/bank-accounts/adjust-balance');
 assert.equal(payloads[0].body.transaction_date,'2026-09-30');
 assert.equal(payloads[0].body.amount,25);
});

test('history returns the transaction date without overwriting the audit timestamp',async()=>{
 const context=vm.createContext({normalizeBankAccountId:Number,num:Number,ensureBankAccountHistorySchema:async()=>{},query:async sql=>{
  assert.match(sql,/COALESCE\(h.transaction_date, h.created_at::date\)/);
  return {rows:[{id:1,bank_account_id:2,effective_date:'2026-09-30',created_at:'2026-10-13T10:00:00Z',amount:25}]};
 }});
 vm.runInContext(extract('db/postgres-ops.js','getBankAccountHistory'),context);
 const [row]=await context.getBankAccountHistory(1,2);
 assert.equal(row.transaction_date,'2026-09-30');
 assert.equal(row.created_at,'2026-10-13T10:00:00Z');
});

test('web and mobile expense history use selected dates and fall back for old entries',async()=>{
 const rows=[{id:1,entry_type:'fund_added',amount:25,transaction_date:'2026-09-30',created_at:'2026-10-13T10:00:00Z'},{id:2,entry_type:'fund_added',amount:10,created_at:'2026-08-20T10:00:00Z'}];
 for(const [file,name] of [['public/js/app.js','ensureExpenseIncomeHistoryLoaded'],['C:/P/ExpenseManager_mobile/src/screens/ExpensesScreen.js','normalizeIncomeHistoryRows']]) {
  const context=vm.createContext({_bankAccounts:[{id:2}],_expenseIncomeHistoryCacheUserId:null,_expenseIncomeHistoryCache:[],getExpensePagePreferenceUserKey:()=>1,api:async()=>({history:rows})});
  for(const helper of ['bankHistoryDateOnly','isIncomeHistoryEntry',name])vm.runInContext(extract(file,helper),context);
  const result=name==='normalizeIncomeHistoryRows'?context[name]([{id:2}],{2:rows}):await context[name](true);
  assert.deepEqual(Array.from(result,row=>row.purchase_date),['2026-09-30','2026-08-20']);
 }
});
