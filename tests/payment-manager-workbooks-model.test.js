const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const M=require('../public/js/payment-manager-workbook-model');
function sample(){
  const names=['Himanshu','Saurav','Deepak','Gurwinder','Deevansh','Sandeep','Sanjay','Hardeep','Vashisht','Rohit','Vikas','Sourav'];
  const doc=M.fresh('2026-11-10');doc.title='Friends evening';
  doc.people=names.map((name,i)=>({key:i?String(i):'self',name,post_to_live_split:i<3}));
  doc.expenses=[{key:'bottle-1',title:'Bottle',amount:2880,paid_by:'self',participants:doc.people.slice(0,10).map(p=>p.key),mode:'equal'},
    {key:'bottle-2',title:'Bottle',amount:1250,paid_by:'2',participants:doc.people.slice(0,10).map(p=>p.key),mode:'equal'},
    {key:'chakna',title:'Chakna',amount:3100,paid_by:'1',participants:doc.people.map(p=>p.key),mode:'equal'}];
  return doc;
}
test('sample assigns bottle costs to ten members and food to twelve, preserving every cent',()=>{
  const p=M.calculate(sample());assert.equal(p.valid,true);assert.equal(p.total,7230);assert.equal(p.allocated,7230);
  assert.equal(p.people.find(p=>p.name==='Vikas').share,258.33);
  assert.equal(p.people.find(p=>p.key==='self').paid,2880);
  assert.equal(p.people.find(p=>p.name==='Deepak').paid,1250);
  assert.equal(p.people.find(p=>p.name==='Saurav').paid,3100);
  for(const person of p.people){
    const net=p.entries.reduce((sum,e)=>sum+(e.to===person.key?Math.round(e.amount*100):0)-(e.from===person.key?Math.round(e.amount*100):0),0);
    assert.equal(net,Math.round(person.balance*100));
  }
});
test('rounding drinkers to 670 and allocating remainder to two others yields 265 each and exact 7230',()=>{
  const doc=sample();for(const p of doc.people.slice(0,10))doc.overrides[p.key]=670;
  assert.equal(M.calculate(doc).valid,false);assert.equal(M.calculate(doc).difference,13.34);
  doc.overrides=M.distribute(doc,doc.people.slice(10).map(p=>p.key));
  const result=M.calculate(doc);assert.equal(result.valid,true);assert.equal(result.people[10].share,265);assert.equal(result.people[11].share,265);
  for(const p of doc.people)doc.checklist[p.key]=p.name!=='Sanjay';
  assert.equal(M.calculate(doc).collected,6560);assert.equal(M.calculate(doc).pending,670);assert.equal(M.calculate(doc).paid_count,11);
});
test('per-expense equal, percent, fraction, parts and direct work with different participant subsets',()=>{
  for(const [mode,values] of [['equal',{}],['percent',{self:75,1:25}],['fraction',{self:'3/4',1:'1/4'}],['parts',{self:3,1:1}],['amount',{self:75,1:25}]]){
    const doc=sample();doc.expenses=[{key:'one',title:'One',amount:100,paid_by:'2',participants:['self','1'],mode,values}];
    const p=M.calculate(doc);assert.equal(p.valid,true,mode);assert.equal(p.people[2].share,0);assert.equal(p.people[2].paid,100);assert.equal(p.total,100);
  }
});
test('invalid participant, payer, totals, duplicate keys, negative money and incomplete modes cannot verify',()=>{
  for(const edit of [d=>d.expenses[0].participants=[],d=>d.expenses[0].participants=['outsider'],d=>d.expenses[0].paid_by='outsider',d=>d.expenses[0].amount=-1,d=>d.expenses[0].amount=1.001,d=>d.expenses[0].mode='bad',d=>d.expenses[0].mode='amount',d=>d.expenses[1].key=d.expenses[0].key,d=>d.people[1].key='self',d=>d.overrides.self=9999]){
    const doc=sample();edit(doc);assert.equal(M.calculate(doc).valid,false);
  }
  assert.throws(()=>M.distribute(sample(),[]),/Choose members/);
});
test('native and web share the same calculation module',()=>{
  assert.equal(fs.readFileSync('public/js/payment-manager-workbook-model.js','utf8'),fs.readFileSync('C:/P/ExpenseManager_mobile/src/utils/paymentManagerWorkbookModel.js','utf8'));
});
module.exports={sample};
