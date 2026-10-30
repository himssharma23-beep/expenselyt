const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const policy = require('../utils/capture-policy');
const db = require('../db/transaction-capture');
const { createService } = require('../utils/transaction-capture');
afterEach(() => mock.restoreAll());

test('optional discovery treats missing tables and capture failures as disabled without migrations',async () => {
  const {readAvailability}=require('../utils/capture-availability');
  for(const code of ['42P01','42501','ECONNREFUSED']) {
    const result=await readAvailability(4,async config => {
      assert.match(config.text,/^SELECT /);
      assert.ok(!/CREATE|ALTER|INSERT/.test(config.text));
      throw Object.assign(new Error('Capture unavailable'),{code});
    });
    assert.equal(Object.values(result.permissions).some(Boolean),false);
  }
});

test('live access and legacy AI endpoints do not depend on capture permissions or schema',async () => {
  mock.method(require('../db/provider'),'assertPostgresConfigured',() => {});
  const authDb=require('../db/postgres-auth');
  const captureCheck=mock.method(db,'assertMethod',async () => {throw new Error('Capture must not be checked');});
  const captureRead=mock.method(db,'access',async () => {throw new Error('Capture database offline');});
  mock.method(authDb,'findUserById',async () => ({role:'user'}));
  mock.method(authDb,'getUserAccessiblePages',async () => ['dashboard','expenses','smartcapture']);
  mock.method(authDb,'getUserAiLookupModes',async () => ({mode:'both',offline:true,online:true}));
  mock.method(authDb,'getUserLiveSplitAccess',async () => ({delete_friend:true}));
  mock.method(authDb,'getUserVoiceAiAccess',async () => ({enabled:true}));
  const router=require('../routes/api');
  const handler=path => router.stack.find(layer => layer.route?.path === path).route.stack.at(-1).handle;
  const access=await new Promise((resolve,reject) => handler('/auth/me/access')({session:{userId:4}},{json:resolve,status:() => ({json:reject})}));
  assert.deepEqual(access.pages,['dashboard','expenses','smartcapture']);
  assert.equal(access.voice_ai.enabled,true);
  let status;
  await handler('/smart-capture/parse-ai')({session:{userId:4},body:{message:''}},{status(value){status=value;return this;},json() {}});
  assert.equal(status,400); // Existing request validation, not the new permission-denied response.
  assert.equal(captureCheck.mock.callCount(),0);
  assert.equal(captureRead.mock.callCount(),0);
});

