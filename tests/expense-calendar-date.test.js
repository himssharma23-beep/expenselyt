const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('db/postgres-core.js','utf8');
const start=source.indexOf('async function getExpenses(');
const end=source.indexOf('async function getExpenseCategories(',start);
assert.ok(start>=0&&end>start);

test('expense list and edit payload preserve November 1 instead of serializing October 31',async()=>{
  // pg parses DATE as server-local midnight. This instant reproduces Asia/Kolkata.
  const localMidnight=new Date('2026-11-01T00:00:00+05:30');
  assert.equal(JSON.parse(JSON.stringify(localMidnight)).slice(0,10),'2026-10-31');
  const calls=[];
  const context=vm.createContext({
    num:value=>Number(value||0),yearGuardSql:()=> 'TRUE',
    query:async(sql,params)=>{
      calls.push({sql,params});
      // Model the pg result type: to_char is text, a raw DATE is a Date object.
      const date=sql.includes("to_char(e.purchase_date, 'YYYY-MM-DD') AS purchase_date")?'2026-11-01':localMidnight;
      return {rows:[{id:7,purchase_date:date,amount:'649.00'}]};
    }
  });
  vm.runInContext(source.slice(start,end),context);
  const list=await context.getExpenses(1,{year:2026,month:11});
  const detail=await context.getExpenseById(1,7);
  for(const row of [list[0],detail]){
    const payload=JSON.parse(JSON.stringify(row));
    assert.equal(payload.purchase_date,'2026-11-01');
    assert.equal(payload.amount,649);
  }
  assert.match(calls[0].sql,/to_char\(purchase_date, 'MM'\) = \$3/);
  assert.match(calls[0].sql,/ORDER BY e\.purchase_date DESC, e\.id DESC/);
  assert.deepEqual(Array.from(calls[0].params),[1,'2026','11']);
});

test('failed expense request shows a retry message instead of a zero total and undefined count',async()=>{
  const app=fs.readFileSync('public/js/app.js','utf8');
  const start=app.indexOf('async function loadExpenses()');
  const stop=app.indexOf('  if (!_expenseCategories.length)',start);
  assert.ok(start>=0&&stop>start);
  const main={innerHTML:''};
  const context=vm.createContext({expFilters:{year:2026,month:10,spendType:'all'},_bankAccounts:[{}],_ccCards:[{}],document:{getElementById:()=>main},escHtml:value=>value,api:async()=>({success:false,error:'Expenses are temporarily unavailable'})});
  vm.runInContext(app.slice(start,stop)+'}',context);
  await context.loadExpenses();
  assert.match(main.innerHTML,/Could not load expenses/);
  assert.match(main.innerHTML,/Expenses are temporarily unavailable/);
  assert.match(main.innerHTML,/Retry/);
  assert.doesNotMatch(main.innerHTML,/undefined|TOTAL EXPENSES/);
});

test('expense display keeps calendar dates stable across month and year boundaries',()=>{
  const context=vm.createContext({window:{__currencyPrefs:{localeCode:'en-IN',timeZone:'America/Toronto'}},document:{body:null,addEventListener(){}},Date,Intl});
  vm.runInContext(fs.readFileSync('public/js/utils.js','utf8'),context);
  for(const [date,expected] of [['2026-11-01','01 Nov 2026'],['2027-01-01','01 Jan 2027'],['2026-10-31','31 Oct 2026']]){
    assert.equal(context.fmtDate(date),expected);
  }
});
