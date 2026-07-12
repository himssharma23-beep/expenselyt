let _tenantOverview = null;
let _tenantLoading = false;
let _selectedTenantBuildingId = null;
let _selectedTenantRecordId = null;
let _tenantPageTab = 'overview';
let _tenantEditorTab = 'details';
let _tenantModalFiles = { address_proof: null, photo_attachment: null, proof_attachments: [] };
let _tenantReportFilters = { year: 'all', month_from: '', month_to: '', tenant_id: 'all', room_id: 'all' };
let _tenantInvoiceFilters = { year: 'all', month_from: '', month_to: '', tenant_id: 'all', activity: 'active' };
let _tenantInvoicePager = { page: 1, pageSize: 10 };
let _tenantReportPager = { tenantPage: 1, roomPage: 1, monthPage: 1, pageSize: 8 };

function tenantCaptureViewportPosition() {
  const scroller = document.scrollingElement || document.documentElement || document.body;
  return Number(scroller?.scrollTop || window.scrollY || 0);
}

function tenantRestoreViewportPosition(scrollTop = 0) {
  const target = Math.max(0, Number(scrollTop || 0));
  const apply = () => window.scrollTo({ top: target, behavior: 'auto' });
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
}

function tenantLocalDateValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function tenantCurrentMonthKey() {
  return typeof currentMonthStr === 'function' ? currentMonthStr() : '';
}

function tenantSharedRoomInvoiceForMonth(tenant, invoiceMonth, { excludeTenantId = null } = {}) {
  const roomId = Number(tenant?.room_id || 0);
  const monthKey = String(invoiceMonth || '').trim();
  if (!(roomId > 0) || !/^\d{4}-\d{2}$/.test(monthKey)) return null;
  return (_tenantOverview?.invoices || [])
    .filter((invoice) => {
      if (excludeTenantId != null && String(invoice?.tenant_id || '') === String(excludeTenantId)) return false;
      if (String(invoice?.invoice_month || '') !== monthKey) return false;
      const invoiceTenant = tenantFindRecord(invoice?.tenant_id);
      return Number(invoiceTenant?.room_id || 0) === roomId;
    })
    .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))[0] || null;
}

function tenantChargeProfileForMonth(tenant, invoiceMonth) {
  const targetDate = /^\d{4}-\d{2}$/.test(String(invoiceMonth || '').trim())
    ? `${String(invoiceMonth).trim()}-01`
    : '';
  const history = Array.isArray(tenant?.charge_history) ? tenant.charge_history : [];
  if (!targetDate) return history[0] || null;
  return history.find((row) => {
    const from = String(row?.effective_from || '').trim();
    const to = String(row?.effective_to || '').trim();
    if (!from || from > targetDate) return false;
    if (to && to < targetDate) return false;
    return true;
  }) || history.find((row) => !String(row?.effective_to || '').trim()) || history[0] || null;
}

function tenantInvoiceReadingDefaults(tenant, invoiceMonth = tenantCurrentMonthKey()) {
  const monthKey = String(invoiceMonth || '').trim();
  const ownLatestInvoice = (tenant?.invoices || [])[0] || null;
  const roomInvoice = tenantSharedRoomInvoiceForMonth(tenant, monthKey, { excludeTenantId: tenant?.id });
  const chargeProfile = tenantChargeProfileForMonth(tenant, monthKey);
  if (roomInvoice) {
    return {
      previousUnits: Number(roomInvoice.current_electricity_units || 0),
      currentUnits: Number(roomInvoice.current_electricity_units || 0),
      sourceLabel: `Copied from ${roomInvoice.tenant_name_snapshot || 'roommate'} invoice`,
    };
  }
  return {
    previousUnits: ownLatestInvoice
      ? Number(ownLatestInvoice.current_electricity_units || 0)
      : Number((chargeProfile?.opening_electricity_units ?? tenant?.opening_electricity_units) || 0),
    currentUnits: '',
    sourceLabel: '',
  };
}

function tenantMonthLabel(monthKey) {
  const raw = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw || '-';
  const date = new Date(`${raw}-01T00:00:00`);
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function tenantPreviousMonthKey(monthKey) {
  const raw = String(monthKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function tenantCarryForwardPendingItems(tenant, targetMonthKey) {
  const tenantId = Number(tenant?.id || 0);
  const targetMonth = String(targetMonthKey || '').trim();
  if (!(tenantId > 0) || !/^\d{4}-\d{2}$/.test(targetMonth)) return [];
  const previousMonth = tenantPreviousMonthKey(targetMonth);
  const invoices = (_tenantOverview?.invoices || [])
    .filter((invoice) => Number(invoice?.tenant_id || 0) === tenantId && String(invoice?.invoice_month || '') < targetMonth)
    .sort((a, b) => String(a?.invoice_month || '').localeCompare(String(b?.invoice_month || '')) || Number(a?.id || 0) - Number(b?.id || 0));
  const outstandingByMonth = new Map();

  invoices.forEach((invoice) => {
    const invoiceMonth = String(invoice?.invoice_month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(invoiceMonth)) return;
    const carryItems = (Array.isArray(invoice?.other_charge_items) ? invoice.other_charge_items : [])
      .filter((item) => String(item?.kind || '').trim().toLowerCase() === 'carry_forward_pending' && /^\d{4}-\d{2}$/.test(String(item?.source_invoice_month || '').trim()));
    const carryTotal = tenantNum(carryItems.reduce((sum, item) => sum + tenantNum(item?.amount || 0), 0));
    const baseAmount = Math.max(0, tenantNum(invoice?.total_amount || 0) - carryTotal);
    if (baseAmount > 0) {
      outstandingByMonth.set(invoiceMonth, tenantNum((outstandingByMonth.get(invoiceMonth) || 0) + baseAmount));
    }

    let paymentRemaining = Math.max(0, tenantNum(invoice?.paid_amount || 0));
    carryItems
      .map((item) => String(item.source_invoice_month || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .forEach((sourceMonth) => {
        if (paymentRemaining <= 0) return;
        const currentOutstanding = tenantNum(outstandingByMonth.get(sourceMonth) || 0);
        if (currentOutstanding <= 0) return;
        const applied = Math.min(paymentRemaining, currentOutstanding);
        outstandingByMonth.set(sourceMonth, tenantNum(currentOutstanding - applied));
        paymentRemaining = tenantNum(paymentRemaining - applied);
      });

    if (paymentRemaining > 0) {
      const currentOutstanding = tenantNum(outstandingByMonth.get(invoiceMonth) || 0);
      if (currentOutstanding > 0) {
        const applied = Math.min(paymentRemaining, currentOutstanding);
        outstandingByMonth.set(invoiceMonth, tenantNum(currentOutstanding - applied));
      }
    }
  });

  return [...outstandingByMonth.entries()]
    .map(([monthKey, amount]) => ({ monthKey, amount: tenantNum(amount || 0) }))
    .filter((item) => item.amount > 0)
    .sort((a, b) => String(a.monthKey).localeCompare(String(b.monthKey)))
    .map((item) => ({
      detail: item.monthKey === previousMonth ? 'Last month pending' : `${tenantMonthLabel(item.monthKey)} pending`,
      amount: item.amount,
      kind: 'carry_forward_pending',
      source_invoice_month: item.monthKey,
    }));
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

function tenantPaginationPages(current, total) {
  if (typeof paginationPages === 'function') return paginationPages(current, total);
  const pages = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i += 1) pages.push(i);
    return pages;
  }
  pages.push(1);
  if (current > 3) pages.push('...');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i += 1) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

function tenantPaginate(list = [], page = 1, pageSize = 10) {
  const total = Array.isArray(list) ? list.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, Number(page || 1)), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    total,
    totalPages,
    page: safePage,
    start,
    end: Math.min(start + pageSize, total),
    items: (list || []).slice(start, start + pageSize),
  };
}

function tenantPagerHtml({ page, totalPages, start, end, total, onPage }) {
  if (!(totalPages > 1)) return '';
  const pageCall = (targetPage) => String(onPage || 'void(0)').includes('__PAGE__')
    ? String(onPage).replace(/__PAGE__/g, String(targetPage))
    : `${onPage}(${targetPage})`;
  return `
    <div class="pagination" style="padding:12px 0 2px">
      <div class="pg-meta">
        <span class="pg-range">${start + 1}-${end} of ${total}</span>
      </div>
      <div class="pg-controls">
        <button class="pg-nav" ${page <= 1 ? 'disabled' : ''} onclick="${pageCall(page - 1)}">Prev</button>
        <div class="pg-pages">
          ${tenantPaginationPages(page, totalPages).map((p) => p === '...'
            ? '<span class="pg-ellipsis">...</span>'
            : `<button class="pg-num ${p === page ? 'active' : ''}" onclick="${pageCall(p)}">${p}</button>`).join('')}
        </div>
        <button class="pg-nav" ${page >= totalPages ? 'disabled' : ''} onclick="${pageCall(page + 1)}">Next</button>
      </div>
    </div>`;
}

function tenantInputDateValue(value, fallback = '') {
  if (!value) return fallback;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return tenantLocalDateValue(value);
  }
  const raw = String(value).trim();
  if (!raw) return fallback;
  const directMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return tenantLocalDateValue(parsed);
  return fallback;
}

function tenantNum(value) {
  return Math.round((Number(value || 0) || 0) * 100) / 100;
}

function tenantDefaultStartDate() {
  return tenantLocalDateValue(new Date());
}

function tenantIsInactive(record) {
  if (!record) return false;
  if (!record.is_active) return true;
  const endDate = String(record.end_date || '').trim();
  if (endDate && endDate <= tenantDefaultStartDate()) return true;
  return false;
}

function tenantDefaultShareExpiryDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return tenantLocalDateValue(date);
}

function tenantDefaultName(value) {
  return String(value || '').trim() || 'Tenant';
}

function tenantInitials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'T';
}

function tenantRoomTone(room) {
  return Number(room?.active_tenant_count || (Array.isArray(room?.active_tenants) ? room.active_tenants.length : (room?.active_tenant ? 1 : 0))) > 0 ? 'green' : 'amber';
}

function tenantRoomActiveTenants(room) {
  if (Array.isArray(room?.active_tenants)) return room.active_tenants;
  return room?.active_tenant ? [room.active_tenant] : [];
}

function tenantRoomOccupantCount(room, excludeTenantId = null) {
  return tenantRoomActiveTenants(room).filter((tenant) => String(tenant?.id || '') !== String(excludeTenantId || '')).length;
}

function tenantDefaultSplitConfig(shared = false) {
  return {
    divide_rent: !!shared,
    divide_electricity: !!shared,
    divide_sewerage: !!shared,
    divide_water: !!shared,
    divide_cleaning: !!shared,
    divide_other: !!shared,
  };
}

function tenantNormalizeOtherChargeItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      detail: String(item?.detail || '').trim(),
      amount: tenantNum(item?.amount || 0),
      kind: String(item?.kind || '').trim(),
      source_invoice_month: String(item?.source_invoice_month || '').trim(),
    }))
    .filter((item) => item.detail || item.amount || item.kind);
}

function tenantDivideChargeAmount(amount, shouldDivide, divisor) {
  const safeAmount = tenantNum(amount);
  const safeDivisor = Math.max(1, Number(divisor || 1));
  if (!shouldDivide || safeDivisor <= 1) return safeAmount;
  return tenantNum(safeAmount / safeDivisor);
}

function tenantApplySplitToOtherChargeItems(items = [], shouldDivide, divisor) {
  return tenantNormalizeOtherChargeItems(items).map((item) => (
    item.kind === 'carry_forward_pending'
      ? item
      : { ...item, amount: tenantDivideChargeAmount(item.amount, shouldDivide, divisor) }
  ));
}

function tenantReadSplitConfig(prefix) {
  const key = String(prefix || '').trim();
  return {
    divide_rent: !!document.getElementById(`${key}SplitRent`)?.checked,
    divide_electricity: !!document.getElementById(`${key}SplitElectricity`)?.checked,
    divide_sewerage: !!document.getElementById(`${key}SplitSewerage`)?.checked,
    divide_water: !!document.getElementById(`${key}SplitWater`)?.checked,
    divide_cleaning: !!document.getElementById(`${key}SplitCleaning`)?.checked,
    divide_other: !!document.getElementById(`${key}SplitOther`)?.checked,
  };
}

