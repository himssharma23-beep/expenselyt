const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'society-bank-ui-'));
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1100,height:1000});await page.setContent('<div id="form"></div>');await page.addStyleTag({path:path.join(__dirname,'../public/css/app.css')});
  await page.addScriptTag({content:`
    const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const _societiesList=[{id:1,name:'Example Society',bank_details:{bank_name:'Example Bank',account_number:'0001234',customer_number:'0005678',established_date:'2020-01-02',qr_image_path:'/uploads/societies/qr-example.png'}}];
    let _selectedSocietyId=1,lastBody,lastFile,closed=false;
    const societyMapConfiguredFloorPlots=()=>[],getSocietyMapPreset=()=>null,bindModalSubmit=()=>{},loadSocieties=async()=>{},toast=()=>{},fmtDate=v=>v;
    const openModal=(title,html)=>{document.getElementById('form').innerHTML=html;},closeModal=()=>{closed=true;};
    const api=async(url,opts)=>{lastBody=opts.body;return {success:true,society:{id:1}};};
    window.fetch=async(url,opts)=>{lastBody=JSON.parse(opts.body.get('payload'));lastFile=opts.body.get('attachment').name;return {json:async()=>({success:true,society:{id:1}})};};
  `});
  const source=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
  await page.addScriptTag({content:source.slice(source.indexOf('function societyBankDetailsHtml('),source.indexOf('async function deleteSociety(',source.indexOf('function societyBankDetailsHtml(')))});
  await page.evaluate(()=>showSocietyModal(1));
  assert.equal(await page.$eval('#societyAccountNumber',n=>n.value),'0001234');assert.equal(await page.$eval('#societyEstablishedDate',n=>n.value),'2020-01-02');
  await page.evaluate(()=>saveSociety(1));assert.equal(await page.evaluate(()=>lastBody.bank_details.customer_number),'0005678');
  const image=path.join(dir,'qr.png');fs.writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=','base64'));
  await (await page.$('#societyQrFile')).uploadFile(image);await page.waitForFunction(()=>document.getElementById('societyQrPreview').src.startsWith('data:image/png'));
  await page.evaluate(()=>saveSociety(1));assert.equal(await page.evaluate(()=>lastFile),'qr.png');assert.equal(await page.evaluate(()=>lastBody.bank_details.account_number),'0001234');
  await page.evaluate(()=>{clearSocietyQr();return saveSociety(1);});assert.equal(await page.evaluate(()=>lastBody.bank_details.qr_image_path),'');assert.equal(await page.$eval('#societyQrFile',n=>n.files.length),0);
  await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=390),true);
  assert.deepEqual(errors,[]);console.log('Society bank editor browser checks passed: reload, save, QR preview/upload/removal, leading zeros, narrow viewport.');
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
