// Integration checks run in one outer transaction and always roll back every fixture.
const fs=require('node:fs');
const assert=require('node:assert/strict');
try{for(const line of fs.readFileSync('.env','utf8').split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&!line.startsWith('#')){const key=line.slice(0,i).trim();if(!process.env[key])process.env[key]=line.slice(i+1).trim();}}}catch{}
const pg=require('../db/postgres');
(async()=>{
  const pool=pg.getPool(),client=await pool.connect();
  let n=0;
  try{
    await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");await client.query("SET LOCAL statement_timeout='15s'");
    pg.query=(...args)=>client.query(...args);
    pg.withTransaction=async fn=>{const sp='workbook_test_'+(++n);await client.query('SAVEPOINT '+sp);try{const result=await fn(client);await client.query('RELEASE SAVEPOINT '+sp);return result;}catch(e){await client.query('ROLLBACK TO SAVEPOINT '+sp);throw e;}};
    // Existing currency migrations are covered separately; avoid touching other users' rows.
    require('../db/live-split-currency').ensureLiveSplitCurrencySchema=async()=>{};
    const db=require('../db/payment-manager-workbooks');
    const suffix=Date.now().toString(36);
    async function user(name){return Number((await client.query('INSERT INTO users (username,email,password_hash,display_name,currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id',['test-workbook-'+name+'-'+suffix,name+'-'+suffix+'@example.invalid','not-a-login',name,'INR'])).rows[0].id);}
    const uid=await user('Owner'),other=await user('Other');
    const fid=Number((await client.query('INSERT INTO live_split_friends (user_id,name,linked_user_id) VALUES ($1,$2,$3) RETURNING id',[uid,'Other',other])).rows[0].id);
    const bank=Number((await client.query('INSERT INTO bank_accounts (user_id,bank_name,account_name,balance) VALUES ($1,$2,$3,$4) RETURNING id',[uid,'Test bank','Workbook',10000])).rows[0].id);
    const card=Number((await client.query('INSERT INTO credit_cards (user_id,card_name,bank_name,last4,bill_gen_day,due_days) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',[uid,'Test card','Test','0000',15,20])).rows[0].id);
    const M=require('../public/js/payment-manager-workbook-model');
    let doc=M.fresh('2026-11-10');doc.title='Workbook integration';doc.people.push({key:'friend:'+fid,friend_id:fid,name:'Other',post_to_live_split:true},{key:'guest:test',name:'Test guest',post_to_live_split:false});
    doc.expenses=[{key:'bank',title:'Food',amount:300,paid_by:'self',participants:doc.people.map(p=>p.key),mode:'equal',payment_source:'bank',payment_account_id:bank},{key:'card',title:'Drinks',amount:200,paid_by:'self',participants:['self','friend:'+fid],mode:'equal',payment_source:'card',payment_account_id:card}];doc.finance.add_expense=true;
    let record=await db.save(uid,null,{document:doc,publish:false});
    assert.equal(record.posted,false);assert.equal((await db.list(uid)).length,1);
    assert.equal(Number((await client.query('SELECT balance FROM bank_accounts WHERE id=$1',[bank])).rows[0].balance),10000);
    assert.equal((await client.query("SELECT id FROM live_split_groups WHERE user_id=$1 AND session_id=$2",[uid,'workbook-'+record.id])).rows.length,0);
    await assert.rejects(db.get(other,record.id),e=>e.statusCode===404);
    record=await db.save(uid,record.id,{document:record.document,revision:record.revision,publish:true});
    assert.equal(record.synced,true);assert.equal(record.plan.total,500);
    const groups=()=>client.query('SELECT id FROM live_split_groups WHERE user_id=$1 AND session_id=$2 ORDER BY id',[uid,'workbook-'+record.id]);
    const expenses=()=>client.query("SELECT * FROM expenses WHERE user_id=$1 AND source='pm_workbook' AND source_id=$2 AND deleted_at IS NULL",[uid,record.id]);
    const txns=()=>client.query("SELECT * FROM cc_txns WHERE user_id=$1 AND source='pm_workbook_payment'",[uid]);
    assert.equal((await groups()).rows.length,1);assert.equal(Number((await expenses()).rows[0].amount),200);assert.equal((await txns()).rows.length,1);
    assert.equal(Number((await client.query('SELECT balance FROM bank_accounts WHERE id=$1',[bank])).rows[0].balance),9700);
    const originalGroup=(await groups()).rows[0].id;
    record=await db.save(uid,record.id,{document:record.document,revision:record.revision,publish:true});
    assert.equal((await groups()).rows[0].id,originalGroup);assert.equal((await expenses()).rows.length,1);assert.equal((await txns()).rows.length,1);
    assert.equal(Number((await client.query('SELECT balance FROM bank_accounts WHERE id=$1',[bank])).rows[0].balance),9700);
    const previousRevision=record.revision;
    record=await db.checklist(uid,record.id,{revision:record.revision,key:'guest:test',paid:true});assert.equal(record.document.checklist['guest:test'],true);assert.equal(record.synced,true);
    await assert.rejects(db.checklist(uid,record.id,{revision:previousRevision,key:'self',paid:true}),e=>e.statusCode===409);
    await assert.rejects(db.save(other,record.id,{revision:record.revision,document:record.document,publish:true}),e=>e.statusCode===404);
    doc=JSON.parse(JSON.stringify(record.document));doc.people[2].post_to_live_split=true;doc.expenses[0].amount=600;doc.expenses[1].payment_source='none';doc.expenses[1].payment_account_id=null;
    record=await db.save(uid,record.id,{document:doc,revision:record.revision,publish:true});
    assert.ok(record.document.people[2].friend_id);assert.equal((await groups()).rows.length,2);assert.equal((await txns()).rows.length,0);assert.equal(Number((await expenses()).rows[0].amount),300);
    assert.equal(record.document.checklist['guest:test'],false,'changed shares must clear an old paid checkbox');
    assert.equal(Number((await client.query('SELECT balance FROM bank_accounts WHERE id=$1',[bank])).rows[0].balance),9400);
    const before=record;doc=JSON.parse(JSON.stringify(record.document));doc.expenses[0].payment_account_id=-1;
    await assert.rejects(db.save(uid,record.id,{document:doc,revision:record.revision,publish:true}),/own active/);
    record=await db.get(uid,record.id);assert.equal(record.revision,before.revision);assert.equal((await groups()).rows.length,2);
    await assert.rejects(db.save(uid,record.id,{document:{...record.document,date:'2026-99-10'},revision:record.revision,publish:true}),e=>e.statusCode===400);
    const invalid=JSON.parse(JSON.stringify(record.document));invalid.expenses[0].amount=-1;
    await assert.rejects(db.save(uid,record.id,{document:invalid,revision:record.revision,publish:true}),e=>e.statusCode===400);
    await assert.rejects(db.save(uid,record.id,{document:record.document,revision:record.revision-1,publish:true}),e=>e.statusCode===409);
    doc=JSON.parse(JSON.stringify(record.document));doc.expenses.splice(0,1);doc.finance.add_expense=false;
    record=await db.save(uid,record.id,{document:doc,revision:record.revision,publish:true});
    assert.equal(Number((await client.query('SELECT balance FROM bank_accounts WHERE id=$1',[bank])).rows[0].balance),10000);assert.equal((await expenses()).rows.length,0);
    record=await db.checklist(uid,record.id,{revision:record.revision,reset:true});assert.equal(record.plan.paid_count,0);
    console.log('PostgreSQL saved split integration passed: drafts, guest opt-in, member sharing, expense and bank/card sync, edits, no duplicates, rollback, checklist, ownership and revision checks.');
  }finally{await client.query('ROLLBACK');client.release();await pool.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
