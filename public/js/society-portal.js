(function () {
  const app = document.getElementById('societyPortalApp');
  let resendCooldownTimer = null;
  const state = {
    view: 'loading',
    phone: new URLSearchParams(window.location.search).get('phone') ? String(new URLSearchParams(window.location.search).get('phone') || '').replace(/\D+/g, '').slice(-10) : '',
    maskedMobile: '',
    otp: ['', '', '', '', '', ''],
    sendingOtp: false,
    verifyingOtp: false,
    resendCooldownUntil: 0,
    dashboard: null,
    selectedRequestMonth: '',
    requestAmount: '',
    requestPaidOn: '',
    requestNote: '',
    submittingRequest: false,
    dashboardTab: 'history',
    notice: '',
    noticeType: '',
    requestModalOpen: false,
  };

  const moneyFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const moneyFmtExact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });
  const longMonthFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
  const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function toNumber(value) {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num : 0;
  }

  function fmtMoney(value, exact) {
    return (exact ? moneyFmtExact : moneyFmt).format(toNumber(value));
  }

  function fmtMonth(value, long) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}$/.test(raw)) return raw || '-';
    const [year, month] = raw.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return (long ? longMonthFmt : monthFmt).format(date);
  }

  function fmtDate(value) {
    if (!value) return '-';
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim()) ? new Date(`${value}T00:00:00`) : new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value || '');
    return dateFmt.format(parsed);
  }

  function normalizePhoneDigits(value) {
    return String(value || '').replace(/\D+/g, '').slice(-10);
  }

  function maskPhone(value) {
    const digits = normalizePhoneDigits(value);
    return digits ? `+91 ${digits.slice(0, 2)}xxxxxx${digits.slice(-2)}` : '';
  }

  function currentMonthKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  function showNotice(message, type) {
    state.notice = String(message || '').trim();
    state.noticeType = type || '';
    render();
  }

  async function publicApi(url, options) {
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || 'Request failed');
    return data;
  }

  function resendCooldownSeconds() {
    const remainingMs = Number(state.resendCooldownUntil || 0) - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  function updateResendButtonUi() {
    const resendBtn = document.getElementById('spResendBtn');
    if (!resendBtn) return;
    const seconds = resendCooldownSeconds();
    resendBtn.disabled = state.sendingOtp || seconds > 0;
    resendBtn.textContent = state.sendingOtp ? 'Sending...' : (seconds > 0 ? `Resend in ${seconds}s` : 'Resend OTP');
  }

  function startResendCooldown(seconds) {
    state.resendCooldownUntil = Date.now() + (Number(seconds || 10) * 1000);
    if (resendCooldownTimer) clearInterval(resendCooldownTimer);
    resendCooldownTimer = setInterval(() => {
      if (resendCooldownSeconds() > 0) {
        updateResendButtonUi();
        return;
      }
      clearInterval(resendCooldownTimer);
      resendCooldownTimer = null;
      state.resendCooldownUntil = 0;
      updateResendButtonUi();
    }, 250);
  }

  function requestStatusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'approved' || normalized === 'paid') return 'approved';
    if (normalized === 'rejected') return 'rejected';
    return 'pending';
  }

  function requestStatusLabel(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'approved' || normalized === 'paid') return 'Approved';
    if (normalized === 'rejected') return 'Rejected';
    if (normalized === 'approval_pending') return 'Pending Approval';
    return 'Pending Approval';
  }

  function expenseCategoryClass(category) {
    const value = String(category || '').toLowerCase();
    if (value.includes('salary')) return 'salary';
    if (value.includes('maint')) return 'maintenance';
    if (value.includes('util') || value.includes('water') || value.includes('electric')) return 'utilities';
    if (value.includes('security')) return 'security';
    return 'other';
  }

  function setDashboardTab(tab) {
    const nextTab = String(tab || '').trim().toLowerCase();
    if (!['history', 'expenses', 'collections'].includes(nextTab)) return;
    state.dashboardTab = nextTab;
    render();
  }

  function openRequestModal(monthKey) {
    state.selectedRequestMonth = String(monthKey || '').trim();
    state.requestAmount = '';
    state.requestPaidOn = '';
    state.requestNote = '';
    syncRequestForm(state.dashboard);
    state.requestModalOpen = true;
    render();
  }

  function closeRequestModal() {
    state.requestModalOpen = false;
    render();
  }

  function contributionStatus(item) {
    const status = String(item?.status || '').toLowerCase();
    if (status === 'paid') return { cls: 'paid', label: 'Paid', badge: 'paid' };
    if (status === 'rejected') return { cls: 'rejected', label: 'Rejected', badge: 'rejected' };
    if (status === 'approval_pending') return { cls: 'pending', label: 'Pending approval', badge: 'pending' };
    return { cls: 'pending', label: 'Pending', badge: 'pending' };
  }

  function monthBadgeLines(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return ['--', '--'];
    const [year, month] = String(monthKey).split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return [
      date.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase(),
      String(date.getFullYear()),
    ];
  }

  function getRequestPresetMonth(dashboard) {
    const pendingRequest = (dashboard?.pending_requests || [])[0];
    if (pendingRequest?.month_key) return pendingRequest.month_key;
    const unpaid = (dashboard?.contribution_history || []).find((item) => String(item.status || '').toLowerCase() !== 'paid');
    return unpaid?.month_key || dashboard?.summary?.current_month || currentMonthKey();
  }

  function syncRequestForm(dashboard) {
    const targetMonth = state.selectedRequestMonth || getRequestPresetMonth(dashboard);
    const contributionItem = (dashboard?.contribution_history || []).find((item) => item.month_key === targetMonth) || null;
    state.selectedRequestMonth = targetMonth;
    if (!state.requestAmount) {
      state.requestAmount = String(contributionItem?.due_amount || dashboard?.member?.monthly_due || '');
    }
    if (!state.requestPaidOn) state.requestPaidOn = new Date().toISOString().slice(0, 10);
  }

  async function sendOtp() {
    const phone = normalizePhoneDigits(state.phone);
    if (phone.length !== 10) {
      showNotice('Enter a valid 10-digit mobile number.', 'error');
      return;
    }
    state.sendingOtp = true;
    render();
    try {
      const result = await publicApi('/api/public/society-portal/send-otp', {
        method: 'POST',
        body: { phone },
      });
      state.phone = phone;
      state.maskedMobile = result.masked_mobile || maskPhone(phone);
      state.otp = ['', '', '', '', '', ''];
      state.view = 'otp';
      state.sendingOtp = false;
      startResendCooldown(10);
      showNotice('OTP sent successfully.', 'success');
    } catch (err) {
      state.sendingOtp = false;
      showNotice(err.message || 'Could not send OTP.', 'error');
    }
  }

  async function resendOtp() {
    if (state.sendingOtp || resendCooldownSeconds() > 0) return;
    state.sendingOtp = true;
    updateResendButtonUi();
    try {
      const result = await publicApi('/api/public/society-portal/resend-otp', {
        method: 'POST',
        body: { phone: state.phone },
      });
      state.maskedMobile = result.masked_mobile || state.maskedMobile;
      state.otp = ['', '', '', '', '', ''];
      startResendCooldown(10);
      state.sendingOtp = false;
      render();
      showNotice('OTP resent successfully.', 'success');
    } catch (err) {
      state.sendingOtp = false;
      updateResendButtonUi();
      showNotice(err.message || 'Could not resend OTP.', 'error');
    }
  }

  async function verifyOtp() {
    const otp = state.otp.join('');
    if (otp.length !== 6) {
      showNotice('Enter the 6-digit OTP.', 'error');
      return;
    }
    state.verifyingOtp = true;
    render();
    try {
      const result = await publicApi('/api/public/society-portal/verify-otp', {
        method: 'POST',
        body: { otp },
      });
      state.dashboard = result.dashboard || null;
      state.view = result.authenticated ? 'dashboard' : 'login';
      state.verifyingOtp = false;
      state.notice = '';
      state.noticeType = '';
      state.requestAmount = '';
      state.requestPaidOn = '';
      state.requestNote = '';
      state.selectedRequestMonth = '';
      if (state.dashboard) syncRequestForm(state.dashboard);
      render();
    } catch (err) {
      state.verifyingOtp = false;
      render();
      showNotice(err.message || 'Could not verify OTP.', 'error');
    }
  }

  async function submitPaymentRequest() {
    if (state.submittingRequest) return;
    const monthKey = String(state.selectedRequestMonth || '').trim();
    const amount = Number(state.requestAmount || 0);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      showNotice('Select a valid month.', 'error');
      return;
    }
    if (!(amount > 0)) {
      showNotice('Enter a valid amount.', 'error');
      return;
    }
    state.submittingRequest = true;
    render();
    try {
      const result = await publicApi('/api/public/society-portal/payment-requests', {
        method: 'POST',
        body: {
          month_key: monthKey,
          requested_amount: amount,
          requested_paid_on: state.requestPaidOn || '',
          member_note: state.requestNote || '',
        },
      });
      state.dashboard = result.dashboard || state.dashboard;
      state.submittingRequest = false;
      state.requestNote = '';
      state.requestAmount = '';
      state.requestModalOpen = false;
      if (state.dashboard) syncRequestForm(state.dashboard);
      render();
      showNotice('Payment request sent to the admin for approval.', 'success');
    } catch (err) {
      state.submittingRequest = false;
      render();
      showNotice(err.message || 'Could not send payment request.', 'error');
    }
  }

  async function logout() {
    try {
      await publicApi('/api/public/society-portal/logout', { method: 'POST' });
    } catch (_err) {}
    state.view = 'login';
    state.dashboard = null;
    state.otp = ['', '', '', '', '', ''];
    state.notice = '';
    state.noticeType = '';
    render();
  }

  function applyOtpDigits(rawValue = '') {
    const digits = String(rawValue || '').replace(/\D+/g, '').slice(0, 6);
    if (!digits) return false;
    state.otp = digits.split('').concat(Array(Math.max(0, 6 - digits.length)).fill('')).slice(0, 6);
    render();
    focusOtpInput(Math.min(digits.length, 5));
    return true;
  }

  function handleOtpInput(index, rawValue) {
    const normalized = String(rawValue || '').replace(/\D+/g, '');
    if (normalized.length > 1) {
      applyOtpDigits(normalized);
      return;
    }
    const nextValue = normalized.slice(-1);
    if (!nextValue) {
      state.otp[index] = '';
      render();
      focusOtpInput(index);
      return;
    }
    state.otp[index] = nextValue;
    for (let i = index + 1; i < state.otp.length; i += 1) state.otp[i] = '';
    render();
    focusOtpInput(Math.min(index + 1, state.otp.length - 1));
  }

  function handleOtpKeydown(event, index) {
    const key = event.key;
    if (key === 'Backspace') {
      if (state.otp[index]) {
        state.otp[index] = '';
        for (let i = index + 1; i < state.otp.length; i += 1) state.otp[i] = '';
        render();
        focusOtpInput(index);
        event.preventDefault();
        return;
      }
      if (index > 0) {
        state.otp[index - 1] = '';
        for (let i = index; i < state.otp.length; i += 1) state.otp[i] = '';
        render();
        focusOtpInput(index - 1);
        event.preventDefault();
      }
    }
  }

  function handleOtpPaste(event) {
    const pasted = String(event.clipboardData?.getData('text') || '').replace(/\D+/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    applyOtpDigits(pasted);
  }

  function focusOtpInput(index) {
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-otp-index="${Number(index)}"]`);
      if (input) input.focus();
    });
  }

  function bindEvents() {
    const phoneInput = document.getElementById('spPhoneInput');
    if (phoneInput) {
      phoneInput.addEventListener('input', (event) => {
        state.phone = normalizePhoneDigits(event.target.value);
      });
      phoneInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          sendOtp();
        }
      });
    }

    const loginBtn = document.getElementById('spLoginBtn');
    if (loginBtn) loginBtn.addEventListener('click', () => (state.view === 'otp' ? verifyOtp() : sendOtp()));

    document.querySelectorAll('[data-otp-index]').forEach((input) => {
      const index = Number(input.getAttribute('data-otp-index'));
      input.addEventListener('input', (event) => handleOtpInput(index, event.target.value));
      input.addEventListener('keydown', (event) => handleOtpKeydown(event, index));
      input.addEventListener('paste', handleOtpPaste);
      input.addEventListener('focus', () => input.select());
    });

    const resendBtn = document.getElementById('spResendBtn');
    if (resendBtn) resendBtn.addEventListener('click', resendOtp);

    const logoutBtn = document.getElementById('spLogoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    const requestMonth = document.getElementById('spRequestMonth');
    if (requestMonth) {
      requestMonth.addEventListener('change', (event) => {
        state.selectedRequestMonth = String(event.target.value || '');
        state.requestAmount = '';
        syncRequestForm(state.dashboard);
        render();
      });
    }

    const requestAmount = document.getElementById('spRequestAmount');
    if (requestAmount) {
      requestAmount.addEventListener('input', (event) => {
        state.requestAmount = event.target.value;
      });
    }

    const requestPaidOn = document.getElementById('spRequestPaidOn');
    if (requestPaidOn) {
      requestPaidOn.addEventListener('input', (event) => {
        state.requestPaidOn = event.target.value;
      });
    }

    const requestNote = document.getElementById('spRequestNote');
    if (requestNote) {
      requestNote.addEventListener('input', (event) => {
        state.requestNote = event.target.value;
      });
    }

    const requestBtn = document.getElementById('spSubmitRequestBtn');
    if (requestBtn) requestBtn.addEventListener('click', submitPaymentRequest);

    const requestCloseBtn = document.getElementById('spRequestModalClose');
    if (requestCloseBtn) requestCloseBtn.addEventListener('click', closeRequestModal);

    const requestCancelBtn = document.getElementById('spRequestModalCancel');
    if (requestCancelBtn) requestCancelBtn.addEventListener('click', closeRequestModal);

    document.querySelectorAll('[data-sp-request-month]').forEach((btn) => {
      btn.addEventListener('click', () => openRequestModal(btn.getAttribute('data-sp-request-month')));
    });

    document.querySelectorAll('[data-sp-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setDashboardTab(btn.getAttribute('data-sp-tab')));
    });

    updateResendButtonUi();
  }

  function renderNotice() {
    if (!state.notice) return '';
    return `<div class="sp-notice ${esc(state.noticeType || 'success')}">${esc(state.notice)}</div>`;
  }

  function renderLogin() {
    const otpVisible = state.view === 'otp';
    return `
      <div class="sp-login">
        <div class="sp-login-card">
          <div class="sp-wordmark">
            <div class="sp-wordmark-icon">S</div>
            <div>
              <div class="sp-wordmark-title">Society<span>Portal</span></div>
              <div class="sp-wordmark-sub">Member access</div>
            </div>
          </div>
          <div class="sp-login-box">
            <div class="sp-login-title">Member Login</div>
            <div class="sp-login-sub">Enter your registered mobile number to access your society dashboard.</div>
            <div class="sp-phone-wrap">
              <div class="sp-phone-prefix">+91 <span>|</span></div>
              <input id="spPhoneInput" class="sp-phone-input" type="tel" maxlength="10" value="${esc(state.phone)}" placeholder="Your registered mobile number" ${otpVisible ? 'readonly' : ''}>
            </div>
            ${otpVisible ? `
              <div class="sp-otp-block">
                <div class="sp-otp-hint">OTP sent to ${esc(state.maskedMobile || maskPhone(state.phone))}</div>
                <div class="sp-otp-row">
                  ${state.otp.map((digit, index) => `<input class="sp-otp-input" data-otp-index="${index}" type="text" inputmode="numeric" ${index === 0 ? 'autocomplete="one-time-code"' : ''} maxlength="6" value="${esc(digit)}">`).join('')}
                </div>
                <div class="sp-otp-actions">Didn't receive it? <button id="spResendBtn" class="sp-otp-resend" type="button">Resend OTP</button></div>
              </div>
            ` : ''}
            <button id="spLoginBtn" class="sp-login-btn" type="button" ${state.sendingOtp || state.verifyingOtp ? 'disabled' : ''}>
              ${otpVisible ? (state.verifyingOtp ? 'Verifying OTP...' : 'Verify OTP') : (state.sendingOtp ? 'Sending OTP...' : 'Send OTP')}
            </button>
            ${renderNotice()}
            <div class="sp-login-footer">Secured by Expenselyt. Your data is private and encrypted.<br>For issues contact your society manager.</div>
          </div>
        </div>
      </div>`;
  }

  function renderDashboard() {
    const dashboard = state.dashboard || {};
    const member = dashboard.member || {};
    const society = dashboard.society || {};
    const summary = dashboard.summary || {};
    syncRequestForm(dashboard);
    const requestMonths = [...new Set([state.selectedRequestMonth || '', ...(dashboard.contribution_history || []).map((item) => item.month_key).filter(Boolean)])].filter(Boolean).sort().reverse();
    const selectedRequest = (dashboard.payment_requests || []).find((item) => item.month_key === state.selectedRequestMonth && String(item.status || '').toLowerCase() === 'pending') || null;
    const latestPending = selectedRequest || (dashboard.pending_requests || [])[0] || null;
    const lastPaidValue = summary.last_paid_month ? fmtMonth(summary.last_paid_month, false).replace(' ', "'") : '-';
    const memberStatusText = summary.pending_month_count > 0 ? `${summary.pending_month_count} month${summary.pending_month_count === 1 ? '' : 's'} pending` : 'Active Member';

    const contributionRows = (dashboard.contribution_history || []).slice(0, 12).map((item) => {
      const meta = contributionStatus(item);
      const [m, y] = monthBadgeLines(item.month_key);
      const sub = item.status === 'paid'
        ? `Paid${item.paid_on ? ` on ${fmtDate(item.paid_on)}` : ''}`
        : item.request?.status === 'pending'
          ? `Request sent${item.request.created_at ? ` on ${fmtDate(item.request.created_at)}` : ''}`
          : item.request?.status === 'rejected'
            ? `Rejected${item.request.review_note ? ` • ${item.request.review_note}` : ''}`
            : `${fmtMoney(item.due_amount || member.monthly_due || 0)} due`;
      return `
        <div class="sp-row sp-contribution-row">
          <div class="sp-row-badge ${meta.badge}"><div>${esc(m)}</div><div>${esc(y)}</div></div>
          <div>
            <div class="sp-row-title">${esc(fmtMonth(item.month_key, true))}</div>
            <div class="sp-row-sub">${esc(sub)}</div>
            ${item.status === 'pending'
              ? `<button type="button" class="sp-inline-action" data-sp-request-month="${esc(item.month_key)}">Request I Paid</button>`
              : ''}
          </div>
          <div class="sp-row-right">
            <div class="sp-row-amount ${meta.badge === 'paid' ? 'green' : 'red'}">${fmtMoney(item.amount || item.due_amount || 0)}</div>
            <div class="sp-row-chip ${meta.badge}">${esc(meta.label)}</div>
          </div>
        </div>`;
    }).join('');

    const expenseRows = (dashboard.expenses || dashboard.recent_expenses || []).map((expense) => {
      const cls = expenseCategoryClass(expense.category);
      return `
        <div class="sp-row sp-expense-row">
          <div class="sp-expense-icon ${cls}">${esc((expense.category || expense.title || 'O').slice(0, 1).toUpperCase())}</div>
          <div>
            <div class="sp-row-title">${esc(expense.title || 'Expense')}</div>
            <div class="sp-row-sub">${esc(fmtDate(expense.expense_date))}${expense.category ? ` • ${esc(expense.category)}` : ''}</div>
          </div>
          <div class="sp-row-right">
            <div class="sp-row-amount red">${fmtMoney(expense.amount || 0)}</div>
          </div>
        </div>`;
    }).join('');

    const monthSummary = (dashboard.month_summary || []).slice().reverse().map((row) => {
      const collected = toNumber(row.collected || 0);
      const spent = toNumber(row.spent || 0);
      const balance = toNumber(row.balance || 0);
      const progress = Math.max(8, Math.min(100, Math.round((collected / Math.max(collected + spent, 1)) * 100)));
      return `
        <div class="sp-month-cell sp-collection-cell">
          <div class="sp-month-name">${esc(fmtMonth(row.month_key, true))}</div>
          <div class="sp-month-collected">${esc(fmtMoney(collected).replace('.00', ''))}</div>
          <div class="sp-month-exp">Exp: ${esc(fmtMoney(spent).replace('.00', ''))}</div>
          <div class="sp-progress"><span style="width:${progress}%;background:${balance >= 0 ? 'var(--sp-green-700)' : 'var(--sp-red-600)'}"></span></div>
          <div class="sp-balance ${balance >= 0 ? 'positive' : 'negative'}">${balance >= 0 ? '+' : '-'}${esc(fmtMoney(Math.abs(balance)).replace('.00', ''))}</div>
        </div>`;
    }).join('');

    const overviewCards = `
      <div class="sp-overview-grid">
        <div class="sp-overview-tile">
          <div class="sp-total-label">Total Collected</div>
          <div class="sp-total-value green">${fmtMoney(dashboard.totals?.overall_collected || 0)}</div>
          <div class="sp-total-sub">${dashboard.month_summary?.length || 0} months tracked</div>
        </div>
        <div class="sp-overview-tile">
          <div class="sp-total-label">Total Expenses</div>
          <div class="sp-total-value red">${fmtMoney(dashboard.totals?.overall_spent || 0)}</div>
          <div class="sp-total-sub">${dashboard.expenses?.length || dashboard.recent_expenses?.length || 0} expense items</div>
        </div>
        <div class="sp-overview-tile">
          <div class="sp-total-label">Net Balance</div>
          <div class="sp-total-value blue">${fmtMoney(dashboard.totals?.overall_balance || 0)}</div>
          <div class="sp-total-sub">${toNumber(dashboard.payment_status?.paid_count || 0)} paid in selected month</div>
        </div>
        <div class="sp-overview-tile">
          <div class="sp-total-label">Members</div>
          <div class="sp-total-value amber">${toNumber(dashboard.totals?.member_count || 0)}</div>
          <div class="sp-total-sub">${toNumber(dashboard.payment_status?.pending_count || 0)} pending</div>
        </div>
      </div>`;

    const tabsHtml = `
      <div class="sp-tabs">
        ${[
          ['history', 'My Contribution'],
          ['expenses', 'Expenses'],
          ['collections', 'Collections'],
        ].map(([key, label]) => `
          <button type="button" class="sp-tab-btn ${state.dashboardTab === key ? 'active' : ''}" data-sp-tab="${key}">${esc(label)}</button>
        `).join('')}
      </div>`;

    let activeSection = '';
    if (state.dashboardTab === 'history') {
      activeSection = `
        <section>
          <div class="sp-section-head">
            <h2>My Contributions</h2>
            <p>Your month-wise contribution history</p>
          </div>
          <div class="sp-card sp-list-card sp-history-list">
            <div class="sp-list-head compact">
              <div>
                <div class="sp-total-label">All Time Paid</div>
              </div>
              <div class="sp-list-total">${fmtMoney(summary.my_total || 0)}</div>
            </div>
            ${contributionRows || '<div class="sp-empty">No contribution history yet.</div>'}
          </div>
        </section>`;
    } else if (state.dashboardTab === 'expenses') {
      activeSection = `
        <section>
          <div class="sp-section-head">
            <h2>Society Expenses</h2>
            <p>All recorded society expenses</p>
          </div>
          <div class="sp-card sp-list-card sp-expenses-list">
            ${expenseRows || '<div class="sp-empty">No expenses added yet.</div>'}
          </div>
        </section>`;
    } else if (state.dashboardTab === 'collections') {
      activeSection = `
        <section>
          <div class="sp-section-head">
            <h2>Monthly Collection</h2>
            <p>Society-wide collection per month</p>
          </div>
          <div class="sp-card sp-collections-card">
            <div class="sp-month-grid">
              ${monthSummary || '<div class="sp-empty">No monthly collection data yet.</div>'}
            </div>
          </div>
        </section>`;
    }

    const requestModal = state.requestModalOpen ? `
      <div class="sp-modal-backdrop">
        <div class="sp-modal-card">
          <div class="sp-modal-head">
            <div>
              <div class="sp-row-title">Request I Paid</div>
              <div class="sp-row-sub">Notify the admin after you pay. It will stay pending until approved.</div>
            </div>
            <button type="button" class="sp-modal-close" id="spRequestModalClose" aria-label="Close">&times;</button>
          </div>
          <div class="sp-pay-grid compact">
            <label class="sp-input-label">Month
              <input id="spRequestMonth" class="sp-pay-input" type="month" value="${esc(state.selectedRequestMonth)}" list="spRequestMonths">
              <datalist id="spRequestMonths">${requestMonths.map((monthKey) => `<option value="${esc(monthKey)}">${esc(fmtMonth(monthKey, true))}</option>`).join('')}</datalist>
            </label>
            <label class="sp-input-label">Amount
              <input id="spRequestAmount" class="sp-pay-input" type="number" min="0.01" step="0.01" value="${esc(String(state.requestAmount || ''))}" placeholder="Enter paid amount">
            </label>
          </div>
          <div class="sp-request-inline">
            <label class="sp-input-label">Paid On
              <input id="spRequestPaidOn" class="sp-pay-input" type="date" value="${esc(state.requestPaidOn || '')}">
            </label>
            <div class="sp-input-label">Status
              ${latestPending
                ? `<div class="sp-request-status ${requestStatusClass(latestPending.status)}">${esc(requestStatusLabel(latestPending.status))}</div>`
                : '<div class="sp-request-status approved">No pending request</div>'}
            </div>
          </div>
          <label class="sp-input-label">Note
            <textarea id="spRequestNote" class="sp-pay-textarea compact" placeholder="Optional payment note">${esc(state.requestNote || '')}</textarea>
          </label>
          <div class="sp-modal-actions">
            <button id="spSubmitRequestBtn" class="sp-pill-btn" type="button" ${state.submittingRequest ? 'disabled' : ''}>${state.submittingRequest ? 'Sending request...' : 'Send Request'}</button>
            <button id="spRequestModalCancel" class="sp-outline-btn" type="button">Cancel</button>
          </div>
        </div>
      </div>` : '';

    return `
      <div class="sp-dashboard">
        <div class="sp-hero">
          <div class="sp-hero-inner">
            <div class="sp-topbar">
              <div class="sp-hero-brand">${esc(society.name || 'Society')} ${society.location ? `• ${esc(society.location)}` : ''}</div>
              <button id="spLogoutBtn" class="sp-outline-btn" type="button">Logout</button>
            </div>
            <div class="sp-greeting">Welcome back,</div>
            <div class="sp-member-name">${esc(member.member_name || 'Member')}</div>
            <div class="sp-hero-info">
              <div class="sp-hero-pill">${esc(member.unit_label || 'Unit')} • ${esc(String(member.property_type || 'home').toLowerCase() === 'shop' ? 'Shop' : 'Home')}</div>
              <div class="sp-hero-pill">${esc(memberStatusText)}</div>
            </div>
            <div class="sp-summary-grid">
              <div class="sp-summary-card">
                <div class="sp-summary-label">Monthly Due</div>
                <div class="sp-summary-value">${fmtMoney(member.monthly_due || 0)}</div>
              </div>
              <div class="sp-summary-card">
                <div class="sp-summary-label">My Total</div>
                <div class="sp-summary-value green">${fmtMoney(summary.my_total || 0)}</div>
              </div>
              <div class="sp-summary-card compact">
                <div class="sp-summary-label">Pending</div>
                <div class="sp-summary-value amber">${fmtMoney(summary.pending_amount || 0)}</div>
              </div>
              <div class="sp-summary-card compact">
                <div class="sp-summary-label">Last Paid</div>
                <div class="sp-summary-value">${esc(lastPaidValue)}</div>
              </div>
            </div>
            <div class="sp-hero-overview">
              ${overviewCards}
            </div>
          </div>
        </div>

        <div class="sp-main">
          ${renderNotice()}
          ${tabsHtml}
          ${activeSection}
        </div>
        ${requestModal}
      </div>`;
  }

  function render() {
    if (!app) return;
    if (state.view === 'dashboard' && state.dashboard) {
      app.innerHTML = renderDashboard();
    } else {
      app.innerHTML = renderLogin();
    }
    bindEvents();
    if (state.view === 'otp') focusOtpInput(state.otp.findIndex((value) => !value) === -1 ? 5 : state.otp.findIndex((value) => !value));
  }

  async function bootstrap() {
    try {
      const session = await publicApi('/api/public/society-portal/session');
      if (session.authenticated && session.dashboard) {
        state.dashboard = session.dashboard;
        state.view = 'dashboard';
        syncRequestForm(state.dashboard);
      } else {
        state.view = 'login';
      }
    } catch (_err) {
      state.view = 'login';
    }
    render();
  }

  bootstrap();
}());
