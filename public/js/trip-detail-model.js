/* All balances use the saved account currency and actual trip roster. */
function tripDetailModel(trip) {
  const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const date = v => String(v || '').slice(0, 10);
  const people = (trip.members || []).map(m => ({key:String(m.id ?? m.member_key ?? m.member_name), name:m.member_name || m.name || 'Member', member:m, share:0, paid:0, sent:0, received:0}));
  const resolve = (key, name) => people.find(p => norm(p.name) === norm(name) && norm(name)) || people.find(p => [p.key, p.member.member_key, p.member.friend_id, 'm'+p.member.id, p.member.linked_user_id != null ? 'u'+p.member.linked_user_id : null, p.member.linked_user_id ? 'u:'+p.member.linked_user_id : 'g:'+norm(p.name)].filter(Boolean).map(String).includes(String(key)));
  const expenses = (trip.expenses || []).filter(e => e.split_mode !== 'settlement');
  const payments = (trip.expenses || []).filter(e => e.split_mode === 'settlement');
  [...expenses, ...payments].forEach(e => {
    const payment = e.split_mode === 'settlement';
    const payer = resolve(e.paid_by_key, e.paid_by_name);
    if (payer) payer[payment ? 'sent' : 'paid'] += Number(e.amount || 0);
    (e.splits || []).forEach(s => { const p = resolve(s.member_key, s.member_name); if(p) p[payment ? 'received' : 'share'] += Number(s.share_amount || 0); });
  });
  people.forEach(p => { p.net = Math.round((p.paid+p.sent-p.share-p.received)*100)/100; });
  const transfers = [], debtors = people.filter(p => p.net < -0.005).map(p => ({...p, cents:Math.round(-p.net*100)})), creditors = people.filter(p => p.net > 0.005).map(p => ({...p,cents:Math.round(p.net*100)}));
  for(const from of debtors) for(const to of creditors) { const cents=Math.min(from.cents,to.cents); if(cents>0) {transfers.push({from:from.name,to:to.name,amount:cents/100});from.cents-=cents;to.cents-=cents;} }
  const dayMap = new Map();
  const start=date(trip.start_date), end=date(trip.end_date)||start;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && end >= start) {
    const a=new Date(start+'T12:00:00Z'), b=new Date(end+'T12:00:00Z');
    for(let i=0; a<=b && i<730; i++,a.setUTCDate(a.getUTCDate()+1)) dayMap.set(a.toISOString().slice(0,10), []);
  }
  (trip.itinerary_items || []).forEach(item => {const d=date(item.itinerary_date); if(!dayMap.has(d)) dayMap.set(d,[]); dayMap.get(d).push(item);});
  const days=[...dayMap].sort(([a],[b])=>a.localeCompare(b)).map(([d,items],i)=>({date:d,number:i+1,items:items.sort((a,b)=>String(a.start_time||'').localeCompare(String(b.start_time||'')))}));
  const total=expenses.reduce((n,e)=>n+Number(e.amount||0),0);
  const links=[...new Set((String(trip.notes||'').match(/https?:\/\/[^\s<>]+/g)||[]))].map(url=>({url,title:url.replace(/^https?:\/\//,'').split('/')[0]}));
  return {people,expenses,payments,transfers,days,total,links,paidTotal:people.reduce((n,p)=>n+p.paid,0)};
}
if(typeof module !== 'undefined') module.exports={tripDetailModel};
