(function () {
  const app = document.getElementById('tenantPortalApp');
  const modalRoot = document.getElementById('tenantPortalModalRoot');
  const msg91Config = window.__TENANT_PORTAL_MSG91__ || {};
  let msg91SdkPromise = null;
  let msg91Action = '';
  let resendCooldownTimer = null;
  const state = {
    view: 'loading',
    phone: new URLSearchParams(window.location.search).get('phone') ? String(new URLSearchParams(window.location.search).get('phone') || '').replace(/\D+/g, '').slice(-10) : '',
    maskedMobile: '',
    otp: ['', '', '', '', '', ''],
    dashboard: null,
    sendingOtp: false,
    verifyingOtp: false,
    resendCooldownUntil: 0,
    notice: '',
    noticeType: '',
    invoiceFilter: 'all',
    detailTab: 'overview',
    portalSection: 'details',
  };

  const moneyFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const moneyFmtExact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });
  const longMonthFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
  const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  function msg91WidgetEnabled() {
    return false;
  }

  function resendCooldownSeconds() {
    const remainingMs = Number(state.resendCooldownUntil || 0) - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  function updateResendButtonUi() {
    const resendBtn = document.getElementById('tenantPortalResendBtn');
    if (!resendBtn) return;
    const resendSeconds = resendCooldownSeconds();
    const resendLocked = state.sendingOtp || resendSeconds > 0;
    resendBtn.disabled = resendLocked;
    resendBtn.textContent = state.sendingOtp
      ? 'Sending...'
      : resendSeconds > 0
        ? `Resend in ${resendSeconds}s`
        : 'Resend OTP';
  }

  function startResendCooldown(seconds = 10) {
    state.resendCooldownUntil = Date.now() + (Number(seconds) * 1000);
    if (resendCooldownTimer) clearInterval(resendCooldownTimer);
    resendCooldownTimer = setInterval(() => {
      if (resendCooldownSeconds() > 0) return updateResendButtonUi();
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
      state.resendCooldownUntil = 0;
      updateResendButtonUi();
    }, 250);
  }

  function normalizePhoneDigits(value) {
    return String(value || '').replace(/\D+/g, '').slice(-10);
  }

  function fullIndianPhone(value) {
    const digits = normalizePhoneDigits(value);
    return digits.length === 10 ? `91${digits}` : '';
  }

  function maskTenantPhone(value) {
    const digits = normalizePhoneDigits(value);
    if (!digits) return '';
    return `+91 ${digits.slice(0, 2)}xxxxxx${digits.slice(-2)}`;
  }

  function extractMsg91AccessToken(payload) {
    return String(
      payload?.['access-token']
      || payload?.accessToken
      || payload?.token
      || payload?.jwt
      || payload?.data?.['access-token']
      || payload?.data?.accessToken
      || payload?.data?.token
      || ''
    ).trim();
  }

  function loadMsg91WidgetSdk() {
    if (typeof window.initSendOTP === 'function') return Promise.resolve();
    if (msg91SdkPromise) return msg91SdkPromise;
    msg91SdkPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-msg91-otp="1"]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error('Could not load MSG91 OTP widget.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://verify.msg91.com/otp-provider.js';
      script.async = true;
      script.dataset.msg91Otp = '1';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load MSG91 OTP widget.'));
      document.head.appendChild(script);
    });
    return msg91SdkPromise;
  }

  async function initMsg91Widget(extra = {}) {
    await loadMsg91WidgetSdk();
    if (typeof window.initSendOTP !== 'function') {
      throw new Error('MSG91 OTP widget is unavailable right now.');
    }
    window.initSendOTP({
      widgetId: msg91Config.widgetId,
      tokenAuth: msg91Config.tokenAuth,
      exposeMethods: true,
      success: onMsg91WidgetSuccess,
      failure: onMsg91WidgetFailure,
      ...extra,
    });
  }

  async function sendOtpViaBackend(phone) {
      const result = await publicApi('/api/public/tenant-portal/send-otp', {
        method: 'POST',
        body: { phone },
      });
      state.maskedMobile = result.masked_mobile || '';
      state.otp = ['', '', '', '', '', ''];
      state.view = 'otp';
      startResendCooldown(10);
      state.notice = 'OTP sent successfully.';
      state.noticeType = 'success';
      render();
  }

  async function resendOtpViaBackend(phone) {
      const result = await publicApi('/api/public/tenant-portal/resend-otp', {
        method: 'POST',
        body: { phone },
      });
      state.maskedMobile = result.masked_mobile || state.maskedMobile;
      state.notice = 'OTP resent successfully.';
      state.noticeType = 'success';
      state.otp = ['', '', '', '', '', ''];
      state.sendingOtp = false;
      startResendCooldown(10);
      render();
  }

  async function onMsg91WidgetSuccess(data) {
    try {
      if (msg91Action === 'send' || msg91Action === 'resend') {
        state.maskedMobile = maskTenantPhone(state.phone);
        state.view = 'otp';
        state.otp = ['', '', '', '', '', ''];
        state.sendingOtp = false;
        showNotice(msg91Action === 'resend' ? 'OTP sent again.' : 'OTP sent successfully.', 'success');
        return;
      }
      if (msg91Action === 'verify') {
        const accessToken = extractMsg91AccessToken(data);
        if (!accessToken) throw new Error('Could not verify OTP right now.');
        const result = await publicApi('/api/public/tenant-portal/widget-login', {
          method: 'POST',
          body: {
            access_token: accessToken,
            phone: state.phone,
          },
        });
        state.dashboard = result.dashboard || null;
        state.view = result.authenticated ? 'dashboard' : 'login';
        state.verifyingOtp = false;
        state.notice = '';
        state.noticeType = '';
        render();
      }
    } catch (err) {
      state.sendingOtp = false;
      state.verifyingOtp = false;
      showNotice(err.message || 'Could not complete tenant login.', 'error');
    }
  }

  function onMsg91WidgetFailure(error) {
    state.sendingOtp = false;
    state.verifyingOtp = false;
    showNotice(String(error?.message || error?.error || 'OTP request failed.'), 'error');
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[m]));
  }

  function toNumber(value) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
  }

  function fmtMoney(value, exact = false) {
    return (exact ? moneyFmtExact : moneyFmt).format(toNumber(value));
  }

  function fmtDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return dateFmt.format(parsed);
  }

  function fmtMonth(value, long = false) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}$/.test(raw)) return raw || '-';
    const [year, month] = raw.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return (long ? longMonthFmt : monthFmt).format(date);
  }

  function monthBadgeLabel(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}$/.test(raw)) return ['--', '--'];
    const [year, month] = raw.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return [
      date.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase(),
      String(date.getFullYear()),
    ];
  }

  function tenantPortalPdfHelper() {
    return window.jspdf?.jsPDF ? window.jspdf : (window.jspdf?.default ? window.jspdf : null);
  }

  function invoiceStatusMeta(invoice) {
    const status = String(invoice?.visual_status || 'pending').toLowerCase();
    if (status === 'paid') return { label: 'Paid', cls: 'paid', box: 'paid' };
    if (status === 'rejected') return { label: 'Rejected', cls: 'rejected', box: 'rejected' };
    if (status === 'approval_pending') return { label: 'Pending approval', cls: 'pending', box: 'pending' };
    if (status === 'overdue') return { label: 'Overdue', cls: 'overdue', box: 'overdue' };
    return { label: 'Pending', cls: 'pending', box: 'pending' };
  }

  function electricityUsageText(invoice, { includeRate = false } = {}) {
    const previousUnits = toNumber(invoice?.previous_electricity_units);
    const currentUnits = toNumber(invoice?.current_electricity_units);
    const usedUnits = toNumber(invoice?.electricity_units_used);
    if (previousUnits === 0 && currentUnits === 0) {
      return includeRate
        ? `${usedUnits} units @ ${pdfMoney(invoice?.electricity_unit_price_snapshot || 0)}/unit`
        : `${usedUnits} units`;
    }
    return includeRate
      ? `${currentUnits} - ${previousUnits} = ${usedUnits} units @ ${pdfMoney(invoice?.electricity_unit_price_snapshot || 0)}/unit`
      : `${currentUnits} - ${previousUnits} = ${usedUnits} units`;
  }

  function invoiceBreakdown(invoice) {
    const rows = [];
    const usedUnits = toNumber(invoice.electricity_units_used);
    rows.push(['Rent', fmtMoney(invoice.rent_amount_snapshot, true)]);
    if (usedUnits || toNumber(invoice.electricity_amount)) {
      rows.push([
        `Electricity (${electricityUsageText(invoice, { includeRate: true })})`,
        fmtMoney(invoice.electricity_amount, true),
      ]);
    }
    if (toNumber(invoice.sewerage_charge_snapshot)) rows.push(['Sewerage', fmtMoney(invoice.sewerage_charge_snapshot, true)]);
    if (toNumber(invoice.water_charge_snapshot)) rows.push(['Water', fmtMoney(invoice.water_charge_snapshot, true)]);
    if (toNumber(invoice.cleaning_charge_snapshot)) rows.push(['Cleaning', fmtMoney(invoice.cleaning_charge_snapshot, true)]);
    const extraItems = Array.isArray(invoice.other_charge_items) ? invoice.other_charge_items : [];
    extraItems.forEach((item) => {
      rows.push([String(item.detail || 'Other charge'), fmtMoney(item.amount, true)]);
    });
    if (!extraItems.length && toNumber(invoice.other_charges_snapshot)) {
      rows.push(['Other charges', fmtMoney(invoice.other_charges_snapshot, true)]);
    }
    rows.push(['Total', fmtMoney(invoice.total_amount, true), true]);
    return rows;
  }

  function pdfMoney(value) {
    const amount = toNumber(value);
    try {
      return `Rs. ${amount.toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    } catch (_err) {
      return `Rs. ${amount.toFixed(2)}`;
    }
  }

  function downloadTenantPortalInvoicePdf(invoice) {
    const helper = tenantPortalPdfHelper();
    if (!helper?.jsPDF) {
      showNotice('PDF library is not available right now.', 'error');
      return;
    }
    const doc = new helper.jsPDF({ unit: 'mm', format: 'a4' });
    const dashboard = state.dashboard || {};
    const tenant = dashboard.tenant || {};
    const meta = invoiceStatusMeta(invoice);
    const title = `${fmtMonth(invoice.invoice_month, true)} Invoice`;
    const roomText = `${tenant.room_label || '-'}${tenant.floor_label ? ` - ${tenant.floor_label}` : ''}`;
    const body = invoiceBreakdown(invoice).map(([label, _value, isTotal]) => [label, isTotal ? pdfMoney(invoice.total_amount) : pdfMoney(
      label === 'Rent' ? invoice.rent_amount_snapshot
        : label === 'Sewerage' ? invoice.sewerage_charge_snapshot
        : label === 'Water' ? invoice.water_charge_snapshot
        : label === 'Cleaning' ? invoice.cleaning_charge_snapshot
        : label === 'Other charges' ? invoice.other_charges_snapshot
        : (() => {
            const extraItems = Array.isArray(invoice.other_charge_items) ? invoice.other_charge_items : [];
            const match = extraItems.find((item) => String(item.detail || 'Other charge') === String(label));
            if (match) return match.amount;
            if (label.startsWith('Electricity')) return invoice.electricity_amount;
            return 0;
          })()
    )]);

    doc.setFillColor(33, 95, 58);
    doc.roundedRect(12, 12, 186, 24, 4, 4, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(19);
    doc.text(title, 18, 24);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text('Tenant Portal Invoice', 18, 31);

    doc.setDrawColor(221, 228, 221);
    doc.setFillColor(248, 251, 247);
    doc.roundedRect(12, 42, 116, 34, 3, 3, 'FD');
    doc.roundedRect(134, 42, 64, 34, 3, 3, 'FD');

    doc.setTextColor(46, 58, 46);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('Tenant Details', 18, 50);
    doc.text('Invoice Summary', 140, 50);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Tenant: ${tenant.tenant_name || '-'}`, 18, 58);
    doc.text(`Room: ${roomText}`, 18, 64);
    doc.text(`Building: ${tenant.building_name || '-'}`, 18, 70);

    doc.text(`Status: ${meta.label}`, 140, 58);
    doc.text(`Due Date: ${fmtDate(invoice.due_date)}`, 140, 64);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total: ${pdfMoney(invoice.total_amount)}`, 140, 70);

    doc.autoTable({
      startY: 84,
      head: [['Charge', 'Amount']],
      body,
      theme: 'grid',
      styles: {
        fontSize: 10,
        cellPadding: 4,
        lineColor: [220, 226, 220],
        textColor: [42, 42, 42],
      },
      alternateRowStyles: { fillColor: [250, 252, 250] },
      headStyles: {
        fillColor: [46, 96, 63],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 124 },
        1: { halign: 'right', cellWidth: 52 },
      },
    });
    const note = String(invoice?.notes || '').trim();
    if (note) {
      const y = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 130;
      doc.setFillColor(252, 247, 235);
      doc.roundedRect(12, y - 5, 186, 24, 3, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.text('Notes', 16, y);
      doc.setFont('helvetica', 'normal');
      doc.text(doc.splitTextToSize(note, 174), 16, y + 8);
    }
    doc.save(`${title.replace(/\s+/g, '_')}.pdf`);
  }

  function showNotice(message = '', type = '') {
    state.notice = String(message || '');
    state.noticeType = String(type || '');
    render();
  }

  async function publicApi(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      credentials: 'same-origin',
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'Request failed');
    }
    return data;
  }

  function renderNoticeHtml() {
    if (!state.notice) return '';
    const cls = state.noticeType === 'error'
      ? 'tenant-portal-alert tenant-portal-alert-error'
      : 'tenant-portal-alert tenant-portal-alert-success';
    return `<div class="${cls}">${esc(state.notice)}</div>`;
  }

  function renderAuthShell(innerHtml) {
    app.innerHTML = `
      <div class="tenant-portal-auth">
        <div class="tenant-portal-auth-glow"></div>
        <div class="tenant-portal-auth-inner">
          <div class="tenant-portal-brand">
            <div class="tenant-portal-brand-mark">T</div>
            <div class="tenant-portal-brand-text">Tenant<span>Portal</span></div>
          </div>
          <div class="tenant-portal-card">
            ${innerHtml}
            ${renderNoticeHtml()}
          </div>
        </div>
      </div>`;
  }

  function renderLogin() {
    renderAuthShell(`
      <h1 class="tenant-portal-title">Welcome back</h1>
      <div class="tenant-portal-sub">Enter your registered phone number to access your tenant dashboard and invoices.</div>
      <div class="tenant-portal-field">
        <div class="tenant-portal-phone">
          <div class="tenant-portal-phone-prefix">+91</div>
          <div class="tenant-portal-phone-sep"></div>
          <input id="tenantPortalPhoneInput" inputmode="numeric" maxlength="10" placeholder="Enter your mobile number" value="${esc(state.phone)}">
        </div>
      </div>
      <button class="tenant-portal-primary-btn" id="tenantPortalSendOtpBtn" ${state.sendingOtp ? 'disabled' : ''}>${state.sendingOtp ? 'Sending OTP...' : 'Send OTP'}</button>
      <div class="tenant-portal-note">Secured by Expenselyt. Your data is private and encrypted.<br>For issues contact your building manager.</div>
    `);
    const input = document.getElementById('tenantPortalPhoneInput');
    if (input) {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D+/g, '').slice(0, 10);
        state.phone = input.value;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') sendOtp();
      });
      setTimeout(() => input.focus(), 20);
    }
    const btn = document.getElementById('tenantPortalSendOtpBtn');
    if (btn) btn.addEventListener('click', sendOtp);
  }

  function otpValue() {
    return state.otp.join('').replace(/\D+/g, '').slice(0, 6);
  }

  function renderOtp() {
    const activeOtpInputId = document.activeElement?.id || '';
    const resendSeconds = resendCooldownSeconds();
    const resendLocked = state.sendingOtp || resendSeconds > 0;
    renderAuthShell(`
      <h1 class="tenant-portal-title">Welcome back</h1>
      <div class="tenant-portal-sub">Enter your registered phone number to access your tenant dashboard and invoices.</div>
      <div class="tenant-portal-field">
        <div class="tenant-portal-phone">
          <div class="tenant-portal-phone-prefix">+91</div>
          <div class="tenant-portal-phone-sep"></div>
          <input value="${esc(state.phone)}" disabled>
        </div>
      </div>
      <div class="tenant-portal-otp-line">OTP sent to ${esc(state.maskedMobile || `+91 ${state.phone}`)}</div>
      <div class="tenant-portal-otp-grid">
        ${state.otp.map((digit, index) => `<input class="tenant-portal-otp-input" id="tenantPortalOtp${index}" inputmode="numeric" ${index === 0 ? 'autocomplete="one-time-code"' : ''} maxlength="6" value="${esc(digit)}">`).join('')}
      </div>
      <div class="tenant-portal-resend">Did not receive it? <button class="tenant-portal-link-btn" id="tenantPortalResendBtn" ${resendLocked ? 'disabled' : ''}>${state.sendingOtp ? 'Sending...' : resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend OTP'}</button></div>
      <button class="tenant-portal-primary-btn" id="tenantPortalVerifyBtn" ${state.verifyingOtp ? 'disabled' : ''}>${state.verifyingOtp ? 'Verifying OTP...' : 'Verify OTP'}</button>
      <div class="tenant-portal-note">Secured by Expenselyt. Your data is private and encrypted.<br>For issues contact your building manager.</div>
    `);

    state.otp.forEach((_digit, index) => {
      const input = document.getElementById(`tenantPortalOtp${index}`);
      if (!input) return;
      input.addEventListener('input', () => {
        const normalized = input.value.replace(/\D+/g, '');
        if (normalized.length > 1) {
          const digits = normalized.slice(0, 6).split('');
          for (let i = 0; i < 6; i += 1) {
            state.otp[i] = digits[i] || '';
            const box = document.getElementById(`tenantPortalOtp${i}`);
            if (box) box.value = state.otp[i];
          }
          document.getElementById(`tenantPortalOtp${Math.min(digits.length, 5)}`)?.focus();
          return;
        }
        const clean = normalized.slice(-1);
        input.value = clean;
        state.otp[index] = clean;
        if (clean && index < 5) {
          const nextInput = document.getElementById(`tenantPortalOtp${index + 1}`);
          for (let i = index + 1; i < 6; i += 1) {
            state.otp[i] = '';
            const box = document.getElementById(`tenantPortalOtp${i}`);
            if (box) box.value = '';
          }
          nextInput?.focus();
        }
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && index > 0) {
          const prev = document.getElementById(`tenantPortalOtp${index - 1}`);
          prev?.focus();
          if (prev) prev.value = '';
          state.otp[index - 1] = '';
        }
        if (event.key === 'Enter') verifyOtp();
      });
      input.addEventListener('paste', (event) => {
        event.preventDefault();
        const pasted = String(event.clipboardData?.getData('text') || '').replace(/\D+/g, '').slice(0, 6).split('');
        if (!pasted.length) return;
        for (let i = 0; i < 6; i += 1) {
          state.otp[i] = pasted[i] || '';
          const box = document.getElementById(`tenantPortalOtp${i}`);
          if (box) box.value = state.otp[i];
        }
        const nextIndex = Math.min(pasted.length, 5);
        document.getElementById(`tenantPortalOtp${nextIndex}`)?.focus();
      });
    });

    const resendBtn = document.getElementById('tenantPortalResendBtn');
    resendBtn?.addEventListener('click', resendOtp);
    updateResendButtonUi();
    document.getElementById('tenantPortalVerifyBtn')?.addEventListener('click', verifyOtp);
    const focusTargetId = /^tenantPortalOtp\d$/.test(activeOtpInputId)
      ? activeOtpInputId
      : (!state.otp.some(Boolean) ? 'tenantPortalOtp0' : '');
    if (focusTargetId) {
      setTimeout(() => document.getElementById(focusTargetId)?.focus(), 20);
    }
  }

  function detailCell(label, value, extraClass = '') {
    return `
      <div class="tenant-portal-detail-cell">
        <div class="tenant-portal-detail-label">${esc(label)}</div>
        <div class="tenant-portal-detail-value ${extraClass}">${value}</div>
      </div>`;
  }

  function renderDetailTabs(dashboard = {}) {
    const profile = dashboard.charge_profile || {};
    const vehicles = Array.isArray(dashboard.vehicles) ? dashboard.vehicles : [];
    const items = Array.isArray(dashboard.provided_items) ? dashboard.provided_items : [];
    const monthlyCharges = Array.isArray(profile.monthly_additional_charges) ? profile.monthly_additional_charges : [];
    const tabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'monthly', label: `Monthly Expenses (${monthlyCharges.length})` },
      { id: 'vehicles', label: `Vehicles (${vehicles.length})` },
      { id: 'items', label: `Things (${items.length})` },
    ];
    return `
      <div class="tenant-portal-detail-tabs">
        ${tabs.map((tab) => `<button class="tenant-portal-detail-tab ${state.detailTab === tab.id ? 'active' : ''}" type="button" data-detail-tab="${tab.id}">${esc(tab.label)}</button>`).join('')}
      </div>`;
  }

  function renderEmptyPanel(message) {
    return `<div class="tenant-portal-detail-empty">${esc(message)}</div>`;
  }

  function renderMonthlyChargesPanel(profile = {}) {
    const monthlyCharges = Array.isArray(profile.monthly_additional_charges) ? profile.monthly_additional_charges : [];
    if (!monthlyCharges.length) return renderEmptyPanel('No other monthly expenses configured for this tenant.');
    return `
      <div class="tenant-portal-detail-panel">
        <div class="tenant-portal-detail-list">
          ${monthlyCharges.map((item) => `
            <div class="tenant-portal-detail-list-row">
              <div class="tenant-portal-detail-list-main">
                <div class="tenant-portal-detail-list-title">${esc(item.detail || 'Monthly charge')}</div>
                <div class="tenant-portal-detail-list-sub">Added to the monthly rent snapshot</div>
              </div>
              <div class="tenant-portal-detail-list-value">${fmtMoney(item.amount)}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function renderVehiclesPanel(vehicles = []) {
    if (!vehicles.length) return renderEmptyPanel('No vehicle details are registered for this tenant.');
    return `
      <div class="tenant-portal-detail-panel">
        <div class="tenant-portal-detail-list">
          ${vehicles.map((vehicle) => `
            <div class="tenant-portal-detail-list-row">
              <div class="tenant-portal-detail-list-main">
                <div class="tenant-portal-detail-list-title">${esc(vehicle.vehicle_number || 'Vehicle')}</div>
                <div class="tenant-portal-detail-list-sub">${esc(vehicle.vehicle_type || 'Vehicle')}</div>
              </div>
              <div class="tenant-portal-detail-list-notes">${esc(vehicle.notes || '-')}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function renderItemsPanel(items = []) {
    if (!items.length) return renderEmptyPanel('No tenant items are recorded for this tenant.');
    return `
      <div class="tenant-portal-detail-panel">
        <div class="tenant-portal-detail-list">
          ${items.map((item) => `
            <div class="tenant-portal-detail-list-row">
              <div class="tenant-portal-detail-list-main">
                <div class="tenant-portal-detail-list-title">${esc(item.item_name || 'Item')}</div>
                <div class="tenant-portal-detail-list-sub">${esc(item.notes || 'Tenant-provided item')}</div>
              </div>
              <div class="tenant-portal-detail-list-value">Qty ${esc(String(toNumber(item.quantity || 0)))}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function renderDetailPanel(dashboard = {}) {
    const tenant = dashboard.tenant || {};
    const profile = dashboard.charge_profile || {};
    const vehicles = Array.isArray(dashboard.vehicles) ? dashboard.vehicles : [];
    const items = Array.isArray(dashboard.provided_items) ? dashboard.provided_items : [];
    if (state.detailTab === 'monthly') return renderMonthlyChargesPanel(profile);
    if (state.detailTab === 'vehicles') return renderVehiclesPanel(vehicles);
    if (state.detailTab === 'items') return renderItemsPanel(items);
    return `
      <div class="tenant-portal-detail-grid">
        ${detailCell('Name', esc(tenant.tenant_name || '-'))}
        ${detailCell('Contact', esc(tenant.contact_number || '-'), 'green')}
        ${detailCell('Room', esc(`${tenant.room_label || '-'}${tenant.floor_label ? ` - ${tenant.floor_label}` : ''}`))}
        ${detailCell('Started', esc(fmtDate(tenant.start_date)))}
        ${detailCell('Opening Units', esc(String(toNumber(profile.opening_electricity_units || 0))))}
        ${detailCell('Address on Record', esc(tenant.tenant_address || 'Not provided'), 'muted')}
        ${detailCell('Water Charge', fmtMoney(profile.water_charge || 0))}
        ${detailCell('Sewerage Charge', fmtMoney(profile.sewerage_charge || 0))}
      </div>`;
  }

  function invoiceCardHtml(invoice) {
    const meta = invoiceStatusMeta(invoice);
    const rawStatus = String(invoice?.visual_status || 'pending').toLowerCase();
    const [mon, year] = monthBadgeLabel(invoice.invoice_month);
    const unitMath = electricityUsageText(invoice);
    const usedUnits = toNumber(invoice?.electricity_units_used);
    const readingText = (toNumber(invoice?.current_electricity_units) || toNumber(invoice?.previous_electricity_units))
      ? `${toNumber(invoice?.current_electricity_units)} - ${toNumber(invoice?.previous_electricity_units)}`
      : '';
    const dueOrPaid = meta.cls === 'paid'
      ? `Paid ${fmtDate(invoice.latest_payment_request?.reviewed_at || invoice.updated_at)} - ${unitMath}`
      : rawStatus === 'approval_pending'
        ? `Awaiting admin approval - ${unitMath}`
        : meta.cls === 'rejected'
          ? `Payment request rejected - ${unitMath}`
        : `Due ${fmtDate(invoice.due_date)} - ${unitMath}`;
    const primaryAction = invoice.can_mark_paid
      ? `<button class="tenant-portal-mini-btn primary" data-mark-paid="${Number(invoice.id)}">Mark Paid</button>`
      : rawStatus === 'approval_pending'
        ? `<button class="tenant-portal-mini-btn warn" disabled>Awaiting approval</button>`
        : '';
    return `
      <div class="tenant-portal-invoice-card ${meta.cls}">
        <div class="tenant-portal-month-box ${meta.box}">
          <div>${esc(mon)}</div>
          <div>${esc(year)}</div>
        </div>
        <div class="tenant-portal-invoice-body">
          <div class="tenant-portal-invoice-title">${esc(fmtMonth(invoice.invoice_month, true))}</div>
          <div class="tenant-portal-invoice-sub">${esc(meta.label)}</div>
          <div class="tenant-portal-invoice-meta">
            ${usedUnits ? `<span class="tenant-portal-invoice-chip">${esc(`${usedUnits} units`)}</span>` : ''}
            ${readingText ? `<span class="tenant-portal-invoice-chip">${esc(readingText)}</span>` : ''}
          </div>
        </div>
        <div class="tenant-portal-invoice-status-wrap">
          <div class="tenant-portal-invoice-money">${fmtMoney(invoice.total_amount)}</div>
          <div class="tenant-portal-invoice-note">${esc(
            rawStatus === 'approval_pending'
              ? 'Awaiting admin'
              : meta.cls === 'paid'
                ? `Paid ${fmtDate(invoice.latest_payment_request?.reviewed_at || invoice.updated_at)}`
                : `Due ${fmtDate(invoice.due_date)}`
          )}</div>
        </div>
        <div class="tenant-portal-invoice-actions">
          <button class="tenant-portal-mini-btn" data-view-invoice="${Number(invoice.id)}">View</button>
          ${primaryAction}
        </div>
      </div>`;
  }

  function managerWhatsappHref(manager) {
    const digits = String(manager?.mobile || '').replace(/\D+/g, '');
    if (!digits) return '';
    const msg = encodeURIComponent('Hello, I need help regarding my tenant invoice and portal access.');
    return `https://wa.me/${digits.startsWith('91') ? digits : `91${digits}`}?text=${msg}`;
  }

  function filteredInvoices() {
    const invoices = Array.isArray(state.dashboard?.invoices) ? state.dashboard.invoices : [];
    if (state.invoiceFilter === 'all') return invoices;
    return invoices.filter((invoice) => String(invoice.visual_status || '').toLowerCase() === state.invoiceFilter);
  }

  function renderDashboard() {
    const dashboard = state.dashboard || {};
    const tenant = dashboard.tenant || {};
    const summary = dashboard.summary || {};
    const profile = dashboard.charge_profile || {};
    const manager = dashboard.manager || {};
    const invoices = filteredInvoices();
    const latestMonth = summary.latest_invoice_month ? fmtMonth(summary.latest_invoice_month, true) : 'No invoice yet';
    const lastInvoiceValue = summary.latest_invoice_month ? latestMonth : '-';
    const balanceDue = toNumber(summary.balance_due || 0);
    const outstandingStatus = balanceDue > 0 ? 'danger' : '';
    const helpHref = managerWhatsappHref(manager);
    const sectionTabsHtml = `
      <div class="tenant-portal-section-tabs">
        <button class="tenant-portal-section-tab ${state.portalSection === 'details' ? 'active' : ''}" type="button" data-portal-section="details">My Details</button>
        <button class="tenant-portal-section-tab ${state.portalSection === 'invoices' ? 'active' : ''}" type="button" data-portal-section="invoices">My Invoices</button>
      </div>`;
    const detailsSectionHtml = `
      <section>
        <div class="tenant-portal-section-head">
          <div>
            <div class="tenant-portal-section-title">My Details</div>
            <div class="tenant-portal-section-sub">Your registered information</div>
          </div>
        </div>
        <div class="tenant-portal-surface">
          <div class="tenant-portal-detail-pills">
            <div class="tenant-portal-detail-pill green">${fmtMoney(profile.rent_amount || summary.monthly_rent)} / month</div>
            <div class="tenant-portal-detail-pill blue">${fmtMoney(profile.electricity_unit_price || 0, true)} / unit</div>
            <div class="tenant-portal-detail-pill amber">${fmtMoney(profile.cleaning_charge || 0)} cleaning</div>
            <div class="tenant-portal-detail-pill">${fmtMoney(tenant.security_deposit || 0)} deposit</div>
          </div>
          ${renderDetailTabs(dashboard)}
          ${renderDetailPanel(dashboard)}
        </div>
      </section>`;
    const invoicesSectionHtml = `
      <section class="tenant-portal-invoice-section">
        <div class="tenant-portal-section-head">
          <div>
            <div class="tenant-portal-section-title">My Invoices</div>
            <div class="tenant-portal-section-sub">Monthly rent snapshots</div>
          </div>
          <div class="tenant-portal-filter-row">
            <button class="tenant-portal-filter-btn ${state.invoiceFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
            <button class="tenant-portal-filter-btn ${state.invoiceFilter === 'overdue' ? 'active' : ''}" data-filter="overdue">Overdue</button>
            <button class="tenant-portal-filter-btn ${state.invoiceFilter === 'approval_pending' ? 'active' : ''}" data-filter="approval_pending">Pending approval</button>
            <button class="tenant-portal-filter-btn ${state.invoiceFilter === 'paid' ? 'active' : ''}" data-filter="paid">Paid</button>
          </div>
        </div>
        <div class="tenant-portal-surface tenant-portal-invoices">
          ${invoices.length ? invoices.map(invoiceCardHtml).join('') : `<div class="tenant-portal-empty-state">No invoices available for this view.</div>`}
        </div>
      </section>`;
    app.innerHTML = `
      <div class="tenant-portal-dashboard">
        <div class="tenant-portal-hero">
          <div class="tenant-portal-hero-inner">
            <div class="tenant-portal-topbar">
              <div class="tenant-portal-wordmark">Tenant<span>Portal</span> - ${esc(tenant.building_name || 'Property')}</div>
              <button class="tenant-portal-ghost-btn" id="tenantPortalLogoutBtn">Logout</button>
            </div>
            <div class="tenant-portal-greeting">Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'},</div>
            <div class="tenant-portal-name">${esc(tenant.tenant_name || 'Tenant')}</div>
            <div class="tenant-portal-room-badge">${esc(`${tenant.room_label || 'Room'}${tenant.floor_label ? ` - ${tenant.floor_label}` : ''}${tenant.building_name ? ` - ${tenant.building_name}` : ''}`)}</div>
            <div class="tenant-portal-summary-grid">
              <div class="tenant-portal-summary-card">
                <div class="tenant-portal-summary-label">Monthly Rent</div>
                <div class="tenant-portal-summary-value">${fmtMoney(summary.monthly_rent)}</div>
              </div>
              <div class="tenant-portal-summary-card">
                <div class="tenant-portal-summary-label">Last Invoice</div>
                <div class="tenant-portal-summary-value warn">${esc(lastInvoiceValue)}</div>
              </div>
              <div class="tenant-portal-summary-card">
                <div class="tenant-portal-summary-label">Balance Due</div>
                <div class="tenant-portal-summary-value ${outstandingStatus}">${fmtMoney(balanceDue)}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="tenant-portal-main">
          <div class="tenant-portal-main-inner">
            ${sectionTabsHtml}
            ${state.portalSection === 'details' ? detailsSectionHtml : invoicesSectionHtml}
          </div>
        </div>
      </div>`;

    document.getElementById('tenantPortalLogoutBtn')?.addEventListener('click', logoutTenantPortal);
    [...app.querySelectorAll('[data-view-invoice]')].forEach((button) => {
      button.addEventListener('click', () => {
        const invoice = (dashboard.invoices || []).find((item) => Number(item.id) === Number(button.getAttribute('data-view-invoice')));
        if (invoice) openInvoiceModal(invoice);
      });
    });
    [...app.querySelectorAll('[data-mark-paid]')].forEach((button) => {
      button.addEventListener('click', () => markInvoicePaid(Number(button.getAttribute('data-mark-paid'))));
    });
    [...app.querySelectorAll('[data-filter]')].forEach((button) => {
      button.addEventListener('click', () => {
        state.invoiceFilter = button.getAttribute('data-filter') || 'all';
        state.portalSection = 'invoices';
        renderDashboard();
      });
    });
    [...app.querySelectorAll('[data-detail-tab]')].forEach((button) => {
      button.addEventListener('click', () => {
        state.detailTab = button.getAttribute('data-detail-tab') || 'overview';
        state.portalSection = 'details';
        renderDashboard();
      });
    });
    [...app.querySelectorAll('[data-portal-section]')].forEach((button) => {
      button.addEventListener('click', () => {
        state.portalSection = button.getAttribute('data-portal-section') || 'details';
        renderDashboard();
      });
    });
  }

  function openInvoiceModal(invoice) {
    const meta = invoiceStatusMeta(invoice);
    const breakdownHtml = invoiceBreakdown(invoice).map(([label, value, total]) => `
      <div class="tenant-portal-breakdown-row ${total ? 'total' : ''}">
        <span>${esc(label)}</span>
        <strong>${value}</strong>
      </div>`).join('');
    const canMarkPaid = !!invoice.can_mark_paid;
    modalRoot.innerHTML = `
      <div class="tenant-portal-modal-backdrop" id="tenantPortalModalBackdrop">
        <div class="tenant-portal-modal">
          <div class="tenant-portal-modal-head">
            <div>
              <div class="tenant-portal-modal-title">${esc(fmtMonth(invoice.invoice_month, true))} Invoice</div>
              <div class="tenant-portal-invoice-sub">${esc(fmtDate(invoice.due_date))} - ${esc(meta.label)}</div>
            </div>
            <button class="tenant-portal-modal-close" id="tenantPortalCloseModalBtn">&times;</button>
          </div>
          <div class="tenant-portal-modal-body">
            <div class="tenant-portal-breakdown">${breakdownHtml}</div>
            <div class="tenant-portal-modal-note">
              Contact ${esc((state.dashboard?.manager?.name || 'your building manager'))} if anything looks incorrect. ${invoice.pending_payment_request?.status === 'pending' ? 'A payment confirmation request is already waiting for approval.' : ''}
            </div>
            <div class="tenant-portal-modal-actions">
              <button class="tenant-portal-mini-btn" id="tenantPortalDownloadPdfBtn">Download PDF</button>
              ${canMarkPaid ? `<button class="tenant-portal-mini-btn primary" id="tenantPortalMarkPaidBtn">Mark as Paid</button>` : ''}
            </div>
          </div>
        </div>
      </div>`;
    document.getElementById('tenantPortalCloseModalBtn')?.addEventListener('click', closeModal);
    document.getElementById('tenantPortalDownloadPdfBtn')?.addEventListener('click', () => downloadTenantPortalInvoicePdf(invoice));
    document.getElementById('tenantPortalMarkPaidBtn')?.addEventListener('click', async () => {
      closeModal();
      openMarkPaidModal(invoice.id);
    });
  }

  function openMarkPaidModal(invoiceId) {
    const invoice = (state.dashboard?.invoices || []).find((item) => Number(item.id) === Number(invoiceId));
    if (!invoice) return;
    modalRoot.innerHTML = `
      <div class="tenant-portal-modal-backdrop" id="tenantPortalModalBackdrop">
        <div class="tenant-portal-modal" style="max-width:560px">
          <div class="tenant-portal-modal-head">
            <div>
              <div class="tenant-portal-modal-title">Mark Invoice Paid</div>
              <div class="tenant-portal-invoice-sub">${esc(fmtMonth(invoice.invoice_month, true))} · ${esc(fmtMoney(invoice.total_amount, true))}</div>
            </div>
            <button class="tenant-portal-modal-close" id="tenantPortalCloseModalBtn">&times;</button>
          </div>
          <div class="tenant-portal-modal-body">
            <div class="tenant-portal-breakdown-row total">
              <span>Requested amount</span>
              <strong>${fmtMoney(invoice.total_amount, true)}</strong>
            </div>
            <div class="tenant-portal-modal-note">
              Add an optional note for the admin, like a transaction reference, payment app, or bank details.
            </div>
            <label style="display:block;margin-top:14px">
              <div style="font-size:13px;font-weight:700;color:#2b352e;margin-bottom:8px">Payment note</div>
              <textarea class="tenant-portal-textarea" id="tenantPortalPaymentNoteInput" placeholder="Optional note for the admin"></textarea>
            </label>
            <div class="tenant-portal-modal-actions">
              <button class="tenant-portal-mini-btn" id="tenantPortalCancelPaymentBtn">Cancel</button>
              <button class="tenant-portal-mini-btn primary" id="tenantPortalSubmitPaymentBtn">Send Request</button>
            </div>
          </div>
        </div>
      </div>`;
    document.getElementById('tenantPortalCloseModalBtn')?.addEventListener('click', closeModal);
    document.getElementById('tenantPortalCancelPaymentBtn')?.addEventListener('click', closeModal);
    document.getElementById('tenantPortalSubmitPaymentBtn')?.addEventListener('click', async () => {
      const note = String(document.getElementById('tenantPortalPaymentNoteInput')?.value || '').trim();
      await submitMarkInvoicePaid(invoice.id, note);
    });
  }

  function closeModal() {
    modalRoot.innerHTML = '';
  }

  async function sendOtp() {
    const phone = normalizePhoneDigits(state.phone || '');
    if (phone.length !== 10) {
      showNotice('Enter a valid 10-digit Indian mobile number.', 'error');
      return;
    }
    state.sendingOtp = true;
    state.notice = '';
    render();
    try {
      state.phone = phone;
      if (msg91WidgetEnabled()) {
        try {
          msg91Action = 'send';
          state.maskedMobile = maskTenantPhone(phone);
          state.otp = ['', '', '', '', '', ''];
          state.view = 'otp';
          state.notice = 'Requesting OTP...';
          state.noticeType = 'success';
          render();
          await initMsg91Widget({ identifier: fullIndianPhone(phone) });
          if (typeof window.sendOtp !== 'function') {
            throw new Error('OTP send is not available right now.');
          }
          await window.sendOtp(fullIndianPhone(phone));
          state.notice = 'OTP request sent. Please enter the code you receive.';
          state.noticeType = 'success';
          state.sendingOtp = false;
          render();
          return;
        } catch (_widgetErr) {
          msg91Action = '';
          await sendOtpViaBackend(phone);
          return;
        }
      }
      await sendOtpViaBackend(phone);
    } catch (err) {
      state.notice = err.message || 'Could not send OTP.';
      state.noticeType = 'error';
      render();
    } finally {
      state.sendingOtp = false;
      if (state.view === 'login') render();
    }
  }

  async function resendOtp() {
    const phone = normalizePhoneDigits(state.phone || '');
    if (phone.length !== 10) {
      showNotice('Enter a valid 10-digit Indian mobile number.', 'error');
      return;
    }
    state.sendingOtp = true;
    state.notice = '';
    render();
    try {
      if (msg91WidgetEnabled()) {
        try {
          msg91Action = 'resend';
          state.maskedMobile = maskTenantPhone(phone);
          state.otp = ['', '', '', '', '', ''];
          state.view = 'otp';
          state.notice = 'Requesting OTP again...';
          state.noticeType = 'success';
          render();
          await initMsg91Widget({ identifier: fullIndianPhone(phone) });
          if (typeof window.retryOtp !== 'function') {
            throw new Error('OTP resend is not available right now.');
          }
          await window.retryOtp();
          state.notice = 'OTP request sent again. Please enter the latest code.';
          state.noticeType = 'success';
          state.sendingOtp = false;
          render();
          return;
        } catch (_widgetErr) {
          msg91Action = '';
          await resendOtpViaBackend(phone);
          return;
        }
      }
      await resendOtpViaBackend(phone);
    } catch (err) {
      state.notice = err.message || 'Could not resend OTP.';
      state.noticeType = 'error';
      render();
    } finally {
      state.sendingOtp = false;
    }
  }

  async function verifyOtp() {
    const otp = otpValue();
    if (otp.length !== 6) {
      showNotice('Enter the 6-digit OTP.', 'error');
      return;
    }
    state.verifyingOtp = true;
    state.notice = '';
    render();
    try {
      if (msg91WidgetEnabled()) {
        msg91Action = 'verify';
        await initMsg91Widget({
          identifier: fullIndianPhone(state.phone),
          otp,
        });
        if (typeof window.verifyOtp !== 'function') {
          throw new Error('OTP verification is not available right now.');
        }
        await window.verifyOtp(otp);
        return;
      }
      const result = await publicApi('/api/public/tenant-portal/verify-otp', {
        method: 'POST',
        body: { otp },
      });
      state.dashboard = result.dashboard || null;
      state.view = 'dashboard';
      state.notice = '';
      state.noticeType = '';
      render();
    } catch (err) {
      state.notice = err.message || 'Could not verify OTP.';
      state.noticeType = 'error';
      render();
    } finally {
      state.verifyingOtp = false;
      if (state.view === 'otp') render();
    }
  }

  async function logoutTenantPortal() {
    try { await publicApi('/api/public/tenant-portal/logout', { method: 'POST' }); } catch (_err) {}
    state.view = 'login';
    state.dashboard = null;
    state.otp = ['', '', '', '', '', ''];
    state.notice = '';
    state.noticeType = '';
    closeModal();
    render();
  }

  function markInvoicePaid(invoiceId) {
    openMarkPaidModal(invoiceId);
  }

  async function submitMarkInvoicePaid(invoiceId, note = '') {
    const invoice = (state.dashboard?.invoices || []).find((item) => Number(item.id) === Number(invoiceId));
    if (!invoice) return;
    try {
      const result = await publicApi(`/api/public/tenant-portal/invoices/${Number(invoiceId)}/mark-paid`, {
        method: 'POST',
        body: {
          requested_amount: invoice.total_amount || 0,
          tenant_note: note,
        },
      });
      state.dashboard = result.dashboard || state.dashboard;
      state.notice = 'Payment request sent to admin for approval.';
      state.noticeType = 'success';
      closeModal();
      render();
    } catch (err) {
      state.notice = err.message || 'Could not submit payment request.';
      state.noticeType = 'error';
      render();
    }
  }

  async function bootstrap() {
    try {
      const session = await publicApi('/api/public/tenant-portal/session');
      if (session?.authenticated && session.dashboard) {
        state.view = 'dashboard';
        state.dashboard = session.dashboard;
      } else {
        state.view = 'login';
      }
      render();
    } catch (_err) {
      state.view = 'login';
      render();
    }
  }

  function render() {
    closeModal();
    if (state.view === 'loading') {
      app.innerHTML = '<div class="tenant-portal-loading">Loading tenant portal...</div>';
      return;
    }
    if (state.view === 'otp') {
      renderOtp();
      return;
    }
    if (state.view === 'dashboard') {
      renderDashboard();
      return;
    }
    renderLogin();
  }

  bootstrap();
})();
