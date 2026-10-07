const { createPdfReportModel } = require('./pdf-report-model');

// Canonical report definitions migrated from the web app. Both clients call this registry.
async function buildWebReport({ report, args = [], data = {}, currency = 'INR' }, api) {
  const model = createPdfReportModel(currency);
  const _P = model.P;
  const fmtCur = _P.cur;
  const renderSharedPdfFileWindow = ({ payload }) => { model.payload = payload; };
  const toast = message => { throw new Error(message); };
  const { _plannerMonth, _loanFriend, _loanAllTxns = [], _loanBalance = {}, loanFilters = {}, _divGroups = [], _emiRecords = [], _trips = [], tripsFilters = {}, _tripDetail } = data;
  const fixedDepositFilteredRows = () => data.deposits || [];
  const fixedDepositFilterSummary = () => data.filterLabel || 'All People · All Statuses';
async function downloadCreditCardsPdf() {
  const data = await api('/api/cc/cards');
  if (!data) return;
  const cards = data.cards || [];
  const totalSpent = cards.reduce((s,c)=>s+(c.totalSpent||0),0);
  const totalTxns  = cards.reduce((s,c)=>s+(c.totalTxns||0),0);

  const doc = _P.init();
  let y = _P.header(doc, 'Credit Cards Overview',
    `${cards.length} cards  ·  ${new Date().toLocaleDateString('en-IN')}`);
  y = _P.cards(doc, y, [
    { label:'Total Cards',  value:cards.length,      color:'' },
    { label:'Total Spent',  value:_P.cur(totalSpent),color:'' },
    { label:'Total Txns',   value:totalTxns,          color:'' },
  ]);
  _P.table(doc, y,
    [['Bank','Card Name','Last 4','Credit Limit','Bill Gen Day','Due Days','Total Spent','Total Txns']],
    cards.map(c=>[
      c.bank_name,
      c.card_name,
      c.last4?'···'+c.last4:'—',
      c.credit_limit>0?_P.cur(c.credit_limit):'—',
      c.bill_gen_day,
      (c.due_days || 0)+' days',
      _P.cur(c.totalSpent||0),
      c.totalTxns||0,
    ]),
    { 3:{halign:'right'}, 4:{halign:'center'}, 5:{halign:'center'},
      6:{halign:'right',fontStyle:'bold'}, 7:{halign:'right'} }
  );
  _P.save(doc, 'Credit_Cards_Overview');
}

async function downloadCcCyclePdf(cardId, cycleId, cardLabel) {
  const data = await api(`/api/cc/cards/${cardId}/cycles`);
  if (!data) return;
  const cycles = data.cycles || [];
  const cycle = cycleId ? cycles.find(c=>c.id==cycleId) : cycles[0];
  if (!cycle) { toast('Cycle not found','error'); return; }

  const doc = _P.init();
  let y = _P.header(doc, `Billing Cycle — ${cardLabel}`,
    `${_P.dt(cycle.cycle_start)} → ${_P.dt(cycle.cycle_end)}  ·  ${cycle.status || 'pending'}`);
  y = _P.cards(doc, y, [
    { label:'Total Amount',   value:_P.cur(cycle.total_amount||0),   color:'' },
    { label:'Total Discount', value:_P.cur(cycle.total_discount||0), color:'green' },
    { label:'Net Payable',    value:_P.cur(cycle.net_payable||0),    color:'red' },
    { label:'Paid',           value:_P.cur(cycle.paid_amount||0),    color:'green' },
    { label:'Due Date',       value:_P.dt(cycle.due_date),           color:'' },
  ]);
  _P.table(doc, y,
    [['Date','Description','Amount','Discount %','Discount Amt','Net Amount']],
    (cycle.txns||[]).map(t=>[
      _P.dt(t.txn_date),
      t.description,
      _P.cur(t.amount),
      t.discount_pct>0?t.discount_pct+'%':'—',
      t.discount_amount>0?_P.cur(t.discount_amount):'—',
      _P.cur(t.net_amount),
    ]),
    { 2:{halign:'right'}, 3:{halign:'center'}, 4:{halign:'right'}, 5:{halign:'right',fontStyle:'bold'} }
  );
  _P.save(doc, `CC_Cycle_${cardLabel}_${cycle.cycle_start}`);
}

async function downloadCcHistoryPdf(cardId, cardLabel) {
  const data = await api(`/api/cc/cards/${cardId}/cycles`);
  if (!data) return;
  const cycles = data.cycles || [];

  const doc = _P.init(true);
  let y = _P.header(doc, `Billing History — ${cardLabel}`,
    `${cycles.length} cycles  ·  ${new Date().toLocaleDateString('en-IN')}`);

  const totalSpent = cycles.reduce((s,c)=>s+(c.total_amount||0),0);
  const totalDisc  = cycles.reduce((s,c)=>s+(c.total_discount||0),0);
  const totalNet   = cycles.reduce((s,c)=>s+(c.net_payable||0),0);
  y = _P.cards(doc, y, [
    { label:'Total Cycles', value:cycles.length,        color:'' },
    { label:'Total Spent',  value:_P.cur(totalSpent),  color:'' },
    { label:'Total Saved',  value:_P.cur(totalDisc),   color:'green' },
    { label:'Net Paid',     value:_P.cur(totalNet),    color:'red' },
  ]);

  _P.table(doc, y,
    [['Cycle Period','Due Date','Status','Total Spent','Discount','Net Payable','Transactions']],
    cycles.map(c=>[
      `${_P.dt(c.cycle_start)} → ${_P.dt(c.cycle_end)}`,
      c.due_date ? _P.dt(c.due_date) : '—',
      c.status||'—',
      _P.cur(c.total_amount||0),
      c.total_discount>0 ? _P.cur(c.total_discount) : '—',
      _P.cur(c.net_payable||0),
      c.txns?.length || 0,
    ]),
    { 3:{halign:'right'}, 4:{halign:'right'}, 5:{halign:'right',fontStyle:'bold'}, 6:{halign:'center'} },
    true
  );
  _P.save(doc, `CC_History_${cardLabel}`);
}

async function downloadCcMonthlySummaryPdf(cardId, cardLabel, year) {
  const url = `/api/cc/cards/${cardId}/monthly${year?`?year=${year}`:''}`;
  const data = await api(url);
  if (!data) return;
  const rows = data.months || [];

  const doc = _P.init();
  let y = _P.header(doc, `CC Monthly Summary — ${cardLabel}`,
    year ? `Year ${year}` : 'All time');
  const totAmt = rows.reduce((s,r)=>s+(r.total_amount||0),0);
  const totNet = rows.reduce((s,r)=>s+(r.net_payable||0),0);
  y = _P.cards(doc, y, [
    { label:'Months',       value:rows.length,      color:'' },
    { label:'Total Amount', value:_P.cur(totAmt),  color:'' },
    { label:'Net Payable',  value:_P.cur(totNet),  color:'red' },
  ]);
  _P.table(doc, y,
    [['Month','Total Amount','Total Discount','Net Payable','Transactions']],
    rows.map(r=>[
      r.month,
      _P.cur(r.total_amount||0),
      _P.cur(r.total_discount||0),
      _P.cur(r.net_payable||0),
      r.txn_count||0,
    ]),
    { 1:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right',fontStyle:'bold'}, 4:{halign:'center'} }
  );
  _P.save(doc, `CC_Monthly_${cardLabel}${year?'_'+year:''}`);
}

async function downloadCcYearlySummaryPdf(cardId, cardLabel) {
  const data = await api(`/api/cc/cards/${cardId}/yearly`);
  if (!data) return;
  const rows = data.years || [];

  const doc = _P.init();
  let y = _P.header(doc, `CC Yearly Summary — ${cardLabel}`, 'All years');
  const totAmt = rows.reduce((s,r)=>s+(r.total_amount||0),0);
  y = _P.cards(doc, y, [
    { label:'Years',       value:rows.length,     color:'' },
    { label:'Total Spent', value:_P.cur(totAmt), color:'' },
  ]);
  _P.table(doc, y,
    [['Year','Total Amount','Total Discount','Net Payable','Billing Cycles']],
    rows.map(r=>[
      r.year,
      _P.cur(r.total_amount||0),
      _P.cur(r.total_discount||0),
      _P.cur(r.net_payable||0),
      r.cycle_count||0,
    ]),
    { 1:{halign:'right'}, 2:{halign:'right'}, 3:{halign:'right',fontStyle:'bold'}, 4:{halign:'center'} }
  );
  _P.save(doc, `CC_Yearly_${cardLabel}`);
}

async function downloadPlannerPdf() {
  const month = _plannerMonth; // YYYY-MM
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const isPreview = month > currentMonth;
  const data = await api(isPreview ? `/api/planner/preview?month=${month}` : `/api/planner/monthly?month=${month}`);
  if (!data) return;

  const payments = isPreview ? (data.projectedDefaults || []) : (data.payments || []);
  const ccDues = isPreview ? (data.projectedCcDues || []) : (data.ccDues || []);
  const emiDues = isPreview
    ? (data.emiDues || []).filter(i => (i.paid_amount || 0) < (i.emi_amount || 0) * 0.999)
    : (data.emiDues || []);
  const [y4, m2] = month.split('-');
  const label = `${_P.MONTHS[parseInt(m2) - 1]} ${y4}`;

  const payDue = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const payPaid = isPreview ? 0 : payments.reduce((s, p) => s + (p.paid_amount || 0), 0);
  const ccDue = ccDues.reduce((s, c) => s + (c.net_payable || 0), 0);
  const ccPaid = isPreview ? 0 : ccDues.filter(c => c.status === 'paid').reduce((s, c) => s + (c.paid_amount || 0), 0);
  const emiDueAmt = emiDues.reduce((s, i) => s + (isPreview ? ((i.emi_amount || 0) - (i.paid_amount || 0)) : (i.emi_amount || 0)), 0);
  const emiPaid = isPreview ? 0 : emiDues.filter(i => i.paid_amount > 0).reduce((s, i) => s + (i.paid_amount || 0), 0);
  const totalDue = payDue + ccDue + emiDueAmt;
  const totalPaid = payPaid + ccPaid + emiPaid;
  const totalItems = payments.length + ccDues.length + emiDues.length;

  const doc = _P.init();
  let y = _P.header(doc, `Monthly Planner - ${label}${isPreview ? ' (Preview)' : ''}`, `${totalItems} item${totalItems !== 1 ? 's' : ''}`);
  y = _P.cards(doc, y, [
    { label: isPreview ? 'Projected Due' : 'Total Due', value: _P.cur(totalDue), color: '' },
    { label: 'Total Paid', value: _P.cur(totalPaid), color: 'green' },
    { label: 'Remaining', value: _P.cur(totalDue - totalPaid), color: 'red' },
    { label: isPreview ? 'Projected' : 'Payments', value: payments.length, color: '' },
    { label: 'CC Bills', value: ccDues.length, color: '' },
    { label: 'EMI Dues', value: emiDues.length, color: '' },
  ]);

  if (payments.length) {
    y = _P.section(doc, y, isPreview ? 'Projected Payments' : 'Monthly Payments');
    y = _P.table(doc, y,
      [['Payment Name', 'Amount Due', 'Due Date', 'Paid Amount', 'Paid Date', 'Status', 'Notes']],
      payments.map(p => [
        p.name,
        _P.cur(p.amount),
        p.due_date ? _P.dt(p.due_date) : '-',
        !isPreview && p.paid_amount > 0 ? _P.cur(p.paid_amount) : '-',
        !isPreview && p.paid_date ? _P.dt(p.paid_date) : '-',
        isPreview ? 'projected' : (p.status || 'pending'),
        p.notes || '-',
      ]),
      { 1: { halign: 'right' }, 3: { halign: 'right', fontStyle: 'bold' }, 5: { halign: 'center' } }
    );
  }

  if (ccDues.length) {
    y = _P.section(doc, y, 'Credit Card Bills Due');
    y = _P.table(doc, y,
      [['Card', 'Cycle Period', 'Due Date', 'Net Payable', 'Paid', 'Status']],
      ccDues.map(c => [
        `${c.bank_name} ${c.card_name} ....${c.last4 || ''}`,
        `${_P.dt(c.cycle_start)} -> ${_P.dt(c.cycle_end)}`,
        c.due_date ? _P.dt(c.due_date) : '-',
        _P.cur(c.net_payable || 0),
        !isPreview && c.paid_amount > 0 ? _P.cur(c.paid_amount) : '-',
        isPreview ? (c.is_projected ? 'estimated' : (c.status || 'projected')) : (c.status || '-'),
      ]),
      { 3: { halign: 'right', fontStyle: 'bold' }, 4: { halign: 'right' }, 5: { halign: 'center' } }
    );
  }

  if (emiDues.length) {
    y = _P.section(doc, y, 'EMI Installments Due');
    _P.table(doc, y,
      [['EMI Name', 'Due Date', 'EMI Amount', 'Paid Amount', 'Status']],
      emiDues.map(i => {
        const paid = i.paid_amount >= (i.emi_amount || 0) * 0.999;
        const partial = i.paid_amount > 0 && !paid;
        return [
          i.emi_name || i.name || '-',
          i.due_date ? _P.dt(i.due_date) : '-',
          _P.cur(isPreview ? ((i.emi_amount || 0) - (i.paid_amount || 0)) : (i.emi_amount || 0)),
          !isPreview && i.paid_amount > 0 ? _P.cur(i.paid_amount) : '-',
          isPreview ? 'projected' : (paid ? 'Paid' : partial ? 'Partial' : 'Pending'),
        ];
      }),
      { 2: { halign: 'right', fontStyle: 'bold' }, 3: { halign: 'right' }, 4: { halign: 'center' } }
    );
  }

  _P.save(doc, `Planner_${label}`);
}

async function downloadTrackerMonthPdf(trackerId, trackerName, year, month) {
  const [entData, sumData] = await Promise.all([
    api(`/api/trackers/${trackerId}/entries?year=${year}&month=${month}`),
    api(`/api/trackers/${trackerId}/summary?year=${year}&month=${month}`)
  ]);
  const entries = entData?.entries || [];
  const summary = sumData?.summary || {};
  const label = `${_P.MONTHS[month-1]} ${year}`;

  const doc = _P.init();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = _P.header(doc, `Daily Tracker - ${summary.tracker_settings?.name || trackerName}`, label);
  doc.setFontSize(7.25);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(95, 107, 122);
  doc.text([
    `Days: ${summary.days || 0}`,
    `Qty: ${summary.total_qty || 0}`,
    `Amount: ${_P.cur(summary.total_amount || 0)}`,
    `Auto: ${summary.auto_days || 0}`,
    `Edited: ${summary.edited_days || 0}`,
  ].join('  |  '), 14, y);
  doc.setTextColor(0, 0, 0);
  doc.autoTable({
    startY: y + 4,
    head: [['Date', 'Day', 'Qty', 'Amount', 'Type']],
    body: entries.map((e) => ([
      _P.dt(e.entry_date),
      new Date(e.entry_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }),
      `${e.quantity} ${e.unit || ''}`.trim(),
      _P.cur(e.amount),
      e.is_auto ? 'Auto' : 'Edited',
    ])),
    theme: 'grid',
    headStyles: {
      fillColor: [20, 90, 60],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
      cellPadding: 1.5,
    },
    bodyStyles: {
      fontSize: 6.6,
      cellPadding: 1.15,
      minCellHeight: 4.7,
    },
    alternateRowStyles: { fillColor: [244, 245, 247] },
    margin: { left: 12, right: 12, bottom: 12 },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 42, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 24, halign: 'center' },
    },
    didDrawPage: (d) => {
      if (d.pageNumber > 1) {
        doc.setFillColor(20, 90, 60);
        doc.rect(0, 0, pageWidth, 7, 'F');
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        doc.text('EXPENSE LITE AI (cont.)', 14, 5);
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
      }
    }
  });
  _P.save(doc, `Tracker_${trackerName}_${label}`);
}

