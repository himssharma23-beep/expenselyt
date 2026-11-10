const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function store({ datesAsObjects = true, offset = 1, due = '2026-11-10', processing = true } = {}) {
  const dateText = value => value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}` : String(value).slice(0,10);
  const dbDate = value => datesAsObjects ? new Date(`${dateText(value)}T00:00:00`) : dateText(value);
  const record = { id:7, user_id:2, name:'Machine', credit_card_id:9, gst_month_offset:offset, status:'active', cc_processing_charge:processing?299:0, cc_processing_gst_pct:processing?18:0 };
  let installments = [{ installment_no:1, due_date:dbDate(due), principal_component:3250.97, interest_component:200, gst_amount:36, emi_amount:3486.97 }];
  let transactions = [];
  const cycles = [];
  const query = async (sql, args = []) => {
    sql=sql.trim().replace(/\s+/g,' ');
    if (sql.startsWith('SELECT * FROM emi_records')) return { rows:args[0]===7&&args[1]===2?[{...record}]:[] };
    if (sql.startsWith('SELECT * FROM credit_cards')) return { rows:args[0]===9&&args[1]===2?[{id:9,bill_gen_day:15,due_days:20}]:[] };
    if (sql.startsWith('SELECT cycle_id FROM cc_txns')) return { rows:transactions.filter(row=>row.source_id===args[0]).map(row=>({cycle_id:row.cycle_id})) };
    if (sql.startsWith('DELETE FROM cc_txns')) { transactions=transactions.filter(row=>row.source_id!==args[0]);return {rows:[]}; }
    if (sql.startsWith('SELECT * FROM emi_installments')) return {rows:installments};
    if (sql.includes('pg_advisory_xact_lock')) return {rows:[]};
    if (sql.startsWith('SELECT * FROM cc_cycles')) return {rows:cycles.filter(row=>dateText(row.cycle_start)===args[2]&&dateText(row.cycle_end)===args[3])};
    if (sql.startsWith('INSERT INTO cc_cycles')) {
      const row={id:cycles.length+1,cycle_start:dbDate(args[2]),cycle_end:dbDate(args[3]),total_amount:0};
      cycles.push(row);return {rows:[row]};
    }
    if (sql.startsWith('INSERT INTO cc_txns')) {
      assert.match(dateText(args[3]),/^\d{4}-\d{2}-\d{2}$/);
      transactions.push({cycle_id:args[2],date:dateText(args[3]),description:args[4],amount:args[5],source_id:args[6]});return {rows:[]};
    }
    if (sql.startsWith('SELECT manual_total_override')) return {rows:[{manual_total_override:false}]};
    if (sql.includes('SUM(amount)')) {
      const sum=transactions.filter(row=>row.cycle_id===args[0]).reduce((total,row)=>total+row.amount,0);
      return {rows:[{total_amount:sum,net_payable:sum,total_discount:0}]};
    }
    if (sql.startsWith('UPDATE cc_cycles')) { cycles.find(row=>row.id===args[3]).total_amount=args[0];return {rows:[]}; }
    if (sql.startsWith('UPDATE emi_records SET credit_card_id')) { record.credit_card_id=args[0];record.gst_month_offset=args[1];return {rows:[]}; }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const context=vm.createContext({ Date, module:{exports:{}}, require:name=>{
    if (name==='./postgres') return { query,withTransaction:fn=>fn({query}) };
    if (name==='./postgres-ops') return {};
    throw new Error(name);
  } });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../db/postgres-finance.js'),'utf8'),context);
  return {
    post:()=>context.insertEmiCcTxns(2,7,{query}),
    relink:offset=>context.module.exports.addEmiToCreditCardManual(2,7,9,offset),
    cycleEnd:row=>dateText(cycles.find(cycle=>cycle.id===row.cycle_id).cycle_end),
    setInstallments:rows=>{installments=rows.map(row=>({...row,due_date:dbDate(row.due_date)}));},
    get transactions(){return transactions;}, cycles,
  };
}

for (const datesAsObjects of [true,false]) {
  test(`next bill receives GST when database dates are ${datesAsObjects?'Date objects':'strings'}`,async()=>{
    const db=store({datesAsObjects});await db.post();
    const gst=db.transactions.find(row=>row.description==='Machine - GST');
    assert.ok(gst);assert.equal(gst.amount,36);assert.equal(db.cycleEnd(gst),'2026-12-15');assert.equal(gst.date,'2026-11-16');
    for(const label of ['Principal','Interest','File Processing']) assert.equal(db.cycleEnd(db.transactions.find(row=>row.description===`Machine - ${label}`)),'2026-11-15');
    const processing=db.transactions.find(row=>row.description==='Machine - File Processing GST');
    assert.equal(db.cycleEnd(processing),'2026-12-15');assert.equal(processing.amount,53.82);
    assert.equal(Math.round(db.cycles.find(row=>row.id===gst.cycle_id).total_amount*100)/100,89.82);
  });
  test(`same bill receives GST with ${datesAsObjects?'Date objects':'strings'}`,async()=>{
    const db=store({datesAsObjects,offset:0});await db.post();
    assert.equal(db.transactions.length,5);
    assert.ok(db.transactions.every(row=>db.cycleEnd(row)==='2026-11-15'));
    assert.equal(db.transactions.find(row=>row.description==='Machine - GST').date,'2026-11-10');
  });
}
test('last installment GST posts to the following bill across a year boundary',async()=>{
  const db=store({due:'2026-12-10',processing:false});await db.post();
  const gst=db.transactions.find(row=>row.description==='Machine - GST');
  assert.equal(db.cycleEnd(gst),'2027-01-15');assert.equal(gst.date,'2026-12-16');
});
test('all six interest GST entries are posted, including the final following-month bill',async()=>{
  const db=store({processing:false});
  db.setInstallments([36,30.15,24.24,18.27,12.24,6.15].map((gst,index)=>({installment_no:index+1,due_date:`2027-${String(index+1).padStart(2,'0')}-10`,principal_component:3200,interest_component:gst/0.18,gst_amount:gst,emi_amount:3450.97})));
  await db.post();const gst=db.transactions.filter(row=>row.description==='Machine - GST');
  assert.equal(gst.length,6);assert.equal(db.cycleEnd(gst[0]),'2027-02-15');assert.equal(db.cycleEnd(gst[5]),'2027-07-15');
  assert.equal(Math.round(gst.reduce((sum,row)=>sum+row.amount,0)*100)/100,127.05);
});
test('reapplying card settings moves GST between bills without duplicate charges or stale totals',async()=>{
  const db=store();await db.relink(1);await db.relink(1);
  assert.equal(db.transactions.length,5);
  await db.relink(0);
  assert.equal(db.transactions.length,5);
  assert.ok(db.transactions.every(row=>db.cycleEnd(row)==='2026-11-15'));
  assert.equal(db.cycles.find(row=>db.cycleEnd({cycle_id:row.id})==='2026-12-15').total_amount,0);
});

test('mobile save passes the selected next/same bill offset to the shared backend',async()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../ExpenseManager_mobile/src/screens/EMIScreen.js'),'utf8');
  const start=source.indexOf('  async function saveEmi('),end=source.indexOf('  async function activateRecord(',start);
  assert.ok(start>=0&&end>start);
  for(const offset of ['1','0']) {
    let saved;
    const context=vm.createContext({calc:{principal:20000,rate:12,tenure:6,monthlyEmi:3450.97,totalInterest:705.82,gstOnInterest:true,totalGst:127.05,totalAmount:20705.82,grandTotal:20832.87},name:'Machine',description:'',tag:'',principal:'20000',charges:'0',chargesIncluded:false,gstOnInterest:true,plannerAdvance:false,cardId:'9',gstMonthOffset:offset,ccCharges:'299',ccChargesGst:'18',num:Number,post:async(url,body)=>{saved=body;return {id:7};},setSaving(){},Alert:{alert(){}},resetForm(){}});
    vm.runInContext(source.slice(start,end),context);await context.saveEmi(false);
    assert.equal(saved.gst_month_offset,Number(offset));assert.equal(saved.credit_card_id,9);assert.equal(saved.gst_rate,18);
  }
});
