const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<main id="main"></main><div id="modal"></div>');
  await page.addScriptTag({path:path.join(__dirname,'../public/js/utils.js')});
  await page.addScriptTag({path:path.join(__dirname,'../public/js/live-split-currency.js')});
  await page.addScriptTag({content:`
    window._currentUser={id:2,display_name:'Harpreet',username:'harpreet',currency_code:'CAD'};setCurrencyPrefs(window._currentUser);
    let own=[],sent=[];
    const shared=[{id:1,owner_user_id:1,owner_name:'Himanshu',currency_code:'INR',paid_by:'You',total_amount:610503.06,friend_share_amount:305251.53,friend_id:11,friend_name:'Harpreet',friend_linked_user_id:2,target_user_id:2,divide_date:'2026-11-02',details:'Shared expense',split_mode:'equal',splits:[{friend_id:11,friend_name:'Harpreet',linked_user_id:2,share_amount:305251.53}]}];
    api=async(url,opts)=>{
      if(opts?.method==='POST'){sent.push({url,...opts.body});return {success:true};}
      if(url==='/api/live-split/friends')return {friends:[{id:21,name:'Himanshu',linked_user_id:1,linked_user_display_name:'Himanshu'}]};
      if(url==='/api/live-split/groups')return {groups:own};
      if(url.startsWith('/api/live-split/groups/shared'))return {groups:shared};
      if(url==='/api/banks')return {accounts:[]};if(url==='/api/cc/cards')return {cards:[]};
      return {trips:[],invites:[]};
    };
    openModal=(title,html)=>{document.getElementById('modal').innerHTML=html;};closeModal=()=>{document.getElementById('modal').innerHTML='';};toast=()=>{};
  `});
  const source=fs.readFileSync(path.join(__dirname,'../public/js/live-split.js'),'utf8');const end=source.indexOf('  bindAvatarPreviewClicks();',source.indexOf('  window.loadLiveSplit'));
  await page.addScriptTag({content:source.slice(0,end)+'})();'});
  await page.evaluate(()=>loadLiveSplit());
  assert.equal(await page.$eval('[aria-label="Live Split currency"]',e=>e.value),'INR');
  assert.match(await page.$eval('.friend-bal',e=>e.textContent),/₹3,05,251.53/);
  assert.doesNotMatch(await page.$eval('.friend-bal',e=>e.textContent),/\$/);
  await page.evaluate(()=>{own=[{id:2,currency_code:'CAD',paid_by:'You',total_amount:50,divide_date:'2026-11-02',details:'CAD expense',splits:[{friend_id:21,friend_name:'Himanshu',linked_user_id:1,share_amount:25}]}];return liveSplitSetCurrency('CAD');});
  assert.match(await page.$eval('.friend-bal',e=>e.textContent),/\$25.00/);
  await page.evaluate(()=>liveSplitSetCurrency('INR'));
  assert.match(await page.$eval('.friend-bal',e=>e.textContent),/₹3,05,251.53/);
  await page.evaluate(()=>liveSplitOpenSettle(21));
  assert.match(await page.$eval('#modal',e=>e.textContent),/₹3,05,251.53/);
  await page.evaluate(()=>{liveSplitSettleField('amount','100');return liveSplitSaveSettle();});
  const settlement=await page.evaluate(()=>sent.find(item=>item.url==='/api/live-split/groups'));
  assert.equal(settlement.currency_code,'INR');assert.equal(settlement.total_amount,100);assert.equal(settlement.split_mode,'settlement');
  assert.deepEqual(errors,[]);console.log('Live Split browser checks passed: CAD viewer, INR native balance, independent CAD/INR scopes, unchanged amounts.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
