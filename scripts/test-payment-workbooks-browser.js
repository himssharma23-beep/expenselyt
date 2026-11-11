const assert=require('node:assert/strict');
const puppeteer=require('puppeteer');
const M=require('../public/js/payment-manager-workbook-model');
const clone=v=>JSON.parse(JSON.stringify(v));
(async()=>{
  const browser=await puppeteer.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const names=['Himanshu','Saurav','Deepak','Gurwinder','Deevansh','Sandeep','Sanjay','Hardeep','Vashisht','Rohit','Vikas','Sourav'];
    const doc=M.fresh('2026-11-10');doc.title='Friends evening';doc.people=names.map((name,i)=>({key:i?'guest:'+i:'self',name,post_to_live_split:i<3}));
    doc.expenses=[{key:'b1',title:'Bottle',amount:2880,paid_by:'self',participants:doc.people.slice(0,10).map(p=>p.key),mode:'equal',values:{},payment_source:'none'},
      {key:'b2',title:'Bottle 2',amount:1250,paid_by:'guest:2',participants:doc.people.slice(0,10).map(p=>p.key),mode:'equal',values:{},payment_source:'none'},
      {key:'c',title:'Chakna',amount:3100,paid_by:'guest:1',participants:doc.people.map(p=>p.key),mode:'equal',values:{},payment_source:'none'}];
    const records=[{id:1,revision:1,document:doc,posted:false,synced:false}],requests=[];
    const response=w=>({...clone(w),plan:M.calculate(w.document)});
    const installMock=(initial)=>{window.records=initial;window.requests=[];const M=paymentManagerWorkbookModel;const clone=v=>JSON.parse(JSON.stringify(v));const response=w=>({...clone(w),plan:M.calculate(w.document)});window.workbookApi=async(url,options)=>{
      requests.push({url,options});
      if(url==='/api/live-split/friends')return {friends:[]};
      if(url==='/api/banks')return {accounts:[{id:7,bank_name:'Bank'}]};
      if(url==='/api/cc/cards')return {cards:[{id:8,card_name:'Card'}]};
      if(url==='/api/live-split/payment-workbooks'&&!options)return {success:true,workbooks:records.map(response)};
      const id=Number(url.match(/workbooks\/(\d+)/)?.[1]);
      if(options?.method==='PATCH'){
        const w=records.find(w=>w.id===id);if(options.body.revision!==w.revision)throw Error('Revision mismatch');
        if(options.body.reset)w.document.checklist={};else w.document.checklist[options.body.key]=options.body.paid;w.revision++;
        return {success:true,workbook:response(w)};
      }
      if(options){let w=id?records.find(w=>w.id===id):{id:records.length+1,revision:0};if(!id)records.push(w);w.document=clone(options.body.document);w.revision++;w.posted=options.body.publish||w.posted;w.synced=!!options.body.publish;return {success:true,workbook:response(w)};}
      return {success:true,workbook:response(records.find(w=>w.id===id))};
    };};
    await page.setContent('<div id="modalOverlay"><div id="modalContent"></div></div>');
    for(const file of ['app','payment-manager-workbooks'])await page.addStyleTag({path:'public/css/'+file+'.css'});
    for(const file of ['utils','live-split-currency','payment-manager-workbook-model','payment-manager-workbooks'])await page.addScriptTag({path:'public/js/'+file+'.js'});
    await page.evaluate(installMock,records);
    await page.evaluate(()=>{window._currentUser={id:1,currency_code:'INR'};window.api=window.workbookApi;window.toast=()=>{};window.confirmDialog=async()=>true;});
    await page.evaluate(()=>openPaymentWorkbooks());await page.evaluate(()=>pwOpen(1));
    await page.evaluate(()=>pwTab('details'));
    await page.evaluate(()=>{document.getElementById('pwGuestName').value='New guest <unsafe>';pwGuest();pwExpenseAdd();});
    assert.equal(await page.$$eval('.pw-members>div',els=>els.length),13);
    assert.ok(await page.$eval('.pw-members',el=>el.textContent.includes('New guest <unsafe>')));
    await page.evaluate(()=>{const sections=[...document.querySelectorAll('.pw-panel')];const added=sections.at(-1);added.querySelector('button').click();document.querySelector('.pw-members>div:last-child button').click();});
    await page.evaluate(()=>{pwExpense('b1','payment_source','bank',true);pwExpense('b1','payment_account_id','7');pwTab('review');});
    await page.evaluate(()=>{for(const key of ['self',...Array.from({length:9},(_,i)=>'guest:'+(i+1))])pwSelect('rounding',key,true);pwRoundStep('10');pwRound();});
    assert.equal(await page.$eval('button[onclick="pwSave(true)"]',b=>b.disabled),true);
    await page.evaluate(()=>{pwSelect('remainder','guest:10',true);pwSelect('remainder','guest:11',true);pwDistribute();pwFinance(true);});
    assert.equal(await page.$eval('button[onclick="pwSave(true)"]',b=>b.disabled),false);
    assert.ok(await page.$eval('#pwVerification',el=>el.textContent.includes('Verified')));
    for(const width of [320,390,1280]){
      await page.setViewport({width,height:900});
      assert.ok(await page.$eval('.pw-shell',el=>el.scrollWidth<=el.clientWidth+1),'shell overflow '+width);
      assert.ok(await page.$eval('.pw-body',el=>el.scrollWidth<=el.clientWidth+1),'body overflow '+width);
      await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,250)));
      const layout=await page.evaluate(()=>{const modal=document.getElementById('modalContent').getBoundingClientRect(),footer=document.querySelector('.pw-footer').getBoundingClientRect(),body=document.querySelector('#modalContent .modal-body');return {inside:modal.top>=0&&modal.bottom<=innerHeight+1,footer:footer.bottom<=innerHeight+1,scrollable:body.scrollHeight>body.clientHeight&&body.clientHeight>0};});
      assert.ok(layout.inside&&layout.footer&&layout.scrollable,'modal must scroll and retain visible save controls '+width+' '+JSON.stringify(layout));
    }
    await page.evaluate(()=>pwSave(true));
    let browserRecords=await page.evaluate(()=>records);
    assert.equal(browserRecords[0].document.overrides['guest:10'],'265.00');assert.equal(browserRecords[0].document.finance.add_expense,true);assert.equal(browserRecords[0].document.expenses[0].payment_source,'bank');
    await page.evaluate(async()=>{for(const key of ['self',...Array.from({length:11},(_,i)=>'guest:'+(i+1))].filter(k=>k!=='guest:6'))await pwChecklist(key,true);});
    browserRecords=await page.evaluate(()=>records);
    assert.equal(M.calculate(browserRecords[0].document).collected,6560);assert.equal(M.calculate(browserRecords[0].document).pending,670);
    await page.evaluate(async()=>{await pwList();await pwOpen(1);});
    assert.equal(await page.$$eval('.pw-payment input:checked',els=>els.length),11);
    for(const width of [390,1280]){await page.setViewport({width,height:900});await page.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'payment-workbook-'+width+'.png')});}
    await page.evaluate(()=>pwChecklist('',false,true));assert.equal(await page.$$eval('.pw-payment input:checked',els=>els.length),0);
    await page.evaluate(()=>pwTab('details'));await page.evaluate(()=>pwField('title','Changed title'));await page.evaluate(()=>pwTab('payments'));
    assert.equal(await page.$$eval('.pw-payment input:not(:disabled)',els=>els.length),0,'unsaved changes must not alter persisted checklist');
    assert.deepEqual(errors,[]);
    console.log('Browser saved payment manager passed: guests, per-expense accounts, rounding verification, save/reopen, collection checklist/reset and 320px layout.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
