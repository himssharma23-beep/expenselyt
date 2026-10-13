const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildPaymentManagerPlan } = require('../utils/payment-manager-plan');
const example = [{key:'self',name:'A',paid:1650},{key:'2',name:'B',paid:1600},{key:'3',name:'C',paid:0},{key:'4',name:'D',paid:0}];
test('four friends retain gross collections and reimbursement around B', () => {
  const plan = buildPaymentManagerPlan(example,'2');
  assert.equal(plan.total,3250);
  assert.ok(plan.people.every(p=>p.share===812.5));
  assert.deepEqual(plan.entries,[{from:'self',to:'2',amount:812.5,kind:'collection'},{from:'2',to:'self',amount:1650,kind:'reimbursement'},{from:'3',to:'2',amount:812.5,kind:'collection'},{from:'4',to:'2',amount:812.5,kind:'collection'}]);
});
test('rounding conserves every paisa for every manager, including a manager who paid nothing',()=>{
  for(const manager of ['a','b','c']) {
    const plan=buildPaymentManagerPlan([{key:'a',paid:100},{key:'b',paid:0},{key:'c',paid:0}],manager);
    assert.deepEqual(plan.people.map(p=>p.share),[33.34,33.33,33.33]);
    for(const person of plan.people) {
      const net=plan.entries.reduce((sum,e)=>sum+(e.to===person.key?Math.round(e.amount*100):0)-(e.from===person.key?Math.round(e.amount*100):0),0);
      assert.equal(net,Math.round(person.paid*100)-Math.round(person.share*100));
    }
    assert.ok(plan.entries.every(e=>e.from!==e.to));
  }
});
test('rejects invalid payments, duplicate participants, and an unselected manager',()=>{
  for(const paid of [-1,NaN,Infinity,'bad',1.001]) assert.throws(()=>buildPaymentManagerPlan([{key:'a',paid},{key:'b',paid:1}],'a'));
  assert.throws(()=>buildPaymentManagerPlan([{key:'a',paid:1},{key:'a',paid:2}],'a'));
  assert.throws(()=>buildPaymentManagerPlan([{key:'a',paid:0},{key:'b',paid:0}],'a'));
  assert.throws(()=>buildPaymentManagerPlan(example,'missing'));
});
function fixture(failAt=0) {
  let committed=[]; let current=[]; let shared=[]; let finance=[];
  const friends=example.slice(1).map(p=>({id:Number(p.key),name:p.name,linked_user_id:100+Number(p.key)}));
  const client={query:async(sql,params)=>{
    if(sql.startsWith('SELECT display_name')) return {rows:[{display_name:'A'}]};
    if(sql.startsWith('SELECT id, name')) return {rows:friends.filter(f=>f.id===params[0] && params[1]===1)};
    if(sql.startsWith('SELECT id FROM bank_accounts') || sql.startsWith('SELECT id FROM credit_cards')) return {rows:params[0]===7 && params[1]===1 ? [{id:7}] : []};
    if(sql.includes('pg_advisory')) return {rows:[]};
    if(sql.startsWith('SELECT id, session_id FROM live_split_groups')) return {rows:committed.filter(g=>g.params[6].startsWith(params[1].slice(0,-1))).map(g=>({id:g.id,session_id:g.params[6]}))};
    if(sql.startsWith('INSERT INTO live_split_groups')) {const group={id:current.length+1,params};current.push(group);return {rows:[{id:group.id}]};}
    throw Error(sql);
  }};
  const context=vm.createContext({crypto:require('node:crypto'),require:()=>({buildPaymentManagerPlan}),Number,String,Set,
    withTransaction:async fn=>{const before=finance.length;current=committed.map(g=>({...g}));try{const result=await fn(client);committed=current;return result;}catch(err){current=[];finance.length=before;throw err;}},
    addExpense:async(uid,data,c)=>{assert.equal(c,client);finance.push({kind:'expense',data});},
    adjustBankBalance:async(uid,id,delta,c)=>{assert.equal(c,client);finance.push({kind:'bank',id,delta});},
    syncSourceBankPayment:async(c,adjust,data)=>{
      assert.equal(c,client);assert.equal(data.source,'payment_manager');assert.equal(data.sourceId,1);
      await adjust(data.userId,data.bankId,data.amount,c);
    },
    pgBillingDb:{addCcTxn:async(uid,data,c)=>{assert.equal(c,client);finance.push({kind:'card',data});if(failAt==='card')throw Error('card failed');}},
    normalizeDateValue:v=>v,normalizeText:v=>{if(!v)throw Error('Missing description');return v;},validationError:message=>Error(message),
    insertLiveSplitSplitsWithSequenceRecovery:async(c,id,splits)=>{if(id===failAt)throw Error('insert failed');current.find(g=>g.id===id).splits=splits;},
    syncSingleLiveSplitGroupShares:async(c,uid,id,ids)=>shared.push({id,ids}),logLiveSplitGroupActivity:async()=>{},logLiveSplitFriendActivities:async()=>{},
  });
  const source=fs.readFileSync(require.resolve('../db/postgres-core'),'utf8');
  vm.runInContext(source.slice(source.indexOf('async function paymentManagerSplit('),source.indexOf('async function addLiveSplitGroup(')),context);
  return {run:context.paymentManagerSplit,groups:()=>committed,shared:()=>shared,finance:()=>finance};
}
const payload={title:'Dinner',date:'2026-10-09',request_id:'test-request-12345',manager_key:'2',people:example};
test('preview writes nothing; posting writes ordinary debts, shares linked entries, and retry does not duplicate',async()=>{
  const db=fixture();await db.run(1,payload,false);assert.equal(db.groups().length,0);
  await db.run(1,payload,true);assert.equal(db.groups().length,4);
  const [collection,reimbursement]=db.groups();
  assert.equal(collection.params[3],'B');assert.equal(collection.params[4],812.5);
  assert.equal(collection.splits.reduce((sum,s)=>sum+s.share_amount,0),0); // A is owner and owes the entire share.
  assert.equal(reimbursement.params[3],'You');assert.equal(reimbursement.splits[0].share_amount,1650);
  assert.equal(db.shared().length,4);
  await db.run(1,payload,true);assert.equal(db.groups().length,4);assert.equal(db.shared().length,4);
  await assert.rejects(db.run(1,{...payload,title:'Changed'},true),/already posted/);
});
test('posting failure rolls back every entry and invalid friend IDs cannot post',async()=>{
  const db=fixture(2);await assert.rejects(db.run(1,payload,true),/insert failed/);assert.equal(db.groups().length,0);
  await assert.rejects(db.run(1,{...payload,people:[{key:'self',paid:100},{key:'999',paid:0}]},true),/valid friend/);
  assert.equal(db.groups().length,0);
});

