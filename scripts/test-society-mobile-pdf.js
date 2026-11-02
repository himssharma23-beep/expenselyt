const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const puppeteer=require('puppeteer');
const {buildSocietyPdfHtml}=require('../utils/shared-pdf-html');

function fixture(monthCount=5) {
 const months=Array.from({length:monthCount},(_,i)=>new Date(Date.UTC(2026,7+i,1)).toISOString().slice(0,7));
 const members=Array.from({length:72},(_,i)=>({id:i+1,member_name:i<68?'Resident '+String(i+1).padStart(2,'0'):'Inactive Person '+i,unit_label:String(i+1)+(i%3===0?' FF':''),property_type:i>=70?'shop':'home',is_active:i<68,contributions_by_month:Object.fromEntries(months.map((m,j)=>[m,(i+j)%3?700.25:0]))}));
 const collected=key=>members.reduce((n,m)=>n+m.contributions_by_month[key],0);
 const total=months.reduce((n,m)=>n+collected(m),0);
 return {society:{name:'Example Enclave',location:'Mohali',pdf_shops_mode:'summary',pdf_shops_summary_text:'Other sources'},members,matrix_months:months,selected_month:months.at(-1),month_summary:months.map(m=>({month_key:m,collected:collected(m),spent:25,balance:collected(m)-25,paid_count:48})),totals:{overall_collected:total,overall_spent:125,overall_balance:total-125},month_expenses:[{title:'Lighting maintenance',expense_date:'2026-12-01',category:'Maintenance',notes:'Shared lighting service',amount:125}],member_balances:[],member_balance_settlements:[]};
}
(async()=>{
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage(),d=fixture();
  const options={include_summary:true,include_matrix:true,include_report:true,include_expenses:true,matrix_months:d.matrix_months};
  const html=buildSocietyPdfHtml('custom',d,options,{currency_code:'INR'});
  await page.setContent(html);await page.emulateMediaType('screen');
  const pdf=Buffer.from(await page.pdf({preferCSSPageSize:true,printBackground:true,margin:{top:0,right:0,bottom:0,left:0}}));
  const output=path.join(os.tmpdir(),'society-custom-mobile-preview.pdf');fs.writeFileSync(output,pdf);
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc=await pdfjs.getDocument({data:new Uint8Array(pdf),standardFontDataUrl:path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replaceAll('\\','/')+'/'}).promise;
  const text=[];
  for(let i=1;i<=doc.numPages;i++){
   const p=await doc.getPage(i),viewport=p.getViewport({scale:1}),content=await p.getTextContent();
   assert.ok(Math.abs(viewport.width-400)<1);assert.ok(Math.abs(viewport.height-800)<1);
   for(const item of content.items){if(!item.str.trim())continue;assert.ok(item.transform[4]>=0&&item.transform[4]+item.width<=viewport.width+1,`Text clipped on page ${i}: ${item.str}`);}
   const pageText=content.items.map(item=>item.str).join(' ');text.push(pageText);assert.match(pageText,new RegExp('Page '+i));
   if(i===1){const {createCanvas}=require('@napi-rs/canvas'),v=p.getViewport({scale:1.4}),canvas=createCanvas(Math.ceil(v.width),Math.ceil(v.height));await p.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;fs.writeFileSync(path.join(os.tmpdir(),'society-custom-mobile-preview.png'),canvas.toBuffer('image/png'));}
  }
  const allText=text.join('\n');assert.doesNotMatch(allText,/Inactive Person/);
  for(let i=1;i<=68;i++)assert.equal((allText.match(new RegExp('Resident '+String(i).padStart(2,'0'),'g'))||[]).length,1,'Every active resident must appear once');
  assert.match(allText,/Other sources/);assert.match(allText,/All members total/);assert.match(allText,/Lighting maintenance/);assert.match(allText,/Financial summary/);
  assert.ok(text.filter(t=>t.includes('MEMBER')&&t.includes('TOTAL')).length>=2,'Matrix column headings must repeat across pages');
  const long=fixture(13);await page.setContent(buildSocietyPdfHtml('custom',long,{include_matrix:true,matrix_months:long.matrix_months}));
  assert.deepEqual(await page.$$eval('table.matrix thead tr',rows=>rows.map(r=>r.children.length)),[15]);
  assert.equal(await page.$$('.collection-summary').then(a=>a.length),1);
  const widePdf=await page.pdf({preferCSSPageSize:true,printBackground:true,margin:{top:0,right:0,bottom:0,left:0}});
  const wideDoc=await pdfjs.getDocument({data:new Uint8Array(widePdf)}).promise;
  for(let i=1;i<=wideDoc.numPages;i++){
    const p=await wideDoc.getPage(i),v=p.getViewport({scale:1}),c=await p.getTextContent();
    assert.ok(v.height>v.width,'Long selections must stay portrait');
    for(const item of c.items){if(item.str.trim())assert.ok(item.transform[4]>=0&&item.transform[4]+item.width<=v.width+1,'Long-selection text must not be clipped: '+item.str);}
  }
  const checked=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-11'];
  const sparse={...long,matrix_months:[...checked,'2026-12']};
  sparse.members=sparse.members.map(m=>({...m,contributions_by_month:Object.fromEntries(sparse.matrix_months.map((key,index)=>[key,index+1]))}));
  await page.setContent(buildSocietyPdfHtml('custom',sparse,{include_matrix:true,matrix_months:checked}));
  assert.equal(await page.$$('.matrix').then(a=>a.length),1);
  assert.deepEqual(await page.$$eval('.matrix thead th',cells=>cells.map(c=>c.textContent)),['Member','Jan','Feb','Mar','Apr','May','Jun','Jul','Nov','Total']);
  assert.deepEqual(await page.$$eval('.matrix tbody tr:first-child td',cells=>cells.slice(1).map(c=>c.textContent)),['1','2','3','4','5','6','7','8','36']);
  await page.setContent(buildSocietyPdfHtml('custom',sparse,{include_matrix:true,matrix_months:[]}));
  assert.equal(await page.$('table.matrix'),null);
  assert.match(await page.$eval('body',e=>e.textContent),/No matrix months selected/);
  await page.setContent(buildSocietyPdfHtml('custom',d,{include_summary:false,include_matrix:false,include_report:false,include_expenses:true}));assert.equal(await page.$('.collection-summary'),null);assert.equal(await page.$('table.matrix'),null);assert.match(await page.$eval('body',e=>e.textContent),/Lighting maintenance/);
  console.log(`Mobile PDF checks passed: ${doc.numPages} portrait pages, all active residents, complete totals, repeated headers, no clipped text, 13 months together, exact eight-month checkbox selection, empty selection, section toggles. Preview: ${output}`);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
