const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
    await page.setContent('<main id="main"></main><div id="modal"></div>');
    await page.addStyleTag({ path: 'public/css/app.css' });
    await page.addStyleTag({ path: 'public/css/emi-calculator.css' });
    await page.addScriptTag({ path: 'public/js/utils.js' });
    await page.addScriptTag({ path: 'public/js/emi-calculator-ui.js' });
    await page.addScriptTag({ content: `
      setCurrencyPrefs({currency_code:'INR'});window.saved=[];
      api=async(url,options)=>{if(options?.method==='POST'){saved.push(options.body);return {id:7};}return {cards:[{id:1,bank_name:'HDFC',card_name:'Regalia Gold',last4:'1737'},{id:2,bank_name:'ICICI',card_name:'Amazon Pay',last4:'1005'}]};};
      toast=()=>{};showModal=html=>{document.getElementById('modal').innerHTML=html;};closeModal=()=>{document.getElementById('modal').innerHTML='';};
      window._expenseCategories=['Travel'];expenseCategoryDatalistHtml=()=>'<input id="expenseCategoryInput">';
    ` });
    const app = fs.readFileSync('public/js/app.js', 'utf8');
    const start = app.indexOf('async function loadEMI()');
    const end = app.indexOf('async function doActivateEmi(', start);
    assert.ok(start >= 0 && end > start);
    await page.addScriptTag({ content: app.slice(start, end) });
    await page.evaluate(() => loadEMI());
    assert.equal(await page.$eval('#emiSave', el => el.disabled), true);
    await page.evaluate(() => {
      for (const [id,value] of Object.entries({ emiName:'Machine', emiTag:'Personal', emiP:'59000', emiR:'13', emiN:'36', emiCharges:'299' })) {
        const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
      }
      document.getElementById('emiChargesInc').click();
      document.getElementById('emiGST').click();
    });
    const result = await page.evaluate(() => ({ calc:_emiCalcResult, rows:_emiCalcSchedule, totals:emiDisplayTotals() }));
    assert.equal(result.calc.P, 59000);
    assert.equal(result.rows.length, 36);
    assert.equal(result.totals.upfront, 299);
    assert.equal(await page.$$eval('#calcSchedTable tbody tr', rows => rows.length), 36);
    assert.equal(await page.$eval('#emiSave', el => el.disabled), false);
    assert.match(await page.$eval('#emiResultBanner', el => el.textContent), /GST billed separately/);
    assert.ok(await page.$('.emi-donut'));

    // Compare actual web and mobile amortization for the reference example.
    const mobile = fs.readFileSync(path.resolve('../ExpenseManager_mobile/src/screens/EMIScreen.js'), 'utf8');
    const mathStart = mobile.indexOf('function num(');
    const mathEnd = mobile.indexOf('function EMICostRing(', mathStart);
    const context = vm.createContext({});
    vm.runInContext(mobile.slice(mathStart, mathEnd), context);
    const native = context.buildSchedule({ loanAmount:59000,rate:13,tenure:36,charges:299,chargesIncluded:false,gstOnInterest:true });
    assert.equal(native.monthlyEmi, result.calc.emi);
    assert.equal(native.schedule.length, result.rows.length);
    assert.equal(native.totalGst, result.calc.totG);
    assert.equal(context.recomputeSummary(native).grandTotal, result.totals.grand);

    await page.screenshot({ path:path.join(os.tmpdir(),'emi-calculator-desktop.png'), fullPage:true });
    for (const width of [390,320]) {
      await page.setViewport({ width, height:844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `No horizontal page overflow at ${width}px`);
      assert.equal(await page.$eval('.emi-layout',el=>getComputedStyle(el).flexDirection), 'column');
    }
    await page.setViewport({ width:390, height:844 });
    await page.screenshot({ path:path.join(os.tmpdir(),'emi-calculator-mobile.png'), fullPage:true });
    await page.evaluate(() => emiSetCard(1));
    assert.notEqual(await page.$eval('#emiCcChargesRow',el=>getComputedStyle(el).display), 'none');
    await page.evaluate(() => { document.getElementById('emiPlannerAdvance').checked=true; });
    await page.evaluate(() => saveEmiCalc(false));
    const saved = await page.evaluate(() => window.saved[0]);
    assert.equal(saved.principal,59000);
    assert.equal(saved.credit_card_id,1);
    assert.equal(saved.planner_advance_month,1);
    await page.evaluate(() => saveEmiCalc(true));
    assert.match(await page.$eval('#modal',el=>el.textContent),/Activate EMI/);
    assert.ok(await page.$('#emiStartDate'));
    await page.evaluate(() => closeModal());
    await page.evaluate(() => showCalcRowEdit(0));
    await page.evaluate(() => { document.getElementById('calcRowPrinc').value='1000';calcRowLive();applyCalcRowEdit(0); });
    assert.equal(await page.evaluate(()=>_emiCalcSchedule[0]._edited),true);
    assert.match(await page.$eval('#calcSchedTable tbody tr',el=>el.textContent),/edited/);
    await page.evaluate(() => { showCalcBulkEdit(); document.getElementById('calcBulkEmi').value='2100';applyCalcBulkEdit(); });
    assert.equal(await page.evaluate(()=>_emiCalcSchedule.every(row=>row.woGST===2100)),true);
    await page.evaluate(() => emiSliderValue('emiN',3));
    assert.equal(await page.$$eval('#calcSchedTable tbody tr',rows=>rows.length),3);
    await page.evaluate(() => emiSliderValue('emiR',0));
    assert.equal(await page.evaluate(()=>_emiCalcResult.totI),0);
    await page.evaluate(() => emiSliderValue('emiN',1.5));
    assert.equal(await page.$eval('#emiSave',el=>el.disabled),true);
    await page.evaluate(() => loadEMI());
    assert.equal(await page.evaluate(()=>_emiCalcResult),null);
    assert.equal(await page.$eval('#emiName',el=>el.value),'');
    assert.deepEqual(errors,[]);
    console.log('EMI design checks passed: live calculations, web/mobile parity, responsive layout, card options, saving, row/bulk edits, zero interest and reset.');
    console.log('Previews: '+path.join(os.tmpdir(),'emi-calculator-desktop.png')+' and '+path.join(os.tmpdir(),'emi-calculator-mobile.png'));
  } finally { await browser.close(); }
})().catch(error => { console.error(error);process.exit(1); });