for (const mode of ['percent','amount','parts']) test(`${mode}: custom shares preserve collections and full reimbursements`,()=>{
  const values = mode === 'percent' ? [40,30,20,10] : mode === 'amount' ? [1300,975,650,325] : [4,3,2,1];
  const plan = buildPaymentManagerPlan(example.map((p,i)=>({...p,share_value:values[i]})),'2',mode);
  assert.deepEqual(plan.people.map(p=>p.share),[1300,975,650,325]);
  assert.equal(plan.entries[0].amount,1300);
  assert.equal(plan.entries[1].amount,1650);
});
test('invalid percentages, direct totals and missing/negative ratio shares cannot post',()=>{
  for(const [mode,values] of [['percent',[30,30,20,10]],['amount',[1300,975,650,324]],['parts',[0,0,0,0]],['parts',[-1,2,3,4]],['percent',[100,undefined,0,0]]]) {
    assert.throws(()=>buildPaymentManagerPlan(example.map((p,i)=>({...p,share_value:values[i]})),'2',mode));
  }
});
for(const source of ['bank','card']) test(`${source}: records personal share separately from full payment and retry has no duplicate finances`,async()=>{
  const db=fixture();const data={...payload,add_expense:true,payment_source:source,payment_account_id:7,split_mode:'parts',people:example.map((p,i)=>({...p,share_value:[4,3,2,1][i]}))};
  const preview=await db.run(1,data,false);assert.equal(preview.finance.expense_amount,1300);assert.equal(preview.finance.payment_amount,1650);assert.equal(db.finance().length,0);
  await db.run(1,data,true);
  assert.equal(db.finance()[0].data.amount,1300);assert.equal(db.finance()[0].data.bank_account_id,null);
  if(source==='bank')assert.equal(db.finance()[1].delta,-1650);
  else assert.equal(db.finance()[1].data.amount,1650);
  await db.run(1,data,true);assert.equal(db.finance().length,2);
});
test('invalid account and recording payment when self paid nothing are rejected',async()=>{
  const db=fixture();await assert.rejects(db.run(1,{...payload,payment_source:'bank',payment_account_id:999},true),/own active accounts/);
  await assert.rejects(db.run(1,{...payload,payment_source:'bank',payment_account_id:7,people:example.map(p=>({...p,paid:p.key==='self'?0:p.paid}))},true),/amount you paid/);
  assert.equal(db.groups().length,0);assert.equal(db.finance().length,0);
});
test('credit card failure rolls back split entries and personal expense together',async()=>{
  const db=fixture('card');await assert.rejects(db.run(1,{...payload,add_expense:true,payment_source:'card',payment_account_id:7},true),/card failed/);
  assert.equal(db.groups().length,0);assert.equal(db.finance().length,0);
});

