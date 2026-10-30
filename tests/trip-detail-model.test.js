const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {tripDetailModel}=require('../public/js/trip-detail-model');
const fixture=()=>({start_date:'2026-11-20',end_date:'2026-11-24',members:[{id:1,member_name:'Himanshu'},{id:2,member_name:'Deepak'}],expenses:[{id:1,amount:100,paid_by_key:'m1',splits:[{member_key:'m1',share_amount:50},{member_key:'m2',share_amount:50}]},{id:2,split_mode:'settlement',amount:20,paid_by_key:'m2',splits:[{member_key:'m1',share_amount:20}]}],itinerary_items:[{id:1,itinerary_date:'2026-11-21',title:'Park',start_time:'15:00'},{id:2,itinerary_date:'2026-11-21',title:'Lunch',start_time:'12:00'}]});
test('payments affect balances without increasing spending or payer percentages',()=>{
  const m=tripDetailModel(fixture());
  assert.equal(m.total,100);assert.equal(m.paidTotal,100);
  assert.deepEqual(m.people.map(p=>[p.name,p.share,p.paid,p.sent,p.received,p.net]),[['Himanshu',50,100,0,20,30],['Deepak',50,0,20,0,-30]]);
  assert.deepEqual(m.transfers,[{from:'Deepak',to:'Himanshu',amount:30}]);
});
test('includes empty days and sorts activities by time',()=>{
  const m=tripDetailModel(fixture());assert.equal(m.days.length,5);assert.equal(m.days[0].items.length,0);assert.deepEqual(m.days[1].items.map(i=>i.title),['Lunch','Park']);
});
test('preserves itinerary outside the current trip dates',()=>{
  const t=fixture();t.itinerary_items.push({itinerary_date:'2026-11-25',title:'Extra'});assert.equal(tripDetailModel(t).days.at(-1).items[0].title,'Extra');
});
test('roster is never expanded by shared users or expense identities',()=>{
  const t=fixture();t.shared_users=[{display_name:'Other user'}];t.expenses.push({paid_by_name:'Other user',amount:5,splits:[]});assert.equal(tripDetailModel(t).people.length,2);
});
test('settled trip and no-dates empty trip have no suggested transfers',()=>{
  const t=fixture();t.expenses[1].amount=50;t.expenses[1].splits[0].share_amount=50;assert.equal(tripDetailModel(t).transfers.length,0);assert.deepEqual(tripDetailModel({}).days,[]);
});
test('mobile and web use the same financial model',()=>{
  assert.equal(fs.readFileSync(require.resolve('../public/js/trip-detail-model'),'utf8'),fs.readFileSync('C:/P/ExpenseManager_mobile/src/utils/tripDetailModel.js','utf8'));
});
