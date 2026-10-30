const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1100, height: 900 });
    await page.setContent('<main id="tripPackingPanel" style="max-width:1000px;margin:24px auto"></main>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../public/css/app.css'), 'utf8') });
    await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../public/css/trip-checklist.css'), 'utf8') });
    await page.addScriptTag({ content: `
      const escHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const toast = () => {};
      const confirmDialog = async () => true;
      const c = {
        items: [{id:'1',title:'Passport'},{id:'2',title:'Charger'}], can_edit:true, can_remind:true,
        participants: [
          {key:'u:10',name:'Priya',can_check:true,checked_items:[],complete:0,remaining:2,percent:0},
          {key:'u:20',name:'Amit',can_check:false,checked_items:['1'],complete:1,remaining:1,percent:50}
        ],
        reminder:{enabled:true,days_before:3,frequency:'daily',time:'09:00',timezone:'Asia/Kolkata'}
      };
      let _tripDetail = {id:1,checklist:c};
      let savedReminder = null;
      const api = async (url, opts = {}) => {
        if (!opts.method) return c;
        if (url.endsWith('/check')) {
          const p = c.participants.find(p => p.key === opts.body.participant_key);
          p.checked_items = opts.body.checked ? ['1'] : [];
          p.complete = p.checked_items.length; p.remaining = c.items.length - p.complete; p.percent = p.complete / c.items.length * 100;
        } else if (url.endsWith('/reminder')) { savedReminder = opts.body; c.reminder = opts.body; }
        return {success:true};
      };
    ` });
    await page.addScriptTag({ path: path.join(__dirname, '../public/js/trip-checklist.js') });
    await page.evaluate(() => { document.getElementById('tripPackingPanel').innerHTML = renderTripPacking(_tripDetail); });
    assert.equal(await page.$$eval('tbody input[type=checkbox]', nodes => nodes.length), 4);
    assert.equal(await page.$eval('input[aria-label="Amit: Passport"]', n => n.disabled), true);
    await page.click('input[aria-label="Priya: Passport"]');
    await page.waitForFunction(() => document.querySelectorAll('[role=img][aria-label="50% complete, 50% left"]').length === 2);
    assert.equal(await page.$eval('details', n => n.open), false);
    await page.click('details summary');
    await page.select('#packingReminderFrequency', 'weekly');
    await page.$eval('#packingReminderDays', n => { n.value = '7'; });
    await page.click('details form button[type=submit]');
    await page.waitForFunction(() => savedReminder?.frequency === 'weekly');
    assert.equal(await page.evaluate(() => savedReminder.days_before), 7);
    assert.equal(await page.$eval('details', n => n.open), true);
    assert.match(await page.evaluate(() => renderTripPackingIndicator(tripPackingSummary(c))), /Packing 50%/);
    await page.click('details summary');
    await page.screenshot({ path: path.join(os.tmpdir(), 'trip-checklist-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'Page should fit a narrow viewport');
    await page.screenshot({ path: path.join(os.tmpdir(), 'trip-checklist-narrow.png'), fullPage: true });
    await page.setViewport({ width: 1100, height: 900 });
    await page.evaluate(() => {
      c.participants = ['Himanshu', 'Harpreet', 'Deepak', 'Gaurav'].map((name, i) => ({
        key: `g:${name.toLowerCase()}`, name, can_check: true, checked_items: i === 1 ? ['1', '2'] : ['1'],
        complete: i === 1 ? 2 : 1, remaining: i === 1 ? 0 : 1, percent: i === 1 ? 100 : 50,
      }));
      document.getElementById('tripPackingPanel').innerHTML = `<div class="card" style="padding:20px;margin-bottom:20px"><strong>All Trips</strong><table style="width:100%;margin-top:15px"><tr><th>Destination</th><th>Status</th></tr><tr><td><strong>Thailand 2026</strong><div style="margin-top:6px">${renderTripPackingIndicator(tripPackingSummary(c))}</div></td><td>Upcoming</td></tr></table></div>` + renderTripPacking(_tripDetail);
    });
    assert.equal(await page.$$('.packing-member').then(n => n.length), 4);
    assert.equal(await page.$$('.packing-table tbody input[type=checkbox]').then(n => n.length), 8);
    assert.match(await page.$eval('.packing-indicator', n => n.textContent), /Packing 63%/);
    await page.screenshot({ path: path.join(os.tmpdir(), 'trip-checklist-four-members.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('Checklist browser checks passed: independent columns, permissions, progress, reminder save and narrow layout.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