function tenantSplitOptionsCard(prefix, roommateCount, splitConfig = tenantDefaultSplitConfig(roommateCount > 1)) {
  if (!(roommateCount > 1)) return '';
  const row = (id, label, checked) => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--br);border-radius:10px;background:#fff">
      <input type="checkbox" id="${prefix}${id}" ${checked ? 'checked' : ''} onchange="window.__tenantSplitChangeHandler && window.__tenantSplitChangeHandler(this)">
      <span style="font-size:12px;font-weight:700;color:var(--t2)">${label}</span>
    </label>`;
  return `
    <div class="card" style="padding:14px;margin-top:14px;background:#f7fbf8">
      <div style="font-size:14px;font-weight:800;color:var(--t1)">Divide charges among ${roommateCount} tenants</div>
      <div style="font-size:12px;color:var(--t3);margin-top:4px">Choose which bill parts should be split equally for this shared room.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:12px">
        ${row('SplitRent', 'Divide Rent', splitConfig.divide_rent)}
        ${row('SplitElectricity', 'Divide Electricity', splitConfig.divide_electricity)}
        ${row('SplitSewerage', 'Divide Sewerage', splitConfig.divide_sewerage)}
        ${row('SplitWater', 'Divide Water', splitConfig.divide_water)}
        ${row('SplitCleaning', 'Divide Cleaning', splitConfig.divide_cleaning)}
        ${row('SplitOther', 'Divide Other Charges', splitConfig.divide_other)}
      </div>
    </div>`;
}

function tenantBuildingTone(index) {
  return ['green', 'blue', 'amber', 'green'][index % 4] || 'green';
}

function tenantChip(text, tone = 'neutral') {
  return `<span class="tenant-ledger-chip tenant-ledger-chip-${tone}">${escHtml(text || '')}</span>`;
}

function tenantStatCard(label, value, meta, tone, icon) {
  return `
    <div class="tenant-ledger-stat-card tenant-ledger-stat-${tone}">
      <span class="tenant-ledger-stat-icon">${icon}</span>
      <div class="tenant-ledger-stat-label">${label}</div>
      <div class="tenant-ledger-stat-value">${value}</div>
      <div class="tenant-ledger-stat-meta">${meta}</div>
    </div>`;
}

function tenantFindBuilding(buildingId) {
  return (_tenantOverview?.buildings || []).find((item) => String(item.id) === String(buildingId)) || null;
}

function tenantFindRecord(recordId) {
  return (_tenantOverview?.tenants || []).find((item) => String(item.id) === String(recordId)) || null;
}

function tenantFindRoom(roomId) {
  return (_tenantOverview?.rooms || []).find((item) => String(item.id) === String(roomId)) || null;
}

function tenantCurrentChargeProfile(record, dateValue = tenantDefaultStartDate()) {
  const history = Array.isArray(record?.charge_history) ? record.charge_history : [];
  const target = String(dateValue || '').trim();
  return history.find((row) => {
    const from = String(row.effective_from || '');
    const to = String(row.effective_to || '');
    if (!from || from > target) return false;
    if (to && to < target) return false;
    return true;
  }) || history[0] || null;
}

function tenantChargeHistoryHtml(history = []) {
  const list = Array.isArray(history) ? history : [];
  if (!list.length) {
    return '<div style="font-size:12px;color:var(--t3)">No historic charge slabs saved yet.</div>';
  }
  return list.map((row) => `
    <div style="display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr 1fr;gap:10px;padding:10px 0;border-bottom:1px solid var(--br)">
      <div>
        <div style="font-size:12px;font-weight:800;color:var(--t1)">${escHtml(tenantDateLabel(row.effective_from))} ${row.effective_to ? `to ${escHtml(tenantDateLabel(row.effective_to))}` : 'onwards'}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:4px">Opening units ${Number(row.opening_electricity_units || 0)}</div>
      </div>
      <div style="font-size:12px;color:var(--t1)">Rent ${fmtCur(row.rent_amount || 0)}</div>
      <div style="font-size:12px;color:var(--t1)">Unit ${fmtCur(row.electricity_unit_price || 0)}</div>
      <div style="font-size:12px;color:var(--t1)">Sewerage ${fmtCur(row.sewerage_charge || 0)}</div>
      <div style="font-size:12px;color:var(--t1)">Water ${fmtCur(row.water_charge || 0)} · Cleaning ${fmtCur(row.cleaning_charge || 0)}</div>
    </div>`).join('');
}

function tenantInvoiceStatusLabel(status) {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'paid') return 'Paid';
  if (normalized === 'partial_paid') return 'Partial Paid';
  return 'Pending';
}

function tenantInvoiceStatusTone(status) {
  const normalized = String(status || 'pending').trim().toLowerCase();
  if (normalized === 'paid') return 'green';
  if (normalized === 'partial_paid') return 'amber';
  return 'neutral';
}

function tenantInvoiceTenantCell(invoice) {
  const tenant = tenantFindRecord(invoice?.tenant_id);
  const inactive = tenantIsInactive(tenant);
  return `
    <div style="display:grid;gap:4px">
      <div>${escHtml(invoice?.tenant_name_snapshot || '-')}</div>
      ${inactive ? `<div>${tenantChip(tenant?.end_date ? `Inactive · Ended ${tenantDateLabel(tenant.end_date)}` : 'Inactive', 'amber')}</div>` : ''}
    </div>`;
}

function tenantInvoiceStatusOptions(selectedStatus) {
  const current = String(selectedStatus || 'pending').trim().toLowerCase();
  return [
    ['pending', 'Pending'],
    ['paid', 'Paid'],
    ['partial_paid', 'Partial Paid'],
  ].map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
}

function tenantInvoiceStatusButtons(invoice) {
  const current = String(invoice?.payment_status || 'pending').trim().toLowerCase();
  const statusIcons = {
    pending: `
      <svg class="tenant-status-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8"></circle>
        <path d="M12 8v4l3 2"></path>
      </svg>`,
    paid: `
      <svg class="tenant-status-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8"></circle>
        <path d="m8.5 12 2.3 2.3 4.7-4.8"></path>
      </svg>`,
    partial_paid: `
      <svg class="tenant-status-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4a8 8 0 1 1-8 8"></path>
        <path d="M12 4v8H4"></path>
      </svg>`,
  };
  return `
    <div class="tenant-status-toggle">
      ${[
        ['pending', 'Pending'],
        ['paid', 'Paid'],
        ['partial_paid', 'Partial'],
      ].map(([value, label]) => `
        <button
          type="button"
          class="tenant-status-btn ${current === value ? `active ${value}` : ''}"
          title="${label}"
          aria-label="${label}"
          onclick="updateTenantInvoiceStatusInline(${Number(invoice?.id || 0)}, '${value}')"
        >${statusIcons[value] || ''}</button>
      `).join('')}
    </div>`;
}

function tenantActionIcon(name) {
  const icons = {
    invoice: `
      <svg class="tenant-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h7l4 4v14H7z"></path>
        <path d="M14 3v5h5"></path>
        <path d="M10 12h5"></path>
        <path d="M10 16h4"></path>
      </svg>`,
    import: `
      <svg class="tenant-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v10"></path>
        <path d="m8 10 4 4 4-4"></path>
        <path d="M5 19h14"></path>
      </svg>`,
    view: `
      <svg class="tenant-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"></path>
        <circle cx="12" cy="12" r="2.6"></circle>
      </svg>`,
    pdf: `
      <svg class="tenant-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h7l4 4v14H7z"></path>
        <path d="M14 3v5h5"></path>
        <path d="M12 10v7"></path>
        <path d="m9 14 3 3 3-3"></path>
      </svg>`,
    share: `
      <svg class="tenant-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 13a5 5 0 0 1 0-7l1.2-1.2a5 5 0 0 1 7 7L17 13"></path>
        <path d="M14 11a5 5 0 0 1 0 7l-1.2 1.2a5 5 0 0 1-7-7L7 11"></path>
      </svg>`,
    portal: `
      <svg class="tenant-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 3h7v7"></path>
        <path d="M10 14 21 3"></path>
        <path d="M21 14v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h4"></path>
      </svg>`,
    edit: `
      <svg class="tenant-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 20 4.2-1 9.4-9.4a1.8 1.8 0 0 0 0-2.5l-.7-.7a1.8 1.8 0 0 0-2.5 0L5 15.8 4 20z"></path>
        <path d="m13.5 7.5 3 3"></path>
      </svg>`,
    delete: `
      <svg class="tenant-action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16"></path>
        <path d="M9 7V4h6v3"></path>
        <path d="M7 7l1 13h8l1-13"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
      </svg>`,
  };
  return icons[name] || icons.edit;
}

function openTenantPortalForPhone(contactNumber = '') {
  const digits = String(contactNumber || '').replace(/\D+/g, '').slice(-10);
  const href = digits
    ? `/tenant-portal?phone=${encodeURIComponent(digits)}`
    : '/tenant-portal';
  window.open(href, '_blank', 'noopener');
}

function tenantInvoiceOtherChargeRows(items = []) {
  const list = Array.isArray(items) && items.length ? items : [{ detail: '', amount: '' }];
  return list.map((item, index) => `
    <div class="fg tenant-invoice-other-row" data-index="${index}" style="margin-bottom:8px">
      <label class="fl">Detail<input class="fi tenant-invoice-other-detail" value="${escHtml(item.detail || '')}" placeholder="Expense / adjustment"></label>
      <label class="fl">Amount<input class="fi tenant-invoice-other-amount" type="number" step="0.01" value="${escHtml(item.amount === '' || item.amount == null ? '' : String(item.amount))}" placeholder="Amount"></label>
    </div>`).join('');
}

function addTenantInvoiceOtherChargeRow() {
  const wrap = document.getElementById('tenantInvoiceOtherRows');
  if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', tenantInvoiceOtherChargeRows([{ detail: '', amount: '' }]));
}

function tenantBulkRowOtherChargeRows(tenantId, items = []) {
  const list = Array.isArray(items) && items.length ? items : [{ detail: '', amount: '' }];
  return list.map((item) => `
    <div class="tenant-bulk-other-row" data-tenant-id="${Number(tenantId)}" style="display:grid;grid-template-columns:minmax(160px,1.4fr) minmax(110px,.8fr) auto;gap:8px;margin-bottom:8px">
      <input class="fi tenant-bulk-other-detail" value="${escHtml(item.detail || '')}" placeholder="Expense">
      <input class="fi tenant-bulk-other-amount" type="number" step="0.01" value="${escHtml(item.amount === '' || item.amount == null ? '' : String(item.amount))}" placeholder="Amount">
      <button class="btn btn-g btn-sm" style="color:var(--red)" onclick="removeTenantBulkOtherChargeRow(this)">Remove</button>
    </div>`).join('');
}

function tenantBulkInvoicePriorInvoice(tenant, monthKey) {
  const target = String(monthKey || '').trim();
  const invoices = Array.isArray(tenant?.invoices) ? tenant.invoices : [];
  const exact = invoices.find((invoice) => String(invoice.invoice_month || '') === target);
  if (exact) return exact;
  return invoices
    .filter((invoice) => String(invoice.invoice_month || '') < target)
    .sort((a, b) => String(b.invoice_month || '').localeCompare(String(a.invoice_month || '')) || Number(b.id) - Number(a.id))[0] || null;
}

function tenantBulkInvoiceChargeProfile(tenant, monthKey) {
  return tenantCurrentChargeProfile(tenant, `${String(monthKey || tenantCurrentMonthKey())}-01`) || tenant || {};
}

function tenantBulkInvoiceOtherItems(tenantId) {
  return [...document.querySelectorAll(`.tenant-bulk-other-row[data-tenant-id="${Number(tenantId)}"]`)]
    .map((row) => {
      const detail = row.querySelector('.tenant-bulk-other-detail')?.value?.trim() || '';
      const amountRaw = row.querySelector('.tenant-bulk-other-amount')?.value || '';
      const amount = amountRaw === '' ? 0 : Number(amountRaw);
      if (!detail && !amount) return null;
      return { detail, amount };
    })
    .filter(Boolean);
}

function tenantBulkSplitPrefix(tenantId) {
  return `tenantBulk_${Number(tenantId)}_`;
}

function tenantBulkRoommateCount(tenant) {
  const room = tenantFindRoom(tenant?.room_id);
  return Math.max(1, tenantRoomActiveTenants(room).length || 1);
}

function tenantBulkInvoiceEstimate(tenant, monthKey) {
  const tenantId = Number(tenant?.id || 0);
  const profile = tenantBulkInvoiceChargeProfile(tenant, monthKey);
  const priorInvoice = tenantBulkInvoicePriorInvoice(tenant, monthKey);
  const roommateCount = tenantBulkRoommateCount(tenant);
  const splitConfig = tenantReadSplitConfig(tenantBulkSplitPrefix(tenantId));
  const previousUnits = priorInvoice ? Number(priorInvoice.current_electricity_units || 0) : Number(profile.opening_electricity_units || tenant?.opening_electricity_units || 0);
  const currentUnits = Number(document.getElementById(`tenantBulkCurrentUnits_${tenantId}`)?.value || previousUnits);
  const usedUnits = Math.max(0, currentUnits - previousUnits);
  const electricityAmount = tenantDivideChargeAmount(
    tenantNum(usedUnits * tenantNum(profile.electricity_unit_price || tenant?.electricity_unit_price || 0)),
    splitConfig.divide_electricity,
    roommateCount
  );
  const recurringItems = tenantApplySplitToOtherChargeItems(
    tenantNormalizeOtherChargeItems(profile.monthly_additional_charges || tenant?.monthly_additional_charges || []),
    splitConfig.divide_other,
    roommateCount
  );
  const nextInvoiceItems = tenantApplySplitToOtherChargeItems(
    tenantNormalizeOtherChargeItems(tenant?.next_invoice_charge_items || []),
    splitConfig.divide_other,
    roommateCount
  );
  const carryForwardItems = tenantCarryForwardPendingItems(tenant, monthKey);
  const otherItems = tenantBulkInvoiceOtherItems(tenantId);
  const otherTotal = tenantNum([...recurringItems, ...nextInvoiceItems, ...carryForwardItems, ...otherItems].reduce((sum, item) => sum + tenantNum(item.amount || 0), 0));
  const total = tenantNum(
    tenantDivideChargeAmount(tenantNum(profile.rent_amount || tenant?.rent_amount || 0), splitConfig.divide_rent, roommateCount)
    + tenantDivideChargeAmount(tenantNum(profile.sewerage_charge || tenant?.sewerage_charge || 0), splitConfig.divide_sewerage, roommateCount)
    + tenantDivideChargeAmount(tenantNum(profile.water_charge || tenant?.water_charge || 0), splitConfig.divide_water, roommateCount)
    + tenantDivideChargeAmount(tenantNum(profile.cleaning_charge || tenant?.cleaning_charge || 0), splitConfig.divide_cleaning, roommateCount)
    + electricityAmount
    + otherTotal
  );
  return { profile, previousUnits, currentUnits, usedUnits, electricityAmount, recurringItems, nextInvoiceItems, carryForwardItems, otherItems, otherTotal, total, splitConfig, roommateCount };
}

function updateTenantBulkInvoiceRow(tenantId) {
  const tenant = tenantFindRecord(tenantId);
  const monthKey = document.getElementById('tenantBulkInvoiceMonth')?.value || tenantCurrentMonthKey();
  if (!tenant) return;
  const estimate = tenantBulkInvoiceEstimate(tenant, monthKey);
  const totalEl = document.getElementById(`tenantBulkEstimate_${Number(tenantId)}`);
  const prevEl = document.getElementById(`tenantBulkPrevUnits_${Number(tenantId)}`);
  if (totalEl) totalEl.textContent = fmtCur(estimate.total);
  if (prevEl) prevEl.textContent = String(estimate.previousUnits);
  const currentInput = document.getElementById(`tenantBulkCurrentUnits_${Number(tenantId)}`);
  if (currentInput) currentInput.min = String(estimate.previousUnits);
  const status = document.getElementById(`tenantBulkStatus_${Number(tenantId)}`)?.value || 'pending';
  const paidWrap = document.getElementById(`tenantBulkPaidWrap_${Number(tenantId)}`);
  if (paidWrap) paidWrap.style.display = status === 'partial_paid' ? '' : 'none';
  updateTenantBulkInvoiceTotals();
}

function updateTenantBulkInvoiceTotals() {
  const monthKey = document.getElementById('tenantBulkInvoiceMonth')?.value || tenantCurrentMonthKey();
  const tenants = (_tenantOverview?.tenants || []).filter((tenant) => String(tenant.building_id) === String(_selectedTenantBuildingId) && tenant.is_active);
  const total = tenantNum(tenants.reduce((sum, tenant) => sum + tenantBulkInvoiceEstimate(tenant, monthKey).total, 0));
  const totalEl = document.getElementById('tenantBulkInvoiceGrandTotal');
  if (totalEl) totalEl.textContent = fmtCur(total);
}

function addTenantBulkOtherChargeRow(tenantId) {
  const wrap = document.getElementById(`tenantBulkOtherWrap_${Number(tenantId)}`);
  if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', tenantBulkRowOtherChargeRows(tenantId, [{ detail: '', amount: '' }]));
}

function removeTenantBulkOtherChargeRow(button) {
  const row = button?.closest('.tenant-bulk-other-row');
  const tenantId = Number(row?.dataset?.tenantId || 0);
  row?.remove();
  if (tenantId > 0 && !document.querySelector(`.tenant-bulk-other-row[data-tenant-id="${tenantId}"]`)) {
    addTenantBulkOtherChargeRow(tenantId);
  }
  if (tenantId > 0) updateTenantBulkInvoiceRow(tenantId);
}

function setTenantPageTab(tab) {
  _tenantPageTab = String(tab || 'overview');
  renderTenantsPage();
}

function bindTenantsPageInteractions(main) {
  if (!main) return;
  main.querySelectorAll('[data-tenant-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      setTenantPageTab(button.dataset.tenantTab || 'overview');
    });
  });
}

async function loadTenantsPage(options = {}) {
  const { skipLoadingRender = false } = options || {};
  _tenantLoading = true;
  if (!skipLoadingRender) renderTenantsPage();
  try {
    const overview = await api('/api/tenants/overview');
    if (overview?.error) {
      _tenantOverview = { buildings: [], rooms: [], tenants: [], invoices: [], totals: {} };
      toast(overview.error || 'Could not load tenants.', 'error');
    } else {
      _tenantOverview = overview;
    }
    const buildings = _tenantOverview?.buildings || [];
    if (!_selectedTenantBuildingId && buildings.length) _selectedTenantBuildingId = buildings[0].id;
    if (_selectedTenantBuildingId && !buildings.some((item) => String(item.id) === String(_selectedTenantBuildingId))) {
      _selectedTenantBuildingId = buildings[0]?.id || null;
    }
    const selectedBuilding = tenantFindBuilding(_selectedTenantBuildingId);
    const buildingTenants = (selectedBuilding?.rooms || []).map((room) => room.active_tenant).filter(Boolean);
    if (!_selectedTenantRecordId && buildingTenants.length) _selectedTenantRecordId = buildingTenants[0].id;
    if (_selectedTenantRecordId && !_tenantOverview?.tenants?.some((item) => String(item.id) === String(_selectedTenantRecordId))) {
      _selectedTenantRecordId = buildingTenants[0]?.id || null;
    }
  } catch (error) {
    console.error('loadTenantsPage failed', error);
    _tenantOverview = _tenantOverview || { buildings: [], rooms: [], tenants: [], invoices: [], totals: {} };
    toast('Could not load tenants.', 'error');
  } finally {
    _tenantLoading = false;
    if (typeof window.refreshApprovalBadges === 'function') window.refreshApprovalBadges(true);
    renderTenantsPage();
  }
}

function openTenantBuilding(buildingId) {
  _selectedTenantBuildingId = buildingId;
  const selectedBuilding = tenantFindBuilding(buildingId);
  const firstTenant = (selectedBuilding?.rooms || []).map((room) => room.active_tenant).find(Boolean);
  _selectedTenantRecordId = firstTenant?.id || null;
  renderTenantsPage();
}

function setTenantSelectedBuilding(buildingId) {
  openTenantBuilding(buildingId);
}

function openTenantRecord(recordId) {
  _selectedTenantRecordId = recordId;
  renderTenantsPage();
}

function setTenantReportFilter(key, value) {
  _tenantReportFilters = {
    ..._tenantReportFilters,
    [key]: String(value ?? '').trim(),
  };
  _tenantReportPager.tenantPage = 1;
  _tenantReportPager.roomPage = 1;
  _tenantReportPager.monthPage = 1;
  renderTenantsPage();
}

function resetTenantReportFilters() {
  _tenantReportFilters = { year: 'all', month_from: '', month_to: '', tenant_id: 'all', room_id: 'all' };
  _tenantReportPager.tenantPage = 1;
  _tenantReportPager.roomPage = 1;
  _tenantReportPager.monthPage = 1;
  renderTenantsPage();
}

function setTenantInvoiceFilter(key, value) {
  _tenantInvoiceFilters = {
    ..._tenantInvoiceFilters,
    [key]: String(value ?? '').trim(),
  };
  _tenantInvoicePager.page = 1;
  renderTenantsPage();
}

function resetTenantInvoiceFilters() {
  _tenantInvoiceFilters = { year: 'all', month_from: '', month_to: '', tenant_id: 'all', activity: 'active' };
  _tenantInvoicePager.page = 1;
  renderTenantsPage();
}

function tenantInvoiceSortKey(monthKey) {
  const raw = String(monthKey || '').trim();
  return /^\d{4}-\d{2}$/.test(raw) ? raw : '';
}

function tenantMonthYearFromKey(monthKey) {
  return Number(String(monthKey || '').slice(0, 4)) || 0;
}

function tenantPdfHelper() {
  if (typeof _P === 'undefined') {
    toast('PDF generator is not available right now.', 'error');
    return null;
  }
  return _P;
}

function getTenantBuildingInvoices(building) {
  return (_tenantOverview?.invoices || []).filter((invoice) => {
    const tenant = tenantFindRecord(invoice.tenant_id);
    return String(tenant?.building_id || '') === String(building?.id || '');
  });
}

function getTenantMonthInvoices(building, monthKey) {
  const month = tenantInvoiceSortKey(monthKey);
  if (!month) return [];
  return getTenantBuildingInvoices(building)
    .filter((invoice) => tenantInvoiceSortKey(invoice.invoice_month) === month)
    .sort((a, b) => String(a.room_label_snapshot || '').localeCompare(String(b.room_label_snapshot || '')) || String(a.tenant_name_snapshot || '').localeCompare(String(b.tenant_name_snapshot || '')) || Number(a.id) - Number(b.id));
}

function getTenantFilteredInvoices(building, filters = _tenantInvoiceFilters) {
  const buildingTenants = (_tenantOverview?.tenants || []).filter((tenant) => String(tenant.building_id) === String(building?.id || ''));
  const buildingInvoices = getTenantBuildingInvoices(building);
  const years = [...new Set(buildingInvoices.map((invoice) => tenantMonthYearFromKey(invoice.invoice_month)).filter(Boolean))].sort((a, b) => b - a);
  const months = [...new Set(buildingInvoices.map((invoice) => tenantInvoiceSortKey(invoice.invoice_month)).filter(Boolean))].sort();
  const activeYear = filters.year === 'all' || years.includes(Number(filters.year)) ? filters.year : 'all';
  const activeTenantId = filters.tenant_id === 'all' || buildingTenants.some((tenant) => String(tenant.id) === String(filters.tenant_id)) ? filters.tenant_id : 'all';
  const activeActivity = ['all', 'active', 'inactive'].includes(String(filters.activity || '').trim()) ? String(filters.activity || 'all').trim() : 'all';
  const activeMonthFrom = months.includes(filters.month_from) ? filters.month_from : '';
  const activeMonthTo = months.includes(filters.month_to) ? filters.month_to : '';
  const invoices = buildingInvoices.filter((invoice) => {
    const tenant = tenantFindRecord(invoice.tenant_id);
    if (activeYear !== 'all' && tenantMonthYearFromKey(invoice.invoice_month) !== Number(activeYear)) return false;
    if (activeTenantId !== 'all' && String(invoice.tenant_id) !== String(activeTenantId)) return false;
    if (activeActivity === 'active' && tenantIsInactive(tenant)) return false;
    if (activeActivity === 'inactive' && !tenantIsInactive(tenant)) return false;
    const monthKey = tenantInvoiceSortKey(invoice.invoice_month);
    if (activeMonthFrom && monthKey && monthKey < activeMonthFrom) return false;
    if (activeMonthTo && monthKey && monthKey > activeMonthTo) return false;
    return true;
  }).sort((a, b) => String(b.invoice_month || '').localeCompare(String(a.invoice_month || '')) || Number(b.id) - Number(a.id));
  return { buildingTenants, buildingInvoices, invoices, years, months, activeYear, activeTenantId, activeActivity, activeMonthFrom, activeMonthTo };
}

function setTenantInvoicePage(page) {
  _tenantInvoicePager.page = Math.max(1, Number(page || 1));
  renderTenantsPage();
}

function setTenantReportPage(section, page) {
  const keyMap = {
    tenant: 'tenantPage',
    room: 'roomPage',
    month: 'monthPage',
  };
  const key = keyMap[String(section || '').trim()];
  if (!key) return;
  _tenantReportPager[key] = Math.max(1, Number(page || 1));
  renderTenantsPage();
}

function getTenantReportSnapshot(building) {
  const buildingRooms = building?.rooms || [];
  const roomMap = new Map(buildingRooms.map((room) => [String(room.id), room]));
  const buildingTenants = (_tenantOverview?.tenants || []).filter((tenant) => String(tenant.building_id) === String(building?.id || ''));
  const buildingInvoices = getTenantBuildingInvoices(building);
  const years = [...new Set(buildingInvoices.map((invoice) => tenantMonthYearFromKey(invoice.invoice_month)).filter(Boolean))].sort((a, b) => b - a);
  const months = [...new Set(buildingInvoices.map((invoice) => tenantInvoiceSortKey(invoice.invoice_month)).filter(Boolean))].sort();
  const activeYear = _tenantReportFilters.year === 'all' || years.includes(Number(_tenantReportFilters.year))
    ? _tenantReportFilters.year
    : 'all';
  const activeTenantId = _tenantReportFilters.tenant_id === 'all' || buildingTenants.some((tenant) => String(tenant.id) === String(_tenantReportFilters.tenant_id))
    ? _tenantReportFilters.tenant_id
    : 'all';
  const activeRoomId = _tenantReportFilters.room_id === 'all' || buildingRooms.some((room) => String(room.id) === String(_tenantReportFilters.room_id))
    ? _tenantReportFilters.room_id
    : 'all';
  const activeMonthFrom = months.includes(_tenantReportFilters.month_from) ? _tenantReportFilters.month_from : '';
  const activeMonthTo = months.includes(_tenantReportFilters.month_to) ? _tenantReportFilters.month_to : '';
  const filteredInvoices = buildingInvoices.filter((invoice) => {
    const tenant = tenantFindRecord(invoice.tenant_id);
    if (activeYear !== 'all' && tenantMonthYearFromKey(invoice.invoice_month) !== Number(activeYear)) return false;
    if (activeTenantId !== 'all' && String(invoice.tenant_id) !== String(activeTenantId)) return false;
    if (activeRoomId !== 'all' && String(tenant?.room_id || '') !== String(activeRoomId)) return false;
    const monthKey = tenantInvoiceSortKey(invoice.invoice_month);
    if (activeMonthFrom && monthKey && monthKey < activeMonthFrom) return false;
    if (activeMonthTo && monthKey && monthKey > activeMonthTo) return false;
    return true;
  }).sort((a, b) => String(b.invoice_month || '').localeCompare(String(a.invoice_month || '')) || Number(b.id) - Number(a.id));
  const totalAmount = filteredInvoices.reduce((sum, invoice) => sum + tenantNum(invoice.total_amount || 0), 0);
  const totalRent = filteredInvoices.reduce((sum, invoice) => sum + tenantNum(invoice.rent_amount_snapshot || 0), 0);
  const totalElectricity = filteredInvoices.reduce((sum, invoice) => sum + tenantNum(invoice.electricity_amount || 0), 0);
  const totalOther = filteredInvoices.reduce((sum, invoice) => sum + tenantNum(invoice.other_charges_snapshot || 0), 0);
  const invoiceCount = filteredInvoices.length;
  const avgInvoice = invoiceCount ? tenantNum(totalAmount / invoiceCount) : 0;
  const tenantTotals = buildingTenants.map((tenant) => {
    const total = filteredInvoices
      .filter((invoice) => String(invoice.tenant_id) === String(tenant.id))
      .reduce((sum, invoice) => sum + tenantNum(invoice.total_amount || 0), 0);
    return { tenant, total: tenantNum(total) };
  }).filter((entry) => entry.total > 0).sort((a, b) => b.total - a.total);
  const roomTotals = buildingRooms.map((room) => {
    const total = filteredInvoices
      .filter((invoice) => {
        const tenant = tenantFindRecord(invoice.tenant_id);
        return String(tenant?.room_id || '') === String(room.id);
      })
      .reduce((sum, invoice) => sum + tenantNum(invoice.total_amount || 0), 0);
    return { room, total: tenantNum(total) };
  }).filter((entry) => entry.total > 0).sort((a, b) => b.total - a.total);
  const monthRows = [...new Set(filteredInvoices.map((invoice) => tenantInvoiceSortKey(invoice.invoice_month)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a))
    .map((monthKey) => {
      const monthInvoices = filteredInvoices.filter((invoice) => tenantInvoiceSortKey(invoice.invoice_month) === monthKey);
      return {
        monthKey,
        invoice_count: monthInvoices.length,
        total: tenantNum(monthInvoices.reduce((sum, invoice) => sum + tenantNum(invoice.total_amount || 0), 0)),
        electricity: tenantNum(monthInvoices.reduce((sum, invoice) => sum + tenantNum(invoice.electricity_amount || 0), 0)),
      };
    });
  return {
    roomMap,
    buildingTenants,
    buildingRooms,
    filteredInvoices,
    years,
    months,
    activeYear,
    activeTenantId,
    activeRoomId,
    activeMonthFrom,
    activeMonthTo,
    totalAmount,
    totalRent,
    totalElectricity,
    totalOther,
    invoiceCount,
    avgInvoice,
    tenantTotals,
    roomTotals,
    monthRows,
  };
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

function renderTenantReportsTab(building) {
  const snapshot = getTenantReportSnapshot(building);
  const {
    roomMap, buildingTenants, buildingRooms, years, months,
    activeYear, activeTenantId, activeRoomId, activeMonthFrom, activeMonthTo,
    totalAmount, totalRent, totalElectricity, totalOther, invoiceCount, avgInvoice,
    tenantTotals, roomTotals, monthRows,
  } = snapshot;
  const pagedTenantTotals = tenantPaginate(tenantTotals, _tenantReportPager.tenantPage, _tenantReportPager.pageSize);
  const pagedRoomTotals = tenantPaginate(roomTotals, _tenantReportPager.roomPage, _tenantReportPager.pageSize);
  const pagedMonthRows = tenantPaginate(monthRows, _tenantReportPager.monthPage, _tenantReportPager.pageSize);
  _tenantReportPager.tenantPage = pagedTenantTotals.page;
  _tenantReportPager.roomPage = pagedRoomTotals.page;
  _tenantReportPager.monthPage = pagedMonthRows.page;

  return `
    <div class="tenant-ledger-stack">
      <div class="card tenant-ledger-section-card">
        <div class="tenant-ledger-section-head">
          <div>
            <div class="tenant-ledger-section-title">Reports Filters</div>
            <div class="tenant-ledger-section-sub">Check totals by year, month range, tenant, or room.</div>
          </div>
          <button class="btn btn-s btn-sm" onclick="downloadTenantReportPdf(${Number(building?.id || 0)})">Report PDF</button>
        </div>
        <div class="tenant-ledger-report-filters">
          <label class="fl">Year
            <select class="fi" onchange="setTenantReportFilter('year', this.value)">
              <option value="all" ${activeYear === 'all' ? 'selected' : ''}>All years</option>
              ${years.map((year) => `<option value="${year}" ${String(activeYear) === String(year) ? 'selected' : ''}>${year}</option>`).join('')}
            </select>
          </label>
          <label class="fl">From Month
            <select class="fi" onchange="setTenantReportFilter('month_from', this.value)">
              <option value="" ${!activeMonthFrom ? 'selected' : ''}>Start</option>
              ${months.map((month) => `<option value="${escHtml(month)}" ${activeMonthFrom === month ? 'selected' : ''}>${escHtml(tenantMonthLabel(month))}</option>`).join('')}
            </select>
          </label>
          <label class="fl">To Month
            <select class="fi" onchange="setTenantReportFilter('month_to', this.value)">
              <option value="" ${!activeMonthTo ? 'selected' : ''}>Till now</option>
              ${months.map((month) => `<option value="${escHtml(month)}" ${activeMonthTo === month ? 'selected' : ''}>${escHtml(tenantMonthLabel(month))}</option>`).join('')}
            </select>
          </label>
          <label class="fl">Tenant
            <select class="fi" onchange="setTenantReportFilter('tenant_id', this.value)">
              <option value="all" ${activeTenantId === 'all' ? 'selected' : ''}>All tenants</option>
              ${buildingTenants.map((tenant) => `<option value="${Number(tenant.id)}" ${String(activeTenantId) === String(tenant.id) ? 'selected' : ''}>${escHtml(tenant.tenant_name || 'Tenant')}</option>`).join('')}
            </select>
          </label>
          <label class="fl">Room
            <select class="fi" onchange="setTenantReportFilter('room_id', this.value)">
              <option value="all" ${activeRoomId === 'all' ? 'selected' : ''}>All rooms</option>
              ${buildingRooms.map((room) => `<option value="${Number(room.id)}" ${String(activeRoomId) === String(room.id) ? 'selected' : ''}>${escHtml(room.room_label || 'Room')}</option>`).join('')}
            </select>
          </label>
          <div class="fl" style="align-self:end">
            <button class="btn btn-s btn-sm" onclick="resetTenantReportFilters()">Clear</button>
          </div>
        </div>
      </div>

      <div class="tenant-ledger-report-stats">
        <div class="card tenant-ledger-section-card">
          <div class="tenant-ledger-section-kicker">Selected Total</div>
          <div class="tenant-ledger-report-value">${fmtCur(totalAmount)}</div>
          <div class="tenant-ledger-section-sub">${invoiceCount} invoice snapshot${invoiceCount === 1 ? '' : 's'}</div>
        </div>
        <div class="card tenant-ledger-section-card">
          <div class="tenant-ledger-section-kicker">Rent Total</div>
          <div class="tenant-ledger-report-value">${fmtCur(totalRent)}</div>
          <div class="tenant-ledger-section-sub">base rent in filtered rows</div>
        </div>
        <div class="card tenant-ledger-section-card">
          <div class="tenant-ledger-section-kicker">Electricity Total</div>
          <div class="tenant-ledger-report-value">${fmtCur(totalElectricity)}</div>
          <div class="tenant-ledger-section-sub">meter-based spend</div>
        </div>
        <div class="card tenant-ledger-section-card">
          <div class="tenant-ledger-section-kicker">Avg / Invoice</div>
          <div class="tenant-ledger-report-value">${fmtCur(avgInvoice)}</div>
          <div class="tenant-ledger-section-sub">including negative adjustments</div>
        </div>
      </div>

      <div class="tenant-ledger-overview-grid">
        <div class="card tenant-ledger-section-card">
          <div class="tenant-ledger-section-head">
            <div>
              <div class="tenant-ledger-section-title">Tenant Totals</div>
              <div class="tenant-ledger-section-sub">Till now for the selected filters</div>
            </div>
          </div>
          <div class="tenant-ledger-report-list">
            ${pagedTenantTotals.items.length ? pagedTenantTotals.items.map((entry) => `
              <div class="tenant-ledger-report-row">
                <div>
                  <div class="tenant-ledger-room-title">${escHtml(entry.tenant.tenant_name || 'Tenant')}</div>
                  <div class="tenant-ledger-room-sub">${escHtml(roomMap.get(String(entry.tenant.room_id))?.room_label || '-')}</div>
                </div>
                <div class="tenant-ledger-report-amount">${fmtCur(entry.total)}</div>
              </div>`).join('') : '<div style="color:var(--t3);font-size:13px">No tenant totals for these filters.</div>'}
          </div>
          ${tenantPagerHtml({
            page: pagedTenantTotals.page,
            totalPages: pagedTenantTotals.totalPages,
            start: pagedTenantTotals.start,
            end: pagedTenantTotals.end,
            total: pagedTenantTotals.total,
            onPage: `setTenantReportPage('tenant', __PAGE__)`,
          })}
        </div>
        <div class="card tenant-ledger-section-card">
          <div class="tenant-ledger-section-head">
            <div>
              <div class="tenant-ledger-section-title">Room Totals</div>
              <div class="tenant-ledger-section-sub">Till now for each room</div>
            </div>
          </div>
          <div class="tenant-ledger-report-list">
            ${pagedRoomTotals.items.length ? pagedRoomTotals.items.map((entry) => `
              <div class="tenant-ledger-report-row">
                <div>
                  <div class="tenant-ledger-room-title">${escHtml(entry.room.room_label || 'Room')}</div>
                  <div class="tenant-ledger-room-sub">${escHtml(entry.room.floor_label || entry.room.room_type || 'Room total till now')}</div>
                </div>
                <div class="tenant-ledger-report-amount">${fmtCur(entry.total)}</div>
              </div>`).join('') : '<div style="color:var(--t3);font-size:13px">No room totals for these filters.</div>'}
          </div>
          ${tenantPagerHtml({
            page: pagedRoomTotals.page,
            totalPages: pagedRoomTotals.totalPages,
            start: pagedRoomTotals.start,
            end: pagedRoomTotals.end,
            total: pagedRoomTotals.total,
            onPage: `setTenantReportPage('room', __PAGE__)`,
          })}
        </div>
      </div>

      <div class="card tenant-ledger-section-card tenant-ledger-table-card">
        <div class="tenant-ledger-section-head">
          <div>
            <div class="tenant-ledger-section-title">Monthly Breakdown</div>
            <div class="tenant-ledger-section-sub">Year/month totals from invoice snapshots.</div>
          </div>
          <div class="tenant-ledger-section-sub">${fmtCur(totalOther)} other charges impact in selected rows</div>
        </div>
        <div class="tenant-ledger-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Invoices</th>
                <th>Electricity</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${pagedMonthRows.items.length ? pagedMonthRows.items.map((row) => `
                <tr>
                  <td>${escHtml(tenantMonthLabel(row.monthKey))}</td>
                  <td>${Number(row.invoice_count || 0)}</td>
                  <td>${fmtCur(row.electricity)}</td>
                  <td style="font-weight:800">${fmtCur(row.total)}</td>
                </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--t3)">No report rows found for these filters.</td></tr>'}
            </tbody>
          </table>
        </div>
        ${tenantPagerHtml({
          page: pagedMonthRows.page,
          totalPages: pagedMonthRows.totalPages,
          start: pagedMonthRows.start,
          end: pagedMonthRows.end,
          total: pagedMonthRows.total,
          onPage: `setTenantReportPage('month', __PAGE__)`,
        })}
      </div>
    </div>`;
}

function renderTenantBuildingsRail(buildings = []) {
  return buildings.map((building, index) => {
    const active = String(building.id) === String(_selectedTenantBuildingId);
    const tone = tenantBuildingTone(index);
    return `
      <button class="tenant-ledger-building-card tenant-ledger-building-${tone} ${active ? 'active' : ''}" onclick="openTenantBuilding(${Number(building.id)})">
        <div class="tenant-ledger-building-head">
          <div>
            <div class="tenant-ledger-building-title">${escHtml(building.name || 'Building')}</div>
            <div class="tenant-ledger-building-sub">${escHtml(building.address || 'Address not added')}</div>
          </div>
          <span class="tenant-ledger-room-pill">${Number(building.room_count || 0)} rooms</span>
        </div>
        <div class="tenant-ledger-building-chip-row">
          ${tenantChip(`${Number(building.occupied_count || 0)} occupied`, 'green')}
          ${tenantChip(`${Number(building.vacant_count || 0)} vacant`, 'amber')}
        </div>
      </button>`;
  }).join('');
}

function renderTenantOverviewTab(building, selectedTenant) {
  const rooms = building?.rooms || [];
  const occupied = rooms.filter((room) => room.active_tenant);
  const vacant = rooms.filter((room) => !room.active_tenant);
  const tenants = occupied.map((room) => room.active_tenant).filter(Boolean);
  const totalRent = occupied.reduce((sum, room) => sum + tenantNum(room.active_tenant?.rent_amount || room.default_rent || 0), 0);
  const highestRent = Math.max(1, ...occupied.map((room) => tenantNum(room.active_tenant?.rent_amount || room.default_rent || 0)));
  return `
    <div class="tenant-ledger-overview-grid">
      <div class="card tenant-ledger-section-card">
        <div class="tenant-ledger-section-head">
          <div>
            <div class="tenant-ledger-section-title">Rooms</div>
            <div class="tenant-ledger-section-sub">${rooms.length} rooms - ${occupied.length} occupied</div>
          </div>
          <button class="btn btn-p btn-sm" onclick="showTenantRoomModal()">+ Add Room</button>
        </div>
        <div class="tenant-ledger-overview-meter">
          <div class="tenant-ledger-overview-meter-fill" style="width:${rooms.length ? Math.round((occupied.length / rooms.length) * 100) : 0}%"></div>
        </div>
        <div class="tenant-ledger-overview-split">
          <div class="tenant-ledger-overview-metric">
            <div class="tenant-ledger-overview-metric-label">Occupied</div>
            <div class="tenant-ledger-overview-metric-value">${occupied.length}</div>
          </div>
          <div class="tenant-ledger-overview-metric">
            <div class="tenant-ledger-overview-metric-label">Vacant</div>
            <div class="tenant-ledger-overview-metric-value">${vacant.length}</div>
          </div>
        </div>
        <div class="tenant-ledger-room-list tenant-ledger-room-list-compact">
          ${rooms.length ? rooms.map((room) => `
            <div class="tenant-ledger-room-row">
              <div class="tenant-ledger-room-main">
                <span class="tenant-ledger-room-icon tenant-ledger-room-icon-${tenantRoomTone(room)}">${room.active_tenant ? 'O' : 'V'}</span>
                <div class="tenant-ledger-room-copy">
                  <div class="tenant-ledger-room-title">${escHtml(room.room_label || 'Room')}</div>
                  <div class="tenant-ledger-room-sub">${escHtml(room.floor_label || room.room_type || 'No floor/type')}</div>
                  <div class="tenant-ledger-room-status ${room.active_tenant ? 'occupied' : 'vacant'}">${room.active_tenant ? `Occupied by ${escHtml(room.active_tenant.tenant_name || 'Tenant')}` : 'Vacant'}</div>
                </div>
              </div>
              <div class="tenant-ledger-room-side">
                <div class="tenant-ledger-room-rent">${fmtCur(room.default_rent || room.active_tenant?.rent_amount || 0)}/mo</div>
                <div class="tenant-ledger-room-actions tenant-ledger-front-actions">
                  <button class="trip-icon-btn" title="Edit Room" onclick="showTenantRoomModal(${Number(room.id)})">${tenantActionIcon('edit')}</button>
                  <button class="trip-icon-btn danger" title="Delete Room" onclick="deleteTenantRoom(${Number(room.id)})">${tenantActionIcon('delete')}</button>
                </div>
              </div>
            </div>`).join('') : '<div style="color:var(--t3);font-size:13px">No rooms yet.</div>'}
        </div>
      </div>
      <div class="card tenant-ledger-section-card">
        <div class="tenant-ledger-section-head">
          <div>
            <div class="tenant-ledger-section-title">Tenants</div>
            <div class="tenant-ledger-section-sub">${tenants.length} active tenant${tenants.length === 1 ? '' : 's'} in this building</div>
          </div>
          ${tenants.length ? `<button class="btn btn-s btn-sm" onclick="setTenantPageTab('tenants')">View All</button>` : '<button class="btn btn-p btn-sm" onclick="showTenantRecordModal()">+ Add Tenant</button>'}
        </div>
        <div class="tenant-ledger-overview-meter tenant-ledger-overview-meter-gold">
          <div class="tenant-ledger-overview-meter-fill tenant-ledger-overview-meter-fill-gold" style="width:${rooms.length ? Math.round((tenants.length / rooms.length) * 100) : 0}%"></div>
        </div>
        <div class="tenant-ledger-overview-split">
          <div class="tenant-ledger-overview-metric">
            <div class="tenant-ledger-overview-metric-label">Monthly Rent</div>
            <div class="tenant-ledger-overview-metric-value">${fmtCur(totalRent)}</div>
          </div>
          <div class="tenant-ledger-overview-metric">
            <div class="tenant-ledger-overview-metric-label">Selected</div>
            <div class="tenant-ledger-overview-metric-value">${selectedTenant ? escHtml(tenantInitials(selectedTenant.tenant_name)) : '-'}</div>
          </div>
        </div>
        ${tenants.length ? `
          <div class="tenant-ledger-tenant-graph-list">
            ${tenants.map((tenant) => {
              const room = tenantFindRoom(tenant.room_id);
              const rent = tenantNum(tenant.rent_amount || 0);
              const width = Math.max(18, Math.round((rent / highestRent) * 100));
              return `
                <button type="button" class="tenant-ledger-tenant-graph-row ${String(selectedTenant?.id || '') === String(tenant.id) ? 'active' : ''}" onclick="openTenantRecord(${Number(tenant.id)})">
                  <div class="tenant-ledger-tenant-graph-main">
                    <span class="tenant-ledger-tenant-avatar">${tenantInitials(tenant.tenant_name)}</span>
                    <div>
                      <div class="tenant-ledger-tenant-name">${escHtml(tenant.tenant_name || 'Tenant')}</div>
                      <div class="tenant-ledger-tenant-sub">${escHtml(room?.room_label || '-')} - Started ${escHtml(tenantDateLabel(tenant.start_date))}</div>
                    </div>
                  </div>
                  <div class="tenant-ledger-tenant-graph-bar-wrap">
                    <div class="tenant-ledger-tenant-graph-bar" style="width:${width}%"></div>
                    <div class="tenant-ledger-tenant-graph-value">${fmtCur(rent)}</div>
                  </div>
                </button>`;
            }).join('')}
          </div>
        ` : `
          <div style="margin-top:14px;color:var(--t3);font-size:13px">No active tenants in this building yet.</div>
        `}
      </div>
    </div>`;
}

function renderTenantRecordsTab(building) {
  const rooms = building?.rooms || [];
  const tenants = (_tenantOverview?.tenants || []).filter((tenant) => String(tenant.building_id) === String(building?.id || ''));
  return `
    <div class="card tenant-ledger-section-card tenant-ledger-table-card">
      <div class="tenant-ledger-section-head">
        <div>
          <div class="tenant-ledger-section-title">Tenant Records</div>
          <div class="tenant-ledger-section-sub">Keep contracts, vehicles, charges, and tenant items together.</div>
        </div>
        <button class="btn btn-p btn-sm" onclick="showTenantRecordModal()">+ Add Tenant</button>
      </div>
      <div class="tenant-ledger-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Room</th>
              <th>Contact</th>
              <th>Rent</th>
              <th>Charges</th>
              <th>Contract</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${tenants.length ? tenants.map((tenant) => {
              const room = rooms.find((item) => String(item.id) === String(tenant.room_id));
              const charges = tenantNum(tenant.sewerage_charge) + tenantNum(tenant.water_charge) + tenantNum(tenant.cleaning_charge);
              const contractLabel = [
                tenant.contract_months ? `${Number(tenant.contract_months)} months` : '',
                tenant.end_date ? `Till ${fmtDate(tenant.end_date)}` : '',
              ].filter(Boolean).join(' · ') || '-';
              const portalPhone = String(tenant.contact_number || '').replace(/\D+/g, '').slice(-10);
              return `
                <tr onclick="openTenantRecord(${Number(tenant.id)})" style="cursor:pointer;background:${String(tenant.id) === String(_selectedTenantRecordId) ? '#f5fbf7' : ''}">
                  <td>
                    <div style="font-weight:800;color:var(--t1)">${escHtml(tenant.tenant_name || 'Tenant')}</div>
                    <div style="font-size:12px;color:var(--t3);margin-top:4px">${tenant.is_active ? 'Active' : 'Inactive'}</div>
                  </td>
                  <td>${escHtml(room?.room_label || '-')}</td>
                  <td>${escHtml(tenant.contact_number || '-')}</td>
                  <td>${fmtCur(tenant.rent_amount || 0)}</td>
                  <td>${fmtCur(charges)}</td>
                  <td>${escHtml(contractLabel)}</td>
                  <td class="tenant-ledger-actions-cell">
                    <div class="tenant-ledger-front-actions">
                      <button class="trip-icon-btn" title="View Details" onclick="event.stopPropagation();showTenantRecordDetailsModal(${Number(tenant.id)})">${tenantActionIcon('view')}</button>
                      ${portalPhone ? `<button class="trip-icon-btn" title="Open Tenant Portal" onclick="event.stopPropagation();openTenantPortalForPhone('${portalPhone}')">${tenantActionIcon('portal')}</button>` : ''}
                      <button class="trip-icon-btn" title="Generate Invoice" onclick="event.stopPropagation();showTenantInvoiceModal(${Number(tenant.id)})">${tenantActionIcon('invoice')}</button>
                      <button class="trip-icon-btn" title="Import Invoices" onclick="event.stopPropagation();showTenantInvoiceImportModal(${Number(tenant.id)})">${tenantActionIcon('import')}</button>
                      <button class="trip-icon-btn" title="Edit Tenant" onclick="event.stopPropagation();showTenantRecordModal(${Number(tenant.id)})">${tenantActionIcon('edit')}</button>
                      <button class="trip-icon-btn danger" title="Delete Tenant" onclick="event.stopPropagation();deleteTenantRecord(${Number(tenant.id)})">${tenantActionIcon('delete')}</button>
                    </div>
                  </td>
                </tr>`;
            }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--t3)">No tenant records in this building yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderTenantInvoicesTab(building) {
  const { buildingTenants, invoices, years, months, activeYear, activeTenantId, activeActivity, activeMonthFrom, activeMonthTo } = getTenantFilteredInvoices(building);
  const pagedInvoices = tenantPaginate(invoices, _tenantInvoicePager.page, _tenantInvoicePager.pageSize);
  _tenantInvoicePager.page = pagedInvoices.page;
  const composeTenantId = activeTenantId !== 'all'
    ? activeTenantId
    : (_selectedTenantRecordId && buildingTenants.some((tenant) => String(tenant.id) === String(_selectedTenantRecordId))
        ? String(_selectedTenantRecordId)
        : String(buildingTenants[0]?.id || ''));
  return `
    <div class="card tenant-ledger-section-card tenant-ledger-table-card">
      <div class="tenant-ledger-section-head">
        <div>
          <div class="tenant-ledger-section-title">Monthly Rent Invoices</div>
          <div class="tenant-ledger-section-sub">Invoices keep a snapshot of rent and utility charges, so old invoices stay unchanged.</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
          <button class="btn btn-s btn-sm" onclick="showTenantMonthInvoiceExportModal(${Number(building?.id || 0)})">Month PDF / Share</button>
          <button class="btn btn-s btn-sm" onclick="showTenantBulkInvoiceModal()">Bulk Generate</button>
          ${composeTenantId ? `<button class="btn btn-p btn-sm" onclick="showTenantInvoiceModal(${Number(composeTenantId)})">Generate Invoice</button>` : ''}
        </div>
      </div>
      <div class="tenant-ledger-report-filters" style="margin-top:16px">
        <label class="fl">Tenant
          <select class="fi" onchange="setTenantInvoiceFilter('tenant_id', this.value)">
            <option value="all" ${activeTenantId === 'all' ? 'selected' : ''}>All tenants</option>
            ${buildingTenants.map((tenant) => `<option value="${Number(tenant.id)}" ${String(activeTenantId) === String(tenant.id) ? 'selected' : ''}>${escHtml(tenant.tenant_name || 'Tenant')}${tenantIsInactive(tenant) ? ' (Inactive)' : ''}</option>`).join('')}
          </select>
        </label>
        <label class="fl">Tenant Type
          <select class="fi" onchange="setTenantInvoiceFilter('activity', this.value)">
            <option value="all" ${activeActivity === 'all' ? 'selected' : ''}>All tenants</option>
            <option value="active" ${activeActivity === 'active' ? 'selected' : ''}>Active only</option>
            <option value="inactive" ${activeActivity === 'inactive' ? 'selected' : ''}>Inactive only</option>
          </select>
        </label>
        <label class="fl">Year
          <select class="fi" onchange="setTenantInvoiceFilter('year', this.value)">
            <option value="all" ${activeYear === 'all' ? 'selected' : ''}>All years</option>
            ${years.map((year) => `<option value="${year}" ${String(activeYear) === String(year) ? 'selected' : ''}>${year}</option>`).join('')}
          </select>
        </label>
        <label class="fl">From Month
          <select class="fi" onchange="setTenantInvoiceFilter('month_from', this.value)">
            <option value="" ${!activeMonthFrom ? 'selected' : ''}>Start</option>
            ${months.map((month) => `<option value="${escHtml(month)}" ${activeMonthFrom === month ? 'selected' : ''}>${escHtml(tenantMonthLabel(month))}</option>`).join('')}
          </select>
        </label>
        <label class="fl">To Month
          <select class="fi" onchange="setTenantInvoiceFilter('month_to', this.value)">
            <option value="" ${!activeMonthTo ? 'selected' : ''}>Till now</option>
            ${months.map((month) => `<option value="${escHtml(month)}" ${activeMonthTo === month ? 'selected' : ''}>${escHtml(tenantMonthLabel(month))}</option>`).join('')}
          </select>
        </label>
        <div class="fl" style="align-self:end">
          <button class="btn btn-s btn-sm" onclick="resetTenantInvoiceFilters()">Clear</button>
        </div>
      </div>
      <div class="tenant-ledger-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Tenant</th>
              <th>Room</th>
              <th>Electricity</th>
              <th>Total</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pagedInvoices.items.length ? pagedInvoices.items.map((invoice) => `
              <tr>
                <td>${escHtml(tenantMonthLabel(invoice.invoice_month))}</td>
                <td>${tenantInvoiceTenantCell(invoice)}</td>
                <td>${escHtml(invoice.room_label_snapshot || '-')}</td>
                <td>${tenantElectricityUsageText(invoice, { currencyFormatter: fmtCur, includeAmount: true, compact: true })}</td>
                <td style="font-weight:800">${fmtCur(invoice.total_amount || 0)}</td>
                <td>
                  <div style="display:grid;gap:6px;min-width:150px">
                    ${tenantInvoiceStatusButtons(invoice)}
                    <div>${tenantChip(`${tenantInvoiceStatusLabel(invoice.payment_status)}${invoice.payment_status === 'partial_paid' ? ` · ${fmtCur(invoice.paid_amount || 0)}` : invoice.payment_status === 'paid' ? ` · ${fmtCur(invoice.paid_amount || invoice.total_amount || 0)}` : ''}`, tenantInvoiceStatusTone(invoice.payment_status))}</div>
                    ${tenantInvoicePaymentRequestHtml(invoice)}
                  </div>
                </td>
                <td>${escHtml(tenantDateLabel(invoice.due_date))}</td>
                <td class="tenant-ledger-actions-cell">
                  <div class="tenant-ledger-front-actions">
                    <button class="trip-icon-btn" title="View Invoice" onclick="showTenantInvoiceViewModal(${Number(invoice.id)})">${tenantActionIcon('view')}</button>
                    <button class="trip-icon-btn" title="Download Invoice PDF" onclick="downloadTenantInvoicePdf(${Number(invoice.id)})">${tenantActionIcon('pdf')}</button>
                    <button class="trip-icon-btn" title="Share Invoice" onclick="showTenantInvoiceShareModal(${Number(invoice.id)})">${tenantActionIcon('share')}</button>
                    <button class="trip-icon-btn" title="Edit Invoice" onclick="showTenantInvoiceEditModal(${Number(invoice.id)})">${tenantActionIcon('edit')}</button>
                    <button class="trip-icon-btn danger" title="Delete Invoice" onclick="deleteTenantInvoice(${Number(invoice.id)})">${tenantActionIcon('delete')}</button>
                  </div>
                </td>
              </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--t3)">No invoices generated yet.</td></tr>'}
          </tbody>
        </table>
      </div>
      ${tenantPagerHtml({
        page: pagedInvoices.page,
        totalPages: pagedInvoices.totalPages,
        start: pagedInvoices.start,
        end: pagedInvoices.end,
        total: pagedInvoices.total,
        onPage: 'setTenantInvoicePage',
      })}
    </div>`;
}

function renderTenantsPage() {
  const main = document.getElementById('main');
  if (!main) return;
  const overview = _tenantOverview || { buildings: [], rooms: [], tenants: [], invoices: [], totals: {} };
  const buildings = overview.buildings || [];
  const selectedBuilding = tenantFindBuilding(_selectedTenantBuildingId);
  const selectedTenant = tenantFindRecord(_selectedTenantRecordId);
  const emptyBlock = `
    <div class="card" style="padding:56px;text-align:center">
      <div style="font-size:28px;font-weight:900;color:var(--t1)">Create your first building</div>
      <div style="font-size:14px;color:var(--t2);line-height:1.7;margin-top:10px">Track rooms, tenant contracts, vehicles, charges, items provided, and monthly invoices in one place.</div>
      <button class="btn btn-p" style="margin-top:18px" onclick="showTenantBuildingModal()">+ Add Building</button>
    </div>`;
  const tabs = [
    ['overview', 'Overview'],
    ['tenants', 'Tenants'],
    ['invoices', 'Invoices'],
    ['reports', 'Reports'],
  ].map(([key, label]) => `<button type="button" class="tenant-ledger-tab ${_tenantPageTab === key ? 'active' : ''}" data-tenant-tab="${escHtml(key)}" onclick="setTenantPageTab('${key}')">${label}</button>`).join('');
  const buildingOptions = buildings.map((building) => `
    <option value="${Number(building.id)}" ${String(building.id) === String(_selectedTenantBuildingId) ? 'selected' : ''}>${escHtml(building.name || 'Building')}</option>
  `).join('');
  const content = !selectedBuilding
    ? emptyBlock
    : _tenantPageTab === 'tenants'
      ? renderTenantRecordsTab(selectedBuilding)
      : _tenantPageTab === 'invoices'
        ? renderTenantInvoicesTab(selectedBuilding)
        : _tenantPageTab === 'reports'
          ? renderTenantReportsTab(selectedBuilding)
        : renderTenantOverviewTab(selectedBuilding, selectedTenant);
  const selectedRooms = selectedBuilding?.rooms || [];
  const selectedOccupied = selectedRooms.filter((room) => room.active_tenant);
  const selectedVacant = selectedRooms.filter((room) => !room.active_tenant);
  const selectedBuildingRent = selectedOccupied.reduce((sum, room) => sum + tenantNum(room.active_tenant?.rent_amount || room.default_rent || 0), 0);
  const selectedBuildingInvoices = (_tenantOverview?.invoices || []).filter((invoice) => {
    const tenant = tenantFindRecord(invoice.tenant_id);
    return String(tenant?.building_id || '') === String(selectedBuilding?.id || '');
  });

  main.innerHTML = `
    <div class="tab-content tenant-ledger-page">
      <div class="tenant-ledger-head-row">
        <div class="tenant-ledger-head-copy">
          <div class="tenant-ledger-page-title">Tenants</div>
          <div class="tenant-ledger-page-sub">Manage buildings, rooms, tenants, meter-based invoices, and charge snapshots.</div>
        </div>
        <div class="tenant-ledger-toolbar-actions">
          <button class="btn btn-s btn-sm" onclick="loadTenantsPage()">Refresh</button>
          <button class="btn btn-p btn-sm" onclick="showTenantBuildingModal()">+ Add Building</button>
        </div>
      </div>
      ${_tenantLoading ? '<div class="card" style="padding:34px;text-align:center;color:var(--t3)">Loading tenants...</div>' : ''}
      ${!_tenantLoading && !buildings.length ? emptyBlock : ''}
      ${!_tenantLoading && buildings.length ? `
        <div class="tenant-ledger-top-card card">
          <div class="tenant-ledger-selector-block">
            <label class="tenant-ledger-selector-label" for="tenantSelectedBuilding">Selected Building</label>
            <select id="tenantSelectedBuilding" class="fi tenant-ledger-selector-input" onchange="setTenantSelectedBuilding(this.value)">
              ${buildingOptions}
            </select>
          </div>
          <div class="tenant-ledger-top-metrics">
            <div class="tenant-ledger-top-metric">
              <div class="tenant-ledger-top-metric-label">Buildings</div>
              <div class="tenant-ledger-top-metric-value">${Number(overview.totals?.building_count || 0)}</div>
            </div>
            <div class="tenant-ledger-top-metric">
              <div class="tenant-ledger-top-metric-label">Rooms</div>
              <div class="tenant-ledger-top-metric-value">${Number(overview.totals?.room_count || 0)}</div>
            </div>
            <div class="tenant-ledger-top-metric">
              <div class="tenant-ledger-top-metric-label">Occupied</div>
              <div class="tenant-ledger-top-metric-value">${Number(overview.totals?.occupied_count || 0)}</div>
            </div>
            <div class="tenant-ledger-top-metric">
              <div class="tenant-ledger-top-metric-label">Monthly Rent</div>
              <div class="tenant-ledger-top-metric-value">${fmtCur(overview.totals?.monthly_rent || 0)}</div>
            </div>
          </div>
        </div>
        <div class="tenant-ledger-main">
          <div class="tenant-ledger-hero">
            <div class="tenant-ledger-hero-top">
              <div>
                <div class="tenant-ledger-hero-label">Building</div>
                <div class="tenant-ledger-hero-title">${escHtml(selectedBuilding?.name || 'Building')}</div>
                <div class="tenant-ledger-hero-sub">${escHtml(selectedBuilding?.address || 'Address not added')}</div>
              </div>
              <div class="tenant-ledger-hero-actions">
                <button class="btn btn-s btn-sm" onclick="showTenantRoomModal()">+ Add Room</button>
                <button class="btn btn-s btn-sm" onclick="showTenantBuildingModal(${Number(selectedBuilding?.id || 0)})">Edit</button>
                <button class="btn btn-p btn-sm" onclick="showTenantRecordModal()">+ Add Tenant</button>
              </div>
            </div>
            <div class="tenant-ledger-hero-stats">
              <div class="tenant-ledger-hero-stat">
                <div class="tenant-ledger-hero-stat-label">Rooms</div>
                <div class="tenant-ledger-hero-stat-value">${selectedRooms.length}</div>
                <div class="tenant-ledger-hero-stat-meta">registered rooms</div>
              </div>
              <div class="tenant-ledger-hero-stat">
                <div class="tenant-ledger-hero-stat-label">Occupied</div>
                <div class="tenant-ledger-hero-stat-value">${selectedOccupied.length}</div>
                <div class="tenant-ledger-hero-stat-meta">${selectedVacant.length} vacant</div>
              </div>
              <div class="tenant-ledger-hero-stat">
                <div class="tenant-ledger-hero-stat-label">Monthly Rent</div>
                <div class="tenant-ledger-hero-stat-value">${fmtCur(selectedBuildingRent)}</div>
                <div class="tenant-ledger-hero-stat-meta">active tenants</div>
              </div>
              <div class="tenant-ledger-hero-stat">
                <div class="tenant-ledger-hero-stat-label">Invoices</div>
                <div class="tenant-ledger-hero-stat-value">${selectedBuildingInvoices.length}</div>
                <div class="tenant-ledger-hero-stat-meta">saved snapshots</div>
              </div>
            </div>
          </div>
          <div class="tenant-ledger-tab-row">
            <div class="tenant-ledger-tab-label">Sections</div>
            <div class="tenant-ledger-tab-set">${tabs}</div>
          </div>
          <div class="tenant-ledger-section-shell">
            ${_tenantPageTab === 'tenants' ? `
              <div class="tenant-ledger-section-kicker">Tenants</div>
              <div class="tenant-ledger-section-caption">Contracts, charges, vehicles, and inventory for this building</div>
            ` : `
              ${_tenantPageTab === 'invoices' ? `
                <div class="tenant-ledger-section-kicker">Invoices</div>
                <div class="tenant-ledger-section-caption">Monthly rent snapshots for this building</div>
              ` : _tenantPageTab === 'reports' ? `
                <div class="tenant-ledger-section-kicker">Reports</div>
                <div class="tenant-ledger-section-caption">Check year totals, month ranges, tenant totals, and room totals till now</div>
              ` : ''}
            `}
            ${content}
          </div>
        </div>
      ` : ''}
    </div>`;
  bindTenantsPageInteractions(main);
}

function showTenantBuildingModal(buildingId = null) {
  const building = buildingId ? tenantFindBuilding(buildingId) : null;
  openModal(building ? 'Edit Building' : 'Add Building', `
    <div class="fg">
      <label class="fl full">Building Name *<input class="fi" id="tenantBuildingName" value="${escHtml(building?.name || '')}" placeholder="e.g. Sharma Residency"></label>
      <label class="fl full">Address<textarea class="fi" id="tenantBuildingAddress" rows="3" placeholder="Full building address">${escHtml(building?.address || '')}</textarea></label>
      <label class="fl full">Notes<textarea class="fi" id="tenantBuildingNotes" rows="3" placeholder="Optional notes">${escHtml(building?.notes || '')}</textarea></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveTenantBuilding(${buildingId || 'null'})">${building ? 'Update Building' : 'Add Building'}</button>
      ${building ? `<button class="btn btn-g" style="color:var(--red)" onclick="deleteTenantBuilding(${Number(building.id)})">Delete</button>` : ''}
      <button class="btn btn-s" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveTenantBuilding(buildingId = null) {
  const body = {
    name: document.getElementById('tenantBuildingName')?.value?.trim() || '',
    address: document.getElementById('tenantBuildingAddress')?.value?.trim() || '',
    notes: document.getElementById('tenantBuildingNotes')?.value?.trim() || '',
  };
  if (!body.name) { toast('Building name is required', 'warning'); return; }
  const result = buildingId
    ? await api(`/api/tenants/buildings/${Number(buildingId)}`, { method: 'PUT', body })
    : await api('/api/tenants/buildings', { method: 'POST', body });
  if (!result?.success) { toast(result?.error || 'Could not save building.', 'error'); return; }
  closeModal();
  _selectedTenantBuildingId = Number(result.building?.id || buildingId || _selectedTenantBuildingId);
  toast(buildingId ? 'Building updated' : 'Building added', 'success');
  await loadTenantsPage();
}

async function deleteTenantBuilding(buildingId) {
  if (!await confirmDialog('Delete this building, its rooms, tenants, and invoices?')) return;
  const result = await api(`/api/tenants/buildings/${Number(buildingId)}`, { method: 'DELETE' });
  if (!result?.success) { toast(result?.error || 'Could not delete building.', 'error'); return; }
  closeModal();
  if (String(_selectedTenantBuildingId) === String(buildingId)) _selectedTenantBuildingId = null;
  toast('Building deleted', 'success');
  await loadTenantsPage();
}

function showTenantInvoiceImportModal(recordId) {
  const tenant = tenantFindRecord(recordId);
  if (!tenant) { toast('Tenant not found.', 'error'); return; }
  const room = tenantFindRoom(tenant.room_id);
  openModal(`Import Invoices - ${escHtml(tenant.tenant_name || 'Tenant')}`, `
    <div style="display:grid;gap:14px">
      <div class="card" style="padding:14px;background:#f7faf8">
        <div style="font-size:16px;font-weight:800;color:var(--t1)">${escHtml(tenant.tenant_name || 'Tenant')}</div>
        <div style="font-size:12px;color:var(--t3);margin-top:6px;line-height:1.6">${escHtml(room?.room_label || 'Room')} • This import ignores the sheet's Name column and attaches every invoice row to this tenant.</div>
      </div>
      <label class="fl full">Invoice Sheet (.xlsx / .xls)
        <input type="file" accept=".xlsx,.xls,.ods" id="tenantInvoiceImportFile" class="fi">
      </label>
      <div style="font-size:12px;color:var(--t3);line-height:1.7">
        Expected columns from your invoice sheet:
        <br><b>Rent date</b>, <b>Rent paid on</b>, <b>Monthly rent</b>, meter <b>last/current</b>, <b>Total Units</b>, <b>Electricity Bill</b>,
        <br><b>Sewerage Charges</b>, <b>Water Charges</b>, <b>Cleaning Charges</b>, <b>other charges detail</b>, <b>other charges</b>, <b>Total</b>.
        <br>These rows are imported exactly as-is for the selected tenant and saved as <b>Paid</b>. No charge recalculation is done from the tenant profile.
      </div>
      <div id="tenantInvoiceImportSheetArea"></div>
      <div id="tenantInvoiceImportPreview"></div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-s" onclick="loadTenantInvoiceImportSheets(${Number(recordId)})">Read File</button>
      <button class="btn btn-s" onclick="closeModal()">Cancel</button>
    </div>`);
}

function getSelectedTenantInvoiceImportSheet() {
  return [...document.querySelectorAll('.tenant-invoice-import-sheet-cb:checked')].map((checkbox) => checkbox.value)[0] || '';
}

async function loadTenantInvoiceImportSheets(recordId) {
  const file = document.getElementById('tenantInvoiceImportFile')?.files?.[0];
  if (!file) { toast('Please choose an excel file first.', 'warning'); return; }
  const area = document.getElementById('tenantInvoiceImportSheetArea');
  const preview = document.getElementById('tenantInvoiceImportPreview');
  if (area) area.innerHTML = `<div style="color:var(--t3);font-size:13px">Reading file...</div>`;
  if (preview) preview.innerHTML = '';
  const fd = new FormData();
  fd.append('file', file);
  const response = await fetch(`/api/tenants/records/${Number(recordId)}/import-invoices-excel/sheets`, {
    method: 'POST',
    body: fd,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    if (area) area.innerHTML = `<div style="color:var(--red);font-size:13px">${escHtml(data?.error || 'Could not read file.')}</div>`;
    return;
  }
  const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
  if (!sheets.length) {
    if (area) area.innerHTML = `<div style="color:var(--amber);font-size:13px">No sheets found in this file.</div>`;
    return;
  }
  if (area) area.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-size:12px;color:var(--t3)">Choose the invoice sheet to preview first.</div>
      <button class="btn btn-s btn-sm" onclick="previewTenantInvoiceImport(${Number(recordId)})">Preview Import</button>
    </div>
    <div style="display:grid;gap:8px;margin-top:10px">
      ${sheets.map((sheet, index) => `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:#fff">
          <input type="radio" name="tenantInvoiceImportSheet" class="tenant-invoice-import-sheet-cb" value="${escHtml(sheet)}" ${index === 0 ? 'checked' : ''}>
          <span style="font-weight:700;color:var(--t2)">${escHtml(sheet)}</span>
        </label>`).join('')}
    </div>`;
}

async function previewTenantInvoiceImport(recordId) {
  const file = document.getElementById('tenantInvoiceImportFile')?.files?.[0];
  if (!file) { toast('Please choose an excel file first.', 'warning'); return; }
  const sheet = getSelectedTenantInvoiceImportSheet();
  if (!sheet) { toast('Please choose a sheet first.', 'warning'); return; }
  const preview = document.getElementById('tenantInvoiceImportPreview');
  if (preview) preview.innerHTML = `<div style="color:var(--t3);font-size:13px">Loading preview...</div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheet', sheet);
  const response = await fetch(`/api/tenants/records/${Number(recordId)}/import-invoices-excel/preview`, {
    method: 'POST',
    body: fd,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    if (preview) preview.innerHTML = `<div style="color:var(--red);font-size:13px">${escHtml(data?.error || 'Could not preview tenant invoices.')}</div>`;
    return;
  }
  const rowsHtml = (data.preview || []).map((row) => `
    <tr>
      <td>${escHtml(tenantMonthLabel(row.invoice_month))}</td>
      <td style="text-align:right">${fmtCur(row.rent_amount_snapshot || 0)}</td>
      <td style="text-align:right">${Number(row.previous_electricity_units || 0)}</td>
      <td style="text-align:right">${Number(row.current_electricity_units || 0)}</td>
      <td>${Number(row.electricity_units_used || 0)} units</td>
      <td style="text-align:right">${fmtCur(row.electricity_amount || 0)}</td>
      <td style="text-align:right">${fmtCur(row.sewerage_charge_snapshot || 0)}</td>
      <td style="text-align:right">${fmtCur(row.water_charge_snapshot || 0)}</td>
      <td style="text-align:right">${fmtCur(row.cleaning_charge_snapshot || 0)}</td>
      <td style="text-align:right">${fmtCur(row.other_charges_snapshot || 0)}</td>
      <td style="text-align:right;font-weight:800">${fmtCur(row.total_amount || 0)}</td>
    </tr>`).join('');
  if (preview) preview.innerHTML = `
    <div class="card" style="padding:16px">
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
        <div><div style="font-size:11px;color:var(--t3);text-transform:uppercase">Sheet</div><div style="font-weight:800;color:var(--t1)">${escHtml(data.sheet || sheet)}</div></div>
        <div><div style="font-size:11px;color:var(--t3);text-transform:uppercase">Invoice Rows</div><div style="font-weight:800;color:var(--t1)">${Number(data.invoice_count || 0)}</div></div>
        <div><div style="font-size:11px;color:var(--t3);text-transform:uppercase">Total Amount</div><div style="font-weight:800;color:var(--green)">${fmtCur(data.total_amount || 0)}</div></div>
      </div>
      <div class="table-wrap" style="margin-top:14px">
        <table>
          <thead><tr><th>Month</th><th style="text-align:right">Rent</th><th style="text-align:right">Previous</th><th style="text-align:right">Current</th><th>Units</th><th style="text-align:right">Electricity</th><th style="text-align:right">Sewerage</th><th style="text-align:right">Water</th><th style="text-align:right">Cleaning</th><th style="text-align:right">Other</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="11" style="text-align:center;color:var(--t3)">No valid invoice rows found.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="fa" style="margin-top:16px">
        <button class="btn btn-p" onclick="importTenantInvoicesExcel(${Number(recordId)})">Import Selected Sheet</button>
      </div>
    </div>`;
}

async function importTenantInvoicesExcel(recordId) {
  const file = document.getElementById('tenantInvoiceImportFile')?.files?.[0];
  if (!file) { toast('Please choose an excel file first.', 'warning'); return; }
  const responseTenant = tenantFindRecord(recordId);
  if (!responseTenant) { toast('Tenant not found.', 'error'); return; }
  const sheet = getSelectedTenantInvoiceImportSheet();
  if (!sheet) { toast('Please choose a sheet first.', 'warning'); return; }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheet', sheet);
  const response = await fetch(`/api/tenants/records/${Number(recordId)}/import-invoices-excel`, {
    method: 'POST',
    body: fd,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    toast(data?.error || 'Could not import tenant invoices.', 'error');
    return;
  }
  closeModal();
  _selectedTenantRecordId = Number(recordId);
  toast(`Imported ${Number(data.imported || 0)} invoice rows for ${responseTenant.tenant_name || 'tenant'}.`, 'success', 5000);
  await loadTenantsPage();
}

function showTenantRoomModal(roomId = null) {
  const selectedBuilding = tenantFindBuilding(_selectedTenantBuildingId);
  if (!selectedBuilding) { toast('Select a building first.', 'warning'); return; }
  const room = roomId ? tenantFindRoom(roomId) : null;
  openModal(room ? 'Edit Room' : 'Add Room', `
    <div class="fg">
      <label class="fl">Room Label *<input class="fi" id="tenantRoomLabel" value="${escHtml(room?.room_label || '')}" placeholder="e.g. Room 101"></label>
      <label class="fl">Floor / Wing<input class="fi" id="tenantRoomFloor" value="${escHtml(room?.floor_label || '')}" placeholder="e.g. First Floor"></label>
      <label class="fl">Room Type<input class="fi" id="tenantRoomType" value="${escHtml(room?.room_type || '')}" placeholder="e.g. 1BHK / PG / Studio"></label>
      <label class="fl full">Notes<textarea class="fi" id="tenantRoomNotes" rows="3">${escHtml(room?.notes || '')}</textarea></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveTenantRoom(${roomId || 'null'})">${room ? 'Update Room' : 'Add Room'}</button>
      ${room ? `<button class="btn btn-g" style="color:var(--red)" onclick="deleteTenantRoom(${Number(room.id)})">Delete</button>` : ''}
      <button class="btn btn-s" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveTenantRoom(roomId = null) {
  const body = {
    room_label: document.getElementById('tenantRoomLabel')?.value?.trim() || '',
    floor_label: document.getElementById('tenantRoomFloor')?.value?.trim() || '',
    room_type: document.getElementById('tenantRoomType')?.value?.trim() || '',
    notes: document.getElementById('tenantRoomNotes')?.value?.trim() || '',
  };
  if (!body.room_label) { toast('Room label is required', 'warning'); return; }
  const result = roomId
    ? await api(`/api/tenants/rooms/${Number(roomId)}`, { method: 'PUT', body })
    : await api(`/api/tenants/buildings/${Number(_selectedTenantBuildingId)}/rooms`, { method: 'POST', body });
  if (!result?.success) { toast(result?.error || 'Could not save room.', 'error'); return; }
  closeModal();
  toast(roomId ? 'Room updated' : 'Room added', 'success');
  await loadTenantsPage();
}

async function deleteTenantRoom(roomId) {
  if (!await confirmDialog('Delete this room and all tenant records inside it?')) return;
  const result = await api(`/api/tenants/rooms/${Number(roomId)}`, { method: 'DELETE' });
  if (!result?.success) { toast(result?.error || 'Could not delete room.', 'error'); return; }
  closeModal();
  toast('Room deleted', 'success');
  await loadTenantsPage();
}

function tenantEditorTabIcon(tab) {
  const icons = {
    details: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path>
        <path d="M5 20a7 7 0 0 1 14 0"></path>
      </svg>`,
    charges: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 7.5h12"></path>
        <path d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"></path>
        <path d="M12 10v6"></path>
        <path d="M9.5 13H14.5"></path>
      </svg>`,
    assets: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 15.5V11a2 2 0 0 1 2-2h10"></path>
        <path d="M7 15.5h6"></path>
        <path d="M15 9l2-3h3l1 3"></path>
        <path d="M14 11h7v5a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z"></path>
        <path d="M5 18h3"></path>
      </svg>`,
    documents: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h7l4 4v14H7z"></path>
        <path d="M14 3v5h5"></path>
        <path d="M9.5 13h5"></path>
        <path d="M9.5 17h5"></path>
      </svg>`,
  };
  return icons[tab] || icons.details;
}

function tenantEditorSection(title, note = '') {
  return `<div class="tenant-editor-divider">${escHtml(title)}${note ? ` <small>${escHtml(note)}</small>` : ''}</div>`;
}

function tenantModalVehicleRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => `
    <div class="tenant-editor-surface tenant-vehicle-row" data-index="${index}">
      <div class="tenant-editor-row-head">
        <div class="tenant-editor-row-title">Vehicle ${index + 1}</div>
        <button class="tenant-editor-row-remove" type="button" onclick="removeTenantVehicleRow(this)">Remove</button>
      </div>
      <div class="fg tenant-editor-inline-grid">
        <label class="fl">
          <span class="tenant-editor-label">Type</span>
          <input class="fi tenant-vehicle-type" value="${escHtml(row.vehicle_type || '')}" placeholder="2 wheeler / 4 wheeler">
        </label>
        <label class="fl">
          <span class="tenant-editor-label">Vehicle Number</span>
          <input class="fi tenant-vehicle-number" value="${escHtml(row.vehicle_number || '')}" placeholder="PB10AB1234">
        </label>
        <label class="fl full">
          <span class="tenant-editor-label">Notes</span>
          <input class="fi tenant-vehicle-notes" value="${escHtml(row.notes || '')}" placeholder="Optional">
        </label>
      </div>
    </div>`).join('');
}

function tenantModalItemRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => `
    <div class="tenant-editor-surface tenant-item-row" data-index="${index}">
      <div class="tenant-editor-row-head">
        <div class="tenant-editor-row-title">Item ${index + 1}</div>
        <button class="tenant-editor-row-remove" type="button" onclick="removeTenantItemRow(this)">Remove</button>
      </div>
      <div class="fg tenant-editor-inline-grid">
        <label class="fl">
          <span class="tenant-editor-label">Item Name</span>
          <input class="fi tenant-item-name" value="${escHtml(row.item_name || '')}" placeholder="Cooler / Cylinder / Fan">
        </label>
        <label class="fl">
          <span class="tenant-editor-label">Quantity</span>
          <input class="fi tenant-item-quantity" type="number" min="0" step="1" value="${escHtml(row.quantity === '' || row.quantity == null ? '' : String(row.quantity))}" placeholder="e.g. 2">
        </label>
        <label class="fl full">
          <span class="tenant-editor-label">Notes</span>
          <input class="fi tenant-item-notes" value="${escHtml(row.notes || '')}" placeholder="Optional">
        </label>
      </div>
    </div>`).join('');
}

function tenantRecurringChargeRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => `
    <div class="tenant-editor-surface tenant-recurring-charge-row" data-index="${index}">
      <div class="fg tenant-editor-inline-grid tenant-editor-inline-grid-charges" style="align-items:end">
        <label class="fl">
          <span class="tenant-editor-label">Description</span>
          <input class="fi tenant-recurring-charge-detail" value="${escHtml(row.detail || '')}" placeholder="Maintenance / Parking / Internet">
        </label>
        <label class="fl">
          <span class="tenant-editor-label">Amount (INR)</span>
          <input class="fi tenant-recurring-charge-amount" type="number" min="0" step="0.01" value="${escHtml(row.amount === '' || row.amount == null ? '' : String(row.amount))}" placeholder="500">
        </label>
        <div class="tenant-editor-inline-action">
          <button class="tenant-editor-row-remove" type="button" onclick="removeTenantRecurringChargeRow(this)">Remove</button>
        </div>
      </div>
    </div>`).join('');
}

function tenantNextInvoiceChargeRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => `
    <div class="tenant-editor-surface tenant-next-invoice-charge-row" data-index="${index}">
      <div class="fg tenant-editor-inline-grid tenant-editor-inline-grid-charges" style="align-items:end">
        <label class="fl">
          <span class="tenant-editor-label">Description</span>
          <input class="fi tenant-next-invoice-charge-detail" value="${escHtml(row.detail || '')}" placeholder="Repair / Cylinder / Adjustment">
        </label>
        <label class="fl">
          <span class="tenant-editor-label">Amount (INR)</span>
          <input class="fi tenant-next-invoice-charge-amount" type="number" min="0" step="0.01" value="${escHtml(row.amount === '' || row.amount == null ? '' : String(row.amount))}" placeholder="500">
        </label>
        <div class="tenant-editor-inline-action">
          <button class="tenant-editor-row-remove" type="button" onclick="removeTenantNextInvoiceChargeRow(this)">Remove</button>
        </div>
      </div>
    </div>`).join('');
}

