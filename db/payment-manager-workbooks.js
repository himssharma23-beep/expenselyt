const crypto=require('crypto');
const {query,withTransaction}=require('./postgres');
const core=require('./postgres-core');
const billing=require('./postgres-billing');
const {syncSourceBankPayment}=require('./source-bank-payment');
const model=require('../public/js/payment-manager-workbook-model');
const {ensureLiveSplitCurrencySchema}=require('./live-split-currency');
let ready;
function fail(message,statusCode=400){return Object.assign(Error(message),{statusCode});}
function checkMoney(value){try{return model.money(value);}catch(error){throw fail(error.message);}}
async function ensureSchema(){
  if(!ready)ready=query(`CREATE TABLE IF NOT EXISTS payment_manager_workbooks (
    id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_key TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,document JSONB NOT NULL,
    posting_links JSONB NOT NULL DEFAULT '{}',posted_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,client_key)
  ); CREATE TABLE IF NOT EXISTS payment_manager_workbook_payments (
    id BIGSERIAL PRIMARY KEY,workbook_id BIGINT NOT NULL REFERENCES payment_manager_workbooks(id) ON DELETE CASCADE,
    expense_key TEXT NOT NULL,UNIQUE(workbook_id,expense_key)
  );`).catch(e=>{ready=null;throw e;});
  return ready;
}
const safeKey=k=>typeof k==='string'&&/^[a-zA-Z0-9:_-]{1,90}$/.test(k);
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function contentHash(doc){const {checklist,...rest}=doc;return crypto.createHash('sha256').update(JSON.stringify(canonical(rest))).digest('hex');}
function response(row){return {id:Number(row.id),revision:row.revision,document:row.document,plan:model.calculate(row.document),posted:!!row.posted_hash,synced:row.posted_hash===contentHash(row.document),updated_at:row.updated_at};}
async function list(uid){await ensureSchema();return (await query('SELECT * FROM payment_manager_workbooks WHERE user_id=$1 ORDER BY updated_at DESC',[uid])).rows.map(response);}
async function get(uid,id){await ensureSchema();const row=(await query('SELECT * FROM payment_manager_workbooks WHERE id=$1 AND user_id=$2',[id,uid])).rows[0];if(!row)throw fail('Saved split not found',404);return response(row);}
async function normalize(client,uid,input,previous){
  if(JSON.stringify(input||{}).length>300000)throw fail('This saved split is too large.');
  if(!input||!Array.isArray(input.people)||!Array.isArray(input.expenses)||input.people.length>50||input.expenses.length>200)throw fail('Use at most 50 members and 200 expenses.');
  const title=String(input.title||'').trim();if(!title||title.length>120)throw fail('Enter a description of at most 120 characters.');
  const date=String(input.date||''),parsed=new Date(date+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw fail('Choose a valid date.');
  const owner=(await client.query('SELECT display_name,username,currency_code FROM users WHERE id=$1',[uid])).rows[0];
  const people=[],identities=new Set(),names=new Set();
  for(const p of input.people){
    if(!safeKey(p.key))throw fail('Invalid member key.');
    let row={key:p.key,name:String(p.name||'').trim(),post_to_live_split:p.post_to_live_split===true};
    if(p.key==='self')row={...row,name:owner.display_name||owner.username||'You',post_to_live_split:true};
    else if(p.friend_id){
      const friend=(await client.query('SELECT id,name,linked_user_id FROM live_split_friends WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL',[p.friend_id,uid])).rows[0];
      if(!friend||Number(friend.linked_user_id)===Number(uid))throw fail('Choose friends from your own Live Split list.');
      row={...row,friend_id:Number(friend.id),name:friend.name,linked_user_id:friend.linked_user_id};
    }
    if(!row.name||row.name.length>120)throw fail('Enter a name for every member.');
    const identity=row.key==='self'?'self':row.linked_user_id?'user:'+row.linked_user_id:row.friend_id?'friend:'+row.friend_id:row.key;
    const name=row.name.toLowerCase();if(identities.has(identity)||names.has(name))throw fail('Members must have distinct names and accounts.');identities.add(identity);names.add(name);people.push(row);
  }
  const keys=new Set(people.map(p=>p.key));if(keys.size!==people.length)throw fail('Members must have distinct keys.');
  const expenses=input.expenses.map(e=>{
    if(!safeKey(e.key)||!Array.isArray(e.participants)||e.participants.length>50)throw fail('Invalid expense row.');
    const label=String(e.title||'').trim();if(!label||label.length>160)throw fail('Enter a name for each expense.');
    const source=String(e.payment_source||'none');if(!['none','bank','card'].includes(source))throw fail('Choose a valid payment source.');
    if(source!=='none'&&e.paid_by!=='self')throw fail('You can only charge your own payments to your bank or card.');
    if(e.values!=null&&(typeof e.values!=='object'||Array.isArray(e.values)))throw fail('Invalid split values.');
    return {key:e.key,title:label,amount:e.amount,paid_by:e.paid_by,participants:e.participants,mode:e.mode||'equal',values:Object.fromEntries(e.participants.filter(k=>e.values?.[k]!=null).map(k=>[k,e.values[k]])),payment_source:source,payment_account_id:source==='none'?null:Number(e.payment_account_id)||null};
  });
  const overrides=Object.fromEntries(people.filter(p=>input.overrides?.[p.key]!=null&&String(input.overrides[p.key]).trim()!=='').map(p=>[p.key,input.overrides[p.key]]));
  const checklist=Object.fromEntries(people.map(p=>[p.key,input.checklist?.[p.key]===true]));
  const doc={title,date,currency_code:previous?.currency_code||owner.currency_code||'INR',manager_key:input.manager_key,people,expenses,overrides,checklist,finance:{add_expense:input.finance?.add_expense===true},client_key:input.client_key};
  // Reject malformed numbers even in drafts; incomplete drafts may still be saved.
  for(const e of expenses){if(e.amount!==''&&e.amount!=null)checkMoney(e.amount);for(const v of Object.values(e.values)){if(typeof v!=='string'&&typeof v!=='number')throw fail('Invalid split value.');}}
  for(const v of Object.values(overrides))checkMoney(v);
  return doc;
}
async function resolveGuests(client,uid,doc){
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['manager-guests:'+uid]);
  for(const p of doc.people.filter(p=>p.key!=='self'&&p.post_to_live_split&&!p.friend_id)){
    let friend=(await client.query('SELECT id,name,linked_user_id FROM live_split_friends WHERE user_id=$1 AND lower(trim(name))=lower($2) AND deleted_at IS NULL ORDER BY id LIMIT 1',[uid,p.name])).rows[0];
    if(!friend)friend=(await client.query('INSERT INTO live_split_friends (user_id,name) VALUES ($1,$2) RETURNING id,name,linked_user_id',[uid,p.name])).rows[0];
    if(Number(friend.linked_user_id)===Number(uid))throw fail('A guest cannot be linked to your own account.');
    p.friend_id=Number(friend.id);p.linked_user_id=friend.linked_user_id;p.name=friend.name;
  }
  const identities=new Set();
  for(const p of doc.people){
    const identity=p.key==='self'?'user:'+uid:p.linked_user_id?'user:'+p.linked_user_id:p.friend_id?'friend:'+p.friend_id:p.key;
    if(identities.has(identity))throw fail('Two members resolve to the same Live Split account. Keep just one of them.');
    identities.add(identity);
  }
}
async function syncPosting(client,uid,row,doc,plan){
  const currency=(await client.query('SELECT currency_code FROM users WHERE id=$1',[uid])).rows[0]?.currency_code||'INR';
  if(doc.currency_code!==currency&&(doc.finance.add_expense||doc.expenses.some(e=>e.paid_by==='self'&&e.payment_source!=='none')))throw fail('This saved split uses '+doc.currency_code+' while your account uses '+currency+'. Use the matching profile currency before posting to Expenses or an account.');
  await resolveGuests(client,uid,doc);
  const people=new Map(doc.people.map(p=>[p.key,p]));
  const links={},existing=row.posting_links||{};
  const liveIds=new Set((await client.query('SELECT id FROM live_split_groups WHERE user_id=$1 AND id=ANY($2::bigint[])',[uid,Object.values(existing)])).rows.map(p=>Number(p.id)));
  for(const entry of plan.entries){
    const from=people.get(entry.from),to=people.get(entry.to);
    if([from,to].some(p=>p.key!=='self'&&(!p.post_to_live_split||!p.friend_id)))continue;
    const splits=[from,to].filter(p=>p.friend_id).map(p=>({friend_id:p.friend_id,friend_name:p.name,share_amount:p.key===from.key?entry.amount:0}));
    const payload={divide_date:doc.date,details:doc.title+' - '+(entry.kind==='collection'?'Share owed: ':'Reimbursement owed: ')+from.name+' to '+to.name,heading:doc.title,paid_by:to.key==='self'?'You':to.name,total_amount:entry.amount,currency_code:doc.currency_code,session_id:'workbook-'+row.id,split_mode:'amount',splits,allow_duplicate:true,finance:null};
    let id=Number(existing[entry.key]);
    if(liveIds.has(id))await core.updateLiveSplitGroup(uid,id,payload,client);
    else id=await core.addLiveSplitGroup(uid,payload,client);
    await core.syncSingleLiveSplitGroupShares(client,uid,id,splits.map(p=>p.friend_id));links[entry.key]=id;
  }
  for(const [key,id] of Object.entries(existing))if(!links[key]&&liveIds.has(Number(id)))await core.deleteLiveSplitGroup(uid,Number(id),client);
  const own=plan.people.find(p=>p.key==='self');
  const expense=(await client.query("SELECT * FROM expenses WHERE user_id=$1 AND source='pm_workbook' AND source_id=$2 AND deleted_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE",[uid,row.id])).rows[0];
  if(doc.finance.add_expense&&own?.share>0){
    const payload={item_name:doc.title+' - My share',amount:own.share,purchase_date:doc.date,bank_account_id:null,source:'pm_workbook',source_id:row.id,is_extra:expense?.is_extra||false};
    if(expense)await core.updateExpense(uid,expense.id,payload,client);else await core.addExpense(uid,payload,client);
  }else if(expense)await core.deleteExpense(uid,expense.id,client);
  const payments=(await client.query('SELECT * FROM payment_manager_workbook_payments WHERE workbook_id=$1',[row.id])).rows;
  for(const e of doc.expenses){
    if(e.paid_by!=='self')continue;
    if(!payments.some(p=>p.expense_key===e.key))payments.push((await client.query('INSERT INTO payment_manager_workbook_payments (workbook_id,expense_key) VALUES ($1,$2) RETURNING *',[row.id,e.key])).rows[0]);
  }
  for(const payment of payments){
    const e=doc.expenses.find(e=>e.key===payment.expense_key&&e.paid_by==='self');
    const source=e?.payment_source||'none',accountId=e?.payment_account_id;
    if(source!=='none'){
      const table=source==='bank'?'bank_accounts':'credit_cards';
      const condition=source==='bank'?' AND deleted_at IS NULL AND COALESCE(is_active,TRUE)=TRUE':' AND is_active=TRUE';
      if(!(await client.query(`SELECT id FROM ${table} WHERE user_id=$1 AND id=$2${condition} FOR UPDATE`,[uid,accountId])).rows.length)throw fail('Choose your own active bank account or credit card.');
    }
    await syncSourceBankPayment(client,core.adjustBankBalance,{source:'pm_workbook_payment',sourceId:payment.id,userId:uid,bankId:source==='bank'?accountId:null,amount:source==='bank'?-Number(e.amount):0,note:doc.title+' - '+(e?.title||'Removed payment')});
    const old=await billing.getCcTxnBySource(uid,'pm_workbook_payment',payment.id,client);
    const payload=source==='card'?{card_id:accountId,txn_date:doc.date,description:doc.title+' - '+e.title,amount:Number(e.amount),discount_pct:0,source:'pm_workbook_payment',source_id:payment.id}:null;
    if(old){await billing.deleteCcTxn(uid,old.id,client);}
    if(payload)await billing.addCcTxn(uid,payload,client);
  }
  return links;
}
async function save(uid,id,data){
  await ensureSchema();
  await ensureLiveSplitCurrencySchema();
  return withTransaction(async client=>{
    let row;
    const clientKey=String(data.document?.client_key||'');if(!safeKey(clientKey))throw fail('Invalid saved split identifier.');
    if(id){row=(await client.query('SELECT * FROM payment_manager_workbooks WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,uid])).rows[0];if(!row)throw fail('Saved split not found',404);if(Number(data.revision)!==row.revision)throw fail('This split changed on another screen. Reopen it before saving.',409);}
    else{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['workbook:'+uid+':'+clientKey]);
      row=(await client.query('SELECT * FROM payment_manager_workbooks WHERE user_id=$1 AND client_key=$2 FOR UPDATE',[uid,clientKey])).rows[0];
      if(row)return response(row);
    }
    const doc=await normalize(client,uid,data.document,row?.document),plan=model.calculate(doc);
    if(row&&plan.valid){
      const previous=model.calculate(row.document);
      for(const person of plan.people){const old=previous.people.find(p=>p.key===person.key);if(!old||Math.round(old.share*100)!==Math.round(person.share*100))doc.checklist[person.key]=false;}
    }
    if(data.publish===true&&!plan.valid)throw fail(plan.errors.join(' '));
    if(data.publish===true&&doc.finance.add_expense&&!plan.people.some(p=>p.key==='self'&&p.share>0))throw fail('Include yourself with a positive share to add it to Expenses.');
    if(!row)row=(await client.query('INSERT INTO payment_manager_workbooks (user_id,client_key,document) VALUES ($1,$2,$3::jsonb) RETURNING *',[uid,clientKey,JSON.stringify(doc)])).rows[0];
    const links=data.publish===true?await syncPosting(client,uid,row,doc,plan):row.posting_links;
    const hash=data.publish===true?contentHash(doc):row.posted_hash;
    const saved=(await client.query('UPDATE payment_manager_workbooks SET document=$1::jsonb,posting_links=$2::jsonb,posted_hash=$3,revision=revision+1,updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *',[JSON.stringify(doc),JSON.stringify(links||{}),hash,row.id,uid])).rows[0];
    return response(saved);
  });
}
async function checklist(uid,id,data){
  await ensureSchema();return withTransaction(async client=>{
    const row=(await client.query('SELECT * FROM payment_manager_workbooks WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,uid])).rows[0];
    if(!row)throw fail('Saved split not found',404);
    if(Number(data.revision)!==row.revision)throw fail('Checklist changed on another screen. Reopen it to continue.',409);
    const doc=row.document;
    if(data.reset===true)doc.checklist={};
    else {if(!doc.people.some(p=>p.key===data.key)||typeof data.paid!=='boolean')throw fail('Choose a valid member and paid status.');doc.checklist={...doc.checklist,[data.key]:data.paid};}
    return response((await client.query('UPDATE payment_manager_workbooks SET document=$1::jsonb,revision=revision+1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING *',[JSON.stringify(doc),id,uid])).rows[0]);
  });
}
module.exports={ensureSchema,list,get,save,checklist};
