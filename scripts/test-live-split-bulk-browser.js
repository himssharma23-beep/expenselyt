const fs = require('fs');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<main id="main"></main><div id="modal"></div>');
    for (const file of ['utils', 'live-split-currency', 'live-split-bulk-edit']) {
      await page.addScriptTag({ path: `public/js/${file}.js` });
    }
    await page.addScriptTag({ content: `
      window._currentUser={id:1,display_name:'Himanshu',currency_code:'INR'};
      setCurrencyPrefs(_currentUser); window.sent=[];
      api=async(url,opts)=>{if(opts?.method==='PUT')sent.push({url,...opts.body});return {success:true,trips:[],groups:[],friends:[],accounts:[],cards:[]}};
      openModal=(title,body)=>{document.getElementById('modal').innerHTML=body;};closeModal=()=>{};toast=()=>{};
    ` });
    const source = fs.readFileSync('public/js/live-split.js', 'utf8');
    const end = source.indexOf('  bindAvatarPreviewClicks();', source.indexOf('  window.loadLiveSplit'));
    assert.ok(end > 0);
    await page.addScriptTag({ content: source.slice(0, end) + 'window.__bulkState=state;})();' });
    await page.evaluate(() => {
      __bulkState.liveTrips = [{ id: 10, name: 'Test trip', is_owner: true, start_date: '2026-10-31', members: [{ friend_id: 3, member_name: 'Saurav', permission: 'edit' }] }];
      __bulkState.groups = ['You', 'Saurav'].map((paid_by, i) => ({ id: 20 + i, trip_id: 10, paid_by, divide_date: '2026-10-31', details: i ? 'Dinner' : 'Taxi', total_amount: 200, split_mode: 'equal', finance_target: 'none', splits: [{ friend_id: 3, friend_name: 'Saurav', share_amount: 100 }] }));
      liveSplitOpenTripBulkEdit(10);
    });
    assert.equal(await page.$$eval('[onchange^="liveSplitTripBulkEditSelect"]', elements => elements.length), 4);
    await page.click('[onchange="liveSplitTripBulkEditSelect(\'divide_date\', this.checked)"]');
    await page.evaluate(() => {
      const input = document.querySelector('[onchange="liveSplitTripBulkEditField(\'divide_date\', this.value)"]');
      input.value = '2026-11-04'; input.dispatchEvent(new Event('change'));
    });
    assert.equal(await page.evaluate(() => __bulkState.tripBulkEditRows[0].divide_date), '2026-10-31');
    await page.click('[onclick="liveSplitTripBulkEditApplyHeader()"]');
    assert.deepEqual(await page.evaluate(() => __bulkState.tripBulkEditRows.map(row => [row.divide_date, row.paid_by])), [['2026-11-04', 'You'], ['2026-11-04', 'Saurav']]);
    await page.evaluate(() => liveSplitTripBulkEditSave());
    const sent = await page.evaluate(() => window.sent);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].paid_by, 'You');
    assert.equal(sent[1].paid_by, 'Saurav');
    assert.ok(sent.every(row => row.divide_date === '2026-11-04'));
    assert.equal(sent[0].details, 'Taxi');
    assert.equal(sent[1].details, 'Dinner');
    assert.deepEqual(errors, []);
    console.log('Browser passed: checkboxes, draft headers, selective Apply, and saved date-only payloads preserve payers and names.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