function tenantAttachmentBadge(file, index, kind) {
  return `<span class="badge" style="display:inline-flex;align-items:center;gap:6px;margin:4px 6px 0 0">
    ${escHtml(file?.name || file?.path || 'file')}
    <button type="button" onclick="removeTenantModalFile('${kind}', ${Number(index)})" style="border:none;background:none;color:inherit;cursor:pointer;font-size:12px">x</button>
  </span>`;
}

function renderTenantModalAttachments() {
  const addressWrap = document.getElementById('tenantAddressProofWrap');
  const photoWrap = document.getElementById('tenantPhotoWrap');
  const proofWrap = document.getElementById('tenantProofListWrap');
  if (addressWrap) {
    addressWrap.innerHTML = _tenantModalFiles.address_proof
      ? tenantAttachmentBadge(_tenantModalFiles.address_proof, 0, 'address_proof')
      : '<span style="font-size:12px;color:var(--t3)">No file uploaded</span>';
  }
  if (photoWrap) {
    photoWrap.innerHTML = _tenantModalFiles.photo_attachment
      ? tenantAttachmentBadge(_tenantModalFiles.photo_attachment, 0, 'photo_attachment')
      : '<span style="font-size:12px;color:var(--t3)">No photo uploaded</span>';
  }
  if (proofWrap) {
    proofWrap.innerHTML = _tenantModalFiles.proof_attachments.length
      ? _tenantModalFiles.proof_attachments.map((file, index) => tenantAttachmentBadge(file, index, 'proof_attachments')).join('')
      : '<span style="font-size:12px;color:var(--t3)">No supporting proofs uploaded</span>';
  }
}