test('extract transaction amount rather than the available balance or reference', () => {
  const item = policy.parseText('INR 350 debited at Swiggy on 2026-10-27. Available balance INR 45000. UTR 1234567890');
  assert.equal(item.amount,350);
  assert.equal(item.reference,'1234567890');
  assert.equal(item.purchase_date,'2026-10-27');
  assert.equal(item.transaction_direction,'debit');
  const longRef = policy.parseText('INR 350 debited at Merchant on 2026-10-27. UTR 123456789012');
  assert.equal(longRef.reference,'123456789012');
  assert.ok(!longRef.raw_text.includes('123456789012'));
});
test('distinguishes credits, refunds, transfers, failed payments and requests', () => {
  for(const [text,direction] of [
    ['INR 400 credited to your bank account','credit'], ['Refund INR 400 received','refund'],
    ['Credit card bill payment INR 400 paid','transfer'], ['Payment INR 400 failed','pending'],
    ['UPI collect request INR 400','pending'], ['INR 400 paid to Merchant','debit'],
    ['Your order total INR 400','unknown'],
  ]) assert.equal(policy.parseText(text).transaction_direction,direction,text);
});
test('validates dates and marks absent or invalid dates as inferred', () => {
  assert.equal(policy.validDate('2026-02-30'),false);
  assert.equal(policy.validDate('2024-02-29'),true);
  assert.equal(policy.parseText('Paid INR 50 on 30/02/2026').date_inferred,true);
  assert.equal(policy.parseText('Paid INR 50 on 27/10/2026').purchase_date,'2026-10-27');
});
test('permission payloads cannot introduce unknown methods or truthy non-booleans', () => {
  assert.throws(() => policy.validatePermissions({email_gmail:'true'}));
  assert.throws(() => policy.validatePermissions({superuser:true}));
  assert.throws(() => policy.validatePermissions([]));
  assert.deepEqual(policy.validatePermissions({ai_read:false,android_sms:true}),{ai_read:false,android_sms:true});
});
test('auto-save requires both grants, explicit date, debit, confidence, reference and bank', () => {
  const item = {amount:100,transaction_direction:'debit',confidence:98,reference:'UTR123456',bank_account_id:2,date_inferred:false};
  assert.equal(policy.canAutoSave(item,{auto_save:true},{auto_save:true}),true);
  for(const override of [{transaction_direction:'credit'},{transaction_direction:'refund'},{transaction_direction:'transfer'},{transaction_direction:'pending'},{date_inferred:true},{confidence:94},{reference:''},{bank_account_id:null},{card_id:4}]) {
    assert.equal(policy.canAutoSave({...item,...override},{auto_save:true},{auto_save:true}),false);
  }
  assert.equal(policy.canAutoSave(item,{auto_save:false},{auto_save:true}),false);
  assert.equal(policy.canAutoSave(item,{auto_save:true},{auto_save:false}),false);
});
test('disabled method is rejected before reading any data or invoking AI', async () => {
  mock.method(db,'assertMethod',async () => { throw policy.error('Not allowed',403); });
  const ai = mock.fn();
  await assert.rejects(createService({parseAi:ai}).ingest(4,'email_gmail','Paid INR 50',{ai:true}),{statusCode:403});
  assert.equal(ai.mock.callCount(),0);
});
test('AI requires its own per-user grant even when the source method is allowed', async () => {
  mock.method(db,'assertMethod',async (id,method) => {
    if(method === 'ai_read') throw policy.error('AI disabled',403);
    return {permissions:{manual:true},preferences:{manual:true}};
  });
  mock.method(db,'query',async () => ({rows:[]}));
  const ai = mock.fn();
  await assert.rejects(createService({parseAi:ai}).ingest(4,'manual','Paid INR 50',{ai:true}),{statusCode:403});
  assert.equal(ai.mock.callCount(),0);
});
test('a duplicate retries without another AI request and stays scoped to the owner', async () => {
  mock.method(db,'assertMethod',async () => ({permissions:{manual:true},preferences:{manual:true}}));
  const queries=[];
  mock.method(db,'query',async (sql,args) => { queries.push(args); return {rows:[{id:9,method:'manual',payload:{amount:50},status:'pending'}]}; });
  const ai = mock.fn();
  const item=await createService({parseAi:ai}).ingest(4,'manual','Paid INR 50',{ai:true});
  assert.equal(item.duplicate,true); assert.equal(item.id,'9'); assert.equal(queries[0][0],4); assert.equal(ai.mock.callCount(),0);
});
test('verification messages never enter AI processing',async () => {
  mock.method(db,'assertMethod',async () => ({permissions:{manual:true},preferences:{manual:true}}));
  const ai = mock.fn();
  await assert.rejects(createService({parseAi:ai}).ingest(4,'manual','OTP 123456 to pay INR 50',{ai:true}),{statusCode:422});
  assert.equal(ai.mock.callCount(),0);
});
test('confirm is idempotent and never posts a second expense',async () => {
  mock.method(db,'ensureSchema',async () => {});
  mock.method(db,'assertMethod',async () => ({}));
  mock.method(db,'withTransaction',async fn => fn({query:async sql => ({rows:sql.includes('FOR UPDATE') ? [{status:'added',method:'manual',expense_id:123,payload:{}}] : []})}));
  assert.deepEqual(await createService({}).confirm(4,9,{}),{id:123,already_added:true});
});
test('confirm refuses another user capture and non-spending transactions',async () => {
  mock.method(db,'ensureSchema',async () => {});
  mock.method(db,'assertMethod',async () => ({}));
  let row;
  mock.method(db,'withTransaction',async fn => fn({query:async (sql,args) => {
    if(sql.includes('FOR UPDATE')) { assert.equal(args[1],4); return {rows:row ? [row] : []}; }
    return {rows:[]};
  }}));
  await assert.rejects(createService({}).confirm(4,9,{}),{statusCode:404});
  for(const direction of ['credit','refund','pending','transfer']) {
    row={status:'pending',method:'manual',payload:{transaction_direction:direction}};
    await assert.rejects(createService({}).confirm(4,9,{confirm_expense:true}),{statusCode:422});
  }
});
test('permission revocation during parsing prevents persistence',async () => {
  let checks=0,inserted=false;
  mock.method(db,'assertMethod',async () => {
    if(++checks > 1) throw policy.error('Revoked',403);
    return {permissions:{manual:true},preferences:{manual:true}};
  });
  mock.method(db,'query',async () => ({rows:[]}));
  mock.method(db,'withTransaction',async fn => fn({query:async sql => { if(sql.includes('INSERT')) inserted=true; return {rows:[]}; }}));
  await assert.rejects(createService({}).ingest(4,'manual','Paid INR 50 at Merchant'),{statusCode:403});
  assert.equal(inserted,false);
});
test('automatic confirmation rechecks the latest automatic-save consent',async () => {
  mock.method(db,'ensureSchema',async () => {});
  mock.method(db,'assertMethod',async () => ({permissions:{manual:true,auto_save:true},preferences:{manual:true,auto_save:false}}));
  mock.method(db,'withTransaction',async fn => fn({query:async sql => ({rows:sql.includes('FOR UPDATE') ? [{status:'pending',method:'manual',payload:{amount:100,transaction_direction:'debit',confidence:98,reference:'REF123456',bank_account_id:2,date_inferred:false}}] : []})}));
  assert.deepEqual(await createService({}).confirm(4,9,{},true),{id:null,not_added:true});
});
test('mail tokens encrypt with authenticated encryption; tampering is rejected', () => {
  const mail = require('../utils/capture-email');
  const old = process.env.CAPTURE_TOKEN_ENCRYPTION_KEY;
  process.env.CAPTURE_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
  try {
    const sealed=mail.encrypt({refresh_token:'private',senders:['alerts@bank.example']});
    assert.ok(!sealed.includes('private'));
    assert.equal(mail.decrypt(sealed).refresh_token,'private');
    const data=Buffer.from(sealed,'base64'); data[30]^=1;
    assert.throws(() => mail.decrypt(data.toString('base64')));
  } finally { if(old === undefined) delete process.env.CAPTURE_TOKEN_ENCRYPTION_KEY; else process.env.CAPTURE_TOKEN_ENCRYPTION_KEY=old; }
});

