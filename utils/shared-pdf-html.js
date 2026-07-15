function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function createFormatters(prefs = {}) {
  const currencyCode = String(prefs.currencyCode || prefs.currency_code || 'INR').trim().toUpperCase() || 'INR';
  const localeCode = String(prefs.localeCode || prefs.locale_code || 'en-IN').trim() || 'en-IN';
  const timeZone = String(prefs.timeZone || prefs.time_zone || '').trim() || null;

  function fmtCur(n) {
    const value = Number(n || 0);
    try {
      return new Intl.NumberFormat(localeCode, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch (_err) {
      return `${currencyCode} ${value.toFixed(2)}`;
    }
  }

  function toLocalIsoDate(value) {
    if (!value && value !== 0) return '';
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return '';
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    const raw = String(value || '').trim();
    if (!raw) return '';
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    const dmy = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : toLocalIsoDate(parsed);
  }

  function fmtDate(str) {
    if (!str) return '-';
    const raw = String(str).trim();
    if (!raw) return '-';
    const normalized = toLocalIsoDate(raw);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? new Date(`${normalized}T00:00:00`)
      : new Date(raw);
    if (Number.isNaN(d.getTime())) return '-';
    const options = { day: 'numeric', month: 'short', year: 'numeric' };
    if (timeZone && normalized !== raw) options.timeZone = timeZone;
    return d.toLocaleDateString(localeCode, options);
  }

  return { fmtCur, fmtDate, currencyCode, localeCode, timeZone };
}

function renderSummaryCards(totals) {
  const cards = [
    { label: 'Total', value: totals.total },
    { label: 'Fair', value: totals.fair },
    { label: 'Extra', value: totals.extra },
    { label: 'Entries', value: totals.count },
  ];

  return cards.map((card) => `
    <div class="card">
      <div class="label">${escapeHtml(card.label)}</div>
      <div class="value">${escapeHtml(card.value)}</div>
    </div>
  `).join('');
}

function renderRows(rows) {
  return rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.primary)}</td>
      <td>${escapeHtml(row.secondary)}</td>
      <td class="amount">${escapeHtml(row.amount)}</td>
      <td class="meta">${escapeHtml(row.meta)}</td>
    </tr>
  `).join('');
}

function buildReportPdfHtml({ title, subtitle, breadcrumb, totals, rows }) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          * { box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #173228; padding: 0; margin: 0; font-size: 11px; }
          .hero { background: linear-gradient(135deg, #2d6a43, #3f8258); color: white; border-radius: 18px; padding: 18px; margin-bottom: 14px; }
          .hero h1 { font-size: 28px; margin: 0 0 6px 0; line-height: 1.08; }
          .hero p { margin: 0; color: rgba(255,255,255,0.78); font-size: 12px; }
          .crumb { font-size: 11px; color: #728078; margin-bottom: 16px; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
          .card { border: 1px solid #d6e3da; border-radius: 14px; padding: 14px; background: #fff; }
          .label { color: #869990; text-transform: uppercase; font-size: 9px; font-weight: 800; letter-spacing: 0.12em; margin-bottom: 6px; }
          .value { font-size: 22px; font-weight: 800; color: #173228; line-height: 1.12; }
          h2 { font-size: 16px; margin: 0 0 12px 0; color: #16261f; }
          .table-card { border: 1px solid #dfebe5; border-radius: 14px; overflow: hidden; page-break-inside: avoid; }
          table { width: 100%; border-collapse: collapse; table-layout: auto; }
          th, td { border-bottom: 1px solid #e2ece7; padding: 9px; text-align: left; vertical-align: top; line-height: 1.4; overflow-wrap: anywhere; word-break: break-word; }
          th { background: #155839; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
          tbody tr:nth-child(even) td { background: #f8fbf9; }
          td.amount { white-space: nowrap; font-weight: 700; color: #173228; }
          td.meta { color: #728078; }
        </style>
      </head>
      <body>
        <div class="hero">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <div class="crumb">${escapeHtml(breadcrumb)}</div>
        <div class="grid">${renderSummaryCards(totals)}</div>
        <h2>Details</h2>
        <div class="table-card">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Details</th>
                <th>Amount</th>
                <th>Split</th>
              </tr>
            </thead>
            <tbody>${renderRows(rows)}</tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function renderInfoSections(sections = []) {
  return sections.map((section) => `
    <div class="info-section">
      <h2>${escapeHtml(section.title || '')}</h2>
      <div class="info-grid">
        ${(section.rows || []).map((row) => `
          <div class="info-card">
            <div class="label">${escapeHtml(row.label || '')}</div>
            <div class="info-value">${escapeHtml(row.value || '-')}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function renderTables(tables = []) {
  return tables.map((table) => `
    <div class="table-section">
      <h2>${escapeHtml(table.title || '')}</h2>
      <div class="table-card">
        <table>
          <thead>
            <tr>
              ${(table.columns || []).map((column) => `<th>${escapeHtml(column)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${(table.rows || []).map((row) => `
              <tr>
                ${(row || []).map((cell, index) => `
                  <td class="${index === (table.amountColumnIndex ?? -1) ? 'amount' : index === (table.metaColumnIndex ?? -1) ? 'meta' : ''}">
                    ${escapeHtml(cell ?? '')}
                  </td>
                `).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `).join('');
}

function buildStructuredPdfHtml({ title, subtitle, breadcrumb, totals = null, rows = [], sections = [], tables = [] }) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          * { box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #173228; padding: 0; margin: 0; font-size: 11px; }
          .hero { background: linear-gradient(135deg, #2d6a43, #3f8258); color: white; border-radius: 18px; padding: 18px; margin-bottom: 14px; }
          .hero h1 { font-size: 28px; margin: 0 0 6px 0; line-height: 1.08; }
          .hero p { margin: 0; color: rgba(255,255,255,0.78); font-size: 12px; }
          .crumb { font-size: 11px; color: #728078; margin-bottom: 16px; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
          .info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
          .card, .info-card { border: 1px solid #d6e3da; border-radius: 14px; padding: 14px; background: #fff; }
          .label { color: #869990; text-transform: uppercase; font-size: 9px; font-weight: 800; letter-spacing: 0.12em; margin-bottom: 6px; }
          .value, .info-value { font-size: 22px; font-weight: 800; color: #173228; line-height: 1.12; }
          h2 { font-size: 16px; margin: 0 0 12px 0; color: #16261f; }
          .table-section, .info-section { margin-bottom: 16px; }
          .table-card { border: 1px solid #dfebe5; border-radius: 14px; overflow: hidden; page-break-inside: avoid; }
          table { width: 100%; border-collapse: collapse; table-layout: auto; }
          th, td { border-bottom: 1px solid #e2ece7; padding: 9px; text-align: left; vertical-align: top; line-height: 1.4; overflow-wrap: anywhere; word-break: break-word; }
          th { background: #155839; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
          tbody tr:nth-child(even) td { background: #f8fbf9; }
          td.amount { white-space: nowrap; font-weight: 700; color: #173228; }
          td.meta { color: #728078; }
        </style>
      </head>
      <body>
        <div class="hero">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <div class="crumb">${escapeHtml(breadcrumb || '')}</div>
        ${totals ? `<div class="grid">${renderSummaryCards(totals)}</div>` : ''}
        ${rows?.length ? `
          <div class="table-section">
            <h2>Details</h2>
            <div class="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Details</th>
                    <th>Amount</th>
                    <th>Split</th>
                  </tr>
                </thead>
                <tbody>${renderRows(rows)}</tbody>
              </table>
            </div>
          </div>
        ` : ''}
        ${renderInfoSections(sections)}
        ${renderTables(tables)}
      </body>
    </html>
  `;
}

function buildSocietyHelpers(prefs = {}) {
  const { fmtCur, fmtDate } = createFormatters(prefs);

  function monthLabel(monthKey, short = false) {
    const raw = String(monthKey || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})$/);
    if (!match) return raw || '-';
    const month = Number(match[2]);
    const year = Number(match[1]);
    return short
      ? `${MONTHS[month - 1] || ''} ${String(year).slice(-2)}`.trim()
      : `${MONTHS[month - 1] || ''} ${year}`.trim();
  }

  function compactMoney(value) {
    const amount = Number(value || 0);
    if (!amount) return '-';
    const abs = Math.abs(amount);
    if (abs >= 1000) {
      const compact = Math.round((abs / 1000) * 10) / 10;
      const text = Number.isInteger(compact) ? String(compact) : compact.toFixed(1).replace(/\.0$/, '');
      return `${amount < 0 ? '- ' : ''}Rs ${text}K`;
    }
    return fmtCur(amount).replace(/\s+/g, ' ');
  }

  function memberLabel(member) {
    const name = String(member?.member_name || '').trim() || 'Member';
    const unit = String(member?.unit_label || '').trim();
    return unit ? `${name} (${unit})` : name;
  }

  function memberPhoneDisplay(member) {
    const primary = String(member?.phone_number || '').trim();
    const extras = Array.isArray(member?.phone_numbers) ? member.phone_numbers : [];
    const phones = [...new Set([primary, ...extras].map((value) => String(value || '').trim()).filter(Boolean))];
    return phones.length ? phones.join(', ') : '-';
  }

  function sortUnitValue(unitLabel) {
    const raw = String(unitLabel || '').trim();
    const firstNumber = raw.match(/\d+/);
    return {
      primary: firstNumber ? Number(firstNumber[0]) : Number.MAX_SAFE_INTEGER,
      secondary: raw.toLowerCase(),
    };
  }

  function sortMembers(members) {
    return [...(members || [])].sort((a, b) => {
      const aIsShop = String(a?.property_type || '').toLowerCase() === 'shop' ? 1 : 0;
      const bIsShop = String(b?.property_type || '').toLowerCase() === 'shop' ? 1 : 0;
      if (aIsShop !== bIsShop) return aIsShop - bIsShop;
      const aUnit = sortUnitValue(a?.unit_label);
      const bUnit = sortUnitValue(b?.unit_label);
      if (aUnit.primary !== bUnit.primary) return aUnit.primary - bUnit.primary;
      if (aUnit.secondary !== bUnit.secondary) return aUnit.secondary.localeCompare(bUnit.secondary);
      return String(a?.member_name || '').localeCompare(String(b?.member_name || ''));
    });
  }

  function matrixScopeTotal(member, monthKeys = []) {
    return (monthKeys || []).reduce(
      (sum, monthKey) => sum + Number((member?.contributions_by_month || {})[monthKey] || 0),
      0
    );
  }

  function renderTable(columns, rows, options = {}) {
    const rawHtmlColumns = Array.isArray(options.rawHtmlColumns) ? options.rawHtmlColumns : [];
    const renderCell = (cell, index) => {
      const cls = [
        options.numericColumns?.includes(index) ? 'num' : '',
        options.centerColumns?.includes(index) ? 'center' : '',
        options.nowrapColumns?.includes(index) ? 'nowrap' : '',
        options.columnClasses?.[index] || '',
      ].filter(Boolean).join(' ');
      const content = rawHtmlColumns.includes(index) ? String(cell ?? '') : escapeHtml(cell);
      return `<td class="${cls}">${content}</td>`;
    };
    const footer = Array.isArray(options.footer) && options.footer.length
      ? `<tfoot>${options.footer.map((row) => `<tr>${row.map((cell, index) => renderCell(cell, index)).join('')}</tr>`).join('')}</tfoot>`
      : '';
    const colgroup = Array.isArray(options.columnWidths) && options.columnWidths.length
      ? `<colgroup>${options.columnWidths.map((width) => `<col style="width:${escapeHtml(width)}">`).join('')}</colgroup>`
      : '';
    return `
      <table class="${options.compact ? 'compact-table' : ''}">
        ${colgroup}
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${row.map((cell, index) => renderCell(cell, index)).join('')}</tr>`).join('')}
        </tbody>
        ${footer}
      </table>
    `;
  }

  function summaryCards(cards, options = {}) {
    return `
      <div class="cards ${options.className || ''}">
        ${cards.map((card) => `
          <div class="card ${card.tone || ''}">
            <div class="card-label">${escapeHtml(card.label)}</div>
            <div class="card-value">${escapeHtml(card.value)}</div>
            ${card.meta ? `<div class="card-meta">${escapeHtml(card.meta)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderHero({ title, location, metaRight, period, cards = [] }) {
    const metaParts = [location || 'Location not added', metaRight || '', period || ''].filter(Boolean);
    return `
      <div class="hero">
        <div class="hero-grid">
          <div class="hero-copy">
            <div class="eyebrow">Society Report</div>
            <div class="title">${escapeHtml(title || 'Society')}</div>
            <div class="subtitle">${escapeHtml(metaParts.join(' · '))}</div>
            <div class="hero-foot">Generated by Expense Lite AI · ${escapeHtml(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }))}</div>
          </div>
          ${cards.length ? summaryCards(cards, { className: 'hero-cards' }) : ''}
        </div>
      </div>
    `;
  }

  function renderSectionBand(leftTitle, rightTitle = '') {
    return `
      <div class="section-band">
        <div class="section-band-left">
          <span class="section-dot"></span>
          <span>${escapeHtml(leftTitle)}</span>
        </div>
        ${rightTitle ? `<div class="section-band-right">${escapeHtml(rightTitle)}</div>` : ''}
      </div>
    `;
  }

  function buildPdfShell({ hero, body, landscape = false }) {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
            * { box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #173228; font-size: 11px; margin: 0; }
            .hero { background: linear-gradient(135deg, #2d6a43, #3f8258); border-radius: 18px; padding: 18px; color: #fff; margin-bottom: 14px; }
            .hero-grid { display: table; width: 100%; table-layout: fixed; }
            .hero-copy { display: table-cell; width: 44%; vertical-align: top; padding-right: 12px; }
            .eyebrow { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #c2d8c9; font-weight: 800; }
            .title { font-size: 28px; line-height: 1.08; font-weight: 800; margin-top: 8px; }
            .subtitle { margin-top: 10px; color: #cfe0d4; font-size: 12px; }
            .hero-foot { margin-top: 34px; color: #b4c9bc; font-size: 10px; }
            .cards { display: table; width: 100%; table-layout: fixed; border-spacing: 8px 0; }
            .hero-cards { display: table-cell; width: 56%; vertical-align: top; }
            .hero-cards .card { padding: 10px 11px; min-height: 88px; }
            .card { display: table-cell; background: #fafcfb; border: 1px solid #d6e3da; border-radius: 12px; padding: 12px; vertical-align: top; }
            .card.green { border-top: 4px solid #3d7d54; }
            .card.red { border-top: 4px solid #c55344; }
            .card.blue { border-top: 4px solid #4060b5; }
            .card.neutral { border-top: 4px solid #666666; }
            .card-label { color: #869990; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; font-weight: 800; margin-bottom: 8px; }
            .card-value { font-size: 18px; line-height: 1.15; font-weight: 800; color: #173228; }
            .card.green .card-value { color: #3d7d54; }
            .card.red .card-value { color: #c55344; }
            .card.blue .card-value { color: #4060b5; }
            .card.neutral .card-value { color: #666666; }
            .card-meta { color: #9daea5; font-size: 10px; margin-top: 14px; }
            .cards-large { margin-bottom: 14px; }
            .cards-large .card { min-height: 98px; }
            .section-band { margin: 10px 0 10px; border: 1px solid #e8edea; border-radius: 12px; background: #fff; padding: 9px 12px; display: table; width: 100%; table-layout: fixed; }
            .section-band-left, .section-band-right { display: table-cell; vertical-align: middle; }
            .section-band-left { font-size: 13px; font-weight: 800; color: #192128; }
            .section-band-right { text-align: right; color: #8a959d; font-size: 11px; }
            .section-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3a8555; margin-right: 8px; vertical-align: middle; }
            .months-note { color: #708078; font-size: 11px; margin: 0 0 10px; }
            .spacer { height: 8px; }
            .table-card { border: 1px solid #dfebe5; border-radius: 14px; overflow: hidden; }
            table { width: 100%; border-collapse: collapse; table-layout: auto; }
            thead { display: table-header-group; }
            tfoot { display: table-row-group; }
            tr, td, th { page-break-inside: avoid; }
            th { background: #155839; color: #fff; text-align: left; padding: 10px 9px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
            td { border-bottom: 1px solid #e2ece7; padding: 9px; vertical-align: top; color: #1f3027; word-break: break-word; overflow-wrap: anywhere; line-height: 1.4; }
            tbody tr:nth-child(even) td { background: #f8fbf9; }
            tfoot td { background: #edf8f2; color: #176945; font-weight: 800; border-top: 2px solid #d4e9dd; }
            .num { text-align: right; font-weight: 700; white-space: nowrap; }
            .center { text-align: center; }
            .nowrap { white-space: nowrap; }
            .compact-table th, .compact-table td { padding: 7px 6px; font-size: 10px; }
            .badge-paid { display: inline-block; min-width: 58px; text-align: center; border-radius: 999px; padding: 3px 8px; font-weight: 800; font-size: 10px; }
            .badge-paid.good { background: #eaf7ef; color: #176945; }
            .badge-paid.avg { background: #fff5d8; color: #b77c12; }
            .badge-paid.low { background: #ffeceb; color: #c94444; }
          </style>
        </head>
        <body>
          ${hero}
          ${body}
        </body>
      </html>
    `;
  }

  function expenseRows(expenses) {
    return (expenses || []).map((expense) => [
      fmtDate(expense.expense_date),
      expense.title || '-',
      expense.category || '-',
      expense.notes || '-',
      fmtCur(expense.amount || 0),
    ]);
  }

  function memberBalanceRows(detail) {
    const rows = Array.isArray(detail?.member_balances) ? detail.member_balances : [];
    return rows.map((item) => [
      memberLabel(item),
      fmtCur(item.amount || 0),
      fmtCur(item.settled_amount || 0),
      fmtCur(item.remaining_amount || 0),
      String(Number(item.expense_count || 0)),
      String(Number(item.settlement_count || 0)),
    ]);
  }

  function memberSettlementRows(detail) {
    const rows = Array.isArray(detail?.member_balance_settlements) ? detail.member_balance_settlements : [];
    return rows.map((item) => [
      fmtDate(item.settlement_date),
      memberLabel(item),
      item.settlement_mode || '-',
      item.notes || '-',
      fmtCur(item.amount || 0),
    ]);
  }

  function paidRatioClass(paidCount, paidBase) {
    const ratio = paidBase > 0 ? Number(paidCount || 0) / Number(paidBase || 0) : 0;
    if (ratio >= 0.7) return 'good';
    if (ratio >= 0.35) return 'avg';
    return 'low';
  }

  function monthSummaryRows(detail, paidBase, options = {}) {
    return (detail?.month_summary || []).map((row) => [
      monthLabel(row.month_key),
      options.coloredPaidColumn
        ? `<span class="badge-paid ${paidRatioClass(row.paid_count || 0, paidBase)}">${Number(row.paid_count || 0)}/${Number(paidBase || 0)}</span>`
        : `${Number(row.paid_count || 0)}/${Number(paidBase || 0)}`,
      fmtCur(row.collected || 0),
      fmtCur(row.spent || 0),
      fmtCur(row.balance || 0),
    ]);
  }

  function societyPeriodRange(detail) {
    const months = Array.isArray(detail?.month_summary)
      ? detail.month_summary.map((row) => row.month_key).filter(Boolean)
      : [];
    if (!months.length) return monthLabel(detail?.selected_month);
    const sorted = [...months].sort();
    if (sorted.length === 1) return monthLabel(sorted[0]);
    return `${monthLabel(sorted[0])} - ${monthLabel(sorted[sorted.length - 1])}`;
  }

  function selectedPeriodRange(monthKeys = []) {
    const filtered = (monthKeys || []).filter(Boolean).sort();
    if (!filtered.length) return 'No period';
    if (filtered.length === 1) return monthLabel(filtered[0]);
    return `${monthLabel(filtered[0])} - ${monthLabel(filtered[filtered.length - 1])}`;
  }

  function statCardsData(detail, mode = 'overall') {
    const totals = detail?.totals || {};
    if (mode === 'month') {
      return [
        { label: 'Total Collected', value: fmtCur(totals.selected_month_collected || 0), meta: `${Number(totals.selected_month_paid_count || 0)}/${Number(totals.member_count || 0)} paid`, tone: 'green' },
        { label: 'Total Expenses', value: fmtCur(totals.selected_month_spent || 0), meta: `${Number(totals.selected_month_expense_count || 0)} entries`, tone: 'red' },
        { label: 'Net Balance', value: fmtCur(totals.selected_month_balance || 0), meta: Number(totals.selected_month_balance || 0) >= 0 ? 'surplus' : 'deficit', tone: Number(totals.selected_month_balance || 0) >= 0 ? 'blue' : 'red' },
        { label: 'Net Bank Balance', value: fmtCur(totals.overall_balance || 0), meta: 'till today', tone: Number(totals.overall_balance || 0) >= 0 ? 'blue' : 'red' },
        { label: 'Members', value: String(Number(totals.member_count || 0)), meta: 'registered', tone: 'neutral' },
      ];
    }
    return [
      { label: 'Total Collected', value: fmtCur(totals.overall_collected || 0), meta: `+${Number(detail?.month_summary?.length || 0)} months`, tone: 'green' },
      { label: 'Total Expenses', value: fmtCur(totals.overall_spent || 0), meta: `${Array.isArray(detail?.expenses) ? detail.expenses.length : 0} entries`, tone: 'red' },
      { label: 'Net Balance', value: fmtCur(totals.overall_balance || 0), meta: Number(totals.overall_balance || 0) >= 0 ? 'surplus' : 'deficit', tone: 'blue' },
      { label: 'Members', value: String(Number(totals.member_count || 0)), meta: 'registered', tone: 'neutral' },
    ];
  }

  function filterMembers(detail, memberScope = 'all', matrixMonths = []) {
    const members = Array.isArray(detail?.members) ? detail.members : [];
    const months = matrixMonths.length ? matrixMonths : [String(detail?.selected_month || '')];
    const scopedAmount = (member) => months.reduce((sum, monthKey) => sum + Number((member?.contributions_by_month || {})[monthKey] || 0), 0);
    if (memberScope === 'paid') return members.filter((member) => scopedAmount(member) > 0);
    if (memberScope === 'unpaid') return members.filter((member) => scopedAmount(member) <= 0);
    return members;
  }

  function resolveExpenseScope(detail, scope = 'current', months = []) {
    const allExpenses = Array.isArray(detail?.expenses) ? detail.expenses : [];
    if (scope === 'all') return allExpenses;
    if (scope === 'selected') {
      const wanted = new Set((months || []).map((monthKey) => String(monthKey)));
      return allExpenses.filter((expense) => wanted.has(String(expense.month_key || '').slice(0, 7)));
    }
    return Array.isArray(detail?.month_expenses) ? detail.month_expenses : [];
  }

  return {
    fmtCur,
    monthLabel,
    compactMoney,
    memberLabel,
    memberPhoneDisplay,
    sortMembers,
    matrixScopeTotal,
    renderTable,
    summaryCards,
    renderHero,
    renderSectionBand,
    buildPdfShell,
    expenseRows,
    memberBalanceRows,
    memberSettlementRows,
    monthSummaryRows,
    societyPeriodRange,
    selectedPeriodRange,
    statCardsData,
    filterMembers,
    resolveExpenseScope,
  };
}

function buildSocietyPdfHtml(action, detail = {}, options = {}, prefs = {}) {
  const {
    fmtCur,
    monthLabel,
    compactMoney,
    memberLabel,
    memberPhoneDisplay,
    sortMembers,
    matrixScopeTotal,
    renderTable,
    summaryCards,
    renderHero,
    renderSectionBand,
    buildPdfShell,
    expenseRows,
    memberBalanceRows,
    memberSettlementRows,
    monthSummaryRows,
    societyPeriodRange,
    selectedPeriodRange,
    statCardsData,
    filterMembers,
    resolveExpenseScope,
  } = buildSocietyHelpers(prefs);

  if (action === 'month') {
    const monthKey = detail?.selected_month;
    const rows = sortMembers(detail?.members || []).map((member) => [
      memberLabel(member),
      member.property_type === 'shop' ? 'Shop' : 'Home',
      member.unit_label || '-',
      memberPhoneDisplay(member),
      fmtCur(member.selected_month_amount || 0),
      member.selected_month_paid_on ? createFormatters(prefs).fmtDate(member.selected_month_paid_on) : '-',
      member.selected_month_notes || '-',
    ]);
    return buildPdfShell({
      hero: renderHero({
        title: detail?.society?.name || 'Society',
        location: detail?.society?.location || 'Not added',
        metaRight: `${Number(detail?.totals?.member_count || 0)} Members`,
        period: monthLabel(monthKey),
        cards: statCardsData(detail, 'month'),
      }),
      landscape: true,
      body: `
        ${renderSectionBand('Monthly Contributions', monthLabel(monthKey))}
        <div class="table-card">
          ${renderTable(['Member', 'Property', 'Unit', 'Phone', 'Amount', 'Paid On', 'Notes'], rows, {
            numericColumns: [4],
            centerColumns: [1, 2],
            nowrapColumns: [4, 5],
            columnWidths: ['22%', '9%', '10%', '19%', '12%', '12%', '16%'],
          })}
        </div>
      `,
    });
  }

  if (action === 'member_list') {
    const monthKey = String(detail?.selected_month || '').trim();
    const statusScope = String(options.status_scope || options.statusScope || 'all').trim().toLowerCase();
    const scopedMembers = statusScope === 'paid' || statusScope === 'unpaid'
      ? filterMembers(detail, statusScope, monthKey ? [monthKey] : [])
      : (detail?.members || []);
    const statusLabel = statusScope === 'paid' ? 'Paid Members'
      : statusScope === 'unpaid' ? 'Unpaid Members'
      : 'Members';
    const rows = sortMembers(scopedMembers).map((member) => {
      const monthAmount = Number(member?.selected_month_amount || 0);
      const paid = monthAmount > 0;
      return [
        memberLabel(member),
        member.property_type === 'shop' ? 'Shop' : 'Home',
        member.unit_label || '-',
        memberPhoneDisplay(member),
        fmtCur(member?.monthly_due || 0),
        fmtCur(monthAmount),
        member.selected_month_paid_on ? createFormatters(prefs).fmtDate(member.selected_month_paid_on) : '-',
        paid ? 'Paid' : 'Not paid',
      ];
    });
    return buildPdfShell({
      hero: renderHero({
        title: detail?.society?.name || 'Society',
        location: detail?.society?.location || 'Not added',
        metaRight: `${rows.length} ${statusLabel.toLowerCase()}`,
        period: monthLabel(monthKey),
        cards: [
          { label: 'Members Shown', value: String(rows.length), meta: statusLabel, tone: 'neutral' },
          { label: 'Monthly Due Total', value: fmtCur(scopedMembers.reduce((sum, member) => sum + Number(member?.monthly_due || 0), 0)), meta: 'member due setup', tone: 'blue' },
          { label: 'Collected This Month', value: fmtCur(scopedMembers.reduce((sum, member) => sum + Number(member?.selected_month_amount || 0), 0)), meta: 'selected month', tone: 'green' },
          { label: 'Selected Month', value: monthLabel(monthKey), meta: 'current filter', tone: 'neutral' },
        ],
      }),
      landscape: true,
      body: `
        ${renderSectionBand(statusLabel, monthLabel(monthKey))}
        <div class="table-card">
          ${renderTable(['Member', 'Property', 'Unit', 'Phone', 'Monthly Due', 'Amount', 'Paid On', 'Status'], rows, {
            numericColumns: [4, 5],
            centerColumns: [1, 2, 7],
            nowrapColumns: [4, 5, 6, 7],
            columnWidths: ['22%', '9%', '10%', '18%', '11%', '10%', '11%', '9%'],
          })}
        </div>
      `,
    });
  }

  if (action === 'mobile_month_v2') {
    const totals = detail?.totals || {};
    const monthKey = detail?.selected_month;
    const monthHeading = monthLabel(monthKey);
    const rows = sortMembers(detail?.members || []).map((member) => `
      <tr>
        <td style="font-weight:800;color:#213f31;padding:14px 12px">${escapeHtml(memberLabel(member))}</td>
        <td style="color:#63716a;padding:14px 12px">${escapeHtml(memberPhoneDisplay(member))}</td>
        <td style="font-weight:800;color:#2f7b53;text-align:right;padding:14px 12px">${escapeHtml(fmtCur(member.selected_month_amount || 0))}</td>
      </tr>
    `).join('');
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            @page { size: A4 portrait; margin: 12mm; }
            * { box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #173228; margin: 0; font-size: 11px; background: #fff; }
            .hero { background: #1f4a33; color: #fff; padding: 22px; margin-bottom: 18px; }
            .eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; font-weight: 800; opacity: .95; }
            .title { font-size: 21px; font-weight: 800; margin-top: 10px; }
            .subtitle { font-size: 13px; margin-top: 8px; opacity: .94; }
            .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid #d9e0db; margin: 0 8px 20px; }
            .card { min-height: 138px; padding: 14px 14px 12px; border-right: 1px solid #d9e0db; border-bottom: 1px solid #d9e0db; }
            .card:nth-child(2n) { border-right: none; }
            .card:nth-last-child(-n+2) { border-bottom: none; }
            .card-label { color: #6f7671; font-size: 10px; letter-spacing: .07em; text-transform: uppercase; margin-bottom: 30px; }
            .card-value { color: #244837; font-size: 22px; font-weight: 800; line-height: 1.2; }
            .card-meta { color: #6f7671; font-size: 10px; margin-top: 32px; }
            .members-wrap { margin: 0 10px 12px; }
            .members-title { font-size: 16px; font-weight: 800; color: #244837; text-transform: uppercase; }
            .members-sub { color: #6f7671; font-size: 11px; margin-top: 2px; }
            .section-title { margin: 0 10px 10px; font-size: 17px; font-weight: 800; color: #244837; }
            .table-wrap { border: 1px solid #dfe6e1; margin: 0; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th { background: #2f6848; color: #fff; text-align: left; padding: 12px; font-size: 10px; font-weight: 800; }
            td { border-bottom: 1px solid #e3ebe6; vertical-align: middle; font-size: 11px; word-break: break-word; overflow-wrap: anywhere; }
            tbody tr:nth-child(even) td { background: #f4f8f5; }
            tbody tr:last-child td { border-bottom: none; }
          </style>
        </head>
        <body>
          <div class="hero">
            <div class="eyebrow">Society Report</div>
            <div class="title">${escapeHtml(detail?.society?.name || 'Society')}</div>
            <div class="subtitle">${escapeHtml(`${detail?.society?.location || 'Not added'} • ${Number(totals.member_count || 0)} Members • ${monthHeading}`)}</div>
          </div>
          <div class="cards">
            <div class="card">
              <div class="card-label">Total Collected</div>
              <div class="card-value">${escapeHtml(fmtCur(totals.selected_month_collected || 0))}</div>
              <div class="card-meta">${escapeHtml(`${Number(totals.selected_month_paid_count || 0)}/${Number(totals.member_count || 0)} paid`)}</div>
            </div>
            <div class="card">
              <div class="card-label">Total Expenses</div>
              <div class="card-value">${escapeHtml(fmtCur(totals.selected_month_spent || 0))}</div>
              <div class="card-meta">${escapeHtml(`${Number(totals.selected_month_expense_count || 0)} entries`)}</div>
            </div>
            <div class="card">
              <div class="card-label">Net Balance</div>
              <div class="card-value">${escapeHtml(fmtCur(totals.selected_month_balance || 0))}</div>
              <div class="card-meta">${escapeHtml(Number(totals.selected_month_balance || 0) >= 0 ? 'surplus' : 'deficit')}</div>
            </div>
            <div class="card">
              <div class="card-label">Net Bank Balance</div>
              <div class="card-value">${escapeHtml(fmtCur(totals.overall_balance || 0))}</div>
              <div class="card-meta">till today</div>
            </div>
          </div>
          <div class="members-wrap">
            <div class="members-title">Members</div>
            <div class="members-sub">${escapeHtml(`${Number(totals.member_count || 0)} registered`)}</div>
          </div>
          <div class="section-title">${escapeHtml(`Monthly Contributions - ${monthHeading}`)}</div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style="width:52%">Member</th>
                  <th style="width:28%">Phone</th>
                  <th style="width:20%;text-align:right">Amount</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </body>
      </html>
    `;
  }

  if (action === 'mobile_month') {
    return buildSocietyPdfHtml('mobile_month_v2', detail, options, prefs);
  }

  if (action === 'mobile_month') {
    const monthKey = detail?.selected_month;
    const rows = sortMembers(detail?.members || []).map((member) => [
      memberLabel(member),
      member.unit_label || '-',
      memberPhoneDisplay(member),
      fmtCur(member.selected_month_amount || 0),
      member.selected_month_paid_on ? createFormatters(prefs).fmtDate(member.selected_month_paid_on) : '-',
    ]);
    return buildPdfShell({
      hero: renderHero({
        title: detail?.society?.name || 'Society',
        location: detail?.society?.location || 'Not added',
        metaRight: `${Number(detail?.totals?.member_count || 0)} Members`,
        period: monthLabel(monthKey),
        cards: statCardsData(detail, 'month'),
      }),
      landscape: false,
      body: `
        ${renderSectionBand('Monthly Contributions', `${monthLabel(monthKey)} • Mobile view`)}
        <div class="table-card">
          ${renderTable(['Member', 'House No.', 'Phone', 'Amount', 'Paid On'], rows, {
            numericColumns: [3],
            nowrapColumns: [3, 4],
            columnWidths: ['30%', '14%', '24%', '16%', '16%'],
          })}
        </div>
      `,
    });
  }

  if (action === 'member') {
    const member = options.member || {};
    const balanceSummary = options.balance_summary || detail?.balance_summary || {};
    const settlements = Array.isArray(balanceSummary?.settlements) ? balanceSummary.settlements : [];
    const rows = (detail?.matrix_months || []).map((monthKey) => [
      monthLabel(monthKey),
      fmtCur((member?.contributions_by_month || {})[monthKey] || 0),
    ]);
    return buildPdfShell({
      hero: renderHero({
        title: memberLabel(member),
        location: detail?.society?.name || 'Society',
        metaRight: member?.property_type === 'shop' ? 'Shop' : 'Home',
        period: memberPhoneDisplay(member),
        cards: [
          { label: 'Total Contribution', value: fmtCur(member?.total_contributed || 0), meta: 'all months', tone: 'green' },
          { label: 'Gross Owed', value: fmtCur(balanceSummary?.gross_owed || 0), meta: 'paid by member', tone: 'blue' },
          { label: 'Settled', value: fmtCur(balanceSummary?.settled_amount || 0), meta: `${Number(balanceSummary?.settlement_count || 0)} settlement(s)`, tone: 'neutral' },
          { label: 'Remaining', value: fmtCur(balanceSummary?.remaining_amount || 0), meta: 'to settle', tone: Number(balanceSummary?.remaining_amount || 0) > 0 ? 'red' : 'green' },
        ],
      }),
      landscape: true,
      body: `
        ${renderSectionBand('Member Contribution Timeline', societyPeriodRange(detail))}
        <div class="table-card">
          ${renderTable(['Month', 'Contribution'], rows, {
            numericColumns: [1],
            nowrapColumns: [1],
            columnWidths: ['58%', '42%'],
          })}
        </div>
        <div class="spacer"></div>
        ${renderSectionBand('Member Ledger', 'Pocket-paid expense adjustments')}
        ${summaryCards([
          { label: 'Gross Owed', value: fmtCur(balanceSummary?.gross_owed || 0), meta: 'before adjustments', tone: 'green' },
          { label: 'Settled', value: fmtCur(balanceSummary?.settled_amount || 0), meta: 'already adjusted', tone: 'blue' },
          { label: 'Remaining', value: fmtCur(balanceSummary?.remaining_amount || 0), meta: 'bank still owes', tone: 'neutral' },
        ], { className: 'cards-large' })}
        <div class="table-card">
          ${renderTable(['Date', 'Mode', 'Notes', 'Amount'], settlements.map((item) => [
            createFormatters(prefs).fmtDate(item.settlement_date),
            item.settlement_mode || '-',
            item.notes || '-',
            fmtCur(item.amount || 0),
          ]), {
            numericColumns: [3],
            nowrapColumns: [0, 3],
            columnWidths: ['18%', '18%', '42%', '22%'],
            footer: [['', 'Settled Total', '', fmtCur(balanceSummary?.settled_amount || 0)]],
          })}
        </div>
      `,
    });
  }

  if (action === 'matrix') {
    const matrixMonths = (options.selectedMonths || []).length ? options.selectedMonths : (detail?.matrix_months || []);
    const memberScope = options.memberScope || 'all';
    const scopedMembers = filterMembers(detail, memberScope, matrixMonths);
    const periodLabel = matrixMonths.length ? selectedPeriodRange(matrixMonths) : societyPeriodRange(detail);
    const rows = sortMembers(scopedMembers).map((member) => [
      memberLabel(member),
      ...matrixMonths.map((monthKey) => compactMoney((member.contributions_by_month || {})[monthKey] || 0)),
      fmtCur(matrixScopeTotal(member, matrixMonths)),
    ]);
    return buildPdfShell({
      hero: renderHero({
        title: 'Member Contribution Matrix',
        location: `${matrixMonths.length} months`,
        metaRight: `${scopedMembers.length} members`,
        period: periodLabel,
        cards: [
          { label: 'Collected', value: fmtCur(detail?.totals?.overall_collected || 0), meta: 'all months', tone: 'green' },
          { label: 'Expenses', value: fmtCur(detail?.totals?.overall_spent || 0), meta: 'society spend', tone: 'red' },
          { label: 'Net Balance', value: fmtCur(detail?.totals?.overall_balance || 0), meta: Number(detail?.totals?.overall_balance || 0) >= 0 ? 'surplus' : 'deficit', tone: 'blue' },
        ],
      }),
      landscape: true,
      body: `
        ${renderSectionBand('Contribution Matrix', periodLabel)}
        <div class="months-note">Months shown: ${escapeHtml(matrixMonths.map((monthKey) => monthLabel(monthKey, true)).join(', ') || 'No months selected')}</div>
        <div class="table-card">
          ${renderTable(['Member', ...matrixMonths.map((monthKey) => monthLabel(monthKey, true)), 'Total'], rows, {
            compact: true,
            numericColumns: [...matrixMonths.map((_, index) => index + 1), matrixMonths.length + 1],
            nowrapColumns: [...matrixMonths.map((_, index) => index + 1), matrixMonths.length + 1],
          })}
        </div>
      `,
    });
  }

  if (action === 'expenses') {
    const expenses = resolveExpenseScope(detail, options.scope || 'current', options.months || []);
    const monthKey = detail?.selected_month;
    const subtitle = options.scope === 'all'
      ? 'Till today'
      : options.scope === 'selected'
        ? `Selected months: ${((options.months || []).map((item) => monthLabel(item)).join(', ') || 'None')}`
        : `Current month: ${monthLabel(monthKey)}`;
    return buildPdfShell({
      hero: renderHero({
        title: detail?.society?.name || 'Society',
        location: detail?.society?.location || 'Not added',
        metaRight: 'Society Expenses',
        period: monthLabel(monthKey),
        cards: [
          { label: 'Spent This Month', value: fmtCur(detail?.totals?.selected_month_spent || 0), meta: `${(detail?.month_expenses || []).length} entries`, tone: 'red' },
          { label: 'Collected This Month', value: fmtCur(detail?.totals?.selected_month_collected || 0), meta: `${Number(detail?.totals?.selected_month_paid_count || 0)}/${Number(detail?.totals?.member_count || 0)} paid`, tone: 'green' },
          { label: 'Net Balance', value: fmtCur(detail?.totals?.selected_month_balance || 0), meta: Number(detail?.totals?.selected_month_balance || 0) >= 0 ? 'surplus' : 'deficit', tone: Number(detail?.totals?.selected_month_balance || 0) >= 0 ? 'blue' : 'red' },
          { label: 'Net Bank Balance', value: fmtCur(detail?.totals?.overall_balance || 0), meta: 'till today', tone: Number(detail?.totals?.overall_balance || 0) >= 0 ? 'blue' : 'red' },
        ],
      }),
      landscape: true,
      body: `
        ${renderSectionBand('All Expenses', subtitle)}
        <div class="table-card">
          ${renderTable(['Date', 'Title', 'Category', 'Notes', 'Amount'], expenseRows(expenses), {
            numericColumns: [4],
            nowrapColumns: [0, 4],
            columnWidths: ['15%', '25%', '18%', '24%', '18%'],
            footer: [['', 'Total Expenses', '', '', fmtCur(expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0))]],
          })}
        </div>
      `,
    });
  }

  if (action === 'report') {
    const allExpenses = Array.isArray(detail?.expenses) ? detail.expenses : [];
    const balanceRows = memberBalanceRows(detail);
    const settlementRows = memberSettlementRows(detail);
    return buildPdfShell({
      hero: renderHero({
        title: detail?.society?.name || 'Society',
        location: detail?.society?.location || 'Not added',
        metaRight: `${Number(detail?.totals?.member_count || 0)} Members`,
        period: societyPeriodRange(detail),
        cards: statCardsData(detail, 'overall'),
      }),
      body: `
        ${renderSectionBand('Monthly Summary', 'Collection & expense report')}
        <div class="table-card">
          ${renderTable(['Month', 'Paid Members', 'Collected', 'Expenses', 'Balance'], monthSummaryRows(detail, detail?.totals?.member_count || 0, { coloredPaidColumn: true }), {
            numericColumns: [2, 3, 4],
            rawHtmlColumns: [1],
            nowrapColumns: [2, 3, 4],
            columnWidths: ['20%', '18%', '21%', '21%', '20%'],
            footer: [['All Time Total', '-', fmtCur(detail?.totals?.overall_collected || 0), fmtCur(detail?.totals?.overall_spent || 0), fmtCur(detail?.totals?.overall_balance || 0)]],
          })}
        </div>
        <div class="spacer"></div>
        ${renderSectionBand('All Expenses', 'Till today')}
        <div class="table-card">
          ${renderTable(['Date', 'Description', 'Category', 'Amount'], allExpenses.map((expense) => [
            createFormatters(prefs).fmtDate(expense.expense_date),
            expense.title || '-',
            expense.category || '-',
            fmtCur(expense.amount || 0),
          ]), {
            numericColumns: [3],
            nowrapColumns: [0, 3],
            columnWidths: ['17%', '41%', '20%', '22%'],
            footer: [['', 'Total Expenses', '', fmtCur(allExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))]],
          })}
        </div>
        <div class="spacer"></div>
        ${renderSectionBand('Member Ledger', 'Gross, settled and remaining')}
        <div class="table-card">
          ${renderTable(['Member', 'Gross Owed', 'Settled', 'Remaining', 'Expenses', 'Settlements'], balanceRows, {
            numericColumns: [1, 2, 3, 4, 5],
            nowrapColumns: [1, 2, 3, 4, 5],
            columnWidths: ['30%', '14%', '14%', '14%', '14%', '14%'],
            footer: [['Totals', fmtCur(detail?.totals?.member_owed_gross_total || 0), fmtCur(detail?.totals?.member_settled_total || 0), fmtCur(detail?.totals?.member_owed_total || 0), '', '']],
          })}
        </div>
        <div class="spacer"></div>
        ${renderSectionBand('Settlement History', 'How balances were adjusted')}
        <div class="table-card">
          ${renderTable(['Date', 'Member', 'Mode', 'Notes', 'Amount'], settlementRows, {
            numericColumns: [4],
            nowrapColumns: [0, 4],
            columnWidths: ['16%', '24%', '16%', '26%', '18%'],
            footer: [['', '', '', 'Settled Total', fmtCur(detail?.totals?.member_settled_total || 0)]],
          })}
        </div>
      `,
    });
  }

  if (action === 'custom') {
    const matrixMonths = (options.matrix_months || []).length ? options.matrix_months : (detail?.matrix_months || []);
    const memberScope = String(options.member_scope || 'all');
    const scopedMembers = filterMembers(detail, memberScope, matrixMonths);
    const scopedExpenses = resolveExpenseScope(detail, options.expense_scope || 'current', options.expense_months || []);
    const includeSummary = options.include_summary !== false;
    const includeReport = !!options.include_report;
    const includeMatrix = !!options.include_matrix;
    const includeExpenses = !!options.include_expenses;
    const parts = [];
    const balanceRows = memberBalanceRows(detail);
    const settlementRows = memberSettlementRows(detail);

    if (includeReport || includeExpenses) {
      const rightLabel = includeReport && includeExpenses ? 'Collection & expense report' : includeReport ? 'All-time report' : 'Expense history';
      parts.push(renderSectionBand(includeReport ? 'Monthly Summary' : 'All Expenses', rightLabel));
      if (includeReport && includeExpenses) {
        parts.push(`
          <div class="table-card">
            ${renderTable(['Month', 'Paid Members', 'Collected', 'Expenses', 'Balance'], monthSummaryRows(detail, detail?.totals?.member_count || 0, { coloredPaidColumn: true }), {
              numericColumns: [2, 3, 4],
              rawHtmlColumns: [1],
              nowrapColumns: [2, 3, 4],
              columnWidths: ['20%', '18%', '21%', '21%', '20%'],
              footer: [['All Time Total', '-', fmtCur(detail?.totals?.overall_collected || 0), fmtCur(detail?.totals?.overall_spent || 0), fmtCur(detail?.totals?.overall_balance || 0)]],
            })}
          </div>
        `);
        const expenseRightLabel = options.expense_scope === 'all'
          ? 'Till today'
          : options.expense_scope === 'selected'
            ? `Selected months: ${((options.expense_months || []).map((monthKey) => monthLabel(monthKey)).join(', ') || 'None')}`
            : `Current month: ${monthLabel(detail?.selected_month)}`;
        parts.push('<div class="spacer"></div>');
        parts.push(renderSectionBand('All Expenses', expenseRightLabel));
        parts.push(`
          <div class="table-card">
            ${renderTable(['Date', 'Description', 'Category', 'Amount'], scopedExpenses.map((expense) => [
              createFormatters(prefs).fmtDate(expense.expense_date),
              expense.title || '-',
              expense.category || '-',
              fmtCur(expense.amount || 0),
            ]), {
              numericColumns: [3],
              nowrapColumns: [0, 3],
              columnWidths: ['17%', '41%', '20%', '22%'],
              footer: [['', 'Total Expenses', '', fmtCur(scopedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))]],
            })}
          </div>
        `);
      } else if (includeReport) {
        parts.push(`
          <div class="table-card">
            ${renderTable(['Month', 'Paid Members', 'Collected', 'Expenses', 'Balance'], monthSummaryRows(detail, detail?.totals?.member_count || 0, { coloredPaidColumn: true }), {
              numericColumns: [2, 3, 4],
              rawHtmlColumns: [1],
              nowrapColumns: [2, 3, 4],
              columnWidths: ['20%', '18%', '21%', '21%', '20%'],
              footer: [['All Time Total', '-', fmtCur(detail?.totals?.overall_collected || 0), fmtCur(detail?.totals?.overall_spent || 0), fmtCur(detail?.totals?.overall_balance || 0)]],
            })}
          </div>
        `);
      } else {
        parts.push(`
          <div class="table-card">
            ${renderTable(['Date', 'Title', 'Category', 'Notes', 'Amount'], expenseRows(scopedExpenses), {
              numericColumns: [4],
              nowrapColumns: [0, 4],
              columnWidths: ['15%', '25%', '18%', '24%', '18%'],
              footer: [['', 'Total Expenses', '', '', fmtCur(scopedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))]],
            })}
          </div>
        `);
      }
    }

    if (includeMatrix) {
      const rows = sortMembers(scopedMembers).map((member) => [
        memberLabel(member),
        ...matrixMonths.map((monthKey) => compactMoney((member.contributions_by_month || {})[monthKey] || 0)),
        fmtCur(matrixScopeTotal(member, matrixMonths)),
      ]);
      parts.push('<div class="spacer"></div>');
      parts.push(renderSectionBand('Contribution Matrix', matrixMonths.length ? selectedPeriodRange(matrixMonths) : 'No months selected'));
      parts.push(`<div class="months-note">Months shown: ${escapeHtml(matrixMonths.map((monthKey) => monthLabel(monthKey, true)).join(', ') || 'No months selected')}</div>`);
      parts.push(`
        <div class="table-card">
          ${renderTable(['Member', ...matrixMonths.map((monthKey) => monthLabel(monthKey, true)), 'Total'], rows, {
            compact: true,
            numericColumns: [...matrixMonths.map((_, index) => index + 1), matrixMonths.length + 1],
            nowrapColumns: [...matrixMonths.map((_, index) => index + 1), matrixMonths.length + 1],
          })}
        </div>
      `);
    }

    if (includeReport) {
      parts.push('<div class="spacer"></div>');
      parts.push(renderSectionBand('Member Ledger', 'Gross, settled and remaining'));
      parts.push(`
        <div class="table-card">
          ${renderTable(['Member', 'Gross Owed', 'Settled', 'Remaining', 'Expenses', 'Settlements'], balanceRows, {
            numericColumns: [1, 2, 3, 4, 5],
            nowrapColumns: [1, 2, 3, 4, 5],
            columnWidths: ['30%', '14%', '14%', '14%', '14%', '14%'],
            footer: [['Totals', fmtCur(detail?.totals?.member_owed_gross_total || 0), fmtCur(detail?.totals?.member_settled_total || 0), fmtCur(detail?.totals?.member_owed_total || 0), '', '']],
          })}
        </div>
      `);
      parts.push('<div class="spacer"></div>');
      parts.push(renderSectionBand('Settlement History', 'How balances were adjusted'));
      parts.push(`
        <div class="table-card">
          ${renderTable(['Date', 'Member', 'Mode', 'Notes', 'Amount'], settlementRows, {
            numericColumns: [4],
            nowrapColumns: [0, 4],
            columnWidths: ['16%', '24%', '16%', '26%', '18%'],
            footer: [['', '', '', 'Settled Total', fmtCur(detail?.totals?.member_settled_total || 0)]],
          })}
        </div>
      `);
    }

    return buildPdfShell({
      hero: renderHero({
        title: detail?.society?.name || 'Society',
        location: detail?.society?.location || 'Not added',
        metaRight: `${Number(detail?.totals?.member_count || 0)} Members`,
        period: includeExpenses && options.expense_scope === 'current'
          ? monthLabel(detail?.selected_month)
          : (matrixMonths.length ? selectedPeriodRange(matrixMonths) : societyPeriodRange(detail)),
        cards: includeSummary ? statCardsData(detail, options.expense_scope === 'current' && !includeReport ? 'month' : 'overall') : [],
      }),
      landscape: true,
      body: parts.join(''),
    });
  }

  throw new Error('Unknown society PDF action.');
}

module.exports = {
  buildReportPdfHtml,
  buildStructuredPdfHtml,
  buildSocietyPdfHtml,
};
