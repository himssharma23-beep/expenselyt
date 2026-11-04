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
if(typeof module!=='undefined')module.exports={liveSplitCurrencyCode,liveSplitCurrencyScope,formatLiveSplitMoney};