test('HTTP routes enforce session, administrator, token and owner boundaries', async () => {
  const check = async (_name, fn) => fn();
  const express = require('express');
  const authDb = require('../db/postgres-auth');
  const routerFactory = require('../routes/transaction-capture');
  mock.method(authDb,'findUserById',async id => ({id:Number(id),is_active:true,role:Number(id) === 2 ? 'admin' : 'user'}));
  mock.method(authDb,'getUserAuthTag',async () => 'test-tag');
  mock.method(db,'ensureSchema',async () => {});
  mock.method(db,'access',async id => ({permissions:{manual:true},preferences:{manual:true},role:Number(id) === 2 ? 'admin' : 'user'}));
  mock.method(db,'assertMethod',async (id,method) => {
    if(method !== 'manual') throw policy.error('Method disabled',403);
    return {permissions:{manual:true},preferences:{manual:true}};
  });
  mock.method(db,'query',async (sql,args) => {
    if(sql.includes('token_hash')) return {rows:[]};
    if(sql.includes('method=ANY')) return {rows:[{id:100+Number(args[0]),method:'manual',status:'pending',payload:{item_name:'Owner '+args[0],amount:100}}]};
    if(sql.includes('fingerprint')) return {rows:[]};
    return {rows:[]};
  });
  let changes;
  mock.method(db,'setPermissions',async (id,permissions,adminId) => { changes={id,permissions,adminId}; return {permissions}; });
  const app=express(); app.use(express.json());
  app.use((req,res,next) => {
    // Test fixture only; production gets the session from the existing authentication middleware.
    if(req.headers['x-test-user']) req.session={userId:Number(req.headers['x-test-user']),authTag:'test-tag'};
    next();
  });
  app.use('/api/capture',routerFactory({parseAi:async () => {throw new Error('AI must not run');}}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api/capture';
  async function request(path,user,body,method) {
    return fetch(base+path,{method:method || (body ? 'POST' : 'GET'),headers:{'Content-Type':'application/json',...(user ? {'x-test-user':String(user)} : {})},body:body ? JSON.stringify(body) : undefined});
  }
  try {
    await check('anonymous users cannot list captures',async () => assert.equal((await request('/items')).status,401));
    await check('ordinary users cannot grant permissions',async () => assert.equal((await request('/admin/users/4',4,{permissions:{ai_read:true}},'PUT')).status,403));
    await check('administrator grants apply only to the selected user',async () => {
      const response=await request('/admin/users/4',2,{permissions:{ai_read:true}},'PUT');
      assert.equal(response.status,200); assert.deepEqual(changes,{id:'4',permissions:{ai_read:true},adminId:2});
    });
    await check('inbox ignores a submitted user id and uses the authenticated owner',async () => {
      const response=await request('/items?user_id=2',4); const body=await response.json();
      assert.equal(body.items[0].item_name,'Owner 4');
    });
    await check('AI read cannot be enabled by adding a user id to the request',async () => {
      const response=await request('/items',4,{method:'manual',text:'Paid INR 500 at Merchant',ai:true,user_id:2});
      assert.equal(response.status,403);
    });
    await check('revoked submission tokens cannot invoke shortcuts or device capture',async () => {
      for(const [path,body] of [['/shortcut',{text:'Paid INR 50'}],['/device',{method:'android_sms',text:'Paid INR 50'}]]) {
        const response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer revoked-token','Content-Type':'application/json'},body:JSON.stringify(body)});
        assert.equal(response.status,401);
      }
    });
    await check('forwarded email requires the gateway secret',async () => {
      const response=await request('/email/inbound',null,{recipient:'capture+fake@example.com',text:'Paid INR 50'});
      assert.equal(response.status,401);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
