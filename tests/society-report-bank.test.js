const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {buildSocietyPdfHtml}=require('../utils/shared-pdf-html');
const {normalizeSocietyBankDetails,societyQrImageExtension}=require('../utils/society-bank-details');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=','base64');
function detail(){return {
  society:{name:'Society test'},selected_month:'2026-11',matrix_months:['2026-10','2026-11'],
  members:[{id:1,member_name:'Current Resident',is_active:true,contributions_by_month:{'2026-10':100,'2026-11':150}},{id:2,member_name:'Former Resident',is_active:false,contributions_by_month:{'2026-10':200,'2026-11':350}}],
  member_balances:[{member_id:1,member_name:'Current Resident',amount:25},{member_id:2,member_name:'Former Resident',amount:75}],
  member_balance_settlements:[{member_id:2,member_name:'Former Resident',amount:20}],
  month_summary:[{month_key:'2026-11',total_collected:500,total_spent:100,balance:400}],
  totals:{member_count:2,overall_collected:800,overall_spent:100,overall_balance:700,member_owed_gross_total:100,member_settled_total:20,member_owed_total:80},
};}
test('custom PDF hides inactive residents in all member sections and retains complete totals',()=>{
 const d=detail(),before=JSON.stringify(d),html=buildSocietyPdfHtml('custom',d,{include_summary:true,include_report:true,include_matrix:true,matrix_months:d.matrix_months});
 assert.match(html,/Current Resident/);assert.doesNotMatch(html,/Former Resident/);
 const footer=html.match(/<tfoot>[\s\S]*?<\/tfoot>/)?.[0].replace(/<[^>]+>/g,' ');
 assert.match(footer,/All members total\s+300\s+500\s+800/);
 assert.match(html,/₹700.00/);assert.match(html,/Only active members are listed/);assert.equal(JSON.stringify(d),before);
});
test('paid and unpaid selections only list active residents without narrowing the grand total',()=>{
 const d=detail();d.members.push({id:3,member_name:'Unpaid Resident',is_active:true,contributions_by_month:{}});
 for(const scope of ['paid','unpaid']){
  const html=buildSocietyPdfHtml('custom',d,{member_scope:scope,include_matrix:true,matrix_months:d.matrix_months});
  assert.doesNotMatch(html,/Former Resident/);assert.match(html,/₹800.00/);
  if(scope==='paid'){assert.match(html,/Current Resident/);assert.doesNotMatch(html,/Unpaid Resident/);}else{assert.doesNotMatch(html,/Current Resident/);assert.match(html,/Unpaid Resident/);}
 }
});
test('all inactive members yield no named rows while historical totals remain',()=>{
 const d=detail();d.members.forEach(m=>m.is_active=false);
 const html=buildSocietyPdfHtml('custom',d,{include_matrix:true,include_report:true,matrix_months:d.matrix_months});
 assert.doesNotMatch(html,/Current Resident|Former Resident/);assert.match(html,/₹800.00/);
 assert.match(html,/Member ledger/);assert.match(html,/All members settled total/);assert.match(html,/₹80.00/);
});
test('all 16 section checkbox combinations include only their checked content',()=>{
 const d=detail();d.month_expenses=[{title:'Current expense',amount:10,expense_date:'2026-11-02'}];
 for(let mask=0;mask<16;mask++){
  const options={include_summary:!!(mask&1),include_report:!!(mask&2),include_matrix:!!(mask&4),include_expenses:!!(mask&8),matrix_months:['2026-11']};
  const html=buildSocietyPdfHtml('custom',d,options);
  for(const [key,marker] of [['include_summary','<section class="collection-summary">'],['include_report','<section class="monthly-cards">'],['include_report','<table class="financial">'],['include_report','<h2>Member ledger</h2>'],['include_report','<h2>Settlement history</h2>'],['include_matrix','<table class="matrix">'],['include_expenses','<h2>Expenses</h2>']]){
   assert.equal(html.includes(marker),options[key],`Combination ${mask}: ${marker}`);
  }
 }
});
test('matrix month checkboxes do not narrow summary or all-time report',()=>{
 const d=detail();
 const html=buildSocietyPdfHtml('custom',d,{include_summary:true,include_report:true,include_matrix:false,matrix_months:['2026-11']});
 const summary=html.match(/<section class="collection-summary">[\s\S]*?<\/section>/)[0];
 const report=html.match(/<section class="monthly-cards">[\s\S]*?<\/section>/)[0];
 assert.match(summary,/800\.00/);assert.match(report,/Oct 2026/);assert.match(report,/Nov 2026/);
 assert.doesNotMatch(html,/<table class="matrix">/);
 assert.match(html,/@page \{size:400pt 800pt/);
});
test('expense selection is independent of matrix months and includes exactly its selected scope',()=>{
 const d=detail();d.expenses=[{title:'October expense',month_key:'2026-10',amount:10},{title:'November expense',expense_date:'2026-11-02',amount:20},{title:'December expense',month_key:'2026-12',amount:30}];d.month_expenses=[d.expenses[1]];
 const options={include_summary:false,include_report:false,include_matrix:false,include_expenses:true,matrix_months:['2026-10']};
 const current=buildSocietyPdfHtml('custom',d,{...options,expense_scope:'current'});assert.match(current,/November expense/);assert.doesNotMatch(current,/October expense|December expense/);
 const all=buildSocietyPdfHtml('custom',d,{...options,expense_scope:'all'});for(const name of ['October','November','December'])assert.match(all,new RegExp(name+' expense'));
 const selected=buildSocietyPdfHtml('custom',d,{...options,expense_scope:'selected',expense_months:['2026-11']});assert.match(selected,/November expense/);assert.doesNotMatch(selected,/October expense|December expense/);
 const empty=buildSocietyPdfHtml('custom',d,{...options,expense_scope:'selected',expense_months:[]});assert.doesNotMatch(empty,/October expense|November expense|December expense/);assert.match(empty,/No expenses in this selection/);
});
test('bank fields preserve leading zeros, permit removal, retain omitted settings, and validate dates/images',()=>{
 const bank={bank_name:' Test Bank ',account_number:'0000123456',customer_number:'000987',established_date:'2020-02-29',qr_image_path:'/uploads/societies/qr-abc.png'};
 const normalized=normalizeSocietyBankDetails(bank);assert.equal(normalized.account_number,'0000123456');assert.equal(normalized.customer_number,'000987');assert.equal(normalized.bank_name,'Test Bank');
 assert.deepEqual(normalizeSocietyBankDetails(undefined,normalized),normalized);
 assert.equal(normalizeSocietyBankDetails({...bank,qr_image_path:''}).qr_image_path,'');
 assert.throws(()=>normalizeSocietyBankDetails({...bank,established_date:'2026-02-30'}),/Invalid date/);
 assert.throws(()=>normalizeSocietyBankDetails({...bank,account_number:1234}),/must be text/);
 assert.throws(()=>normalizeSocietyBankDetails({...bank,qr_image_path:'https://example.com/qr.svg'}),/Invalid QR/);
 assert.equal(societyQrImageExtension({buffer:png}),'.png');assert.throws(()=>societyQrImageExtension({buffer:Buffer.from('<svg/>')}),/PNG/);
 assert.throws(()=>societyQrImageExtension({buffer:Buffer.alloc(5*1024*1024+1)}),/5 MB/);
});
test('mobile custom PDF sends the full history for the shared renderer',async()=>{
 const source=fs.readFileSync('C:/P/ExpenseManager_mobile/src/services/societyPdf.js','utf8');
 const start=source.indexOf('export async function shareSocietyCustomPdf('),end=source.indexOf('export async function shareSocietyMapPdf(',start);
 const context={getCurrencyPrefs:()=>({currency_code:'INR'}),shareSharedTemplatePdf:async(template,payload)=>payload};
 vm.createContext(context);vm.runInContext(source.slice(start,end).replace('export ',''),context);
 const d=detail(),payload=await context.shareSocietyCustomPdf(d,{include_matrix:true});
 assert.equal(payload.detail,d);assert.equal(payload.detail.members.length,2);assert.equal(payload.detail.totals.overall_collected,800);
});
test('database writes bank details as JSON and preserves them on unrelated edits',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../db/postgres-core.js'),'utf8');
 const start=source.indexOf('async function createSociety('),end=source.indexOf('async function deleteSociety(',start);
 const current={id:1,name:'Test',bank_details:{bank_name:'Example',account_number:'00123',customer_number:'00456'}};
 const context={normalizeSocietyBankDetails,ensureSocietyTables:async()=>{},normalizeText:v=>v,normalizeOptionalText:v=>v||'',normalizeOptionalMonthKey:v=>v||'',normalizeSocietyFloorPlotsConfig:()=>null,normalizeSocietyPdfShopsMode:v=>v||'individual',getSocietyOwnedByUser:async(userId)=>userId===1?current:null,validationError:message=>new Error(message),query:async(sql,values)=>{context.saved={sql,values};return {rows:[{}]};}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 await context.createSociety(1,{name:'Test',bank_details:current.bank_details});assert.deepEqual(JSON.parse(context.saved.values[12]),normalizeSocietyBankDetails(current.bank_details));
 await context.updateSociety(1,1,{name:'Renamed'});assert.deepEqual(JSON.parse(context.saved.values[13]),current.bank_details);
 await assert.rejects(()=>context.updateSociety(2,1,{name:'Other owner'}),/Society not found/);
});
test('society API round-trips bank details with a QR upload, removal, and failed-save cleanup',async(t)=>{
 const express=require('express'),multer=require('multer'),crypto=require('crypto');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'society-bank-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=fs.readFileSync(path.join(__dirname,'../routes/api.js'),'utf8');
 const start=source.indexOf('function societySettingsBody('),end=source.indexOf("router.delete('/societies/:id'",start);
 let stored;
 const db={
  createSociety:async(userId,body)=>{if(body.name==='Fail')throw Error('Save failed');stored={id:1,...body,bank_details:normalizeSocietyBankDetails(body.bank_details)};return stored;},
  updateSociety:async(userId,id,body)=>{stored={...stored,...body,bank_details:normalizeSocietyBankDetails(body.bank_details,stored.bank_details)};return stored;},
  getSocietyDetail:async()=>({society:stored}),
 };
 const router=express.Router();vm.runInNewContext(source.slice(start,end),{router,fs,path,crypto,pgCoreDb:db,normalizeSocietyBankDetails,societyQrImageExtension,ensureSocietyUploadDir:()=>dir,withSocietyExpenseUpload:multer({storage:multer.memoryStorage()}).single('attachment')});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.session={userId:1};next();});app.use(router);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>server.close());const base='http://127.0.0.1:'+server.address().port;
 const payload={name:'Example',bank_details:{bank_name:'Test',account_number:'00123',customer_number:'00456',established_date:'2020-01-01'}};
 const form=()=>{const fd=new FormData();fd.append('payload',JSON.stringify(payload));fd.append('attachment',new Blob([png],{type:'image/png'}),'qr.png');return fd;};
 const response=await fetch(base+'/societies',{method:'POST',body:form()});assert.equal(response.status,200);const saved=(await response.json()).society;
 assert.equal(saved.bank_details.account_number,'00123');assert.match(saved.bank_details.qr_image_path,/^\/uploads\/societies\/qr-.*\.png$/);assert.equal(fs.readdirSync(dir).length,1);
 const loaded=await (await fetch(base+'/societies/1')).json();assert.deepEqual(loaded.society.bank_details,saved.bank_details);
 await fetch(base+'/societies/1',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Renamed'})});assert.equal(stored.bank_details.account_number,'00123');
 await fetch(base+'/societies/1',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({bank_details:{...saved.bank_details,qr_image_path:''}})});assert.equal(stored.bank_details.qr_image_path,'');
 payload.name='Fail';const failure=await fetch(base+'/societies',{method:'POST',body:form()});assert.equal(failure.status,500);assert.equal(fs.readdirSync(dir).length,1,'Failed save must remove its new upload');
});