async function downloadTrackersOverviewPdf(year, month) {
  const label = `${_P.MONTHS[month-1]} ${year}`;
  const trData = await api('/api/trackers');
  if (!trData) return;
  const trackers = (trData.trackers||[]).filter(t=>t.is_active);

  const summaries = await Promise.all(
    trackers.map(t => api(`/api/trackers/${t.id}/summary?year=${year}&month=${month}`))
  );

  const doc = _P.init(true);
  let y = _P.header(doc, 'Daily Trackers Overview', `${label}  ·  ${trackers.length} trackers`);
  const totalAmt = summaries.reduce((s,d)=>s+(d?.summary?.total_amount||0),0);
  y = _P.cards(doc, y, [
    { label:'Active Trackers', value:trackers.length,   color:'' },
    { label:'Total Amount',    value:_P.cur(totalAmt), color:'' },
  ]);
  _P.table(doc, y,
    [['Tracker','Unit','Price/Unit','Default Qty','Days Tracked','Total Qty','Total Amount','Auto / Edited']],
    trackers.map((t,i)=>{
      const s = summaries[i]?.summary||{};
      return [
        t.name, t.unit||'unit', _P.cur(t.price_per_unit),
        t.default_qty, s.days||0, s.total_qty||0,
        _P.cur(s.total_amount||0),
        `${s.auto_days||0} / ${s.edited_days||0}`,
      ];
    }),
    { 2:{halign:'right'}, 3:{halign:'right'}, 4:{halign:'center'},
      5:{halign:'right'}, 6:{halign:'right',fontStyle:'bold'}, 7:{halign:'center'} },
    true
  );
  _P.save(doc, `Trackers_Overview_${label}`);
}

