const assert=require('node:assert/strict');
const puppeteer=require('puppeteer');
(async()=>{
  const browser=await puppeteer.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width:390,height:844});
    await page.setContent('<div id="modalOverlay"><div id="modalContent"></div></div>');
    await page.addStyleTag({path:'public/css/app.css'});
    for(const file of ['utils','live-split-currency','emi-friend-split-model','emi-friend-split-ui'])await page.addScriptTag({path:`public/js/${file}.js`});
    await page.evaluate(()=>{
      window._currentUser={id:1};window.posts=[];window.toasts=[];
      toast=message=>toasts.push(message);
      api=async(url,options)=>{
        if(options?.method==='POST'){posts.push(options.body);return {success:true,group_id:42,my_share:33.34,expense_added:true};}
        if(url.includes('/friends'))return {friends:[{id:9,name:'Harpreet'},{id:2,name:'Deepak'},{id:1,name:'Myself',linked_user_id:1}]};
        return {success:true,quote:{emi_id:7,name:'Hotel <Boss>',currency_code:'INR',installment_count:3,total:100,lines:[{label:'All installments',amount:100}],group_id:window.existingSplit?42:null,my_share:window.existingSplit?33.34:0,expense_added:false}};
      };
    });
    await page.evaluate(()=>openEmiFriendSplit(7));
    assert.equal(await page.$eval('#emiFriendSplitSave',el=>el.disabled),true);
    assert.equal(await page.$$eval('.fc input',els=>els.length),3);
    assert.equal(await page.$eval('#modalContent b',el=>el.textContent),'Hotel <Boss>');
    await page.click('input[onchange*="Selection(9"]');
    await page.click('input[onchange*="Selection(2"]');
    for(const mode of ['percent','parts','amount','equal']){
      await page.click(`button[onclick="emiFriendSplitMode('${mode}')"]`);
      assert.equal(await page.$eval('#emiFriendSplitSave',el=>el.disabled),false,mode);
    }
    await page.evaluate(()=>{emiFriendSplitMode('percent');emiFriendSplitValue('self','90');});
    assert.equal(await page.$eval('#emiFriendSplitSave',el=>el.disabled),true);
    await page.evaluate(()=>{emiFriendSplitMode('amount');emiFriendSplitValue('self','0');});
    assert.equal(await page.$eval('#emiFriendSplitSave',el=>el.disabled),true);
    await page.evaluate(()=>emiFriendSplitMode('parts'));
    await page.click('#emiFriendSplitSave');
    await page.waitForFunction(()=>document.getElementById('modalContent').textContent.includes('already been split'));
    const posts=await page.evaluate(()=>posts);
    assert.equal(posts.length,1);assert.deepEqual(posts[0].friend_ids,[9,2]);assert.equal(posts[0].expected_total,100);assert.equal(posts[0].mode,'parts');
    assert.ok(await page.$eval('#modalContent',el=>el.textContent.includes('added to Expenses.')));
    await page.evaluate(()=>{window.existingSplit=true;return openEmiFriendSplit(7);});
    assert.ok(await page.$('#emiAddOwnShare'));
    await page.click('#emiAddOwnShare');
    await page.waitForFunction(()=>document.getElementById('modalContent').textContent.includes('added to Expenses.'));
    assert.equal(await page.$('#emiAddOwnShare'),null);
    assert.equal(await page.evaluate(()=>posts.length),2,'recovery adds own expense without another split');
    assert.equal(await page.$eval('#modalContent',el=>el.scrollWidth<=el.clientWidth+1),true,'mobile web modal overflow');
    assert.deepEqual(errors,[]);
    console.log('EMI friend split browser passed: selection, all modes, invalid shares, save, duplicate UI, 390px layout.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
