const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../public/js/emi-friend-split-model');

test('full cost counts paid and unpaid installments, interest GST, upfront fees and card fee GST once',()=>{
  const rows=[{principal_component:100,interest_component:10,gst_amount:1.8,emi_amount:111.8,paid:true},{principal_component:100,interest_component:5,gst_amount:.9,emi_amount:105,paid:false}];
  const cost=model.breakdown({upfront_charge:20,cc_processing_charge:299,cc_processing_gst_pct:18},rows);
  assert.equal(cost.total,590.52);
  assert.equal(cost.installment_count,2);
  assert.equal(model.breakdown({upfront_charge:0},rows).total,217.7);
  assert.equal(model.breakdown({status:'saved',total_amount:215,total_gst:2.7,grand_total:237.7,tenure_months:2}).total,237.7);
  assert.equal(model.breakdown({},[{principal_component:-1,interest_component:-1,gst_amount:1.8,emi_amount:111.8}]).total,111.8);
});
test('all four modes preserve cents and rounding is independent of selection order',()=>{
  const people=[{key:'self'},{key:'9'},{key:'2'}];
  for(const mode of ['equal','percent','parts','amount']){
    const values=model.defaults(100,people,mode),result=model.shares(100,people,mode,values);
    assert.equal(result.valid,true,mode);
    assert.equal(result.shares.reduce((sum,p)=>sum+Math.round(p.share*100),0),10000);
  }
  const first=model.shares(100,people).shares;
  assert.deepEqual(model.shares(100,[...people].reverse()).shares.reverse(),first);
  assert.equal(model.shares(100,people,'percent',{self:50,9:30,2:30}).valid,false);
  assert.equal(model.shares(100,people,'amount',{self:50,9:30,2:10}).valid,false);
  assert.equal(model.shares(100,people,'parts',{self:0,9:1,2:1}).valid,false);
  assert.deepEqual(model.shares(100,[{key:'self'},{key:'9'}],'parts',{self:1,9:3}).shares.map(p=>p.share),[25,75]);
});
test('web and mobile use identical financial calculations',()=>{
  assert.equal(fs.readFileSync('public/js/emi-friend-split-model.js','utf8'),fs.readFileSync('C:/P/ExpenseManager_mobile/src/utils/emiFriendSplitModel.js','utf8'));
});

function store(){
  let link=null,group=null,failInsert=false;
  const client={query:async(sql,args=[])=>{
    if(sql.startsWith('CREATE TABLE'))return {rows:[]};
    if(sql.startsWith('SELECT * FROM emi_records'))return {rows:args[0]===7&&args[1]===1?[{name:'Machine',principal:100,total_amount:100,total_gst:0,tenure_months:1}]:[]};
    if(sql.startsWith('SELECT * FROM emi_installments'))return {rows:[]};
    if(sql.startsWith('SELECT link.group_id'))return {rows:link?[{group_id:link,my_share:50,owner_added_to_expense:true}]:[]};
    if(sql.startsWith('SELECT currency_code'))return {rows:[{currency_code:'CAD'}]};
    if(sql.startsWith('SELECT id,name'))return {rows:args[1].filter(id=>id===2||id===3).map(id=>({id,name:'Friend '+id,linked_user_id:id===3?1:8}))};
    if(sql.startsWith('INSERT INTO emi_friend_splits')){if(failInsert)throw Error('insert failed');link=args[2];return {rows:[]};}
    throw Error(sql);
  }};
  const context={module:{exports:{}},require:name=>{
    if(name==='./postgres')return {query:client.query,withTransaction:async fn=>{const before={link,group};try{return await fn(client);}catch(error){link=before.link;group=before.group;throw error;}}};
    if(name==='./postgres-core')return {addLiveSplitGroup:async(uid,data,tx)=>{assert.equal(tx,client);group=data;return 42;}};
    if(name.includes('emi-friend-split-model'))return model;
    throw Error(name);
  }};
  vm.runInNewContext(fs.readFileSync('db/emi-friend-split.js','utf8'),context);
  return {api:context.module.exports,get group(){return group;},failInsert(){failInsert=true;}};
}
const payload={expected_total:100,friend_ids:[2],include_self:true,mode:'equal',values:{},date:'2026-11-10'};
test('owned EMI posts the personal share to Expenses and friends shares to Live Split atomically',async()=>{
  const db=store();
  const result=await db.api.create(1,7,payload);
  assert.equal(result.group_id,42);
  assert.equal(db.group.currency_code,'CAD');
  assert.equal(db.group.splits[0].share_amount,50);
  assert.equal(db.group.owner_added_to_expense,true);
  assert.equal(db.group.finance.add_expense,true);
  assert.equal(db.group.finance.bank_account_id,undefined);
  assert.equal(db.group.finance.card_id,undefined);
  assert.equal(result.my_share,50);
  assert.equal(result.expense_added,true);
  const quote=await db.api.getQuote(1,7);
  assert.equal(quote.my_share,50);
  assert.equal(quote.expense_added,true);
  await assert.rejects(db.api.create(1,7,payload),error=>error.statusCode===409);
});
test('excluded or zero personal share does not create an expense',async()=>{
  for(const changes of [{include_self:false},{mode:'amount',values:{self:0,2:100}}]){
    const db=store();const result=await db.api.create(1,7,{...payload,...changes});
    assert.equal(result.my_share,0);assert.equal(result.expense_added,false);
    assert.equal(db.group.finance,null);assert.equal(db.group.owner_added_to_expense,false);
    assert.equal(db.group.splits[0].share_amount,100);
  }
});
test('rejects ownership violations, outsiders, self friend, stale totals and invalid splits',async()=>{
  for(const [uid,id,data,status] of [[9,7,payload,404],[1,7,{...payload,friend_ids:[99]},400],[1,7,{...payload,friend_ids:[3]},400],[1,7,{...payload,friend_ids:'2'},400],[1,7,{...payload,expected_total:90},409],[1,7,{...payload,mode:'amount',values:{self:10,2:20}},400]]){
    const db=store();await assert.rejects(db.api.create(uid,id,data),error=>error.statusCode===status);assert.equal(db.group,null);
  }
});
test('mapping failure rolls back the Live Split entry',async()=>{
  const db=store();db.failInsert();await assert.rejects(db.api.create(1,7,payload),/insert failed/);assert.equal(db.group,null);
});
