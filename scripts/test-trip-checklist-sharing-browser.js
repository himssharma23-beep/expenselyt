const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 600, height: 900 });
    await page.setContent('<main id="sharing" style="padding:20px"></main>');
    await page.addStyleTag({ path: path.join(__dirname, '../public/css/app.css') });
    await page.addScriptTag({ path: path.join(__dirname, '../public/js/trip-checklist-identity.js') });
    await page.addScriptTag({ content: `
      const escHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      let _tripDetail = {id:1,members:['Himanshu','Harpreet','Deepak','Gaurav'].map(member_name => ({member_name}))};
      let _trips = [_tripDetail], saved = null, warning = '';
      const api = async (path, options) => {saved = options.body; return {success:true};};
      const toast = message => {warning = message;};
      const openTripDetail = async () => {};
      const showTripShareModal = async () => {};
    ` });
    const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
    await page.addScriptTag({ content: source.slice(source.indexOf('function tripChecklistShareControls('), source.indexOf('let _tripShareUserSearchTimer')) });
    await page.addScriptTag({ content: source.slice(source.indexOf('async function tripShareWithUser('), source.indexOf('async function tripUnshareUser(')) });
    await page.evaluate(() => {
      document.getElementById('sharing').innerHTML = tripDirectSharedUsersHtml([{id:77, linked_user_id:20,display_name:'Deepak Kataria',username:'deepak',permission:'view',checklist_can_check:true,checklist_member_key:'g:deepak'}],1);
    });
    assert.equal(await page.$eval('#tripChecklistAllow_20', n => n.checked), true);
    assert.equal(await page.$eval('#tripChecklistMember_20', n => n.value), 'g:deepak');
    await page.click('#tripChecklistAllow_20');
    await page.click('button');
    await page.waitForFunction(() => saved !== null);
    assert.deepEqual(await page.evaluate(() => saved), { linked_user_id:20, permission:'view', checklist_can_check:false, checklist_member_key:'g:deepak' });
    await page.evaluate(() => {
      saved = null;
      document.getElementById('sharing').innerHTML = tripChecklistShareControls({id:30,display_name:'Navjot Singh'},1);
    });
    assert.equal(await page.$eval('#tripChecklistMember_30', n => n.value), '');
    await page.click('#tripChecklistAllow_30');
    await page.evaluate(() => tripShareWithUser(1,30));
    assert.equal(await page.evaluate(() => saved), null);
    assert.match(await page.evaluate(() => warning), /Choose their trip member/);
    console.log('Sharing browser checks passed: matched member, separate permission, existing share revocation, and nonmember validation.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
