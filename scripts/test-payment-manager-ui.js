const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const puppeteer = require('puppeteer');
const { buildPaymentManagerPlan } = require('../utils/payment-manager-plan');
test('payment manager details, live totals, review and narrow layouts', async () => {
  const browser = await puppeteer.launch({headless:true});
  try {
    const page = await browser.newPage(); const requests=[]; const accountRequests=[];
    await page.setViewport({width:1000,height:1000});
    await page.exposeFunction('testApi',(url,options)=>{
      if(url==='/api/banks'){accountRequests.push(url);return {accounts:[{id:7,bank_name:'Test bank'}]};}
      if(url==='/api/cc/cards'){accountRequests.push(url);return {cards:[{id:8,card_name:'Existing card',last4:'1234'}]};}
      requests.push({url,body:options.body});
      const plan=buildPaymentManagerPlan(options.body.people.map(person=>({...person,name:person.key==='self'?'A':({2:'B',3:'C',4:'D'})[person.key]})),options.body.manager_key,options.body.split_mode);
      plan.finance={source:options.body.payment_source,expense_amount:options.body.add_expense?plan.people[0].share:0,add_expense:options.body.add_expense,payment_amount:options.body.payment_source==='none'?0:plan.people[0].paid,account_id:Number(options.body.payment_account_id)};
      return {success:true,plan};
    });
    await page.setContent('<div id="modalOverlay" class="overlay" style="display:flex"><div id="modalContent"></div></div>');
    await page.addStyleTag({path:path.join(__dirname,'../public/css/app.css')});
    await page.addStyleTag({content:'body{margin:0;background:#193328;font-family:Arial,sans-serif}.overlay{display:flex;justify-content:center;align-items:center;min-height:100vh}.btn{cursor:pointer}'});
    await page.evaluate(()=>{
      window.state={bankAccounts:[],creditCards:[],friends:[{id:2,name:'B'},{id:3,name:'C'},{id:4,name:'D'}]};
      window.todayLocalIso=()=> '2026-10-09';window.escHtml=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');window.fmtCur=value=>'Rs '+Number(value).toFixed(2);
      window.openModal=(title,body)=>{const modal=document.getElementById('modalContent');modal.className='modal '+window.__modalClassName;modal.innerHTML='<div class="modal-head"><h3>'+title+'</h3></div><div class="modal-body">'+body+'</div>';};
      window.closeModal=()=>{document.getElementById('modalContent').innerHTML='';};window.loadLiveSplit=async()=>{};window.toast=()=>{};window.api=window.testApi;
    });
    const source=fs.readFileSync(require.resolve('../public/js/live-split.js'),'utf8');
    await page.addScriptTag({content:source.slice(source.indexOf('  async function ensureFinanceOptionsLoaded('),source.indexOf('  function formatBankAccountLabel('))});
    await page.addScriptTag({content:source.slice(source.indexOf('function paymentManagerValidation('),source.indexOf('  async function openEditExpense(groupId)'))});
    await page.evaluate(()=>liveSplitOpenPaymentManager());
    assert.equal(await page.$eval('#managerSplitSubmit',node=>node.disabled),true);
    assert.equal((await page.$$('.pm-people-table tbody tr')).length,1);
    await page.type('input[placeholder="e.g. Dinner with friends"]','Dinner with friends');
    for(const key of ['2','3','4']) await page.click(`.pm-add-people button[onclick*="Toggle('${key}'"]`);
    assert.equal((await page.$$('.pm-people-table tbody tr')).length,4);
    await page.type('input[aria-label="Amount paid by You"]','1650');
    await page.type('input[aria-label="Amount paid by B"]','1600');
    assert.equal(await page.$eval('#managerPaidTotal',node=>node.textContent),'Rs 3250.00');
    assert.equal(await page.$eval('[data-pm-share="self"]',node=>node.textContent),'Rs 812.50');
    await page.select('select[onchange*="manager_key"]','2');
    await page.click('[data-pm-mode="percent"]');
    for(const [name,value] of [['You','40'],['B','30'],['C','20'],['D','9']]) await page.type(`input[aria-label="Share for ${name}"]`,value);
    assert.equal(await page.$eval('#managerSplitSubmit',node=>node.disabled),true);
    assert.ok((await page.$eval('#managerSplitValidation',node=>node.textContent)).includes('1% remaining'));
    await page.$eval('input[aria-label="Share for D"]',node=>{node.value='10';node.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.$eval('[data-pm-share="self"]',node=>node.textContent),'Rs 1300.00');
    await page.click('[data-pm-mode="fraction"]');
    for(const name of ['You','B','C','D']) await page.$eval(`input[aria-label="Share for ${name}"]`,node=>{node.value='1/4';node.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await page.$eval('#managerSplitSubmit',node=>node.disabled),false);
    assert.equal(await page.$eval('[data-pm-share="self"]',node=>node.textContent),'Rs 812.50');
    await page.click('input[onchange*="add_expense"]');
    assert.deepEqual(accountRequests,['/api/banks','/api/cc/cards']);
    await page.select('select[onchange*="payment_source"]','card');
    assert.ok((await page.$eval('select[onchange*="payment_account_id"]',node=>node.textContent)).includes('Existing card'));
    await page.select('select[onchange*="payment_account_id"]','8');
    await page.select('select[onchange*="payment_source"]','bank');
    await page.select('select[onchange*="payment_account_id"]','7');
    await page.screenshot({path:path.join(os.tmpdir(),'payment-manager-details.png')});
    await page.evaluate(()=>liveSplitManagerSubmit(false));
    assert.equal(requests[0].body.split_mode,'fraction');
    assert.equal(requests[0].body.add_expense,true);
    const transfers=await page.$$eval('.pm-transfer',nodes=>nodes.map(node=>node.textContent));
    assert.ok(transfers.some(text=>text.includes('You owe B') && text.includes('812.50')));
    assert.ok(transfers.some(text=>text.includes('B owes You') && text.includes('1650.00')));
    assert.equal((await page.$$('.pm-review-table tbody tr')).length,4);
    await page.screenshot({path:path.join(os.tmpdir(),'payment-manager-review.png')});
    for(const width of [375,320]) {
      await page.setViewport({width,height:850});
      assert.ok(await page.$eval('.pm-shell',node=>node.scrollWidth<=node.clientWidth+1),'no horizontal overflow');
      assert.ok(await page.$eval('.pm-content',node=>node.scrollWidth<=node.clientWidth+1),'content fits phone width');
    }
    await page.click('[aria-label="Edit split type"]');
    assert.equal(await page.$eval('input[aria-label="Amount paid by You"]',node=>node.value),'1650');
    await page.screenshot({path:path.join(os.tmpdir(),'payment-manager-phone.png')});
    assert.ok(await page.$eval('.pm-content',node=>node.scrollWidth<=node.clientWidth+1));
    assert.ok(await page.$eval('.pm-people-table',node=>node.getBoundingClientRect().width <= node.parentElement.clientWidth+1),'table columns fit rather than being clipped');
    await page.evaluate(()=>liveSplitManagerSubmit(false));
    await page.evaluate(()=>liveSplitManagerSubmit(true));
    assert.equal(requests.length,3);
    assert.equal(requests[2].url,'/api/live-split/payment-manager');
    assert.equal(requests[0].body.request_id,requests[2].body.request_id);
    assert.equal(await page.$eval('#modalContent',node=>node.textContent),'');
    console.log('Screenshots: '+os.tmpdir()+'\\payment-manager-{details,review,phone}.png');
  } finally {await browser.close();}
});