async function uploadTenantModalFile(inputId, kind) {
  const input = document.getElementById(inputId);
  const file = input?.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const response = await fetch('/api/tenants/upload', { method: 'POST', body: fd });
  const data = await response.json().catch(() => ({}));
  input.value = '';
  if (!response.ok || data?.error) {
    toast(data?.error || 'Could not upload file.', 'error');
    return;
  }
  if (kind === 'proof_attachments') _tenantModalFiles.proof_attachments.push(data.file);
  else _tenantModalFiles[kind] = data.file;
  renderTenantModalAttachments();
  toast('File uploaded', 'success');
}

function removeTenantModalFile(kind, index = 0) {
  if (kind === 'proof_attachments') _tenantModalFiles.proof_attachments.splice(index, 1);
  else _tenantModalFiles[kind] = null;
  renderTenantModalAttachments();
}

function addTenantVehicleRow() {
  const wrap = document.getElementById('tenantVehicleRows');
  if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', tenantModalVehicleRows([{ vehicle_type: '', vehicle_number: '', notes: '' }]));
}

function addTenantItemRow() {
  const wrap = document.getElementById('tenantItemRows');
  if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', tenantModalItemRows([{ item_name: '', quantity: '', notes: '' }]));
}

function addTenantRecurringChargeRow() {
  const wrap = document.getElementById('tenantRecurringChargeRows');
  if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', tenantRecurringChargeRows([{ detail: '', amount: '' }]));
}

function addTenantNextInvoiceChargeRow() {
  const wrap = document.getElementById('tenantNextInvoiceChargeRows');
  if (!wrap) return;
  wrap.insertAdjacentHTML('beforeend', tenantNextInvoiceChargeRows([{ detail: '', amount: '' }]));
}

function removeTenantVehicleRow(button) {
  button?.closest('.tenant-vehicle-row')?.remove();
}

function removeTenantItemRow(button) {
  button?.closest('.tenant-item-row')?.remove();
}

function removeTenantRecurringChargeRow(button) {
  button?.closest('.tenant-recurring-charge-row')?.remove();
}

function removeTenantNextInvoiceChargeRow(button) {
  button?.closest('.tenant-next-invoice-charge-row')?.remove();
}

function collectTenantModalRows(selector, mapper) {
  return [...document.querySelectorAll(selector)].map((row) => mapper(row)).filter(Boolean);
}

function setTenantEditorTab(tab = 'details') {
  _tenantEditorTab = String(tab || 'details');
  document.querySelectorAll('.tenant-editor-tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === _tenantEditorTab);
  });
  document.querySelectorAll('.tenant-editor-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== _tenantEditorTab;
  });
}

function tenantInfoRow(label, value) {
  return `
    <div style="display:grid;grid-template-columns:minmax(110px,140px) 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--br)">
      <div style="font-size:12px;color:var(--t3);font-weight:700">${escHtml(label || '')}</div>
      <div style="font-size:13px;color:var(--t1)">${value || '<span style="color:var(--t3)">-</span>'}</div>
    </div>`;
}

function tenantDetailFileLink(file, emptyLabel = 'Not uploaded') {
  if (!file?.path) return `<span style="color:var(--t3)">${escHtml(emptyLabel)}</span>`;
  return `<a href="${escHtml(file.path)}" target="_blank" rel="noopener">${escHtml(file.name || file.path || 'Attachment')}</a>`;
}

function tenantChargeItemsList(items = [], emptyLabel = 'No additional charges saved') {
  const list = (Array.isArray(items) ? items : []).filter((item) => (item?.detail || '').trim() || tenantNum(item?.amount || 0) !== 0);
  if (!list.length) return `<div style="font-size:12px;color:var(--t3)">${escHtml(emptyLabel)}</div>`;
  return `
    <div style="display:grid;gap:8px">
      ${list.map((item) => `
        <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid var(--br);border-radius:10px;background:#fff">
          <span style="font-size:12px;color:var(--t1)">${escHtml(item.detail || 'Charge')}</span>
          <strong style="font-size:12px;color:var(--t1)">${fmtCur(item.amount || 0)}</strong>
        </div>`).join('')}
    </div>`;
}

function tenantDetailSimpleList(items = [], renderer, emptyLabel) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return `<div style="font-size:12px;color:var(--t3)">${escHtml(emptyLabel)}</div>`;
  return `<div style="display:grid;gap:10px">${list.map(renderer).join('')}</div>`;
}

function tenantDetailInvoiceHistory(tenant) {
  const invoices = [...(Array.isArray(tenant?.invoices) ? tenant.invoices : [])]
    .sort((a, b) => String(b.invoice_month || '').localeCompare(String(a.invoice_month || '')) || Number(b.id) - Number(a.id));
  if (!invoices.length) return '<div style="font-size:12px;color:var(--t3)">No invoices created for this tenant yet.</div>';
  return `
    <div style="display:grid;gap:10px">
      ${invoices.map((invoice) => `
        <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:12px;border:1px solid var(--br);border-radius:12px;background:#fff">
          <div style="display:grid;gap:5px">
            <div style="font-size:13px;font-weight:800;color:var(--t1)">${escHtml(tenantMonthLabel(invoice.invoice_month))} <span style="font-weight:600;color:var(--t3)">• ${escHtml(invoice.room_label_snapshot || '-')}</span></div>
            <div style="font-size:12px;color:var(--t2)">Total ${fmtCur(invoice.total_amount || 0)} • ${escHtml(tenantInvoiceStatusLabel(invoice.payment_status))}</div>
            <div style="font-size:11px;color:var(--t3)">Due ${escHtml(tenantDateLabel(invoice.due_date))} • ${escHtml(tenantElectricityUsageText(invoice))}</div>
          </div>
          <button class="btn btn-s btn-sm" onclick="showTenantInvoiceViewModal(${Number(invoice.id)})">View Invoice</button>
        </div>`).join('')}
    </div>`;
}

