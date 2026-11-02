function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Shared by web and mobile custom exports. The checkbox selection defines the
// complete matrix; page width grows only when needed to keep columns readable.
function buildSocietyCustomMobilePdf(detail, options, prefs, helpers) {
  const {fmtCur, fmtDate, monthLabel, filterMembers, collapsePdfShopMembers, resolveExpenseScope, selectedPeriodRange, societyPeriodRange} = helpers;
  const all = Array.isArray(detail.members) ? detail.members : [];
  const active = all.filter(m => m.is_active !== false);
  const includeSummary = options.include_summary !== false, includeReport = !!options.include_report;
  const includeMatrix = !!options.include_matrix, includeExpenses = !!options.include_expenses;
  const selectedMonths = Array.isArray(options.matrix_months) ? options.matrix_months : detail.matrix_months || [];
  const months = [...new Set(selectedMonths.filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)))].sort();
  const allMonths = [...new Set([...(detail.matrix_months || []), ...(detail.month_summary || []).map(m => m.month_key), ...all.flatMap(m => Object.keys(m.contributions_by_month || {}))])].filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)).sort();
  const pageWidth = includeMatrix ? Math.max(400, 28 + 126 + 52 + months.length * 31) : 400;
  const monthColumnWidth = (pageWidth - 28 - 126 - 52) / (months.length || 1);
  const visible = filterMembers({...detail, members:active}, options.member_scope || 'all', includeMatrix && months.length ? months : allMonths);
  const ids = new Set(visible.map(m => Number(m.id)));
  const shop = m => String(m.property_type || '').toLowerCase() === 'shop';
  const shopSummary = detail.society?.pdf_shops_mode === 'summary';
  const shopTitle = detail.society?.pdf_shops_summary_text || 'Shops / other sources';
  const displayed = collapsePdfShopMembers(detail, visible, months).filter(m => !m.__pdf_shop_summary);
  const rows = shopSummary ? displayed : collapsePdfShopMembers(detail, visible, months);
  const amount = (member, keys) => keys.reduce((n, key) => n + Number(member.contributions_by_month?.[key] || 0), 0);
  const sum = (members, keys) => members.reduce((n, m) => n + amount(m, keys), 0);
  const expensePeriod = options.expense_scope === 'selected' ? selectedPeriodRange(options.expense_months || []) : options.expense_scope === 'all' ? societyPeriodRange(detail) : monthLabel(detail.selected_month);
  const period = includeSummary || includeReport ? selectedPeriodRange(allMonths) : includeMatrix && months.length ? selectedPeriodRange(months) : includeExpenses ? expensePeriod : societyPeriodRange(detail);
  const locale = prefs.currency_locale || prefs.locale || 'en-IN';
  const number = value => Number(value || 0).toLocaleString(locale, {minimumFractionDigits:0, maximumFractionDigits:2});
  const numeric = (value, zeroDash = false) => `<span class="${!value && zeroDash ? 'zero' : 'amount'}">${escape(!value && zeroDash ? '–' : number(value))}</span>`;
  const generated = new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
  const currencySymbol = fmtCur(0).replace(/[\d.,\s]/g, '') || prefs.currency_code || 'INR';
  const labelMember = member => `<strong class="member-name">${escape(member.member_name || 'Member')}</strong>${member.unit_label ? `<small class="unit">${escape(/^(house|shop|plot|flat|unit|h\.?\s*no)/i.test(String(member.unit_label)) ? '' : shop(member) ? 'Shop ' : 'House ')}${escape(member.unit_label)}</small>` : ''}`;
  const heading = (title, note = '') => `<header class="section-heading"><h2>${escape(title)}</h2>${note ? `<p>${escape(note)}</p>` : ''}</header>`;
  const overallCollected = Number(detail.totals?.overall_collected ?? sum(all, allMonths));
  const shops = all.filter(shop), homes = all.filter(m => !shop(m));
  const body = [];
  if (includeSummary) {
    body.push(`<section class="collection-summary"><div class="summary-main"><small>All-time collected</small><strong>${escape(fmtCur(overallCollected))}</strong></div><div><small>Members</small><b>${escape(fmtCur(sum(homes, allMonths)))}</b></div><div><small>${escape(shops.length ? shopTitle : 'Active members')}</small><b>${shops.length ? escape(fmtCur(sum(shops, allMonths))) : active.length}</b></div></section>`);
  }
  if (includeReport) {
    const keys = allMonths;
    body.push(heading('Monthly totals'), `<section class="monthly-cards">${keys.map(key => {
      const summary = (detail.month_summary || []).find(m => m.month_key === key);
      const total = all.length ? sum(all, [key]) : Number(summary?.collected || 0);
      return `<div><small>${escape(monthLabel(key))}</small><strong>${escape(fmtCur(total))}</strong></div>`;
    }).join('')}</section>`);
  }
  if (includeMatrix) {
    if (!months.length) {
      body.push(heading('Contribution matrix'), '<p class="empty">No matrix months selected.</p>');
    } else {
      const keys = months;
      const head = keys.map(key => {
        const label = monthLabel(key, true).split(' ')[0];
        const crossYear = new Set(keys.map(k=>k.slice(0,4))).size > 1;
        return `<th>${escape(label)}${crossYear ? `<small>${key.slice(2,4)}</small>` : ''}</th>`;
      }).join('');
      const columns = `<col style="width:126pt">${keys.map(()=>`<col style="width:${monthColumnWidth}pt">`).join('')}<col style="width:52pt">`;
      const totalRow = (label,members,grand=false) => `<tr class="${grand?'grand-total':''}"><td>${escape(label)}</td>${keys.map(key=>`<td>${numeric(sum(members,[key]))}</td>`).join('')}<td>${numeric(sum(members,keys))}</td></tr>`;
      body.push(`<section class="matrix-section" data-matrix-months="${escape(keys.join(','))}">${heading('Contribution matrix',`${selectedPeriodRange(keys)} · Amounts in ${currencySymbol} · house number below each name`)}
        <table class="matrix"><colgroup>${columns}</colgroup><thead><tr><th>Member</th>${head}<th>Total</th></tr></thead>
        <tbody>${rows.map(member=>`<tr><td>${labelMember(member)}</td>${keys.map(key=>`<td>${numeric(amount(member,[key]),true)}</td>`).join('')}<td class="member-total">${numeric(amount(member,keys))}</td></tr>`).join('') || `<tr><td colspan="${keys.length+2}" class="empty">No active members match this selection.</td></tr>`}</tbody>
        <tfoot>${shops.length ? totalRow('Members subtotal',homes)+totalRow(shopTitle,shops) : ''}${totalRow('All members total',all,true)}</tfoot></table>
        </section>`);
    }
  }
  if (includeReport) {
    const financialRows = detail.month_summary || [];
    body.push(heading('Financial summary','All-time collections, expenses and balance'), `<table class="financial"><thead><tr><th>Month</th><th>Collected</th><th>Expenses</th><th>Balance</th></tr></thead><tbody>${financialRows.map(m=>`<tr><td>${escape(monthLabel(m.month_key))}<small>${Number(m.paid_count||0)} paid</small></td><td>${numeric(m.collected)}</td><td>${numeric(m.spent)}</td><td>${numeric(m.balance)}</td></tr>`).join('')}</tbody><tfoot><tr><td>All Time Total</td><td>${escape(fmtCur(detail.totals?.overall_collected||0))}</td><td>${escape(fmtCur(detail.totals?.overall_spent||0))}</td><td>${escape(fmtCur(detail.totals?.overall_balance||0))}</td></tr></tfoot></table>`);
    const balances = (detail.member_balances || []).filter(row => ids.has(Number(row.member_id)));
    if (balances.length || Number(detail.totals?.member_owed_gross_total) || Number(detail.totals?.member_settled_total) || Number(detail.totals?.member_owed_total)) body.push(heading('Member ledger','Active members · all-member totals below'), balances.map(m=>`<article class="ledger-card">${labelMember(m)}<div class="ledger-values">${[['Gross owed',m.amount],['Settled',m.settled_amount],['Remaining',m.remaining_amount]].map(([label,value])=>`<div><small>${label}</small><strong>${escape(fmtCur(value||0))}</strong></div>`).join('')}</div><p>${Number(m.expense_count||0)} expenses · ${Number(m.settlement_count||0)} settlements</p></article>`).join(''), `<div class="ledger-card total-card"><b>All members total</b><div class="ledger-values">${[['Gross owed',detail.totals?.member_owed_gross_total],['Settled',detail.totals?.member_settled_total],['Remaining',detail.totals?.member_owed_total]].map(([label,value])=>`<div><small>${label}</small><strong>${escape(fmtCur(value||0))}</strong></div>`).join('')}</div></div>`);
    const settlements = (detail.member_balance_settlements || []).filter(row=>ids.has(Number(row.member_id)));
    if (settlements.length || Number(detail.totals?.member_settled_total)) body.push(heading('Settlement history'), settlements.map(m=>`<article class="entry-card"><div><strong>${escape(m.member_name||'Member')}</strong><small>${escape(fmtDate(m.settlement_date))} · ${escape(m.method||m.settlement_mode||'Cash')}</small>${m.notes?`<p>${escape(m.notes)}</p>`:''}</div><b>${escape(fmtCur(m.amount||0))}</b></article>`).join(''), `<div class="total-line"><b>All members settled total</b><b>${escape(fmtCur(detail.totals?.member_settled_total||0))}</b></div>`);
  }
  if (includeExpenses) {
    const expenses = resolveExpenseScope(detail,options.expense_scope||'current',options.expense_months||[]);
    const expenseNote = options.expense_scope==='all' ? 'All expenses' : options.expense_scope==='selected' ? selectedPeriodRange(options.expense_months||[]) : monthLabel(detail.selected_month);
    body.push(heading('Expenses',expenseNote), expenses.map(e=>`<article class="entry-card"><div><strong>${escape(e.title||'Expense')}</strong><small>${escape(fmtDate(e.expense_date))}${e.category?' · '+escape(e.category):''}</small>${e.notes?`<p>${escape(e.notes)}</p>`:''}</div><b>${escape(fmtCur(e.amount||0))}</b></article>`).join('')||'<p class="empty">No expenses in this selection.</p>', `<div class="total-line"><b>Total expenses</b><b>${escape(fmtCur(expenses.reduce((n,e)=>n+Number(e.amount||0),0)))}</b></div>`);
  }
  const footerLabel = `${detail.society?.name || 'Society'} · Society Report · ${period}`;
  const cssString = text => JSON.stringify(String(text)).replace(/</g,'\\3c ');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(footerLabel)}</title><style>
    @page {size:${pageWidth}pt ${pageWidth*2}pt;margin:20pt 14pt 26pt;@bottom-left{content:${cssString(footerLabel)};font:6pt Arial;color:#718078;}@bottom-right{content:"Page " counter(page);font:6pt Arial;color:#718078;}}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,"Segoe UI",sans-serif;color:#172521;font-size:8pt;line-height:1.35;margin:0}h1,h2,p{margin:0}h2{font-size:11pt;color:#15251e}small{display:block;font-size:6.5pt;color:#718078}.hero{background:#205b40;color:#fff;border-radius:8pt;padding:14pt 12pt;margin-bottom:10pt;break-inside:avoid}.hero .eyebrow{font-size:6.5pt;font-weight:700;letter-spacing:.6pt;color:#d7e8dd}.hero h1{font-size:20pt;margin:8pt 0 5pt;line-height:1.15}.hero p{font-size:8pt;color:#e0ece4}.hero small{font-size:6.5pt;color:#d3e4d9;margin-top:8pt}.collection-summary{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:9pt;padding:10pt;background:#edf4ef;border-radius:8pt;margin-bottom:10pt;break-inside:avoid}.collection-summary small{text-transform:uppercase;font-size:6pt;font-weight:700;margin-bottom:7pt}.collection-summary strong{font-size:15pt;color:#205b40}.collection-summary b{font-size:10pt}.section-heading{margin:12pt 5pt 6pt;break-after:avoid}.section-heading p,.note{font-size:6.5pt;color:#738078;margin-top:3pt}.monthly-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6pt;margin-bottom:12pt}.monthly-cards>div{border:1px solid #e0e6e2;border-radius:6pt;padding:7pt;break-inside:avoid}.monthly-cards small{text-transform:uppercase;font-size:6pt;font-weight:700;margin-bottom:5pt}.monthly-cards strong{font-size:11pt}.note{margin:6pt 4pt}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group;break-inside:avoid;page-break-inside:avoid;break-after:avoid}tfoot{display:table-row-group}tr{break-inside:avoid;page-break-inside:avoid}th{background:#205b40;color:white;text-align:right;font-size:6.2pt;text-transform:uppercase;padding:4pt 3pt;white-space:nowrap}th:first-child{text-align:left}th small{color:#dbe9df;font-size:5.5pt}td{border-bottom:1px solid #e3e9e5;padding:4pt 3pt;text-align:right;font-size:7pt;vertical-align:middle;font-variant-numeric:tabular-nums}td:first-child{text-align:left;overflow-wrap:anywhere}tbody tr:nth-child(even){background:#f5f8f6}.matrix .member-name{font-size:7.4pt;font-weight:400;line-height:9pt;display:block}.unit{font-size:6.2pt;line-height:8pt;color:#778379}.member-total{font-weight:700}.amount{white-space:nowrap}.zero{color:#b8c3bc}tfoot td{background:#edf4ef;font-weight:700;font-size:6.8pt;padding:6pt 3pt}.grand-total td{background:#205b40;color:white}.financial th:first-child{width:27%}.financial td{font-size:6.6pt}.financial tfoot td{font-size:6.4pt;overflow-wrap:anywhere}.financial tfoot td:not(:first-child){white-space:nowrap}.ledger-card{border:1px solid #dfe7e1;padding:9pt;border-radius:7pt;margin-bottom:6pt;break-inside:avoid}.ledger-card .member-name{font-size:9pt}.ledger-values{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7pt;margin-top:8pt}.ledger-values strong{font-size:8pt}.ledger-card p{font-size:6.5pt;color:#718078;margin-top:6pt}.total-card{background:#edf4ef}.entry-card{display:flex;justify-content:space-between;gap:10pt;padding:9pt 3pt;border-bottom:1px solid #e0e8e2;break-inside:avoid}.entry-card>div{min-width:0;flex:1}.entry-card strong{font-size:8pt;overflow-wrap:anywhere}.entry-card b{font-size:9pt;color:#205b40;white-space:nowrap}.entry-card small{margin-top:4pt}.entry-card p{font-size:7pt;color:#6f7e74;margin-top:4pt;overflow-wrap:anywhere}.total-line{display:flex;justify-content:space-between;gap:8pt;background:#edf4ef;padding:9pt;border-radius:6pt;margin-top:7pt;font-size:8pt;break-inside:avoid}.empty{padding:14pt 3pt;font-size:8pt;color:#758279}.scope-note{font-size:6.5pt;line-height:1.4;color:#748178;margin:0 4pt 8pt}@media screen{body{max-width:${(pageWidth-28)*4/3}px;margin:auto}}
    </style></head><body><header class="hero"><div class="eyebrow">SOCIETY REPORT</div><h1>${escape(detail.society?.name||'Society')}</h1><p>${escape(detail.society?.location||'')} · ${rows.length} members listed · ${escape(period)}</p><small>Generated by Expense Lite AI · ${escape(generated)}</small></header>${body.join('')}<p class="scope-note">Only active members are listed. Financial totals include all members, including inactive members.</p></body></html>`;
}

module.exports = {buildSocietyCustomMobilePdf};
