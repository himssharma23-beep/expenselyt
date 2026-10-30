const assert = require('node:assert/strict');
const path = require('path');
const puppeteer = require('puppeteer');
async function main() {
  const browser = await puppeteer.launch({headless:true,executablePath:process.env.CAPTURE_TEST_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e => errors.push(e.message));
    await page.setViewport({width:1280,height:900});
    await page.setContent('<!doctype html><style>body{font:16px Arial;margin:24px;color:#163a2a;background:#f4f7f5}.card{background:white;padding:20px;border-radius:12px}.btn{padding:10px;margin:4px;cursor:pointer}.fi{display:block;width:95%;padding:9px;margin:8px 0}label{display:block}#modal{background:white;padding:20px}</style><main id="main"></main><div id="modal"></div>');
    await page.addScriptTag({content:`
      function escHtml(value){return String(value || '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
      function toast(value){window.lastToast=value;}
      function openModal(title,body){document.getElementById('modal').innerHTML='<h2>'+escHtml(title)+'</h2>'+body;}
      function closeModal(){document.getElementById('modal').innerHTML='';}
      async function api(){return {banks:[],cards:[]};}
    `});
    await page.addScriptTag({path:path.join(__dirname,'../public/js/transaction-capture.js')});
    await page.evaluate(() => {
      window.testRequests=[];
      const state={permissions:{manual:true,ai_read:true,receipt_image:true,email_gmail:true},preferences:{manual:true,ai_read:false,receipt_image:true,email_gmail:false},methods:{manual:'Typed text',ai_read:'AI extraction',receipt_image:'Receipt OCR',email_gmail:'Gmail'},configured:{email_gmail:false,ai_read:true},mailboxes:[]};
      captureRequest=async (url,options={}) => {
        window.testRequests.push({url,...options});
        if(url==='/methods')return state;
        if(url==='/items' && !options.method)return {items:[{id:'42',status:'pending',item_name:'<img src=x onerror="window.xss=true">',amount:350,purchase_date:'2026-10-27',transaction_direction:'debit',currency:'INR',source:'manual',parsed_text:'Paid INR 350',possible_duplicate_id:'41'}]};
        if(url.startsWith('/admin/users/')) return state;
        if(url==='/preferences'){Object.assign(state.preferences,options.body.preferences);return state;}
        return {success:true};
      };
    });
    await page.evaluate(() => loadTransactionCapture());
    assert.match(await page.$eval('#main',el => el.textContent),/Possible duplicate/);
    assert.equal(await page.$('#main img'),null,'Imported merchant names must be escaped');
    await page.click('input[onchange*="ai_read"]');
    await page.waitForFunction(() => window.testRequests.some(r => r.url==='/preferences'));
    await page.evaluate(() => showCapturePermissions(7));
    await page.waitForSelector('[data-capture-permission="ai_read"]');
    await page.click('[data-capture-permission="ai_read"]');
    await page.evaluate(() => saveCapturePermissions());
    const saved=await page.evaluate(() => window.testRequests.find(r => r.url==='/admin/users/7' && r.method==='PUT'));
    assert.equal(saved.body.permissions.ai_read,false);
    await page.evaluate(() => captureReview(42));
    await page.waitForSelector('#captureConfirmed');
    await page.evaluate(() => captureConfirm(42));
    assert.match(await page.evaluate(() => window.lastToast),/Confirm this expense/);
    await page.evaluate(async () => {
      document.body.insertAdjacentHTML('beforeend','<button data-tab="smartcapture" style="display:none">Capture</button>');
      const main = document.getElementById('main').innerHTML;
      window.fetch = async () => ({ok:false,status:500});
      await refreshCaptureAvailability();
      if(document.getElementById('main').innerHTML !== main) throw new Error('Capture failure changed the existing page.');
      if(document.querySelector('[data-tab="smartcapture"]').style.display !== 'none') throw new Error('Disabled capture navigation became visible.');
    });
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('Capture UI passed: rendering, escaped input, user toggle, per-user admin save and review confirmation.');
  } finally { await browser.close(); }
}
main().catch(e => {console.error(e);process.exitCode=1;});