function showTenantRecordDetailsModal(recordId) {
  const tenant = tenantFindRecord(recordId);
  if (!tenant) { toast('Tenant not found.', 'error'); return; }
  const room = tenantFindRoom(tenant.room_id);
  const building = tenantFindBuilding(tenant.building_id);
  const activeChargeProfile = tenantCurrentChargeProfile(tenant, tenantDefaultStartDate()) || tenant;
  const totalRecurringExtras = tenantNum((tenant.monthly_additional_charges || []).reduce((sum, item) => sum + tenantNum(item.amount || 0), 0));
  const totalPendingInvoiceExtras = tenantNum((tenant.next_invoice_charge_items || []).reduce((sum, item) => sum + tenantNum(item.amount || 0), 0));
  openModal(`Tenant Details - ${escHtml(tenant.tenant_name || 'Tenant')}`, `
    <div style="display:grid;gap:14px">
      <div class="card" style="padding:16px">
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap">
          <div>
            <div style="font-size:22px;font-weight:900;color:var(--t1)">${escHtml(tenant.tenant_name || 'Tenant')}</div>
            <div style="font-size:12px;color:var(--t3);margin-top:6px">${escHtml(building?.name || 'Building')} • ${escHtml(room?.room_label || 'Room')} • ${tenant.is_active ? 'Active' : 'Inactive'}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
            ${tenantChip(tenant.is_active ? 'Active Tenant' : 'Inactive Tenant', tenant.is_active ? 'green' : 'amber')}
            ${tenant.end_date ? tenantChip(`End ${tenantDateLabel(tenant.end_date)}`, 'neutral') : ''}
          </div>
        </div>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:8px">Tenant Profile</div>
        ${tenantInfoRow('Building', escHtml(building?.name || '-'))}
        ${tenantInfoRow('Room', escHtml(room?.room_label || '-'))}
        ${tenantInfoRow('Floor / Type', escHtml([room?.floor_label, room?.room_type].filter(Boolean).join(' • ') || '-'))}
        ${tenantInfoRow('Contact', escHtml(tenant.contact_number || '-'))}
        ${tenantInfoRow('Address', escHtml(tenant.tenant_address || '-'))}
        ${tenantInfoRow('Start Date', escHtml(tenantDateLabel(tenant.start_date)))}
        ${tenantInfoRow('End Date', escHtml(tenantDateLabel(tenant.end_date)))}
        ${tenantInfoRow('Contract', escHtml(tenant.contract_months ? `${Number(tenant.contract_months)} months` : '-'))}
        ${tenantInfoRow('Portal Invoices From', escHtml(tenant.portal_invoices_visible_from ? tenantMonthLabel(tenant.portal_invoices_visible_from) : 'All months'))}
        ${tenantInfoRow('Security Deposit', fmtCur(tenant.security_deposit || 0))}
        ${tenantInfoRow('Notes', escHtml(tenant.notes || '-'))}
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:8px">Current Charges</div>
        ${tenantInfoRow('Rent / Month', fmtCur(activeChargeProfile.rent_amount || tenant.rent_amount || 0))}
        ${tenantInfoRow('Electricity / Unit', fmtCur(activeChargeProfile.electricity_unit_price || tenant.electricity_unit_price || 0))}
        ${tenantInfoRow('Opening Meter', escHtml(String(activeChargeProfile.opening_electricity_units ?? tenant.opening_electricity_units ?? 0)))}
        ${tenantInfoRow('Sewerage', fmtCur(activeChargeProfile.sewerage_charge || tenant.sewerage_charge || 0))}
        ${tenantInfoRow('Water', fmtCur(activeChargeProfile.water_charge || tenant.water_charge || 0))}
        ${tenantInfoRow('Cleaning', fmtCur(activeChargeProfile.cleaning_charge || tenant.cleaning_charge || 0))}
        ${tenantInfoRow('Recurring Extras', `${fmtCur(totalRecurringExtras)}<div style="margin-top:8px">${tenantChargeItemsList(tenant.monthly_additional_charges, 'No recurring extra charges saved')}</div>`)}
        ${tenantInfoRow('Next Invoice Extras', `${fmtCur(totalPendingInvoiceExtras)}<div style="margin-top:8px">${tenantChargeItemsList(tenant.next_invoice_charge_items, 'No one-time next invoice charges saved')}</div>`)}
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:8px">Attachments</div>
        ${tenantInfoRow('Address Proof', tenantDetailFileLink(tenant.address_proof, 'No address proof uploaded'))}
        ${tenantInfoRow('Photo', tenantDetailFileLink(tenant.photo_attachment, 'No photo uploaded'))}
        ${tenantInfoRow('Supporting Proofs', tenantDetailSimpleList(tenant.proof_attachments, (file) => `<div>${tenantDetailFileLink(file, 'Attachment')}</div>`, 'No supporting proofs uploaded'))}
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:8px">Vehicles</div>
        ${tenantDetailSimpleList(tenant.vehicles, (vehicle) => `
          <div style="padding:12px;border:1px solid var(--br);border-radius:12px;background:#fff">
            <div style="font-size:13px;font-weight:800;color:var(--t1)">${escHtml(vehicle.vehicle_type || 'Vehicle')}</div>
            <div style="font-size:12px;color:var(--t2);margin-top:4px">${escHtml(vehicle.vehicle_number || '-')}</div>
            ${vehicle.notes ? `<div style="font-size:11px;color:var(--t3);margin-top:6px">${escHtml(vehicle.notes)}</div>` : ''}
          </div>`, 'No vehicle details saved')}
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:8px">Items Provided</div>
        ${tenantDetailSimpleList(tenant.provided_items, (item) => `
          <div style="padding:12px;border:1px solid var(--br);border-radius:12px;background:#fff">
            <div style="font-size:13px;font-weight:800;color:var(--t1)">${escHtml(item.item_name || 'Item')} ${item.quantity ? `<span style="font-size:12px;color:var(--t3)">• Qty ${Number(item.quantity)}</span>` : ''}</div>
            ${item.notes ? `<div style="font-size:11px;color:var(--t3);margin-top:6px">${escHtml(item.notes)}</div>` : ''}
          </div>`, 'No provided items saved')}
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:8px">Charge History</div>
        <div style="font-size:12px;color:var(--t3);margin-bottom:10px">Saved rate changes and effective periods for this tenant.</div>
        ${tenantChargeHistoryHtml(tenant.charge_history || [])}
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:15px;font-weight:800;color:var(--t1);margin-bottom:8px">Invoice History</div>
        ${tenantDetailInvoiceHistory(tenant)}
      </div>
      <div class="fa">
        <button class="btn btn-p" onclick="showTenantRecordModal(${Number(tenant.id)})">Edit Tenant</button>
        <button class="btn btn-s" onclick="showTenantInvoiceModal(${Number(tenant.id)})">Generate Invoice</button>
        <button class="btn btn-s" onclick="closeModal()">Close</button>
      </div>
    </div>`);
}

function showTenantRecordModal(recordId = null) {
  const selectedBuilding = tenantFindBuilding(_selectedTenantBuildingId);
  if (!selectedBuilding) { toast('Select a building first.', 'warning'); return; }
  if (!(selectedBuilding.rooms || []).length) { toast('Add a room before adding a tenant.', 'warning'); return; }
  const record = recordId ? tenantFindRecord(recordId) : null;
  const activeChargeProfile = tenantCurrentChargeProfile(record, tenantDefaultStartDate());
  const recurringCharges = Array.isArray(activeChargeProfile?.monthly_additional_charges)
    ? activeChargeProfile.monthly_additional_charges
    : (record?.monthly_additional_charges || []);
  const nextInvoiceCharges = Array.isArray(record?.next_invoice_charge_items)
    ? record.next_invoice_charge_items
    : [];
  const rooms = [...(selectedBuilding.rooms || [])].sort((a, b) => String(a.room_label || '').localeCompare(String(b.room_label || '')));
  if (!rooms.length) {
    toast('No rooms available in this building.', 'warning');
    return;
  }
  _tenantModalFiles = {
    address_proof: record?.address_proof || null,
    photo_attachment: record?.photo_attachment || null,
    proof_attachments: [...(record?.proof_attachments || [])],
  };
  _tenantEditorTab = 'details';
  window.__modalClassName = 'tenant-editor-modal-shell';
  showModal(`
    <div class="tenant-editor-modal">
      <div class="tenant-editor-hero">
        <div class="tenant-editor-hero-main">
          <div class="tenant-editor-avatar">${escHtml(tenantInitials(record?.tenant_name || 'Tenant'))}</div>
          <div>
            <div class="tenant-editor-title">${escHtml(record ? 'Edit Tenant' : 'Add Tenant')}</div>
            <div class="tenant-editor-subtitle">${escHtml([record ? (tenantFindRoom(record.room_id)?.room_label || 'Room') : (rooms[0]?.room_label || 'Room'), selectedBuilding?.name || 'Building'].filter(Boolean).join(' • '))}</div>
          </div>
        </div>
        <button class="tenant-editor-close" type="button" onclick="closeModal()">x</button>
      </div>
      <div class="tenant-editor-tabs">
        <button class="tenant-editor-tab active" type="button" data-tab="details" onclick="setTenantEditorTab('details')"><span class="tenant-editor-tab-icon">${tenantEditorTabIcon('details')}</span>Details</button>
        <button class="tenant-editor-tab" type="button" data-tab="charges" onclick="setTenantEditorTab('charges')"><span class="tenant-editor-tab-icon">${tenantEditorTabIcon('charges')}</span>Charges</button>
        <button class="tenant-editor-tab" type="button" data-tab="assets" onclick="setTenantEditorTab('assets')"><span class="tenant-editor-tab-icon">${tenantEditorTabIcon('assets')}</span>Vehicles & Items</button>
        <button class="tenant-editor-tab" type="button" data-tab="documents" onclick="setTenantEditorTab('documents')"><span class="tenant-editor-tab-icon">${tenantEditorTabIcon('documents')}</span>Documents</button>
      </div>
      <div class="tenant-editor-content">
        <div class="tenant-editor-panel" data-panel="details">
          ${tenantEditorSection('Tenant Details')}
          <div class="fg">
            <label class="fl">
              <span class="tenant-editor-label">Tenant Name</span>
              <input class="fi" id="tenantRecordName" value="${escHtml(record?.tenant_name || '')}" placeholder="Tenant name">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Room</span>
              <select class="fi" id="tenantRecordRoom" onchange="updateTenantSharedRoomNotice(${Number(record?.id || 0)})">${rooms.map((room) => {
                const others = tenantRoomOccupantCount(room, record?.id || 0);
                const suffix = others > 0 ? ` (${others} active)` : '';
                return `<option value="${Number(room.id)}" ${String(room.id) === String(record?.room_id || '') ? 'selected' : ''}>${escHtml(`${room.room_label || 'Room'}${suffix}`)}</option>`;
              }).join('')}</select>
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Contact Number</span>
              <input class="fi" id="tenantRecordContact" value="${escHtml(record?.contact_number || '')}" placeholder="98XXXXXXXX">
            </label>
            <label class="fl tenant-editor-input-suffix">
              <span class="tenant-editor-label">Contract Period</span>
              <input class="fi" type="number" min="0" step="1" id="tenantRecordContractMonths" value="${escHtml(String(record?.contract_months ?? ''))}" placeholder="12">
              <span>months</span>
            </label>
          </div>
          ${tenantEditorSection('Dates')}
          <div class="fg">
            <label class="fl">
              <span class="tenant-editor-label">Start From</span>
              <input class="fi" type="date" id="tenantRecordStartDate" value="${escHtml(tenantInputDateValue(record?.start_date, tenantDefaultStartDate()))}">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">End Date</span>
              <input class="fi" type="date" id="tenantRecordEndDate" value="${escHtml(tenantInputDateValue(record?.end_date, ''))}">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Charge Effective From</span>
              <input class="fi" type="date" id="tenantChargeEffectiveFrom" value="${escHtml(record ? tenantDefaultStartDate() : tenantInputDateValue(record?.start_date, tenantDefaultStartDate()))}">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Security Deposited</span>
              <input class="fi" type="number" min="0" step="0.01" id="tenantRecordSecurity" value="${escHtml(String(record?.security_deposit || 0))}" placeholder="12000">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Portal Invoices Visible From</span>
              <input class="fi" type="month" id="tenantPortalInvoicesVisibleFrom" value="${escHtml(String(record?.portal_invoices_visible_from || ''))}">
            </label>
          </div>
          <div style="font-size:12px;color:var(--t3);margin-top:10px">Leave blank to let the tenant see all invoice months. Set a month to hide any older invoices in the tenant portal.</div>
          <div id="tenantSharedRoomNotice" style="margin-top:14px"></div>
          ${tenantEditorSection('Address & Notes')}
          <div class="fg">
            <label class="fl full">
              <span class="tenant-editor-label">Tenant Address</span>
              <textarea class="fi" id="tenantRecordAddress" rows="4" placeholder="House no., street, area, city...">${escHtml(record?.tenant_address || '')}</textarea>
            </label>
            <label class="fl full">
              <span class="tenant-editor-label">Notes</span>
              <textarea class="fi" id="tenantRecordNotes" rows="3" placeholder="Optional notes">${escHtml(record?.notes || '')}</textarea>
            </label>
          </div>
        </div>
        <div class="tenant-editor-panel" data-panel="charges" hidden>
          ${tenantEditorSection('Monthly Charges')}
          <div class="fg tenant-editor-grid-3">
            <label class="fl">
              <span class="tenant-editor-label">Rent / Month</span>
              <input class="fi" type="number" min="0" step="0.01" id="tenantRecordRent" value="${escHtml(String((activeChargeProfile?.rent_amount ?? record?.rent_amount) || 0))}">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Electricity / Unit</span>
              <input class="fi" type="number" min="0" step="0.01" id="tenantRecordUnitPrice" value="${escHtml(String((activeChargeProfile?.electricity_unit_price ?? record?.electricity_unit_price) || 0))}">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Opening Meter Units</span>
              <input class="fi" type="number" min="0" step="1" id="tenantRecordOpeningUnits" value="${escHtml(String((activeChargeProfile?.opening_electricity_units ?? record?.opening_electricity_units) || 0))}">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Sewerage Charge</span>
              <input class="fi" type="number" min="0" step="0.01" id="tenantRecordSewerage" value="${escHtml(String((activeChargeProfile?.sewerage_charge ?? record?.sewerage_charge) || 0))}">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Water Charge</span>
              <input class="fi" type="number" min="0" step="0.01" id="tenantRecordWater" value="${escHtml(String((activeChargeProfile?.water_charge ?? record?.water_charge) || 0))}">
            </label>
            <label class="fl">
              <span class="tenant-editor-label">Cleaning Charge</span>
              <input class="fi" type="number" min="0" step="0.01" id="tenantRecordCleaning" value="${escHtml(String((activeChargeProfile?.cleaning_charge ?? record?.cleaning_charge) || 0))}">
            </label>
          </div>
          ${tenantEditorSection('Monthly Additional Charges', 'Auto-applied on every invoice')}
          <div id="tenantRecurringChargeRows" style="display:grid;gap:10px">${tenantRecurringChargeRows(recurringCharges)}</div>
          <button class="tenant-editor-add-line" type="button" style="margin-top:10px" onclick="addTenantRecurringChargeRow()">+ Add Monthly Charge</button>
          ${tenantEditorSection('Next Invoice Only Charges', 'Saved now, included only in the next generated invoice')}
          <div id="tenantNextInvoiceChargeRows" style="display:grid;gap:10px">${tenantNextInvoiceChargeRows(nextInvoiceCharges)}</div>
          <button class="tenant-editor-add-line" type="button" style="margin-top:10px" onclick="addTenantNextInvoiceChargeRow()">+ Add Next Invoice Charge</button>
          ${tenantEditorSection('Charge History')}
          <div class="tenant-editor-surface tenant-editor-history-wrap">
            <div style="font-size:12px;color:var(--t3);margin-bottom:10px">Every rate change is saved with its own effective period.</div>
            <div>${tenantChargeHistoryHtml(record?.charge_history || [])}</div>
          </div>
        </div>
        <div class="tenant-editor-panel" data-panel="assets" hidden>
          ${tenantEditorSection('Vehicle Details')}
          <div id="tenantVehicleRows" style="display:grid;gap:10px">${tenantModalVehicleRows(record?.vehicles || [])}</div>
          <button class="tenant-editor-add-line" type="button" style="margin-top:10px" onclick="addTenantVehicleRow()">+ Add Vehicle</button>
          ${tenantEditorSection('Items Provided')}
          <div id="tenantItemRows" style="display:grid;gap:10px">${tenantModalItemRows(record?.provided_items || [])}</div>
          <button class="tenant-editor-add-line" type="button" style="margin-top:10px" onclick="addTenantItemRow()">+ Add Item</button>
        </div>
        <div class="tenant-editor-panel" data-panel="documents" hidden>
          ${tenantEditorSection('Address Proof & Attachments')}
          <div class="tenant-editor-upload-stack">
            <div class="tenant-editor-upload-card">
              <div class="tenant-editor-upload-copy">
                <div class="tenant-editor-upload-icon tone-blue">ID</div>
                <div>
                  <div class="tenant-editor-upload-title">Address Proof</div>
                  <div id="tenantAddressProofWrap"></div>
                </div>
              </div>
              <div>
                <input type="file" id="tenantAddressProofInput" style="display:none" onchange="uploadTenantModalFile('tenantAddressProofInput','address_proof')">
                <button class="btn btn-s btn-sm" type="button" onclick="document.getElementById('tenantAddressProofInput').click()">Upload</button>
              </div>
            </div>
            <div class="tenant-editor-upload-card">
              <div class="tenant-editor-upload-copy">
                <div class="tenant-editor-upload-icon tone-amber">PH</div>
                <div>
                  <div class="tenant-editor-upload-title">Tenant Photo</div>
                  <div id="tenantPhotoWrap"></div>
                </div>
              </div>
              <div>
                <input type="file" id="tenantPhotoInput" accept="image/*" style="display:none" onchange="uploadTenantModalFile('tenantPhotoInput','photo_attachment')">
                <button class="btn btn-s btn-sm" type="button" onclick="document.getElementById('tenantPhotoInput').click()">Upload</button>
              </div>
            </div>
            <div class="tenant-editor-upload-card">
              <div class="tenant-editor-upload-copy">
                <div class="tenant-editor-upload-icon tone-green">AT</div>
                <div>
                  <div class="tenant-editor-upload-title">Supporting Proof Attachments</div>
                  <div id="tenantProofListWrap"></div>
                </div>
              </div>
              <div>
                <input type="file" id="tenantProofInput" style="display:none" onchange="uploadTenantModalFile('tenantProofInput','proof_attachments')">
                <button class="btn btn-s btn-sm" type="button" onclick="document.getElementById('tenantProofInput').click()">Upload</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="tenant-editor-footer">
        <button class="btn btn-p" type="button" onclick="saveTenantRecord(${recordId || 'null'})">${record ? 'Update Tenant' : 'Add Tenant'}</button>
        ${record ? `<button class="btn btn-g" type="button" style="color:var(--red)" onclick="deleteTenantRecord(${Number(record.id)})">Delete</button>` : ''}
        <button class="btn btn-s" type="button" onclick="closeModal()">Cancel</button>
      </div>
    </div>`);
  setTenantEditorTab('details');
  renderTenantModalAttachments();
  updateTenantSharedRoomNotice(record?.id || 0);
}

async function saveTenantRecord(recordId = null) {
  const monthly_additional_charges = collectTenantModalRows('.tenant-recurring-charge-row', (row) => {
    const detail = row.querySelector('.tenant-recurring-charge-detail')?.value?.trim() || '';
    const amountValue = row.querySelector('.tenant-recurring-charge-amount')?.value || '';
    const amount = amountValue === '' ? 0 : Number(amountValue);
    if (!detail && !amount) return null;
    return { detail, amount };
  });
  const next_invoice_charge_items = collectTenantModalRows('.tenant-next-invoice-charge-row', (row) => {
    const detail = row.querySelector('.tenant-next-invoice-charge-detail')?.value?.trim() || '';
    const amountValue = row.querySelector('.tenant-next-invoice-charge-amount')?.value || '';
    const amount = amountValue === '' ? 0 : Number(amountValue);
    if (!detail && !amount) return null;
    return { detail, amount };
  });
  const vehicles = collectTenantModalRows('.tenant-vehicle-row', (row) => {
    const vehicle_type = row.querySelector('.tenant-vehicle-type')?.value?.trim() || '';
    const vehicle_number = row.querySelector('.tenant-vehicle-number')?.value?.trim() || '';
    const notes = row.querySelector('.tenant-vehicle-notes')?.value?.trim() || '';
    if (!vehicle_type && !vehicle_number && !notes) return null;
    return { vehicle_type, vehicle_number, notes };
  });
  const provided_items = collectTenantModalRows('.tenant-item-row', (row) => {
    const item_name = row.querySelector('.tenant-item-name')?.value?.trim() || '';
    const quantityValue = row.querySelector('.tenant-item-quantity')?.value || '';
    const quantity = Number(quantityValue || 0);
    const notes = row.querySelector('.tenant-item-notes')?.value?.trim() || '';
    if (!item_name && !quantity && !notes) return null;
    return { item_name, quantity, notes };
  });
  const body = {
    building_id: Number(_selectedTenantBuildingId || 0),
    room_id: Number(document.getElementById('tenantRecordRoom')?.value || 0),
    tenant_name: tenantDefaultName(document.getElementById('tenantRecordName')?.value),
    start_date: document.getElementById('tenantRecordStartDate')?.value || tenantDefaultStartDate(),
    end_date: document.getElementById('tenantRecordEndDate')?.value || '',
    charge_effective_from: document.getElementById('tenantChargeEffectiveFrom')?.value || tenantDefaultStartDate(),
    contract_months: document.getElementById('tenantRecordContractMonths')?.value || '',
    portal_invoices_visible_from: document.getElementById('tenantPortalInvoicesVisibleFrom')?.value || '',
    tenant_address: document.getElementById('tenantRecordAddress')?.value?.trim() || '',
    contact_number: document.getElementById('tenantRecordContact')?.value?.trim() || '',
    security_deposit: Number(document.getElementById('tenantRecordSecurity')?.value || 0),
    rent_amount: Number(document.getElementById('tenantRecordRent')?.value || 0),
    electricity_unit_price: Number(document.getElementById('tenantRecordUnitPrice')?.value || 0),
    opening_electricity_units: Number(document.getElementById('tenantRecordOpeningUnits')?.value || 0),
    sewerage_charge: Number(document.getElementById('tenantRecordSewerage')?.value || 0),
    water_charge: Number(document.getElementById('tenantRecordWater')?.value || 0),
    cleaning_charge: Number(document.getElementById('tenantRecordCleaning')?.value || 0),
    monthly_additional_charges,
    next_invoice_charge_items,
    notes: document.getElementById('tenantRecordNotes')?.value?.trim() || '',
    address_proof: _tenantModalFiles.address_proof,
    photo_attachment: _tenantModalFiles.photo_attachment,
    proof_attachments: _tenantModalFiles.proof_attachments,
    vehicles,
    provided_items,
    allow_shared_room: !!document.getElementById('tenantAllowSharedRoom')?.checked,
  };
  if (!(body.room_id > 0)) {
    toast('Please select a room.', 'warning');
    return;
  }
  const result = recordId
    ? await api(`/api/tenants/records/${Number(recordId)}`, { method: 'PUT', body })
    : await api('/api/tenants/records', { method: 'POST', body });
  if (!result?.success) { toast(result?.error || 'Could not save tenant.', 'error'); return; }
  closeModal();
  _selectedTenantRecordId = Number(result.tenant?.id || recordId || _selectedTenantRecordId);
  toast(recordId ? 'Tenant updated' : 'Tenant added', 'success');
  await loadTenantsPage();
}

async function deleteTenantRecord(recordId) {
  if (!await confirmDialog('Delete this tenant record and all invoices for it?')) return;
  const result = await api(`/api/tenants/records/${Number(recordId)}`, { method: 'DELETE' });
  if (!result?.success) { toast(result?.error || 'Could not delete tenant.', 'error'); return; }
  closeModal();
  if (String(_selectedTenantRecordId) === String(recordId)) _selectedTenantRecordId = null;
  toast('Tenant deleted', 'success');
  await loadTenantsPage();
}