async function downloadFixedDepositsPdf() {
  const deposits = typeof fixedDepositFilteredRows === 'function' ? fixedDepositFilteredRows() : [];
  const subtitle = typeof fixedDepositFilterSummary === 'function'
    ? fixedDepositFilterSummary()
    : 'All People · All Statuses';
  const totals = deposits.reduce((acc, item) => {
    acc.deposit += Number(item.amount_deposited || 0);
    acc.maturity += Number(item.maturity_amount || 0);
    acc.interest += Number(item.interest_amount || 0);
    return acc;
  }, { deposit: 0, maturity: 0, interest: 0 });

  const doc = _P.init(true);
  let y = _P.header(doc, 'Fixed Deposits', subtitle);
  y = _P.cards(doc, y, [
    { label: 'FD Count', value: deposits.length, color: '' },
    { label: 'Deposited', value: _P.cur(totals.deposit), color: '' },
    { label: 'Matured', value: _P.cur(totals.maturity), color: 'green' },
    { label: 'Interest', value: _P.cur(totals.interest), color: '' },
  ]);
  _P.table(doc, y,
    [['Person', 'Bank', 'FD No.', 'Rate', 'Deposit', 'Maturity', 'Deposited', 'Matured', 'Interest', 'Status']],
    deposits.map((item) => [
      item.person_name || '-',
      item.bank_name || '-',
      item.fd_number || '-',
      `${Number(item.interest_rate || 0).toFixed(2)}%`,
      item.deposit_date || '-',
      item.maturity_date || '-',
      _P.cur(item.amount_deposited || 0),
      _P.cur(item.maturity_amount || 0),
      _P.cur(item.interest_amount || 0),
      String(item.status || 'ongoing').toUpperCase(),
    ]),
    {
      3: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'center' },
    },
    true
  );
  const fileParts = ['Fixed_Deposits'];
  if (typeof _fixedDepositPersonFilter !== 'undefined' && _fixedDepositPersonFilter && _fixedDepositPersonFilter !== 'all') fileParts.push(_fixedDepositPersonFilter);
  if (typeof _fixedDepositStatusFilter !== 'undefined' && _fixedDepositStatusFilter && _fixedDepositStatusFilter !== 'all') fileParts.push(_fixedDepositStatusFilter);
  if (typeof _fixedDepositExpiryMonthFilter !== 'undefined' && _fixedDepositExpiryMonthFilter) fileParts.push(`Expiry_${_fixedDepositExpiryMonthFilter}`);
  if (typeof _fixedDepositNumberSearch !== 'undefined' && _fixedDepositNumberSearch) fileParts.push(`FD_${_fixedDepositNumberSearch}`);
  _P.save(doc, fileParts.join('_').replace(/[^A-Za-z0-9_-]+/g, '_'));
}

async function downloadHabitTrackersOverviewPdf(year, month) {
  const label = `${_P.MONTHS[month - 1]} ${year}`;
  const data = await api(`/api/habit-trackers?year=${year}&month=${month}`);
  if (!data) return;
  const trackers = data.trackers || [];
  const activeTrackers = trackers.filter((item) => !!item.is_active);
  const totalDaysAtOne = trackers.reduce((sum, item) => sum + Number(item.month_one_days || 0), 0);
  const totalTrackedDays = trackers.reduce((sum, item) => sum + Number(item.month_total_days || 0), 0);

  const doc = _P.init(true);
  let y = _P.header(doc, 'Habit Tracker Overview', `${label} · ${trackers.length} habit${trackers.length !== 1 ? 's' : ''}`);
  y = _P.cards(doc, y, [
    { label: 'Total Habits', value: trackers.length, color: '' },
    { label: 'Active Habits', value: activeTrackers.length, color: 'green' },
    { label: 'Days At 1', value: totalDaysAtOne, color: '' },
    { label: 'Tracked Days', value: totalTrackedDays, color: '' },
  ]);
  _P.table(doc, y,
    [['Habit', 'Status', 'Default Value', 'Days At 1', 'Month Days', 'Progress']],
    trackers.map((item) => [
      item.name || 'Habit',
      item.is_active ? 'Active' : 'Paused',
      Number(item.default_value || 0),
      Number(item.month_one_days || 0),
      Number(item.month_total_days || 0),
      `${Number(item.month_percent || 0).toFixed(2)}%`,
    ]),
    {
      2: { halign: 'center', cellWidth: 28 },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 28 },
      5: { halign: 'right', fontStyle: 'bold', cellWidth: 28 },
    },
    true
  );
  _P.save(doc, `Habit_Tracker_Overview_${label}`);
}

