const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1200,height:1000});await page.setContent('<main id="main" class="main"></main>');
  for(const f of ['app.css','trip-checklist.css','own-trip-detail.css'])await page.addStyleTag({path:path.join(__dirname,'../public/css',f)});
  await page.addScriptTag({content:`
    const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fmtCur=v=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(v),fmtDate=v=>String(v||'').slice(0,10),canEditTripExpensesByStatus=s=>!['completed','cancelled'].includes(s);
    let _tripDetail={id:1,name:'Singapore 2026',start_date:'2026-11-20',end_date:'2026-11-24',status:'upcoming',category:'Office',transport_mode:'Flight',isOwner:true,members:[{id:1,member_name:'Himanshu'},{id:2,member_name:'Deepak'}],shared_users:[{display_name:'Harpreet Singh'}],expenses:[{id:1,details:'Flight',amount:100,original_currency_code:'GBP',original_amount:1,unit_price:1,quantity:1,expense_date:'2026-10-23',paid_by_name:'Himanshu',splits:[{member_name:'Himanshu',share_amount:50},{member_name:'Deepak',share_amount:50}]},{id:2,details:'Payment',split_mode:'settlement',amount:20,expense_date:'2026-10-24',paid_by_name:'Deepak',splits:[{member_name:'Himanshu',share_amount:20}]}],itinerary_items:[{id:1,title:'Explore Merlion Park',itinerary_date:'2026-11-21',start_time:'15:00'}],checklist:{can_edit:true,can_remind:true,items:[{id:1,title:'Passport'}],participants:[{name:'Himanshu',percent:100,complete:1,remaining:0,checked_items:['1'],can_check:true},{name:'Deepak',percent:0,complete:0,remaining:1,checked_items:[],can_check:true}],reminder:{enabled:false,frequency:'daily',days_before:3,time:'09:00',timezone:'Asia/Kolkata'}}};
    _tripDetail.expense_groups=[{type:'Travel',total:100,items:[_tripDetail.expenses[0]]}];
    const getOrderedTripExpenseGroups=(id,groups)=>groups,getTripExpenseGroupSort=()=>({field:'date',dir:'asc'}),sortTripGroupItems=i=>i,tripGroupSortHeader=(g,s,f,l)=>'<th>'+l+'</th>',fmtTripExpenseDateTime=fmtDate,fmtTripItineraryTimeRange=e=>e.start_time||'';
    const tripExpenseDisplayMoney=e=>({price:'£1.00',share:v=>fmtCur(v)});
    let request=null;const api=async(url,options)=>{request={url,...options};return {success:true};};const openTripDetail=async()=>renderTripDetail();const toast=()=>{};
    function renderTripDetail(){renderOwnTripDetail(_tripDetail)}
  `});
  for(const f of ['trip-detail-model.js','trip-checklist.js','own-trip-detail.js'])await page.addScriptTag({path:path.join(__dirname,'../public/js',f)});
  await page.evaluate(()=>renderTripDetail());
  assert.equal(await page.$eval('.own-trip-detail',e=>Math.round(e.getBoundingClientRect().width)),960);
  assert.equal((await page.$$('.ot-day')).length,5);assert.match(await page.$eval('.ot-day-content',e=>e.textContent),/Nothing planned/);
  await page.click('.ot-day:nth-of-type(2)');assert.match(await page.$eval('.ot-timeline',e=>e.textContent),/Merlion/);
  await page.type('input[name=title]','Night Safari');await page.type('input[name=time]','19:00');await page.click('.ot-quick-add .ot-primary');
  assert.equal(await page.evaluate(()=>request.body.itinerary_date),'2026-11-21');assert.equal(await page.evaluate(()=>request.body.title),'Night Safari');
  await page.screenshot({path:path.join(os.tmpdir(),'own-trip-detail-itinerary.png'),fullPage:true});
  await page.evaluate(()=>selectOwnTripTab('expenses'));assert.match(await page.$eval('tbody',e=>e.textContent),/£1.00/);assert.match(await page.$eval('tbody td:nth-child(6)',e=>e.textContent),/₹100.00/);assert.doesNotMatch(await page.$eval('tbody td:nth-child(6)',e=>e.textContent),/£/);
  await page.evaluate(()=>selectOwnTripTab('payments'));assert.match(await page.$eval('.ot-total-row',e=>e.textContent),/20.00/);
  await page.evaluate(()=>selectOwnTripTab('settlement'));assert.match(await page.$eval('.ot-transfer',e=>e.textContent),/Deepak pays Himanshu.*30.00/);
  await page.evaluate(()=>selectOwnTripTab('packing'));assert.equal((await page.$$('.packing-member')).length,2);await page.screenshot({path:path.join(os.tmpdir(),'own-trip-detail-packing.png'),fullPage:true});
  await page.evaluate(()=>{_tripDetail.checklist.items=Array.from({length:30},(_,i)=>({id:i+1,title:'Packing item '+(i+1)}));selectOwnTripTab('packing');document.querySelector('.packing-reminders').open=true;});
  const sidebarPosition=await page.evaluate(()=>({membersBottom:document.querySelector('.packing-members').getBoundingClientRect().bottom,reminderTop:document.querySelector('.packing-reminders').getBoundingClientRect().top,tableBottom:document.querySelector('.packing-table-wrap').getBoundingClientRect().bottom}));
  assert.ok(sidebarPosition.reminderTop-sidebarPosition.membersBottom<=20,'Reminders stay immediately below members with a long checklist');
  assert.ok(sidebarPosition.reminderTop<sidebarPosition.tableBottom,'Reminders must not fall below the checklist');
  await page.setViewport({width:390,height:844});for(const tab of ['itinerary','packing','expenses','payments','settlement']){await page.evaluate(t=>selectOwnTripTab(t),tab);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true,tab+' must not overflow mobile viewport');}
  await page.evaluate(()=>{_tripDetail={..._tripDetail,isOwner:false,userPermission:'view'};selectOwnTripTab('expenses');});assert.equal((await page.$$('.ot-item-actions')).length,0);assert.equal((await page.$$('.ot-section .ot-primary')).length,0);
  assert.deepEqual(errors,[]);console.log('Trip detail browser checks passed: tabs, days, quick add, currency, balances, packing, permissions, narrow layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
