function liveSplitCurrencyCode(row, fallback='INR') {
  const value=String(row?.currency_code || row?.owner_currency_code || fallback || 'INR').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : 'INR';
}
function liveSplitCurrencyScope(own=[],shared=[],trips=[],preferred='INR',selected='') {
  const base=liveSplitCurrencyCode(null,preferred);
  const dataCodes=[...new Set([...own,...shared,...trips].map(row=>liveSplitCurrencyCode(row,base)))].sort();
  const codes=[...new Set([...dataCodes,base])].sort();
  const currency=codes.includes(selected) ? selected : dataCodes.includes(base) ? base : dataCodes[0] || base;
  const keep=row=>liveSplitCurrencyCode(row,base)===currency;
  return {currency,codes,groups:own.filter(keep),sharedGroups:shared.filter(keep),trips:trips.filter(keep)};
}
function formatLiveSplitMoney(amount,currency='INR') {
  const locales={INR:'en-IN',CAD:'en-CA',USD:'en-US',GBP:'en-GB',EUR:'de-DE',AUD:'en-AU',AED:'en-AE',SGD:'en-SG'};
  const code=liveSplitCurrencyCode(null,currency);
  try {return new Intl.NumberFormat(locales[code]||'en-US',{style:'currency',currency:code,minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(amount)||0);}
  catch {return code+' '+(Number(amount)||0).toFixed(2);}
}
function liveSplitCurrencySections(own=[],shared=[],trips=[],preferred='INR') {
  const codes=[...new Set([...own,...shared,...trips].map(row=>liveSplitCurrencyCode(row,preferred)))];
  if (!codes.length) codes.push(liveSplitCurrencyCode(null,preferred));
  codes.sort((a,b)=>a===preferred?-1:b===preferred?1:a.localeCompare(b));
  return codes.map(code=>liveSplitCurrencyScope(own,shared,trips,preferred,code));
}
function liveSplitHomeRows(sections=[], preferred='INR') {
  const rows=sections.flatMap(section=>(section.rows || section.visibleRows || []).map(row=>({...row,currency_code:section.currency})));
  const identity=row=>Number(row.linked_user_id)>0 ? 'user:'+row.linked_user_id : Number(row.friend_id)>0 ? 'friend:'+row.friend_id : String(row.key || row.name || '');
  const active=new Set(rows.filter(row=>Math.abs(Number(row.amount)||0)>0.004).map(identity));
  const zeroChoice=new Map();
  rows.forEach(row=>{
    const key=identity(row);
    if(active.has(key) || Math.abs(Number(row.amount)||0)>0.004) return;
    const previous=zeroChoice.get(key);
    const score=item=>(item.has_activity?4:0)+(item.currency_code===(item.linked_user_currency_code || preferred)?2:0);
    if(!previous || score(row)>score(previous)) zeroChoice.set(key,row);
  });
  return rows.filter(row=>Math.abs(Number(row.amount)||0)>0.004 || zeroChoice.get(identity(row))===row);
}
function liveSplitConvertedTotals(rows=[], target='INR', rates=[]) {
  const currency=liveSplitCurrencyCode(null,target);
  const map=new Map([['INR',1]]);
  (Array.isArray(rates)?rates:[]).forEach(row=>{
    const value=Number(row.rate_to_inr);
    if(value>0 && Number.isFinite(value)) map.set(liveSplitCurrencyCode(row),value);
  });
  let oweToMe=0, iOwe=0;
  const missing=new Set();
  rows.forEach(row=>{
    const amount=Number(row.amount)||0;
    if(!amount) return;
    const source=liveSplitCurrencyCode(row,currency);
    let converted=amount;
    if(source!==currency) {
      if(!map.has(source)) missing.add(source);
      if(!map.has(currency)) missing.add(currency);
      if(!map.has(source)||!map.has(currency)) return;
      converted=amount*map.get(source)/map.get(currency);
    }
    if(converted>0) oweToMe+=converted;
    else iOwe-=converted;
  });
  const round=value=>Math.round((value+Number.EPSILON)*100)/100;
  return {currency,complete:missing.size===0,missing:[...missing].sort(),oweToMe:missing.size?null:round(oweToMe),iOwe:missing.size?null:round(iOwe),net:missing.size?null:round(oweToMe-iOwe)};
}
if(typeof module!=='undefined')module.exports={liveSplitCurrencyCode,liveSplitCurrencyScope,liveSplitCurrencySections,liveSplitHomeRows,liveSplitConvertedTotals,formatLiveSplitMoney};