async function downloadHabitTrackerDetailPdf(trackerId, trackerName, year, month) {
  const [trackersRes, entriesRes, summaryRes, yearRes] = await Promise.all([
    api(`/api/habit-trackers?year=${year}&month=${month}`),
    api(`/api/habit-trackers/${trackerId}/entries?year=${year}&month=${month}`),
    api(`/api/habit-trackers/${trackerId}/summary?year=${year}&month=${month}`),
    api(`/api/habit-trackers/${trackerId}/year-summary?year=${year}`),
  ]);
  const tracker = (trackersRes?.trackers || []).find((item) => String(item.id) === String(trackerId)) || {};
  const entries = entriesRes?.entries || [];
  const summary = summaryRes?.summary || {};
  const yearSummary = yearRes?.summary || {};
  const label = `${_P.MONTHS[month - 1]} ${year}`;
  const entryMap = {};
  entries.forEach((entry) => { entryMap[String(entry.entry_date || '').slice(0, 10)] = entry; });
  const daysInMonth = new Date(year, month, 0).getDate();

  const doc = _P.init();
  let y = _P.header(doc, `Habit Tracker - ${trackerName || tracker.name || 'Habit'}`, label);
  y = _P.note(doc, y, `Default daily value: ${Number(tracker.default_value || 0)} · ${tracker.notes || 'No notes'}`);
  y = _P.cards(doc, y, [
    { label: 'Month Days At 1', value: Number(summary.one_days || 0), color: '' },
    { label: 'Month Progress', value: `${Number(summary.percent || 0).toFixed(2)}%`, color: 'green' },
    { label: 'Year Days At 1', value: Number(yearSummary.one_days || 0), color: '' },
    { label: 'Year Progress', value: `${Number(yearSummary.percent || 0).toFixed(2)}%`, color: 'green' },
  ]);
  _P.table(doc, y,
    [['Date', 'Day', 'Value', 'Status']],
    Array.from({ length: daysInMonth }, (_, index) => {
      const rawDate = `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`;
      const entry = entryMap[rawDate] || { entry_value: Number(tracker.default_value || 0), is_auto: true };
      return [
        _P.dt(rawDate),
        new Date(`${rawDate}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }),
        Number(entry.entry_value || 0) ? 1 : 0,
        entry.is_auto ? 'Default' : 'Edited',
      ];
    }),
    {
      1: { halign: 'center', cellWidth: 28 },
      2: { halign: 'center', cellWidth: 24, fontStyle: 'bold' },
      3: { halign: 'center', cellWidth: 32 },
    }
  );
  _P.save(doc, `Habit_${trackerName || tracker.name || 'Tracker'}_${label}`);
}

async function downloadFriendsPdf() {
  const data = await api('/api/friends');
  if (!data) return;
  const friends = data.friends || [];
  const netBalance = Number(data.netBalance || 0);
  const owedToMe = friends.filter((friend) => Number(friend.balance || 0) > 0).reduce((sum, friend) => sum + Number(friend.balance || 0), 0);
  const iOwe = friends.filter((friend) => Number(friend.balance || 0) < 0).reduce((sum, friend) => sum + Math.abs(Number(friend.balance || 0)), 0);
  await renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: 'Friends & Loans Overview',
      subtitle: `${friends.length} friend${friends.length !== 1 ? 's' : ''}`,
      breadcrumb: `Friends / ${new Date().toLocaleDateString('en-IN')}`,
      totals: {
        total: _P.cur(netBalance),
        fair: _P.cur(owedToMe),
        extra: _P.cur(iOwe),
        count: `${friends.length} friends`,
      },
      tables: [
        {
          title: 'Friends',
          columns: ['Friend', 'Balance', 'Status'],
          rows: friends.map((friend) => [
            friend.name || '-',
            _P.cur(friend.balance || 0),
            Number(friend.balance || 0) > 0.005 ? 'They owe me' : Number(friend.balance || 0) < -0.005 ? 'I owe' : 'Settled',
          ]),
        },
      ],
    },
  }, 'Friends Overview', 'friends-overview');
}

function downloadFriendDetailPdf() {
  const friend = _loanFriend;
  if (!friend) return;
  const normalizeLoanPdfDate = (value) => {
    if (typeof normalizeTxnDateValue === 'function') return normalizeTxnDateValue(value);
    if (typeof dateOnlyFromValue === 'function') {
      const normalized = dateOnlyFromValue(value);
      if (normalized) return normalized;
    }
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    return raw.length >= 10 ? raw.slice(0, 10) : raw;
  };
  const allTxns = (_loanAllTxns || []).map((txn) => ({
    ...txn,
    txn_date: normalizeLoanPdfDate(txn?.txn_date),
  }));
  const { balance = 0 } = _loanBalance || {};
  let txns = [...allTxns];
  if (loanFilters.year) txns = txns.filter((txn) => txn.txn_date?.startsWith(loanFilters.year));
  if (loanFilters.month) txns = txns.filter((txn) => txn.txn_date?.substring(5, 7) === String(loanFilters.month).padStart(2, '0'));
  if (loanFilters.date) txns = txns.filter((txn) => txn.txn_date === loanFilters.date);
  if (loanFilters.search) {
    const query = loanFilters.search.toLowerCase();
    txns = txns.filter((txn) => String(txn.details || '').toLowerCase().includes(query));
  }
  if (loanFilters.type === 'paid') txns = txns.filter((txn) => Number(txn.paid || 0) > 0);
  if (loanFilters.type === 'received') txns = txns.filter((txn) => Number(txn.received || 0) > 0);
  txns.sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1));
  const filterLabel = [
    loanFilters.year ? `Year: ${loanFilters.year}` : '',
    loanFilters.month ? `Month: ${loanFilters.month}` : '',
    loanFilters.search ? `Search: "${loanFilters.search}"` : '',
    loanFilters.type ? `Type: ${loanFilters.type}` : '',
  ].filter(Boolean).join(' • ') || 'All transactions';
  const paidTotal = txns.reduce((sum, txn) => sum + Number(txn.paid || 0), 0);
  const receivedTotal = txns.reduce((sum, txn) => sum + Number(txn.received || 0), 0);
  const chronological = [...txns].reverse();
  let running = 0;
  const runMap = {};
  chronological.forEach((txn) => {
    running += Number(txn.paid || 0) - Number(txn.received || 0);
    runMap[txn.id] = running;
  });
  void renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: `${friend.name || 'Friend'} Transactions`,
      subtitle: filterLabel,
      breadcrumb: 'Friends / Detail',
      totals: {
        total: _P.cur(Math.abs(Number(balance || 0))),
        fair: _P.cur(paidTotal),
        extra: _P.cur(receivedTotal),
        count: `${txns.length} transactions`,
      },
      sections: [
        {
          title: 'Summary',
          lines: [
            Number(balance || 0) > 0.005 ? 'Status: To receive' : Number(balance || 0) < -0.005 ? 'Status: To pay' : 'Status: Settled',
          ],
        },
      ],
      tables: [
        {
          title: 'Transactions',
          columns: ['Date', 'Details', 'Paid / Given', 'Received', 'Running Net'],
          rows: txns.map((txn) => [
            _P.dt(txn.txn_date),
            txn.details || '-',
            Number(txn.paid || 0) > 0 ? _P.cur(txn.paid) : '-',
            Number(txn.received || 0) > 0 ? _P.cur(txn.received) : '-',
            _P.cur(runMap[txn.id] || 0),
          ]),
        },
      ],
    },
  }, `${friend.name || 'Friend'} Transactions`, `transactions-${String(friend.name || 'friend').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
}

function downloadSplitHistoryPdf() {
  const groups = _divGroups || [];
  const total = groups.reduce((sum, group) => sum + Number(group.total_amount || 0), 0);
  void renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: 'Split History',
      subtitle: `${groups.length} split${groups.length !== 1 ? 's' : ''}`,
      breadcrumb: `Split / ${new Date().toLocaleDateString('en-IN')}`,
      totals: {
        total: _P.cur(total),
        fair: `${groups.length} entries`,
        extra: '-',
        count: `${groups.length} rows`,
      },
      tables: [
        {
          title: 'Splits',
          columns: ['Date', 'Heading', 'Details', 'Paid By', 'Total Amount', 'Split Details'],
          rows: groups.map((group) => [
            _P.dt(group.divide_date),
            group.heading || '-',
            group.details || '-',
            group.paid_by || '-',
            _P.cur(group.total_amount || 0),
            (group.splits || []).map((split) => `${split.friend_name}: ${_P.cur(split.share_amount)}`).join(' | ') || '-',
          ]),
        },
      ],
    },
  }, 'Split History', 'split-history');
}

function downloadSplitSessionPdf(sessionKey) {
  const groups = (_divGroups || []).filter((group) => (group.session_id || `_solo_${group.id}`) === sessionKey);
  if (!groups.length) return;
  const session = groups[0];
  const title = session.heading || session.details || 'Split';
  const sessionTotal = groups.reduce((sum, group) => sum + Number(group.total_amount || 0), 0);
  const tables = groups.map((group, index) => {
    const splits = group.splits || [];
    const friendsTotal = splits.reduce((sum, split) => sum + Number(split.share_amount || 0), 0);
    const myShare = Math.round((Number(group.total_amount || 0) - friendsTotal) * 100) / 100;
    const paidByYou = group.paid_by === 'You';
    const participants = [...splits.map((split) => ({ name: split.friend_name, share: split.share_amount, isMe: false }))];
    if (myShare > 0.005) participants.unshift({ name: 'You (me)', share: myShare, isMe: true });
    return {
      title: groups.length > 1
        ? `${index + 1}. ${group.details || '-'} - ${group.paid_by || '-'} - ${_P.cur(group.total_amount || 0)}`
        : 'Settlement',
      columns: ['Person', 'Share', 'Paid Upfront', 'Owes / Gets Back'],
      rows: participants.map((person) => {
        const isPayer = (person.isMe && paidByYou) || (!person.isMe && group.paid_by === person.name);
        const paidUp = isPayer ? Number(group.total_amount || 0) : 0;
        const net = Number(person.share || 0) - paidUp;
        const netLabel = Math.abs(net) < 0.005 ? 'Settled' : net > 0 ? `Owes ${_P.cur(net)}` : `Gets back ${_P.cur(Math.abs(net))}`;
        return [
          person.name + (person.isMe ? ' (me)' : ''),
          _P.cur(person.share || 0),
          isPayer ? _P.cur(paidUp) : '-',
          netLabel,
        ];
      }),
    };
  });
  void renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title,
      subtitle: _P.dt(session.divide_date),
      breadcrumb: `Split / ${groups.length} item${groups.length !== 1 ? 's' : ''}`,
      totals: {
        total: _P.cur(sessionTotal),
        fair: `${groups.length} items`,
        extra: '-',
        count: `${tables.reduce((sum, table) => sum + table.rows.length, 0)} participants`,
      },
      tables,
    },
  }, `${title} Split`, `split-${String(title).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
}

function downloadEmisPdf(records) {
  const emis = records || _emiRecords || [];
  const active = emis.filter((record) => record.status === 'active').length;
  const totalPaid = emis.reduce((sum, record) => sum + Number(record.totalPaid || 0), 0);
  const totalRemaining = emis.reduce((sum, record) => sum + Number(record.remaining || record.grand_total || 0), 0);
  void renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: 'EMI Records Overview',
      subtitle: `${emis.length} records`,
      breadcrumb: `EMI / ${new Date().toLocaleDateString('en-IN')}`,
      totals: {
        total: _P.cur(totalPaid),
        fair: `${active} active`,
        extra: _P.cur(totalRemaining),
        count: `${emis.length} EMIs`,
      },
      tables: [
        {
          title: 'EMIs',
          columns: ['Name', 'Tag', 'Principal', 'Rate %', 'Months', 'Monthly EMI', 'Grand Total', 'Paid', 'Remaining', 'Status'],
          rows: emis.map((record) => [
            record.name || '-',
            record.tag || '-',
            _P.cur(record.principal || 0),
            `${record.annual_rate}%`,
            `${record.tenure_months}m`,
            _P.cur(record.monthly_emi || 0),
            _P.cur(record.grand_total || 0),
            _P.cur(record.totalPaid || 0),
            _P.cur(record.remaining != null ? record.remaining : record.grand_total || 0),
            record.status || 'saved',
          ]),
        },
      ],
    },
  }, 'EMI Overview', 'emi-overview');
}

async function downloadEmiDetailPdf(emiId) {
  const data = await api(`/api/emi/records/${emiId}`);
  if (!data?.record) return;
  const record = data.record;
  const installments = Array.isArray(record.installments) ? record.installments : [];
  await renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: record.name || 'EMI',
      subtitle: `${record.annual_rate}% p.a. • ${record.tenure_months} months`,
      breadcrumb: `EMI / Start: ${record.start_date || 'Not started'}`,
      totals: {
        total: _P.cur(record.principal || 0),
        fair: _P.cur(record.totalPaid || 0),
        extra: _P.cur(record.remaining != null ? record.remaining : record.grand_total || 0),
        count: `${installments.length} installments`,
      },
      sections: [
        {
          title: 'Summary',
          lines: [
            record.tag ? `Tag: ${record.tag}` : null,
            record.description ? `Note: ${record.description}` : null,
            `Status: ${record.status || 'saved'}`,
            installments.length ? `${record.paidCount || 0} / ${installments.length} installments paid` : 'No installment schedule generated yet.',
          ].filter(Boolean),
        },
      ],
      tables: installments.length ? [
        {
          title: 'Installments',
          columns: ['#', 'Due Date', 'EMI Amount', 'Principal', 'Interest', 'GST', 'Paid Amount', 'Paid Date', 'Status'],
          rows: installments.map((installment) => {
            const paid = Number(installment.paid_amount || 0) >= Number(installment.emi_amount || 0) * 0.999;
            const partial = Number(installment.paid_amount || 0) > 0 && !paid;
            return [
              String(installment.installment_no || ''),
              _P.dt(installment.due_date),
              _P.cur(installment.emi_amount || 0),
              Number(installment.principal_component || 0) > 0 ? _P.cur(installment.principal_component) : '-',
              Number(installment.interest_component || 0) > 0 ? _P.cur(installment.interest_component) : '-',
              Number(installment.gst_amount || 0) > 0 ? _P.cur(installment.gst_amount) : '-',
              Number(installment.paid_amount || 0) > 0 ? _P.cur(installment.paid_amount) : '-',
              installment.paid_date ? _P.dt(installment.paid_date) : '-',
              paid ? 'Paid' : partial ? 'Partial' : 'Pending',
            ];
          }),
        },
      ] : [],
    },
  }, `${record.name || 'EMI'} PDF`, `emi-${String(record.name || 'record').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
}

function downloadTripsPdf(tripsArr) {
  const trips = tripsArr || _trips || [];
  const filterParts = [];
  if (typeof tripsFilters === 'object' && tripsFilters) {
    if (tripsFilters.search) filterParts.push(`Search: "${tripsFilters.search}"`);
    if (tripsFilters.status && tripsFilters.status !== 'all') filterParts.push(`Status: ${tripsFilters.status}`);
    if (tripsFilters.category && tripsFilters.category !== 'all') filterParts.push(`Category: ${tripsFilters.category}`);
    if (tripsFilters.transport && tripsFilters.transport !== 'all') filterParts.push(`Transport: ${tripsFilters.transport}`);
    if (tripsFilters.member && tripsFilters.member !== 'all') filterParts.push(`Member share: ${tripsFilters.member}`);
  }
  const total = trips.reduce((sum, trip) => sum + (Number(trip.total_expenditure ?? trip.totalExpenses ?? 0) || 0), 0);
  const active = trips.filter((trip) => ['pending', 'upcoming', 'ongoing'].includes(String(trip.status || '').toLowerCase())).length;
  const completed = trips.filter((trip) => String(trip.status || '').toLowerCase() === 'completed').length;
  void renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: 'Trips Overview',
      subtitle: `${trips.length} trip${trips.length !== 1 ? 's' : ''}`,
      breadcrumb: `Trips / ${filterParts.join(' • ') || new Date().toLocaleDateString('en-IN')}`,
      totals: {
        total: _P.cur(total),
        fair: `${active} active`,
        extra: `${completed} completed`,
        count: `${trips.length} trips`,
      },
      tables: [
        {
          title: 'Trips',
          columns: ['Trip Name', 'Status', 'Dates', 'Members', 'Expenses', 'Shown Amount'],
          rows: trips.map((trip) => [
            `${trip.destination || trip.name || '-'}${trip.is_owner === 0 ? ' (Shared)' : ''}`,
            String(trip.status || 'upcoming').replace(/\b\w/g, (m) => m.toUpperCase()),
            `${_P.dt(trip.start_date)}${trip.end_date ? ` - ${_P.dt(trip.end_date)}` : ''}${tripStartsInPdfLabel(trip.start_date) ? ` (${tripStartsInPdfLabel(trip.start_date)})` : ''}`,
            (trip.members || []).map((member) => member.member_name).join(', ') || '-',
            String(trip.expense_count ?? trip.expenseCount ?? 0),
            _P.cur(Number(trip.total_expenditure ?? trip.totalExpenses ?? 0) || 0),
          ]),
        },
      ],
    },
  }, 'Trips Overview', 'trips-overview');
}

