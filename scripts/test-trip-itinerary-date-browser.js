const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main id="modal"></main>');
    await page.addScriptTag({ content: `
      let _selectedTripId = 1, _tripDetail = {id:1,isOwner:true,start_date:'2026-07-30',itinerary_items:Array.from({length:6},(_,i)=>({id:i+1,itinerary_date:'2026-07-31',title:'Activity '+i}))};
      const escHtml = x => String(x || '');
      const normalizeInputDate = x => String(x).slice(0,10);
      const todayStr = () => '2026-10-29';
      const fmtDate = x => x;
      const getTripItineraryItemById = id => _tripDetail.itinerary_items.find(i=>i.id===id);
      const openModal = (title, html) => {document.getElementById('modal').innerHTML=html;};
      const closeModal = () => {document.getElementById('modal').innerHTML='';};
      let requests=[], message='';
      const toast = text => {message=text;};
      const openTripDetail = async () => {};
      const api = async (path, options) => {requests.push({path,...options});return {success:true,count:6};};
    ` });
    const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
    await page.addScriptTag({ content: source.slice(source.indexOf('async function showTripItineraryModal('), source.indexOf('async function saveTripItinerary(')) });
    await page.evaluate(() => showTripItineraryModal(null,1,'2026-07-31'));
    assert.equal(await page.$eval('#tripItineraryDate', n=>n.value), '2026-07-31');
    await page.evaluate(() => showTripItineraryModal(1,1,'2026-08-02'));
    assert.equal(await page.$eval('#tripItineraryDate', n=>n.value), '2026-07-31');
    await page.evaluate(() => showTripItineraryMoveDate('2026-07-31'));
    assert.match(await page.$eval('#tripItineraryMoveSave',n=>n.textContent), /Move 6 entries/);
    await page.click('#tripItineraryMoveSave');
    assert.equal(await page.evaluate(()=>requests.length),0);
    await page.$eval('#tripItineraryMoveTo', n=>{n.value='2026-08-01';});
    await page.click('#tripItineraryMoveSave');
    await page.waitForFunction(()=>requests.length===1 && document.getElementById('modal').innerHTML==='');
    assert.deepEqual(await page.evaluate(()=>requests[0]), {path:'/api/trips/1/itinerary/move-date',method:'PUT',body:{from_date:'2026-07-31',to_date:'2026-08-01'}});
    console.log('Itinerary browser checks passed: preselected date, edit date preserved, six-entry bulk move and same-date validation.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
