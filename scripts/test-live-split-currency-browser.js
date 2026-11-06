const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<main id="main"></main><div id="modal"></div>');
  await page.addScriptTag({path:path.join(__dirname,'../public/js/utils.js')});
  await page.addScriptTag({path:path.join(__dirname,'../public/js/live-split-currency.js')});
  await page.addScriptTag({content:`
    window._currentUser={id:2,display_name:'Harpreet',username:'harpreet',currency_code:'CAD'};setCurrencyPrefs(window._currentUser);
    let own=[],sent=[],rates=[{currency_code:'INR',rate_to_inr:1},{currency_code:'CAD',rate_to_inr:68}];
    const shared=[{id:1,owner_user_id:1,owner_name:'Himanshu',currency_code:'INR',paid_by:'You',total_amount:610503.06,friend_share_amount:305251.53,friend_id:11,friend_name:'Harpreet',friend_linked_user_id:2,target_user_id:2,divide_date:'2026-11-02',details:'Shared expense',split_mode:'equal',splits:[{friend_id:11,friend_name:'Harpreet',linked_user_id:2,share_amount:305251.53}]}];
    api=async(url,opts)=>{
      if(opts?.method==='POST'){sent.push({url,...opts.body});return {success:true};}
      if(url==='/api/live-split/friends')return {friends:[{id:21,name:'Himanshu',linked_user_id:1,linked_user_display_name:'Himanshu'},{id:22,name:'Deepak',linked_user_id:3,linked_user_display_name:'Deepak'},{id:23,name:'Navjot',linked_user_id:4,linked_user_display_name:'Navjot'}]};
      if(url==='/api/live-split/groups')return {groups:own};
      if(url==='/api/live-split/currency-rates')return {rates};
      if(url.startsWith('/api/live-split/groups/shared'))return {groups:shared};
      if(url==='/api/banks')return {accounts:[]};if(url==='/api/cc/cards')return {cards:[]};
      return {trips:[],invites:[]};
    };
    openModal=(title,html)=>{document.getElementById('modal').innerHTML=html;};closeModal=()=>{document.getElementById('modal').innerHTML='';};toast=()=>{};
  `});
  const source=fs.readFileSync(path.join(__dirname,'../public/js/live-split.js'),'utf8');const end=source.indexOf('  bindAvatarPreviewClicks();',source.indexOf('  window.loadLiveSplit'));
  await page.addScriptTag({content:source.slice(0,end)+'})();'});
  await page.evaluate(()=>loadLiveSplit());
  assert.equal(await page.$('[aria-label="Live Split currency"]'),null);
  assert.match(await page.$eval('section[data-live-split-currency="INR"]',e=>e.textContent),/3,05,251.53/);
  await page.evaluate(()=>{own=[{id:2,currency_code:'CAD',paid_by:'You',total_amount:50,divide_date:'2026-11-02',details:'CAD expense',splits:[{friend_id:22,friend_name:'Deepak',linked_user_id:3,share_amount:25}]}];return loadLiveSplit();});
  assert.equal(await page.$$eval('[data-live-split-balances]',items=>items.length),2);
  assert.equal(await page.evaluate(()=>{
    const trips=document.querySelector('[data-live-split-trips]');
    return [...document.querySelectorAll('[data-live-split-balances]')].every(section=>!!(section.compareDocumentPosition(trips)&Node.DOCUMENT_POSITION_FOLLOWING));
  }),true);
  assert.match(await page.$eval('section[data-live-split-currency="CAD"]',e=>e.textContent),/25.00/);
  assert.match(await page.$eval('section[data-live-split-currency="INR"]',e=>e.textContent),/3,05,251.53/);
  assert.equal(await page.$$eval('.summary-card', items=>items.length),1);
  assert.equal(await page.$eval('[data-live-split-total-currency]',e=>e.dataset.liveSplitTotalCurrency),'CAD');
  const expectedCAD=require('../public/js/live-split-currency').formatLiveSplitMoney(25-305251.53/68,'CAD');
  assert.equal(await page.$eval('.summary-amount',e=>e.textContent),expectedCAD);
  assert.ok((await page.$eval('section[data-live-split-currency="CAD"]',e=>e.textContent)).includes('Deepak'));
  assert.equal(await page.$$eval('.friend-card', items=>items.filter(e=>e.textContent.includes('Navjot')).length),0);
  await page.click('[onclick="liveSplitSetFriendFilter(\'hide_settled\')"]');
  assert.equal(await page.$$eval('.friend-card', items=>items.filter(e=>e.textContent.includes('Navjot')).length),1);
  assert.equal(await page.$eval('.summary-amount',e=>e.textContent),expectedCAD);
  await page.click('[onclick="liveSplitSetFriendFilter(\'hide_settled\')"]');
  assert.equal(await page.$$eval('.friend-card', items=>items.filter(e=>e.textContent.includes('Navjot')).length),0);
  await page.evaluate(()=>{window._currentUser.currency_code='INR';return loadLiveSplit();});
  assert.equal(await page.$eval('[data-live-split-total-currency]',e=>e.dataset.liveSplitTotalCurrency),'INR');
  const expectedINR=require('../public/js/live-split-currency').formatLiveSplitMoney(25*68-305251.53,'INR');
  assert.equal(await page.$eval('.summary-amount',e=>e.textContent),expectedINR);
  assert.match(await page.$eval('section[data-live-split-currency="CAD"]',e=>e.textContent),/25.00/);
  await page.click('section[data-live-split-currency="INR"] [onclick^="liveSplitOpenSettle"]');
  assert.match(await page.$eval('#modal',e=>e.textContent),/3,05,251.53/);
  await page.evaluate(()=>{liveSplitSettleField('amount','100');return liveSplitSaveSettle();});
  const settlement=await page.evaluate(()=>sent.find(item=>item.url==='/api/live-split/groups'));
  assert.equal(settlement.currency_code,'INR');assert.equal(settlement.total_amount,100);assert.equal(settlement.split_mode,'settlement');
  assert.deepEqual(errors,[]);console.log('Live Split browser checks passed: CAD viewer, INR native balance, independent CAD/INR scopes, unchanged amounts.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