function downloadTripDetailPdfEnhanced() {
  const trip = _tripDetail;
  if (!trip) return;
  const startsIn = tripStartsInPdfLabel(trip.start_date);
  const expenses = Array.isArray(trip.expenses) ? trip.expenses : [];
  const members = Array.isArray(trip.members) ? trip.members : [];
  const itineraryItems = Array.isArray(trip.itinerary_items) ? trip.itinerary_items : [];
  const sharedUsers = Array.isArray(trip.shared_users) ? trip.shared_users : [];
  const expenseGroups = Array.isArray(trip.expense_groups) ? trip.expense_groups : [];
  const spendingExpenses = expenses.filter((expense) => String(expense?.split_mode || '').trim().toLowerCase() !== 'settlement');
  const sortedSpendingExpenses = spendingExpenses.slice().sort((a, b) => {
    const aDate = typeof normalizeInputDate === 'function'
      ? normalizeInputDate(a?.expense_date || '')
      : String(a?.expense_date || '').slice(0, 10);
    const bDate = typeof normalizeInputDate === 'function'
      ? normalizeInputDate(b?.expense_date || '')
      : String(b?.expense_date || '').slice(0, 10);
    if (aDate !== bDate) return String(aDate || '').localeCompare(String(bDate || ''));
    const aTime = String(a?.created_at || '');
    const bTime = String(b?.created_at || '');
    return aTime.localeCompare(bTime);
  });
  const grandTotal = spendingExpenses.reduce((sum, expense) => sum + Number(expense?.amount || 0), 0);

  if (itineraryItems.length) {
  }

  const settlementRows = (() => {
    const nameKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const memberStableKey = (member) => String(member?.id ?? (typeof _memberKey === 'function' ? _memberKey(member) : '') ?? '');
    const rows = members.map((member) => ({
      key: memberStableKey(member),
      fallbackKey: String(typeof _memberKey === 'function' ? _memberKey(member) : member?.member_key || ''),
      name: member.member_name,
      share: 0,
      gave: 0,
    }));
    const rowByUiKey = new Map(rows.map((row) => [String(row.key), row]));
    const rowByFallbackKey = new Map(rows.map((row) => [String(row.fallbackKey), row]));
    const rowByName = new Map(rows.map((row) => [nameKey(row.name), row]));
    expenses.forEach((expense) => {
      const settlementMode = String(expense?.split_mode || '').trim().toLowerCase() === 'settlement';
      (expense.splits || []).forEach((split) => {
        const target = rowByUiKey.get(String(split?.member_key || ''))
          || rowByFallbackKey.get(String(split?.member_key || ''))
          || rowByName.get(nameKey(split?.member_name || ''));
        if (!target || settlementMode) return;
        target.share += Number(split?.share_amount || 0);
      });
      const payer = rowByUiKey.get(String(expense?.paid_by_key || ''))
        || rowByFallbackKey.get(String(expense?.paid_by_key || ''))
        || rowByName.get(nameKey(expense?.paid_by_name || ''));
      if (payer) payer.gave += Number(expense?.amount || 0);
    });
    return rows.map((row) => ({
      ...row,
      share: Math.round(Number(row.share || 0) * 100) / 100,
      gave: Math.round(Number(row.gave || 0) * 100) / 100,
      net: Math.round((Number(row.gave || 0) - Number(row.share || 0)) * 100) / 100,
    }));
  })();

  void renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: trip.destination || trip.name || 'Trip',
      subtitle: `${_P.dt(trip.start_date)}${trip.end_date ? ` - ${_P.dt(trip.end_date)}` : ''}`,
      breadcrumb: `${String(trip.status || 'upcoming').replace(/\b\w/g, (m) => m.toUpperCase())} • ${startsIn || 'Trip details'}`,
      totals: {
        total: _P.cur(grandTotal),
        fair: `${members.length} members`,
        extra: `${sortedSpendingExpenses.length} expenses`,
        count: `${itineraryItems.length} itinerary items`,
      },
      sections: [
        {
          title: 'Members',
          lines: [
            members.map((member) => member.member_name).join(', ') || 'No members',
            trip.notes ? `Notes: ${trip.notes}` : null,
            trip.transport_mode ? `Transport: ${trip.transport_mode}` : null,
            trip.total_distance != null && trip.total_distance !== '' ? `Distance: ${trip.total_distance} km` : null,
            sharedUsers.length ? `Shared With: ${sharedUsers.map((user) => `${user.display_name || user.member_name || 'User'} (${user.permission === 'edit' ? 'edit' : 'view'})`).join(', ')}` : null,
          ].filter(Boolean),
        },
        settlementRows.length ? {
          title: 'Member Shares',
          lines: settlementRows.map((row) => `${row.name}${row.fallbackKey === 'self' ? ' (You)' : ''}: Share ${_P.cur(row.share)} • Paid ${_P.cur(row.gave)} • Net ${(row.net > 0.005 ? '+' : '') + _P.cur(row.net)}`),
        } : null,
      ].filter(Boolean),
      tables: [
        itineraryItems.length ? {
          title: 'Itinerary',
          columns: ['Date', 'Time', 'Title', 'Location', 'Notes'],
          rows: itineraryItems
            .slice()
            .sort((a, b) => `${String(a?.itinerary_date || '')} ${String(a?.start_time || '99:99')}`.localeCompare(`${String(b?.itinerary_date || '')} ${String(b?.start_time || '99:99')}`))
            .map((item) => [_P.dt(item.itinerary_date), tripItineraryTimeLabel(item), item.title || '-', item.location || '-', item.notes || '-']),
        } : null,
        expenseGroups.length ? {
          title: 'Expense Breakdown',
          columns: ['Type', 'Items', 'Subtotal'],
          rows: expenseGroups.map((group) => [group.type || '-', String(Number((group.items || []).length || 0)), _P.cur(Number(group.total || 0))]),
        } : null,
        {
          title: 'Expenses',
          columns: ['Date', 'Type', 'Details', 'Paid By', 'Amount', 'Split Mode', 'Split Details', 'Notes'],
          rows: sortedSpendingExpenses.map((expense) => [
            _P.dt(expense.expense_date),
            expense.expense_type || '-',
            expense.details || '-',
            expense.paid_by_name || '-',
            _P.cur(expense.amount),
            expense.split_mode || 'equal',
            (expense.splits || []).map((split) => `${split.member_name}: ${_P.cur(split.share_amount)}`).join(' | ') || '-',
            expense.notes || '-',
          ]),
        },
        settlementRows.length ? {
          title: 'Settlement Summary',
          columns: ['Member', 'Total Share (Owes)', 'Total Paid', 'Net Balance'],
          rows: settlementRows.map((row) => [
            row.name + (row.fallbackKey === 'self' ? ' (You)' : ''),
            _P.cur(row.share),
            _P.cur(row.gave),
            (row.net > 0.005 ? '+' : '') + _P.cur(row.net),
          ]),
        } : null,
      ].filter(Boolean),
    },
  }, `${trip.destination || trip.name || 'Trip'} PDF`, `trip-${String(trip.destination || trip.name || 'trip').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
}

function tripStartsInPdfLabel(startDate) {
  const raw = String(startDate || '').trim();
  if (!raw) return '';
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const normalized = raw.slice(0, 10);
  const start = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  const diff = Math.round((start.getTime() - current.getTime()) / 86400000);
  if (diff < 0) return '';
  const inclusiveDays = diff + 1;
  if (inclusiveDays <= 0) return '';
  return inclusiveDays === 1 ? 'Starts in 1 day' : `Starts in ${inclusiveDays} days`;
}

function tripItineraryTimeLabel(item) {
  const start = String(item?.start_time || '').trim();
  const end = String(item?.end_time || '').trim();
  if (start && end) return `${start} - ${end}`;
  return start || end || 'Any time';
}

  const fmtDate = _P.dt;
  const escHtml = value => String(value ?? '');
  const { _bankHistoryState = {}, _rptYearsData = [], _rptMonthsData = [], _rptExpData = [], rptYearSort = {field:'year',dir:'desc'}, rptMonthSort = {field:'month',dir:'desc'}, rptExpSort = {field:'date',dir:'desc'}, reportDrillYear, reportDrillMonth, _tenantOverview = {} } = data;
  const _bankHistoryFilteredRows = () => data.bankRows || [];
  const tenantFindBuilding = () => data.building;
  const getTenantReportSnapshot = () => data.snapshot || {};
  const getTenantMonthInvoices = () => data.monthInvoices || [];
  const tenantNum = value => Number(value) || 0;
async function downloadBankHistoryPdf() {
  const bank = _bankHistoryState.bank || null;
  const rows = _bankHistoryFilteredRows();
  if (!bank || !rows.length) {
    toast('No bank history rows to export', 'warning');
    return;
  }
  const credits = rows.reduce((sum, row) => sum + (String(row.direction || '').toLowerCase() === 'credit' ? Number(row.amount || 0) : 0), 0);
  const debits = rows.reduce((sum, row) => sum + (String(row.direction || '').toLowerCase() === 'debit' ? Number(row.amount || 0) : 0), 0);
  const title = `${bank.bank_name}${bank.account_name ? ` - ${bank.account_name}` : ''} Bank History`;
  const rangeLabel = [_bankHistoryState.from || '', _bankHistoryState.to || ''].filter(Boolean).join(' to ') || 'All dates';
  const subtitle = `Filter: ${(_bankHistoryState.filter || 'all').toUpperCase()} · ${rangeLabel} · ${rows.length} entries`;

  await renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title,
      subtitle,
      breadcrumb: 'Banks / History',
      totals: {
        total: String(rows.length),
        fair: fmtCur(credits),
        extra: fmtCur(debits),
        count: fmtCur(Number(bank.balance || 0)),
      },
      tables: [
        {
          title: 'History',
          columns: ['When', 'Type', 'Note', 'Amount', 'Balance After'],
          rows: rows.map((entry) => {
            const isCredit = String(entry.direction || '').toLowerCase() === 'credit';
            const note = [
              entry.note || '',
              entry.related_bank_name
                ? `Other bank: ${entry.related_bank_name}${entry.related_account_name ? ` - ${entry.related_account_name}` : ''}`
                : '',
            ].filter(Boolean).join(' | ');
            return [
              _bankHistoryTimeLabel(entry.created_at),
              _bankHistoryTypeLabel(entry),
              note || '-',
              `${isCredit ? '+' : '-'}${fmtCur(entry.amount || 0)}`,
              fmtCur(entry.balance_after || 0),
            ];
          }),
        },
      ],
    },
  }, title, `${(bank.bank_name || 'bank').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-history`);
}

async function printReport(level) {
  const mNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

  let title = '';
  let subtitle = '';
  let breadcrumb = 'Reports';
  let totals = null;
  let tables = [];

  if (level === 'years') {
    const rows = rptSortArr(_rptYearsData, rptYearSort.field, rptYearSort.dir);
    const grandTotal = rows.reduce((sum, row) => sum + row.total, 0);
    const grandFair = rows.reduce((sum, row) => sum + row.fair, 0);
    const grandExtra = rows.reduce((sum, row) => sum + row.extra, 0);
    const grandCount = rows.reduce((sum, row) => sum + row.count, 0);
    title = 'Expense Report - All Years';
    subtitle = `Generated on ${now}`;
    totals = {
      total: fmtCur(grandTotal),
      fair: fmtCur(grandFair),
      extra: fmtCur(grandExtra),
      count: String(grandCount),
    };
    tables = [{
      title: 'Yearly Breakdown',
      columns: ['Year', 'Total', 'Fair', 'Extra', 'Items'],
      rows: [
        ...rows.map((row) => [String(row.year), fmtCur(row.total), fmtCur(row.fair), fmtCur(row.extra), String(row.count)]),
        ['Grand Total', fmtCur(grandTotal), fmtCur(grandFair), fmtCur(grandExtra), String(grandCount)],
      ],
    }];
  } else if (level === 'months') {
    const year = reportDrillYear;
    const rows = rptSortArr(_rptMonthsData.map((row) => ({ ...row, month: parseInt(row.month) })), rptMonthSort.field, rptMonthSort.dir);
    const yearTotal = rows.reduce((sum, row) => sum + row.total, 0);
    const yearFair = rows.reduce((sum, row) => sum + row.fair, 0);
    const yearExtra = rows.reduce((sum, row) => sum + row.extra, 0);
    const yearCount = rows.reduce((sum, row) => sum + row.count, 0);
    title = `Expense Report - ${year}`;
    subtitle = `Monthly breakdown · Generated on ${now}`;
    breadcrumb = `Reports / ${year}`;
    totals = {
      total: fmtCur(yearTotal),
      fair: fmtCur(yearFair),
      extra: fmtCur(yearExtra),
      count: String(yearCount),
    };
    tables = [{
      title: 'Monthly Breakdown',
      columns: ['Month', 'Total', 'Fair', 'Extra', 'Items'],
      rows: [
        ...rows.map((row) => [mNames[row.month - 1], fmtCur(row.total), fmtCur(row.fair), fmtCur(row.extra), String(row.count)]),
        ['Year Total', fmtCur(yearTotal), fmtCur(yearFair), fmtCur(yearExtra), String(yearCount)],
      ],
    }];
  } else if (level === 'expenses') {
    const year = reportDrillYear;
    const month = reportDrillMonth;
    const monthName = mNames[month - 1];
    const list = rptSortArr(
      _rptExpData.map((entry) => ({ ...entry, date: entry.purchase_date, name: entry.item_name })),
      rptExpSort.field === 'date' ? 'date' : rptExpSort.field === 'amount' ? 'amount' : rptExpSort.field === 'name' ? 'name' : 'is_extra',
      rptExpSort.dir
    );
    const total = list.reduce((sum, entry) => sum + entry.amount, 0);
    const fair = list.filter((entry) => !entry.is_extra).reduce((sum, entry) => sum + entry.amount, 0);
    const extra = list.filter((entry) => entry.is_extra).reduce((sum, entry) => sum + entry.amount, 0);
    title = `Expense Report - ${monthName} ${year}`;
    subtitle = `${list.length} expenses · Generated on ${now}`;
    breadcrumb = `Reports / ${year} / ${monthName}`;
    totals = {
      total: fmtCur(total),
      fair: fmtCur(fair),
      extra: fmtCur(extra),
      count: String(list.length),
    };
    tables = [{
      title: 'Expenses',
      columns: ['#', 'Date', 'Description', 'Amount', 'Type'],
      rows: [
        ...list.map((entry, index) => [String(index + 1), fmtDate(entry.purchase_date), entry.item_name || '-', fmtCur(entry.amount), entry.is_extra ? 'Extra' : 'Fair']),
        ['', '', 'Total', fmtCur(total), ''],
      ],
    }];
  } else {
    toast('Unknown report PDF view', 'warning');
    return;
  }

  await renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title,
      subtitle,
      breadcrumb,
      totals,
      tables,
    },
  }, title, title.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
}

function _bankHistoryTimeLabel(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return escHtml(String(value));
  return escHtml(dt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }));
}

function _bankHistoryTypeLabel(entry = {}) {
  const type = String(entry.entry_type || '').trim();
  const labels = {
    opening_balance: 'Opening balance',
    balance_set: 'Balance edited',
    fund_added: 'Money added',
    fund_removed: 'Money removed',
    transfer_in: 'Transfer received',
    transfer_out: 'Transfer sent',
    bank_credit: 'Bank credit',
    bank_debit: 'Bank debit',
  };
  return labels[type] || (type ? type.replace(/_/g, ' ') : 'Balance change');
}

function rptSortArr(arr, field, dir) {
  return [...arr].sort((a, b) => {
    let va = a[field], vb = b[field];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    return dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });
}

function downloadTenantInvoicePdf(invoiceId) {
  const invoice = (_tenantOverview?.invoices || []).find((item) => String(item.id) === String(invoiceId));
  if (!invoice) { toast('Invoice not found.', 'error'); return; }
  renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: `${invoice.tenant_name_snapshot || 'Tenant'} Invoice`,
      subtitle: `${invoice.room_label_snapshot || 'Room'} · ${tenantMonthLabel(invoice.invoice_month)}`,
      breadcrumb: `${invoice.building_name_snapshot || 'Building'} · Invoice snapshot`,
      sections: [
        {
          title: 'Invoice Summary',
          rows: [
            { label: 'Rent', value: fmtCur(invoice.rent_amount_snapshot || 0) },
            { label: 'Electricity', value: tenantElectricityUsageText(invoice) },
            { label: 'Other Charges', value: fmtCur(invoice.other_charges_snapshot || 0) },
            ...(Array.isArray(invoice.other_charge_items) ? invoice.other_charge_items : []).map(item => ({
              label: item?.detail || 'Other charge', value: fmtCur(item?.amount || 0),
            })),
            { label: 'Status', value: String(invoice.payment_status || 'pending').replace(/_/g, ' ') },
            { label: 'Due Date', value: invoice.due_date ? tenantDateLabel(invoice.due_date) : '-' },
            { label: 'Total', value: fmtCur(invoice.total_amount || 0) },
          ],
        },
      ],
    },
  }, `Tenant_Invoice_${invoice.tenant_name_snapshot || 'Tenant'}_${tenantMonthLabel(invoice.invoice_month)}`, `tenant-invoice-${invoice.tenant_name_snapshot || 'tenant'}-${invoice.invoice_month || 'invoice'}`);
}

function downloadTenantReportPdf(buildingId = _selectedTenantBuildingId) {
  const building = tenantFindBuilding(buildingId);
  if (!building) { toast('Building not found.', 'error'); return; }
  const snapshot = getTenantReportSnapshot(building);
  renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: `${building.name || 'Building'} Report`,
      subtitle: `${snapshot.invoiceCount || 0} invoice snapshots`,
      breadcrumb: 'Tenant analytics',
      sections: [
        {
          title: 'Summary',
          rows: [
            { label: 'Selected Total', value: fmtCur(snapshot.totalAmount || 0) },
            { label: 'Paid', value: fmtCur((snapshot.filteredInvoices || []).reduce((sum, invoice) => sum + Number(invoice.paid_amount || 0), 0)) },
            { label: 'Rent Total', value: fmtCur(snapshot.totalRent || 0) },
            { label: 'Electricity', value: fmtCur(snapshot.totalElectricity || 0) },
            { label: 'Avg / Invoice', value: fmtCur(snapshot.avgInvoice || 0) },
            { label: 'Rows', value: String(snapshot.invoiceCount || 0) },
          ],
        },
      ],
      tables: [
        {
          title: 'Top Tenants',
          columns: ['Tenant', 'Total'],
          amountColumnIndex: 1,
          rows: (snapshot.tenantTotals || []).map((entry) => [
            entry.tenant?.tenant_name || 'No rows',
            fmtCur(entry.total || 0),
          ]),
        },
        {
          title: 'Room Totals',
          columns: ['Room', 'Total'],
          amountColumnIndex: 1,
          rows: (snapshot.roomTotals || []).map((entry) => [
            entry.room?.room_label || 'No rows',
            fmtCur(entry.total || 0),
          ]),
        },
        {
          title: 'Monthly Breakdown',
          columns: ['Month', 'Total'],
          amountColumnIndex: 1,
          rows: (snapshot.monthRows || []).map((row) => [
            tenantMonthLabel(row.monthKey),
            fmtCur(row.total || 0),
          ]),
        },
      ],
    },
  }, `Tenant_Report_${building.name || 'Building'}`, `tenant-report-${building.name || 'building'}`);
}

function downloadTenantMonthInvoicesPdf(buildingId = _selectedTenantBuildingId, monthKey = tenantCurrentMonthKey()) {
  const building = tenantFindBuilding(buildingId);
  if (!building) { toast('Building not found.', 'error'); return; }
  const monthInvoices = getTenantMonthInvoices(building, monthKey);
  if (!monthInvoices.length) { toast('No invoices found for this month.', 'warning'); return; }
  const totalAmount = tenantNum(monthInvoices.reduce((sum, invoice) => sum + tenantNum(invoice.total_amount || 0), 0));
  const totalPaid = tenantNum(monthInvoices.reduce((sum, invoice) => sum + tenantNum(invoice.paid_amount || 0), 0));
  renderSharedPdfFileWindow({
    template: 'structured',
    payload: {
      title: `${building.name || 'Building'} Invoices`,
      subtitle: tenantMonthLabel(monthKey),
      breadcrumb: `${monthInvoices.length} invoices · Total ${fmtCur(totalAmount)}`,
      totals: {
        total: fmtCur(totalAmount),
        fair: fmtCur(monthInvoices.reduce((sum, invoice) => sum + Number(invoice.electricity_amount || 0), 0)),
        extra: String(monthInvoices.length),
        count: String(monthInvoices.filter((invoice) => String(invoice.payment_status || 'pending') === 'paid').length),
      },
      tables: [
        {
          title: 'Month Invoices',
          columns: ['Tenant', 'Room', 'Electricity', 'Total', 'Status'],
          amountColumnIndex: 3,
          rows: monthInvoices.map((invoice) => [
            invoice.tenant_name_snapshot || 'Tenant',
            invoice.room_label_snapshot || 'Room',
            fmtCur(invoice.electricity_amount || 0),
            fmtCur(invoice.total_amount || 0),
            String(invoice.payment_status || 'pending').replace(/_/g, ' '),
          ]),
        },
      ],
    },
  }, `Tenant_Invoices_${building.name || 'Building'}_${tenantMonthLabel(monthKey)}`, `tenant-month-${building.name || 'building'}-${monthKey}`);
}

function tenantMonthLabel(monthKey) {
  const raw = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw || '-';
  const date = new Date(`${raw}-01T00:00:00`);
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function tenantDateLabel(value) {
  if (!value) return '-';
  const raw = String(value).trim();
  if (!raw) return '-';
  if (typeof fmtDate === 'function') {
    const formatted = fmtDate(raw);
    if (formatted && formatted !== raw) return formatted;
  }
  const directMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) {
    const date = new Date(`${directMatch[1]}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function tenantElectricityUsageText(invoice = {}, {
  currencyFormatter = (value) => String(value ?? 0),
  includeRate = false,
  includeAmount = false,
  compact = false,
} = {}) {
  const previousUnits = Number(invoice.previous_electricity_units || 0);
  const currentUnits = Number(invoice.current_electricity_units || 0);
  const extraUnits = Number(invoice.extra_electricity_units || 0);
  const usedUnits = Number(invoice.electricity_units_used || 0);
  const rateText = currencyFormatter(invoice.electricity_unit_price_snapshot || 0);
  const amountText = currencyFormatter(invoice.electricity_amount || 0);
  const meterUnits = currentUnits - previousUnits;
  const meterText = (previousUnits === 0 && currentUnits === 0)
    ? `${usedUnits} units`
    : `${currentUnits} - ${previousUnits} = ${meterUnits} units`;
  const usageText = extraUnits
    ? `${meterText} ${extraUnits > 0 ? '+' : '-'} extra ${Math.abs(extraUnits)} = ${usedUnits} units`
    : meterText;
  if (compact) {
    return includeAmount ? `${usageText} • ${amountText}` : usageText;
  }
  if (includeRate && includeAmount) return `${usageText} @ ${rateText} = ${amountText}`;
  if (includeRate) return `${usageText} @ ${rateText}`;
  if (includeAmount) return `${usageText} • ${amountText}`;
  return usageText;
}

function liveSplitTripReport() {
 const { trip, events } = data;
 const r2 = value => Math.round((Number(value)||0)*100)/100;
    const memberSummaryMap = {};
    events.forEach((event) => {
      (event.participants || []).forEach((p) => {
        if (!p?.name) return;
        if (!memberSummaryMap[p.name]) memberSummaryMap[p.name] = { name: p.name, paid: 0, share: 0, items: 0 };
        memberSummaryMap[p.name].share = r2(memberSummaryMap[p.name].share + r2(p.share));
        if (p.paid) memberSummaryMap[p.name].paid = r2(memberSummaryMap[p.name].paid + r2(event.total));
        memberSummaryMap[p.name].items = r2(memberSummaryMap[p.name].items + 1);
      });
    });
    const memberSummary = Object.values(memberSummaryMap);
    const members = Array.isArray(trip.members) ? trip.members : [];
    const memberNames = members.map((member) => String(member?.name || member?.display_name || member?.username || '').trim()).filter(Boolean);
    const subtitleParts = [
      `${members.length} members`,
      `${events.length} item${events.length === 1 ? '' : 's'}`,
      `${String(trip.status || 'active').toUpperCase()}`,
    ];
    const createdDate = trip.created_at ? _P.dt(trip.created_at) : '';
    if (createdDate && createdDate !== '-') subtitleParts.unshift(createdDate);

    const doc = _P.init(true);
    let y = _P.header(doc, `Live Split Trip: ${trip.name || 'Trip'}`, subtitleParts.join('  \u00b7  '));
    y = _P.cards(doc, y, [
      { label: 'Trip Total', value: _P.cur(trip.total_amount || 0), color: '' },
      { label: 'My Share', value: _P.cur(trip.my_share_amount || 0), color: 'amber' },
      { label: 'Expenses', value: String(Number(trip.expense_count || events.length || 0)), color: '' },
      { label: 'Members', value: String(members.length || memberSummary.length || 0), color: '' },
    ]);
    if (memberNames.length) y = _P.note(doc, y, `Members: ${memberNames.join('  \u00b7  ')}`);

    if (memberSummary.length) {
      y = _P.section(doc, y, 'Member Summary');
      y = _P.table(
        doc,
        y,
        [['Member', 'Paid', 'Share', 'Net']],
        memberSummary.map((member) => {
          const net = r2(member.paid - member.share);
          return [
            member.name || '-',
            _P.cur(member.paid || 0),
            _P.cur(member.share || 0),
            `${net > 0.005 ? '+' : net < -0.005 ? '-' : ''}${_P.cur(Math.abs(net))}`,
          ];
        }),
        { 0: { cellWidth: 52 }, 1: { cellWidth: 34 }, 2: { cellWidth: 34 }, 3: { cellWidth: 34 } },
        true
      );
    }

    y = _P.section(doc, y, 'Item Splits');
    y = _P.table(
      doc,
      y,
      [['Date', 'Item', 'Paid By', 'Amount', 'Each Split']],
      events.map((event) => {
        const splitText = Array.isArray(event?.participants) && event.participants.length
          ? event.participants
            .filter((p) => String(p?.name || '').trim())
            .map((p) => {
              const share = _P.cur(r2(p?.share));
              if (p?.contextOnly) return `${p.name}: ${share} in split`;
              return `${p.name}: ${p?.paid ? `paid ${share}` : `owes ${share}`}`;
            })
            .join('\n')
          : '-';
        return [
          _P.dt(event?.date),
          event?.details || '-',
          event?.payer || '-',
          _P.cur(event?.total || 0),
          splitText,
        ];
      }),
      {
        0: { cellWidth: 24 },
        1: { cellWidth: 68 },
        2: { cellWidth: 34 },
        3: { cellWidth: 26 },
        4: { cellWidth: 'auto' },
      },
      true
    );

    _P.save(doc, String(trip.name || 'Live_Split_Trip').replace(/[^\w\s-]/g, '_').trim() || 'Live_Split_Trip');
  
}
function petrolDownloadPdf(kind = 'real') {
    const petrolData = data.petrolData || {};
    const petrolMonth = data.petrolMonth || '';
    const n = value => Number(value) || 0;
    const cleanFakeSuffix = value => String(value || '').replace(/\s*\(fake\)\s*$/i, '').trim();
    try {
      if (typeof _P === 'undefined') return toast('PDF helper not loaded', 'error');
      const monthKey = String(petrolData?.month?.month_key || petrolMonth || '');
      const entries = Array.isArray(petrolData?.entries) ? petrolData.entries : [];
      const isFake = String(kind || '').toLowerCase() === 'fake';
      const selectedEntries = entries.filter((entry) => isFake ? !!entry.is_fake : !entry.is_fake);
      const totals = Array.isArray(petrolData?.totals) ? petrolData.totals : [];
      const shareRows = totals.map((row) => {
        const share = isFake ? n(row.final_fake) : n(row.final_real);
        return [row.friend_name || 'Member', share];
      });
      const totalAmount = shareRows.reduce((sum, row) => sum + n(row[1]), 0);

      const doc = _P.init(true);
      let y = _P.header(doc, `Petrol Entries - ${monthKey}`, new Date().toLocaleDateString('en-IN'));
      y = _P.cards(doc, y, [
        { label: 'Total Entries', value: selectedEntries.length, color: '' },
        { label: 'Month Total', value: _P.cur(totalAmount), color: '' },
      ]);

      y = _P.section(doc, y, 'Each Member Share');
      y = _P.table(doc, y, [['Name', 'Share']], shareRows.length ? shareRows.map((row) => [row[0], _P.cur(row[1])]) : [['-', _P.cur(0)]], {
        0: { cellWidth: 90 },
        1: { halign: 'right', cellWidth: 70, fontStyle: 'bold' },
      });

      y = _P.section(doc, y, 'Daily Entries');
      _P.table(
        doc,
        y,
        [['Date', 'Remarks', 'Distance', 'Average', 'Petrol', 'Amount', 'Per Person Share']],
        selectedEntries.length
          ? selectedEntries.map((entry) => [
            _P.dt(entry.entry_date),
            cleanFakeSuffix(entry.remarks) || '-',
            n(entry.distance_km).toFixed(1),
            n(entry.average_kmpl).toFixed(1),
            `${n(entry.petrol_used_litre).toFixed(2)} L`,
            _P.cur(entry.amount_used),
            (entry.members || []).map((m) => `${m.friend_name}: ${_P.cur(m.share_amount)}`).join(' | ') || '-',
          ])
          : [['-', '-', '-', '-', '-', _P.cur(0), '-']],
        {
          0: { cellWidth: 25 },
          1: { cellWidth: 40 },
          2: { halign: 'right', cellWidth: 20 },
          3: { halign: 'right', cellWidth: 20 },
          4: { halign: 'right', cellWidth: 24 },
          5: { halign: 'right', cellWidth: 26, fontStyle: 'bold' },
          6: { cellWidth: 95 },
        },
        true
      );

      _P.save(doc, `Petrol_Entries_${monthKey}_${isFake ? '2' : '1'}`);
    } catch (err) {
      toast(err?.message || 'Could not generate PDF', 'error');
    }
  }
  const reports = { petrolDownloadPdf, liveSplitTripReport, downloadBankHistoryPdf, printReport, downloadTenantInvoicePdf, downloadTenantReportPdf, downloadTenantMonthInvoicesPdf, downloadCreditCardsPdf, downloadCcCyclePdf, downloadCcHistoryPdf, downloadCcMonthlySummaryPdf, downloadCcYearlySummaryPdf, downloadPlannerPdf, downloadTrackerMonthPdf, downloadTrackersOverviewPdf, downloadFixedDepositsPdf, downloadHabitTrackersOverviewPdf, downloadHabitTrackerDetailPdf, downloadFriendsPdf, downloadFriendDetailPdf, downloadSplitHistoryPdf, downloadSplitSessionPdf, downloadEmisPdf, downloadEmiDetailPdf, downloadTripsPdf, downloadTripDetailPdfEnhanced };
  if (!Object.hasOwn(reports, report)) throw new Error("Unknown web PDF report.");
  await reports[report](...args);
  if (!model.payload) throw new Error("No report data available.");
  return model.payload;
}
module.exports = { buildWebReport };
