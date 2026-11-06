function renderEmiCalculatorPage(cards = []) {
  window._emiCalcResult = null;
  window._emiCalcSchedule = [];
  const toggle = (id, title, help, checked = false) => `<label class="emi-option"><span><b>${title}</b><small>${help}</small></span><input type="checkbox" role="switch" id="${id}" ${checked ? 'checked' : ''}><span class="emi-toggle" aria-hidden="true"></span></label>`;
  document.getElementById('main').innerHTML = `
    <div class="tab-content emi-page">
      <header class="emi-heading"><div><div class="emi-eyebrow">Tools</div><h1>EMI calculator</h1><p>Results update as you type. Save to track installments.</p></div><button class="btn btn-s" onclick="loadEMI()">&#8634; Reset</button></header>
      <div class="emi-layout">
        <div class="emi-inputs">
          <section class="emi-panel"><h2>Loan details</h2>
            <div class="emi-two"><label class="fl">Loan name<input class="fi" id="emiName" placeholder="e.g. Home loan" maxlength="120"></label><label class="fl">Tag / group<input class="fi" id="emiTag" placeholder="e.g. Personal"></label></div>
            <div class="emi-control"><label for="emiP">Loan amount</label><input class="fi emi-number" type="number" min="1" step="0.01" id="emiP" placeholder="200000" inputmode="decimal"></div>
            <input class="emi-range" aria-label="Loan amount slider" type="range" min="1000" max="2000000" step="1000" id="emiPSlider" value="200000" oninput="emiSliderValue('emiP', this.value)">
            <div class="emi-control"><label for="emiR">Rate of interest (p.a.)</label><div class="emi-unit"><input class="fi" type="number" min="0" max="100" step="0.01" id="emiR" placeholder="12" inputmode="decimal"><span>%</span></div></div>
            <input class="emi-range" aria-label="Interest rate slider" type="range" min="0" max="36" step="0.05" id="emiRSlider" value="12" oninput="emiSliderValue('emiR', this.value)">
            <div class="emi-control"><label for="emiN">Tenure</label><div class="emi-unit"><input class="fi" type="number" min="1" max="600" step="1" id="emiN" placeholder="24" inputmode="numeric"><span>months</span></div></div>
            <div class="emi-tenures">${[3,6,9,12,24,36].map(month => `<button type="button" data-emi-tenure="${month}" onclick="emiSliderValue('emiN', ${month})">${month} mo</button>`).join('')}</div>
          </section>
          <section class="emi-panel"><h2>Charges &amp; options</h2><div class="emi-two"><label class="fl">Processing / file charges<input class="fi" type="number" min="0" step="0.01" id="emiCharges" placeholder="0" inputmode="decimal"></label><label class="fl">Description<input class="fi" id="emiDesc" placeholder="e.g. Taken from HDFC"></label></div>
            ${toggle('emiChargesInc','Include charges in principal','Finance the processing fee inside the EMI',true)}
            ${toggle('emiGST','Add GST (18%) on interest','GST is charged on the interest part of each EMI')}
            ${toggle('emiPlannerAdvance','Show next EMI a month early in Planner','Helps you budget before the due date')}
          </section>
          <section class="emi-panel"><h2>Charged to credit card <small>· optional</small></h2><p>Pick a card if the EMI or charges are billed to it.</p><input type="hidden" id="emiCcId" value="">
            <div class="emi-card-choices"><button type="button" class="emi-card-choice active" id="emiCcChip_none" onclick="emiSetCard('')"><b>None</b><small>Not on a card</small></button>${cards.map(card => `<button type="button" class="emi-card-choice" id="emiCcChip_${Number(card.id)}" onclick="emiSetCard(${Number(card.id)})"><b>${escHtml([card.bank_name,card.card_name].filter(Boolean).join(' '))}</b><small>${card.last4 ? '&#8226;&#8226; '+escHtml(card.last4) : 'Credit card'}</small></button>`).join('')}</div>
            <div id="emiGstOffsetWrap" style="display:none"><label class="fl">EMI GST appears on<select class="fi" id="emiGstOffset"><option value="-1">Previous month's bill</option><option value="0" selected>Same month's bill</option><option value="1">Next month's bill</option></select></label></div>
            <div class="emi-two" id="emiCcChargesRow" style="display:none"><label class="fl">Processing charges on card<input class="fi" id="emiCcCharges" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0"></label><label class="fl">Processing GST (%)<input class="fi" id="emiCcChargesGst" type="number" min="0" max="100" step="0.01" inputmode="decimal" placeholder="18"></label><label class="fl">GST amount<input class="fi" id="emiCcChargesGstAmt" readonly placeholder="—"></label></div>
          </section>
        </div>
        <aside class="emi-output"><section id="emiResultBanner" class="emi-cost-card" aria-live="polite"></section><section class="emi-panel emi-save"><div id="emiSaveCaption">Save to track installments</div><div class="emi-two"><button class="btn btn-s" id="emiSave" onclick="saveEmiCalc(false)" disabled>Save EMI</button><button class="btn btn-p" id="emiSaveActivate" onclick="saveEmiCalc(true)" disabled>Save &amp; activate</button></div></section></aside>
      </div>
      <section class="emi-panel emi-schedule" id="emiResult"><div class="emi-schedule-head"><div><h2>EMI schedule</h2><p id="emiScheduleCaption">Enter loan details to see your installments</p></div><button class="btn btn-s btn-sm" id="emiBulk" onclick="showCalcBulkEdit()" disabled>Bulk edit EMI</button></div><div class="emi-table-scroll"><table id="calcSchedTable"><thead><tr><th>#</th><th>Split of EMI</th><th>Principal</th><th>Interest</th><th>GST</th><th>EMI</th><th>Balance left</th></tr></thead><tbody></tbody><tfoot id="emiScheduleTotals"></tfoot></table></div></section>
    </div>`;
  const page = document.querySelector('.emi-page');
  page.addEventListener('input', event => {
    const id = event.target.id;
    if (['emiP','emiR','emiN','emiCharges'].includes(id)) { emiSyncControls(); calcEMI(true); }
    if (['emiName','emiTag'].includes(id)) emiUpdateSaveCaption();
    if (['emiCcCharges','emiCcChargesGst'].includes(id)) _emiCalcProcGst();
  });
  page.addEventListener('change', event => {
    if (['emiChargesInc','emiGST'].includes(event.target.id)) { _emiGstToggle(); calcEMI(true); }
  });
  _emiGstToggle();
  renderEmiCalculation();
}