function showTenantInvoiceModal(recordId, options = {}) {
  const building = tenantFindBuilding(_selectedTenantBuildingId);
  const buildingTenants = (_tenantOverview?.tenants || [])
    .filter((tenant) => String(tenant.building_id) === String(building?.id || '') && tenant.is_active);
  const fallbackTenantId = _selectedTenantRecordId && buildingTenants.some((tenant) => String(tenant.id) === String(_selectedTenantRecordId))
    ? Number(_selectedTenantRecordId)
    : Number(buildingTenants[0]?.id || 0);
  const resolvedRecordId = Number(recordId || fallbackTenantId || 0);
  const tenant = tenantFindRecord(resolvedRecordId);
  if (!tenant) { toast('Tenant not found.', 'error'); return; }
  _selectedTenantRecordId = Number(tenant.id);
  const room = tenantFindRoom(tenant.room_id);
  const roommateCount = Math.max(1, tenantRoomActiveTenants(room).length || 1);
  const splitConfig = tenantDefaultSplitConfig(roommateCount > 1);
  const invoiceMonth = String(options.invoiceMonth || tenantCurrentMonthKey()).trim() || tenantCurrentMonthKey();
  const dueDate = String(options.dueDate || new Date().toISOString().slice(0, 10)).trim() || new Date().toISOString().slice(0, 10);
  const readingDefaults = tenantInvoiceReadingDefaults(tenant, invoiceMonth);
  const previousUnits = readingDefaults.previousUnits;
  const currentUnits = readingDefaults.currentUnits;
  const tenantOptions = buildingTenants.map((item) => `<option value="${Number(item.id)}" ${String(item.id) === String(tenant.id) ? 'selected' : ''}>${escHtml(item.tenant_name || 'Tenant')}</option>`).join('');
  openModal(`Invoice - ${escHtml(tenant.tenant_name)}`, `
    <div class="card" style="padding:14px;margin-bottom:14px;background:#f7faf8">
      <div style="font-size:16px;font-weight:800;color:var(--t1)">${escHtml(tenant.tenant_name || 'Tenant')}</div>
      <div id="tenantInvoiceMeta" style="font-size:12px;color:var(--t3);margin-top:4px">Rent ${fmtCur(tenant.rent_amount || 0)} • Electricity ${fmtCur(tenant.electricity_unit_price || 0)}/unit • Previous units ${previousUnits}${readingDefaults.sourceLabel ? ` • ${escHtml(readingDefaults.sourceLabel)}` : ''}</div>
    </div>
    <div class="fg">
      <label class="fl full">Tenant
        <select class="fi" id="tenantInvoiceTenantId" onchange="changeTenantInvoiceModalTenant(this.value)">
          ${tenantOptions}
        </select>
      </label>
      <label class="fl">Invoice Month *<input class="fi" type="month" id="tenantInvoiceMonth" value="${escHtml(invoiceMonth)}" onchange="updateTenantInvoiceModalReadings()"></label>
      <label class="fl">Due Date<input class="fi" type="date" id="tenantInvoiceDueDate" value="${escHtml(dueDate)}"></label>
      <label class="fl">Previous Units<input class="fi" type="number" id="tenantInvoicePrevUnits" value="${previousUnits}" disabled></label>
      <label class="fl">Current Units *<input class="fi" type="number" min="${previousUnits}" step="1" id="tenantInvoiceCurrentUnits" value="${escHtml(String(currentUnits))}" placeholder="Enter current reading"></label>
      <label class="fl">Extra Units (+/-)<input class="fi" type="number" step="1" id="tenantInvoiceExtraUnits" value="0" placeholder="0"></label>
      <label class="fl">Payment Status
        <select class="fi" id="tenantInvoiceStatus" onchange="toggleTenantInvoicePaidAmount()">
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="partial_paid">Partial Paid</option>
        </select>
      </label>
      <label class="fl" id="tenantInvoicePaidAmountWrap" style="display:none">Paid Amount<input class="fi" type="number" min="0" step="0.01" id="tenantInvoicePaidAmount" value="0"></label>
      <label class="fl full">Notes<textarea class="fi" id="tenantInvoiceNotes" rows="3" placeholder="Optional notes for this month"></textarea></label>
    </div>
    ${tenantSplitOptionsCard('tenantInvoice', roommateCount, splitConfig)}
    <div class="card" style="padding:14px;margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div style="font-size:15px;font-weight:800;color:var(--t1)">Other Charges</div>
        <button class="btn btn-s btn-sm" onclick="addTenantInvoiceOtherChargeRow()">+ Add Charge</button>
      </div>
      <div id="tenantInvoiceOtherRows" style="margin-top:10px">${tenantInvoiceOtherChargeRows([])}</div>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveTenantInvoice(Number(document.getElementById('tenantInvoiceTenantId')?.value || 0))">Save Invoice</button>
      <button class="btn btn-s" onclick="closeModal()">Cancel</button>
    </div>`);
  toggleTenantInvoicePaidAmount();
}

function changeTenantInvoiceModalTenant(value) {
  const tenantId = Number(value || 0);
  if (!tenantId) return;
  showTenantInvoiceModal(tenantId, {
    invoiceMonth: document.getElementById('tenantInvoiceMonth')?.value || tenantCurrentMonthKey(),
    dueDate: document.getElementById('tenantInvoiceDueDate')?.value || new Date().toISOString().slice(0, 10),
  });
}

function updateTenantInvoiceModalReadings() {
  const tenantId = Number(document.getElementById('tenantInvoiceTenantId')?.value || 0);
  const invoiceMonth = document.getElementById('tenantInvoiceMonth')?.value || tenantCurrentMonthKey();
  const tenant = tenantFindRecord(tenantId);
  if (!tenant) return;
  const defaults = tenantInvoiceReadingDefaults(tenant, invoiceMonth);
  const prevInput = document.getElementById('tenantInvoicePrevUnits');
  const currentInput = document.getElementById('tenantInvoiceCurrentUnits');
  const meta = document.getElementById('tenantInvoiceMeta');
  if (prevInput) prevInput.value = String(defaults.previousUnits);
  if (currentInput) {
    currentInput.min = String(defaults.previousUnits);
    currentInput.value = defaults.currentUnits === '' ? '' : String(defaults.currentUnits);
  }
  if (meta) {
    meta.textContent = `Rent ${fmtCur(tenant.rent_amount || 0)} • Electricity ${fmtCur(tenant.electricity_unit_price || 0)}/unit • Previous units ${defaults.previousUnits}${defaults.sourceLabel ? ` • ${defaults.sourceLabel}` : ''}`;
  }
}

function updateTenantSharedRoomNotice(recordId = 0) {
  const roomId = Number(document.getElementById('tenantRecordRoom')?.value || 0);
  const room = tenantFindRoom(roomId);
  const wrap = document.getElementById('tenantSharedRoomNotice');
  if (!wrap) return;
  const others = tenantRoomOccupantCount(room, recordId || 0);
  if (!(others > 0)) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = `
    <div class="card" style="padding:14px;background:#fff8e8;border:1px solid #f2d58c">
      <div style="font-size:13px;font-weight:800;color:#8b5c00">This room already has ${others} active tenant${others === 1 ? '' : 's'}.</div>
      <div style="font-size:12px;color:#7a6440;margin-top:4px">Enable shared room to add another tenant here. Invoice divide options can then split charges among ${others + 1} tenants.</div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;font-weight:700;color:var(--t2)">
        <input type="checkbox" id="tenantAllowSharedRoom">
        Allow shared room occupancy
      </label>
    </div>`;
}