for (const [platform,file,endMarker] of [['web','../public/js/live-split.js','  let managerDraft'],['mobile','../../ExpenseManager_mobile/src/components/PaymentManagerModal.js','export default function']]) {
  test(`${platform}: live validation blocks under/over totals and handles decimal shares`,()=>{
    const source=fs.readFileSync(require.resolve(file),'utf8');
    const start=source.indexOf('function paymentManagerValidation(');
    const context=vm.createContext({});
    vm.runInContext(source.slice(start,source.indexOf(endMarker,start)),context);
    const validate=(mode,values)=>context.paymentManagerValidation(values.map((value,i)=>({paid:i===0?100:0,share_value:value})),mode);
    for(const mode of ['amount','percent']) {
      assert.equal(validate(mode,[40,59]).valid,false);
      assert.equal(validate(mode,[40,61]).valid,false);
      assert.equal(validate(mode,[40,60]).valid,true);
      assert.equal(validate(mode,[33.33,33.33,33.34]).valid,true);
      assert.equal(validate(mode,[50,'']).valid,false);
      assert.equal(validate(mode,[-1,101]).valid,false);
    }
    assert.equal(validate('amount',[50.001,49.999]).valid,false);
    assert.equal(validate('parts',[2,1,1]).valid,true);
    assert.equal(validate('parts',[0,0]).valid,false);
  });
}
test('rounded allocations conserve the total for different modes and participant counts',()=>{
  for(let count=2;count<=20;count++) for(const total of [1,7,100,10001,325000]) {
    for(const mode of ['equal','parts','percent']) {
      const people=Array.from({length:count},(_,i)=>({key:String(i),paid:i===0?total/100:0,share_value:mode==='percent'?100/count:i+1}));
      const plan=buildPaymentManagerPlan(people,'0',mode);
      assert.equal(plan.people.reduce((sum,p)=>sum+Math.round(p.share*100),0),total);
    }
  }
});

test('fraction shares support numerator/denominator input and reject invalid totals',()=>{
  const plan=buildPaymentManagerPlan(example.map((p,i)=>({...p,share_value:['1/2','1/4','1/8','1/8'][i]})),'2','fraction');
  assert.deepEqual(plan.people.map(p=>p.share),[1625,812.5,406.25,406.25]);
  for(const value of ['1/0','1/Infinity','1/2/3','-1/2','2']) assert.throws(()=>buildPaymentManagerPlan(example.map((p,i)=>({...p,share_value:i===0?value:'1/4'})),'2','fraction'));
});