function emiSliderValue(id, value) {
  document.getElementById(id).value = value;
  emiSyncControls();
  calcEMI(true);
}
function emiSyncControls() {
  for (const id of ['emiP','emiR']) {
    const slider = document.getElementById(id+'Slider');
    const value = Number(document.getElementById(id).value);
    if (Number.isFinite(value)) slider.value = value;
  }
  document.querySelectorAll('[data-emi-tenure]').forEach(button => button.classList.toggle('active', Number(button.dataset.emiTenure) === Number(document.getElementById('emiN').value)));
}
function emiUpdateSaveCaption() {
  const caption = document.getElementById('emiSaveCaption');
  if (caption) caption.textContent = [document.getElementById('emiName')?.value.trim(), document.getElementById('emiTag')?.value.trim()].filter(Boolean).join(' · ') || 'Save to track installments';
}
function emiDisplayTotals() {
  const c = window._emiCalcResult;
  if (!c) return null;
  const rows = window._emiCalcSchedule || [];
  const paid = Math.round(rows.reduce((sum,row) => sum + row.woGST,0)*100)/100;
  const gst = Math.round(rows.reduce((sum,row) => sum + row.g,0)*100)/100;
  const upfront = c.chargesInc ? 0 : c.charges;
  const frequency = {};
  rows.forEach(row => { frequency[row.woGST] = (frequency[row.woGST] || 0)+1; });
  return { monthly: Number(Object.keys(frequency).sort((a,b) => frequency[b]-frequency[a])[0] || c.emi), interest: Math.round((paid-c.P)*100)/100, gst, upfront, paid, grand: Math.round((paid+gst+upfront)*100)/100 };
}
function emiCalculatorSummary() {
  const c = window._emiCalcResult;
  const totals = emiDisplayTotals();
  if (!c || !totals) return '<div class="emi-eyebrow">Monthly EMI</div><div class="emi-monthly">—</div><p>Enter an amount, interest rate and tenure to see your loan costs.</p><div class="emi-empty-chart" aria-hidden="true"></div><small>Charges, GST and your repayment schedule will appear here.</small>';
  const parts = [c.P,Math.max(0,totals.interest),totals.gst,totals.upfront];
  const colors = ['#5b947a','#f6d981','#e9a326','#a8cbb7'];
  const sum = parts.reduce((a,b) => a+b,0) || 1;
  let position=0;
  const stops = parts.map((part,index) => { const from=position; position+=part/sum*100; return `${colors[index]} ${from}% ${position}%`; }).join(',');
  const line = (label,value,color,sub='') => `<div class="emi-cost-line"><span><i style="background:${color}"></i>${label} <small>${sub}</small></span><b>${fmtCur(value)}</b></div>`;
  return `<div class="emi-cost-top"><div><div class="emi-eyebrow">Monthly EMI</div><div class="emi-monthly">${fmtCur(totals.monthly)}</div><p>for ${c.N} months${c.gst ? ' · GST billed separately' : ''}</p></div><div class="emi-donut" style="background:conic-gradient(${stops})" role="img" aria-label="Loan cost breakdown: principal ${fmtCur(c.P)}, interest ${fmtCur(totals.interest)}, GST ${fmtCur(totals.gst)}, upfront charges ${fmtCur(totals.upfront)}"><span>Cost of loan</span></div></div>
    ${line('Principal',c.P,colors[0])}${line('Interest',totals.interest,colors[1],c.gst?'excl. GST':'')}${c.gst?line('GST on interest',totals.gst,colors[2],'18%'):''}${line('Upfront charges',totals.upfront,colors[3],'one-time')}
    <div class="emi-grand"><b>Total you’ll pay</b><strong>${fmtCur(totals.grand)}</strong></div>${c.charges>0?`<div class="emi-cost-note">Processing charges of ${fmtCur(c.charges)} are ${c.chargesInc?'financed in the principal.':'paid upfront — one-time, not in the EMI.'}</div>`:''}`;
}
function renderEmiCalculation() {
  const valid = !!window._emiCalcResult;
  const banner = document.getElementById('emiResultBanner');
  if (!banner) return;
  banner.innerHTML = emiCalculatorSummary();
  for (const id of ['emiSave','emiSaveActivate','emiBulk']) document.getElementById(id).disabled = !valid;
  document.getElementById('emiScheduleCaption').textContent = valid ? `${window._emiCalcSchedule.length} installments · principal share grows each month` : 'Enter loan details to see your installments';
  document.querySelector('#calcSchedTable tbody').innerHTML = valid ? emiCalculatorScheduleRows() : '<tr><td colspan="7" class="emi-empty">Your repayment schedule will appear here.</td></tr>';
  emiCalculatorScheduleFooter();
  emiUpdateSaveCaption();
}
function emiCalculatorScheduleRows() {
  const c = window._emiCalcResult;
  return (window._emiCalcSchedule || []).map((row,index) => {
    const total = row.princ+row.interest+row.g || 1;
    return `<tr ${row._edited?'class="emi-edited"':''}><td><span class="emi-month-badge">${row.m}</span></td><td><div class="emi-split-bar" role="img" aria-label="Month ${row.m}: principal ${row.princ.toFixed(2)}, interest ${row.interest.toFixed(2)}, GST ${row.g.toFixed(2)}"><i style="width:${Math.max(0,row.princ/total*100)}%"></i><i style="width:${Math.max(0,row.interest/total*100)}%"></i><i style="width:${Math.max(0,row.g/total*100)}%"></i></div></td><td data-label="Principal">${row.princ.toFixed(2)}</td><td data-label="Interest" class="emi-interest">${row.interest.toFixed(2)}</td><td data-label="GST">${row.g.toFixed(2)}</td><td data-label="EMI (excl. GST)"><b>${row.woGST.toFixed(2)}</b><button class="emi-row-edit" aria-label="Edit month ${row.m}" onclick="showCalcRowEdit(${index})">Edit</button>${row._edited?'<small>edited</small>':''}</td><td data-label="Balance left"><div class="emi-balance"><span><i style="width:${Math.min(100,Math.max(0,row.bal/c.P*100))}%"></i></span><b>${row.bal.toFixed(2)}</b></div></td></tr>`;
  }).join('');
}
function emiCalculatorScheduleFooter() {
  const footer = document.getElementById('emiScheduleTotals');
  if (!footer) return;
  const rows = window._emiCalcSchedule || [];
  if (!window._emiCalcResult) { footer.innerHTML=''; return; }
  const sum = key => rows.reduce((total,row) => total+row[key],0).toFixed(2);
  footer.innerHTML = `<tr><th>Total</th><td><span class="emi-legend">Principal <i></i> Interest <i></i></span></td><td data-label="Principal">${sum('princ')}</td><td data-label="Interest">${sum('interest')}</td><td data-label="GST">${sum('g')}</td><td data-label="EMI (excl. GST)">${sum('woGST')}</td><td></td></tr>`;
}