function tenantInvoicePaymentRequestHtml(invoice) {
  const request = invoice?.pending_payment_request || null;
  if (!request || String(request.status || '').toLowerCase() !== 'pending') return '';
  const requestedAmount = fmtCur(request.requested_amount || invoice?.total_amount || 0);
  const tenantNote = String(request.tenant_note || '').trim();
  return `
    <div style="margin-top:10px;padding:10px 12px;border:1px solid #f2d9a4;border-radius:14px;background:#fff9ef;display:grid;gap:8px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#a76c00">Tenant Marked Paid</div>
      <div style="font-size:13px;font-weight:800;color:var(--t1)">Requested amount ${requestedAmount}</div>
      ${tenantNote ? `<div style="font-size:12px;line-height:1.5;color:var(--t2)">${escHtml(tenantNote)}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-p btn-sm" onclick="reviewTenantPaymentRequest(${Number(request.id)}, 'approved')">Approve</button>
        <button class="btn btn-s btn-sm" style="color:var(--red)" onclick="reviewTenantPaymentRequest(${Number(request.id)}, 'rejected')">Reject</button>
      </div>
    </div>`;
}

function showTenantBulkInvoiceModal() {
  const building = tenantFindBuilding(_selectedTenantBuildingId);
  if (!building) { toast('Select a building first.', 'warning'); return; }
  const tenants = (_tenantOverview?.tenants || [])
    .filter((tenant) => String(tenant.building_id) === String(building.id) && tenant.is_active)
    .sort((a, b) => (a.room_id - b.room_id) || String(a.tenant_name || '').localeCompare(String(b.tenant_name || '')));
  if (!tenants.length) { toast('No active tenants available in this building.', 'warning'); return; }
  const monthKey = tenantCurrentMonthKey();
  window.__tenantSplitChangeHandler = (input) => {
    const id = String(input?.id || '');
    const match = id.match(/^tenantBulk_(\d+)_/);
    if (match) updateTenantBulkInvoiceRow(Number(match[1]));
  };
  window.__modalClassName = 'modal-wide tenant-bulk-modal';
  openModal(`Generate Monthly Bills - ${escHtml(building.name || 'Building')}`, `
    <div class="card" style="padding:16px;margin-bottom:16px;border:1px solid #cfe0ff">
      <div style="font-size:22px;font-weight:900;color:var(--t1)">Generate Monthly Bills</div>
      <div class="fg" style="margin-top:14px">
        <label class="fl">Billing Month
          <input class="fi" type="month" id="tenantBulkInvoiceMonth" value="${escHtml(monthKey)}" onchange="refreshTenantBulkInvoiceModal()">
        </label>
        <label class="fl">Default Due Date
          <input class="fi" type="date" id="tenantBulkInvoiceDueDate" value="${escHtml(tenantDefaultStartDate())}">
        </label>
      </div>
    </div>
    <div class="tenant-bulk-list">
      ${tenants.map((tenant) => {
        const estimate = tenantBulkInvoiceEstimate(tenant, monthKey);
        return `
          <div class="tenant-bulk-card">
            <div class="tenant-bulk-card-top">
              <div class="tenant-bulk-name">${escHtml(tenant.tenant_name || 'Tenant')}</div>
              <div class="tenant-bulk-total" id="tenantBulkEstimate_${Number(tenant.id)}">${fmtCur(estimate.total)}</div>
            </div>
            <div class="tenant-bulk-grid">
              <div class="tenant-bulk-field">
                <div class="tenant-bulk-label">Last Reading</div>
                <div class="tenant-bulk-badge" id="tenantBulkPrevUnits_${Number(tenant.id)}">${estimate.previousUnits}</div>
              </div>
              <label class="tenant-bulk-field">
                <div class="tenant-bulk-label">Current Reading</div>
                <input class="fi" type="number" min="${estimate.previousUnits}" step="1" id="tenantBulkCurrentUnits_${Number(tenant.id)}" value="" placeholder="Enter reading" oninput="updateTenantBulkInvoiceRow(${Number(tenant.id)})">
              </label>
              <div class="tenant-bulk-field">
                <div class="tenant-bulk-label">Payment</div>
                <select class="fi" id="tenantBulkStatus_${Number(tenant.id)}" onchange="updateTenantBulkInvoiceRow(${Number(tenant.id)})">
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                  <option value="partial_paid">Partial Paid</option>
                </select>
                <div id="tenantBulkPaidWrap_${Number(tenant.id)}" style="display:none;margin-top:8px">
                  <input class="fi" type="number" min="0" step="0.01" id="tenantBulkPaidAmount_${Number(tenant.id)}" value="0" placeholder="Paid amount">
                </div>
              </div>
            </div>
            ${tenantSplitOptionsCard(tenantBulkSplitPrefix(tenant.id), estimate.roommateCount, tenantDefaultSplitConfig(estimate.roommateCount > 1))}
            <div class="tenant-bulk-extra">
              <div class="tenant-bulk-extra-head">
                <div class="tenant-bulk-label">Extra Expenses</div>
                <button class="btn btn-s btn-sm" onclick="addTenantBulkOtherChargeRow(${Number(tenant.id)})">+ Add Expense</button>
              </div>
              <div id="tenantBulkOtherWrap_${Number(tenant.id)}">${tenantBulkRowOtherChargeRows(tenant.id, [])}</div>
            </div>
          </div>`;
      }).join('')}
    </div>
    <div class="card" style="padding:18px;margin-top:16px;border:1px solid #cfe7d6;background:#f7fbf8;text-align:center">
      <div style="font-size:14px;font-weight:800;color:#1E6B49">Total Billed (All Tenants)</div>
      <div id="tenantBulkInvoiceGrandTotal" style="font-size:34px;font-weight:900;color:#1E6B49;margin-top:8px">${fmtCur(tenants.reduce((sum, tenant) => sum + tenantBulkInvoiceEstimate(tenant, monthKey).total, 0))}</div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="saveTenantBulkInvoices()">Generate All Bills</button>
      <button class="btn btn-s" onclick="closeModal()">Cancel</button>
    </div>`);
}

function refreshTenantBulkInvoiceModal() {
  const building = tenantFindBuilding(_selectedTenantBuildingId);
  const tenants = (_tenantOverview?.tenants || []).filter((tenant) => String(tenant.building_id) === String(building?.id || '') && tenant.is_active);
  tenants.forEach((tenant) => updateTenantBulkInvoiceRow(tenant.id));
}

async function saveTenantBulkInvoices() {
  const building = tenantFindBuilding(_selectedTenantBuildingId);
  if (!building) { toast('Select a building first.', 'warning'); return; }
  const monthKey = document.getElementById('tenantBulkInvoiceMonth')?.value || '';
  const dueDate = document.getElementById('tenantBulkInvoiceDueDate')?.value || '';
  const tenants = (_tenantOverview?.tenants || []).filter((tenant) => String(tenant.building_id) === String(building.id) && tenant.is_active);
  const rows = tenants.map((tenant) => {
    const estimate = tenantBulkInvoiceEstimate(tenant, monthKey);
    const status = document.getElementById(`tenantBulkStatus_${Number(tenant.id)}`)?.value || 'pending';
    return {
      tenant_id: Number(tenant.id),
      due_date: dueDate,
      current_electricity_units: Number(document.getElementById(`tenantBulkCurrentUnits_${Number(tenant.id)}`)?.value || estimate.previousUnits),
      payment_status: status,
      paid_amount: Number(document.getElementById(`tenantBulkPaidAmount_${Number(tenant.id)}`)?.value || 0),
      split_config: tenantReadSplitConfig(tenantBulkSplitPrefix(tenant.id)),
      other_charge_items: estimate.otherItems,
      notes: '',
    };
  }).filter((row) => Number.isFinite(row.current_electricity_units));
  const result = await api(`/api/tenants/buildings/${Number(building.id)}/invoices/bulk`, {
    method: 'POST',
    body: { invoice_month: monthKey, due_date: dueDate, rows },
  });
  if (!result?.success) { toast(result?.error || 'Could not generate bulk invoices.', 'error'); return; }
  closeModal();
  toast(`Generated ${Number(result.invoices_saved || 0)} bills for ${tenantMonthLabel(monthKey)}.`, 'success', 5000);
  await loadTenantsPage();
}

function showTenantInvoiceEditModal(invoiceId) {
  const invoice = (_tenantOverview?.invoices || []).find((item) => String(item.id) === String(invoiceId));
  if (!invoice) { toast('Invoice not found.', 'error'); return; }
  const tenant = tenantFindRecord(invoice.tenant_id);
  if (!tenant) { toast('Tenant not found.', 'error'); return; }
  const roommateCount = Math.max(1, Number(invoice.roommate_count_snapshot || tenantBulkRoommateCount(tenant) || 1));
  openModal(`Edit Invoice - ${escHtml(tenantMonthLabel(invoice.invoice_month))}`, `
    <div class="card" style="padding:14px;margin-bottom:14px;background:#f7faf8">
      <div style="font-size:16px;font-weight:800;color:var(--t1)">${escHtml(tenant.tenant_name || 'Tenant')}</div>
      <div style="font-size:12px;color:var(--t3);margin-top:4px">${escHtml(invoice.room_label_snapshot || 'Room')} • Saved month ${escHtml(tenantMonthLabel(invoice.invoice_month))}</div>
    </div>
    <div class="fg">
      <label class="fl">Invoice Month<input class="fi" type="month" id="tenantInvoiceMonth" value="${escHtml(invoice.invoice_month || '')}" disabled></label>
      <label class="fl">Due Date<input class="fi" type="date" id="tenantInvoiceDueDate" value="${escHtml(String(invoice.due_date || '').slice(0, 10))}"></label>
      <label class="fl">Previous Units<input class="fi" type="number" id="tenantInvoicePrevUnits" value="${Number(invoice.previous_electricity_units || 0)}" disabled></label>
      <label class="fl">Current Units *<input class="fi" type="number" min="${Number(invoice.previous_electricity_units || 0)}" step="1" id="tenantInvoiceCurrentUnits" value="${Number(invoice.current_electricity_units || 0)}"></label>
      <label class="fl">Extra Units (+/-)<input class="fi" type="number" step="1" id="tenantInvoiceExtraUnits" value="${Number(invoice.extra_electricity_units || 0)}" placeholder="0"></label>
      <label class="fl">Payment Status
        <select class="fi" id="tenantInvoiceStatus" onchange="toggleTenantInvoicePaidAmount()">
          <option value="pending" ${invoice.payment_status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="paid" ${invoice.payment_status === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="partial_paid" ${invoice.payment_status === 'partial_paid' ? 'selected' : ''}>Partial Paid</option>
        </select>
      </label>
      <label class="fl" id="tenantInvoicePaidAmountWrap" style="${invoice.payment_status === 'partial_paid' ? '' : 'display:none'}">Paid Amount<input class="fi" type="number" min="0" step="0.01" id="tenantInvoicePaidAmount" value="${escHtml(String(invoice.paid_amount || 0))}"></label>
      <label class="fl full">Notes<textarea class="fi" id="tenantInvoiceNotes" rows="3" placeholder="Optional notes for this month">${escHtml(invoice.notes || '')}</textarea></label>
    </div>
    ${tenantSplitOptionsCard('tenantInvoice', roommateCount, invoice.split_config || tenantDefaultSplitConfig(roommateCount > 1))}
    <div class="card" style="padding:14px;margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div style="font-size:15px;font-weight:800;color:var(--t1)">Other Charges</div>
        <button class="btn btn-s btn-sm" onclick="addTenantInvoiceOtherChargeRow()">+ Add Charge</button>
      </div>
      <div id="tenantInvoiceOtherRows" style="margin-top:10px">${tenantInvoiceOtherChargeRows(invoice.other_charge_items || [])}</div>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveTenantInvoice(${Number(tenant.id)}, ${Number(invoice.id)})">Update Invoice</button>
      <button class="btn btn-s" onclick="closeModal()">Cancel</button>
    </div>`);
  toggleTenantInvoicePaidAmount();
}

async function saveTenantInvoice(recordId, invoiceId = null) {
  const existingInvoice = invoiceId ? (_tenantOverview?.invoices || []).find((item) => String(item.id) === String(invoiceId)) : null;
  const otherChargeItems = collectTenantModalRows('.tenant-invoice-other-row', (row) => {
    const detail = row.querySelector('.tenant-invoice-other-detail')?.value?.trim() || '';
    const amountValue = row.querySelector('.tenant-invoice-other-amount')?.value || '';
    const amount = amountValue === '' ? 0 : Number(amountValue);
    if (!detail && !amount) return null;
    return { detail, amount };
  });
  const body = {
    invoice_month: existingInvoice?.invoice_month || document.getElementById('tenantInvoiceMonth')?.value || '',
    due_date: document.getElementById('tenantInvoiceDueDate')?.value || '',
    current_electricity_units: Number(document.getElementById('tenantInvoiceCurrentUnits')?.value || 0),
    extra_electricity_units: Number(document.getElementById('tenantInvoiceExtraUnits')?.value || 0),
    payment_status: document.getElementById('tenantInvoiceStatus')?.value || 'pending',
    paid_amount: Number(document.getElementById('tenantInvoicePaidAmount')?.value || 0),
    split_config: tenantReadSplitConfig('tenantInvoice'),
    other_charge_items: otherChargeItems,
    notes: document.getElementById('tenantInvoiceNotes')?.value?.trim() || '',
  };
  if (!body.invoice_month || !Number.isFinite(body.current_electricity_units)) {
    toast('Invoice month and current units are required', 'warning');
    return;
  }
  if (!Number.isInteger(body.extra_electricity_units)) {
    toast('Extra units must be a whole number.', 'warning');
    return;
  }
  const result = await api(`/api/tenants/records/${Number(recordId)}/invoices`, { method: 'POST', body });
  if (!result?.success) { toast(result?.error || 'Could not save invoice.', 'error'); return; }
  closeModal();
  toast(invoiceId ? 'Invoice updated' : 'Invoice saved', 'success');
  await loadTenantsPage();
}

async function updateTenantInvoiceStatusInline(invoiceId, nextStatus) {
  const invoice = (_tenantOverview?.invoices || []).find((item) => String(item.id) === String(invoiceId));
  if (!invoice) { toast('Invoice not found.', 'error'); return; }
  if (String(nextStatus) === 'partial_paid') {
    showTenantPartialStatusModal(invoiceId);
    return;
  }
  const scrollTop = tenantCaptureViewportPosition();
  const paidAmount = String(nextStatus) === 'paid'
    ? Number(invoice.total_amount || 0)
    : 0;
  const result = await api(`/api/tenants/invoices/${Number(invoice.id)}/status`, {
    method: 'PATCH',
    body: {
      payment_status: nextStatus,
      paid_amount: paidAmount,
    },
  });
  if (!result?.success) { toast(result?.error || 'Could not update invoice status.', 'error'); return; }
  toast('Invoice status updated', 'success');
  await loadTenantsPage({ skipLoadingRender: true });
  tenantRestoreViewportPosition(scrollTop);
}

function showTenantPartialStatusModal(invoiceId) {
  const invoice = (_tenantOverview?.invoices || []).find((item) => String(item.id) === String(invoiceId));
  if (!invoice) { toast('Invoice not found.', 'error'); return; }
  const tenant = tenantFindRecord(invoice.tenant_id);
  const remaining = tenantNum((invoice.total_amount || 0) - (invoice.paid_amount || 0));
  openModal(`Partial Payment - ${escHtml(tenant?.tenant_name || invoice.tenant_name_snapshot || 'Tenant')}`, `
    <div style="display:grid;gap:14px">
      <div class="card" style="padding:14px;background:#f7faf8">
        <div style="font-size:15px;font-weight:800;color:var(--t1)">${escHtml(invoice.tenant_name_snapshot || tenant?.tenant_name || 'Tenant')}</div>
        <div style="font-size:12px;color:var(--t3);margin-top:4px">${escHtml(tenantMonthLabel(invoice.invoice_month))} - Total ${fmtCur(invoice.total_amount || 0)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <span class="tenant-partial-pill">Already Paid ${fmtCur(invoice.paid_amount || 0)}</span>
          <span class="tenant-partial-pill">Remaining ${fmtCur(remaining)}</span>
        </div>
      </div>
      <label class="fl full">Paid Amount
        <input class="fi" type="number" min="0" step="0.01" id="tenantPartialPaidAmount" value="${escHtml(String(invoice.paid_amount || ''))}" placeholder="Enter paid amount">
      </label>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="saveTenantPartialStatus(${Number(invoice.id)})">Save Partial Payment</button>
      <button class="btn btn-s" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveTenantPartialStatus(invoiceId) {
  const invoice = (_tenantOverview?.invoices || []).find((item) => String(item.id) === String(invoiceId));
  if (!invoice) { toast('Invoice not found.', 'error'); return; }
  const scrollTop = tenantCaptureViewportPosition();
  const paidAmount = Number(document.getElementById('tenantPartialPaidAmount')?.value || 0);
  const result = await api(`/api/tenants/invoices/${Number(invoice.id)}/status`, {
    method: 'PATCH',
    body: {
      payment_status: 'partial_paid',
      paid_amount: paidAmount,
    },
  });
  if (!result?.success) { toast(result?.error || 'Could not save partial payment.', 'error'); return; }
  closeModal();
  toast('Invoice status updated', 'success');
  await loadTenantsPage({ skipLoadingRender: true });
  tenantRestoreViewportPosition(scrollTop);
}

async function reviewTenantPaymentRequest(requestId, decision) {
  const action = String(decision || '').trim().toLowerCase();
  if (!['approved', 'rejected'].includes(action)) return;
  const confirmed = await confirmDialog(action === 'approved' ? 'Approve this tenant payment request?' : 'Reject this tenant payment request?');
  if (!confirmed) return;
  const result = await api(`/api/tenants/payment-requests/${Number(requestId)}/review`, {
    method: 'POST',
    body: { status: action },
  });
  if (!result?.success) {
    toast(result?.error || 'Could not review payment request.', 'error');
    return;
  }
  toast(action === 'approved' ? 'Tenant payment request approved' : 'Tenant payment request rejected', 'success');
  await loadTenantsPage();
}

function showTenantInvoiceViewModal(invoiceId) {
  const invoice = (_tenantOverview?.invoices || []).find((item) => String(item.id) === String(invoiceId));
  if (!invoice) { toast('Invoice not found.', 'error'); return; }
  const otherChargesHtml = (invoice.other_charge_items || []).length
    ? `<div style="display:grid;gap:6px">${invoice.other_charge_items.map((item) => `<div style="display:flex;justify-content:space-between;gap:12px"><span>${escHtml(item.detail || 'Other charge')}</span><strong>${fmtCur(item.amount || 0)}</strong></div>`).join('')}</div>`
    : fmtCur(invoice.other_charges_snapshot || 0);
  openModal(`Invoice - ${escHtml(tenantMonthLabel(invoice.invoice_month))}`, `
    <div style="display:grid;gap:12px">
      <div class="card" style="padding:16px;background:#f7faf8">
        <div style="font-size:20px;font-weight:900;color:var(--t1)">${escHtml(invoice.tenant_name_snapshot || 'Tenant')}</div>
        <div style="font-size:12px;color:var(--t3);margin-top:4px">${escHtml(invoice.building_name_snapshot || '')} • ${escHtml(invoice.room_label_snapshot || '')}</div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <table>
          <tbody>
            <tr><td>Invoice Month</td><td>${escHtml(tenantMonthLabel(invoice.invoice_month))}</td></tr>
            <tr><td>Rent</td><td>${fmtCur(invoice.rent_amount_snapshot || 0)}</td></tr>
            <tr><td>Electricity</td><td>${tenantElectricityUsageText(invoice, { currencyFormatter: fmtCur, includeRate: true, includeAmount: true })}</td></tr>
            <tr><td>Sewerage</td><td>${fmtCur(invoice.sewerage_charge_snapshot || 0)}</td></tr>
            <tr><td>Water</td><td>${fmtCur(invoice.water_charge_snapshot || 0)}</td></tr>
            <tr><td>Cleaning</td><td>${fmtCur(invoice.cleaning_charge_snapshot || 0)}</td></tr>
            <tr><td>Status</td><td>${escHtml(tenantInvoiceStatusLabel(invoice.payment_status))}${invoice.payment_status !== 'pending' ? ` · ${fmtCur(invoice.paid_amount || 0)}` : ''}</td></tr>
            <tr><td>Other Charges</td><td>${otherChargesHtml}</td></tr>
            <tr><td style="font-weight:900">Total</td><td style="font-weight:900">${fmtCur(invoice.total_amount || 0)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="downloadTenantInvoicePdf(${Number(invoice.id)})">Download PDF</button>
      <button class="btn btn-s" onclick="closeModal()">Close</button>
    </div>`);
}

async function showTenantInvoiceShareModal(invoiceId) {
  const invoice = (_tenantOverview?.invoices || []).find((item) => String(item.id) === String(invoiceId));
  if (!invoice) { toast('Invoice not found.', 'error'); return; }
  const response = await api(`/api/tenants/invoices/${Number(invoiceId)}/share-links`);
  if (!response?.success) { toast(response?.error || 'Could not load invoice share links.', 'error'); return; }
  const links = Array.isArray(response.links) ? response.links : [];
  const rows = links.length
    ? links.map((link) => {
        const url = `${location.origin}/ti/${link.token}`;
        const isExpired = link.expires_at && new Date(link.expires_at).getTime() < Date.now();
        return `
          <div style="border:1px solid var(--br);border-radius:12px;padding:12px;display:grid;gap:8px;${isExpired ? 'opacity:.55;' : ''}">
            <div style="font-size:12px;color:var(--em);word-break:break-all;line-height:1.5">${escHtml(url)}</div>
            <div style="font-size:11px;color:var(--t3)">${isExpired ? 'Expired' : (link.expires_at ? `Expires ${escHtml(tenantDateLabel(link.expires_at))}` : 'No expiry')} - ${Number(link.view_count || 0)} view${Number(link.view_count || 0) === 1 ? '' : 's'}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${!isExpired ? `<button class="btn btn-s btn-sm" onclick="copyTenantInvoiceShareLink('${escHtml(url)}')">Copy Link</button>` : ''}
              <button class="btn btn-s btn-sm" style="color:var(--red)" onclick="deleteTenantInvoiceShareLink(${Number(invoiceId)}, ${Number(link.id)})">Delete</button>
            </div>
          </div>`;
      }).join('')
    : '<div style="font-size:12px;color:var(--t3);padding:4px 0">No share links created yet.</div>';
  openModal(`Share Invoice - ${escHtml(tenantMonthLabel(invoice.invoice_month))}`, `
    <div style="display:grid;gap:14px">
      <div class="card" style="padding:14px;background:#f7faf8">
        <div style="font-size:15px;font-weight:800;color:var(--t1)">${escHtml(invoice.tenant_name_snapshot || 'Tenant')}</div>
        <div style="font-size:12px;color:var(--t3);margin-top:4px">${escHtml(invoice.building_name_snapshot || '')} - ${escHtml(invoice.room_label_snapshot || '')} - ${escHtml(tenantMonthLabel(invoice.invoice_month))}</div>
      </div>
      <div class="fg">
        <label class="fl full">Expiry Date<input class="fi" type="date" id="tenantInvoiceShareExpiry" value="${escHtml(tenantDefaultShareExpiryDate())}"></label>
      </div>
      <div class="fa" style="margin-top:-2px">
        <button class="btn btn-p" onclick="createTenantInvoiceShareLink(${Number(invoiceId)})">Create Share Link</button>
      </div>
      <div style="border-top:1px solid var(--br);padding-top:14px;display:grid;gap:10px">
        <div style="font-size:13px;font-weight:700;color:var(--t1)">Existing Links</div>
        <div style="display:grid;gap:10px">${rows}</div>
      </div>
    </div>`);
}

function tenantMonthInvoiceShareLinksHtml(links = []) {
  if (!links.length) {
    return '<div style="font-size:12px;color:var(--t3);padding:4px 0">No month share links created yet.</div>';
  }
  return links.map((link) => {
    const url = `${location.origin}/tim/${link.token}`;
    const isExpired = link.expires_at && new Date(link.expires_at).getTime() < Date.now();
    return `
      <div style="border:1px solid var(--br);border-radius:12px;padding:12px;display:grid;gap:8px;${isExpired ? 'opacity:.55;' : ''}">
        <div style="font-size:12px;color:var(--em);word-break:break-all;line-height:1.5">${escHtml(url)}</div>
        <div style="font-size:11px;color:var(--t3)">${isExpired ? 'Expired' : `Expires ${escHtml(tenantDateLabel(link.expires_at))}`} - ${Number(link.view_count || 0)} view${Number(link.view_count || 0) === 1 ? '' : 's'}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${!isExpired ? `<button class="btn btn-s btn-sm" onclick="copyTenantInvoiceShareLink('${escHtml(url)}')">Copy Link</button>` : ''}
          <button class="btn btn-s btn-sm" style="color:var(--red)" onclick="deleteTenantInvoiceMonthShareLink(${Number(link.building_id)}, ${Number(link.id)})">Delete</button>
        </div>
      </div>`;
  }).join('');
}

async function showTenantMonthInvoiceExportModal(buildingId = _selectedTenantBuildingId) {
  const building = tenantFindBuilding(buildingId);
  if (!building) { toast('Building not found.', 'error'); return; }
  const allMonths = [...new Set(getTenantBuildingInvoices(building).map((invoice) => tenantInvoiceSortKey(invoice.invoice_month)).filter(Boolean))].sort();
  const defaultMonth = document.getElementById('tenantMonthInvoiceExportMonth')?.value
    || _tenantInvoiceFilters.month_to
    || _tenantInvoiceFilters.month_from
    || allMonths[allMonths.length - 1]
    || tenantCurrentMonthKey();
  const selectedMonth = tenantInvoiceSortKey(defaultMonth) || tenantCurrentMonthKey();
  const monthInvoices = getTenantMonthInvoices(building, selectedMonth);
  const response = await api(`/api/tenants/buildings/${Number(building.id)}/invoice-month-share-links?month=${encodeURIComponent(selectedMonth)}`);
  if (!response?.success) { toast(response?.error || 'Could not load month share links.', 'error'); return; }
  const totalAmount = tenantNum(monthInvoices.reduce((sum, invoice) => sum + tenantNum(invoice.total_amount || 0), 0));
  openModal(`Month PDF / Share - ${escHtml(building.name || 'Building')}`, `
    <div style="display:grid;gap:14px">
      <div class="card" style="padding:14px;background:#f7faf8">
        <div style="font-size:15px;font-weight:800;color:var(--t1)">${escHtml(building.name || 'Building')}</div>
        <div style="font-size:12px;color:var(--t3);margin-top:4px">${monthInvoices.length} invoice${monthInvoices.length === 1 ? '' : 's'} found for ${escHtml(tenantMonthLabel(selectedMonth))}</div>
      </div>
      <div class="fg">
        <label class="fl">Month
          <input class="fi" type="month" id="tenantMonthInvoiceExportMonth" value="${escHtml(selectedMonth)}" onchange="showTenantMonthInvoiceExportModal(${Number(building.id)})">
        </label>
        <label class="fl">Expiry Date
          <input class="fi" type="date" id="tenantMonthInvoiceShareExpiry" value="${escHtml(tenantDefaultShareExpiryDate())}">
        </label>
      </div>
      <div class="card" style="padding:14px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:12px;color:var(--t3)">Selected Month</div>
            <div style="font-size:16px;font-weight:800;color:var(--t1);margin-top:4px">${escHtml(tenantMonthLabel(selectedMonth))}</div>
          </div>
          <div>
            <div style="font-size:12px;color:var(--t3)">Total Amount</div>
            <div style="font-size:16px;font-weight:800;color:var(--t1);margin-top:4px">${fmtCur(totalAmount)}</div>
          </div>
          <div>
            <div style="font-size:12px;color:var(--t3)">Invoices</div>
            <div style="font-size:16px;font-weight:800;color:var(--t1);margin-top:4px">${monthInvoices.length}</div>
          </div>
        </div>
      </div>
      <div class="fa" style="margin-top:-2px">
        <button class="btn btn-p" onclick="downloadTenantMonthInvoicesPdf(${Number(building.id)}, document.getElementById('tenantMonthInvoiceExportMonth')?.value || '${escHtml(selectedMonth)}')">Generate PDF</button>
        <button class="btn btn-s" onclick="createTenantInvoiceMonthShareLink(${Number(building.id)})">Create Share Link</button>
      </div>
      <div style="border-top:1px solid var(--br);padding-top:14px;display:grid;gap:10px">
        <div style="font-size:13px;font-weight:700;color:var(--t1)">Existing Links</div>
        <div style="display:grid;gap:10px">${tenantMonthInvoiceShareLinksHtml(Array.isArray(response.links) ? response.links : [])}</div>
      </div>
    </div>`);
}

async function createTenantInvoiceShareLink(invoiceId) {
  const expires_at = document.getElementById('tenantInvoiceShareExpiry')?.value || null;
  const response = await api(`/api/tenants/invoices/${Number(invoiceId)}/share-links`, {
    method: 'POST',
    body: { expires_at },
  });
  if (!response?.success || !response?.link?.token) {
    toast(response?.error || 'Could not create invoice share link.', 'error');
    return;
  }
  toast('Invoice share link created', 'success');
  const url = `${location.origin}/ti/${response.link.token}`;
  try { await navigator.clipboard.writeText(url); toast('Link copied', 'success'); } catch (_err) {}
  await showTenantInvoiceShareModal(invoiceId);
}

async function createTenantInvoiceMonthShareLink(buildingId) {
  const invoice_month = document.getElementById('tenantMonthInvoiceExportMonth')?.value || '';
  const expires_at = document.getElementById('tenantMonthInvoiceShareExpiry')?.value || null;
  const response = await api(`/api/tenants/buildings/${Number(buildingId)}/invoice-month-share-links`, {
    method: 'POST',
    body: { invoice_month, expires_at },
  });
  if (!response?.success || !response?.link?.token) {
    toast(response?.error || 'Could not create month share link.', 'error');
    return;
  }
  toast('Month share link created', 'success');
  const url = `${location.origin}/tim/${response.link.token}`;
  try { await navigator.clipboard.writeText(url); toast('Link copied', 'success'); } catch (_err) {}
  await showTenantMonthInvoiceExportModal(buildingId);
}

async function deleteTenantInvoiceShareLink(invoiceId, linkId) {
  if (!await confirmDialog('Delete this invoice share link?')) return;
  const response = await api(`/api/tenants/invoice-share-links/${Number(linkId)}`, { method: 'DELETE' });
  if (!response?.success) {
    toast(response?.error || 'Could not delete invoice share link.', 'error');
    return;
  }
  toast('Invoice share link deleted', 'success');
  await showTenantInvoiceShareModal(invoiceId);
}

async function deleteTenantInvoiceMonthShareLink(buildingId, linkId) {
  if (!await confirmDialog('Delete this month share link?')) return;
  const response = await api(`/api/tenants/invoice-month-share-links/${Number(linkId)}`, { method: 'DELETE' });
  if (!response?.success) {
    toast(response?.error || 'Could not delete month share link.', 'error');
    return;
  }
  toast('Month share link deleted', 'success');
  await showTenantMonthInvoiceExportModal(buildingId);
}

async function copyTenantInvoiceShareLink(url) {
  try {
    await navigator.clipboard.writeText(String(url || ''));
    toast('Link copied', 'success');
  } catch (_err) {
    toast('Could not copy link.', 'error');
  }
}

async function deleteTenantInvoice(invoiceId) {
  if (!await confirmDialog('Delete this invoice?')) return;
  const result = await api(`/api/tenants/invoices/${Number(invoiceId)}`, { method: 'DELETE' });
  if (!result?.success) { toast(result?.error || 'Could not delete invoice.', 'error'); return; }
  toast('Invoice deleted', 'success');
  await loadTenantsPage();
}

function toggleTenantInvoicePaidAmount() {
  const status = document.getElementById('tenantInvoiceStatus')?.value || 'pending';
  const wrap = document.getElementById('tenantInvoicePaidAmountWrap');
  if (wrap) wrap.style.display = status === 'partial_paid' ? '' : 'none';
}

window.setTenantPageTab = setTenantPageTab;
window.setTenantSelectedBuilding = setTenantSelectedBuilding;
window.openTenantBuilding = openTenantBuilding;
window.setTenantInvoiceFilter = setTenantInvoiceFilter;
window.setTenantInvoicePage = setTenantInvoicePage;
window.resetTenantInvoiceFilters = resetTenantInvoiceFilters;
window.setTenantReportFilter = setTenantReportFilter;
window.setTenantReportPage = setTenantReportPage;
window.resetTenantReportFilters = resetTenantReportFilters;
window.setTenantEditorTab = setTenantEditorTab;
window.showTenantRecordDetailsModal = showTenantRecordDetailsModal;
window.addTenantVehicleRow = addTenantVehicleRow;
window.addTenantItemRow = addTenantItemRow;
window.addTenantRecurringChargeRow = addTenantRecurringChargeRow;
window.addTenantNextInvoiceChargeRow = addTenantNextInvoiceChargeRow;
window.removeTenantRecurringChargeRow = removeTenantRecurringChargeRow;
window.removeTenantNextInvoiceChargeRow = removeTenantNextInvoiceChargeRow;
window.removeTenantVehicleRow = removeTenantVehicleRow;
window.removeTenantItemRow = removeTenantItemRow;
window.addTenantInvoiceOtherChargeRow = addTenantInvoiceOtherChargeRow;
window.toggleTenantInvoicePaidAmount = toggleTenantInvoicePaidAmount;
window.changeTenantInvoiceModalTenant = changeTenantInvoiceModalTenant;
window.downloadTenantInvoicePdf = downloadTenantInvoicePdf;
window.downloadTenantMonthInvoicesPdf = downloadTenantMonthInvoicesPdf;
window.downloadTenantReportPdf = downloadTenantReportPdf;
window.showTenantPartialStatusModal = showTenantPartialStatusModal;
window.reviewTenantPaymentRequest = reviewTenantPaymentRequest;
window.saveTenantPartialStatus = saveTenantPartialStatus;
window.showTenantBulkInvoiceModal = showTenantBulkInvoiceModal;
window.refreshTenantBulkInvoiceModal = refreshTenantBulkInvoiceModal;
window.saveTenantBulkInvoices = saveTenantBulkInvoices;
window.addTenantBulkOtherChargeRow = addTenantBulkOtherChargeRow;
window.removeTenantBulkOtherChargeRow = removeTenantBulkOtherChargeRow;
window.updateTenantBulkInvoiceRow = updateTenantBulkInvoiceRow;
window.updateTenantInvoiceStatusInline = updateTenantInvoiceStatusInline;
window.showTenantInvoiceShareModal = showTenantInvoiceShareModal;
window.showTenantMonthInvoiceExportModal = showTenantMonthInvoiceExportModal;
window.createTenantInvoiceShareLink = createTenantInvoiceShareLink;
window.createTenantInvoiceMonthShareLink = createTenantInvoiceMonthShareLink;
window.deleteTenantInvoiceShareLink = deleteTenantInvoiceShareLink;
window.deleteTenantInvoiceMonthShareLink = deleteTenantInvoiceMonthShareLink;
window.copyTenantInvoiceShareLink = copyTenantInvoiceShareLink;
