// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EXPENSE MANAGER â€” Main Application Logic
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let currentTab = 'dashboard';
let _userRole = 'user';
let _accessiblePages = ['dashboard', 'expenses'];
let _currentUserId = null;
let _currentUser = null;
let dashFilters = { year: new Date().getFullYear() };
let expFilters = { year: new Date().getFullYear(), month: new Date().getMonth(), search: '', spendType: 'all', sortField: 'date', sortDir: 'desc', page: 1, pageSize: 50 };
let _expenseCache = [];
let _expenseCategories = [];
let _activeExpenseForm = null;
let _editingExpCcTxnId = null;
let _editingExpCcLink = null;
let _expenseCategoryHideTimer = null;
let _expenseScanDraft = null;
let _expenseScanSaving = false;
let _expenseScanCommonBankId = '';
let _notificationItems = [];
let _notificationUnread = 0;
let _notificationPreferences = { push_enabled: true };
let _notificationLoading = false;
let _notificationPrefsLoading = false;

function cleanMojibakeText(value) {
  const raw = String(value ?? '');
  if (!raw) return '';
  return raw
    .replace(/Ã¢â‚¬â€|â€”|â€"/g, '-')
    .replace(/Ã¢â‚¬Â¢|Â·|â€¢/g, '|')
    .replace(/Ã¢Ë†Å¾|âˆž/g, '')
    .replace(/Ã¢â‚¬Ëœ|Ã¢â‚¬â„¢|â€™/g, "'")
    .replace(/Ã¢â‚¬Å“|Ã¢â‚¬Â|â€œ|â€�/g, '"')
    .replace(/Â/g, '')
    .trim();
}

async function loadExpenseCategories() {
  const data = await api('/api/expenses/categories');
  _expenseCategories = (data?.categories || []).filter(Boolean);
  return _expenseCategories;
}

function expenseCategoryDatalistHtml(selected = '') {
  const unique = [...new Set((_expenseCategories || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (selected && !unique.includes(selected)) unique.unshift(selected);
  const selectedValue = String(selected || '').trim();
  const toJsArg = (value) => JSON.stringify(String(value ?? ''));
  return `
    <div class="combo-wrap" style="position:relative">
      <input
        class="fi"
        id="eCategory"
        value="${escHtml(selectedValue)}"
        placeholder="Type category"
        maxlength="80"
        autocomplete="off"
        onfocus="showExpenseCategoryAutocomplete()"
        oninput="filterExpenseCategoryAutocomplete()"
        onblur="scheduleHideExpenseCategoryAutocomplete()"
        onkeydown="handleExpenseCategoryAutocompleteKeydown(event)"
      >
      <div
        id="eCategoryMenu"
        style="display:none;position:absolute;left:0;right:0;top:calc(100% + 6px);background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 30px rgba(16,24,40,.12);padding:6px;z-index:9999;max-height:180px;overflow:auto"
        onmousedown="cancelHideExpenseCategoryAutocomplete()"
      >
        ${unique.map((value) => `<button type="button" data-category="${escHtml(value)}" style="display:block;width:100%;text-align:left;padding:9px 10px;border:none;border-radius:10px;background:#fff;color:var(--t1);font-size:14px;cursor:pointer" onmouseenter="this.style.background='var(--bg2)'" onmouseleave="this.style.background='#fff'" onclick='selectExpenseCategoryAutocomplete(${toJsArg(value)})'>${escHtml(value)}</button>`).join('')}
        <div id="eCategoryEmpty" style="display:none;padding:9px 10px;color:var(--t3);font-size:13px">No matching categories</div>
      </div>
    </div>`;
}

function _expenseCategoryAutocompleteItems() {
  return Array.from(document.querySelectorAll('#eCategoryMenu [data-category]'));
}

function showExpenseCategoryAutocomplete() {
  cancelHideExpenseCategoryAutocomplete();
  filterExpenseCategoryAutocomplete();
}

function hideExpenseCategoryAutocomplete() {
  cancelHideExpenseCategoryAutocomplete();
  const menu = document.getElementById('eCategoryMenu');
  if (menu) menu.style.display = 'none';
}

function scheduleHideExpenseCategoryAutocomplete() {
  cancelHideExpenseCategoryAutocomplete();
  _expenseCategoryHideTimer = setTimeout(() => hideExpenseCategoryAutocomplete(), 120);
}

function cancelHideExpenseCategoryAutocomplete() {
  if (_expenseCategoryHideTimer) {
    clearTimeout(_expenseCategoryHideTimer);
    _expenseCategoryHideTimer = null;
  }
}

function filterExpenseCategoryAutocomplete() {
  const input = document.getElementById('eCategory');
  const menu = document.getElementById('eCategoryMenu');
  const empty = document.getElementById('eCategoryEmpty');
  if (!input || !menu) return;
  const query = String(input.value || '').trim().toLowerCase();
  let visibleCount = 0;
  _expenseCategoryAutocompleteItems().forEach((item) => {
    const value = String(item.dataset.category || '').toLowerCase();
    const visible = !query || value.includes(query);
    item.style.display = visible ? 'block' : 'none';
    if (visible) visibleCount++;
  });
  if (empty) empty.style.display = visibleCount ? 'none' : 'block';
  menu.style.display = visibleCount || query ? 'block' : 'none';
}

function selectExpenseCategoryAutocomplete(value) {
  const input = document.getElementById('eCategory');
  if (input) input.value = value || '';
  hideExpenseCategoryAutocomplete();
}

function handleExpenseCategoryAutocompleteKeydown(event) {
  if (event?.key === 'Escape') {
    stopEvent(event);
    hideExpenseCategoryAutocomplete();
    event.target?.blur?.();
  }
}

document.addEventListener('pointerdown', (event) => {
  const wrap = event.target?.closest?.('.combo-wrap');
  if (!wrap) hideExpenseCategoryAutocomplete();
}, true);
let friendSort = 'name';
let selectedFriend = null;
const DIVIDE_DRAFT_STORAGE_KEY = 'expense-lite.divide-draft.v1';
let divideItems = _loadDivideDraftItems();
let divideSelected = new Set();
let dividePaidBy = 'self';

function canAccessTab(tab) {
  if (_userRole === 'admin') return true;
  if (tab === 'admin') return false;
  return _accessiblePages.includes(tab);
}

function canAccessFeature(featureKey) {
  if (_userRole === 'admin') return true;
  return _accessiblePages.includes(featureKey);
}

function validateFriendNameInput(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (!value) return 'Friend name is required';
  if (value.length > 80) return 'Friend name must be 80 characters or fewer';
  if (!/^[A-Za-z0-9 ]+$/.test(value)) return 'Friend name can contain only letters, numbers, and spaces';
  return '';
}

function normalizeInputDate(value) {
  if (!value) return '';
  const str = String(value).trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const parsedIso = new Date(str);
    if (!Number.isNaN(parsedIso.getTime())) {
      const y = parsedIso.getFullYear();
      const m = String(parsedIso.getMonth() + 1).padStart(2, '0');
      const d = String(parsedIso.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  const dmy = str.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return str.length >= 10 ? str.slice(0, 10) : str;
}

function normalizeTxnDateValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    const year = Number(value.year ?? value.y);
    const month = Number(value.month ?? value.m);
    const day = Number(value.day ?? value.d);
    if (year && month && day) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    if (value.date != null) return normalizeTxnDateValue(value.date);
    if (value.value != null) return normalizeTxnDateValue(value.value);
  }
  return normalizeInputDate(value);
}

function repairMojibakeText(value) {
  return String(value ?? '');
}

function parseIntegerField(raw, fieldLabel, { min = null, max = null, required = false } = {}) {
  const text = String(raw ?? '').trim();
  if (!text) {
    if (required) throw new Error(`${fieldLabel} is required`);
    return null;
  }
  if (!/^-?\d+$/.test(text)) throw new Error(`${fieldLabel} must be a whole number`);
  const value = Number(text);
  if (!Number.isInteger(value)) throw new Error(`${fieldLabel} must be a whole number`);
  if (min != null && value < min) throw new Error(`${fieldLabel} must be at least ${min}`);
  if (max != null && value > max) throw new Error(`${fieldLabel} must be at most ${max}`);
  return value;
}

function parseMoneyField(raw, fieldLabel, { min = 0, required = false } = {}) {
  const text = String(raw ?? '').trim();
  if (!text) {
    if (required) throw new Error(`${fieldLabel} is required`);
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Enter a valid ${fieldLabel.toLowerCase()}`);
  if (value < min) throw new Error(`${fieldLabel} must be ${min} or more`);
  return Math.round(value * 100) / 100;
}

function stopEvent(event) {
  if (!event) return;
  event.preventDefault();
  event.stopPropagation();
}

// â”€â”€â”€ INIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const [user, access] = await Promise.all([api('/api/auth/me'), api('/api/auth/me/access')]);
    if (user && user.display_name) {
      _currentUserId = user.id || null;
      _currentUser = user;
      if (typeof setCurrencyPrefs === 'function') setCurrencyPrefs(user);
      renderUserBox();
    }
    if (access && !access.error) {
      _userRole = access.role || 'user';
      _accessiblePages = access.pages || ['dashboard'];
    }
  } catch (err) {
    console.error('[app:init] startup failed', err);
  }

  if (_userRole === 'admin') {
    const btn = document.getElementById('adminNavBtn');
    if (btn) btn.style.display = '';
  }
  // Show/hide nav buttons based on accessible pages (non-admin only)
  if (_userRole !== 'admin') {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      const tab = btn.dataset.tab;
      if (tab === 'admin') return; // admin button handled separately
      if (!canAccessTab(tab)) btn.style.display = 'none';
    });
  }
  if (canAccessTab('notifications')) {
    refreshNotificationPreferences().catch(() => {});
    refreshNotificationUnreadCount().catch(() => {});
  } else {
    updateNotificationNavBadge();
  }
  loadTab();
  // Auto-apply recurring entries for the current month (silent, runs in background)
  api('/api/recurring/apply', { method: 'POST' }).then(r => {
    if (r?.applied > 0) toast(`${r.applied} recurring entr${r.applied === 1 ? 'y' : 'ies'} applied for this month`, 'success');
  });
  // Check for trip invite in URL params
  const urlParams = new URLSearchParams(location.search);
  const inviteToken = urlParams.get('invite');
  if (inviteToken) {
    history.replaceState({}, '', '/');
    checkTripInvite(inviteToken);
  }
});

window.addEventListener('focus', () => {
  if (!canAccessTab('notifications')) return;
  refreshNotificationUnreadCount().catch(() => {});
  if (currentTab === 'notifications') loadNotifications();
});

function toggleSidebar(forceOpen) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar || !backdrop || window.innerWidth > 768) return;
  const open = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', open);
  backdrop.classList.toggle('show', open);
  document.body.classList.toggle('sidebar-open', open);
}

function renderUserBox() {
  const box = document.getElementById('userBox');
  if (!box || !_currentUser) return;
  const avatar = _currentUser.avatar_url
    ? `<img src="${escHtml(_currentUser.avatar_url)}" alt="Profile" style="width:40px;height:40px;border-radius:50%;object-fit:cover;background:#fff1" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` +
      `<div class="avatar" style="display:none;width:40px;height:40px;border-radius:50%;margin:0;background:rgba(255,255,255,0.12);color:#fff">${escHtml((_currentUser.display_name || 'U')[0].toUpperCase())}</div>`
    : `<div class="avatar" style="width:40px;height:40px;border-radius:50%;margin:0;background:rgba(255,255,255,0.12);color:#fff">${escHtml((_currentUser.display_name || 'U')[0].toUpperCase())}</div>`;

  box.innerHTML = `
    <div class="profile-mini" onclick="showProfileSettings()" style="display:flex;align-items:center;gap:10px;cursor:pointer">
      ${avatar}
      <div style="min-width:0">
        <div class="name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(_currentUser.display_name || '')}</div>
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(_currentUser.email || _currentUser.username || '')}</div>
      </div>
    </div>`;
}

async function refreshCurrentUser() {
  const user = await api('/api/auth/me');
  if (user) {
    _currentUser = user;
    _currentUserId = user.id || null;
    if (typeof setCurrencyPrefs === 'function') setCurrencyPrefs(user);
    renderUserBox();
  }
  return user;
}

function showProfileSettings() {
  if (!_currentUser) return;
  const currencyCode = _currentUser.currency_code || 'INR';
  openModal('Profile Settings', `
    <div class="fg">
      <label class="fl">Display Name<input class="fi" id="pfName" value="${escHtml(_currentUser.display_name || '')}"></label>
      <label class="fl">Email<input class="fi" id="pfEmail" type="email" value="${escHtml(_currentUser.email || '')}"></label>
      <label class="fl">Phone Number<input class="fi" id="pfMobile" value="${escHtml(_currentUser.mobile || '')}" placeholder="+91 9876543210"></label>
      <label class="fl">Currency
        <select class="fi" id="pfCurrency">
          ${['INR','USD','EUR','GBP','AED','CAD','AUD','SGD','JPY','CNY','THB'].map(code => `<option value="${code}" ${currencyCode===code?'selected':''}>${code}</option>`).join('')}
        </select>
      </label>
      <label class="fl">Profile Picture URL<input class="fi" id="pfAvatar" value="${escHtml(_currentUser.avatar_url || '')}" placeholder="https://..."></label>
      <label class="fl full">Upload Profile Picture<input class="fi" id="pfPhoto" type="file" accept="image/*"></label>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:6px">
      <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:10px">CHANGE PASSWORD</div>
      <div class="fg">
        <label class="fl"><input class="fi" id="pfCurrentPwd" type="password" placeholder="Current password"></label>
        <label class="fl"><input class="fi" id="pfNewPwd" type="password" placeholder="New password"></label>
        <label class="fl full"><input class="fi" id="pfConfirmPwd" type="password" placeholder="Confirm new password"></label>
      </div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="saveProfileSettings()">Save Changes</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
      <button class="btn" style="background:#fff5f5;color:var(--red);border:1px solid #f3c5c5" onclick="deleteOwnAccount()">Delete Account</button>
    </div>`);
  const body = document.querySelector('#modalContent .modal-body');
  if (body) body.insertAdjacentHTML('beforeend', formatAuditMeta(_currentUser));
}

function formatAuditMeta(user) {
  const rows = [
    ['Created', user?.created_at ? `${fmtDate(user.created_at)}${user.created_by ? ` by #${user.created_by}` : ''}` : 'Not available'],
    ['Modified', user?.updated_at ? `${fmtDate(user.updated_at)}${user.updated_by ? ` by #${user.updated_by}` : ''}` : 'Not available'],
    ['Deleted', user?.deleted_at ? `${fmtDate(user.deleted_at)}${user.deleted_by ? ` by #${user.deleted_by}` : ''}` : 'Not deleted'],
  ];
  return `
    <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:12px">
      <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:10px">AUDIT</div>
      <div style="display:grid;gap:6px;font-size:12px;color:var(--t2)">
        ${rows.map(([label, value]) => `<div><span style="font-weight:600;color:var(--t1)">${label}:</span> ${escHtml(value)}</div>`).join('')}
      </div>
    </div>`;
}

async function uploadCurrentProfilePhoto() {
  const file = document.getElementById('pfPhoto')?.files?.[0];
  if (!file) return _currentUser?.avatar_url || '';
  const fd = new FormData();
  fd.append('photo', file);
  const res = await fetch('/api/auth/profile-photo', { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok || !data?.success) throw new Error(data?.error || 'Profile photo upload failed');
  return data.avatar_url || '';
}

async function saveProfileSettings() {
  const display_name = document.getElementById('pfName').value.trim();
  const email = document.getElementById('pfEmail').value.trim();
  const mobile = document.getElementById('pfMobile').value.trim();
  const currency_code = document.getElementById('pfCurrency').value;
  const currencyPrefs = typeof getCurrencyPrefsForCode === 'function'
    ? getCurrencyPrefsForCode(currency_code, _currentUser?.locale_code)
    : { currency_code, locale_code: _currentUser?.locale_code || 'en-IN' };
  let avatar_url = document.getElementById('pfAvatar').value.trim();
  const current_password = document.getElementById('pfCurrentPwd').value;
  const new_password = document.getElementById('pfNewPwd').value;
  const confirm_password = document.getElementById('pfConfirmPwd').value;

  if (!display_name || !email) { toast('Name and email are required', 'warning'); return; }

  try {
    avatar_url = await uploadCurrentProfilePhoto() || avatar_url;
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const profileRes = await api('/api/auth/profile', {
    method: 'PUT',
    body: { display_name, email, mobile, avatar_url, ...currencyPrefs },
  });
  if (!profileRes?.success) { toast(profileRes?.error || 'Profile update failed', 'error'); return; }
  if (typeof setCurrencyPrefs === 'function') setCurrencyPrefs(profileRes.user || currencyPrefs);

  if (current_password || new_password || confirm_password) {
    if (!current_password || !new_password || !confirm_password) { toast('Fill all password fields to change password', 'warning'); return; }
    if (new_password !== confirm_password) { toast('New passwords do not match', 'warning'); return; }
    const pwdRes = await api('/api/auth/change-password', {
      method: 'POST',
      body: { current_password, new_password },
    });
    if (!pwdRes?.success) { toast(pwdRes?.error || 'Password change failed', 'error'); return; }
  }

  await refreshCurrentUser();
  closeModal();
  toast('Profile updated', 'success');
}

async function deleteOwnAccount() {
  const confirmed = await confirmDialog('Delete your account? This is a soft delete, so data is retained for admin review, but you will be logged out immediately.');
  if (!confirmed) return;
  const secondConfirm = await confirmDialog('Please confirm again. Your account will become inactive and inaccessible until restored by an admin.');
  if (!secondConfirm) return;
  const res = await api('/api/auth/profile', { method: 'DELETE' });
  if (!res?.success) {
    toast(res?.error || 'Account deletion failed', 'error');
    return;
  }
  window.location.href = res.redirect || '/login';
}

function switchTab(tab) {
  if (!canAccessTab(tab)) {
    toast('You do not have access to this page. Please upgrade your plan.', 'error');
    return;
  }
  currentTab = tab;
  selectedFriend = null;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (window.innerWidth <= 768) toggleSidebar(false);
  loadTab();
}

window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('show');
    document.body.classList.remove('sidebar-open');
  }
});

function loadTab() {
  if (typeof window.analyticsTrackScreen === 'function') {
    window.analyticsTrackScreen(`tab_${currentTab}`, { screen_class: 'app_tab' });
  }
  if (currentTab === 'dashboard') loadDashboard();
  else if (currentTab === 'expenses') loadExpenses();
  else if (currentTab === 'friends') selectedFriend ? loadFriendDetail() : loadFriends();
  else if (currentTab === 'divide') loadDivide();
  else if (currentTab === 'livesplit') {
    if (typeof loadLiveSplit === 'function') loadLiveSplit();
    else loadDivide();
  }
  else if (currentTab === 'petroldivide') {
    if (typeof loadPetrolDivide === 'function') loadPetrolDivide();
    else if (typeof loadLiveSplit === 'function') loadLiveSplit();
    else {
      console.error('[petroldivide] loader missing');
      toast('Divide Petrol script not loaded. Please hard refresh.', 'error');
    }
  }
  else if (currentTab === 'emi') loadEMI();
  else if (currentTab === 'reports') loadReports();
  else if (currentTab === 'trips') loadTrips();
  else if (currentTab === 'emitracker') loadEmiTracker();
  else if (currentTab === 'friendemis') loadFriendEmiTracker();
  else if (currentTab === 'creditcards') loadCreditCards();
  else if (currentTab === 'banks') loadBankAccounts();
  else if (currentTab === 'planner') loadPlanner();
  else if (currentTab === 'tracker') loadTracker();
  else if (currentTab === 'recurring') loadRecurring();
  else if (currentTab === 'ailookup') loadAiLookup();
  else if (currentTab === 'notifications') loadNotifications();
  else if (currentTab === 'admin') loadAdmin();
}

function updateNotificationNavBadge() {
  const badge = document.getElementById('notifUnreadBadge');
  if (!badge) return;
  const unread = Math.max(0, Number(_notificationUnread || 0));
  if (!unread) {
    badge.style.display = 'none';
    badge.textContent = '';
    return;
  }
  badge.style.display = 'inline-flex';
  badge.textContent = unread > 99 ? '99+' : String(unread);
}

async function refreshNotificationUnreadCount() {
  if (!canAccessTab('notifications')) return 0;
  const result = await api('/api/notifications/unread-count');
  if (result?.error) return _notificationUnread;
  _notificationUnread = Math.max(0, Number(result?.unread || 0));
  updateNotificationNavBadge();
  if (currentTab === 'notifications') renderNotifications();
  return _notificationUnread;
}

async function refreshNotificationPreferences() {
  if (!canAccessTab('notifications')) return _notificationPreferences;
  _notificationPrefsLoading = true;
  if (currentTab === 'notifications') renderNotifications();
  const result = await api('/api/notifications/preferences');
  _notificationPrefsLoading = false;
  if (result?.error) {
    if (currentTab === 'notifications') renderNotifications();
    return _notificationPreferences;
  }
  _notificationPreferences = result?.preferences || { push_enabled: true };
  if (currentTab === 'notifications') renderNotifications();
  return _notificationPreferences;
}

function getNotificationTargetTab(item) {
  const screen = String(item?.target_screen || '').trim().toLowerCase();
  if (!screen) return '';
  const map = {
    dashboard: 'dashboard',
    expenses: 'expenses',
    friends: 'friends',
    divide: 'divide',
    livesplit: 'livesplit',
    trips: 'trips',
    reports: 'reports',
    planner: 'planner',
    tracker: 'tracker',
    recurring: 'recurring',
    emitracker: 'emitracker',
    creditcards: 'creditcards',
    banks: 'banks',
    notifications: 'notifications',
  };
  return map[screen] || '';
}

function renderNotifications() {
  const main = document.getElementById('main');
  if (!main) return;
  const unread = Math.max(0, Number(_notificationUnread || 0));
  const pushEnabled = _notificationPreferences?.push_enabled !== false;
  const loadingBlock = `
    <div style="padding:48px 16px;text-align:center;color:var(--t3)">
      <div style="font-size:14px">Loading notifications...</div>
    </div>`;
  const emptyBlock = `
    <div class="card" style="padding:32px;text-align:center">
      <div style="font-size:28px;line-height:1">○</div>
      <div style="font-size:20px;font-weight:800;margin-top:10px">No notifications yet</div>
      <div style="font-size:14px;color:var(--t2);line-height:1.6;margin-top:8px">Monthly summaries and reminders will appear here once the backend sends them.</div>
    </div>`;
  const listBlock = _notificationItems.map((item) => {
    const isRead = !!item?.is_read;
    return `
      <div
        class="card"
        onclick="openNotificationItem(${Number(item.id)})"
        role="button"
        tabindex="0"
        onkeydown="if(event.key==='Enter' || event.key===' '){ event.preventDefault(); openNotificationItem(${Number(item.id)}) }"
        style="width:100%;text-align:left;padding:18px;border:1px solid #e7ebf0;opacity:${isRead ? '0.86' : '1'};cursor:pointer"
      >
        <div style="display:flex;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="font-size:16px;font-weight:800;color:var(--t1)">${escHtml(item?.title || 'Notification')}</div>
            <div style="font-size:14px;line-height:1.6;color:var(--t2);margin-top:8px">${escHtml(item?.body || '')}</div>
          </div>
          ${isRead ? '' : '<div style="width:10px;height:10px;border-radius:50%;background:var(--em);margin-top:6px;flex-shrink:0"></div>'}
        </div>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid #eef1f4;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font-size:12px;color:var(--t3)">${fmtDate(item?.created_at)}</div>
          <button
            type="button"
            class="btn btn-g btn-sm"
            onclick="event.stopPropagation();toggleNotificationRead(${Number(item.id)})"
          >${isRead ? 'Mark unread' : 'Mark read'}</button>
        </div>
      </div>`;
  }).join('');

  main.innerHTML = `
    <div class="tab-content">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <div style="min-width:0">
          <div style="font-size:28px;font-weight:800;color:var(--t1)">Notifications</div>
          <div style="font-size:14px;color:var(--t2);margin-top:4px">${unread ? `${unread} unread update${unread === 1 ? '' : 's'}` : 'Everything is caught up.'}</div>
        </div>
        <button class="btn btn-g" onclick="markAllNotificationsRead()" ${unread ? '' : 'disabled'}>Mark all read</button>
      </div>

      <div class="card" style="padding:16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <div style="font-size:16px;font-weight:700;color:var(--t1)">Push notifications</div>
          <div style="font-size:13px;line-height:1.5;color:var(--t2);margin-top:4px">Turn monthly summaries and reminders on or off for this account.</div>
        </div>
        <label style="display:inline-flex;align-items:center;gap:10px;font-size:14px;font-weight:600;color:var(--t1)">
          <input type="checkbox" ${pushEnabled ? 'checked' : ''} ${_notificationPrefsLoading ? 'disabled' : ''} onchange="toggleNotificationPushEnabled(this.checked)">
          ${_notificationPrefsLoading ? 'Saving...' : (pushEnabled ? 'Enabled' : 'Disabled')}
        </label>
      </div>

      <div style="display:grid;gap:12px">
        ${_notificationLoading ? loadingBlock : (_notificationItems.length ? listBlock : emptyBlock)}
      </div>
    </div>`;
}

async function loadNotifications() {
  _notificationLoading = true;
  renderNotifications();
  const [prefsResult, data] = await Promise.all([
    api('/api/notifications/preferences'),
    api('/api/notifications?limit=100&offset=0'),
  ]);
  if (prefsResult && !prefsResult.error) {
    _notificationPreferences = prefsResult.preferences || { push_enabled: true };
  }
  _notificationPrefsLoading = false;
  if (data?.error) {
    _notificationLoading = false;
    renderNotifications();
    toast(data.error || 'Could not load notifications', 'error');
    return;
  }
  _notificationItems = Array.isArray(data?.notifications) ? data.notifications : [];
  _notificationUnread = Math.max(0, Number(data?.unread || 0));
  _notificationLoading = false;
  updateNotificationNavBadge();
  renderNotifications();
}

async function toggleNotificationPushEnabled(enabled) {
  _notificationPrefsLoading = true;
  renderNotifications();
  const result = await api('/api/notifications/preferences', {
    method: 'PUT',
    body: { push_enabled: !!enabled },
  });
  _notificationPrefsLoading = false;
  if (result?.error) {
    renderNotifications();
    toast(result.error || 'Could not update notification preference', 'error');
    return;
  }
  _notificationPreferences = result?.preferences || { push_enabled: !!enabled };
  renderNotifications();
  toast('Notification preference updated', 'success');
}

async function toggleNotificationRead(notificationId) {
  const id = Number(notificationId);
  const item = _notificationItems.find((row) => Number(row.id) === id);
  if (!item) return;
  const nextRead = !item.is_read;
  const result = await api(`/api/notifications/${id}/read`, {
    method: 'PUT',
    body: { is_read: nextRead },
  });
  if (result?.error) {
    toast(result.error || 'Could not update notification', 'error');
    return;
  }
  const updated = result?.notification || {};
  _notificationItems = _notificationItems.map((row) => Number(row.id) === id
    ? { ...row, is_read: !!updated.is_read, read_at: updated.read_at || null }
    : row);
  _notificationUnread = Math.max(0, Number(result?.unread || 0));
  updateNotificationNavBadge();
  renderNotifications();
}

async function markAllNotificationsRead() {
  if (!_notificationUnread) return;
  const result = await api('/api/notifications/read-all', {
    method: 'POST',
    body: { is_read: true },
  });
  if (result?.error) {
    toast(result.error || 'Could not mark all notifications read', 'error');
    return;
  }
  const nowIso = new Date().toISOString();
  _notificationItems = _notificationItems.map((row) => ({ ...row, is_read: true, read_at: row.read_at || nowIso }));
  _notificationUnread = Math.max(0, Number(result?.unread || 0));
  updateNotificationNavBadge();
  renderNotifications();
}

async function openNotificationItem(notificationId) {
  const id = Number(notificationId);
  const item = _notificationItems.find((row) => Number(row.id) === id);
  if (!item) return;
  if (!item.is_read) {
    const result = await api(`/api/notifications/${id}/read`, {
      method: 'PUT',
      body: { is_read: true },
    });
    if (!result?.error) {
      const updated = result?.notification || {};
      _notificationItems = _notificationItems.map((row) => Number(row.id) === id
        ? { ...row, is_read: true, read_at: updated.read_at || new Date().toISOString() }
        : row);
      _notificationUnread = Math.max(0, Number(result?.unread || 0));
      updateNotificationNavBadge();
      renderNotifications();
    }
  }
  const targetTab = getNotificationTargetTab(item);
  if (targetTab && targetTab !== 'notifications') {
    switchTab(targetTab);
  }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EXPENSES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loadExpenses() {
  const f = expFilters;
  let qs = f.year !== null ? `?year=${f.year}` : '?year=all';
  if (f.month !== null && f.year !== null) qs += `&month=${f.month + 1}`;
  if (f.search) qs += `&search=${encodeURIComponent(f.search)}`;
  if (f.spendType !== 'all') qs += `&spendType=${f.spendType}`;

  const data = await api('/api/expenses' + qs);
  if (!data) return;
  if (!_expenseCategories.length) {
    try { await loadExpenseCategories(); } catch (_) {}
  }

  let list = data.expenses || [];
  _expenseCache = list.slice();
  list.sort((a, b) => {
    let va, vb;
    if (f.sortField === 'date') { va = a.purchase_date; vb = b.purchase_date; }
    else if (f.sortField === 'amount') { va = a.amount; vb = b.amount; }
    else { va = a.item_name.toLowerCase(); vb = b.item_name.toLowerCase(); }
    if (va === vb) {
      if (f.sortField === 'date') return (Number(b.id) || 0) - (Number(a.id) || 0);
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    }
    return f.sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  // Monthly chart data (fetch all for year)
  const allData = await api(f.year !== null ? `/api/expenses?year=${f.year}` : '/api/expenses?year=all');
  const monthly = Array(12).fill(0);
  (allData?.expenses || []).forEach(e => { const m = parseInt(e.purchase_date.slice(5,7)) - 1; monthly[m] += e.amount; });
  const maxM = Math.max(...monthly, 1);

  // Pagination
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / f.pageSize));
  f.page = Math.min(f.page, totalPages);
  const pageStart = (f.page - 1) * f.pageSize;
  const pageList = list.slice(pageStart, pageStart + f.pageSize);

  const sortArrow = (field) => f.sortField === field ? (f.sortDir === 'asc' ? ' &uarr;' : ' &darr;') : '';

  // Save search focus state before re-render
  const searchFocused = document.activeElement?.id === 'expSearch';
  const searchCursor = searchFocused ? document.getElementById('expSearch')?.selectionStart : null;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card">
        <div class="summary-top">
          <div>
            <div class="summary-label">TOTAL EXPENSES</div>
            <div class="summary-amount">${fmtCur(data.total)}</div>
            <div class="summary-words">${amountWords(data.total)}</div>
          </div>
          <div class="count-box"><div class="num">${data.count}</div><div class="lbl">items</div></div>
        </div>
        <div class="mini-chart">
          ${monthly.map((v, i) => `<div class="mini-bar" title="${MONTHS[i]}: ${fmtCur(v)}" onclick="expFilters.month=${f.month===i?'null':i};expFilters.page=1;loadExpenses()">
            <div class="fill" style="height:${(v/maxM)*100}%;opacity:${f.month===i?1:f.month===null?0.6:0.25}"></div>
            <div class="lbl">${MONTHS[i][0]}</div>
          </div>`).join('')}
        </div>
      </div>

      <div class="filter-row">
        <div class="chip-group">
          <button class="chip ${f.year===null?'active':''}" onclick="expFilters.year=null;expFilters.page=1;loadExpenses()">All</button>
          ${getYears().map(y => `<button class="chip ${f.year===y?'active':''}" onclick="expFilters.year=${y};expFilters.page=1;loadExpenses()">${y}</button>`).join('')}
        </div>
      </div>
      <div class="filter-row">
        <div class="chip-group">
          <button class="chip ${f.month===null?'active':''}" onclick="expFilters.month=null;expFilters.page=1;loadExpenses()">All</button>
          ${MONTHS.map((m,i) => `<button class="chip ${f.month===i?'active':''}" onclick="expFilters.month=${i};expFilters.page=1;loadExpenses()">${m}</button>`).join('')}
        </div>
      </div>
      <div class="filter-row">
        <input id="expSearch" class="search-input" placeholder="Search item or category..." value="${f.search}" oninput="expFilters.search=this.value;expFilters.page=1;loadExpenses()">
        <div class="chip-group">
          ${['all','fair','extra'].map(t => `<button class="chip ${f.spendType===t?'active':''}" onclick="expFilters.spendType='${t}';expFilters.page=1;loadExpenses()">${t==='all'?'All':t==='fair'?'Fair':'Extra'}</button>`).join('')}
        </div>
        <button class="btn btn-p btn-sm" onclick="showExpenseForm()">+ Add</button>
        <button class="btn btn-s btn-sm" onclick="showExpenseScanModal()">Scan Image</button>
        <button class="btn btn-s btn-sm" onclick="showImportForm()">Import CSV</button>
        <button class="btn btn-s btn-sm" onclick="showExcelImport()">Import Excel</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th onclick="toggleExpSort('date')">Date${sortArrow('date')}</th>
            <th onclick="toggleExpSort('name')">Item${sortArrow('name')}</th>
            <th>Category</th>
            <th style="text-align:right" onclick="toggleExpSort('amount')">Amount${sortArrow('amount')}</th>
            <th>Type</th>
            <th style="width:100px">Actions</th>
          </tr></thead>
          <tbody>
            ${pageList.length === 0 ? '<tr><td colspan="6" class="empty-td">No expenses found.</td></tr>' : ''}
            ${pageList.map(e => `<tr>
              <td>${fmtDate(e.purchase_date)}</td>
              <td>${e.item_name}</td>
              <td>${e.category ? `<span class="badge" style="background:var(--bg2);color:var(--t2)">${escHtml(e.category)}</span>` : '<span style="color:var(--t3)">-</span>'}</td>
              <td class="td-m" style="font-weight:600">${fmtCur(e.amount)}</td>
              <td><span class="badge ${e.is_extra?'b-extra':'b-fair'}">${e.is_extra?'Extra':'Fair'}</span></td>
              <td><button class="btn-d" style="color:var(--em)" onclick="showExpenseForm(${e.id})">Edit</button><button class="btn-d" onclick="deleteExpense(${e.id})">Del</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      ${totalPages > 1 ? `
      <div class="pagination">
        <button class="pg-btn" ${f.page <= 1 ? 'disabled' : ''} onclick="expFilters.page=${f.page-1};loadExpenses()">&larr; Prev</button>
        <div class="pg-info">
          <span class="pg-range">${pageStart+1}&ndash;${Math.min(pageStart+f.pageSize, total)} of ${total}</span>
          <div class="pg-pages">
            ${paginationPages(f.page, totalPages).map(p => p === '...'
              ? `<span class="pg-ellipsis">...</span>`
              : `<button class="pg-num ${p===f.page?'active':''}" onclick="expFilters.page=${p};loadExpenses()">${p}</button>`
            ).join('')}
          </div>
        </div>
        <button class="pg-btn" ${f.page >= totalPages ? 'disabled' : ''} onclick="expFilters.page=${f.page+1};loadExpenses()">Next &rarr;</button>
      </div>` : `<div style="font-size:12px;color:var(--t3);text-align:center;padding:10px 0">${total} item${total!==1?'s':''}</div>`}
    </div>`;

  // Restore search focus after re-render
  if (searchFocused) {
    const el = document.getElementById('expSearch');
    if (el) { el.focus(); if (searchCursor !== null) el.setSelectionRange(searchCursor, searchCursor); }
  }
}

function paginationPages(current, total) {
  if (total <= 7) return Array.from({length: total}, (_, i) => i + 1);
  const pages = [];
  if (current <= 4) {
    pages.push(1, 2, 3, 4, 5, '...', total);
  } else if (current >= total - 3) {
    pages.push(1, '...', total-4, total-3, total-2, total-1, total);
  } else {
    pages.push(1, '...', current-1, current, current+1, '...', total);
  }
  return pages;
}

function toggleExpSort(field) {
  if (expFilters.sortField === field) expFilters.sortDir = expFilters.sortDir === 'asc' ? 'desc' : 'asc';
  else { expFilters.sortField = field; expFilters.sortDir = 'desc'; }
  expFilters.page = 1;
  loadExpenses();
}

function _findExpenseById(id) {
  return _expenseCache.find((expense) => String(expense.id) === String(id)) || null;
}

async function showExpenseForm(id) {
  let e = { item_name: '', category: '', amount: '', purchase_date: todayStr(), is_extra: false, bank_account_id: null };
  if (id) {
    const cached = _findExpenseById(id);
    if (cached) e = { ...e, ...cached };
    const detail = await api(`/api/expenses/${id}`);
    if (detail?.expense) e = { ...e, ...detail.expense };
  }
  _activeExpenseForm = { ...e, id: id || null };
  _editingExpCcTxnId = null;
  _editingExpCcLink = null;
  await getCcCardsForForm();
  if (!_expenseCategories.length) {
    try { await loadExpenseCategories(); } catch (_) {}
  }
  if (!_bankAccounts.length) {
    const banksData = await api('/api/banks');
    _bankAccounts = banksData?.accounts || [];
  }
  let existingCcLink = null;
  if (id) {
    const ccData = await api(`/api/cc/txns/by-source?source=expense&source_id=${id}`);
    if (ccData?.txn) {
      existingCcLink = ccData.txn;
      _editingExpCcTxnId = ccData.txn.id;
      _editingExpCcLink = ccData.txn;
    }
  }
  window._expenseEntryMode = id ? 'expense' : 'expense';
  const bankOpts = `<option value="">-- Do not deduct from bank --</option>${_bankAccounts.map(a => `<option value="${a.id}" ${e.bank_account_id == a.id ? 'selected' : ''}>${escHtml(a.bank_name)}${a.account_name ? ' - ' + escHtml(a.account_name) : ''}${a.is_default ? ' (Default)' : ''}</option>`).join('')}`;
  const incomeDefaultBank = _bankAccounts.find((a) => a.is_default) || _bankAccounts[0] || null;
  const incomeBankOpts = `<option value="">-- Select bank account --</option>${_bankAccounts.map(a => `<option value="${a.id}" ${incomeDefaultBank && Number(incomeDefaultBank.id) === Number(a.id) ? 'selected' : ''}>${escHtml(a.bank_name)}${a.account_name ? ' - ' + escHtml(a.account_name) : ''}${a.is_default ? ' (Default)' : ''}</option>`).join('')}`;
  openModal(id ? 'Edit Expense' : 'Add Expense', `
    ${id ? '' : `
      <div class="expense-mode-tabs" role="tablist" aria-label="Expense entry mode">
        <button type="button" class="expense-mode-tab active" id="expenseModeExpense" onclick="setExpenseEntryMode('expense')" role="tab" aria-selected="true">Add Expense</button>
        <button type="button" class="expense-mode-tab" id="expenseModeIncome" onclick="setExpenseEntryMode('income')" role="tab" aria-selected="false">Add Income</button>
      </div>
    `}
    <div id="expenseFormExpenseSection">
    <div class="fg">
      <label class="fl">Date<input class="fi" type="date" id="eDate" value="${normalizeInputDate(e.purchase_date) || todayStr()}"></label>
      <label class="fl">Item Name<input class="fi" id="eName" value="${escHtml(e.item_name || '')}" placeholder="e.g. Groceries..." autofocus></label>
      <label class="fl">Category${expenseCategoryDatalistHtml(e.category || '')}</label>
      <label class="fl">Amount (&#8377;)<input class="fi" type="number" step="0.01" id="eAmount" value="${e.amount}" placeholder="0.00" oninput="ccLinkPreview()"></label>
      <label class="fc"><input type="checkbox" id="eExtra" ${e.is_extra?'checked':''}><span>Is Extra (non-essential)</span></label>
      <label class="fl full">Deduct From Bank<select class="fi" id="eBank">${bankOpts}</select></label>
    </div>
    ${ccFormSection(existingCcLink)}
    </div>
    ${id ? '' : `
        <div id="expenseFormIncomeSection" style="display:none">
          <div style="display:grid;gap:14px">
            <div style="font-size:13px;color:var(--t2)">Choose a bank account, review its current balance, and add funds to that balance.</div>
            <label class="fl full">Bank Account<select class="fi" id="eIncomeBank" onchange="updateIncomeBankPreview()">${incomeBankOpts}</select></label>
            <div id="eIncomeBankCard" class="income-balance-card">
              <div class="income-balance-label">Selected Bank Balance</div>
              <div id="eIncomeCurrentBalance" class="income-balance-value">₹0.00</div>
              <div id="eIncomeMinBalance" class="income-balance-note"></div>
            </div>
            <label class="fl">Add Funds (&#8377;)<input class="fi" type="number" step="0.01" id="eIncomeAmount" value="" placeholder="0.00" oninput="updateIncomeBankPreview()"></label>
            <div id="eIncomePreviewCard" class="income-preview-card">
              <div class="income-balance-label">Updated Balance</div>
              <div id="eIncomeNextBalance" class="income-balance-value">₹0.00</div>
            </div>
          </div>
        </div>
    `}
    <div class="fa">
      <button class="btn btn-p" onclick="saveExpense(${id||'null'})">${id?'Update':'Save'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  if (!id) {
    setExpenseEntryMode('expense');
    updateIncomeBankPreview();
  }
  bindModalSubmit(() => saveExpense(id || null));
}

function setExpenseEntryMode(mode) {
  window._expenseEntryMode = mode === 'income' ? 'income' : 'expense';
  const expenseBtn = document.getElementById('expenseModeExpense');
  const incomeBtn = document.getElementById('expenseModeIncome');
  const expenseSection = document.getElementById('expenseFormExpenseSection');
  const incomeSection = document.getElementById('expenseFormIncomeSection');
  const isIncome = window._expenseEntryMode === 'income';
  if (expenseBtn) {
    expenseBtn.className = `expense-mode-tab${isIncome ? '' : ' active'}`;
    expenseBtn.setAttribute('aria-selected', isIncome ? 'false' : 'true');
  }
  if (incomeBtn) {
    incomeBtn.className = `expense-mode-tab${isIncome ? ' active' : ''}`;
    incomeBtn.setAttribute('aria-selected', isIncome ? 'true' : 'false');
  }
  if (expenseSection) expenseSection.style.display = isIncome ? 'none' : '';
  if (incomeSection) incomeSection.style.display = isIncome ? '' : 'none';
}

function updateIncomeBankPreview() {
  const bankId = document.getElementById('eIncomeBank')?.value || '';
  const amount = parseFloat(document.getElementById('eIncomeAmount')?.value || '0') || 0;
  const bank = (_bankAccounts || []).find((item) => String(item.id) === String(bankId));
  const bankCard = document.getElementById('eIncomeBankCard');
  const previewCard = document.getElementById('eIncomePreviewCard');
  const currentBalanceEl = document.getElementById('eIncomeCurrentBalance');
  const minBalanceEl = document.getElementById('eIncomeMinBalance');
  const nextBalanceEl = document.getElementById('eIncomeNextBalance');
  if (!bank) {
    if (bankCard) bankCard.style.display = 'none';
    if (previewCard) previewCard.style.display = 'none';
    return;
  }
  const currentBalance = Number(bank.balance || 0);
  const minBalance = Number(bank.min_balance || 0);
  if (bankCard) bankCard.style.display = 'block';
  if (currentBalanceEl) currentBalanceEl.textContent = fmtCur(currentBalance);
  if (minBalanceEl) minBalanceEl.textContent = `Minimum locked balance ${fmtCur(minBalance)}`;
  if (previewCard) previewCard.style.display = amount > 0 ? 'block' : 'none';
  if (nextBalanceEl) nextBalanceEl.textContent = fmtCur(currentBalance + amount);
}

async function saveExpense(id) {
  if (!id && window._expenseEntryMode === 'income') {
    const incomeBankId = parseInt(document.getElementById('eIncomeBank')?.value || '', 10) || null;
    const incomeAmount = parseFloat(document.getElementById('eIncomeAmount')?.value || '0');
    if (!incomeBankId) { toast('Please select a bank account', 'warning'); return; }
    if (!Number.isFinite(incomeAmount) || incomeAmount <= 0) { toast('Enter a valid income amount', 'warning'); return; }
    const bank = (_bankAccounts || []).find((item) => Number(item.id) === Number(incomeBankId));
    if (!bank) { toast('Selected bank account was not found', 'error'); return; }
    const nextBalance = Math.round((Number(bank.balance || 0) + incomeAmount) * 100) / 100;
    const incomeRes = await api(`/api/banks/${incomeBankId}/balance`, { method: 'PATCH', body: { balance: nextBalance } });
    if (!incomeRes?.success) { toast(incomeRes?.error || 'Could not add income to bank balance', 'error'); return; }
    closeModal();
    toast(`${fmtCur(incomeAmount)} added to ${bank.bank_name}${bank.account_name ? ` - ${bank.account_name}` : ''}`, 'success');
    const banksData = await api('/api/banks');
    _bankAccounts = banksData?.accounts || [];
    loadExpenses();
    return;
  }
  const original = id ? (_activeExpenseForm && String(_activeExpenseForm.id) === String(id) ? _activeExpenseForm : _findExpenseById(id)) : null;
  const bankVal = document.getElementById('eBank')?.value;
  const body = {
    item_name: document.getElementById('eName').value.trim() || original?.item_name || '',
    category: document.getElementById('eCategory')?.value.trim() || null,
    amount: document.getElementById('eAmount').value || String(original?.amount ?? ''),
    purchase_date: document.getElementById('eDate').value || normalizeInputDate(original?.purchase_date) || '',
    is_extra: document.getElementById('eExtra').checked,
    bank_account_id: bankVal ? parseInt(bankVal, 10) : null,
  };
  if (body.category && body.category.length > 80) { toast('Category must be 80 characters or fewer', 'warning'); return; }
  if (!body.item_name || !body.amount || !body.purchase_date) { toast('Please fill all fields', 'warning'); return; }
  const amountValue = parseFloat(body.amount);
  if (!Number.isFinite(amountValue) || amountValue <= 0) { toast('Amount must be greater than 0', 'warning'); return; }
  let r;
  if (id) {
    r = await api(`/api/expenses/${id}`, { method: 'PUT', body });
    if (!r?.success) { toast(r?.error || 'Update failed', 'error'); return; }
    const refreshed = await api(`/api/expenses/${id}`);
    if (refreshed?.expense) _activeExpenseForm = refreshed.expense;
    const ccChecked = document.getElementById('ccLink')?.checked;
    if (ccChecked) {
      const cardId = parseInt(document.getElementById('ccLinkCard')?.value);
      const discPct = parseFloat(document.getElementById('ccLinkDisc')?.value) || 0;
      if (_editingExpCcTxnId && _editingExpCcLink?.card_id == cardId) {
        await api(`/api/cc/txns/${_editingExpCcTxnId}`, { method: 'PUT', body: { discount_pct: discPct, txn_date: body.purchase_date, description: body.item_name, amount: amountValue } });
      } else {
        if (_editingExpCcTxnId) await api(`/api/cc/txns/${_editingExpCcTxnId}`, { method: 'DELETE' });
        await saveCcLinkIfChecked(body.item_name, amountValue, body.purchase_date, 'expense', id);
      }
    } else if (_editingExpCcTxnId) {
      await api(`/api/cc/txns/${_editingExpCcTxnId}`, { method: 'DELETE' });
    }
  }
  else {
    r = await api('/api/expenses', { method: 'POST', body });
    if (!r?.id) { toast(r?.error || 'Save failed', 'error'); return; }
    await saveCcLinkIfChecked(body.item_name, amountValue, body.purchase_date, 'expense', r?.id);
  }
  const nextId = id || r?.id;
  if (nextId) {
    _expenseCache = _expenseCache.map((expense) => String(expense.id) === String(nextId)
      ? { ...expense, ...body, amount: amountValue, id: expense.id }
      : expense
    );
  }
  _activeExpenseForm = null;
  _editingExpCcTxnId = null;
  _editingExpCcLink = null;
  closeModal(); loadExpenses();
}

async function showExpenseScanModal() {
  if (!_expenseCategories.length) {
    try { await loadExpenseCategories(); } catch (_) {}
  }
  if (!_bankAccounts.length) {
    try {
      const banksData = await api('/api/banks');
      _bankAccounts = banksData?.accounts || [];
    } catch (_) {}
  }
  _expenseScanDraft = null;
  _expenseScanCommonBankId = '';
  openModal('Scan Expense From Image', `
    <div style="display:grid;gap:14px">
      <div style="font-size:13px;color:var(--t2)">Upload a receipt, bill, or expense screenshot. We will read the image, extract draft expense rows, and let you review them before anything is saved.</div>
      <label class="fl full">Receipt Image
        <input class="fi" id="expenseScanFile" type="file" accept="image/*">
      </label>
      <div class="fa">
        <button class="btn btn-p" onclick="scanExpenseImage()">Scan Image</button>
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
      </div>
    </div>`);
}

function expenseScanBankOptionsHtml() {
  return `<option value="">-- Do not deduct from bank --</option>${(_bankAccounts || []).map((account) => `<option value="${account.id}" ${String(_expenseScanCommonBankId || '') === String(account.id) ? 'selected' : ''}>${escHtml(account.bank_name)}${account.account_name ? ` - ${escHtml(account.account_name)}` : ''}${account.is_default ? ' (Default)' : ''}</option>`).join('')}`;
}

function renderExpenseScanReviewModal() {
  const draft = _expenseScanDraft || {};
  const rows = Array.isArray(draft.items) ? draft.items : [];
  openModal('Review Scanned Expenses', `
    <div style="display:grid;gap:14px">
      <div style="display:grid;gap:8px;padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--bg)">
        <div style="display:flex;flex-wrap:wrap;gap:8px 14px;font-size:13px;color:var(--t2)">
          <div><b style="color:var(--t1)">Merchant:</b> ${escHtml(draft.merchant || 'Scanned receipt')}</div>
          <div><b style="color:var(--t1)">Date:</b> ${escHtml(draft.purchase_date || 'Not found')}</div>
          <div><b style="color:var(--t1)">Total:</b> ${draft.total_amount ? fmtCur(draft.total_amount) : 'Not found'}</div>
          <div><b style="color:var(--t1)">Confidence:</b> ${Math.round(Number(draft.confidence || 0))}%</div>
        </div>
        <label class="fl full">Deduct From Bank
          <select class="fi" id="expenseScanBank" onchange="expenseScanSetCommonBank(this.value)">${expenseScanBankOptionsHtml()}</select>
        </label>
      </div>
      <div style="font-size:12px;color:var(--t3)">Edit anything below. Only checked rows will be saved.</div>
      <datalist id="expenseCategoryList">${(_expenseCategories || []).map((cat) => `<option value="${escHtml(cat)}"></option>`).join('')}</datalist>
      <div style="display:grid;gap:10px;max-height:52vh;overflow:auto;padding-right:2px">
        ${rows.map((row, index) => `
          <div style="border:1px solid var(--border);border-radius:14px;padding:14px;background:var(--white)">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
              <label class="fc" style="margin:0"><input type="checkbox" ${row.selected !== false ? 'checked' : ''} onchange="expenseScanToggleRow(${index}, this.checked)"><span>Save this row</span></label>
              <div style="font-size:12px;color:var(--t3)">${fmtCur(row.amount || 0)}</div>
            </div>
            <div class="fg">
              <label class="fl">Item Name<input class="fi" value="${escHtml(row.item_name || '')}" oninput="expenseScanSetField(${index}, 'item_name', this.value)"></label>
              <label class="fl">Amount<input class="fi" type="number" step="0.01" value="${escHtml(String(row.amount || ''))}" oninput="expenseScanSetField(${index}, 'amount', this.value)"></label>
              <label class="fl">Category<input class="fi" list="expenseCategoryList" value="${escHtml(row.category || '')}" maxlength="80" placeholder="Type category" oninput="expenseScanSetField(${index}, 'category', this.value)"></label>
              <label class="fl">Date<input class="fi" type="date" value="${escHtml(row.purchase_date || draft.purchase_date || todayStr())}" oninput="expenseScanSetField(${index}, 'purchase_date', this.value)"></label>
            </div>
            <div class="chip-group" style="margin-top:10px">
              <button class="chip ${row.is_extra ? '' : 'active'}" onclick="expenseScanSetType(${index}, false)">Fair / Regular</button>
              <button class="chip ${row.is_extra ? 'active' : ''}" onclick="expenseScanSetType(${index}, true)">Extra / Non-essential</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="fa">
        <button class="btn btn-p" ${_expenseScanSaving ? 'disabled' : ''} onclick="saveScannedExpenses()">${_expenseScanSaving ? 'Saving...' : `Save Selected (${rows.filter((row) => row.selected !== false).length})`}</button>
        <button class="btn btn-g" ${_expenseScanSaving ? 'disabled' : ''} onclick="showExpenseScanModal()">Scan Another</button>
      </div>
    </div>`);
}

async function scanExpenseImage() {
  const file = document.getElementById('expenseScanFile')?.files?.[0];
  if (!file) { toast('Please choose an image first', 'warning'); return; }
  const fd = new FormData();
  fd.append('file', file);
  const scanBtn = document.querySelector('#modalContent .btn.btn-p');
  if (scanBtn) {
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';
  }
  try {
    const res = await fetch('/api/expenses/scan-image', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok || !data?.success || !Array.isArray(data?.draft?.items) || !data.draft.items.length) {
      throw new Error(data?.error || 'Could not extract any expense rows from this image');
    }
    _expenseScanDraft = {
      ...data.draft,
      items: data.draft.items.map((row) => ({
        item_name: String(row.item_name || '').trim(),
        amount: Number(row.amount || 0),
        purchase_date: row.purchase_date || data.draft.purchase_date || todayStr(),
        category: row.category || '',
        is_extra: !!row.is_extra,
        selected: row.selected !== false,
      })),
    };
    renderExpenseScanReviewModal();
  } catch (error) {
    if (scanBtn) {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan Image';
    }
    toast(error?.message || 'Could not scan image', 'error');
  }
}

function expenseScanSetCommonBank(value) {
  _expenseScanCommonBankId = value || '';
}

function expenseScanToggleRow(index, checked) {
  if (!_expenseScanDraft?.items?.[index]) return;
  _expenseScanDraft.items[index].selected = !!checked;
}

function expenseScanSetField(index, field, value) {
  if (!_expenseScanDraft?.items?.[index]) return;
  if (field === 'amount') {
    _expenseScanDraft.items[index][field] = value === '' ? '' : Number(value);
    return;
  }
  _expenseScanDraft.items[index][field] = value;
}

function expenseScanSetType(index, isExtra) {
  if (!_expenseScanDraft?.items?.[index]) return;
  _expenseScanDraft.items[index].is_extra = !!isExtra;
  renderExpenseScanReviewModal();
}

async function saveScannedExpenses() {
  const draft = _expenseScanDraft;
  const rows = (draft?.items || []).filter((row) => row.selected !== false);
  if (!rows.length) { toast('Select at least one row to save', 'warning'); return; }
  for (const row of rows) {
    if (!String(row.item_name || '').trim()) { toast('Each selected row needs an item name', 'warning'); return; }
    const amount = Number(row.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) { toast('Each selected row needs a valid amount', 'warning'); return; }
    if (!String(row.purchase_date || '').trim()) { toast('Each selected row needs a date', 'warning'); return; }
  }
  _expenseScanSaving = true;
  renderExpenseScanReviewModal();
  try {
    for (const row of rows) {
      const body = {
        item_name: String(row.item_name || '').trim(),
        category: String(row.category || '').trim() || null,
        amount: Number(row.amount || 0),
        purchase_date: String(row.purchase_date || '').trim(),
        is_extra: !!row.is_extra,
        bank_account_id: _expenseScanCommonBankId ? Number(_expenseScanCommonBankId) : null,
      };
      const result = await api('/api/expenses', { method: 'POST', body });
      if (!result?.id) throw new Error(result?.error || `Could not save "${body.item_name}"`);
    }
    _expenseScanSaving = false;
    _expenseScanDraft = null;
    _expenseScanCommonBankId = '';
    closeModal();
    toast(`Saved ${rows.length} scanned expense${rows.length === 1 ? '' : 's'}`, 'success');
    loadExpenses();
  } catch (error) {
    _expenseScanSaving = false;
    renderExpenseScanReviewModal();
    toast(error?.message || 'Could not save scanned expenses', 'error');
  }
}

async function deleteExpense(id) {
  if (!await confirmDialog('Delete this expense?')) return;
  await api(`/api/expenses/${id}`, { method: 'DELETE' });
  loadExpenses();
}

function showImportForm() {
  openModal('Import from CSV', `
    <div style="margin-bottom:16px">
      <input type="file" accept=".csv,.txt" id="csvFile" class="fi" onchange="previewCSV()">
      <p style="font-size:12px;color:var(--t3);margin-top:4px">Upload a .csv file with headers for Item, Amount, Date</p>
    </div>
    <div id="csvPreview"></div>`);
}

async function previewCSV() {
  const file = document.getElementById('csvFile').files[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) { document.getElementById('csvPreview').innerHTML = '<p style="color:var(--red)">No data rows found.</p>'; return; }
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));

  // Auto guess
  let guess = { name: '', amount: '', date: '', isExtra: '' };
  headers.forEach(h => {
    const l = h.toLowerCase();
    if (l.includes('item') || l.includes('name') || l.includes('desc')) guess.name = h;
    if (l.includes('amount') || l.includes('price') || l.includes('cost')) guess.amount = h;
    if (l.includes('date') || l.includes('time') || l.includes('purchased')) guess.date = h;
    if (l.includes('extra') || l.includes('type')) guess.isExtra = h;
  });

  const opts = (field) => headers.map(h => `<option value="${h}" ${guess[field]===h?'selected':''}>${h}</option>`).join('');

  document.getElementById('csvPreview').innerHTML = `
    <p style="font-size:13px;margin-bottom:8px">Found <b>${lines.length-1}</b> rows. Map columns:</p>
    <div class="fg">
      <label class="fl">Item Name *<select class="fi" id="mapName"><option value="">--</option>${opts('name')}</select></label>
      <label class="fl">Amount *<select class="fi" id="mapAmount"><option value="">--</option>${opts('amount')}</select></label>
      <label class="fl">Date *<select class="fi" id="mapDate"><option value="">--</option>${opts('date')}</select></label>
      <label class="fl">Is Extra<select class="fi" id="mapExtra"><option value="">--</option>${opts('isExtra')}</select></label>
    </div>
    <div class="fa"><button class="btn btn-p" onclick="doImport()">Import ${lines.length-1} rows</button><button class="btn btn-g" onclick="closeModal()">Cancel</button></div>`;
}

async function doImport() {
  const file = document.getElementById('csvFile').files[0];
  const mapping = JSON.stringify({
    name: document.getElementById('mapName').value,
    amount: document.getElementById('mapAmount').value,
    date: document.getElementById('mapDate').value,
    isExtra: document.getElementById('mapExtra').value,
  });
  const fd = new FormData();
  fd.append('file', file);
  fd.append('mapping', mapping);

  const res = await fetch('/api/expenses/import', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.success) { toast(`Imported ${data.imported} of ${data.total} rows`, 'success'); closeModal(); loadExpenses(); }
  else toast('Import failed: ' + (data.error || 'Unknown error'), 'error');
}

function showExcelImport() {
  openModal('Import from Excel', `
    <div style="background:var(--blue-l);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:var(--t2)">
      <b style="color:var(--t1)">Expected columns:</b>
      <span style="margin-left:10px"><b>B</b> Date &nbsp;&middot;&nbsp; <b>D</b> Description &nbsp;&middot;&nbsp; <b>E</b> Debit &nbsp;&middot;&nbsp; <b>F</b> Extras (Y/N)</span>
    </div>
    <div class="fg" style="margin-bottom:14px">
      <label class="fl full">File (.xlsx / .xls / .ods)
        <input type="file" accept=".xlsx,.xls,.ods" id="xlsxFile" class="fi">
      </label>
      <label class="fl">Password (if protected)
        <input type="password" id="xlsxPass" class="fi" placeholder="Leave blank if none" autocomplete="new-password">
      </label>
      <label class="fl" style="justify-content:flex-end;padding-top:20px">
        <button class="btn btn-p" onclick="loadExcelSheets()">Load Sheets &rarr;</button>
      </label>
    </div>
    <div id="xlsxSheetArea"></div>
    <div id="xlsxPreview"></div>`);
}

async function loadExcelSheets() {
  const file = document.getElementById('xlsxFile').files[0];
  if (!file) { toast('Please select a file first', 'warning'); return; }
  const password = document.getElementById('xlsxPass').value;
  document.getElementById('xlsxSheetArea').innerHTML = `<div style="color:var(--t3);font-size:13px;margin-bottom:10px">Reading file...</div>`;
  document.getElementById('xlsxPreview').innerHTML = '';
  const fd = new FormData();
  fd.append('file', file);
  if (password) fd.append('password', password);
  let res, data;
  try {
    res = await fetch('/api/expenses/import-excel/sheets', { method: 'POST', body: fd });
    const rawText = await res.text();
    console.log('SHEETS RESPONSE [' + res.status + ']:', rawText.slice(0, 300));
    document.getElementById('xlsxSheetArea').innerHTML = `<div style="font-size:11px;color:var(--t3);margin-bottom:8px">Server [${res.status}]: ${rawText.slice(0,200)}</div>`;
    data = JSON.parse(rawText);
  } catch (e) {
    document.getElementById('xlsxSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px">Network error: ${e.message}</p>`;
    return;
  }
  if (data.error) {
    document.getElementById('xlsxSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px;margin-bottom:10px">${data.error}</p>`;
    return;
  }
  const checkboxes = data.sheets.map((s, i) => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;cursor:pointer;background:var(--bg);margin-bottom:4px">
      <input type="checkbox" class="xlsx-sheet-cb" value="${s}" ${i===0?'checked':''} onchange="document.getElementById('xlsxPreview').innerHTML=''">
      <span style="font-size:13px">${s}</span>
    </label>`).join('');
  document.getElementById('xlsxSheetArea').innerHTML = `
    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600;color:var(--t2)">SELECT SHEETS</span>
        <span style="font-size:11px;color:var(--t3);cursor:pointer" onclick="document.querySelectorAll('.xlsx-sheet-cb').forEach(c=>c.checked=true)">Select all</span>
      </div>
      ${checkboxes}
    </div>
    <button class="btn btn-s" onclick="previewExcel()">Preview &rarr;</button>`;
  if (data.sheets.length === 1) previewExcel();
}

function getSelectedSheets() {
  return [...document.querySelectorAll('.xlsx-sheet-cb:checked')].map(c => c.value);
}

async function previewExcel() {
  const file = document.getElementById('xlsxFile').files[0];
  const sheets = getSelectedSheets();
  const password = document.getElementById('xlsxPass')?.value || '';
  if (!file) return;
  if (sheets.length === 0) { toast('Select at least one sheet', 'warning'); return; }
  document.getElementById('xlsxPreview').innerHTML = `<div style="color:var(--t3);font-size:13px">Loading preview...</div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  if (password) fd.append('password', password);
  const res = await fetch('/api/expenses/import-excel/preview', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) { document.getElementById('xlsxPreview').innerHTML = `<p style="color:var(--red);font-size:13px">${data.error}</p>`; return; }
  if (data.count === 0) { document.getElementById('xlsxPreview').innerHTML = `<p style="color:var(--amber);font-size:13px">No valid rows found (${data.skipped} rows skipped - zero amount or missing data).</p>`; return; }
  const sheetLabel = sheets.length > 1 ? `${sheets.length} sheets` : `"${sheets[0]}"`;
  document.getElementById('xlsxPreview').innerHTML = `
    <p style="font-size:13px;margin-bottom:10px">Found <b>${data.count}</b> valid rows from ${sheetLabel} &nbsp;<span style="color:var(--t3)">(${data.skipped} skipped)</span></p>
    <div style="max-height:200px;overflow:auto;margin-bottom:14px">
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Description</th><th class="td-m">Amount</th><th>Type</th></tr></thead>
        <tbody>${data.preview.map(r => `<tr>
          <td>${r.purchase_date}</td><td>${r.item_name}</td>
          <td class="td-m">${fmtCur(r.amount)}</td>
          <td><span class="badge ${r.is_extra?'b-extra':'b-fair'}">${r.is_extra?'Extra':'Regular'}</span></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doExcelImport()">Import all ${data.count} rows</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`;
}


async function doExcelImport() {
  const file = document.getElementById('xlsxFile').files[0];
  const sheets = getSelectedSheets();
  const password = document.getElementById('xlsxPass')?.value || '';
  if (!file || sheets.length === 0) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  if (password) fd.append('password', password);
  const res = await fetch('/api/expenses/import-excel', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.success) { toast(`Imported ${data.imported} expenses successfully`, 'success'); closeModal(); loadExpenses(); }
  else toast('Import failed: ' + (data.error || 'Unknown error'), 'error');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FRIENDS & LOANS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loadFriends() {
  const data = await api('/api/friends');
  if (!data) return;
  let list = data.friends || [];
  const nb = data.netBalance;

  if (friendSort === 'name') list.sort((a,b) => a.name.localeCompare(b.name));
  else if (friendSort === 'high') list.sort((a,b) => b.balance - a.balance);
  else list.sort((a,b) => a.balance - b.balance);

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="text-align:center">
        <div class="summary-label">NET BALANCE</div>
        <div class="summary-amount" style="color:${balColorLight(nb)}">${fmtCur(nb)}</div>
        <div class="summary-words">${nb<0?'Overall you owe':'Overall you are owed'}</div>
      </div>
      <div class="filter-row">
        <button class="btn btn-p btn-sm" onclick="showAddFriend()">+ Add Friend</button>
        <button class="btn btn-s btn-sm" onclick="showFriendExcelImport()">Import Excel</button>
        <button class="btn btn-s btn-sm" onclick="showFriendsShareModal()" title="Share your friends list">Share</button>
        <button class="btn btn-s btn-sm" onclick="downloadFriendsPdf()">PDF</button>
        <div class="chip-group">
          ${['name','high','low'].map(s=>`<button class="chip ${friendSort===s?'active':''}" onclick="friendSort='${s}';loadFriends()">${s==='name'?'A-Z':s==='high'?'Highest':'Lowest'}</button>`).join('')}
        </div>
      </div>
      <div>${list.length===0?'<div class="empty-td">No friends yet. Add one to start tracking loans.</div>':''}
        ${list.map(f => {
          const safeName = String(f.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const safeDeleteName = safeName || 'this friend';
          const linkedLabel = f.linked_user_display_name
            ? `${f.linked_user_display_name}${f.linked_user_username ? ` (@${f.linked_user_username})` : ''}`
            : 'Not linked';
          const safeLinkedLabel = String(linkedLabel).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          return `<div class="friend-card">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer" onclick="selectedFriend=${f.id};loadFriendDetail()">
            <div class="avatar">${escHtml((f.name || '?')[0].toUpperCase())}</div>
            <div class="friend-info">
              <div class="friend-name">${escHtml(f.name)}</div>
              <div style="font-size:11px;color:${balColor(f.balance)}">${f.balance<0?'You owe':f.balance>0?'They owe':'Settled'}</div>
              <div style="font-size:11px;color:${f.linked_user_id ? 'var(--green)' : 'var(--t3)'};margin-top:2px">${f.linked_user_id ? `Linked to ${escHtml(linkedLabel)}` : 'Link to an app user to share split history'}</div>
            </div>
            <div class="friend-bal" style="color:${balColor(f.balance)}">${fmtCur(f.balance)}</div>
          </div>
          <button class="btn-d" style="color:var(--blue)" onclick="stopEvent(event);showFriendLinkModal(${f.id}, '${safeName}', ${f.linked_user_id || 'null'}, '${safeLinkedLabel}')">${f.linked_user_id ? 'Manage' : 'Link'}</button>
          <button class="btn-d" style="color:var(--em)" onclick="stopEvent(event);showEditFriend(${f.id}, '${safeName}')">Edit</button>
          <button class="btn-d" style="color:var(--red)" onclick="stopEvent(event);deleteFriend(${f.id}, '${safeDeleteName}')">Del</button>
        </div>`;
        }).join('')}
      </div>
    </div>`;
}

function _groupReceivedDivideSessions(groups) {
  const sessions = {};
  (groups || []).forEach((group) => {
    const sessionKey = group.session_id || `_solo_${group.id}`;
    const key = `${group.owner_user_id}:${sessionKey}`;
    if (!sessions[key]) {
      sessions[key] = {
        key,
        session_key: sessionKey,
        owner_user_id: Number(group.owner_user_id),
        owner_name: group.owner_name,
        heading: group.heading || group.details,
        divide_date: group.divide_date,
        total_share_amount: 0,
        items: [],
      };
    }
    sessions[key].items.push(group);
    sessions[key].total_share_amount += Number(group.friend_share_amount || 0);
  });
  return Object.values(sessions).sort((a, b) => String(b.divide_date || '').localeCompare(String(a.divide_date || '')));
}

function _sharedDividePersonRows(group) {
  const splits = group.splits || [];
  const friendsTotal = splits.reduce((sum, split) => sum + Number(split.share_amount || 0), 0);
  const ownerShare = Math.round((Number(group.total_amount || 0) - friendsTotal) * 100) / 100;
  const rows = [];
  if (ownerShare > 0.005) {
    rows.push({
      name: `${group.owner_name || 'Owner'} (owner)`,
      share: ownerShare,
      paid: group.paid_by === 'You' ? Number(group.total_amount || 0) : 0,
      isTarget: false,
    });
  }
  splits.forEach((split) => {
    rows.push({
      name: split.friend_name,
      share: Number(split.share_amount || 0),
      paid: group.paid_by === split.friend_name ? Number(group.total_amount || 0) : 0,
      isTarget: Number(split.friend_id) === Number(group.friend_id),
    });
  });
  return rows;
}

function _sharedDivideSessionSummary(session) {
  const totals = new Map();
  (session?.items || []).forEach((group) => {
    _sharedDividePersonRows(group).forEach((person) => {
      const key = String(person.name || '');
      const current = totals.get(key) || { name: person.name, share: 0, paid: 0, isTarget: false };
      current.share += Number(person.share || 0);
      current.paid += Number(person.paid || 0);
      current.isTarget = current.isTarget || !!person.isTarget;
      totals.set(key, current);
    });
  });
  return [...totals.values()];
}

function renderReceivedDivideShares(groups) {
  const sessions = _groupReceivedDivideSessions(groups);
  if (!sessions.length) return '';
  return `
    <div style="margin-top:26px">
      <div style="font-size:16px;font-weight:700;margin-bottom:10px">Shared Split History</div>
      <div style="font-size:12px;color:var(--t3);margin-bottom:12px">Friends can share saved split sessions with you after linking your account. This view is read-only, and you can hide any shared session whenever you want.</div>
      <div style="display:grid;gap:12px">
        ${sessions.map((session) => `
          <div class="card" style="padding:16px">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
              <div>
                <div style="font-size:15px;font-weight:700">${escHtml(session.heading || 'Shared split')}</div>
                <div style="font-size:12px;color:var(--t3);margin-top:4px">Shared by ${escHtml(session.owner_name || 'Unknown')} · ${fmtDate(session.divide_date)} · ${session.items.length} item${session.items.length !== 1 ? 's' : ''}</div>
                <div style="font-size:12px;color:${session.total_share_amount > 0 ? 'var(--red)' : 'var(--t3)'};margin-top:6px;font-weight:600">${session.total_share_amount > 0 ? `You owe ${fmtCur(session.total_share_amount)}` : 'No amount owed'}</div>
              </div>
              <button class="btn-d" style="color:var(--red)" onclick="hideSharedDivideSession(${session.owner_user_id}, '${String(session.session_key).replace(/'/g, "\\'")}')">Hide</button>
            </div>
            <div style="margin-top:14px;display:grid;gap:10px">
              ${session.items.map((group) => `
                <div style="border:1px solid var(--br);border-radius:12px;padding:12px;background:var(--bg2)">
                  <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                    <div>
                      <div style="font-size:13px;font-weight:700">${escHtml(group.details || session.heading || 'Split item')}</div>
                      <div style="font-size:11px;color:var(--t3);margin-top:3px">Paid by ${escHtml(group.paid_by || 'Unknown')} · Total ${fmtCur(group.total_amount || 0)}</div>
                    </div>
                    <div style="font-size:13px;font-weight:700;color:var(--red)">Your share ${fmtCur(group.friend_share_amount || 0)}</div>
                  </div>
                  <div style="margin-top:10px;border-top:1px solid var(--br);padding-top:10px">
                    ${_sharedDividePersonRows(group).map((person) => {
                      const net = Math.round((Number(person.share || 0) - Number(person.paid || 0)) * 100) / 100;
                      const netLabel = Math.abs(net) < 0.005
                        ? 'Settled'
                        : net > 0
                          ? `Owes ${fmtCur(net)}`
                          : `Gets back ${fmtCur(Math.abs(net))}`;
                      const netColor = Math.abs(net) < 0.005 ? 'var(--t3)' : net > 0 ? 'var(--red)' : 'var(--green)';
                      return `
                        <div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;${person.isTarget ? 'font-weight:700' : ''}">
                          <div>
                            <div style="font-size:13px;color:var(--t1)">${escHtml(person.name)}${person.isTarget ? ' (you)' : ''}</div>
                            <div style="font-size:11px;color:var(--t3)">Share ${fmtCur(person.share || 0)} · Paid ${person.paid ? fmtCur(person.paid) : '-'}</div>
                          </div>
                          <div style="font-size:12px;color:${netColor};font-weight:700;align-self:center">${netLabel}</div>
                        </div>`;
                    }).join('')}
                  </div>
                </div>`).join('')}
            </div>
            <div style="margin-top:14px;border-top:1px solid var(--br);padding-top:12px">
              <div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px;letter-spacing:.3px">SESSION TOTAL</div>
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th class="td-m">Share</th>
                      <th class="td-m">Paid</th>
                      <th class="td-m">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${_sharedDivideSessionSummary(session).map((person) => {
                      const net = Math.round((Number(person.share || 0) - Number(person.paid || 0)) * 100) / 100;
                      const diffLabel = Math.abs(net) < 0.005
                        ? 'Settled'
                        : net > 0
                          ? `Owes ${fmtCur(net)}`
                          : `Owed ${fmtCur(Math.abs(net))}`;
                      const diffColor = Math.abs(net) < 0.005 ? 'var(--t3)' : net > 0 ? 'var(--red)' : 'var(--green)';
                      return `<tr${person.isTarget ? ' style="font-weight:700"' : ''}>
                        <td>${escHtml(person.name)}${person.isTarget ? ' (you)' : ''}</td>
                        <td class="td-m">${fmtCur(person.share || 0)}</td>
                        <td class="td-m">${person.paid ? fmtCur(person.paid) : '-'}</td>
                        <td class="td-m" style="color:${diffColor}">${diffLabel}</td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

let _friendLinkSearchTimeout = null;
function showFriendLinkModal(friendId, friendName, linkedUserId, linkedLabel) {
  openModal(`Link Friend: ${friendName}`, `
    <div style="font-size:13px;color:var(--t2);margin-bottom:14px">Link this friend to an app account so saved split history can be shared with them. They will only get a view-only copy and can hide it from their side anytime.</div>
    <div style="background:${linkedUserId ? 'var(--green-l)' : 'var(--bg2)'};border-radius:10px;padding:10px 12px;font-size:13px;color:${linkedUserId ? 'var(--green)' : 'var(--t2)'};margin-bottom:14px">
      ${linkedUserId ? `Currently linked to <b>${escHtml(linkedLabel || 'app user')}</b>.` : 'This friend is not linked yet.'}
      ${linkedUserId ? ` <button class="btn-d" style="color:var(--red);margin-left:8px" onclick="unlinkFriendFromUser(${friendId})">Unlink</button>` : ''}
    </div>
    <label class="fl">Search app users
      <input class="fi" id="friendLinkSearchQ" placeholder="Type username or display name..." oninput="searchFriendLinkUsers()">
    </label>
    <div id="friendLinkSearchResults" style="margin-top:10px"></div>
    <div class="fa" style="margin-top:18px">
      <button class="btn btn-g" onclick="closeModal()">Close</button>
    </div>
    <input type="hidden" id="friendLinkId" value="${friendId}">`);
}

function searchFriendLinkUsers() {
  clearTimeout(_friendLinkSearchTimeout);
  _friendLinkSearchTimeout = setTimeout(async () => {
    const q = document.getElementById('friendLinkSearchQ')?.value?.trim();
    const box = document.getElementById('friendLinkSearchResults');
    if (!box) return;
    if (!q || q.length < 2) {
      box.innerHTML = '<div style="font-size:12px;color:var(--t3)">Type at least 2 characters to search.</div>';
      return;
    }
    const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    const users = data?.users || [];
    box.innerHTML = users.length
      ? users.map((u) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border:1px solid var(--br);border-radius:10px;margin-bottom:6px;font-size:13px">
          <div>${escHtml(u.display_name || u.username)} <span style="color:var(--t3);font-size:11px">@${escHtml(u.username || '')}</span></div>
          <button class="btn btn-p btn-sm" onclick="linkFriendToUserAccount(${u.id})">Link</button>
        </div>`).join('')
      : '<div style="font-size:12px;color:var(--t3)">No matching users found.</div>';
  }, 250);
}

async function linkFriendToUserAccount(linkedUserId) {
  const friendId = parseInt(document.getElementById('friendLinkId')?.value || '0', 10);
  if (!friendId || !linkedUserId) return;
  const res = await api(`/api/friends/${friendId}/link-user`, { method: 'PUT', body: { linked_user_id: linkedUserId } });
  if (res?.success) {
    closeModal();
    toast('Friend linked to app user', 'success');
    if (selectedFriend) await loadFriendDetail(true);
    else await loadFriends();
  } else {
    toast(res?.error || 'Failed to link friend', 'error');
  }
}

async function unlinkFriendFromUser(friendId) {
  const res = await api(`/api/friends/${friendId}/link-user`, { method: 'PUT', body: { linked_user_id: null } });
  if (res?.success) {
    closeModal();
    toast('Friend unlinked', 'success');
    if (selectedFriend) await loadFriendDetail(true);
    else await loadFriends();
  } else {
    toast(res?.error || 'Failed to unlink friend', 'error');
  }
}

async function hideSharedDivideSession(ownerUserId, sessionKey) {
  if (!await confirmDialog('Hide this shared split session from your view?')) return;
  const res = await api('/api/divide/shared/hide', { method: 'POST', body: { owner_user_id: ownerUserId, session_key: sessionKey } });
  if (res?.success) {
    toast('Hidden from your shared history', 'success');
    if (currentTab === 'divide') {
      const sharedData = await api('/api/divide/shared');
      _divSharedGroups = sharedData?.groups || [];
      _divSharedExpandedId = null;
      const body = document.getElementById('divSharedHistoryBody');
      if (body) body.innerHTML = _buildSharedGroupRows().join('');
      const lbl = document.querySelector('#divSharedHistorySection .div-shared-count');
      if (lbl) {
        const sessions = _buildSharedSessions();
        lbl.textContent = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}, ${_divSharedGroups.length} item${_divSharedGroups.length !== 1 ? 's' : ''}`;
      }
      if (!_divSharedGroups.length) renderDivide();
    } else {
      await loadFriends();
    }
  } else {
    toast(res?.error || 'Failed to hide session', 'error');
  }
}

function showAddFriendLegacy() {
  openModal('Add Friend', `
    <label class="fl">Friend's Name<input class="fi" id="fName" placeholder="Enter name" autofocus></label>
    <div class="fa" style="margin-top:16px"><button class="btn btn-p" onclick="addFriend()">Add</button><button class="btn btn-g" onclick="closeModal()">Cancel</button></div>`);
}

async function addFriend() {
  const name = document.getElementById('fName').value.trim().replace(/\s+/g, ' ');
  const validationError = validateFriendNameInput(name);
  if (validationError) { toast(validationError, 'warning'); return; }
  await api('/api/friends', { method: 'POST', body: { name } });
  closeModal(); loadFriends();
}

async function deleteFriend(id, name) {
  if (!await confirmDialog(`Delete ${name} and all their transactions?`)) return;
  await api(`/api/friends/${id}`, { method: 'DELETE' });
  loadFriends();
}

function showEditFriendLegacy(id, currentName) {
  openModal('Edit Friend', `
    <label class="fl">Friend's Name
      <input class="fi" id="fEditName" value="${currentName}" autofocus>
    </label>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="renameFriend(${id})">Save</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function renameFriend(id) {
  const name = document.getElementById('fEditName').value.trim();
  const validationError = validateFriendNameInput(name);
  if (validationError) { toast(validationError, 'warning'); return; }
  await api(`/api/friends/${id}`, { method: 'PUT', body: { name } });
  closeModal(); loadFriends();
}

function showFriendExcelImport() {
  openModal('Import Friends from Excel', `
    <div style="background:var(--blue-l);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:var(--t2)">
      <b style="color:var(--t1)">Sheet name = Friend name.</b>
      &nbsp;Each sheet is imported as one friend's transactions.
    </div>
    <div class="fg" style="margin-bottom:14px">
      <label class="fl full">File (.xlsx / .xls)
        <input type="file" accept=".xlsx,.xls" id="fiFile" class="fi">
      </label>
      <label class="fl">Password (if protected)
        <input type="password" id="fiPass" class="fi" placeholder="Leave blank if none" autocomplete="new-password">
      </label>
      <label class="fl" style="justify-content:flex-end;padding-top:20px">
        <button class="btn btn-p" onclick="loadFriendImportSheets()">Load Sheets &rarr;</button>
      </label>
    </div>
    <div id="fiSheetArea"></div>
    <div id="fiMapping" style="display:none">
      <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:8px">MAP COLUMNS</div>
      <div class="fg">
        <label class="fl">Details / About *<select id="fiMapDetails" class="fi"></select></label>
        <label class="fl">Date *<select id="fiMapDate" class="fi"></select></label>
        <label class="fl">Paid (you gave) *<select id="fiMapPaid" class="fi"></select></label>
        <label class="fl">Received (you got) *<select id="fiMapReceived" class="fi"></select></label>
      </div>
      <button class="btn btn-s btn-sm" style="margin-top:4px" onclick="previewFriendImport()">Preview &rarr;</button>
    </div>
    <div id="fiPreview"></div>`);
}

let _fiSheetHeaders = [];

async function loadFriendImportSheets() {
  const file = document.getElementById('fiFile').files[0];
  if (!file) { toast('Please select a file first', 'warning'); return; }
  const password = document.getElementById('fiPass').value;
  document.getElementById('fiSheetArea').innerHTML = `<div style="color:var(--t3);font-size:13px;margin-bottom:10px">Reading file...</div>`;
  document.getElementById('fiMapping').style.display = 'none';
  document.getElementById('fiPreview').innerHTML = '';
  const fd = new FormData();
  fd.append('file', file);
  if (password) fd.append('password', password);
  let data;
  try {
    const res = await fetch('/api/friends/import-excel/sheets', { method: 'POST', body: fd });
    data = await res.json();
  } catch (e) {
    document.getElementById('fiSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px">Network error: ${e.message}</p>`;
    return;
  }
  if (data.error) {
    document.getElementById('fiSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px">${data.error}</p>`;
    return;
  }

  // Use headers from first sheet that has headers, for column mapping
  const firstWithHeaders = data.sheets.find(s => s.headers && s.headers.length > 0);
  _fiSheetHeaders = firstWithHeaders?.headers || [];

  const checkboxes = data.sheets.map((s, i) => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;cursor:pointer;background:var(--bg);margin-bottom:4px">
      <input type="checkbox" class="fi-sheet-cb" value="${s.name}" ${i < 10 ? 'checked' : ''}>
      <span style="font-size:13px">${s.name}</span>
    </label>`).join('');

  document.getElementById('fiSheetArea').innerHTML = `
    <div style="margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600;color:var(--t2)">SELECT SHEETS (friends)</span>
        <span style="font-size:11px;color:var(--t3);cursor:pointer" onclick="document.querySelectorAll('.fi-sheet-cb').forEach(c=>c.checked=true)">Select all</span>
      </div>
      <div style="max-height:160px;overflow-y:auto">${checkboxes}</div>
    </div>`;

  // Populate column mapping dropdowns
  if (_fiSheetHeaders.length === 0) {
    document.getElementById('fiMapping').innerHTML = `<p style="color:var(--amber);font-size:13px">Could not read column headers from row 1. Make sure your Excel sheet has headers in the first row.</p>`;
    document.getElementById('fiMapping').style.display = 'block';
    return;
  }
  const opts = _fiSheetHeaders.map(h => `<option value="${h.col}">${h.name} (Col ${String.fromCharCode(64 + h.col)})</option>`).join('');
  ['fiMapDetails','fiMapDate','fiMapPaid','fiMapReceived'].forEach(id => {
    document.getElementById(id).innerHTML = opts;
  });

  // Auto-detect columns by header name
  const autoMap = { fiMapDetails: ['about','details','description','narration'],
                    fiMapDate:    ['date','dt'],
                    fiMapPaid:    ['paid','debit','gave','lent'],
                    fiMapReceived:['received','credit','got','returned'] };
  Object.entries(autoMap).forEach(([id, keywords]) => {
    const match = _fiSheetHeaders.find(h => keywords.some(k => h.name.toLowerCase().includes(k)));
    if (match) document.getElementById(id).value = match.col;
  });

  document.getElementById('fiMapping').style.display = 'block';
}

async function previewFriendImport() {
  const file = document.getElementById('fiFile').files[0];
  const password = document.getElementById('fiPass')?.value || '';
  const sheets = [...document.querySelectorAll('.fi-sheet-cb:checked')].map(c => c.value);
  if (!file || sheets.length === 0) { toast('Select at least one sheet', 'warning'); return; }
  const mapping = {
    details:  parseInt(document.getElementById('fiMapDetails').value),
    date:     parseInt(document.getElementById('fiMapDate').value),
    paid:     parseInt(document.getElementById('fiMapPaid').value),
    received: parseInt(document.getElementById('fiMapReceived').value),
  };
  document.getElementById('fiPreview').innerHTML = `<div style="color:var(--t3);font-size:13px;margin-top:12px">Loading preview...</div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheet', sheets[0]);
  fd.append('mapping', JSON.stringify(mapping));
  if (password) fd.append('password', password);
  const res = await fetch('/api/friends/import-excel/preview', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) { document.getElementById('fiPreview').innerHTML = `<p style="color:var(--red);font-size:13px;margin-top:10px">${data.error}</p>`; return; }
  if (data.count === 0) { document.getElementById('fiPreview').innerHTML = `<p style="color:var(--amber);font-size:13px;margin-top:10px">No valid rows found in "${sheets[0]}" (${data.skipped} skipped).</p>`; return; }
  const sheetLabel = sheets.length > 1 ? `${sheets.length} sheets` : `"${sheets[0]}"`;
  document.getElementById('fiPreview').innerHTML = `
    <div style="margin-top:14px">
      <p style="font-size:13px;margin-bottom:8px">Preview of <b>"${sheets[0]}"</b> - <b>${data.count}</b> rows
        <span style="color:var(--t3)">(${data.skipped} skipped)</span>
        ${sheets.length > 1 ? `&nbsp;+&nbsp;<span style="color:var(--em);font-weight:600">${sheets.length - 1} more sheet${sheets.length>2?'s':''}</span>` : ''}
      </p>
      <div style="max-height:180px;overflow:auto;margin-bottom:14px">
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Details</th><th class="td-m">Paid</th><th class="td-m">Received</th></tr></thead>
          <tbody>${data.preview.map(r => `<tr>
            <td>${fmtDate(r.txn_date)}</td><td>${r.details}</td>
            <td class="td-m" style="color:${r.paid>0?'var(--red)':'var(--t3)'}">${r.paid>0?fmtCur(r.paid):'-'}</td>
            <td class="td-m" style="color:${r.received>0?'var(--green)':'var(--t3)'}">${r.received>0?fmtCur(r.received):'-'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="fa">
        <button class="btn btn-p" onclick="doFriendExcelImport()">Import ${sheetLabel}</button>
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
      </div>
    </div>`;
}

async function doFriendExcelImport() {
  const file = document.getElementById('fiFile').files[0];
  const password = document.getElementById('fiPass')?.value || '';
  const sheets = [...document.querySelectorAll('.fi-sheet-cb:checked')].map(c => c.value);
  if (!file || sheets.length === 0) return;
  const mapping = {
    details:  parseInt(document.getElementById('fiMapDetails').value),
    date:     parseInt(document.getElementById('fiMapDate').value),
    paid:     parseInt(document.getElementById('fiMapPaid').value),
    received: parseInt(document.getElementById('fiMapReceived').value),
  };
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  fd.append('mapping', JSON.stringify(mapping));
  if (password) fd.append('password', password);
  const res = await fetch('/api/friends/import-excel', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.success) {
    const summary = data.results.map(r => `${r.sheet}: ${r.imported} rows`).join(' | ');
    toast(`Imported ${data.totalImported} transactions across ${data.results.length} friend(s) - ${summary}`, 'success', 5000);
    closeModal();
    loadFriends();
  } else {
    toast('Import failed: ' + (data.error || 'Unknown error'), 'error');
  }
}

// Loan detail state
let _loanAllTxns = [];
let _loanFriend = null;
let _loanBalance = {};
let loanFilters = { year: '', month: '', date: '', search: '', type: '' };
let loanSort = { col: 'date', dir: 'desc' };
let loanPage = 1;
const loanPageSize = 50;

async function loadFriendDetail(keepFilters) {
  if (!keepFilters) {
    loanFilters = { year: '', month: '', date: '', search: '', type: '' };
    loanSort = { col: 'date', dir: 'desc' };
    loanPage = 1;
  }
  const fData = await api('/api/friends');
  const f = (fData?.friends||[]).find(x => x.id == selectedFriend);
  if (!f) { selectedFriend = null; loadFriends(); return; }
  _loanFriend = f;

  const data = await api(`/api/loans/${f.id}`);
  _loanAllTxns = (data?.transactions || []).map((txn) => ({
    ...txn,
    txn_date: normalizeTxnDateValue(txn?.txn_date),
  }));
  _loanBalance = { balance: data?.balance || 0, totalPaid: data?.totalPaid || 0, totalReceived: data?.totalReceived || 0 };

  renderFriendDetail();
}

function renderFriendDetail() {
  const f = _loanFriend;
  const { balance, totalPaid, totalReceived } = _loanBalance;

  // Build year options from data
  const years = [...new Set(_loanAllTxns.map(t => t.txn_date?.substring(0,4)).filter(Boolean))].sort((a,b) => b-a);
  const yearOpts = `<option value="">All Years</option>${years.map(y=>`<option value="${y}" ${loanFilters.year===y?'selected':''}>${y}</option>`).join('')}`;
  const monthOpts = `<option value="">All Months</option>${['01','02','03','04','05','06','07','08','09','10','11','12'].map((m,i)=>`<option value="${m}" ${loanFilters.month===m?'selected':''}>${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]}</option>`).join('')}`;

  // Filter
  let txns = _loanAllTxns.filter(t => {
    if (loanFilters.year   && !t.txn_date?.startsWith(loanFilters.year)) return false;
    if (loanFilters.month  && t.txn_date?.substring(5,7) !== loanFilters.month) return false;
    if (loanFilters.date   && t.txn_date !== loanFilters.date) return false;
    if (loanFilters.search && !t.details?.toLowerCase().includes(loanFilters.search.toLowerCase())) return false;
    if (loanFilters.type === 'paid'     && !(t.paid > 0))     return false;
    if (loanFilters.type === 'received' && !(t.received > 0)) return false;
    return true;
  });

  // Sort
  txns = [...txns].sort((a, b) => {
    let va, vb;
    if (loanSort.col === 'date')     { va = a.txn_date; vb = b.txn_date; }
    else if (loanSort.col === 'details') { va = a.details?.toLowerCase(); vb = b.details?.toLowerCase(); }
    else if (loanSort.col === 'paid')     { va = a.paid;     vb = b.paid; }
    else if (loanSort.col === 'received') { va = a.received; vb = b.received; }
    if (va < vb) return loanSort.dir === 'asc' ? -1 : 1;
    if (va > vb) return loanSort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  // Filtered totals
  const fPaid = txns.reduce((s,t) => s + (t.paid||0), 0);
  const fReceived = txns.reduce((s,t) => s + (t.received||0), 0);
  const isFiltered = loanFilters.year || loanFilters.month || loanFilters.date || loanFilters.search || loanFilters.type;

  // Paginate
  const totalPages = Math.ceil(txns.length / loanPageSize) || 1;
  if (loanPage > totalPages) loanPage = totalPages;
  const pageStart = (loanPage - 1) * loanPageSize;
  const pageTxns = txns.slice(pageStart, pageStart + loanPageSize);

  function th(col, label, align) {
    const active = loanSort.col === col;
    const arrow = active ? (loanSort.dir === 'asc' ? ' &uarr;' : ' &darr;') : '';
    const style = align ? `style="text-align:${align};cursor:pointer"` : 'style="cursor:pointer"';
    return `<th ${style} onclick="loanToggleSort('${col}')">${label}${arrow}</th>`;
  }

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <button class="back-btn" onclick="selectedFriend=null;loadFriends()">&larr; Back to Friends</button>
      <div class="summary-card" style="text-align:center">
        <div style="font-size:22px;font-weight:700">${f.name}</div>
        <div class="summary-amount" style="color:${balColorLight(balance)}">${balance < 0 ? '- ' : balance > 0 ? '+ ' : ''}${fmtCur(Math.abs(balance))}</div>
        <div class="summary-words">${balance<0?'You owe them':balance>0?'They owe you':'All settled'}</div>
        <div style="border-top:1px solid rgba(255,255,255,0.15);margin-top:16px;padding-top:16px">
          <div class="bal-split">
            <div><div style="font-size:11px;color:rgba(255,255,255,0.5)">You Paid</div><div style="font-family:var(--mono);font-weight:600;margin-top:4px">${fmtCur(totalPaid)}</div></div>
            <div><div style="font-size:11px;color:rgba(255,255,255,0.5)">You Received</div><div style="font-family:var(--mono);font-weight:600;margin-top:4px">${fmtCur(totalReceived)}</div></div>
          </div>
        </div>
      </div>

      <div class="filter-row" style="margin-bottom:16px">
        <button class="btn btn-p btn-sm" onclick="showLoanForm(${f.id})">+ Add Transaction</button>
        <button class="btn btn-s btn-sm" onclick="downloadFriendDetailPdf()">PDF</button>
        <select class="fi" style="width:110px;padding:6px 8px;font-size:13px" onchange="loanFilters.year=this.value;loanFilters.month='';loanFilters.date='';loanPage=1;renderFriendDetail()">${yearOpts}</select>
        <select class="fi" style="width:110px;padding:6px 8px;font-size:13px" onchange="loanFilters.month=this.value;loanFilters.date='';loanPage=1;renderFriendDetail()">${monthOpts}</select>
        <input class="fi" id="loanDate" type="date" value="${loanFilters.date}" style="width:140px;padding:6px 8px;font-size:13px" onchange="loanFilters.date=this.value;loanFilters.year='';loanFilters.month='';loanPage=1;renderFriendDetail()" placeholder="Exact date">
        <input class="fi" id="loanSearch" type="text" value="${loanFilters.search}" style="width:160px;padding:6px 8px;font-size:13px" oninput="loanFilters.search=this.value;loanPage=1;renderFriendDetail()" placeholder="Search details...">
        <div class="chip-group">
          ${['','paid','received'].map(t=>`<button class="chip ${loanFilters.type===t?'active':''}" onclick="loanFilters.type='${t}';loanPage=1;renderFriendDetail()">${t===''?'All':t==='paid'?'Paid':'Received'}</button>`).join('')}
        </div>
        ${isFiltered ? `<button class="chip" onclick="loanFilters={year:'',month:'',date:'',search:'',type:''};loanPage=1;renderFriendDetail()">Clear</button>` : ''}
      </div>

      ${isFiltered ? `<div style="font-size:12px;color:var(--t3);margin-bottom:8px">Showing ${txns.length} of ${_loanAllTxns.length} transactions &nbsp;|&nbsp; Paid: <span style="color:var(--red)">${fmtCur(fPaid)}</span> &nbsp; Received: <span style="color:var(--green)">${fmtCur(fReceived)}</span></div>` : ''}

      <div class="table-wrap"><table>
        <thead><tr>${th('date','Date')}${th('details','Details')}${th('paid','Paid','right')}${th('received','Received','right')}<th style="width:100px">Actions</th></tr></thead>
        <tbody>${pageTxns.length===0?'<tr><td colspan="5" class="empty-td">No transactions match the filters.</td></tr>':''}
          ${pageTxns.map(t=>`<tr>
            <td>${fmtDate(t.txn_date)}</td><td>${t.details}</td>
            <td class="td-m" style="color:${t.paid>0?'var(--red)':'var(--t3)'}">${t.paid>0?fmtCur(t.paid):'-'}</td>
            <td class="td-m" style="color:${t.received>0?'var(--green)':'var(--t3)'}">${t.received>0?fmtCur(t.received):'-'}</td>
            <td><button class="btn-d" style="color:var(--em)" onclick="showLoanForm(${f.id},${t.id})">Edit</button> <button class="btn-d" onclick="deleteLoan(${t.id})">Del</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      ${totalPages > 1 ? `<div class="pagination">
        <button class="pg-btn" ${loanPage<=1?'disabled':''} onclick="loanGoPage(${loanPage-1})">&larr; Prev</button>
        <div class="pg-info">
          <span class="pg-range">${pageStart+1}&ndash;${Math.min(pageStart+loanPageSize,txns.length)} of ${txns.length}</span>
          <div class="pg-pages">${paginationPages(loanPage,totalPages).map(p=>p==='...'?'<span class="pg-ellipsis">...</span>':`<button class="pg-num ${p===loanPage?'active':''}" onclick="loanGoPage(${p})">${p}</button>`).join('')}</div>
        </div>
        <button class="pg-btn" ${loanPage>=totalPages?'disabled':''} onclick="loanGoPage(${loanPage+1})">Next &rarr;</button>
      </div>` : ''}
    </div>`;

  // Restore focus on search
  const ls = document.getElementById('loanSearch');
  if (ls && document.activeElement?.id === 'loanSearch') ls.focus();
}

function loanToggleSort(col) {
  if (loanSort.col === col) loanSort.dir = loanSort.dir === 'asc' ? 'desc' : 'asc';
  else { loanSort.col = col; loanSort.dir = col === 'date' ? 'desc' : 'asc'; }
  loanPage = 1;
  renderFriendDetail();
}

function loanGoPage(p) {
  loanPage = p;
  renderFriendDetail();
}

async function showLoanForm(friendId, txnId) {
  const isEdit = !!txnId;
  let t = { txn_date: todayStr(), details: '', paid: 0, received: 0 };

  if (isEdit) {
    const data = await api(`/api/loans/${friendId}`);
    const found = (data?.transactions || []).find((x) => String(x.id) === String(txnId));
    if (found) t = found;
  }

  openModal(isEdit ? 'Edit Transaction' : 'Add Transaction', `
    <div class="fg">
      <label class="fl">Date<input class="fi" type="date" id="lDate" value="${normalizeInputDate(t.txn_date) || todayStr()}"></label>
      <label class="fl">Details *<input class="fi" id="lDetails" value="${escHtml(t.details || '')}" placeholder="e.g. Dinner..." autofocus></label>
      <label class="fl">Paid (you gave)<input class="fi" type="number" step="0.01" id="lPaid" value="${t.paid}" placeholder="0.00"></label>
      <label class="fl">Received (you got)<input class="fi" type="number" step="0.01" id="lReceived" value="${t.received}" placeholder="0.00"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveLoan(${friendId},${txnId||'null'})">${isEdit?'Update':'Save'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveLoan(friendId, txnId) {
  const paid = Number(document.getElementById('lPaid').value || 0);
  const received = Number(document.getElementById('lReceived').value || 0);
  const body = {
    friend_id: friendId,
    txn_date: normalizeInputDate(document.getElementById('lDate').value),
    details: document.getElementById('lDetails').value.trim(),
    paid,
    received,
  };
  if (!body.details) { toast('Enter details', 'warning'); return; }
  if (!body.txn_date) { toast('Select a valid date', 'warning'); return; }
  if (!Number.isFinite(body.paid) || body.paid < 0 || !Number.isFinite(body.received) || body.received < 0) {
    toast('Paid/Received must be 0 or more', 'warning');
    return;
  }
  if (body.paid === 0 && body.received === 0) { toast('Enter paid or received amount', 'warning'); return; }
  if (txnId) await api(`/api/loans/${txnId}`, { method: 'PUT', body });
  else await api('/api/loans', { method: 'POST', body });
  closeModal(); loadFriendDetail(true);
}

async function deleteLoan(id) {
  if (!await confirmDialog('Delete this transaction?')) return;
  await api(`/api/loans/${id}`, { method: 'DELETE' });
  loadFriendDetail(true);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DIVIDE EXPENSES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _divFriends = [];       // loaded once, reused in render
let _divEditIdx = null;     // index being edited, null = new
let _divGroups = [];        // saved groups from DB
let _divExpandedId = null;  // which group row is expanded
let _divSharedGroups = [];  // received shared groups
let _divSharedExpandedId = null;
let divideSplitMode = 'equal'; // 'equal'|'percent'|'fraction'|'amount'|'parts'
let divideSplitValues = {};    // personKey â†’ numeric value for non-equal modes

const SPLIT_MODES = [
  { key: 'equal',    label: 'Equal' },
  { key: 'percent',  label: '% Percent' },
  { key: 'fraction', label: 'Fraction' },
  { key: 'amount',   label: 'Direct &#8377;' },
  { key: 'parts',    label: 'Parts/Ratio' },
];

function _normalizeDivideDraftItem(item) {
  if (!item || typeof item !== 'object') return null;
  const personShares = Array.isArray(item.personShares)
    ? item.personShares.map((ps) => ({
        key: String(ps?.key ?? ''),
        name: String(ps?.name ?? ''),
        share: Math.round((Number(ps?.share || 0)) * 100) / 100,
      })).filter((ps) => ps.key && ps.name)
    : [];
  return {
    date: normalizeInputDate(item.date) || todayStr(),
    details: String(item.details || ''),
    amount: Math.round((Number(item.amount || 0)) * 100) / 100,
    paidById: String(item.paidById ?? 'self'),
    paidByName: String(item.paidByName || 'You'),
    splitMode: SPLIT_MODES.some((mode) => mode.key === item.splitMode) ? item.splitMode : 'equal',
    personShares,
    friendIds: Array.isArray(item.friendIds) ? item.friendIds.map((id) => String(id)) : personShares.filter((ps) => ps.key !== 'self').map((ps) => String(ps.key)),
    selfIncluded: Array.isArray(item.personShares) ? personShares.some((ps) => ps.key === 'self') : !!item.selfIncluded,
    friendNames: Array.isArray(item.friendNames) ? item.friendNames.map((name) => String(name)) : personShares.map((ps) => ps.name),
    perPerson: Math.round((Number(item.perPerson || 0)) * 100) / 100,
    ccInfo: item.ccInfo && typeof item.ccInfo === 'object'
      ? {
          cardId: Number(item.ccInfo.cardId) || null,
          discountPct: Number(item.ccInfo.discountPct) || 0,
          cardName: String(item.ccInfo.cardName || ''),
        }
      : null,
  };
}

function _loadDivideDraftItems() {
  try {
    const raw = localStorage.getItem(DIVIDE_DRAFT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(_normalizeDivideDraftItem).filter((item) => item && item.details && item.amount > 0);
  } catch (_) {
    return [];
  }
}

function _rehydrateDivideDraft(force = false) {
  if (!force && Array.isArray(divideItems) && divideItems.length) return divideItems;
  divideItems = _loadDivideDraftItems();
  return divideItems;
}

function _saveDivideDraftItems() {
  try {
    if (!divideItems.length) {
      localStorage.removeItem(DIVIDE_DRAFT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(DIVIDE_DRAFT_STORAGE_KEY, JSON.stringify(divideItems.map(_normalizeDivideDraftItem).filter(Boolean)));
  } catch (_) {}
}

function _selectedPeople() {
  return [...divideSelected].map(id => {
    if (id === 'self') return { key: 'self', name: 'You' };
    const f = _divFriends.find(f => f.id == id);
    return { key: id, name: f?.name || '?' };
  });
}

function _autoFillSplitValues(mode, people, amt) {
  const values = {};
  const n = people.length;
  if (n === 0) return values;
  if (mode === 'percent') {
    const share = Math.floor(100 / n);
    const rem = 100 - share * n;
    people.forEach((p, i) => { values[p.key] = i === 0 ? share + rem : share; });
  } else if (mode === 'fraction') {
    people.forEach(p => { values[p.key] = parseFloat((1 / n).toFixed(4)); });
  } else if (mode === 'amount') {
    const share = Math.floor((amt / n) * 100) / 100;
    const rem = Math.round((amt - share * n) * 100) / 100;
    people.forEach((p, i) => { values[p.key] = i === 0 ? Math.round((share + rem) * 100) / 100 : share; });
  } else if (mode === 'parts') {
    people.forEach(p => { values[p.key] = 1; });
  }
  return values;
}

function _restoreSplitValues(mode, personShares, amt) {
  const values = {};
  if (!Array.isArray(personShares) || !personShares.length || !amt || mode === 'equal') return values;
  personShares.forEach((ps) => {
    const key = String(ps.key);
    const share = parseFloat(ps.share) || 0;
    if (mode === 'percent') values[key] = Math.round((share / amt) * 10000) / 100;
    else if (mode === 'fraction') values[key] = Math.round((share / amt) * 10000) / 10000;
    else if (mode === 'amount') values[key] = share;
    else if (mode === 'parts') values[key] = share;
  });
  return values;
}

function computeShares(amt, mode, people, values) {
  if (people.length === 0) return { valid: false, error: 'No people selected', shares: [] };
  const n = people.length;
  if (mode === 'equal') {
    const pp = Math.round((amt / n) * 100) / 100;
    return { valid: true, error: null, shares: people.map(p => ({ key: p.key, name: p.name, share: pp })) };
  }
  if (mode === 'percent') {
    const total = people.reduce((s, p) => s + (parseFloat(values[p.key]) || 0), 0);
    if (Math.abs(total - 100) > 0.01) return { valid: false, error: `% total is ${total.toFixed(1)}%, must be 100%`, shares: [] };
    return { valid: true, error: null, shares: people.map(p => ({ key: p.key, name: p.name, share: Math.round(amt * (parseFloat(values[p.key]) / 100) * 100) / 100 })) };
  }
  if (mode === 'fraction') {
    const total = people.reduce((s, p) => s + (parseFloat(values[p.key]) || 0), 0);
    if (Math.abs(total - 1) > 0.001) return { valid: false, error: `Fractions total is ${total.toFixed(4)}, must equal 1.0`, shares: [] };
    return { valid: true, error: null, shares: people.map(p => ({ key: p.key, name: p.name, share: Math.round(amt * (parseFloat(values[p.key]) || 0) * 100) / 100 })) };
  }
  if (mode === 'amount') {
    const total = people.reduce((s, p) => s + (parseFloat(values[p.key]) || 0), 0);
    if (Math.abs(total - amt) > 0.01) return { valid: false, error: `Sum is ${fmtCur(total)}, must equal ${fmtCur(amt)}`, shares: [] };
    return { valid: true, error: null, shares: people.map(p => ({ key: p.key, name: p.name, share: parseFloat(values[p.key]) || 0 })) };
  }
  if (mode === 'parts') {
    const totalParts = people.reduce((s, p) => s + (parseFloat(values[p.key]) || 0), 0);
    if (totalParts <= 0) return { valid: false, error: 'Total parts must be > 0', shares: [] };
    return { valid: true, error: null, shares: people.map(p => ({ key: p.key, name: p.name, share: Math.round(amt * ((parseFloat(values[p.key]) || 0) / totalParts) * 100) / 100 })) };
  }
  return { valid: false, error: 'Unknown mode', shares: [] };
}

function selectSplitMode(mode) {
  divideSplitMode = mode;
  divideSplitValues = {};
  const amt = parseFloat(document.getElementById('dAmount')?.value || 0);
  const people = _selectedPeople();
  if (people.length > 0 && amt > 0) divideSplitValues = _autoFillSplitValues(mode, people, amt);
  // Update chip styles
  document.querySelectorAll('.split-mode-chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
  updateDivSplitInputs();
}

async function loadDivide() {
  _rehydrateDivideDraft(true);
  const [fData, dData, sharedData] = await Promise.all([api('/api/friends'), api('/api/divide'), api('/api/divide/shared')]);
  _divFriends = fData?.friends || [];
  _divGroups = dData?.groups || [];
  _divSharedGroups = sharedData?.groups || [];
  renderDivide();
}

async function renderDivide() {
  _rehydrateDivideDraft();
  await getCcCardsForForm();
  const friends = _divFriends;
  const editItem = _divEditIdx !== null ? divideItems[_divEditIdx] : null;

  // â”€â”€ Form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const paidByChips = [
    `<button class="chip ${dividePaidBy==='self'?'active':''}" onclick="selectPaidBy(this,'self')">You</button>`,
    ...friends.map(f => `<button class="chip ${dividePaidBy==f.id?'active':''}" onclick="selectPaidBy(this,'${f.id}')">${f.name}</button>`)
  ].join('');

  const friendChips = [
    `<button class="fr-chip ${divideSelected.has('self')?'sel':''}" onclick="toggleDivFriend('self')">
      <span class="cbox ${divideSelected.has('self')?'chk':''}">${divideSelected.has('self')?'&#10003;':''}</span>You
    </button>`,
    ...friends.map(f => `<button class="fr-chip ${divideSelected.has(String(f.id))?'sel':''}" onclick="toggleDivFriend(${f.id})">
        <span class="cbox ${divideSelected.has(String(f.id))?'chk':''}">${divideSelected.has(String(f.id))?'&#10003;':''}</span>${f.name}
      </button>`)
  ].join('');

  const splitModeChips = SPLIT_MODES.map(m =>
    `<button class="chip split-mode-chip ${divideSplitMode===m.key?'active':''}" data-mode="${m.key}" onclick="selectSplitMode('${m.key}')">${m.label}</button>`
  ).join('');

  // â”€â”€ Items table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let itemsTable = '';
  if (divideItems.length > 0) {
    const rows = divideItems.map((item, i) => {
      const editing = _divEditIdx === i;
      const modeLabel = item.splitMode && item.splitMode !== 'equal' ? ` <span style="font-size:10px;color:var(--t3)">(${item.splitMode})</span>` : '';
      const ccBadge = item.ccInfo ? ` <span style="font-size:10px;background:var(--blue-l);color:var(--blue);border-radius:99px;padding:1px 7px;font-weight:600">CC ${item.ccInfo.cardName}</span>` : '';
      return `<tr style="${editing ? 'background:var(--blue-l)' : ''}">
        <td>${fmtDate(item.date)}</td>
        <td>${item.details}${ccBadge}</td>
        <td style="font-weight:600">${item.paidByName}</td>
        <td class="td-m">${fmtCur(item.amount)}${modeLabel}</td>
        <td style="font-size:12px;color:var(--t2)">${item.friendNames.join(', ')}</td>
        <td>
          <button class="btn-d" style="color:var(--em)" onclick="editDivItem(${i})">Edit</button>
          <button class="btn-d" onclick="removeDivItem(${i})">Del</button>
        </td>
      </tr>`;
    }).join('');

    const totAmt = divideItems.reduce((s,i) => s+i.amount, 0);
    itemsTable = `
      <div style="margin-top:20px">
        <div style="font-size:14px;font-weight:700;margin-bottom:10px">Items Added
          <span style="font-size:12px;font-weight:400;color:var(--t3);margin-left:8px">Total: <b style="color:var(--t1)">${fmtCur(totAmt)}</b></span>
          <button class="btn btn-g btn-sm" style="float:right" onclick="clearDivForm()">Clear All</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Details</th><th>Paid By</th><th class="td-m">Amount</th><th>Divide Among</th><th style="width:90px">Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>`;
  }

  // â”€â”€ Summary table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let summaryTable = '';
  if (divideItems.length > 0) {
    // Collect all participants (each unique friendId that appears in any item)
    const peopleMap = {}; // friendId/key â†’ { name, totalShare, totalGave }

    divideItems.forEach(item => {
      // Use personShares for accurate per-person amounts (supports all split modes)
      if (item.personShares && item.personShares.length > 0) {
        item.personShares.forEach(ps => {
          if (!peopleMap[ps.key]) peopleMap[ps.key] = { name: ps.name, totalShare: 0, totalGave: 0 };
          peopleMap[ps.key].totalShare += ps.share;
        });
      } else {
        // Fallback for legacy items without personShares
        item.friendIds.forEach(fid => {
          if (!peopleMap[fid]) {
            const fn = friends.find(f => f.id == fid);
            peopleMap[fid] = { name: fn?.name || '?', totalShare: 0, totalGave: 0 };
          }
          peopleMap[fid].totalShare += item.perPerson;
        });
        if (item.selfIncluded) {
          if (!peopleMap['self']) peopleMap['self'] = { name: 'You', totalShare: 0, totalGave: 0 };
          peopleMap['self'].totalShare += item.perPerson;
        }
      }
      // Track who paid
      const payerKey = item.paidById;
      if (payerKey !== undefined && payerKey !== null) {
        if (!peopleMap[payerKey]) {
          const fn = payerKey === 'self' ? { name: 'You' } : friends.find(f => f.id == payerKey);
          peopleMap[payerKey] = { name: fn?.name || '?', totalShare: 0, totalGave: 0 };
        }
        peopleMap[payerKey].totalGave += item.amount;
      }
    });

    // Sort: self first, then friends
    const entries = Object.entries(peopleMap).sort(([a],[b]) => a === 'self' ? -1 : b === 'self' ? 1 : 0);
    const summaryRows = entries.map(([key, p]) => {
      const isSelf = key === 'self';
      // For self: pending = totalGave - totalShare (positive = you overpaid, negative = you owe net)
      // For others: pending = totalShare - totalGave (positive = they owe you, negative = you owe them)
      const pending = isSelf
        ? p.totalGave - p.totalShare
        : p.totalShare - p.totalGave;
      const pendingColor = pending > 0.005 ? 'var(--green)' : pending < -0.005 ? 'var(--red)' : 'var(--t3)';
      const pendingLabel = isSelf
        ? (pending > 0.005 ? `+${fmtCur(pending)} net paid` : pending < -0.005 ? `${fmtCur(Math.abs(pending))} net owe` : 'Settled')
        : (pending > 0.005 ? `${fmtCur(pending)} owes you` : pending < -0.005 ? `${fmtCur(Math.abs(pending))} you owe` : 'Settled');
      return `<tr style="${isSelf ? 'background:var(--blue-l);font-style:italic' : ''}">
        <td style="font-weight:600">${p.name}${isSelf ? ' (me)' : ''}</td>
        <td class="td-m">${p.totalShare > 0 ? fmtCur(p.totalShare) : '-'}</td>
        <td class="td-m" style="color:var(--green)">${p.totalGave > 0 ? fmtCur(p.totalGave) : '-'}</td>
        <td class="td-m" style="font-weight:600;color:${pendingColor}">${pendingLabel}</td>
      </tr>`;
    }).join('');

    if (entries.length > 0) {
      summaryTable = `
        <div style="margin-top:20px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="font-size:14px;font-weight:700">Settlement Summary</div>
            <button class="btn btn-p btn-sm" onclick="showSaveDivideModal()">Save to Database</button>
          </div>
          <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th class="td-m">Total Had to Pay</th><th class="td-m">They Gave</th><th class="td-m">Pending</th></tr></thead>
            <tbody>${summaryRows}</tbody>
          </table></div>
        </div>`;
    }
  }

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="font-size:20px;font-weight:700;margin-bottom:16px">Split Expenses</div>
      <div class="card">
        <div class="card-title">${_divEditIdx !== null ? 'Edit Item' : 'Add Item'}</div>
        <div class="fg">
          <label class="fl">Date<input class="fi" type="date" id="dDate" value="${editItem?.date || todayStr()}"></label>
          <label class="fl">Amount (&#8377;)<input class="fi" type="number" step="0.01" id="dAmount" value="${editItem?.amount || ''}" placeholder="0.00" oninput="updateDivSplitInputs();divCcPreview()"></label>
          <label class="fl full">Details *<input class="fi" id="dDetails" value="${editItem?.details || ''}" placeholder="e.g. Dinner at restaurant..."></label>
        </div>
        <div style="margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:8px">Paid By</div>
          <div id="paidByChips">${paidByChips}</div>
        </div>
        <div style="margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:8px">Divide Between</div>
          <div id="divideFriends">${friendChips}</div>
        </div>
        <div style="margin-bottom:12px">
          <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:6px">Split Mode</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${splitModeChips}</div>
        </div>
        <div id="divSplitInputs"></div>
        ${dividePaidBy === 'self' ? `<div id="divCcWrap">${_buildDivCcSection(editItem?.ccInfo)}</div>` : '<div id="divCcWrap"></div>'}
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-p" onclick="addDivItem()">${_divEditIdx !== null ? 'Update Item' : 'Add Item'}</button>
          ${_divEditIdx !== null ? `<button class="btn btn-g" onclick="_divEditIdx=null;divideSelected=new Set();dividePaidBy='self';renderDivide()">Cancel Edit</button>` : ''}
        </div>
      </div>
      ${itemsTable}
      ${summaryTable}
      ${renderDivHistory()}
      ${renderSharedDivHistory()}
    </div>`;

  updateDivSplitInputs();
}

// Build sessions: group by session_id; legacy rows (no session_id) are individual sessions
function _buildSessions() {
  const sessions = [];
  const seen = {};
  for (const g of _divGroups) {
    const key = g.session_id || `_solo_${g.id}`;
    if (!seen[key]) {
      seen[key] = { key, heading: g.heading || g.details, date: g.divide_date, items: [] };
      sessions.push(seen[key]);
    }
    seen[key].items.push(g);
  }
  return sessions;
}

// Render the split breakdown table for one group item
function _splitBreakdownTable(g) {
  const splits = g.splits || [];
  const friendsTotal = splits.reduce((s, x) => s + x.share_amount, 0);
  const myShare = Math.round((g.total_amount - friendsTotal) * 100) / 100;
  const paidByYou = g.paid_by === 'You';
  const allP = [...splits.map(s => ({ name: s.friend_name, share: s.share_amount, isMe: false }))];
  if (myShare > 0.005) allP.unshift({ name: 'You (me)', share: myShare, isMe: true });
  return `
    <table style="width:100%;font-size:12px;margin-top:6px">
      <thead><tr style="background:transparent">
        <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--t2)">Person</th>
        <th style="text-align:right;padding:4px 8px;font-size:11px;color:var(--t2)">Share</th>
        <th style="text-align:right;padding:4px 8px;font-size:11px;color:var(--t2)">Paid Upfront</th>
        <th style="text-align:right;padding:4px 8px;font-size:11px;color:var(--t2)">Owes / Gets Back</th>
      </tr></thead>
      <tbody>
        ${allP.map(p => {
          const isPayer = (p.isMe && paidByYou) || (!p.isMe && g.paid_by === p.name);
          const paidUp = isPayer ? g.total_amount : 0;
          const net = p.share - paidUp;
          const netLabel = Math.abs(net) < 0.005 ? `<span style="color:var(--t3)">Settled</span>`
            : net > 0 ? `<span style="color:var(--red)">Owes ${fmtCur(net)}</span>`
            : `<span style="color:var(--green)">Gets back ${fmtCur(Math.abs(net))}</span>`;
          return `<tr style="border-top:1px solid var(--border-l);${p.isMe?'background:var(--blue-l);font-style:italic':''}">
            <td style="padding:5px 8px;font-weight:${p.isMe?'700':'500'}">${p.name}</td>
            <td style="padding:5px 8px;text-align:right;font-family:var(--mono)">${fmtCur(p.share)}</td>
            <td style="padding:5px 8px;text-align:right;font-family:var(--mono);color:var(--green)">${isPayer ? fmtCur(paidUp) : '-'}</td>
            <td style="padding:5px 8px;text-align:right">${netLabel}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot><tr style="border-top:2px solid var(--border);font-weight:700">
        <td style="padding:5px 8px">Total</td>
        <td style="padding:5px 8px;text-align:right;font-family:var(--mono)">${fmtCur(g.total_amount)}</td>
        <td style="padding:5px 8px;text-align:right;font-family:var(--mono);color:var(--green)">${fmtCur(g.total_amount)}</td>
        <td></td>
      </tr></tfoot>
    </table>`;
}

function _buildDivGroupRows() {
  const sessions = _buildSessions();
  return sessions.map(sess => {
    const isOpen = _divExpandedId === sess.key;
    const sessionTotal = sess.items.reduce((s, g) => s + g.total_amount, 0);
    const isSingle = sess.items.length === 1;

    const expandDetail = isOpen ? `
      <tr>
        <td colspan="5" style="padding:0">
          <div style="padding:14px 16px 18px;background:var(--bg-alt);border-bottom:1px solid var(--border)">
            ${sess.items.map(g => `
              <div style="margin-bottom:${sess.items.length > 1 ? '18px' : '0'}">
                ${sess.items.length > 1 ? `
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                    <div style="font-size:12px;font-weight:600;color:var(--t1)">${g.details}
                      <span style="font-size:11px;font-weight:400;color:var(--t3);margin-left:6px">Paid by ${g.paid_by} &middot; ${fmtDate(g.divide_date)} &middot; ${fmtCur(g.total_amount)}</span>
                    </div>
                    <button class="btn-d" style="color:var(--red);font-size:11px" onclick="deleteDivGroup(${g.id})">Del</button>
                  </div>` : `
                  <div style="font-size:11px;font-weight:600;color:var(--t2);margin-bottom:6px;letter-spacing:.4px">SPLIT BREAKDOWN</div>`}
                ${_splitBreakdownTable(g)}
              </div>`).join('')}
          </div>
        </td>
      </tr>` : '';

    const toggle = `_divExpandedId=${isOpen ? 'null' : `'${sess.key}'`};document.getElementById('divHistoryBody').innerHTML=_buildDivGroupRows().join('')`;
    const deleteBtn = isSingle
      ? `<button class="btn-d" style="color:var(--red)" onclick="deleteDivGroup(${sess.items[0].id})">Del</button>`
      : `<button class="btn-d" style="color:var(--red)" onclick="deleteSession('${sess.key}')">Del All</button>`;
    const participantFriends = _getSessionParticipantFriends(sess.key);
    const linkedParticipants = participantFriends.filter((friend) => friend.linked_user_id);
    const sharedFriendIds = [...new Set(sess.items.flatMap((group) => (group.shared_targets || []).map((target) => Number(target.friend_id)).filter((id) => Number.isFinite(id) && id > 0)))];
    const shareBtn = linkedParticipants.length
      ? `<button class="btn-d" style="color:var(--blue)" onclick="event.stopPropagation();showDivideShareModal('${sess.key}')">${sharedFriendIds.length ? `Shared (${sharedFriendIds.length})` : 'Share'}</button>`
      : `<span style="font-size:11px;color:var(--t3);margin-right:6px">No linked friends</span>`;

    return `<tr style="cursor:pointer" onclick="${toggle}">
        <td>${fmtDate(sess.date)}</td>
        <td style="font-weight:600">${sess.heading || sess.items[0].details}${sess.items.length > 1 ? ` <span style="font-size:11px;font-weight:400;color:var(--t3)">(${sess.items.length} items)</span>` : ''}</td>
        <td style="color:var(--t2);font-size:13px">${isSingle ? sess.items[0].paid_by : [...new Set(sess.items.map(g=>g.paid_by))].join(', ')}</td>
        <td class="td-m" style="font-weight:600">${fmtCur(sessionTotal)}</td>
        <td style="text-align:right;white-space:nowrap">
          <span style="color:var(--t3);font-size:13px;margin-right:8px">${isOpen ? '-' : '+'}</span>
          ${shareBtn}
          <button class="btn-d" style="color:var(--t2)" onclick="event.stopPropagation();downloadSplitSessionPdf('${sess.key}')">PDF</button>
          ${deleteBtn}
        </td>
      </tr>${expandDetail}`;
  });
}

function _getSessionParticipantFriends(sessionKey) {
  const groups = _divGroups.filter((g) => (g.session_id || `_solo_${g.id}`) === sessionKey);
  const friendIds = [...new Set(groups.flatMap((g) => (g.splits || []).map((split) => Number(split.friend_id)).filter((id) => Number.isFinite(id) && id > 0)))];
  return friendIds
    .map((friendId) => _divFriends.find((friend) => Number(friend.id) === Number(friendId)))
    .filter(Boolean);
}

async function showDivideShareModal(sessionKey) {
  const friends = _getSessionParticipantFriends(sessionKey);
  const linkedFriends = friends.filter((friend) => friend.linked_user_id);
  const groups = _divGroups.filter((g) => (g.session_id || `_solo_${g.id}`) === sessionKey);
  const sharedFriendIds = [...new Set(groups.flatMap((group) => (group.shared_targets || []).map((target) => Number(target.friend_id)).filter((id) => Number.isFinite(id) && id > 0)))];
  const friendRows = linkedFriends.map((friend) => `
    <label style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-top:1px solid var(--br)">
      <input type="checkbox" class="divide-share-friend" value="${friend.id}" ${sharedFriendIds.includes(Number(friend.id)) ? 'checked' : ''}>
      <span style="flex:1">
        <span style="font-size:13px;font-weight:600;color:var(--t1)">${escHtml(friend.name)}</span>
        <span style="display:block;font-size:11px;color:var(--t3);margin-top:2px">Linked to ${escHtml(friend.linked_user_display_name || friend.linked_user_username || 'app user')}${friend.linked_user_username ? ` (@${escHtml(friend.linked_user_username)})` : ''}</span>
      </span>
    </label>`).join('');
  const unlinkedCount = friends.length - linkedFriends.length;
  openModal('Share Saved Split', `
    <div style="font-size:13px;color:var(--t2);margin-bottom:14px">Choose which linked friends should receive this saved split session in their profile. They can view the breakdown and hide it from their side whenever they want.</div>
    ${linkedFriends.length ? `
      <div style="border:1px solid var(--br);border-radius:12px;padding:0 12px;background:var(--bg2)">
        ${friendRows}
      </div>` : `<div style="background:var(--bg2);border-radius:10px;padding:12px;font-size:12px;color:var(--t2)">No linked participant friends found for this session yet.</div>`}
    ${unlinkedCount > 0 ? `<div style="font-size:12px;color:var(--t3);margin-top:10px">${unlinkedCount} participant${unlinkedCount !== 1 ? 's are' : ' is'} not linked to an app account yet, so sharing is not available for them.</div>` : ''}
    <div class="fa" style="margin-top:18px">
      <button class="btn btn-p" onclick="saveDivideShareSession('${String(sessionKey).replace(/'/g, "\\'")}')">Save Sharing</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveDivideShareSession(sessionKey) {
  const friendIds = [...document.querySelectorAll('.divide-share-friend:checked')].map((input) => Number(input.value)).filter((id) => Number.isFinite(id) && id > 0);
  const res = await api('/api/divide/share-session', { method: 'POST', body: { session_key: sessionKey, friend_ids: friendIds } });
  if (res?.success) {
    closeModal();
    const dData = await api('/api/divide');
    _divGroups = dData?.groups || [];
    _refreshDivHistory();
    toast(friendIds.length ? 'Split session sharing updated' : 'Split session unshared', 'success');
  } else {
    toast(res?.error || 'Failed to save sharing', 'error');
  }
}

async function deleteDivGroup(id) {
  if (!await confirmDialog('Delete this item?')) return;
  const res = await api(`/api/divide/${id}`, { method: 'DELETE' });
  if (res?.success) {
    _divGroups = _divGroups.filter(g => g.id !== id);
    _refreshDivHistory();
    toast('Item deleted', 'success');
  } else {
    toast(res?.error || 'Delete failed', 'error');
  }
}

async function deleteSession(sessionKey) {
  const items = _divGroups.filter(g => (g.session_id || `_solo_${g.id}`) === sessionKey);
  if (!await confirmDialog(`Delete all ${items.length} items in this session?`)) return;
  for (const g of items) await api(`/api/divide/${g.id}`, { method: 'DELETE' });
  _divGroups = _divGroups.filter(g => (g.session_id || `_solo_${g.id}`) !== sessionKey);
  _refreshDivHistory();
  toast(`${items.length} item(s) deleted`, 'success');
}

function _refreshDivHistory() {
  if (_divExpandedId) {
    const stillExists = _divGroups.some(g => (g.session_id || `_solo_${g.id}`) === _divExpandedId);
    if (!stillExists) _divExpandedId = null;
  }
  const body = document.getElementById('divHistoryBody');
  if (body) body.innerHTML = _buildDivGroupRows().join('');
  const lbl = document.querySelector('#divHistorySection .div-hist-count');
  if (lbl) lbl.textContent = `${_buildSessions().length} session${_buildSessions().length !== 1 ? 's' : ''}, ${_divGroups.length} item${_divGroups.length !== 1 ? 's' : ''}`;
}

function renderDivHistory() {
  const sessions = _buildSessions();
  return `
    <div style="margin-top:28px" id="divHistorySection">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:14px;font-weight:700">Saved Splits History
          <span class="div-hist-count" style="font-size:12px;font-weight:400;color:var(--t3);margin-left:8px">${sessions.length} session${sessions.length !== 1 ? 's' : ''}, ${_divGroups.length} item${_divGroups.length !== 1 ? 's' : ''}</span>
        </div>
        <button class="btn btn-s btn-sm" onclick="downloadSplitHistoryPdf()">PDF</button>
      </div>
      ${_divGroups.length ? `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Date</th><th>Heading / Details</th><th>Paid By</th>
          <th class="td-m">Total</th><th style="width:110px;text-align:right"></th>
        </tr></thead>
        <tbody id="divHistoryBody">${_buildDivGroupRows().join('')}</tbody>
      </table></div>` : `
      <div class="card" style="text-align:center;color:var(--t3);padding:24px 18px">
        No saved split history yet.
      </div>`}
    </div>`;
}

function _buildSharedSessions() {
  const sessions = [];
  const seen = {};
  for (const group of _divSharedGroups) {
    const sessionKey = group.session_id || `_solo_${group.id}`;
    const key = `${group.owner_user_id}:${sessionKey}`;
    if (!seen[key]) {
      seen[key] = {
        key,
        session_key: sessionKey,
        owner_user_id: Number(group.owner_user_id),
        owner_name: group.owner_name,
        heading: group.heading || group.details,
        date: group.divide_date,
        items: [],
      };
      sessions.push(seen[key]);
    }
    seen[key].items.push(group);
  }
  return sessions;
}

function _sharedSessionTotal(session) {
  return session.items.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
}

function _sharedSessionSummaryRows(session) {
  const totals = new Map();
  session.items.forEach((group) => {
    _sharedDividePersonRows(group).forEach((person) => {
      const key = String(person.name || '');
      const current = totals.get(key) || { name: person.name, share: 0, paid: 0, isTarget: false };
      current.share += Number(person.share || 0);
      current.paid += Number(person.paid || 0);
      current.isTarget = current.isTarget || !!person.isTarget;
      totals.set(key, current);
    });
  });
  return [...totals.values()];
}

function _sharedSplitBreakdownTable(group) {
  const rows = _sharedDividePersonRows(group);
  return `
    <table style="width:100%;font-size:12px;margin-top:6px">
      <thead><tr style="background:transparent">
        <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--t2)">Person</th>
        <th style="text-align:right;padding:4px 8px;font-size:11px;color:var(--t2)">Share</th>
        <th style="text-align:right;padding:4px 8px;font-size:11px;color:var(--t2)">Paid Upfront</th>
        <th style="text-align:right;padding:4px 8px;font-size:11px;color:var(--t2)">Owes / Gets Back</th>
      </tr></thead>
      <tbody>
        ${rows.map((person) => {
          const net = Number(person.share || 0) - Number(person.paid || 0);
          const netLabel = Math.abs(net) < 0.005 ? `<span style="color:var(--t3)">Settled</span>`
            : net > 0 ? `<span style="color:var(--red)">Owes ${fmtCur(net)}</span>`
            : `<span style="color:var(--green)">Gets back ${fmtCur(Math.abs(net))}</span>`;
          return `<tr style="border-top:1px solid var(--border-l);${person.isTarget ? 'background:var(--blue-l);font-style:italic' : ''}">
            <td style="padding:5px 8px;font-weight:${person.isTarget ? '700' : '500'}">${escHtml(person.name)}${person.isTarget ? ' (you)' : ''}</td>
            <td style="padding:5px 8px;text-align:right;font-family:var(--mono)">${fmtCur(person.share || 0)}</td>
            <td style="padding:5px 8px;text-align:right;font-family:var(--mono);color:var(--green)">${person.paid ? fmtCur(person.paid) : '-'}</td>
            <td style="padding:5px 8px;text-align:right">${netLabel}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function _buildSharedGroupRows() {
  const sessions = _buildSharedSessions();
  return sessions.map((session) => {
    const isOpen = _divSharedExpandedId === session.key;
    const total = _sharedSessionTotal(session);
    const paidByText = [...new Set(session.items.map((item) => item.paid_by))].join(', ');
    const expandDetail = isOpen ? `
      <tr>
        <td colspan="5" style="padding:0">
          <div style="padding:14px 16px 18px;background:var(--bg-alt);border-bottom:1px solid var(--border)">
            ${session.items.map((group) => `
              <div style="margin-bottom:${session.items.length > 1 ? '18px' : '0'}">
                ${session.items.length > 1 ? `
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                    <div style="font-size:12px;font-weight:600;color:var(--t1)">${escHtml(group.details)}
                      <span style="font-size:11px;font-weight:400;color:var(--t3);margin-left:6px">Shared by ${escHtml(session.owner_name || 'Unknown')} · Paid by ${escHtml(group.paid_by || 'Unknown')} · ${fmtDate(group.divide_date)} · ${fmtCur(group.total_amount || 0)}</span>
                    </div>
                  </div>` : `
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                    <div style="font-size:11px;font-weight:600;color:var(--t2);letter-spacing:.4px">SHARED SPLIT BREAKDOWN</div>
                    <button class="btn-d" style="color:var(--red);font-size:11px" onclick="hideSharedDivideSession(${session.owner_user_id}, '${String(session.session_key).replace(/'/g, "\\'")}')">Hide</button>
                  </div>`}
                ${_sharedSplitBreakdownTable(group)}
              </div>`).join('')}
            <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
              <div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px;letter-spacing:.3px">SESSION TOTAL</div>
              <div class="table-wrap"><table>
                <thead><tr><th>Name</th><th class="td-m">Share</th><th class="td-m">Paid</th><th class="td-m">Difference</th></tr></thead>
                <tbody>
                  ${_sharedSessionSummaryRows(session).map((person) => {
                    const net = Number(person.share || 0) - Number(person.paid || 0);
                    const diffLabel = Math.abs(net) < 0.005 ? 'Settled' : net > 0 ? `Owes ${fmtCur(net)}` : `Owed ${fmtCur(Math.abs(net))}`;
                    const diffColor = Math.abs(net) < 0.005 ? 'var(--t3)' : net > 0 ? 'var(--red)' : 'var(--green)';
                    return `<tr${person.isTarget ? ' style="font-weight:700"' : ''}>
                      <td>${escHtml(person.name)}${person.isTarget ? ' (you)' : ''}</td>
                      <td class="td-m">${fmtCur(person.share || 0)}</td>
                      <td class="td-m">${person.paid ? fmtCur(person.paid) : '-'}</td>
                      <td class="td-m" style="color:${diffColor}">${diffLabel}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table></div>
            </div>
          </div>
        </td>
      </tr>` : '';
    const toggle = `_divSharedExpandedId=${isOpen ? 'null' : `'${session.key}'`};document.getElementById('divSharedHistoryBody').innerHTML=_buildSharedGroupRows().join('')`;
    return `<tr style="cursor:pointer" onclick="${toggle}">
      <td>${fmtDate(session.date)}</td>
      <td style="font-weight:600">${escHtml(session.heading || 'Shared split')}${session.items.length > 1 ? ` <span style="font-size:11px;font-weight:400;color:var(--t3)">(${session.items.length} items)</span>` : ''}</td>
      <td style="color:var(--t2);font-size:13px">${escHtml(session.owner_name || 'Unknown')} · ${escHtml(paidByText)}</td>
      <td class="td-m" style="font-weight:600">${fmtCur(total)}</td>
      <td style="text-align:right;white-space:nowrap">
        <span style="color:var(--t3);font-size:13px;margin-right:8px">${isOpen ? '-' : '+'}</span>
        <button class="btn-d" style="color:var(--red)" onclick="event.stopPropagation();hideSharedDivideSession(${session.owner_user_id}, '${String(session.session_key).replace(/'/g, "\\'")}')">Hide</button>
      </td>
    </tr>${expandDetail}`;
  });
}

function renderSharedDivHistory() {
  const sessions = _buildSharedSessions();
  return `
    <div style="margin-top:28px" id="divSharedHistorySection">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:14px;font-weight:700">Shared Split Details
          <span class="div-shared-count" style="font-size:12px;font-weight:400;color:var(--t3);margin-left:8px">${sessions.length} session${sessions.length !== 1 ? 's' : ''}, ${_divSharedGroups.length} item${_divSharedGroups.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      ${_divSharedGroups.length ? `
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Date</th><th>Heading / Details</th><th>Shared By</th>
          <th class="td-m">Total</th><th style="width:110px;text-align:right"></th>
        </tr></thead>
        <tbody id="divSharedHistoryBody">${_buildSharedGroupRows().join('')}</tbody>
      </table></div>` : `
      <div class="card" style="text-align:center;color:var(--t3);padding:24px 18px">
        No shared split details yet.
      </div>`}
    </div>`;
}

function selectPaidBy(btn, id) {
  dividePaidBy = id;
  document.querySelectorAll('#paidByChips .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  updateDivSplitInputs();
  // Show CC section only when "You" paid
  const wrap = document.getElementById('divCcWrap');
  if (wrap) wrap.innerHTML = id === 'self' ? _buildDivCcSection() : '';
}

function toggleDivFriend(id) {
  const key = String(id);
  // Toggle selection
  if (divideSelected.has(key)) divideSelected.delete(key);
  else divideSelected.add(key);
  // Update chip DOM
  const container = document.getElementById('divideFriends');
  if (container) {
    container.querySelectorAll('.fr-chip').forEach(btn => {
      // Extract id from onclick attribute
      const match = btn.getAttribute('onclick')?.match(/toggleDivFriend\((.+?)\)/);
      if (!match) return;
      const rawId = match[1].trim();
      const chipId = rawId === "'self'" ? 'self' : String(parseInt(rawId, 10));
      const sel = divideSelected.has(chipId);
      btn.classList.toggle('sel', sel);
      const cbox = btn.querySelector('.cbox');
      if (cbox) { cbox.classList.toggle('chk', sel); cbox.innerHTML = sel ? '&#10003;' : ''; }
    });
  }
  // Reset split values when people change
  divideSplitValues = {};
  const amt = parseFloat(document.getElementById('dAmount')?.value || 0);
  const people = _selectedPeople();
  if (people.length > 0 && amt > 0 && divideSplitMode !== 'equal') divideSplitValues = _autoFillSplitValues(divideSplitMode, people, amt);
  updateDivSplitInputs();
}

function updateDivSplitInputs() {
  const el = document.getElementById('divSplitInputs');
  if (!el) return;
  const amt = parseFloat(document.getElementById('dAmount')?.value || 0);
  const people = _selectedPeople();
  if (people.length === 0 || amt <= 0) { el.innerHTML = ''; return; }

  if (divideSplitMode === 'equal') {
    const pp = Math.round((amt / people.length) * 100) / 100;
    el.innerHTML = `<div class="preview-box" style="margin-bottom:12px">Split equally among <b>${people.length}</b> people &middot; Per person: <b>${fmtCur(pp)}</b></div>`;
    return;
  }

  const hints = { percent: '(%, total must be 100)', fraction: '(fraction, total must be 1.0)', amount: '(&#8377;, total must match)', parts: '(ratio, proportional)' };
  const rows = people.map(p => {
    const val = divideSplitValues[p.key] !== undefined ? divideSplitValues[p.key] : '';
    return `<tr>
      <td style="padding:4px 8px">${p.name}</td>
      <td style="padding:4px 8px"><input type="number" step="any" data-pkey="${p.key}" style="width:90px;padding:4px 6px;border:1px solid var(--br);border-radius:4px;background:var(--bg2);color:var(--t1)" value="${val}" oninput="onSplitInput(this,'${p.key}')"></td>
    </tr>`;
  }).join('');

  const { valid, error } = computeShares(amt, divideSplitMode, people, divideSplitValues);
  const statusHtml = valid
    ? `<span style="color:var(--green);font-weight:600">&#10003; Valid split</span>`
    : `<span style="color:var(--red)">${error}</span>`;

  el.innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-size:12px;color:var(--t2);margin-bottom:6px">Enter values per person ${hints[divideSplitMode] || ''}</div>
      <table style="border-collapse:collapse"><tbody>${rows}</tbody>
        <tr id="splitStatusRow"><td colspan="2" style="padding:6px 8px">${statusHtml}</td></tr>
      </table>
    </div>`;
}

function onSplitInput(input, pkey) {
  divideSplitValues[pkey] = parseFloat(input.value) || 0;
  // Only update the status row â€” don't re-render inputs (would kill focus)
  const statusRow = document.getElementById('splitStatusRow');
  if (!statusRow) return;
  const amt = parseFloat(document.getElementById('dAmount')?.value || 0);
  const people = _selectedPeople();
  const { valid, error } = computeShares(amt, divideSplitMode, people, divideSplitValues);

  // Compute remaining balance for this person (sum of others vs target)
  let balanceHtml = '';
  if (!valid && divideSplitMode !== 'equal' && divideSplitMode !== 'parts') {
    const othersSum = people.filter(p => p.key !== pkey).reduce((s, p) => s + (parseFloat(divideSplitValues[p.key]) || 0), 0);
    const target = divideSplitMode === 'percent' ? 100 : divideSplitMode === 'fraction' ? 1 : amt;
    const remaining = Math.round((target - othersSum) * 10000) / 10000;
    if (remaining > 0) {
      const label = divideSplitMode === 'percent' ? `${remaining}%` : divideSplitMode === 'fraction' ? remaining : fmtCur(remaining);
      balanceHtml = ` &nbsp;<button style="font-size:11px;padding:2px 8px;border:1px solid var(--br);border-radius:4px;background:var(--bg2);cursor:pointer;color:var(--t1)" onclick="setRemaining('${pkey}',${remaining})">Set balance: ${label}</button>`;
    }
  }

  statusRow.querySelector('td').innerHTML = valid
    ? `<span style="color:var(--green);font-weight:600">&#10003; Valid split</span>`
    : `<span style="color:var(--red)">${error}</span>${balanceHtml}`;
}

function setRemaining(pkey, remaining) {
  divideSplitValues[pkey] = remaining;
  const input = document.querySelector(`#divSplitInputs input[data-pkey="${pkey}"]`);
  if (input) input.value = remaining;
  // Re-validate
  const statusRow = document.getElementById('splitStatusRow');
  if (!statusRow) return;
  const amt = parseFloat(document.getElementById('dAmount')?.value || 0);
  const people = _selectedPeople();
  const { valid, error } = computeShares(amt, divideSplitMode, people, divideSplitValues);
  statusRow.querySelector('td').innerHTML = valid
    ? `<span style="color:var(--green);font-weight:600">&#10003; Valid split</span>`
    : `<span style="color:var(--red)">${error}</span>`;
}

async function addDivItem() {
  const details = document.getElementById('dDetails').value.trim();
  const amt = parseFloat(document.getElementById('dAmount').value);
  const date = document.getElementById('dDate').value || todayStr();
  if (!details) { toast('Enter details', 'warning'); return; }
  if (!amt || amt <= 0) { toast('Enter a valid amount', 'warning'); return; }
  if (divideSelected.size === 0) { toast('Select at least one person to divide with', 'warning'); return; }

  const people = _selectedPeople();
  const { valid, error, shares } = computeShares(amt, divideSplitMode, people, divideSplitValues);
  if (!valid) { toast(error || 'Invalid split', 'warning'); return; }

  const friends = _divFriends;
  const selfIncluded = divideSelected.has('self');
  const paidByName = dividePaidBy === 'self' ? 'You' : friends.find(f => f.id == dividePaidBy)?.name || 'Friend';
  const friendIds = [...divideSelected].filter(id => id !== 'self');
  const divideNames = people.map(p => p.name);
  const avgShare = Math.round((amt / people.length) * 100) / 100;

  // Capture CC info if paid by self and CC checkbox is checked
  let ccInfo = null;
  if (dividePaidBy === 'self' && document.getElementById('divCcCheck')?.checked) {
    const cardId = parseInt(document.getElementById('divCcCard')?.value);
    const discPct = parseFloat(document.getElementById('divCcDisc')?.value) || 0;
    const card = _ccCards.find(c => c.id === cardId);
    if (card) ccInfo = { cardId, discountPct: discPct, cardName: card.card_name };
  }

  const item = {
    date, details, amount: amt,
    perPerson: avgShare,
    divideAmong: people.length,
    paidByName, paidById: dividePaidBy,
    friendIds, selfIncluded,
    friendNames: divideNames,
    splitMode: divideSplitMode,
    personShares: shares,
    ccInfo,
  };

  if (_divEditIdx !== null) {
    divideItems[_divEditIdx] = item;
    _divEditIdx = null;
  } else {
    divideItems.push(item);
  }
  _saveDivideDraftItems();

  divideSelected = new Set();
  dividePaidBy = 'self';
  divideSplitMode = 'equal';
  divideSplitValues = {};
  renderDivide();
}

function editDivItem(i) {
  const item = divideItems[i];
  _divEditIdx = i;
  divideSelected = new Set(
    item.personShares?.length
      ? item.personShares.map(ps => String(ps.key))
      : [
          ...((item.friendIds || []).map(id => String(id))),
          ...(item.selfIncluded ? ['self'] : []),
        ]
  );
  dividePaidBy = String(item.paidById);
  divideSplitMode = item.splitMode || 'equal';
  divideSplitValues = _restoreSplitValues(divideSplitMode, item.personShares || [], parseFloat(item.amount) || 0);
  renderDivide();
  // Scroll to top of form
  document.getElementById('main').scrollTop = 0;
}

function removeDivItem(i) {
  divideItems.splice(i, 1);
  _saveDivideDraftItems();
  if (_divEditIdx === i) { _divEditIdx = null; divideSelected = new Set(); dividePaidBy = 'self'; }
  else if (_divEditIdx > i) _divEditIdx--;
  renderDivide();
}

async function clearDivForm() {
  if (!await confirmDialog('Clear all items?')) return;
  divideItems = [];
  _saveDivideDraftItems();
  divideSelected = new Set();
  dividePaidBy = 'self';
  divideSplitMode = 'equal';
  divideSplitValues = {};
  _divEditIdx = null;
  renderDivide();
}

function showSaveDivideModal() {
  if (divideItems.length === 0) return;
  const firstDate = divideItems[0]?.date || todayStr();
  const ccLinked = divideItems.filter(i => i.ccInfo).length;
  const ccNote = ccLinked > 0
    ? `<div style="background:var(--blue-l);color:var(--blue);border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:12px">CC ${ccLinked} item${ccLinked>1?'s':''} will be charged to credit card</div>`
    : '';
  openModal('Save Split - Enter Heading', `
    <div style="font-size:13px;color:var(--t2);margin-bottom:14px">
      This heading will be used for all saved records - your expense entry and each friend's transaction.
    </div>
    <div class="fg">
      <label class="fl full">Heading / Description *
        <input class="fi" id="divHeading" placeholder="e.g. Trip to Goa, Office Lunch..." autofocus>
      </label>
      <label class="fl">Date
        <input class="fi" type="date" id="divSaveDate" value="${firstDate}">
      </label>
      <label class="fl">My Expense Category${expenseCategoryDatalistHtml('')}</label>
    </div>
    <div style="margin:14px 0 12px">
      <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:8px">MY EXPENSE TYPE</div>
      <div style="display:flex;gap:8px">
        <button id="divTypeFair" class="chip active" onclick="document.getElementById('divTypeFair').classList.add('active');document.getElementById('divTypeExtra').classList.remove('active')">Fair / Regular</button>
        <button id="divTypeExtra" class="chip" onclick="document.getElementById('divTypeExtra').classList.add('active');document.getElementById('divTypeFair').classList.remove('active')">Extra / Non-essential</button>
      </div>
    </div>
    ${ccNote}
    <div class="fa">
      <button class="btn btn-p" onclick="doSaveDivide()">Save All</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function doSaveDivide() {
  const heading = document.getElementById('divHeading').value.trim();
  const date = document.getElementById('divSaveDate').value || todayStr();
  if (!heading) { toast('Please enter a heading', 'warning'); return; }

  const friends = _divFriends;

  // â”€â”€ 1. Recompute summary (peopleMap) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const peopleMap = {};
  divideItems.forEach(item => {
    if (item.personShares && item.personShares.length > 0) {
      item.personShares.forEach(ps => {
        if (!peopleMap[ps.key]) peopleMap[ps.key] = { name: ps.name, totalShare: 0, totalGave: 0 };
        peopleMap[ps.key].totalShare += ps.share;
      });
    } else {
      item.friendIds.forEach(fid => {
        if (!peopleMap[fid]) {
          const fn = friends.find(f => f.id == fid);
          peopleMap[fid] = { name: fn?.name || '?', totalShare: 0, totalGave: 0 };
        }
        peopleMap[fid].totalShare += item.perPerson;
      });
      if (item.selfIncluded) {
        if (!peopleMap['self']) peopleMap['self'] = { name: 'You', totalShare: 0, totalGave: 0 };
        peopleMap['self'].totalShare += item.perPerson;
      }
    }
    const payerKey = item.paidById;
    if (payerKey !== undefined && payerKey !== null) {
      if (!peopleMap[payerKey]) {
        const fn = payerKey === 'self' ? { name: 'You' } : friends.find(f => f.id == payerKey);
        peopleMap[payerKey] = { name: fn?.name || '?', totalShare: 0, totalGave: 0 };
      }
      peopleMap[payerKey].totalGave += item.amount;
    }
  });

  // â”€â”€ 2. Save divide groups (split records) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const sessionId = String(Date.now());
  const participantFriendIds = [...new Set(divideItems.flatMap((item) => (item.personShares || []).map((ps) => Number(ps.key)).filter((key) => Number.isFinite(key) && key > 0)))];
  for (const item of divideItems) {
    const splits = item.personShares
      ? item.personShares.filter(ps => ps.key !== 'self').map(ps => ({ friend_id: ps.key, friend_name: ps.name, share_amount: ps.share }))
      : item.friendIds.map(fid => {
          const f = friends.find(x => x.id == fid);
          return { friend_id: fid, friend_name: f?.name || '?', share_amount: item.perPerson };
        });
    await api('/api/divide', { method: 'POST', body: {
      divide_date: item.date, details: item.details,
      paid_by: item.paidByName, total_amount: item.amount, splits,
      heading, session_id: sessionId,
    }});
    // Save CC transaction if paid by self and card was linked
    if (item.paidById === 'self' && item.ccInfo?.cardId) {
      await api('/api/cc/txns', { method: 'POST', body: {
        card_id: item.ccInfo.cardId,
        txn_date: item.date,
        description: item.details,
        amount: item.amount,
        discount_pct: item.ccInfo.discountPct || 0,
        source: 'split',
      }});
    }
  }

  // â”€â”€ 3. Save my expense entry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const isExtra = document.getElementById('divTypeExtra')?.classList.contains('active') || false;
  const expenseCategory = document.getElementById('eCategory')?.value.trim() || null;
  const selfEntry = peopleMap['self'];
  if (selfEntry && selfEntry.totalShare > 0) {
    const expR = await api('/api/expenses', { method: 'POST', body: {
      item_name: heading,
      category: expenseCategory,
      amount: Math.round(selfEntry.totalShare * 100) / 100,
      purchase_date: date,
      is_extra: isExtra,
    }});
    void expR; // CC transactions for split items were already saved per-item above
  }

  // â”€â”€ 4. Save friend loan transactions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  for (const [fid, p] of Object.entries(peopleMap)) {
    if (fid === 'self') continue;
    await api('/api/loans', { method: 'POST', body: {
      friend_id: parseInt(fid),
      txn_date: date,
      details: heading,
      paid: Math.round(p.totalShare * 100) / 100,
      received: Math.round((p.totalGave || 0) * 100) / 100,
    }});
  }

  closeModal();
  divideItems = [];
  divideSelected = new Set();
  dividePaidBy = 'self';
  divideSplitMode = 'equal';
  divideSplitValues = {};
  _divEditIdx = null;
  _saveDivideDraftItems();
  _divExpandedId = null;
  // Reload groups from DB then re-render
  const dData = await api('/api/divide');
  _divGroups = dData?.groups || [];
  renderDivide();
  const shareableFriendIds = participantFriendIds.filter((friendId) => {
    const friend = _divFriends.find((entry) => Number(entry.id) === Number(friendId));
    return !!friend?.linked_user_id;
  });
  if (shareableFriendIds.length > 0) {
    const shouldShare = await confirmDialog(`Share this saved split history with ${shareableFriendIds.length} linked friend${shareableFriendIds.length !== 1 ? 's' : ''} now? They will be able to view the details in their profile.`);
    if (shouldShare) {
      const shareRes = await api('/api/divide/share-session', { method: 'POST', body: { session_key: sessionId, friend_ids: shareableFriendIds } });
      if (shareRes?.success) {
        const refreshed = await api('/api/divide');
        _divGroups = refreshed?.groups || [];
        renderDivide();
        toast('Saved and shared with linked friends', 'success', 4500);
        return;
      }
      toast(shareRes?.error || 'Saved, but sharing failed. You can share it later from Saved Splits History.', 'warning', 4500);
      return;
    }
  }
  const friendCount = Object.keys(peopleMap).filter(k => k !== 'self').length;
  toast(`Saved!${selfEntry?.totalShare > 0 ? ' Expense added to your account.' : ''} ${friendCount} friend transaction(s) recorded.`, 'success', 4500);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// REPORTS â€” Year / Month / Expense drill-down
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _reportChart = null;
let reportDrillYear = null;
let reportDrillMonth = null;
let reportSearch = '';
let reportPage = 1;
const REPORT_PAGE_SIZE = 50;
let _rptYearsData = [];
let _rptMonthsData = [];
let _rptExpData = [];
let rptYearSort  = { field: 'year',  dir: 'desc' };
let rptMonthSort = { field: 'month', dir: 'asc'  };
let rptExpSort   = { field: 'date',  dir: 'desc' };

function rptSortArr(arr, field, dir) {
  return [...arr].sort((a, b) => {
    let va = a[field], vb = b[field];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    return dir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });
}
function rptToggleSort(sortObj, field) {
  if (sortObj.field === field) sortObj.dir = sortObj.dir === 'asc' ? 'desc' : 'asc';
  else { sortObj.field = field; sortObj.dir = field === 'year' || field === 'month' ? 'desc' : 'desc'; }
}
function rptArrow(sortObj, field) {
  return sortObj.field === field ? (sortObj.dir === 'asc' ? ' &uarr;' : ' &darr;') : '';
}

async function loadReports() {
  reportDrillYear = null;
  reportDrillMonth = null;
  reportSearch = '';
  reportPage = 1;
  await renderReportYears();
}

async function renderReportYears() {
  const data = await api('/api/reports/years');
  if (!data) return;
  const rows = data.rows || [];
  _rptYearsData = rows;

  if (_reportChart) { _reportChart.destroy(); _reportChart = null; }

  const chartData = rows.slice().reverse();

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="rpt-header">
        <div>
          <h2 class="dash-title">Reports</h2>
          <div class="dash-subtitle">Year-wise spending overview</div>
        </div>
        <button class="btn btn-s btn-sm" onclick="printReport('years')">Print / PDF</button>
      </div>

      <div class="dash-box" style="margin-bottom:16px">
        <div class="dash-box-title">Spending by Year</div>
        <canvas id="rptChart" height="70"></canvas>
      </div>

      <div class="dash-box">
        <div class="rpt-table-top">
          <span style="font-size:13px;color:var(--t3)">${rows.length} year${rows.length!==1?'s':''} of data</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th class="rpt-th" onclick="rptToggleSort(rptYearSort,'year');renderReportYears()">Year${rptArrow(rptYearSort,'year')}</th>
              <th class="rpt-th td-m" onclick="rptToggleSort(rptYearSort,'total');renderReportYears()">Total${rptArrow(rptYearSort,'total')}</th>
              <th class="rpt-th td-m" onclick="rptToggleSort(rptYearSort,'fair');renderReportYears()">Fair${rptArrow(rptYearSort,'fair')}</th>
              <th class="rpt-th td-m" onclick="rptToggleSort(rptYearSort,'extra');renderReportYears()">Extra${rptArrow(rptYearSort,'extra')}</th>
              <th class="rpt-th" style="text-align:center" onclick="rptToggleSort(rptYearSort,'count');renderReportYears()">Items${rptArrow(rptYearSort,'count')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${rows.length === 0 ? '<tr><td colspan="6" class="empty-td">No data found.</td></tr>' : ''}
              ${rptSortArr(rows, rptYearSort.field, rptYearSort.dir).map(r => `
              <tr class="rpt-row" onclick="drillToMonths(${r.year})">
                <td><span class="rpt-year-badge">${r.year}</span></td>
                <td class="td-m" style="font-weight:700">${fmtCur(r.total)}</td>
                <td class="td-m" style="color:var(--em)">${fmtCur(r.fair)}</td>
                <td class="td-m" style="color:var(--amber)">${fmtCur(r.extra)}</td>
                <td style="text-align:center"><span class="badge b-fair">${r.count}</span></td>
                <td style="text-align:right"><button class="btn btn-s btn-sm" onclick="event.stopPropagation();drillToMonths(${r.year})">View -></button></td>
              </tr>`).join('')}
            </tbody>
            ${rows.length > 0 ? `<tfoot><tr>
              <td style="font-weight:700;font-size:13px">Grand Total</td>
              <td class="td-m" style="font-weight:700">${fmtCur(rows.reduce((s,r)=>s+r.total,0))}</td>
              <td class="td-m" style="color:var(--em);font-weight:600">${fmtCur(rows.reduce((s,r)=>s+r.fair,0))}</td>
              <td class="td-m" style="color:var(--amber);font-weight:600">${fmtCur(rows.reduce((s,r)=>s+r.extra,0))}</td>
              <td style="text-align:center;font-weight:600">${rows.reduce((s,r)=>s+r.count,0)}</td>
              <td></td>
            </tr></tfoot>` : ''}
          </table>
        </div>
      </div>
    </div>`;

  _reportChart = new Chart(document.getElementById('rptChart'), {
    type: 'bar',
    data: {
      labels: chartData.map(r => r.year),
      datasets: [
        { label: 'Fair',  data: chartData.map(r => r.fair),  backgroundColor: 'rgba(20,90,60,0.80)', stack: 's', borderRadius: 4 },
        { label: 'Extra', data: chartData.map(r => r.extra), backgroundColor: '#F0A030',              stack: 's', borderRadius: 4 }
      ]
    },
    options: {
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: { callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${fmtCur(ctx.raw)}`,
          footer: items => ` Total: ${fmtCur(items.reduce((s,i)=>s+i.raw,0))}`
        }}
      },
      interaction: { mode: 'index' },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ticks: { callback: v => fmtCur(v) }, grid: { color: '#F0F1F4' } }
      },
      onClick: (_e, els) => { if (els.length) drillToMonths(chartData[els[0].index].year); }
    }
  });
}

async function drillToMonths(year) {
  reportDrillYear = year;
  reportDrillMonth = null;
  reportSearch = '';
  reportPage = 1;
  const data = await api(`/api/reports/months?year=${year}`);
  if (!data) return;
  const rows = data.rows || [];
  _rptMonthsData = rows;

  if (_reportChart) { _reportChart.destroy(); _reportChart = null; }

  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="rpt-header">
        <div>
          <h2 class="dash-title">Reports - ${year}</h2>
          <div class="dash-subtitle rpt-breadcrumb">
            <span class="rpt-bc-link" onclick="loadReports()">All Years</span>
            <span class="rpt-bc-sep">></span>
            <span>${year}</span>
          </div>
        </div>
        <button class="btn btn-s btn-sm" onclick="printReport('months')">Print / PDF</button>
      </div>

      <div class="dash-box" style="margin-bottom:16px">
        <div class="dash-box-title">Monthly Spending - ${year}</div>
        <canvas id="rptChart" height="80"></canvas>
      </div>

      <div class="dash-box">
        <div class="rpt-table-top">
          <span style="font-size:13px;color:var(--t3)">${rows.length} month${rows.length!==1?'s':''} with data</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th class="rpt-th" onclick="rptToggleSort(rptMonthSort,'month');drillToMonths(${year})">Month${rptArrow(rptMonthSort,'month')}</th>
              <th class="rpt-th td-m" onclick="rptToggleSort(rptMonthSort,'total');drillToMonths(${year})">Total${rptArrow(rptMonthSort,'total')}</th>
              <th class="rpt-th td-m" onclick="rptToggleSort(rptMonthSort,'fair');drillToMonths(${year})">Fair${rptArrow(rptMonthSort,'fair')}</th>
              <th class="rpt-th td-m" onclick="rptToggleSort(rptMonthSort,'extra');drillToMonths(${year})">Extra${rptArrow(rptMonthSort,'extra')}</th>
              <th class="rpt-th" style="text-align:center" onclick="rptToggleSort(rptMonthSort,'count');drillToMonths(${year})">Items${rptArrow(rptMonthSort,'count')}</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${rows.length === 0 ? '<tr><td colspan="6" class="empty-td">No data for this year.</td></tr>' : ''}
              ${rptSortArr(rows.map(r => ({...r, month: parseInt(r.month)})), rptMonthSort.field, rptMonthSort.dir).map(r => {
                const mi = r.month - 1;
                return `<tr class="rpt-row" onclick="drillToExpenses(${year},${r.month})">
                  <td><span class="rpt-year-badge">${mNames[mi]}</span></td>
                  <td class="td-m" style="font-weight:700">${fmtCur(r.total)}</td>
                  <td class="td-m" style="color:var(--em)">${fmtCur(r.fair)}</td>
                  <td class="td-m" style="color:var(--amber)">${fmtCur(r.extra)}</td>
                  <td style="text-align:center"><span class="badge b-fair">${r.count}</span></td>
                  <td style="text-align:right"><button class="btn btn-s btn-sm" onclick="event.stopPropagation();drillToExpenses(${year},${r.month})">View -></button></td>
                </tr>`;
              }).join('')}
            </tbody>
            ${rows.length > 0 ? `<tfoot><tr>
              <td style="font-weight:700;font-size:13px">Year Total</td>
              <td class="td-m" style="font-weight:700">${fmtCur(rows.reduce((s,r)=>s+r.total,0))}</td>
              <td class="td-m" style="color:var(--em);font-weight:600">${fmtCur(rows.reduce((s,r)=>s+r.fair,0))}</td>
              <td class="td-m" style="color:var(--amber);font-weight:600">${fmtCur(rows.reduce((s,r)=>s+r.extra,0))}</td>
              <td style="text-align:center;font-weight:600">${rows.reduce((s,r)=>s+r.count,0)}</td>
              <td></td>
            </tr></tfoot>` : ''}
          </table>
        </div>
      </div>
    </div>`;

  const monthlyFair  = Array(12).fill(0);
  const monthlyExtra = Array(12).fill(0);
  rows.forEach(r => { const i = parseInt(r.month)-1; monthlyFair[i] = r.fair; monthlyExtra[i] = r.extra; });

  _reportChart = new Chart(document.getElementById('rptChart'), {
    type: 'bar',
    data: {
      labels: mNames,
      datasets: [
        { label: 'Fair',  data: monthlyFair,  backgroundColor: 'rgba(20,90,60,0.80)', stack: 's', borderRadius: 4 },
        { label: 'Extra', data: monthlyExtra, backgroundColor: '#F0A030',              stack: 's', borderRadius: 4 }
      ]
    },
    options: {
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: { callbacks: {
          label: ctx => ` ${ctx.dataset.label}: ${fmtCur(ctx.raw)}`,
          footer: items => ` Total: ${fmtCur(items.reduce((s,i)=>s+i.raw,0))}`
        }}
      },
      interaction: { mode: 'index' },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ticks: { callback: v => fmtCur(v) }, grid: { color: '#F0F1F4' } }
      },
      onClick: (_e, els) => { if (els.length) drillToExpenses(year, els[0].index + 1); }
    }
  });
}

async function drillToExpenses(year, month) {
  reportDrillYear = year;
  reportDrillMonth = month;
  reportPage = 1;
  await renderReportExpenses();
}

async function renderReportExpenses() {
  const year = reportDrillYear;
  const month = reportDrillMonth;
  const mNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mName = mNames[month - 1];

  let qs = `/api/expenses?year=${year}&month=${month}`;
  if (reportSearch) qs += `&search=${encodeURIComponent(reportSearch)}`;
  const data = await api(qs);
  if (!data) return;

  let list = data.expenses || [];
  _rptExpData = list;
  list = rptSortArr(list.map(e => ({...e, date: e.purchase_date, name: e.item_name})),
    rptExpSort.field === 'date' ? 'date' : rptExpSort.field === 'amount' ? 'amount' : rptExpSort.field === 'name' ? 'name' : 'type',
    rptExpSort.dir);

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
  reportPage = Math.min(reportPage, totalPages);
  const start = (reportPage - 1) * REPORT_PAGE_SIZE;
  const pageList = list.slice(start, start + REPORT_PAGE_SIZE);
  const fairTotal = list.filter(e => !e.is_extra).reduce((s,e) => s+e.amount, 0);
  const extraTotal = list.filter(e => e.is_extra).reduce((s,e) => s+e.amount, 0);

  const searchFocused = document.activeElement?.id === 'rptSearch';
  const searchCursor = searchFocused ? document.getElementById('rptSearch')?.selectionStart : null;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="rpt-header">
        <div>
          <h2 class="dash-title">Reports - ${year} > ${mName}</h2>
          <div class="dash-subtitle rpt-breadcrumb">
            <span class="rpt-bc-link" onclick="loadReports()">All Years</span>
            <span class="rpt-bc-sep">></span>
            <span class="rpt-bc-link" onclick="drillToMonths(${year})">${year}</span>
            <span class="rpt-bc-sep">></span>
            <span>${mName}</span>
          </div>
        </div>
        <button class="btn btn-s btn-sm" onclick="printReport('expenses')">Print / PDF</button>
      </div>

      <div class="dash-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
        <div class="dash-card">
          <div class="dc-label">Total</div>
          <div class="dc-amount">${fmtCur(data.total)}</div>
          <div class="dc-sub">${data.count} expenses</div>
        </div>
        <div class="dash-card">
          <div class="dc-label">Fair</div>
          <div class="dc-amount" style="color:var(--em)">${fmtCur(fairTotal)}</div>
          <div class="dc-sub">${list.filter(e=>!e.is_extra).length} items</div>
        </div>
        <div class="dash-card" style="border-left:3px solid var(--amber)">
          <div class="dc-label">Extra</div>
          <div class="dc-amount" style="color:var(--amber)">${fmtCur(extraTotal)}</div>
          <div class="dc-sub">${list.filter(e=>e.is_extra).length} items</div>
        </div>
      </div>

      <div class="dash-box">
        <div class="rpt-table-top">
          <input id="rptSearch" class="search-input" placeholder="Search items..." value="${reportSearch}"
            oninput="reportSearch=this.value;reportPage=1;renderReportExpenses()" style="max-width:220px">
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th class="rpt-th" onclick="rptToggleSort(rptExpSort,'date');renderReportExpenses()">Date${rptArrow(rptExpSort,'date')}</th>
              <th class="rpt-th" onclick="rptToggleSort(rptExpSort,'name');renderReportExpenses()">Item${rptArrow(rptExpSort,'name')}</th>
              <th class="rpt-th td-m" onclick="rptToggleSort(rptExpSort,'amount');renderReportExpenses()">Amount${rptArrow(rptExpSort,'amount')}</th>
              <th class="rpt-th" onclick="rptToggleSort(rptExpSort,'is_extra');renderReportExpenses()">Type${rptArrow(rptExpSort,'is_extra')}</th>
            </tr></thead>
            <tbody>
              ${pageList.length === 0 ? '<tr><td colspan="4" class="empty-td">No expenses found.</td></tr>' : ''}
              ${pageList.map(e => `<tr>
                <td>${fmtDate(e.purchase_date)}</td>
                <td>${e.item_name}</td>
                <td class="td-m" style="font-weight:600">${fmtCur(e.amount)}</td>
                <td><span class="badge ${e.is_extra?'b-extra':'b-fair'}">${e.is_extra?'Extra':'Fair'}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${totalPages > 1 ? `
        <div class="pagination">
          <button class="pg-btn" ${reportPage<=1?'disabled':''} onclick="reportPage=${reportPage-1};renderReportExpenses()">&larr; Prev</button>
          <div class="pg-info">
          <span class="pg-range">${start+1}&ndash;${Math.min(start+REPORT_PAGE_SIZE,total)} of ${total}</span>
            <div class="pg-pages">
              ${paginationPages(reportPage, totalPages).map(p => p==='...'
                ? `<span class="pg-ellipsis">...</span>`
                : `<button class="pg-num ${p===reportPage?'active':''}" onclick="reportPage=${p};renderReportExpenses()">${p}</button>`
              ).join('')}
            </div>
          </div>
          <button class="pg-btn" ${reportPage>=totalPages?'disabled':''} onclick="reportPage=${reportPage+1};renderReportExpenses()">Next &rarr;</button>
        </div>` : `<div style="font-size:12px;color:var(--t3);text-align:center;padding:10px 0">${total} item${total!==1?'s':''}</div>`}
      </div>
    </div>`;

  if (searchFocused) {
    const el = document.getElementById('rptSearch');
    if (el) { el.focus(); if (searchCursor !== null) el.setSelectionRange(searchCursor, searchCursor); }
  }
}

function printReport(level) {
  const mNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });

  let title = '', subtitle = '', tableHTML = '', summaryHTML = '';

  if (level === 'years') {
    const rows = rptSortArr(_rptYearsData, rptYearSort.field, rptYearSort.dir);
    title = 'Expense Report - All Years';
    subtitle = `Generated on ${now}`;
    const grandTotal = rows.reduce((s,r)=>s+r.total,0);
    const grandFair  = rows.reduce((s,r)=>s+r.fair,0);
    const grandExtra = rows.reduce((s,r)=>s+r.extra,0);
    const grandCount = rows.reduce((s,r)=>s+r.count,0);
    summaryHTML = `<div class="pr-summary">
      <div class="pr-card"><div class="pr-lbl">Grand Total</div><div class="pr-val">${fmtCur(grandTotal)}</div></div>
      <div class="pr-card"><div class="pr-lbl">Fair</div><div class="pr-val">${fmtCur(grandFair)}</div></div>
      <div class="pr-card"><div class="pr-lbl">Extra</div><div class="pr-val">${fmtCur(grandExtra)}</div></div>
      <div class="pr-card"><div class="pr-lbl">Total Items</div><div class="pr-val">${grandCount}</div></div>
    </div>`;
    tableHTML = `<table><thead><tr><th>Year</th><th>Total</th><th>Fair</th><th>Extra</th><th>Items</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><b>${r.year}</b></td><td>${fmtCur(r.total)}</td><td>${fmtCur(r.fair)}</td><td>${fmtCur(r.extra)}</td><td>${r.count}</td></tr>`).join('')}
      <tr class="total-row"><td><b>Grand Total</b></td><td><b>${fmtCur(grandTotal)}</b></td><td><b>${fmtCur(grandFair)}</b></td><td><b>${fmtCur(grandExtra)}</b></td><td><b>${grandCount}</b></td></tr>
    </tbody></table>`;

  } else if (level === 'months') {
    const year = reportDrillYear;
    const rows = rptSortArr(_rptMonthsData.map(r=>({...r,month:parseInt(r.month)})), rptMonthSort.field, rptMonthSort.dir);
    title = `Expense Report - ${year}`;
    subtitle = `Monthly breakdown � Generated on ${now}`;
    const yTotal = rows.reduce((s,r)=>s+r.total,0);
    const yFair  = rows.reduce((s,r)=>s+r.fair,0);
    const yExtra = rows.reduce((s,r)=>s+r.extra,0);
    const yCount = rows.reduce((s,r)=>s+r.count,0);
    summaryHTML = `<div class="pr-summary">
      <div class="pr-card"><div class="pr-lbl">Year Total</div><div class="pr-val">${fmtCur(yTotal)}</div></div>
      <div class="pr-card"><div class="pr-lbl">Fair</div><div class="pr-val">${fmtCur(yFair)}</div></div>
      <div class="pr-card"><div class="pr-lbl">Extra</div><div class="pr-val">${fmtCur(yExtra)}</div></div>
      <div class="pr-card"><div class="pr-lbl">Total Items</div><div class="pr-val">${yCount}</div></div>
    </div>`;
    tableHTML = `<table><thead><tr><th>Month</th><th>Total</th><th>Fair</th><th>Extra</th><th>Items</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><b>${mNames[r.month-1]}</b></td><td>${fmtCur(r.total)}</td><td>${fmtCur(r.fair)}</td><td>${fmtCur(r.extra)}</td><td>${r.count}</td></tr>`).join('')}
      <tr class="total-row"><td><b>Year Total</b></td><td><b>${fmtCur(yTotal)}</b></td><td><b>${fmtCur(yFair)}</b></td><td><b>${fmtCur(yExtra)}</b></td><td><b>${yCount}</b></td></tr>
    </tbody></table>`;

  } else if (level === 'expenses') {
    const year = reportDrillYear;
    const month = reportDrillMonth;
    const mName = mNames[month-1];
    const list = rptSortArr(_rptExpData.map(e=>({...e,date:e.purchase_date,name:e.item_name})),
      rptExpSort.field === 'date' ? 'date' : rptExpSort.field === 'amount' ? 'amount' : rptExpSort.field === 'name' ? 'name' : 'is_extra',
      rptExpSort.dir);
    title = `Expense Report - ${mName} ${year}`;
    subtitle = `${list.length} expenses � Generated on ${now}`;
    const total  = list.reduce((s,e)=>s+e.amount,0);
    const fair   = list.filter(e=>!e.is_extra).reduce((s,e)=>s+e.amount,0);
    const extra  = list.filter(e=>e.is_extra).reduce((s,e)=>s+e.amount,0);
    summaryHTML = `<div class="pr-summary">
      <div class="pr-card"><div class="pr-lbl">Total</div><div class="pr-val">${fmtCur(total)}</div></div>
      <div class="pr-card"><div class="pr-lbl">Fair</div><div class="pr-val">${fmtCur(fair)}</div></div>
      <div class="pr-card"><div class="pr-lbl">Extra</div><div class="pr-val">${fmtCur(extra)}</div></div>
      <div class="pr-card"><div class="pr-lbl">Items</div><div class="pr-val">${list.length}</div></div>
    </div>`;
    tableHTML = `<table><thead><tr><th>#</th><th>Date</th><th>Description</th><th>Amount</th><th>Type</th></tr></thead><tbody>
      ${list.map((e,i)=>`<tr><td>${i+1}</td><td>${fmtDate(e.purchase_date)}</td><td>${e.item_name}</td><td>${fmtCur(e.amount)}</td><td>${e.is_extra?'Extra':'Fair'}</td></tr>`).join('')}
      <tr class="total-row"><td colspan="3"><b>Total</b></td><td><b>${fmtCur(total)}</b></td><td></td></tr>
    </tbody></table>`;
  }

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size:13px; color:#1A1D24; padding:32px; }
    .pr-header { border-bottom:3px solid #145A3C; padding-bottom:16px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:flex-end; }
    .pr-title { font-size:22px; font-weight:700; color:#145A3C; }
    .pr-subtitle { font-size:12px; color:#9CA3B0; margin-top:4px; }
    .pr-logo { font-size:13px; font-weight:600; color:#145A3C; }
    .pr-summary { display:flex; gap:16px; margin-bottom:20px; }
    .pr-card { flex:1; border:1px solid #E4E7EC; border-radius:8px; padding:12px 16px; }
    .pr-lbl { font-size:11px; color:#9CA3B0; font-weight:600; text-transform:uppercase; margin-bottom:4px; }
    .pr-val { font-size:16px; font-weight:700; color:#1A1D24; }
    table { width:100%; border-collapse:collapse; font-size:12.5px; }
    thead tr { background:#145A3C; color:#fff; }
    th { padding:9px 12px; text-align:left; font-weight:600; font-size:11.5px; }
    td { padding:8px 12px; border-bottom:1px solid #F0F1F4; }
    tr:nth-child(even) td { background:#F9FAFB; }
    .total-row td { background:#E2F5EC !important; font-weight:700; border-top:2px solid #145A3C; }
    .pr-footer { margin-top:24px; font-size:11px; color:#9CA3B0; text-align:center; border-top:1px solid #E4E7EC; padding-top:12px; }
    @media print {
      body { padding:16px; }
      @page { margin:15mm; size: A4; }
    }
  </style></head><body>
  <div class="pr-header">
    <div><div class="pr-title">${title}</div><div class="pr-subtitle">${subtitle}</div></div>
    <div class="pr-logo">Expense Lite AI</div>
  </div>
  ${summaryHTML}
  ${tableHTML}
  <div class="pr-footer">Expense Lite AI � Printed on ${now}</div>
  <script>window.onload = () => { window.print(); }<\/script>
  </body></html>`);
  win.document.close();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EMI CALCULATOR
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loadEMI() {
  const ccData = await api('/api/cc/cards');
  const cards = ccData?.cards || [];
  const ccChips = cards.map(c =>
    `<button type="button" class="chip" id="emiCcChip_${c.id}" onclick="emiSetCard(${c.id})">${escHtml(c.bank_name)} ${escHtml(c.card_name)}${c.last4 ? ' --' + escHtml(c.last4) : ''}</button>`
  ).join('');

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="font-size:20px;font-weight:700;margin-bottom:16px">EMI Calculator</div>
      <div class="card">
        <div class="fg">
          <label class="fl" style="flex:2">Loan Name<input class="fi" type="text" id="emiName" placeholder="e.g. Home Loan - HDFC"></label>
          <label class="fl">Tag / Group<input class="fi" type="text" id="emiTag" placeholder="e.g. Home, Car, Personal"></label>
        </div>
        <div class="fg">
          <label class="fl">Loan Amount (&#8377;)<input class="fi" type="number" id="emiP" placeholder="e.g. 200000"></label>
          <label class="fl">Rate of Interest (% p.a.)<input class="fi" type="number" step="0.01" id="emiR" placeholder="e.g. 11.99"></label>
          <label class="fl">Tenure (months)<input class="fi" type="number" id="emiN" placeholder="e.g. 24"></label>
        </div>
        <div class="fg">
          <label class="fl">Processing / File Charges (&#8377;)<input class="fi" type="number" id="emiCharges" placeholder="e.g. 5000 (optional)" min="0"></label>
          <label class="fc" style="align-self:flex-end;padding-bottom:4px"><input type="checkbox" id="emiChargesInc" checked><span>Include charges in principal (financed)</span></label>
        </div>
        <div class="fg">
          <label class="fl" style="flex:3">Description (optional)<input class="fi" type="text" id="emiDesc" placeholder="e.g. Taken from HDFC on Mar 2026"></label>
          <label class="fc" style="align-self:flex-end;padding-bottom:4px"><input type="checkbox" id="emiGST" onchange="_emiGstToggle()"><span>Add GST (18%) on interest</span></label>
        </div>
        <div class="fg">
          <label class="fc" style="align-self:flex-end;padding-bottom:4px">
            <input type="checkbox" id="emiPlannerAdvance">
            <span>Show next month's EMI one month earlier in Planner</span>
          </label>
        </div>
        <div class="card" style="margin-top:12px;background:var(--bg2);border:1px solid var(--br)">
          <div style="font-size:18px;font-weight:700;color:var(--t1)">Credit Card Link (Optional)</div>
          <div style="font-size:12px;color:var(--t3);margin-top:2px">Use this when the EMI or charges are billed to a credit card.</div>
          <input type="hidden" id="emiCcId" value="">
          <div style="margin-top:10px">
            <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:8px">Charged to Credit Card</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              <button type="button" class="chip active" id="emiCcChip_none" onclick="emiSetCard('')">None</button>
              ${ccChips}
            </div>
            ${cards.length ? '' : '<div style="font-size:12px;color:var(--t3);margin-top:8px">No credit cards found. Add one in Credit Cards to link EMI billing.</div>'}
          </div>
          <div class="fg" id="emiGstOffsetWrap" style="display:none;margin-top:10px">
            <label class="fl">EMI GST appears on
              <select class="fi" id="emiGstOffset">
                <option value="-1">Previous month's bill</option>
                <option value="0">Same month's bill</option>
                <option value="1">Next month's bill</option>
              </select>
            </label>
          </div>
          <div class="fg" id="emiCcChargesRow" style="display:none;margin-top:2px">
            <label class="fl">File Processing Charges on CC (&#8377;)
              <input class="fi" type="number" id="emiCcCharges" min="0" step="0.01" placeholder="0.00" oninput="_emiCalcProcGst()">
            </label>
            <label class="fl">Processing GST (%)
              <input class="fi" type="number" id="emiCcChargesGst" min="0" max="100" step="0.01" placeholder="e.g. 18" oninput="_emiCalcProcGst()">
            </label>
            <label class="fl">GST Amount
              <input class="fi" type="text" id="emiCcChargesGstAmt" readonly placeholder="-" style="background:var(--bg2);color:var(--t2)">
            </label>
          </div>
        </div>
        <div style="display:flex;gap:8px"><button class="btn btn-p" onclick="calcEMI()">Calculate</button><button class="btn btn-g" onclick="loadEMI()">Reset</button></div>
      </div>
      <div id="emiResult"></div>
    </div>`;
  _emiGstToggle();
}

function emiSetCard(cardId) {
  const value = cardId === '' ? '' : String(cardId);
  const input = document.getElementById('emiCcId');
  if (input) input.value = value;
  document.querySelectorAll('[id^="emiCcChip_"]').forEach(el => el.classList.remove('active'));
  const targetId = value ? `emiCcChip_${value}` : 'emiCcChip_none';
  document.getElementById(targetId)?.classList.add('active');
  _emiGstToggle();
}

function _emiGstToggle() {
  const gst = document.getElementById('emiGST')?.checked;
  const cc  = document.getElementById('emiCcId')?.value;
  const gstWrap = document.getElementById('emiGstOffsetWrap');
  const chargesRow = document.getElementById('emiCcChargesRow');
  if (gstWrap) gstWrap.style.display = (gst && cc) ? '' : 'none';
  if (chargesRow) chargesRow.style.display = cc ? '' : 'none';
}

function _emiCalcProcGst() {
  const charges = parseFloat(document.getElementById('emiCcCharges')?.value) || 0;
  const gstPct  = parseFloat(document.getElementById('emiCcChargesGst')?.value) || 0;
  const gstAmt  = Math.round(charges * gstPct / 100 * 100) / 100;
  const el = document.getElementById('emiCcChargesGstAmt');
  if (el) el.value = (charges > 0 && gstPct > 0) ? `Rs ${gstAmt.toFixed(2)}` : '-';
}

function calcEMI() {
  const loanAmt = parseFloat(document.getElementById('emiP').value);
  const R = parseFloat(document.getElementById('emiR').value);
  const N = parseInt(document.getElementById('emiN').value);
  const gst = document.getElementById('emiGST').checked;
  const charges = parseFloat(document.getElementById('emiCharges').value) || 0;
  const chargesInc = document.getElementById('emiChargesInc').checked;
  if (!loanAmt || !R || !N || loanAmt<=0 || R<=0 || N<=0) { toast('Enter valid values', 'warning'); return; }

  // Principal for EMI calculation: include charges if financed
  const P = chargesInc ? loanAmt + charges : loanAmt;

  const r = R/12/100;
  let emi = r===0 ? P/N : (P*r*Math.pow(1+r,N))/(Math.pow(1+r,N)-1);
  emi = Math.round(emi*100)/100;

  let bal=P, totI=0, totG=0;
  const sched = [];
  for (let m=1; m<=N; m++) {
    const interest = Math.round(bal*r*100)/100;
    const princ = Math.round((emi-interest)*100)/100;
    const woGST = Math.round((interest+princ)*100)/100;
    const g = gst ? Math.round(interest*0.18*100)/100 : 0;
    const wGST = Math.round((woGST+g)*100)/100;
    bal = Math.max(0, Math.round((bal-princ)*100)/100);
    totI+=interest; totG+=g;
    sched.push({m,interest,princ,woGST,g,wGST,bal});
  }
  totI=Math.round(totI*100)/100; totG=Math.round(totG*100)/100;
  const totAmt=Math.round((P+totI)*100)/100;
  // If charges NOT included in principal, they are paid upfront â€” add to grand total
  const upfrontCharges = (!chargesInc && charges>0) ? charges : 0;
  const grand=Math.round((totAmt+totG+upfrontCharges)*100)/100;

  // Store computed values + full schedule for editing
  window._emiCalcResult = { P, loanAmt, charges, chargesInc, R, N, gst, emi, totI, totG, totAmt, grand };
  window._emiCalcSchedule = sched.map(s => ({ ...s })); // mutable copy

  const chargeNote = charges > 0
    ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(255,255,255,0.12);border-radius:8px;font-size:12px;margin-top:8px;width:100%">
        <span>Processing charges: <strong>${fmtCur(charges)}</strong></span>
        <span style="opacity:0.7"> - ${chargesInc ? 'financed (included in principal &#8377;'+P.toLocaleString('en-IN')+')' : 'paid upfront (one-time, not in EMI)'}</span>
       </div>`
    : '';

  document.getElementById('emiResult').innerHTML = `
    <div class="emi-result" id="emiResultBanner">
      ${buildCalcSummaryStats()}
      ${chargeNote}
    </div>
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="font-size:14px;color:var(--t2)">Save this EMI to track installments</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-p" onclick="saveEmiCalc(false)">Save EMI</button>
          <button class="btn btn-s" onclick="saveEmiCalc(true)">Save &amp; Activate</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div class="card-title" style="margin:0">EMI Schedule</div>
        <button class="btn btn-s btn-sm" onclick="showCalcBulkEdit()">Bulk Edit EMI</button>
      </div>
      <div style="overflow-x:auto"><table id="calcSchedTable">
        <thead><tr><th>#</th><th style="text-align:right">Interest</th><th style="text-align:right">Principal</th><th style="text-align:right">EMI</th><th style="text-align:right">GST</th><th style="text-align:right">Balance</th><th></th></tr></thead>
        <tbody>${renderCalcSchedRows()}</tbody>
      </table></div>
    </div>`;
}

function buildCalcSummaryStats() {
  const c = window._emiCalcResult;
  if (!c) return '';
  const stat = (l, v, hl, sub) => `<div class="emi-stat"><div class="lbl">${l}${sub ? '<span style="font-size:9px;opacity:0.7;display:block">' + sub + '</span>' : ''}</div><div class="val ${hl ? 'hl' : ''}">${fmtCur(v)}</div></div>`;
  const sched = window._emiCalcSchedule;
  let monthlyEmi = c.emi, totI = c.totI, totG = c.totG, grand = c.grand;
  if (sched && sched.length) {
    // Grand Total = sum of all actual EMI amounts (woGST = EMI without GST) + GST + upfront
    const totalEmiPaid = Math.round(sched.reduce((s, r) => s + (r.woGST || 0), 0) * 100) / 100;
    totG = Math.round(sched.reduce((s, r) => s + (r.g || 0), 0) * 100) / 100;
    // Total Interest = what you pay above the principal
    totI = Math.round((totalEmiPaid - c.P) * 100) / 100;
    const upfront = (!c.chargesInc && c.charges > 0) ? c.charges : 0;
    grand = Math.round((totalEmiPaid + totG + upfront) * 100) / 100;
    // Monthly EMI = most frequent woGST value
    const freq = {};
    sched.forEach(r => { const v = r.woGST; freq[v] = (freq[v] || 0) + 1; });
    monthlyEmi = parseFloat(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
  }
  return stat('Monthly EMI', monthlyEmi, true) +
    stat('Principal', c.P) +
    stat('Total Interest', totI, false, c.gst ? 'excl. GST' : '') +
    (c.gst ? stat('Total GST (18%)', totG) : '') +
    stat('Grand Total', grand, false, c.charges > 0 && !c.chargesInc ? 'incl. &#8377;' + c.charges.toLocaleString('en-IN') + ' upfront charges' : '');
}

function refreshCalcSummary() {
  const banner = document.getElementById('emiResultBanner');
  if (!banner || !window._emiCalcResult) return;
  // Rebuild just the stats part (first child nodes before chargeNote)
  const c = window._emiCalcResult;
  const chargeNote = c.charges > 0
    ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(255,255,255,0.12);border-radius:8px;font-size:12px;margin-top:8px;width:100%">
        <span>Processing charges: <strong>${fmtCur(c.charges)}</strong></span>
        <span style="opacity:0.7"> - ${c.chargesInc ? 'financed (included in principal &#8377;' + c.P.toLocaleString('en-IN') + ')' : 'paid upfront (one-time, not in EMI)'}</span>
       </div>`
    : '';
  banner.innerHTML = buildCalcSummaryStats() + chargeNote;
}

function renderCalcSchedRows() {
  const s = window._emiCalcSchedule;
  if (!s) return '';
  return s.map((r, i) => `<tr style="background:${i%2===0?'var(--bg)':'var(--white)'}${r._edited?' outline:2px solid var(--amber) inset':''}">
    <td style="text-align:center;font-weight:600;font-family:var(--mono)">${r.m}</td>
    <td class="td-m">${r.interest.toFixed(2)}</td>
    <td class="td-m">${r.princ.toFixed(2)}</td>
    <td class="td-m" style="font-weight:700;color:${r._edited?'var(--amber)':'inherit'}">${(r.woGST||r.emi_amount||(r.interest+r.princ)).toFixed(2)} <button class="inst-edit-btn" title="Edit" onclick="showCalcRowEdit(${i})">Edit</button></td>
    <td class="td-m">${r.g.toFixed(2)}</td>
    <td class="td-m" style="font-weight:600">${r.bal.toFixed(2)}</td>
    <td style="text-align:center">${r._edited?'<span style="font-size:10px;color:var(--amber);font-weight:600">edited</span>':''}</td>
  </tr>`).join('');
}

function refreshCalcSchedTable() {
  const tbody = document.querySelector('#calcSchedTable tbody');
  if (tbody) tbody.innerHTML = renderCalcSchedRows();
}

function showCalcRowEdit(idx) {
  const row = window._emiCalcSchedule[idx];
  if (!row) return;
  const currentEmi = row.woGST || (row.interest + row.princ);
  showModal(
    '<div class="modal-title">Edit Month ' + row.m + '</div>' +
    '<label class="fl" style="flex-direction:row;align-items:center;gap:8px;margin-bottom:14px">' +
    '<input type="checkbox" id="calcAutoEmi" checked style="width:auto;margin:0" onchange="calcRowToggleMode()"> Auto-calculate EMI from Interest + Principal</label>' +
    '<div class="fg">' +
    '<label class="fl">Interest (&#8377;)<input class="fi" type="number" id="calcRowInterest" value="' + row.interest.toFixed(2) + '" step="0.01" oninput="calcRowLive()"></label>' +
    '<label class="fl">Principal (&#8377;)<input class="fi" type="number" id="calcRowPrinc" value="' + row.princ.toFixed(2) + '" step="0.01" oninput="calcRowLive()"></label>' +
    '</div>' +
    '<label class="fl" style="margin-top:8px">EMI Amount (&#8377;)<input class="fi" type="number" id="calcRowEmi" value="' + currentEmi.toFixed(2) + '" step="0.01" oninput="calcRowEmiLive()" readonly style="background:var(--bg);color:var(--t3)"></label>' +
    '<div id="calcRowPreview" style="background:var(--bg);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--t2);margin-top:4px"></div>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p" onclick="applyCalcRowEdit(' + idx + ')">Apply</button>' +
    '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
    '</div>'
  );
}

function calcRowToggleMode() {
  const auto = document.getElementById('calcAutoEmi').checked;
  const emiEl = document.getElementById('calcRowEmi');
  const intEl = document.getElementById('calcRowInterest');
  const prEl = document.getElementById('calcRowPrinc');
  if (auto) {
    emiEl.readOnly = true; emiEl.style.background = 'var(--bg)'; emiEl.style.color = 'var(--t3)';
    intEl.readOnly = false; intEl.style.background = ''; intEl.style.color = '';
    prEl.readOnly = false; prEl.style.background = ''; prEl.style.color = '';
    calcRowLive();
  } else {
    emiEl.readOnly = false; emiEl.style.background = ''; emiEl.style.color = '';
    intEl.readOnly = true; intEl.style.background = 'var(--bg)'; intEl.style.color = 'var(--t3)';
    prEl.readOnly = true; prEl.style.background = 'var(--bg)'; prEl.style.color = 'var(--t3)';
    calcRowEmiLive();
  }
}

function calcRowLive() {
  const i = parseFloat(document.getElementById('calcRowInterest').value) || 0;
  const p = parseFloat(document.getElementById('calcRowPrinc').value) || 0;
  const emi = Math.round((i + p) * 100) / 100;
  document.getElementById('calcRowEmi').value = emi.toFixed(2);
  document.getElementById('calcRowPreview').innerHTML = 'EMI = ' + i.toFixed(2) + ' + ' + p.toFixed(2) + ' = <strong>' + emi.toFixed(2) + '</strong>';
}

function calcRowEmiLive() {
  const i = parseFloat(document.getElementById('calcRowInterest').value) || 0;
  const emi = parseFloat(document.getElementById('calcRowEmi').value) || 0;
  const p = Math.round((emi - i) * 100) / 100;
  const el = document.getElementById('calcRowPreview');
  el.innerHTML = 'Principal = <strong>' + p.toFixed(2) + '</strong>' +
    (p < 0 ? ' <span style="color:var(--red)">(EMI less than interest)</span>' : '');
}

function applyCalcRowEdit(idx) {
  const row = window._emiCalcSchedule[idx];
  const auto = document.getElementById('calcAutoEmi').checked;
  const newInterest = parseFloat(document.getElementById('calcRowInterest').value) || 0;
  const newEmi = parseFloat(document.getElementById('calcRowEmi').value);
  if (!newEmi || newEmi <= 0) { toast('Enter a valid amount', 'warning'); return; }
  let newPrinc;
  if (auto) {
    newPrinc = parseFloat(document.getElementById('calcRowPrinc').value) || 0;
  } else {
    newPrinc = Math.round((newEmi - newInterest) * 100) / 100;
    if (newPrinc < 0) { toast('EMI cannot be less than interest (' + newInterest.toFixed(2) + ')', 'error'); return; }
  }
  row.interest = newInterest;
  row.princ = newPrinc;
  row.woGST = newEmi;
  const g = window._emiCalcResult?.gst ? Math.round(newInterest * 0.18 * 100) / 100 : 0;
  row.g = g;
  row.wGST = Math.round((newEmi + g) * 100) / 100;
  row._edited = true;
  closeModal();
  refreshCalcSchedTable();
  refreshCalcSummary();
  toast('Month ' + row.m + ' updated', 'success');
}

function showCalcBulkEdit() {
  const c = window._emiCalcResult;
  if (!c) return;
  showModal(
    '<div class="modal-title">Bulk Edit EMI Amount</div>' +
    '<p style="color:var(--t2);font-size:13px;margin-bottom:4px">Set one EMI amount for <strong>all months</strong>. Interest stays fixed per row; principal is recalculated for each.</p>' +
    '<label class="fl" style="margin-top:12px">New EMI Amount (&#8377;)<input class="fi" type="number" id="calcBulkEmi" value="' + c.emi.toFixed(2) + '" step="0.01"></label>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p" onclick="applyCalcBulkEdit()">Apply to All</button>' +
    '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
    '</div>'
  );
}

function applyCalcBulkEdit() {
  const newEmi = parseFloat(document.getElementById('calcBulkEmi').value);
  if (!newEmi || newEmi <= 0) { toast('Enter a valid amount', 'warning'); return; }
  const gstOn = window._emiCalcResult?.gst;
  let anyNeg = false;
  window._emiCalcSchedule.forEach(row => {
    const newPrinc = Math.round((newEmi - row.interest) * 100) / 100;
    if (newPrinc < 0) { anyNeg = true; return; }
    row.princ = newPrinc;
    row.woGST = newEmi;
    const g = gstOn ? Math.round(row.interest * 0.18 * 100) / 100 : 0;
    row.g = g;
    row.wGST = Math.round((newEmi + g) * 100) / 100;
    row._edited = true;
  });
  closeModal();
  refreshCalcSchedTable();
  refreshCalcSummary();
  if (anyNeg) toast('Some months have interest > new EMI - those rows were skipped', 'warning');
  else toast('All months updated to ' + fmtCur(newEmi), 'success');
}

async function saveEmiCalc(andActivate) {
  const c = window._emiCalcResult;
  if (!c) { toast('Calculate first', 'warning'); return; }
  const name = document.getElementById('emiName').value.trim();
  if (!name) { toast('Enter a loan name to save', 'warning'); document.getElementById('emiName').focus(); return; }
  const description = document.getElementById('emiDesc').value.trim();
  const tag = document.getElementById('emiTag').value.trim();

  const ccId = document.getElementById('emiCcId')?.value;
  const gstOffset = document.getElementById('emiGstOffset')?.value;
  const ccCharges    = parseFloat(document.getElementById('emiCcCharges')?.value) || 0;
  const ccChargesGst = parseFloat(document.getElementById('emiCcChargesGst')?.value) || 0;
  const plannerAdvanceMonth = document.getElementById('emiPlannerAdvance')?.checked;
  const body = {
    name, description, tag,
    principal: c.P, annual_rate: c.R, tenure_months: c.N,
    monthly_emi: c.emi, total_interest: c.totI,
    gst_rate: c.gst ? 18 : 0, total_gst: c.totG,
    total_amount: c.totAmt, grand_total: c.grand,
    planner_advance_month: plannerAdvanceMonth ? 1 : 0,
    credit_card_id: ccId ? parseInt(ccId) : null,
    gst_month_offset: (ccId && c.gst && gstOffset) ? parseInt(gstOffset) : 0,
    cc_processing_charge: ccId && ccCharges > 0 ? ccCharges : null,
    cc_processing_gst_pct: ccId && ccCharges > 0 && ccChargesGst > 0 ? ccChargesGst : null,
    // Store loan breakdown in description if not already set
    ...(c.charges > 0 && !description ? {
      description: `Loan: ${fmtCur(c.loanAmt)}, Charges: ${fmtCur(c.charges)} (${c.chargesInc ? 'financed' : 'upfront'})`
    } : {})
  };
  const r = await api('/api/emi/records', { method: 'POST', body });
  if (!r?.id) { toast(r?.error || 'Save failed', 'error'); return; }

  if (andActivate) {
    if (!_expenseCategories.length) await loadExpenseCategories();
    showModal(`<div class="modal-title">Activate EMI</div>
      <p style="color:var(--t2);font-size:14px;margin-bottom:16px">Choose the EMI start date. Installment schedule will be generated from this date.</p>
      <label class="fl">Start Date<input class="fi" type="date" id="emiStartDate" value="${new Date().toISOString().slice(0,10)}"></label>
      <label class="fl" style="flex-direction:row;align-items:center;gap:8px;margin-top:12px">
        <input type="checkbox" id="emiAddExpenses" checked style="width:auto;margin:0" onchange="_emiExpTypeToggle()"> Add installments to Expenses</label>
      <div id="emiExpTypeWrap" style="margin-top:10px">
        <label class="fl">Expense Type
          <select class="fi" id="emiExpType">
            <option value="0">Fair (Essential)</option>
            <option value="1">Extra (Discretionary)</option>
          </select>
        </label>
        <label class="fl">Expense Category${expenseCategoryDatalistHtml('')}</label>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-p" onclick="doActivateEmi(${r.id})">Activate</button>
        <button class="btn btn-g" onclick="closeModal()">Later</button>
      </div>`);
  } else {
    toast('EMI saved! Go to My EMIs to manage it.', 'success');
  }
}

async function doActivateEmi(id) {
  const start_date = document.getElementById('emiStartDate').value;
  if (!start_date) { toast('Pick a start date', 'warning'); return; }
  const add_expenses = document.getElementById('emiAddExpenses').checked;
  const expense_type = add_expenses ? parseInt(document.getElementById('emiExpType').value) : 0;
  const expense_category = add_expenses ? (document.getElementById('eCategory')?.value.trim() || null) : null;

  // Use custom schedule if any rows were edited in the calculator
  const sched = window._emiCalcSchedule;
  const hasEdits = sched && sched.some(r => r._edited);
  let res;
  if (hasEdits) {
    const schedule = sched.map(r => ({
      installment_no: r.m,
      principal_component: r.princ,
      interest_component: r.interest,
      gst_amount: r.g || 0,
      emi_amount: r.woGST || (r.princ + r.interest)
    }));
    res = await api(`/api/emi/records/${id}/activate-with-schedule`, { method: 'POST', body: { start_date, schedule, add_expenses, expense_type, expense_category } });
  } else {
    res = await api(`/api/emi/records/${id}/activate`, { method: 'POST', body: { start_date, add_expenses, expense_type, expense_category } });
  }

  if (res?.success) {
    closeModal();
    toast('EMI activated! Installments created.', 'success');
    setTimeout(() => switchTab('emitracker'), 800);
  } else toast(res?.error || 'Activation failed', 'error');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DASHBOARD
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _dashCharts = [];

async function loadDashboard() {
  const year = dashFilters.year;
  const data = await api(`/api/dashboard?year=${year}`);
  if (!data || data.error) {
    document.getElementById('main').innerHTML = `
      <div class="tab-content">
        <div class="section-card" style="padding:24px;color:var(--red)">
          ${escHtml(data?.error || 'Could not load dashboard')}
        </div>
      </div>
    `;
    return;
  }
  const monthTotal = data?.monthTotal || { total: 0, count: 0 };
  const yearTotal = data?.yearTotal || { total: 0, count: 0 };
  const monthlyTotals = Array.isArray(data.monthlyTotals) ? data.monthlyTotals : [];
  const monthlyByType = Array.isArray(data.monthlyByType) ? data.monthlyByType : [];
  const spendBreakdown = Array.isArray(data.spendBreakdown) ? data.spendBreakdown : [];
  const years = Array.isArray(data.years) ? data.years : [];
  const fixDashboardText = (value) => repairMojibakeText(String(value ?? '').trim());
  const topItems = (data.topItems || []).map((item) => ({
    ...item,
    item_name: fixDashboardText(item.item_name),
  }));
  const recentExpenses = (data.recentExpenses || []).map((expense) => ({
    ...expense,
    item_name: fixDashboardText(expense.item_name),
  }));

  // Destroy previous chart instances
  _dashCharts.forEach(c => c.destroy());
  _dashCharts = [];

  // Build 12-month arrays
  const monthly = Array(12).fill(0);
  const monthlyFair = Array(12).fill(0);
  const monthlyExtra = Array(12).fill(0);
  monthlyTotals.forEach(m => { monthly[parseInt(m.month) - 1] = m.total; });
  monthlyByType.forEach(m => {
    const i = parseInt(m.month) - 1;
    if (m.is_extra) monthlyExtra[i] = m.total;
    else monthlyFair[i] = m.total;
  });
  // Fallback: if byType returned nothing but totals exist, show all as fair
  if (monthlyFair.every(v => v === 0) && monthlyExtra.every(v => v === 0) && monthly.some(v => v > 0)) {
    monthly.forEach((v, i) => { monthlyFair[i] = v; });
    console.warn('monthlyByType empty - falling back to totals. API data:', data.monthlyByType);
  }

  let fairTotal = 0, extraTotal = 0;
  spendBreakdown.forEach(b => { if (b.is_extra) extraTotal = b.total; else fairTotal = b.total; });

  const yearOpts = (years.length ? years : [String(year)])
    .map(y => `<option value="${y}" ${y == year ? 'selected' : ''}>${y}</option>`).join('');

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="dash-header">
        <div>
          <h2 class="dash-title">Dashboard</h2>
          <div class="dash-subtitle">Financial overview at a glance</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:12px;color:var(--t3);font-weight:600">YEAR</label>
          <select class="search-input" style="min-width:0;width:90px" onchange="dashFilters.year=parseInt(this.value);loadDashboard()">${yearOpts}</select>
        </div>
      </div>

      <div class="dash-cards">
        <div class="dash-card">
          <div class="dc-label">This Month</div>
          <div class="dc-amount">${fmtCur(monthTotal.total)}</div>
          <div class="dc-sub">${monthTotal.count} expense${monthTotal.count !== 1 ? 's' : ''}</div>
        </div>
        <div class="dash-card">
          <div class="dc-label">This Year (${year})</div>
          <div class="dc-amount">${fmtCur(yearTotal.total)}</div>
          <div class="dc-sub">${yearTotal.count} expense${yearTotal.count !== 1 ? 's' : ''}</div>
        </div>
        <div class="dash-card dash-card-green">
          <div class="dc-label">You Are Owed</div>
          <div class="dc-amount" style="color:var(--green)">${fmtCur(data.totalOwed)}</div>
          <div class="dc-sub">${Number(data.owedCount || 0)} live split ${Number(data.owedCount || 0) === 1 ? 'friend' : 'friends'}</div>
        </div>
        <div class="dash-card dash-card-red">
          <div class="dc-label">You Owe</div>
          <div class="dc-amount" style="color:var(--red)">${fmtCur(data.totalOwe)}</div>
          <div class="dc-sub">${Number(data.oweCount || 0)} live split ${Number(data.oweCount || 0) === 1 ? 'friend' : 'friends'}</div>
        </div>
      </div>

      <div class="dash-box">
        <div class="dash-box-title">Monthly Spending - ${year}</div>
        <canvas id="chartMonthly" height="80"></canvas>
      </div>

      <div class="dash-two-col">
        <div class="dash-box">
          <div class="dash-box-title">Top Expenses</div>
          ${topItems.length ? `<canvas id="chartTop" height="220"></canvas>` : `<div class="empty-td">No data for ${year}</div>`}
        </div>
        <div class="dash-box">
          <div class="dash-box-title">Spending Breakdown</div>
          ${(fairTotal + extraTotal) > 0 ? `<div style="max-width:260px;margin:0 auto"><canvas id="chartBreak"></canvas></div>` : `<div class="empty-td">No data for ${year}</div>`}
        </div>
      </div>

      <div class="dash-box" style="margin-top:16px">
        <div class="dash-box-title">Recent Expenses</div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Item</th><th>Type</th><th class="td-m">Amount</th></tr></thead>
            <tbody>
              ${recentExpenses.length
                ? recentExpenses.map(e => `
                  <tr>
                    <td>${fmtDate(e.purchase_date)}</td>
                    <td>${e.item_name}</td>
                    <td><span class="badge ${e.is_extra ? 'b-extra' : 'b-fair'}">${e.is_extra ? 'Extra' : 'Regular'}</span></td>
                    <td class="td-m">${fmtCur(e.amount)}</td>
                  </tr>`).join('')
                : `<tr><td colspan="4" class="empty-td">No expenses yet</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  const palette = ['#145A3C','#1D7A52','#F0A030','#3B82F6','#7C5CDB','#C94444','#1D8A52','#F4C06E','#60A5FA','#9CA3B0'];

  // Monthly bar chart - stacked Regular + Extra
  _dashCharts.push(new Chart(document.getElementById('chartMonthly'), {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        {
          label: 'Fair',
          data: monthlyFair,
          backgroundColor: 'rgba(20,90,60,0.80)',
          borderRadius: 4,
          borderSkipped: false,
          stack: 'monthly',
        },
        {
          label: 'Extra',
          data: monthlyExtra,
          backgroundColor: '#F0A030',
          borderRadius: 4,
          borderSkipped: false,
          stack: 'monthly',
        }
      ]
    },
    options: {
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, padding: 16, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtCur(ctx.raw)}`,
            footer: items => ` Total: ${fmtCur(items.reduce((s, i) => s + i.raw, 0))}`
          }
        }
      },
      interaction: { mode: 'index' },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ticks: { callback: v => fmtCur(v) }, grid: { color: '#F0F1F4' } }
      }
    }
  }));

  // Top items horizontal bar
  if (topItems.length) {
    _dashCharts.push(new Chart(document.getElementById('chartTop'), {
      type: 'bar',
      data: {
        labels: topItems.map(i => i.item_name.length > 22 ? i.item_name.slice(0,22) + '...' : i.item_name),
        datasets: [{
          label: 'Total',
          data: topItems.map(i => i.total),
          backgroundColor: palette,
          borderRadius: 4,
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmtCur(ctx.raw) } } },
        scales: { x: { ticks: { callback: v => fmtCur(v) }, grid: { color: '#F0F1F4' } }, y: { grid: { display: false } } }
      }
    }));
  }

  // Donut breakdown
  if ((fairTotal + extraTotal) > 0) {
    _dashCharts.push(new Chart(document.getElementById('chartBreak'), {
      type: 'doughnut',
      data: {
        labels: ['Regular', 'Extra'],
        datasets: [{ data: [fairTotal, extraTotal], backgroundColor: ['#145A3C','#F0A030'], borderWidth: 0 }]
      },
      options: {
        cutout: '62%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => ' ' + fmtCur(ctx.raw) + ' (' + Math.round(ctx.raw / (fairTotal + extraTotal) * 100) + '%)' } }
        }
      }
    }));
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TRIPS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _trips = [];
let _selectedTripId = null;
let _tripDetail = null;
let tripsFilter = 'all';   // all | active | completed | i_owe | they_owe
let tripsPage = 1;
const TRIPS_PAGE_SIZE = 10;

// â”€â”€ Trip expense form state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _tripExpSel = new Set();    // member_key set
let _tripExpPaidBy = 'self';
let _tripExpMode = 'equal';
let _tripExpValues = {};
let _tripExpEditId = null;
let _tripEditCcTxnId = null;
let _tripEditCcLink = null;
let _tripFinalizePreview = [];
let _tripFinalizeLiveFriends = [];
let _tripBulkSel = new Set();
let _tripBulkMode = 'equal';
let _tripBulkValues = {};
let _tripCurrencies = null;
let _adminCurrencies = [];
const TRIP_BULK_SPLIT_MODES = SPLIT_MODES.filter((mode) => mode.key !== 'amount');

function _findTripExpenseById(expenseId) {
  if (!_tripDetail?.expenses?.length || expenseId == null) return null;
  return _tripDetail.expenses.find((expense) => String(expense.id) === String(expenseId)) || null;
}

async function loadTrips() {
  const data = await api('/api/trips');
  _trips = data?.trips || [];
  _selectedTripId = null;
  _tripDetail = null;
  renderTripList();
}

let _tripsFiltered = [];
function renderTripList() {
  const allTrips = _trips;
  let filtered = allTrips;
  if (tripsFilter === 'active') filtered = allTrips.filter(t => t.status === 'active');
  else if (tripsFilter === 'completed') filtered = allTrips.filter(t => t.status === 'completed');
  else if (tripsFilter === 'i_owe') filtered = allTrips.filter(t => t.selfNet < -0.01);
  else if (tripsFilter === 'they_owe') filtered = allTrips.filter(t => t.selfNet > 0.01);
  else if (tripsFilter === 'pending') filtered = allTrips.filter(t => Math.abs(t.selfNet) > 0.01);
  else if (tripsFilter === 'settled') filtered = allTrips.filter(t => Math.abs(t.selfNet) <= 0.01);
  _tripsFiltered = filtered;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / TRIPS_PAGE_SIZE));
  tripsPage = Math.min(tripsPage, totalPages);
  const start = (tripsPage - 1) * TRIPS_PAGE_SIZE;
  const page = filtered.slice(start, start + TRIPS_PAGE_SIZE);

  const filterChips = [
    ['all', 'All'], ['active', 'Active'], ['completed', 'Completed'],
    ['pending', 'Settlement Pending'], ['i_owe', 'I Owe'], ['they_owe', 'They Owe'], ['settled', 'Settled']
  ].map(([k, l]) => `<button class="chip ${tripsFilter === k ? 'active' : ''}" onclick="tripsFilter='${k}';tripsPage=1;renderTripList()">${l}</button>`).join('');

  const tripCards = page.map(t => {
    const statusBadge = t.status === 'completed'
      ? `<span style="font-size:10px;padding:2px 7px;background:var(--green-l);color:var(--green);border-radius:20px;font-weight:600">Completed</span>`
      : `<span style="font-size:10px;padding:2px 7px;background:var(--blue-l);color:var(--blue);border-radius:20px;font-weight:600">Active</span>`;
    const sharedBadge = !t.is_owner ? `<span style="font-size:10px;padding:2px 7px;background:#FFF3E0;color:#E65100;border-radius:20px;font-weight:600;margin-left:4px">Shared</span>` : '';
    const netColor = t.selfNet > 0.01 ? 'var(--green)' : t.selfNet < -0.01 ? 'var(--red)' : 'var(--t3)';
    const netLabel = t.selfNet > 0.01 ? `+${fmtCur(t.selfNet)} net` : t.selfNet < -0.01 ? `${fmtCur(Math.abs(t.selfNet))} owed` : 'Settled';
    const memberNames = t.members.map(m => m.member_name).join(', ');
    const dateStr = t.end_date ? `${fmtDate(t.start_date)} -> ${fmtDate(t.end_date)}` : `From ${fmtDate(t.start_date)}`;
    return `<div class="card" style="cursor:pointer;margin-bottom:10px" onclick="openTripDetail(${t.id})">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-size:16px;font-weight:700">${t.name} ${statusBadge}${sharedBadge}</div>
        <div style="font-size:16px;font-weight:700;color:${netColor}">${netLabel}</div>
      </div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:4px">${dateStr}</div>
      <div style="font-size:12px;color:var(--t3)">
        <span style="margin-right:12px">${t.members.length} members: ${memberNames}</span>
        <span>${fmtCur(t.totalExpenses)} total &middot; ${t.expenseCount} expense${t.expenseCount !== 1 ? 's' : ''}</span>
      </div>
    </div>`;
  }).join('') || `<div style="color:var(--t3);text-align:center;padding:40px">No trips found.</div>`;

  // Pagination
  let pagHtml = '';
  if (totalPages > 1) {
    pagHtml = `<div class="pagination" style="margin-top:14px">
      <button class="pg-btn" ${tripsPage <= 1 ? 'disabled' : ''} onclick="tripsPage=${tripsPage - 1};renderTripList()">&larr; Prev</button>
      <div class="pg-info">
        <span class="pg-range">${start + 1}&ndash;${Math.min(start + TRIPS_PAGE_SIZE, total)} of ${total}</span>
        <div class="pg-pages">
          ${paginationPages(tripsPage, totalPages).map((page) => page === '...'
            ? `<span class="pg-ellipsis">...</span>`
            : `<button class="pg-num ${page === tripsPage ? 'active' : ''}" onclick="tripsPage=${page};renderTripList()">${page}</button>`
          ).join('')}
        </div>
      </div>
      <button class="pg-btn" ${tripsPage >= totalPages ? 'disabled' : ''} onclick="tripsPage=${tripsPage + 1};renderTripList()">Next &rarr;</button>
    </div>`;
  }

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:20px;font-weight:700">Trips</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadTripsPdf(_tripsFiltered)">PDF</button>
          <button class="btn btn-p btn-sm" onclick="showCreateTripModal()">+ New Trip</button>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">${filterChips}</div>
      ${tripCards}
      ${pagHtml}
    </div>`;
}

async function openTripDetail(tripId) {
  _selectedTripId = tripId;
  const data = await api(`/api/trips/${tripId}`);
  if (!data?.trip) { toast('Trip not found', 'error'); return; }
  _tripDetail = data.trip;
  _tripExpSel = new Set(_tripDetail.members.map(m => _memberKey(m)));
  // For linked (non-owner) members, default paid-by to their own member key
  const _myMem = !data.trip.isOwner ? data.trip.members.find(m => m.linked_user_id === _currentUserId) : null;
  _tripExpPaidBy = _myMem ? _memberKey(_myMem) : 'self';
  _tripExpMode = 'equal';
  _tripExpValues = {};
  _tripExpEditId = null;
  renderTripDetail();
}

async function renderTripDetail() {
  await getCcCardsForForm();
  const trip = _tripDetail;
  if (!trip) return;

  // â”€â”€ Build member keyâ†’name map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const memberMap = {};
  trip.members.forEach(m => {
    const key = _memberKey(m);
    memberMap[key] = { name: m.member_name, id: m.id, locked: m.is_locked };
  });
  // Determine current user's member key (for linked members)
  const myLinkedMember = !trip.isOwner ? trip.members.find(m => m.linked_user_id === _currentUserId) : null;
  const myMemberKey = trip.isOwner ? 'self' : (myLinkedMember ? _memberKey(myLinkedMember) : 'self');
  const canEdit = trip.isOwner || trip.userPermission !== 'view';
  const canMutateExpenses = canEdit && trip.status === 'active';

  // â”€â”€ Paid-by chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const paidByChips = trip.members.map(m => {
    const key = _memberKey(m);
    return `<button class="chip ${_tripExpPaidBy === key ? 'active' : ''}" onclick="tripSetPaidBy('${key}')">${m.member_name}</button>`;
  }).join('');

  // â”€â”€ Divide-between chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const divChips = trip.members.map(m => {
    const key = _memberKey(m);
    const sel = _tripExpSel.has(key);
    return `<button class="fr-chip ${sel ? 'sel' : ''}" onclick="tripToggleMember('${key}')">
      <span class="cbox ${sel ? 'chk' : ''}">${sel ? '&#10003;' : ''}</span>${m.member_name}
    </button>`;
  }).join('');

  // â”€â”€ Split mode chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const splitChips = SPLIT_MODES.map(m =>
    `<button class="chip split-mode-chip ${_tripExpMode === m.key ? 'active' : ''}" data-mode="${m.key}" onclick="tripSetSplitMode('${m.key}')">${m.label}</button>`
  ).join('');

  // â”€â”€ Expenses table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let expensesHtml = '';
  if (trip.expenses.length > 0) {
    const rows = trip.expenses.map(e => {
      const editing = _tripExpEditId != null && String(_tripExpEditId) === String(e.id);
      const splitSummary = e.splits.map(s => `${s.member_name}: ${fmtCur(s.share_amount)}`).join(', ');
      return `<tr style="${editing ? 'background:var(--blue-l)' : ''}">
        <td>${fmtDate(e.expense_date)}</td>
        <td>${e.details}</td>
        <td style="font-weight:600">${e.paid_by_name}</td>
        <td class="td-m">${fmtCur(e.amount)}<span style="font-size:10px;color:var(--t3);margin-left:4px">${e.split_mode !== 'equal' ? '(' + e.split_mode + ')' : ''}</span></td>
        <td style="font-size:11px;color:var(--t2)">${splitSummary}</td>
        <td>
          ${canMutateExpenses ? `<button class="btn-d" style="color:var(--em)" onclick="tripEditExpense(${e.id})">Edit</button>
          <button class="btn-d" onclick="tripDeleteExpense(${e.id})">Del</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    expensesHtml = `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Details</th><th>Paid By</th><th class="td-m">Amount</th><th>Split</th><th style="width:90px">Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  } else {
    expensesHtml = `<div style="color:var(--t3);text-align:center;padding:20px">No expenses yet.</div>`;
  }

  // â”€â”€ Settlement summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const peopleMap = {};
  trip.members.forEach(m => {
    const key = _memberKey(m);
    peopleMap[key] = { name: m.member_name, totalShare: 0, totalGave: 0 };
  });
  trip.expenses.forEach(e => {
    e.splits.forEach(s => { if (peopleMap[s.member_key]) peopleMap[s.member_key].totalShare += s.share_amount; });
    if (peopleMap[e.paid_by_key]) peopleMap[e.paid_by_key].totalGave += e.amount;
  });
  const settleRows = Object.entries(peopleMap).sort(([a],[b]) => a === myMemberKey ? -1 : b === myMemberKey ? 1 : 0).map(([key, p]) => {
    const isSelf = key === myMemberKey;
    const net = p.totalGave - p.totalShare;
    const netColor = net > 0.005 ? 'var(--green)' : net < -0.005 ? 'var(--red)' : 'var(--t3)';
    const netLabel = net > 0.005 ? `+${fmtCur(net)} (overpaid)` : net < -0.005 ? `${fmtCur(Math.abs(net))} owed` : 'Settled';
    return `<tr style="${isSelf ? 'background:var(--blue-l);font-style:italic' : ''}">
      <td style="font-weight:600">${p.name}${isSelf ? ' (me)' : ''}</td>
      <td class="td-m">${fmtCur(p.totalShare)}</td>
      <td class="td-m" style="color:var(--green)">${p.totalGave > 0 ? fmtCur(p.totalGave) : '-'}</td>
      <td class="td-m" style="font-weight:600;color:${netColor}">${netLabel}</td>
    </tr>`;
  }).join('');

  // â”€â”€ Member management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const memberRows = trip.members.map(m => {
    const lockIcon = m.is_locked ? 'Locked' : 'Lock';
    const lockLabel = m.is_locked ? 'Locked' : 'Lock';
    const linkedBadge = m.linked_user_id
      ? `<span style="font-size:10px;padding:1px 5px;background:var(--em-xl);color:var(--em);border-radius:8px;margin-left:3px" title="Linked to app user">Linked</span>`
      : '';
    const linkBtn = trip.isOwner && m.friend_id !== null
      ? `<button style="background:none;border:none;cursor:pointer;font-size:10px;color:var(--t2);padding:0 0 0 4px" onclick="tripShowLinkModal(${m.id},'${m.member_name.replace(/'/g,"\\'")}',${m.linked_user_id||'null'})" title="Link/Invite member">Link</button>`
      : '';
    return `<span style="display:inline-flex;align-items:center;gap:2px;background:var(--bg2);border:1px solid var(--br);border-radius:20px;padding:3px 10px;font-size:12px;margin:2px">
      ${m.member_name}${linkedBadge}
      ${m.friend_id !== null && trip.isOwner ? `<button style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--t2);padding:0 0 0 2px" onclick="tripToggleLock(${m.id})" title="${lockLabel}">${lockIcon}</button>` : ''}
      ${linkBtn}
    </span>`;
  }).join('');

  const statusBadgeHtml = trip.status === 'completed'
    ? `<span style="font-size:11px;padding:3px 8px;background:var(--green-l);color:var(--green);border-radius:20px;font-weight:600">Completed</span>`
    : `<span style="font-size:11px;padding:3px 8px;background:var(--blue-l);color:var(--blue);border-radius:20px;font-weight:600">Active</span>`;

  const editingExp = _findTripExpenseById(_tripExpEditId);

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <button class="btn btn-g btn-sm" onclick="loadTrips()">Back</button>
        <div style="font-size:20px;font-weight:700;flex:1">${trip.name} ${statusBadgeHtml}</div>
        <button class="btn btn-s btn-sm" onclick="downloadTripDetailPdf()">PDF</button>
      </div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:10px">${trip.end_date ? fmtDate(trip.start_date) + ' -> ' + fmtDate(trip.end_date) : 'From ' + fmtDate(trip.start_date)}</div>

      <!-- Member Summary -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        ${Object.entries(peopleMap).map(([key, p]) => {
          const net = p.totalGave - p.totalShare;
          const netColor = net > 0.005 ? 'var(--green)' : net < -0.005 ? 'var(--red)' : 'var(--t3)';
          const netLabel = net > 0.005 ? `+${fmtCur(net)}` : net < -0.005 ? `-${fmtCur(Math.abs(net))}` : 'Settled';
          return `<div style="border:1px solid var(--line);border-radius:10px;padding:8px 12px;background:#fff;min-width:130px;flex:1">
            <div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:5px">${p.name}</div>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              <div style="font-size:11px;color:var(--t3)">Paid<div style="font-size:13px;font-weight:600;color:var(--green)">${p.totalGave > 0 ? fmtCur(p.totalGave) : '&#8212;'}</div></div>
              <div style="font-size:11px;color:var(--t3)">Share<div style="font-size:13px;font-weight:600;color:var(--t1)">${fmtCur(p.totalShare)}</div></div>
              <div style="font-size:11px;color:var(--t3)">Net<div style="font-size:13px;font-weight:600;color:${netColor}">${netLabel}</div></div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div style="margin-bottom:14px">${memberRows}</div>

      <!-- Add Expense Form (only for edit-permission users) -->
      ${canMutateExpenses ? `<div class="card" style="margin-bottom:16px">
        <div class="card-title">${editingExp ? 'Edit Expense' : 'Add Expense'}</div>
        <div class="fg">
          <label class="fl">Date<input class="fi" type="date" id="teDate" value="${editingExp?.expense_date || todayStr()}"></label>
          <label class="fl">Amount (&#8377;)<input class="fi" type="number" step="0.01" id="teAmount" value="${editingExp?.amount || ''}" placeholder="0.00" oninput="tripHandleAmountChange()"></label>
          <label class="fl full">Details *<input class="fi" id="teDetails" value="${editingExp?.details || ''}" placeholder="e.g. Dinner, Hotel..."></label>
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:6px">Paid By</div>
          <div>${paidByChips}</div>
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:6px">Divide Between</div>
          <div id="tripDivChips">${divChips}</div>
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:6px">Split Mode</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${splitChips}</div>
        </div>
        <div id="tripSplitInputs"></div>
        ${ccFormSection(editingExp ? _tripEditCcLink : null)}
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-p" onclick="tripSaveExpense()">${editingExp ? 'Update' : 'Add Expense'}</button>
          ${editingExp ? `<button class="btn btn-g" onclick="_tripExpEditId=null;_tripExpMode='equal';_tripExpValues={};_tripEditCcTxnId=null;_tripEditCcLink=null;renderTripDetail()">Cancel</button>` : ''}
        </div>
      </div>` : ''}

      <!-- Expenses List -->
      <div style="font-size:14px;font-weight:700;margin-bottom:8px">Expenses</div>
      ${expensesHtml}

      <!-- Settlement Summary -->
      <div style="margin-top:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:14px;font-weight:700">Settlement Summary</div>
          <div style="display:flex;gap:8px">
            ${trip.isOwner && trip.status === 'active' ? `<button class="btn btn-p btn-sm" onclick="tripFinalizeModal()">Finalize Trip</button>` : ''}
            ${trip.isOwner ? (trip.status === 'active' ? `<button class="btn btn-g btn-sm" onclick="tripMarkComplete()">Mark Complete</button>` : `<button class="btn btn-g btn-sm" onclick="tripMarkActive()">Re-open</button>`) : ''}
            ${trip.isOwner ? `<button class="btn-d" style="color:var(--red);font-size:12px" onclick="tripDelete()">Delete Trip</button>` : ''}
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Member</th><th class="td-m">Share (Owes)</th><th class="td-m">Paid</th><th class="td-m">Net Balance</th></tr></thead>
          <tbody>${settleRows}</tbody>
        </table></div>
      </div>
    </div>`;

  tripUpdateSplitInputs();
}

// â”€â”€ Trip form helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function tripSetPaidBy(key) {
  _tripExpPaidBy = key;
  // Simplest: just re-render (form state preserved in variables)
  const trip = _tripDetail;
  if (!trip) return;
  // Rebuild just the paid-by chips
  renderTripDetail();
}

function tripToggleMember(key) {
  if (_tripExpSel.has(key)) _tripExpSel.delete(key);
  else _tripExpSel.add(key);
  // Update chip DOM
  const container = document.getElementById('tripDivChips');
  if (container) {
    container.querySelectorAll('.fr-chip').forEach(btn => {
      const match = btn.getAttribute('onclick')?.match(/tripToggleMember\('(.+?)'\)/);
      if (!match) return;
      const chipKey = match[1];
      const sel = _tripExpSel.has(chipKey);
      btn.classList.toggle('sel', sel);
      const cbox = btn.querySelector('.cbox');
      if (cbox) { cbox.classList.toggle('chk', sel); cbox.innerHTML = sel ? '&#10003;' : ''; }
    });
  }
  _tripExpValues = {};
  const amt = parseFloat(document.getElementById('teAmount')?.value || 0);
  const people = _tripSelectedPeople();
  if (people.length > 0 && amt > 0 && _tripExpMode !== 'equal') _tripExpValues = _autoFillSplitValues(_tripExpMode, people, amt);
  tripUpdateSplitInputs();
}

function tripSetSplitMode(mode) {
  _tripExpMode = mode;
  _tripExpValues = {};
  const amt = parseFloat((document.getElementById('teAmount') || document.getElementById('tripExpenseAmount'))?.value || 0);
  const people = _tripSelectedPeople();
  if (people.length > 0 && amt > 0) _tripExpValues = _autoFillSplitValues(mode, people, amt);
  document.querySelectorAll('.split-mode-chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
  tripUpdateSplitInputs();
}

function tripBulkToggleMember(key) {
  if (_tripBulkSel.has(key)) _tripBulkSel.delete(key);
  else _tripBulkSel.add(key);
  const container = document.getElementById('tripBulkDivChips');
  if (container) {
    container.querySelectorAll('.fr-chip').forEach((btn) => {
      const match = btn.getAttribute('onclick')?.match(/tripBulkToggleMember\('(.+?)'\)/);
      if (!match) return;
      const chipKey = match[1];
      const selected = _tripBulkSel.has(chipKey);
      btn.classList.toggle('sel', selected);
      const cbox = btn.querySelector('.cbox');
      if (cbox) { cbox.classList.toggle('chk', selected); cbox.innerHTML = selected ? '&#10003;' : ''; }
    });
  }
  _tripBulkValues = {};
  const people = _tripBulkSelectedPeople();
  const baseAmount = _tripBulkMode === 'fraction' ? 1 : 100;
  if (people.length > 0 && _tripBulkMode !== 'equal') _tripBulkValues = _autoFillSplitValues(_tripBulkMode, people, baseAmount);
  tripBulkUpdateInputs();
}

function tripBulkSetSplitMode(mode) {
  _tripBulkMode = mode;
  _tripBulkValues = {};
  const people = _tripBulkSelectedPeople();
  const baseAmount = mode === 'fraction' ? 1 : 100;
  if (people.length > 0 && mode !== 'equal') _tripBulkValues = _autoFillSplitValues(mode, people, baseAmount);
  document.querySelectorAll('.trip-bulk-split-mode-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.mode === mode));
  tripBulkUpdateInputs();
}

function tripHandleAmountChange() {
  const totalInput = document.getElementById('teAmount') || document.getElementById('tripExpenseAmount');
  const amt = parseFloat(totalInput?.value || 0);
  const defaultCurrencyCode = _currentUser?.currency_code || 'INR';
  const originalCurrencyInput = document.getElementById('tripExpenseOrigCurrency');
  const originalAmountInput = document.getElementById('tripExpenseOrigAmount');
  const rateInput = document.getElementById('tripExpenseConversionRateView');
  if (originalCurrencyInput && originalAmountInput) {
    if ((originalCurrencyInput.value || defaultCurrencyCode) === defaultCurrencyCode) {
      if (rateInput) rateInput.value = formatTripCurrencyHint(defaultCurrencyCode);
      if (totalInput) originalAmountInput.value = totalInput.value || '';
    } else if (rateInput) {
      rateInput.value = formatTripCurrencyHint(originalCurrencyInput.value || defaultCurrencyCode);
    }
  }
  const people = _tripSelectedPeople();
  if (_tripExpMode !== 'equal') {
    _tripExpValues = {};
    if (people.length > 0 && amt > 0) _tripExpValues = _autoFillSplitValues(_tripExpMode, people, amt);
  }
  tripUpdateSplitInputs();
}

function _tripSelectedPeople() {
  return _tripSelectedPeopleFrom(_tripExpSel);
}

function _tripSelectedPeopleFrom(selection) {
  if (!_tripDetail) return [];
  return _tripDetail.members
    .filter(m => {
      const key = _memberKey(m);
      return selection.has(key);
    })
    .map(m => {
      const key = _memberKey(m);
      return { key, name: m.member_name };
    });
}

function _tripBulkSelectedPeople() {
  return _tripSelectedPeopleFrom(_tripBulkSel);
}

function tripUpdateSplitInputs() {
  const el = document.getElementById('tripSplitInputs') || document.getElementById('tripExpenseSplitInputs');
  if (!el) return;
  const amt = parseFloat((document.getElementById('teAmount') || document.getElementById('tripExpenseAmount'))?.value || 0);
  const people = _tripSelectedPeople();
  if (people.length === 0 || amt <= 0) { el.innerHTML = ''; return; }

  if (_tripExpMode === 'equal') {
    const pp = Math.round((amt / people.length) * 100) / 100;
    el.innerHTML = `<div class="preview-box" style="margin-bottom:12px">Split equally among <b>${people.length}</b> - Per person: <b>${fmtCur(pp)}</b></div>`;
    return;
  }

  const hints = { percent: '(%, total must be 100)', fraction: '(fraction, total must be 1.0)', amount: '(&#8377;, total must match)', parts: '(ratio, proportional)' };
  const rows = people.map(p => {
    const val = _tripExpValues[p.key] !== undefined ? _tripExpValues[p.key] : '';
    return `<tr>
      <td style="padding:4px 8px">${p.name}</td>
      <td style="padding:4px 8px"><input type="number" step="any" data-pkey="${p.key}" style="width:90px;padding:4px 6px;border:1px solid var(--br);border-radius:4px;background:var(--bg2);color:var(--t1)" value="${val}" oninput="tripOnSplitInput(this,'${p.key}')"></td>
    </tr>`;
  }).join('');

  const { valid, error } = computeShares(amt, _tripExpMode, people, _tripExpValues);
  const statusHtml = valid
    ? `<span style="color:var(--green);font-weight:600">Valid split</span>`
    : `<span style="color:var(--red)">${error}</span>`;

  el.innerHTML = `<div style="margin-bottom:12px">
    <div style="font-size:12px;color:var(--t2);margin-bottom:6px">Enter values per person ${hints[_tripExpMode] || ''}</div>
    <table style="border-collapse:collapse"><tbody>${rows}</tbody>
      <tr id="tripSplitStatusRow"><td colspan="2" style="padding:6px 8px">${statusHtml}</td></tr>
    </table>
  </div>`;
}

function tripOnSplitInput(input, pkey) {
  _tripExpValues[pkey] = parseFloat(input.value) || 0;
  const statusRow = document.getElementById('tripSplitStatusRow');
  if (!statusRow) return;
  const amt = parseFloat((document.getElementById('teAmount') || document.getElementById('tripExpenseAmount'))?.value || 0);
  const people = _tripSelectedPeople();
  const { valid, error } = computeShares(amt, _tripExpMode, people, _tripExpValues);

  let balanceHtml = '';
  if (!valid && _tripExpMode !== 'equal' && _tripExpMode !== 'parts') {
    const othersSum = people.filter(p => p.key !== pkey).reduce((s, p) => s + (_tripExpValues[p.key] || 0), 0);
    const target = _tripExpMode === 'percent' ? 100 : _tripExpMode === 'fraction' ? 1 : amt;
    const remaining = Math.round((target - othersSum) * 10000) / 10000;
    if (remaining > 0) {
      const label = _tripExpMode === 'percent' ? `${remaining}%` : _tripExpMode === 'fraction' ? remaining : fmtCur(remaining);
      balanceHtml = ` &nbsp;<button style="font-size:11px;padding:2px 8px;border:1px solid var(--br);border-radius:4px;background:var(--bg2);cursor:pointer;color:var(--t1)" onclick="tripSetRemaining('${pkey}',${remaining})">Set balance: ${label}</button>`;
    }
  }

  statusRow.querySelector('td').innerHTML = valid
    ? `<span style="color:var(--green);font-weight:600">Valid split</span>`
    : `<span style="color:var(--red)">${error}</span>${balanceHtml}`;
}

function tripSetRemaining(pkey, remaining) {
  _tripExpValues[pkey] = remaining;
  const input = document.querySelector(`#tripSplitInputs input[data-pkey="${pkey}"]`);
  if (input) input.value = remaining;
  const statusRow = document.getElementById('tripSplitStatusRow');
  if (!statusRow) return;
  const amt = parseFloat((document.getElementById('teAmount') || document.getElementById('tripExpenseAmount'))?.value || 0);
  const people = _tripSelectedPeople();
  const { valid, error } = computeShares(amt, _tripExpMode, people, _tripExpValues);
  statusRow.querySelector('td').innerHTML = valid
    ? `<span style="color:var(--green);font-weight:600">Valid split</span>`
    : `<span style="color:var(--red)">${error}</span>`;
}

function tripBulkUpdateInputs() {
  const el = document.getElementById('tripBulkSplitInputs');
  if (!el) return;
  const people = _tripBulkSelectedPeople();
  if (people.length === 0) {
    el.innerHTML = '<div style="font-size:12px;color:var(--t3)">Select at least one member to update trip shares.</div>';
    return;
  }
  if (_tripBulkMode === 'equal') {
    const sample = computeShares(100, 'equal', people, {});
    const preview = sample.valid && sample.shares.length
      ? sample.shares.map((share) => `${share.name}: ${share.share.toFixed(2)}%`).join(' | ')
      : '';
    el.innerHTML = `<div class="preview-box" style="margin-bottom:12px">Every trip expense will be split equally among <b>${people.length}</b> members.${preview ? `<div style="margin-top:6px;color:var(--t2)">${preview}</div>` : ''}</div>`;
    return;
  }
  const baseAmount = _tripBulkMode === 'fraction' ? 1 : 100;
  const hints = { percent: '(%, total must be 100)', fraction: '(fraction, total must be 1.0)', parts: '(ratio, proportional)' };
  const rows = people.map((person) => {
    const val = _tripBulkValues[person.key] !== undefined ? _tripBulkValues[person.key] : '';
    return `<tr>
      <td style="padding:4px 8px">${person.name}</td>
      <td style="padding:4px 8px"><input type="number" step="any" data-pkey="${person.key}" style="width:90px;padding:4px 6px;border:1px solid var(--br);border-radius:4px;background:var(--bg2);color:var(--t1)" value="${val}" oninput="tripBulkOnSplitInput(this,'${person.key}')"></td>
    </tr>`;
  }).join('');
  const { valid, error } = computeShares(baseAmount, _tripBulkMode, people, _tripBulkValues);
  const statusHtml = valid
    ? '<span style="color:var(--green);font-weight:600">Valid bulk share rule</span>'
    : `<span style="color:var(--red)">${error}</span>`;
  el.innerHTML = `<div style="margin-bottom:12px">
    <div style="font-size:12px;color:var(--t2);margin-bottom:6px">Enter values per person ${hints[_tripBulkMode] || ''}</div>
    <table style="border-collapse:collapse"><tbody>${rows}</tbody>
      <tr id="tripBulkSplitStatusRow"><td colspan="2" style="padding:6px 8px">${statusHtml}</td></tr>
    </table>
  </div>`;
}

function tripBulkOnSplitInput(input, pkey) {
  _tripBulkValues[pkey] = parseFloat(input.value) || 0;
  const statusRow = document.getElementById('tripBulkSplitStatusRow');
  if (!statusRow) return;
  const people = _tripBulkSelectedPeople();
  const baseAmount = _tripBulkMode === 'fraction' ? 1 : 100;
  const { valid, error } = computeShares(baseAmount, _tripBulkMode, people, _tripBulkValues);
  statusRow.querySelector('td').innerHTML = valid
    ? '<span style="color:var(--green);font-weight:600">Valid bulk share rule</span>'
    : `<span style="color:var(--red)">${error}</span>`;
}

function showTripBulkShareModal() {
  if (!_tripDetail) return;
  const members = _tripDetail.members || [];
  if (!members.length) {
    toast('Add trip members first', 'warning');
    return;
  }
  if (!(_tripDetail.expenses || []).length) {
    toast('No trip expenses to update', 'warning');
    return;
  }
  _tripBulkSel = new Set(members.map((member) => _memberKey(member)));
  _tripBulkMode = 'equal';
  _tripBulkValues = {};
  const participantChips = members.map((member) => {
    const key = _memberKey(member);
    const selected = _tripBulkSel.has(key);
    return `<button type="button" class="fr-chip ${selected ? 'sel' : ''}" onclick="tripBulkToggleMember('${key}')">
      <span class="cbox ${selected ? 'chk' : ''}">${selected ? '&#10003;' : ''}</span>${escHtml(member.member_name)}
    </button>`;
  }).join('');
  const splitModeChips = TRIP_BULK_SPLIT_MODES.map((mode) =>
    `<button class="chip trip-bulk-split-mode-chip ${_tripBulkMode === mode.key ? 'active' : ''}" data-mode="${mode.key}" onclick="tripBulkSetSplitMode('${mode.key}')">${mode.label}</button>`
  ).join('');
  openModal('Bulk Update Trip Shares', `
    <div style="font-size:12px;color:var(--t2);line-height:1.5;margin-bottom:14px">
      Apply one split rule to <b>${(_tripDetail.expenses || []).length}</b> expenses in this trip. This updates only the split mode and member shares for every expense. Amount, details, date, and paid by stay unchanged.
    </div>
    <div class="card" style="padding:14px 16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px">Share Expense With Members</div>
      <div id="tripBulkDivChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${participantChips}</div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:6px">Split Mode</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${splitModeChips}</div>
      <div id="tripBulkSplitInputs"></div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="saveTripBulkShareModal()">Update All Expenses</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>
  `);
  tripBulkUpdateInputs();
}

async function saveTripBulkShareModal() {
  if (!_selectedTripId) return;
  const people = _tripBulkSelectedPeople();
  if (!people.length) {
    toast('Select at least one member', 'warning');
    return;
  }
  const baseAmount = _tripBulkMode === 'fraction' ? 1 : 100;
  const { valid, error } = computeShares(baseAmount, _tripBulkMode, people, _tripBulkValues);
  if (!valid) {
    toast(error || 'Invalid bulk share rule', 'warning');
    return;
  }
  const result = await api(`/api/trips/${_selectedTripId}/expenses/bulk-share`, {
    method: 'POST',
    body: {
      split_mode: _tripBulkMode,
      member_keys: people.map((person) => person.key),
      split_values: _tripBulkValues,
    },
  });
  if (result?.error) {
    toast(result.error, 'error');
    return;
  }
  closeModal();
  toast('Trip shares updated for all expenses', 'success');
  await openTripDetail(_selectedTripId);
}

async function tripSaveExpense() {
  const details = document.getElementById('teDetails').value.trim();
  const amt = parseFloat(document.getElementById('teAmount').value);
  const date = document.getElementById('teDate').value || todayStr();
  if (!details) { toast('Enter details', 'warning'); return; }
  if (!amt || amt <= 0) { toast('Enter a valid amount', 'warning'); return; }
  if (_tripExpSel.size === 0) { toast('Select at least one person', 'warning'); return; }
  if (!_tripExpSel.has(_tripExpPaidBy)) { toast('Paid by must also be selected in Divide Between', 'warning'); return; }

  const people = _tripSelectedPeople();
  const { valid, error, shares } = computeShares(amt, _tripExpMode, people, _tripExpValues);
  if (!valid) { toast(error || 'Invalid split', 'warning'); return; }

  const paidByName = _tripDetail.members.find(m => {
    const key = _memberKey(m);
    return key === _tripExpPaidBy;
  })?.member_name || 'Unknown';

  const body = {
    paid_by_key: _tripExpPaidBy,
    paid_by_name: paidByName,
    details, amount: amt, expense_date: date,
    split_mode: _tripExpMode,
    splits: shares.map(s => ({ member_key: s.key, member_name: s.name, share_amount: s.share })),
  };

  if (_tripExpEditId) {
    await api(`/api/trips/${_selectedTripId}/expenses/${_tripExpEditId}`, { method: 'PUT', body });
    const ccChecked = document.getElementById('ccLink')?.checked;
    if (ccChecked) {
      const cardId = parseInt(document.getElementById('ccLinkCard')?.value);
      const discPct = parseFloat(document.getElementById('ccLinkDisc')?.value) || 0;
      if (_tripEditCcTxnId && _tripEditCcLink?.card_id == cardId) {
        await api(`/api/cc/txns/${_tripEditCcTxnId}`, { method: 'PUT', body: { discount_pct: discPct, txn_date: date, description: details, amount: amt } });
      } else {
        if (_tripEditCcTxnId) await api(`/api/cc/txns/${_tripEditCcTxnId}`, { method: 'DELETE' });
        await saveCcLinkIfChecked(details, amt, date, 'trip', _tripExpEditId);
      }
    } else if (_tripEditCcTxnId) {
      await api(`/api/cc/txns/${_tripEditCcTxnId}`, { method: 'DELETE' });
    }
    toast('Expense updated', 'success');
  } else {
    const r = await api(`/api/trips/${_selectedTripId}/expenses`, { method: 'POST', body });
    await saveCcLinkIfChecked(details, amt, date, 'trip', r?.id);
    toast('Expense added', 'success');
  }

  _tripExpEditId = null;
  _tripExpMode = 'equal';
  _tripExpValues = {};
  _tripEditCcTxnId = null;
  _tripEditCcLink = null;
  await openTripDetail(_selectedTripId);
}

async function tripEditExpense(expId) {
  const exp = _findTripExpenseById(expId);
  if (!exp) return;
  _tripExpEditId = exp.id;
  _tripExpPaidBy = exp.paid_by_key;
  _tripExpMode = exp.split_mode || 'equal';
  _tripExpSel = new Set(exp.splits.map(s => s.member_key));
  _tripExpValues = _restoreSplitValues(
    _tripExpMode,
    (exp.splits || []).map(s => ({ key: s.member_key, share: s.share_amount })),
    parseFloat(exp.amount) || 0
  );
  _tripEditCcTxnId = null;
  _tripEditCcLink = null;
  await getCcCardsForForm();
  const ccData = await api(`/api/cc/txns/by-source?source=trip&source_id=${expId}`);
  if (ccData?.txn) {
    _tripEditCcLink = ccData.txn;
    _tripEditCcTxnId = ccData.txn.id;
  }
  renderTripDetail();
  document.getElementById('main').scrollTop = 0;
}

async function tripDeleteExpense(expId) {
  if (!await confirmDialog('Delete this expense?')) return;
  await api(`/api/trips/${_selectedTripId}/expenses/${expId}`, { method: 'DELETE' });
  toast('Deleted', 'success');
  await openTripDetail(_selectedTripId);
}

async function tripToggleLock(memberId) {
  await api(`/api/trips/${_selectedTripId}/members/${memberId}/lock`, { method: 'PUT' });
  await openTripDetail(_selectedTripId);
}

async function tripMarkComplete() {
  await api(`/api/trips/${_selectedTripId}`, { method: 'PUT', body: { status: 'completed' } });
  await openTripDetail(_selectedTripId);
  toast('Trip marked as completed', 'success');
}

async function tripMarkActive() {
  await api(`/api/trips/${_selectedTripId}`, { method: 'PUT', body: { status: 'active' } });
  await openTripDetail(_selectedTripId);
  toast('Trip re-opened', 'success');
}

async function tripDelete() {
  if (!await confirmDialog(`Delete trip "${_tripDetail.name}" and all its expenses?`)) return;
  await api(`/api/trips/${_selectedTripId}`, { method: 'DELETE' });
  toast('Trip deleted', 'success');
  loadTrips();
}

// â”€â”€ Finalize Trip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function tripFinalizeModal() {
  if (!_expenseCategories.length) await loadExpenseCategories();
  const trip = _tripDetail;
  const liveFriendsData = await api('/api/live-split/friends');
  _tripFinalizeLiveFriends = liveFriendsData?.friends || [];
  _tripFinalizePreview = buildTripSettlementPreview(trip, _tripFinalizeLiveFriends);

  const previewRows = _tripFinalizePreview.map((person) => {
    const isSelf = !!person.isSelf;
    const needsSettlement = Math.abs(person.net) > 0.005;
    const alreadyPaidText = person.totalGave > 0.005 ? fmtCur(person.totalGave) : fmtCur(0);
    const action = isSelf
      ? (person.totalShare > 0 ? `Only your share ${fmtCur(person.totalShare)} will go to Expenses` : 'No expense to add')
      : !needsSettlement
        ? 'Already settled'
        : person.net < -0.005
          ? `${person.name} owes you ${fmtCur(Math.abs(person.net))}`
          : `You owe ${person.name} ${fmtCur(person.net)}`;
    const liveFriendOptions = ['<option value="">Skip Live Split</option>']
      .concat(_tripFinalizeLiveFriends.map((friend) => `<option value="${friend.id}" ${Number(person.liveSplitFriendId || 0) === Number(friend.id) ? 'selected' : ''}>${escHtml(friend.name || '')}</option>`))
      .join('');
    return `<tr>
      <td style="padding:8px 8px;font-weight:700">${escHtml(person.name)}</td>
      <td style="padding:8px 8px;font-size:12px;color:var(--t2);font-family:var(--mono)">${fmtCur(person.totalShare)}</td>
      <td style="padding:8px 8px;font-size:12px;color:var(--t2);font-family:var(--mono)">${alreadyPaidText}</td>
      <td style="padding:8px 8px;font-size:12px;color:${person.net < -0.005 ? 'var(--green)' : person.net > 0.005 ? 'var(--red)' : 'var(--t3)'};font-weight:700">${needsSettlement ? fmtCur(Math.abs(person.net)) : 'Settled'}</td>
      <td style="padding:8px 8px;font-size:12px;color:var(--t2)">${action}</td>
      <td style="padding:8px 8px">
        ${isSelf || !needsSettlement ? '<span style="font-size:12px;color:var(--t3)">-</span>' : `<select class="fi" id="tfLiveFriend_${escHtml(person.key)}" style="min-width:180px;padding:8px 10px" onchange='updateTripFinalizeLiveFriend(${JSON.stringify(person.key)}, this.value)'>${liveFriendOptions}</select>`}
      </td>
    </tr>`;
  }).join('');
  const mobileRows = _tripFinalizePreview.map((person) => {
    const isSelf = !!person.isSelf;
    const needsSettlement = Math.abs(person.net) > 0.005;
    const action = isSelf
      ? (person.totalShare > 0 ? `Your share ${fmtCur(person.totalShare)} will go to Expenses` : 'No expense to add')
      : !needsSettlement
        ? 'Already settled'
        : person.net < -0.005
          ? `${person.name} owes you ${fmtCur(Math.abs(person.net))}`
          : `You owe ${person.name} ${fmtCur(person.net)}`;
    const liveFriendOptions = ['<option value="">Skip Live Split</option>']
      .concat(_tripFinalizeLiveFriends.map((friend) => `<option value="${friend.id}" ${Number(person.liveSplitFriendId || 0) === Number(friend.id) ? 'selected' : ''}>${escHtml(friend.name || '')}</option>`))
      .join('');
    return `
      <div class="trip-settlement-person-card">
        <div class="trip-settlement-person-top">
          <div class="trip-settlement-person-name">${escHtml(person.name)}</div>
          <div class="trip-settlement-person-net ${person.net < -0.005 ? 'positive' : person.net > 0.005 ? 'negative' : ''}">
            ${needsSettlement ? fmtCur(Math.abs(person.net)) : 'Settled'}
          </div>
        </div>
        <div class="trip-settlement-person-stats">
          <div class="trip-settlement-stat-chip">
            <span>Share</span>
            <strong>${fmtCur(person.totalShare)}</strong>
          </div>
          <div class="trip-settlement-stat-chip">
            <span>Paid</span>
            <strong>${fmtCur(person.totalGave)}</strong>
          </div>
        </div>
        <div class="trip-settlement-person-action">${escHtml(action)}</div>
        ${isSelf || !needsSettlement ? '' : `
          <label class="fl trip-settlement-friend-field">
            Live Split Friend
            <select class="fi" onchange='updateTripFinalizeLiveFriend(${JSON.stringify(person.key)}, this.value)'>${liveFriendOptions}</select>
          </label>
        `}
      </div>`;
  }).join('');

  window.__modalClassName = 'modal-wide trip-settlement-modal';
  openModal('Finalize Trip', `
    <div class="trip-settlement-shell">
    <div style="font-size:13px;color:var(--t2);margin-bottom:12px">
      This will add only your share to Expenses and can send each selected member's remaining trip balance to Live Split. Any amount a member already paid is automatically adjusted in the net.
    </div>
    <div class="table-wrap trip-settlement-table-wrap">
      <table style="border-collapse:collapse;width:100%;margin-bottom:0">
        <thead>
          <tr>
            <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--t3)">Member</th>
            <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--t3)">Share</th>
            <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--t3)">Paid</th>
            <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--t3)">Net</th>
            <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--t3)">Action</th>
            <th style="text-align:left;padding:4px 8px;font-size:11px;color:var(--t3)">Live Split Friend</th>
          </tr>
        </thead>
        <tbody>${previewRows}</tbody>
      </table>
    </div>
    <div class="trip-settlement-mobile-list">${mobileRows}</div>
    <label class="trip-settlement-toggle">
      <input type="checkbox" id="tfAddSelfExpense" checked style="margin-top:3px">
      <span>
        <span style="display:block;font-size:13px;font-weight:700">Add my share to Expenses</span>
        <span style="display:block;font-size:12px;color:var(--t2);margin-top:2px">Only your own share is added, not the full trip total.</span>
      </span>
    </label>
    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:8px">MY EXPENSE TYPE</div>
      <div style="display:flex;gap:8px">
        <button id="tfTypeFair" class="chip active" onclick="document.getElementById('tfTypeFair').classList.add('active');document.getElementById('tfTypeExtra').classList.remove('active')">Fair / Regular</button>
        <button id="tfTypeExtra" class="chip" onclick="document.getElementById('tfTypeExtra').classList.add('active');document.getElementById('tfTypeFair').classList.remove('active')">Extra / Non-essential</button>
      </div>
    </div>
    <label class="fl full" style="margin-bottom:14px">My Expense Category
      <input class="fi" id="tfCategory" list="expenseCategoryList" placeholder="e.g. Travel, Hotel, Food">
      <datalist id="expenseCategoryList">${_expenseCategories.map((cat) => `<option value="${escHtml(cat)}"></option>`).join('')}</datalist>
    </label>
    <label class="fl full" style="margin-bottom:14px">Settlement Date
      <input class="fi" type="date" id="tfDate" value="${todayStr()}">
    </label>
    <div class="fa">
      <button class="btn btn-p" onclick="doFinalizeTrip()">Save Settlement</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>
    </div>`);
  window.__modalClassName = '';
}

async function showTripSettlementModal(tripId = null) {
  const targetId = Number(tripId || _selectedTripId || _tripDetail?.id || 0);
  if (!(targetId > 0)) {
    toast('Select a trip first.', 'warn');
    return;
  }
  if (!_tripDetail || String(_tripDetail.id) !== String(targetId)) {
    const data = await api(`/api/trips/${targetId}`);
    _selectedTripId = targetId;
    _tripDetail = data?.trip || null;
  }
  if (!_tripDetail) {
    toast('Trip details could not be loaded.', 'error');
    return;
  }
  await tripFinalizeModal();
}

function tripSettlementNameKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function tripSettlementFirstToken(value) {
  return tripSettlementNameKey(value).split(' ')[0] || '';
}

function detectTripSettlementSelfKey(trip) {
  const members = trip?.members || [];
  const currentName = String(_currentUser?.display_name || _currentUser?.name || '').trim();
  const currentUsername = String(_currentUser?.username || '').trim();
  const candidates = [currentName, currentUsername].map(tripSettlementNameKey).filter(Boolean);
  const candidateTokens = [currentName, currentUsername].map(tripSettlementFirstToken).filter(Boolean);

  const directMatch = members.find((member) => {
    const memberName = tripSettlementNameKey(member?.member_name);
    return memberName && candidates.includes(memberName);
  });
  if (directMatch) return String(_memberKey(directMatch));

  const tokenMatch = members.find((member) => {
    const memberToken = tripSettlementFirstToken(member?.member_name);
    return memberToken && candidateTokens.includes(memberToken);
  });
  if (tokenMatch) return String(_memberKey(tokenMatch));

  return members[0] ? String(_memberKey(members[0])) : 'self';
}

function buildTripSettlementPreview(trip, liveSplitFriends = []) {
  const members = trip?.members || [];
  const expenses = trip?.expenses || [];
  const selfMemberKey = detectTripSettlementSelfKey(trip);
  const memberByName = new Map();
  const rows = members.map((member) => {
    const key = String(_memberKey(member));
    const uiKey = String(member?.id ?? key);
    const row = {
      key,
      uiKey,
      name: String(member?.member_name || '').trim() || 'Member',
      totalShare: 0,
      totalGave: 0,
      liveSplitFriendId: null,
      isSelf: key === selfMemberKey,
    };
    memberByName.set(tripSettlementNameKey(row.name), row);
    return row;
  });
  const rowByUiKey = new Map(rows.map((row) => [String(row.uiKey), row]));
  const rowByFallbackKey = new Map(rows.map((row, index) => [String(_memberKey(members[index]) || row.key), row]));

  expenses.forEach((expense) => {
    (expense.splits || []).forEach((split) => {
      const target = rowByUiKey.get(String(split?.member_key || ''))
        || rowByFallbackKey.get(String(split?.member_key || ''))
        || memberByName.get(tripSettlementNameKey(split?.member_name || ''));
      if (target) target.totalShare += Number(split?.share_amount || 0);
    });
    const payer = rowByUiKey.get(String(expense?.paid_by_key || ''))
      || rowByFallbackKey.get(String(expense?.paid_by_key || ''))
      || memberByName.get(tripSettlementNameKey(expense?.paid_by_name || ''));
    if (payer) payer.totalGave += Number(expense?.amount || 0);
  });

  return rows.map((row) => {
    const matchedLiveFriend = (liveSplitFriends || []).find((friend) => tripSettlementNameKey(friend?.name) === tripSettlementNameKey(row.name)) || null;
    return {
      ...row,
      totalShare: Math.round(Number(row.totalShare || 0) * 100) / 100,
      totalGave: Math.round(Number(row.totalGave || 0) * 100) / 100,
      net: Math.round((Number(row.totalGave || 0) - Number(row.totalShare || 0)) * 100) / 100,
      liveSplitFriendId: matchedLiveFriend ? Number(matchedLiveFriend.id) : null,
    };
  });
}

function updateTripFinalizeLiveFriend(personKey, friendId) {
  const row = (_tripFinalizePreview || []).find((item) => String(item.key) === String(personKey));
  if (!row) return;
  row.liveSplitFriendId = Number(friendId || 0) || null;
}

async function ensureTripMembersAsFriends(trip) {
  const missingLinkedMembers = (trip.members || []).filter(
    (member) => member.linked_user_id && (member.friend_id === null || member.friend_id === undefined)
  );
  if (!missingLinkedMembers.length) return {};

  const normalizeName = (value) => String(value || '').trim().toLowerCase();
  let friends = (await api('/api/friends'))?.friends || [];
  const friendIdByName = new Map(friends.map((friend) => [normalizeName(friend.name), Number(friend.id)]));
  const ensured = {};

  for (const member of missingLinkedMembers) {
    const key = _memberKey(member);
    const memberName = String(member.member_name || '').trim();
    if (!memberName) continue;
    const normalized = normalizeName(memberName);
    let friendId = friendIdByName.get(normalized);
    if (!friendId) {
      const created = await api('/api/friends', { method: 'POST', body: { name: memberName } });
      if (created?.id) {
        friendId = Number(created.id);
        friendIdByName.set(normalized, friendId);
      } else {
        friends = (await api('/api/friends'))?.friends || [];
        const found = friends.find((friend) => normalizeName(friend.name) === normalized);
        if (found) {
          friendId = Number(found.id);
          friendIdByName.set(normalized, friendId);
        }
      }
    }
    if (friendId) ensured[key] = friendId;
  }

  return ensured;
}

async function doFinalizeTrip() {
  const trip = _tripDetail;
  const isExtra = document.getElementById('tfTypeExtra')?.classList.contains('active') || false;
  const category = document.getElementById('tfCategory')?.value.trim() || null;
  const addSelfExpense = !!document.getElementById('tfAddSelfExpense')?.checked;
  const txnDate = document.getElementById('tfDate')?.value || todayStr();
  const selfMember = (_tripFinalizePreview || []).find((person) => person.isSelf) || null;
  const liveSplitFriendIds = (_tripFinalizePreview || []).reduce((acc, person) => {
    if (!person.isSelf && Number(person.liveSplitFriendId || 0) > 0 && Math.abs(Number(person.net || 0)) > 0.005) {
      acc[person.key] = Number(person.liveSplitFriendId);
    }
    return acc;
  }, {});
  const isDetailView = !!document.querySelector('[data-trip-detail-view="1"]');
  await api(`/api/trips/${_selectedTripId}/finalize`, {
    method: 'POST',
    body: {
      is_extra: isExtra,
      category,
      txn_date: txnDate,
      add_self_expense: addSelfExpense,
      self_member_key: selfMember?.key || null,
      live_split_friend_ids: liveSplitFriendIds,
    },
  });

  closeModal();
  toast('Trip settlement saved to expenses and Live Split.', 'success', 5000);
  const tripId = _selectedTripId;
  await loadTrips();
  if (isDetailView && tripId) await openTripDetail(tripId);
}

// â”€â”€ Create Trip Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _newTripAppUsers = []; // { id, display_name, username } selected app users

async function showCreateTripModal() {
  _newTripAppUsers = [];
  const frData = await api('/api/friends');
  const friends = frData?.friends || [];
  const friendCheckboxes = friends.map(f =>
    `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer">
      <input type="checkbox" class="trip-member-cb" data-id="${f.id}" data-name="${escHtml(f.name)}"> ${escHtml(f.name)}
    </label>`
  ).join('') || '<div style="color:var(--t3);font-size:12px">No friends added yet.</div>';

  openModal('New Trip', `
    <div class="fg">
      <label class="fl full">Trip Name *
        <input class="fi" id="newTripName" placeholder="e.g. Goa 2025, Office Retreat...">
      </label>
      <label class="fl">Start Date *
        <input class="fi" type="date" id="newTripStart" value="${todayStr()}">
      </label>
      <label class="fl">End Date (optional)
        <input class="fi" type="date" id="newTripEnd">
      </label>
    </div>
    <div style="margin-top:12px">
      <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:6px">Friends (from your list)</div>
      <div style="max-height:160px;overflow-y:auto;border:1px solid var(--br);border-radius:6px;padding:8px">${friendCheckboxes}</div>
    </div>
    <div style="margin-top:12px">
      <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:6px">App Users <span style="font-weight:400;color:var(--t3);font-size:11px">- can see and edit this trip directly</span></div>
      <input class="fi" id="newTripUserQ" placeholder="Search by name or username..." oninput="newTripSearchUsers()" style="margin-bottom:6px">
      <div id="newTripUserResults" style="margin-bottom:6px"></div>
      <div id="newTripUserSelected" style="display:flex;flex-wrap:wrap;gap:6px"></div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="doCreateTrip()">Create Trip</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

let _newTripUserSearchTimer = null;
function newTripSearchUsers() {
  clearTimeout(_newTripUserSearchTimer);
  _newTripUserSearchTimer = setTimeout(async () => {
    const q = document.getElementById('newTripUserQ')?.value;
    const box = document.getElementById('newTripUserResults');
    if (!box) return;
    if (!q || q.length < 2) { box.innerHTML = ''; return; }
    const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    const users = (data?.users || []).filter(u => !_newTripAppUsers.find(s => s.id === u.id));
    box.innerHTML = users.length === 0
      ? '<div style="font-size:12px;color:var(--t3)">No users found.</div>'
      : users.map(u =>
          `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;border:1px solid var(--br);border-radius:8px;margin-bottom:4px;font-size:13px">
            <span>${escHtml(u.display_name)} <span style="color:var(--t3);font-size:11px">@${escHtml(u.username)}</span></span>
            <button class="btn btn-p btn-sm" onclick="newTripAddUser(${u.id},'${escHtml(u.display_name).replace(/'/g,"\\'")}','${escHtml(u.username)}')">Add</button>
          </div>`
        ).join('');
  }, 280);
}

function newTripAddUser(id, displayName, username) {
  if (_newTripAppUsers.find(u => u.id === id)) return;
  _newTripAppUsers.push({ id, display_name: displayName, username });
  document.getElementById('newTripUserQ').value = '';
  document.getElementById('newTripUserResults').innerHTML = '';
  _renderNewTripSelectedUsers();
}

function newTripRemoveUser(id) {
  _newTripAppUsers = _newTripAppUsers.filter(u => u.id !== id);
  _renderNewTripSelectedUsers();
}

function _renderNewTripSelectedUsers() {
  const box = document.getElementById('newTripUserSelected');
  if (!box) return;
  box.innerHTML = _newTripAppUsers.map(u =>
    `<span style="display:inline-flex;align-items:center;gap:5px;background:var(--em-xl);color:var(--em);border-radius:20px;padding:3px 10px;font-size:12px;font-weight:500">
      ${escHtml(u.display_name)}
      <button style="background:none;border:none;cursor:pointer;color:var(--em);font-size:13px;line-height:1;padding:0" onclick="newTripRemoveUser(${u.id})">x</button>
    </span>`
  ).join('');
}

async function doCreateTrip() {
  const name = document.getElementById('newTripName').value.trim();
  const start_date = document.getElementById('newTripStart').value;
  const end_date = document.getElementById('newTripEnd').value || null;
  if (!name) { toast('Enter a trip name', 'warning'); return; }
  if (!start_date) { toast('Select a start date', 'warning'); return; }

  const members = [];
  document.querySelectorAll('.trip-member-cb:checked').forEach(cb => {
    members.push({ friend_id: parseInt(cb.dataset.id), member_name: cb.dataset.name });
  });
  // Add selected app users as members (no friend_id, with linked_user_id)
  _newTripAppUsers.forEach(u => {
    members.push({ friend_id: null, member_name: u.display_name, linked_user_id: u.id, permission: 'edit' });
  });

  const result = await api('/api/trips', { method: 'POST', body: { name, start_date, end_date, members } });
  if (result?.success) {
    closeModal();
    toast('Trip created!', 'success');
    await openTripDetail(result.id);
  } else {
    toast(result?.error || 'Failed to create trip', 'error');
  }
}

// â”€â”€ Trip: Link member to app user / invite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function tripShowLinkModal(memberId, memberName, linkedUserId) {
  openModal(`Share: ${memberName}`, `
    <p style="font-size:13px;color:var(--t2);margin-bottom:14px">Link this member slot to an existing app user, or generate an invite link for someone without an account.</p>
    ${linkedUserId ? `<div style="background:var(--em-xl);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--em);margin-bottom:12px">Currently linked to an app user. <button class="btn-d" style="color:var(--red)" onclick="tripUnlinkMember(${memberId})">Unlink</button></div>` : ''}
    <div style="margin-bottom:14px">
      <label class="fl">Search app users
        <input class="fi" id="userSearchQ" placeholder="Type username or name..." oninput="tripSearchUsers()">
      </label>
      <div id="userSearchResults" style="margin-top:6px"></div>
    </div>
    <div style="border-top:1px solid var(--br);padding-top:14px;margin-top:4px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">Or generate an invite link</div>
      <div style="font-size:12px;color:var(--t3);margin-bottom:8px">Anyone who opens the link and logs in will be linked to "${memberName}".</div>
      <button class="btn btn-g btn-sm" onclick="tripGenerateInvite(${memberId})">Generate Invite Link</button>
      <div id="inviteLinkBox" style="margin-top:10px"></div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-g" onclick="closeModal()">Close</button>
    </div>
    <input type="hidden" id="linkMemberId" value="${memberId}">
    <input type="hidden" id="linkPermission" value="edit">
    <div style="margin-top:10px;font-size:12px;color:var(--t2)">
      Permission:
      <button id="permEdit" class="chip active" style="font-size:11px" onclick="document.getElementById('permEdit').classList.add('active');document.getElementById('permView').classList.remove('active');document.getElementById('linkPermission').value='edit'">Can Edit</button>
      <button id="permView" class="chip" style="font-size:11px" onclick="document.getElementById('permView').classList.add('active');document.getElementById('permEdit').classList.remove('active');document.getElementById('linkPermission').value='view'">View Only</button>
    </div>`);
}

let _userSearchTimeout = null;
function tripSearchUsers() {
  clearTimeout(_userSearchTimeout);
  _userSearchTimeout = setTimeout(async () => {
    const q = document.getElementById('userSearchQ')?.value;
    if (!q || q.length < 2) { document.getElementById('userSearchResults').innerHTML = ''; return; }
    const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    const users = data?.users || [];
    document.getElementById('userSearchResults').innerHTML = users.length === 0
      ? '<div style="font-size:12px;color:var(--t3)">No users found.</div>'
      : users.map(u => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border:1px solid var(--br);border-radius:8px;margin-bottom:4px;font-size:13px">
          <span>${escHtml(u.display_name)} <span style="color:var(--t3);font-size:11px">@${escHtml(u.username)}</span></span>
          <button class="btn btn-p btn-sm" onclick="tripLinkMember(${u.id})">Link</button>
        </div>`).join('');
  }, 300);
}

async function tripLinkMember(linkedUserId) {
  const memberId = parseInt(document.getElementById('linkMemberId').value);
  const permission = document.getElementById('linkPermission').value || 'edit';
  const r = await api(`/api/trips/${_selectedTripId}/members/${memberId}/link`, { method: 'PUT', body: { linked_user_id: linkedUserId, permission } });
  if (r?.success) { closeModal(); toast('Member linked to app user', 'success'); await openTripDetail(_selectedTripId); }
  else toast(r?.error || 'Failed', 'error');
}

async function tripUnlinkMember(memberId) {
  const r = await api(`/api/trips/${_selectedTripId}/members/${memberId}/link`, { method: 'PUT', body: { linked_user_id: null } });
  if (r?.success) { closeModal(); toast('Member unlinked', 'success'); await openTripDetail(_selectedTripId); }
  else toast(r?.error || 'Failed', 'error');
}

async function tripGenerateInvite(memberId) {
  const r = await api(`/api/trips/${_selectedTripId}/invite/${memberId}`, { method: 'POST' });
  if (!r?.token) { toast(r?.error || 'Failed to generate invite', 'error'); return; }
  const url = `${location.origin}/t/${r.token}`;
  document.getElementById('inviteLinkBox').innerHTML = `
    <div style="background:var(--bg);border:1px solid var(--br);border-radius:8px;padding:10px;font-size:12px">
      <div style="word-break:break-all;color:var(--em);margin-bottom:6px">${url}</div>
      <button class="btn btn-g btn-sm" onclick="navigator.clipboard.writeText('${url}').then(()=>toast('Copied!','success'))">Copy Link</button>
      <div style="font-size:11px;color:var(--t3);margin-top:4px">Expires in 7 days</div>
    </div>`;
}

// Personal trips override: simple own-trip CRUD with grouped expense details.
let tripsFilters = { status: 'all', category: 'all', transport: 'all', search: '', member: 'all' };
const TRIP_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const TRIP_CATEGORY_OPTIONS = ['Office Trip', 'Personal Trip', 'Family Trip'];
const TRIP_TRANSPORT_OPTIONS = ['Car', 'Bike', 'Bus', 'Train', 'Flight', 'Cab', 'Mixed', 'Other'];
const TRIP_EXPENSE_TYPES = ['Travel', 'Stay', 'Food', 'Shopping', 'Tickets', 'Fuel', 'Tolls', 'Other'];
const TRIP_GROUP_ORDER_STORAGE_KEY = 'expense-lite.trip-group-order.v1';
const TRIP_GROUP_COLLAPSE_STORAGE_KEY = 'expense-lite.trip-group-collapse.v1';
const TRIP_GROUP_SORT_STORAGE_KEY = 'expense-lite.trip-group-sort.v1';

function tripGroupTypeKey(type) {
  return String(type || '').trim().toLowerCase();
}

function readTripGroupStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function writeTripGroupStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value || {}));
}

function getTripGroupOrder(tripId) {
  const all = readTripGroupStorage(TRIP_GROUP_ORDER_STORAGE_KEY);
  return Array.isArray(all?.[tripId]) ? all[tripId] : [];
}

function setTripGroupOrder(tripId, order) {
  const all = readTripGroupStorage(TRIP_GROUP_ORDER_STORAGE_KEY);
  all[tripId] = Array.isArray(order) ? order : [];
  writeTripGroupStorage(TRIP_GROUP_ORDER_STORAGE_KEY, all);
}

function getTripCollapsedGroups(tripId, groups = []) {
  const all = readTripGroupStorage(TRIP_GROUP_COLLAPSE_STORAGE_KEY);
  if (Array.isArray(all?.[tripId])) return all[tripId];
  const defaultCollapsed = (groups || []).map((group) => tripGroupTypeKey(group.type));
  all[tripId] = defaultCollapsed;
  writeTripGroupStorage(TRIP_GROUP_COLLAPSE_STORAGE_KEY, all);
  return defaultCollapsed;
}

function setTripCollapsedGroups(tripId, collapsed) {
  const all = readTripGroupStorage(TRIP_GROUP_COLLAPSE_STORAGE_KEY);
  all[tripId] = Array.isArray(collapsed) ? collapsed : [];
  writeTripGroupStorage(TRIP_GROUP_COLLAPSE_STORAGE_KEY, all);
}

function getTripGroupSorts(tripId) {
  const all = readTripGroupStorage(TRIP_GROUP_SORT_STORAGE_KEY);
  return all?.[tripId] && typeof all[tripId] === 'object' ? all[tripId] : {};
}

function setTripGroupSorts(tripId, sorts) {
  const all = readTripGroupStorage(TRIP_GROUP_SORT_STORAGE_KEY);
  all[tripId] = sorts && typeof sorts === 'object' ? sorts : {};
  writeTripGroupStorage(TRIP_GROUP_SORT_STORAGE_KEY, all);
}

function getOrderedTripExpenseGroups(tripId, groups = []) {
  const savedOrder = getTripGroupOrder(tripId);
  const groupMap = new Map(groups.map((group) => [tripGroupTypeKey(group.type), group]));
  const ordered = [];
  savedOrder.forEach((typeKey) => {
    if (groupMap.has(typeKey)) {
      ordered.push(groupMap.get(typeKey));
      groupMap.delete(typeKey);
    }
  });
  groups.forEach((group) => {
    const typeKey = tripGroupTypeKey(group.type);
    if (groupMap.has(typeKey)) {
      ordered.push(group);
      groupMap.delete(typeKey);
    }
  });
  setTripGroupOrder(tripId, ordered.map((group) => tripGroupTypeKey(group.type)));
  return ordered;
}

function toggleTripExpenseGroupCollapse(groupType) {
  if (!_selectedTripId) return;
  const typeKey = tripGroupTypeKey(groupType);
  const collapsed = new Set(getTripCollapsedGroups(_selectedTripId));
  if (collapsed.has(typeKey)) collapsed.delete(typeKey);
  else collapsed.add(typeKey);
  setTripCollapsedGroups(_selectedTripId, [...collapsed]);
  renderTripDetail();
}

function moveTripExpenseGroup(groupType, direction) {
  if (!_selectedTripId || !_tripDetail?.expense_groups?.length) return;
  const typeKey = tripGroupTypeKey(groupType);
  const order = getOrderedTripExpenseGroups(_selectedTripId, _tripDetail.expense_groups).map((group) => tripGroupTypeKey(group.type));
  const index = order.indexOf(typeKey);
  if (index < 0) return;
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= order.length) return;
  [order[index], order[targetIndex]] = [order[targetIndex], order[index]];
  setTripGroupOrder(_selectedTripId, order);
  renderTripDetail();
}

function toggleTripExpenseGroupSort(groupType, field) {
  if (!_selectedTripId) return;
  const typeKey = tripGroupTypeKey(groupType);
  const sorts = getTripGroupSorts(_selectedTripId);
  const current = sorts[typeKey] || { field: 'date', dir: 'asc' };
  const next = current.field === field
    ? { field, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    : { field, dir: field === 'date' || field === 'details' || field === 'notes' ? 'asc' : 'desc' };
  sorts[typeKey] = next;
  setTripGroupSorts(_selectedTripId, sorts);
  renderTripDetail();
}

function getTripExpenseGroupSort(tripId, groupType) {
  const typeKey = tripGroupTypeKey(groupType);
  const sorts = getTripGroupSorts(tripId);
  return sorts[typeKey] || { field: 'date', dir: 'asc' };
}

function compareTripGroupItems(a, b, field, dir) {
  const multiplier = dir === 'asc' ? 1 : -1;
  const textCompare = (left, right) => String(left || '').localeCompare(String(right || ''), undefined, { sensitivity: 'base' }) * multiplier;
  const numCompare = (left, right) => ((Number(left || 0) - Number(right || 0)) || 0) * multiplier;
  const dateValue = (value) => {
    const normalized = normalizeInputDate(value);
    const time = normalized ? new Date(normalized).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };
  const timeValue = (item) => {
    const raw = item?.updated_at || item?.created_at || '';
    const time = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(time) ? time : 0;
  };
  if (field === 'date') {
    const dateDiff = (dateValue(a.expense_date) - dateValue(b.expense_date)) * multiplier;
    if (dateDiff) return dateDiff;
    const tsDiff = (timeValue(a) - timeValue(b)) * multiplier;
    if (tsDiff) return tsDiff;
    const idDiff = ((Number(a?.id || 0) - Number(b?.id || 0)) || 0) * multiplier;
    if (idDiff) return idDiff;
    return textCompare(a.details, b.details);
  }
  if (field === 'details') return textCompare(a.details, b.details) || numCompare(a.amount, b.amount);
  if (field === 'qty') return numCompare(a.quantity, b.quantity) || textCompare(a.details, b.details);
  if (field === 'price') return numCompare(a.unit_price, b.unit_price) || textCompare(a.details, b.details);
  if (field === 'total') return numCompare(a.amount, b.amount) || textCompare(a.details, b.details);
  if (field === 'notes') return textCompare(a.notes, b.notes) || textCompare(a.details, b.details);
  return 0;
}

function fmtTripExpenseDateTime(expenseDate, timestamp) {
  const dateLabel = expenseDate ? fmtDate(expenseDate) : '-';
  if (!timestamp) return dateLabel;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return dateLabel;
  const timeLabel = parsed.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateLabel}<div style="font-size:11px;color:var(--t3);margin-top:2px">${escHtml(timeLabel)}</div>`;
}

function sortTripGroupItems(items = [], sortState = { field: 'date', dir: 'asc' }) {
  return [...(items || [])].sort((a, b) => compareTripGroupItems(a, b, sortState.field, sortState.dir));
}

function tripGroupSortHeader(groupType, activeSort, field, label, className = '') {
  const isActive = activeSort.field === field;
  const arrow = isActive ? (activeSort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  return `<th class="${className}" style="cursor:pointer;user-select:none" onclick='toggleTripExpenseGroupSort(${JSON.stringify(String(groupType || ''))}, "${field}")'>${label}${arrow}</th>`;
}

function tripStatusLabel(status) {
  const value = String(status || '').toLowerCase();
  const found = TRIP_STATUS_OPTIONS.find((option) => option.value === value);
  return found ? found.label : (status || 'Upcoming');
}

function tripStatusBadge(status) {
  const value = String(status || '').toLowerCase();
  const colors = {
    pending: ['#FFF6DB', '#8A6100'],
    upcoming: ['#E8F1FF', '#2E63D2'],
    ongoing: ['#E6F8EF', '#177245'],
    completed: ['#EAF7F0', '#1C7A4C'],
    cancelled: ['#FDEBEC', '#C33A3A'],
  };
  const [bg, color] = colors[value] || ['var(--bg2)', 'var(--t2)'];
  return `<span style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:${bg};color:${color};font-size:11px;font-weight:700">${tripStatusLabel(value)}</span>`;
}

function tripMembersPreview(members = [], maxVisible = 2) {
  const names = (members || []).map((member) => member.member_name || member).filter(Boolean);
  if (!names.length) return '';
  if (names.length <= maxVisible) return names.join(', ');
  return `${names.slice(0, maxVisible).join(', ')} +${names.length - maxVisible} more`;
}

function tripMemberOptions(rows = []) {
  const names = [...new Set((rows || [])
    .flatMap((trip) => (trip.member_share_totals || trip.members || []).map((member) => String(member?.member_name || '').trim()))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  return names;
}

function tripDisplayAmount(trip, selectedMember = 'all') {
  if (!trip || selectedMember === 'all') return Number(trip?.total_expenditure || 0);
  const match = (trip.member_share_totals || []).find((member) => String(member?.member_name || '').trim().toLowerCase() === String(selectedMember || '').trim().toLowerCase());
  return Number(match?.share_total || 0);
}

function tripParseMembersInput(value) {
  return [...new Set(String(value || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function tripOptionsHtml(options = [], selected = '', includeAll = false, allLabel = 'All') {
  const list = [];
  if (includeAll) list.push(`<option value="all">${allLabel}</option>`);
  for (const option of options) {
    const value = typeof option === 'string' ? option : option.value;
    const label = typeof option === 'string' ? option : option.label;
    list.push(`<option value="${escHtml(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${escHtml(label)}</option>`);
  }
  return list.join('');
}

function tripExpenseTypeDatalist(selected = '') {
  return TRIP_EXPENSE_TYPES.map((type) => `<option value="${escHtml(type)}" ${selected === type ? 'selected' : ''}></option>`).join('');
}

function tripFilteredRows() {
  return (_trips || []).filter((trip) => {
    if (tripsFilters.status !== 'all' && String(trip.status || '').toLowerCase() !== tripsFilters.status) return false;
    if (tripsFilters.category !== 'all' && String(trip.category || '').toLowerCase() !== String(tripsFilters.category).toLowerCase()) return false;
    if (tripsFilters.transport !== 'all' && String(trip.transport_mode || '').toLowerCase() !== String(tripsFilters.transport).toLowerCase()) return false;
    if (tripsFilters.search) {
      const haystack = [
        trip.destination,
        trip.category,
        trip.transport_mode,
        tripMembersPreview(trip.members),
      ].join(' ').toLowerCase();
      if (!haystack.includes(String(tripsFilters.search).trim().toLowerCase())) return false;
    }
    return true;
  });
}

async function loadTrips() {
  const data = await api('/api/trips');
  _trips = data?.trips || [];
  _selectedTripId = null;
  _tripDetail = null;
  renderTripList();
}

function setTripsFilter(key, value) {
  tripsFilters[key] = value;
  tripsPage = 1;
  renderTripList();
}

function renderTripList() {
  const activeEl = document.activeElement;
  const preserveTripSearchFocus = activeEl?.id === 'tripsSearchInput';
  const preservedTripSearchSelection = preserveTripSearchFocus
    ? {
        start: Number(activeEl.selectionStart || 0),
        end: Number(activeEl.selectionEnd || 0),
      }
    : null;
  const memberOptions = tripMemberOptions(_trips || []);
  const filtered = tripFilteredRows().sort((a, b) => {
    const aTime = a?.start_date ? new Date(normalizeInputDate(a.start_date)).getTime() : 0;
    const bTime = b?.start_date ? new Date(normalizeInputDate(b.start_date)).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(a?.destination || a?.name || '').localeCompare(String(b?.destination || b?.name || ''));
  });
  _tripsFiltered = filtered;
  const totalPages = Math.max(1, Math.ceil(filtered.length / TRIPS_PAGE_SIZE));
  tripsPage = Math.min(tripsPage, totalPages);
  const start = (tripsPage - 1) * TRIPS_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + TRIPS_PAGE_SIZE);
  const displayMember = tripsFilters.member || 'all';
  const totalSpend = filtered.reduce((sum, trip) => sum + tripDisplayAmount(trip, displayMember), 0);

  const tripActionButtons = (trip) => `
    <div class="trip-table-actions trip-table-actions-desktop" role="group" aria-label="Trip actions" style="display:flex;align-items:center;gap:4px;flex-wrap:nowrap">
      <button class="trip-icon-btn" title="View details" aria-label="View details" onclick="openTripDetail(${trip.id})" style="width:30px;height:30px;min-width:30px;padding:0;border-radius:10px">
        <span class="trip-icon-btn-glyph" style="font-size:13px">&#128065;</span>
      </button>
      <button class="trip-icon-btn" title="Share trip link" aria-label="Share trip link" onclick="showTripShareModal(${trip.id})" style="width:30px;height:30px;min-width:30px;padding:0;border-radius:10px">
        <span class="trip-icon-btn-glyph" style="font-size:13px">&#128279;</span>
      </button>
      <button class="trip-icon-btn" title="Download trip PDF" aria-label="Download trip PDF" onclick="downloadTripPdfById(${trip.id})" style="width:30px;height:30px;min-width:30px;padding:0;border-radius:10px">
        <span class="trip-icon-btn-glyph" style="font-size:10px">PDF</span>
      </button>
      <button class="trip-icon-btn" title="Settle trip" aria-label="Settle trip" onclick="showTripSettlementModal(${trip.id})" style="width:30px;height:30px;min-width:30px;padding:0;border-radius:10px">
        <span class="trip-icon-btn-glyph" style="font-size:13px">&#8644;</span>
      </button>
      <button class="trip-icon-btn" title="Edit trip" aria-label="Edit trip" onclick="showTripModal(${trip.id})" style="width:30px;height:30px;min-width:30px;padding:0;border-radius:10px">
        <span class="trip-icon-btn-glyph" style="font-size:13px">&#9998;</span>
      </button>
      <button class="trip-icon-btn danger" title="Delete trip" aria-label="Delete trip" onclick="tripDelete(${trip.id})" style="width:30px;height:30px;min-width:30px;padding:0;border-radius:10px">
        <span class="trip-icon-btn-glyph" style="font-size:13px">&#128465;</span>
      </button>
    </div>
    <div class="trip-table-actions-mobile">
      <select class="fi trip-action-select" aria-label="Trip actions" onchange="handleTripRowAction(${trip.id}, this.value, this)">
        <option value="">Actions</option>
        <option value="view">View details</option>
        <option value="share">Share link</option>
        <option value="pdf">Download PDF</option>
        <option value="settle">Settle trip</option>
        <option value="edit">Edit trip</option>
        <option value="delete">Delete trip</option>
      </select>
    </div>`;

  const tableRows = pageRows.map((trip) => {
    const startText = trip.start_date ? fmtDate(trip.start_date) : '-';
    const endText = trip.end_date ? fmtDate(trip.end_date) : '-';
    const datesText = trip.start_date && trip.end_date
      ? `${startText} to ${endText}`
      : (trip.start_date || trip.end_date ? `${startText !== '-' ? startText : endText}` : '-');
    const displayAmount = tripDisplayAmount(trip, displayMember);
    return `
      <tr>
        <td class="trip-actions-cell" style="width:1%;white-space:nowrap">${tripActionButtons(trip)}</td>
        <td style="min-width:150px">
          <button class="btn-d" style="font-weight:700;color:var(--green);text-align:left">${escHtml(trip.destination || trip.name || '-')}</button>
        </td>
        <td style="min-width:180px;white-space:normal;line-height:1.35">${escHtml(datesText)}</td>
        <td class="td-m" style="font-weight:700;color:var(--green);min-width:150px">${fmtCur(displayAmount)}</td>
        <td style="min-width:120px">${tripStatusBadge(trip.status)}</td>
        <td style="min-width:180px;max-width:220px;color:var(--t2);white-space:normal;line-height:1.35">${escHtml(tripMembersPreview(trip.members) || '-')}</td>
      </tr>
    `;
  }).join('');

  const pagination = totalPages > 1
    ? `<div class="pagination" style="margin-top:14px">
        <button class="pg-btn" ${tripsPage <= 1 ? 'disabled' : ''} onclick="tripsPage=${tripsPage - 1};renderTripList()">&larr; Prev</button>
        <div class="pg-info">
          <span class="pg-range">${start + 1}&ndash;${Math.min(start + TRIPS_PAGE_SIZE, filtered.length)} of ${filtered.length}</span>
          <div class="pg-pages">
            ${paginationPages(tripsPage, totalPages).map((page) => page === '...'
              ? `<span class="pg-ellipsis">...</span>`
              : `<button class="pg-num ${page === tripsPage ? 'active' : ''}" onclick="tripsPage=${page};renderTripList()">${page}</button>`
            ).join('')}
          </div>
        </div>
        <button class="pg-btn" ${tripsPage >= totalPages ? 'disabled' : ''} onclick="tripsPage=${tripsPage + 1};renderTripList()">Next &rarr;</button>
      </div>`
    : '';

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="trip-page-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px">
        <div>
          <div style="font-size:22px;font-weight:800">My Trips</div>
          <div style="font-size:13px;color:var(--t2);margin-top:3px">Track only your own trips, members, distance, and total spend.</div>
        </div>
        <div class="trip-page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-s" onclick="downloadTripsPdf(_tripsFiltered)">PDF</button>
          <button class="btn btn-s" onclick="showTripExcelImport()">Import Excel</button>
          <button class="btn btn-p" onclick="showTripModal()">+ Add Trip</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px">
        <div class="card" style="padding:14px 16px">
          <div style="font-size:11px;color:var(--t3);margin-bottom:4px">Total Trips</div>
          <div style="font-size:22px;font-weight:800;line-height:1.1">${filtered.length}</div>
        </div>
        <div class="card" style="padding:14px 16px">
          <div style="font-size:11px;color:var(--t3);margin-bottom:4px">Upcoming / Ongoing</div>
          <div style="font-size:22px;font-weight:800;line-height:1.1">${filtered.filter((trip) => ['pending', 'upcoming', 'ongoing'].includes(String(trip.status || '').toLowerCase())).length}</div>
        </div>
        <div class="card" style="padding:14px 16px">
          <div style="font-size:11px;color:var(--t3);margin-bottom:4px">Completed</div>
          <div style="font-size:22px;font-weight:800;line-height:1.1">${filtered.filter((trip) => String(trip.status || '').toLowerCase() === 'completed').length}</div>
        </div>
        <div class="card" style="padding:14px 16px">
          <div style="font-size:11px;color:var(--t3);margin-bottom:4px">Tracked Spend</div>
          <div style="font-size:22px;font-weight:800;line-height:1.1;color:var(--green)">${fmtCur(totalSpend)}</div>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px;padding:14px 16px">
        <div class="trip-filters-grid" style="display:grid;grid-template-columns:1.2fr repeat(4,minmax(160px,.9fr));gap:10px;align-items:end">
          <label class="fl" style="margin:0;font-size:12px">Search
            <input id="tripsSearchInput" class="fi" style="height:44px" placeholder="Destination, members, transport..." value="${escHtml(tripsFilters.search)}" oninput="setTripsFilter('search', this.value)">
          </label>
          <label class="fl" style="margin:0;font-size:12px">Status
            <select class="fi" style="height:44px" onchange="setTripsFilter('status', this.value)">${tripOptionsHtml(TRIP_STATUS_OPTIONS, tripsFilters.status, true, 'All statuses')}</select>
          </label>
          <label class="fl" style="margin:0;font-size:12px">Category
            <select class="fi" style="height:44px" onchange="setTripsFilter('category', this.value)">${tripOptionsHtml(TRIP_CATEGORY_OPTIONS, tripsFilters.category, true, 'All categories')}</select>
          </label>
          <label class="fl" style="margin:0;font-size:12px">Transport
            <select class="fi" style="height:44px" onchange="setTripsFilter('transport', this.value)">${tripOptionsHtml(TRIP_TRANSPORT_OPTIONS, tripsFilters.transport, true, 'All modes')}</select>
          </label>
          <label class="fl" style="margin:0;font-size:12px">Member share
            <select class="fi" style="height:44px" onchange="setTripsFilter('member', this.value)">${tripOptionsHtml(memberOptions, tripsFilters.member, true, 'All members')}</select>
          </label>
        </div>
      </div>

      ${pageRows.length ? `
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style="width:156px;min-width:156px">Actions</th>
                  <th>Destination</th>
                  <th>Dates</th>
                  <th class="td-m">Total Expenditure</th>
                  <th>Status</th>
                  <th>Members</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        </div>
      ` : `
        <div class="card" style="text-align:center;padding:36px 20px;color:var(--t3)">
          <div style="font-size:16px;font-weight:700;color:var(--t2);margin-bottom:6px">No trips yet</div>
          <div style="font-size:13px;margin-bottom:14px">Create your first trip to track destination, trip status, distance, and expense totals.</div>
          <button class="btn btn-p" onclick="showTripModal()">+ Add Trip</button>
        </div>
      `}
      ${pagination}
    </div>
  `;
}

function handleTripRowAction(tripId, action, el) {
  if (!action) return;
  if (action === 'view') openTripDetail(tripId);
  else if (action === 'share') showTripShareModal(tripId);
  else if (action === 'pdf') downloadTripPdfById(tripId);
  else if (action === 'settle') showTripSettlementModal(tripId);
  else if (action === 'edit') showTripModal(tripId);
  else if (action === 'delete') tripDelete(tripId);
  if (el) el.value = '';
}

async function openTripDetail(tripId) {
  _selectedTripId = tripId;
  const data = await api(`/api/trips/${tripId}`);
  if (!data?.trip) {
    toast('Trip not found', 'error');
    return;
  }
  _tripDetail = data.trip;
  syncTripListRowFromDetail(_tripDetail);
  renderTripDetail();
}

function syncTripListRowFromDetail(trip) {
  if (!trip?.id || !Array.isArray(_trips)) return;
  const members = Array.isArray(trip.members) ? trip.members : [];
  const memberNameKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const memberShareKey = (member) => String(member?.id ?? _memberKey(member) ?? '');
  const memberShareTotals = members.map((member) => {
    const stableKey = memberShareKey(member);
    const total = (trip.expenses || []).reduce((sum, expense) => (
      sum + (expense.splits || []).reduce((splitSum, split) => {
        const sameKey = String(split?.member_key || '') === stableKey || String(split?.member_key || '') === String(_memberKey(member));
        const sameName = memberNameKey(split?.member_name) === memberNameKey(member?.member_name);
        return splitSum + ((sameKey || sameName) ? Number(split?.share_amount || 0) : 0);
      }, 0)
    ), 0);
    return {
      member_key: stableKey,
      member_name: member?.member_name || '',
      share_total: Math.round(total * 100) / 100,
    };
  });
  _trips = _trips.map((row) => {
    if (String(row?.id) !== String(trip.id)) return row;
    return {
      ...row,
      ...trip,
      name: trip.name || row.name,
      destination: trip.destination || trip.name || row.destination || row.name,
      total_expenditure: Number(trip.grand_total ?? trip.total_expenditure ?? row.total_expenditure ?? 0),
      grand_total: Number(trip.grand_total ?? trip.total_expenditure ?? row.grand_total ?? 0),
      expense_count: Array.isArray(trip.expenses) ? trip.expenses.length : Number(trip.expense_count ?? row.expense_count ?? 0),
      members,
      member_share_totals: memberShareTotals,
    };
  });
}

function renderTripDetail() {
  const trip = _tripDetail;
  if (!trip) return;
  const members = trip.members || [];
  const groups = getOrderedTripExpenseGroups(trip.id, trip.expense_groups || []);
  const collapsedGroups = new Set(getTripCollapsedGroups(trip.id, groups));
  const memberShareKey = (member) => String(member?.id ?? _memberKey(member) ?? '');
  const memberNameKey = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const peopleMap = {};
  const memberByName = new Map();
  members.forEach((member) => {
    const key = memberShareKey(member);
    peopleMap[key] = { name: member.member_name, totalShare: 0, totalGave: 0 };
    memberByName.set(memberNameKey(member.member_name), key);
  });
  (trip.expenses || []).forEach((expense) => {
    (expense.splits || []).forEach((split) => {
      const byNameKey = memberByName.get(memberNameKey(split.member_name));
      const matchedMember = byNameKey
        ? members.find((member) => memberShareKey(member) === byNameKey)
        : members.find((member) => {
            const stableKey = memberShareKey(member);
            return String(split.member_key) === stableKey || String(split.member_key) === String(_memberKey(member));
          });
      const targetKey = byNameKey || (matchedMember ? memberShareKey(matchedMember) : String(split.member_key || ''));
      if (peopleMap[targetKey]) peopleMap[targetKey].totalShare += Number(split.share_amount || 0);
    });
    const paidByNameKey = memberByName.get(memberNameKey(expense.paid_by_name));
    const paidByMember = paidByNameKey
      ? members.find((member) => memberShareKey(member) === paidByNameKey)
      : members.find((member) => {
          const stableKey = memberShareKey(member);
          return String(expense.paid_by_key) === stableKey || String(expense.paid_by_key) === String(_memberKey(member));
        });
    const paidByKey = paidByNameKey || (paidByMember ? memberShareKey(paidByMember) : String(expense.paid_by_key || ''));
    if (peopleMap[paidByKey]) peopleMap[paidByKey].totalGave += Number(expense.amount || 0);
  });
  const memberChips = members.length
    ? members.map((member) => {
        const key = memberShareKey(member);
        const totals = peopleMap[key] || { totalShare: 0, totalGave: 0 };
        return `<div style="display:flex;flex-direction:column;gap:2px;padding:6px 10px;border-radius:12px;background:var(--bg2);border:1px solid var(--br);min-width:96px">
          <span style="font-size:12px;font-weight:700;line-height:1.2">${escHtml(member.member_name)}</span>
          <span style="font-size:11px;color:var(--t3);line-height:1.2">Share: ${fmtCur(totals.totalShare || 0)}</span>
        </div>`;
      }).join('')
    : '<span style="font-size:13px;color:var(--t3)">No members added.</span>';
  const summaryCards = [
    ['Transport', escHtml(trip.transport_mode || '-')],
  ].map(([label, value]) => `<div class="card" style="padding:12px 14px;min-height:0"><div style="font-size:11px;color:var(--t3);margin-bottom:4px">${label}</div><div style="font-size:14px;font-weight:700;line-height:1.2">${value}</div></div>`).join('');

  const groupHtml = groups.length
    ? groups.map((group, index) => {
      const typeKey = tripGroupTypeKey(group.type);
      const groupTypeArg = JSON.stringify(String(group.type || ''));
      const isCollapsed = collapsedGroups.has(typeKey);
      const activeSort = getTripExpenseGroupSort(trip.id, group.type);
      const sortedItems = sortTripGroupItems(group.items || [], activeSort);
      const itemCount = sortedItems.length;
      return `
      <div class="card trip-group-card" style="margin-bottom:14px">
        <div class="trip-group-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <button
            type="button"
            onclick='toggleTripExpenseGroupCollapse(${groupTypeArg})'
            class="trip-group-toggle"
            style="display:flex;align-items:center;gap:10px;background:none;border:none;padding:0;cursor:pointer;text-align:left;min-width:0"
            aria-expanded="${isCollapsed ? 'false' : 'true'}"
          >
            <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:var(--bg2);border:1px solid var(--br);font-size:14px;color:var(--t2)">${isCollapsed ? '&#9656;' : '&#9662;'}</span>
            <span>
              <span style="display:block;font-size:18px;font-weight:800">${escHtml(group.type)}</span>
              <span style="display:block;font-size:12px;color:var(--t3)">${itemCount} item${itemCount !== 1 ? 's' : ''}${isCollapsed ? ' hidden' : ''}</span>
            </span>
          </button>
          <div class="trip-group-meta" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto">
            <div class="trip-group-sort-actions" style="display:flex;align-items:center;gap:6px">
              <button class="trip-icon-btn" title="Move group up" aria-label="Move group up" onclick='moveTripExpenseGroup(${groupTypeArg}, "up")' ${index === 0 ? 'disabled' : ''} style="${index === 0 ? 'opacity:.45;cursor:not-allowed' : ''}">
                <span class="trip-icon-btn-glyph">&#8593;</span>
              </button>
              <button class="trip-icon-btn" title="Move group down" aria-label="Move group down" onclick='moveTripExpenseGroup(${groupTypeArg}, "down")' ${index === groups.length - 1 ? 'disabled' : ''} style="${index === groups.length - 1 ? 'opacity:.45;cursor:not-allowed' : ''}">
                <span class="trip-icon-btn-glyph">&#8595;</span>
              </button>
            </div>
            <div style="font-size:16px;font-weight:800;color:var(--green)">Subtotal: ${fmtCur(group.total || 0)}</div>
          </div>
        </div>
        ${isCollapsed ? '' : `
        <div class="table-wrap" style="margin-top:12px">
          <table>
            <thead>
              <tr>
                <th style="width:132px;min-width:132px">Actions</th>
                ${tripGroupSortHeader(group.type, activeSort, 'date', 'Date')}
                ${tripGroupSortHeader(group.type, activeSort, 'details', 'Details')}
                ${tripGroupSortHeader(group.type, activeSort, 'qty', 'Qty', 'td-m')}
                ${tripGroupSortHeader(group.type, activeSort, 'price', 'Price', 'td-m')}
                ${tripGroupSortHeader(group.type, activeSort, 'total', 'Total', 'td-m')}
                ${tripGroupSortHeader(group.type, activeSort, 'notes', 'Notes')}
              </tr>
            </thead>
            <tbody>${sortedItems.map((item) => `
              <tr>
                <td class="trip-actions-cell">
                  <div class="trip-table-actions" role="group" aria-label="Trip expense actions">
                    <button class="trip-icon-btn" title="Edit expense" aria-label="Edit expense" onclick="showTripExpenseModal(${item.id})">
                      <span class="trip-icon-btn-glyph">&#9998;</span>
                    </button>
                    <button class="trip-icon-btn danger" title="Delete expense" aria-label="Delete expense" onclick="tripDeleteExpense(${item.id})">
                      <span class="trip-icon-btn-glyph">&#128465;</span>
                    </button>
                  </div>
                </td>
                <td>${fmtTripExpenseDateTime(item.expense_date, item.updated_at || item.created_at)}</td>
                <td style="font-weight:600">${escHtml(item.details || '-')}</td>
                <td class="td-m">${item.quantity != null ? escHtml(String(item.quantity)) : '-'}</td>
                <td class="td-m">${item.unit_price != null ? fmtCur(item.unit_price) : '-'}</td>
                <td class="td-m" style="font-weight:700">${fmtCur(item.amount || 0)}</td>
                <td>
                  <div>${escHtml(item.notes || '-')}</div>
                  <div style="margin-top:4px;font-size:11px;color:var(--t3)">Paid by: ${escHtml(item.paid_by_name || 'You')}</div>
                  ${(item.splits || []).length > 1 ? `<div style="margin-top:2px;font-size:11px;color:var(--t3)">Shared: ${escHtml(item.splits.map((split) => `${split.member_name}: ${fmtCur(split.share_amount)}`).join(' | '))}</div>` : ''}
                </td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
        `}
      </div>
    `;
    }).join('')
    : `<div class="card" style="text-align:center;color:var(--t3);padding:28px 18px">No trip expenses yet. Add line items to see grouped totals here.</div>`;

  document.getElementById('main').innerHTML = `
    <div class="tab-content" data-trip-detail-view="1">
      <div class="trip-detail-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:16px">
        <div class="trip-detail-title-block">
          <button class="btn btn-g btn-sm" onclick="renderTripList()" style="margin-bottom:10px">Back</button>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="font-size:24px;font-weight:800">
              ${escHtml(trip.destination || trip.name || '')}${trip.total_distance != null ? ` <span style="font-size:18px;font-weight:700;color:var(--t2)">(${escHtml(String(trip.total_distance))} km)</span>` : ''}
            </div>
            ${tripStatusBadge(trip.status)}
          </div>
          <div style="font-size:13px;color:var(--t2);margin-top:4px">${trip.start_date ? fmtDate(trip.start_date) : '-'} ${trip.end_date ? `to ${fmtDate(trip.end_date)}` : ''}</div>
        </div>
        <div class="trip-detail-actions" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <div class="trip-detail-actions-desktop" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <button class="trip-icon-btn" title="Edit trip" aria-label="Edit trip" onclick="showTripModal(${trip.id})">
              <span class="trip-icon-btn-glyph">&#9998;</span>
            </button>
            <button class="btn btn-s btn-sm" onclick="showTripShareModal(${trip.id})">Share Link</button>
            <button class="btn btn-s btn-sm" onclick="downloadTripDetailPdf()">PDF</button>
            <button class="btn btn-s btn-sm" onclick="showTripSettlementModal(${trip.id})">Settle Trip</button>
            <button class="btn btn-p btn-sm" onclick="showTripExpenseModal()">+ Add Expense</button>
            ${(trip.expenses || []).length ? `<button class="btn btn-s btn-sm" onclick="showTripBulkShareModal()">Bulk Edit Shares</button>` : ''}
            <button class="btn btn-s btn-sm" onclick="showTripExpenseExcelImport(${trip.id})">Import Excel</button>
            ${(trip.expenses || []).length ? `<button class="btn btn-s btn-sm" style="color:var(--red);border-color:#f0c7c7;background:#fff6f6" onclick="tripDeleteAllExpenses()">Delete All Expenses</button>` : ''}
            <button class="trip-icon-btn danger" title="Delete trip" aria-label="Delete trip" onclick="tripDelete(${trip.id})">
              <span class="trip-icon-btn-glyph">&#128465;</span>
            </button>
          </div>
          <div class="trip-detail-actions-mobile">
            <button class="trip-icon-btn" title="Edit trip" aria-label="Edit trip" onclick="showTripModal(${trip.id})"><span class="trip-icon-btn-glyph">&#9998;</span></button>
            <button class="trip-icon-btn" title="Share trip link" aria-label="Share trip link" onclick="showTripShareModal(${trip.id})"><span class="trip-icon-btn-glyph">&#128279;</span></button>
            <button class="trip-icon-btn" title="Download PDF" aria-label="Download PDF" onclick="downloadTripDetailPdf()"><span class="trip-icon-btn-glyph" style="font-size:11px">PDF</span></button>
            <button class="trip-icon-btn" title="Settle trip" aria-label="Settle trip" onclick="showTripSettlementModal(${trip.id})"><span class="trip-icon-btn-glyph">&#8644;</span></button>
            <button class="trip-icon-btn" title="Add expense" aria-label="Add expense" onclick="showTripExpenseModal()"><span class="trip-icon-btn-glyph">+</span></button>
            ${(trip.expenses || []).length ? `<button class="trip-icon-btn" title="Bulk edit shares" aria-label="Bulk edit shares" onclick="showTripBulkShareModal()"><span class="trip-icon-btn-glyph">&#8942;</span></button>` : ''}
            <button class="trip-icon-btn" title="Import Excel" aria-label="Import Excel" onclick="showTripExpenseExcelImport(${trip.id})"><span class="trip-icon-btn-glyph">&#8681;</span></button>
            ${(trip.expenses || []).length ? `<button class="trip-icon-btn danger" title="Delete all expenses" aria-label="Delete all expenses" onclick="tripDeleteAllExpenses()"><span class="trip-icon-btn-glyph">&#128465;</span></button>` : ''}
            <button class="trip-icon-btn danger" title="Delete trip" aria-label="Delete trip" onclick="tripDelete(${trip.id})"><span class="trip-icon-btn-glyph">&#10006;</span></button>
          </div>
        </div>
      </div>

      <div class="trip-detail-summary-grid" style="display:grid;grid-template-columns:minmax(260px,1.5fr) minmax(190px,.95fr) repeat(2,minmax(130px,.7fr));gap:10px;margin-bottom:14px;align-items:stretch">
        <div class="card" style="padding:12px 14px;min-height:0">
          <div style="font-size:11px;color:var(--t3);margin-bottom:5px">Trip Members</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">${memberChips}</div>
          ${trip.notes ? `<div style="margin-top:6px;font-size:11px;color:var(--t2);line-height:1.35">${escHtml(trip.notes)}</div>` : ''}
        </div>
        <div class="card" style="display:flex;flex-direction:column;justify-content:center;padding:12px 14px;min-height:0">
          <div style="font-size:11px;color:var(--t3);margin-bottom:3px">Grand Total</div>
          <div style="font-size:20px;font-weight:900;color:var(--green);line-height:1.1">${fmtCur(trip.grand_total || 0)}</div>
          <div style="font-size:11px;color:var(--t3);margin-top:3px">${(trip.expenses || []).length} item${(trip.expenses || []).length !== 1 ? 's' : ''}</div>
        </div>
        ${summaryCards}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <div style="font-size:18px;font-weight:800">Expense Breakdown</div>
          <div style="font-size:13px;color:var(--t2)">Subtotals by expense type, with each trip item visible underneath.</div>
        </div>
      </div>
      ${groupHtml}
    </div>
  `;
  if (preserveTripSearchFocus) {
    requestAnimationFrame(() => {
      const searchInput = document.getElementById('tripsSearchInput');
      if (!searchInput) return;
      searchInput.focus();
      if (preservedTripSearchSelection) {
        const nextLength = String(searchInput.value || '').length;
        const start = Math.min(preservedTripSearchSelection.start, nextLength);
        const end = Math.min(preservedTripSearchSelection.end, nextLength);
        searchInput.setSelectionRange(start, end);
      }
    });
  }
}

async function downloadTripPdfById(tripId) {
  const previousTripId = _selectedTripId;
  const previousTripDetail = _tripDetail;
  try {
    const data = await api(`/api/trips/${tripId}`);
    if (!data?.trip) {
      toast(data?.error || 'Trip not found', 'error');
      return;
    }
    _tripDetail = data.trip;
    downloadTripDetailPdf();
  } finally {
    _selectedTripId = previousTripId;
    _tripDetail = previousTripDetail;
  }
}

function parseJsonSafe(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (_err) {
    return fallback;
  }
}

function tripDefaultShareExpiry() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function showTripShareModal(tripId = null) {
  const targetId = tripId || _selectedTripId;
  if (!targetId) {
    toast('Open a trip first', 'warning');
    return;
  }
  const trip = (_tripDetail && String(_tripDetail.id) === String(targetId))
    ? _tripDetail
    : (_trips.find((row) => String(row.id) === String(targetId)) || null);
  const linksData = await api('/api/shares');
  const links = (linksData?.links || []).filter((link) => {
    const filters = parseJsonSafe(link.filters, {});
    return String(link.link_type || '').toLowerCase() === 'trip_detail' && String(filters?.trip_id || '') === String(targetId);
  });
  const rowsHtml = links.length
    ? links.map((link) => {
        const url = `${location.origin}/s/${link.token}`;
        return `<div style="padding:10px 12px;border:1px solid var(--br);border-radius:10px;background:var(--bg2);margin-bottom:8px">
          <div style="word-break:break-all;color:var(--em);font-size:12px;margin-bottom:6px">${escHtml(url)}</div>
          <div style="font-size:11px;color:var(--t3);margin-bottom:8px">Expires: ${link.expires_at ? escHtml(String(link.expires_at)) : 'No expiry'} &nbsp;&middot;&nbsp; Views: ${Number(link.view_count || 0)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-g btn-sm" onclick="navigator.clipboard.writeText('${url}').then(()=>toast('Copied!','success'))">Copy Link</button>
            <button class="btn btn-s btn-sm" onclick="deleteTripShareLink(${Number(link.id)}, ${Number(targetId)})">Delete</button>
          </div>
        </div>`;
      }).join('')
    : '<div style="font-size:12px;color:var(--t3);padding:8px 0">No trip share links yet.</div>';
  openModal(`Share Trip`, `
    <div style="font-size:13px;color:var(--t2);margin-bottom:12px">Create a unique GUID link for <b>${escHtml(trip?.destination || trip?.name || 'this trip')}</b>. Anyone with the link can open a read-only trip view until the expiry date.</div>
    <div class="card" style="padding:14px 16px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px">Create New Link</div>
      <div class="fg">
        <label class="fl">Expiry Date
          <input class="fi" type="date" id="tripShareExpiry" value="${tripDefaultShareExpiry()}">
        </label>
      </div>
      <div class="fa" style="margin-top:14px">
        <button class="btn btn-p" onclick="createTripShareLink(${Number(targetId)})">Create Link</button>
        <button class="btn btn-g" onclick="closeModal()">Close</button>
      </div>
    </div>
    <div style="font-size:13px;font-weight:700;margin-bottom:8px">Existing Links</div>
    <div id="tripShareLinksList">${rowsHtml}</div>
  `);
}

async function createTripShareLink(tripId) {
  const expiresAt = document.getElementById('tripShareExpiry')?.value || null;
  const result = await api('/api/shares', {
    method: 'POST',
    body: {
      link_type: 'trip_detail',
      filters: { trip_id: Number(tripId) },
      expires_at: expiresAt || null,
    },
  });
  if (!result?.token) {
    toast(result?.error || 'Failed to create trip share link', 'error');
    return;
  }
  toast('Trip share link created', 'success');
  await showTripShareModal(tripId);
}

async function deleteTripShareLink(linkId, tripId) {
  if (!await confirmDialog('Delete this trip share link?')) return;
  const result = await api(`/api/shares/${linkId}`, { method: 'DELETE' });
  if (result?.error) {
    toast(result.error, 'error');
    return;
  }
  toast('Trip share link deleted', 'success');
  await showTripShareModal(tripId);
}

async function showTripModal(tripId = null) {
  let trip = null;
  if (tripId) {
    if (_tripDetail && String(_tripDetail.id) === String(tripId)) {
      trip = _tripDetail;
    } else {
      const result = await api(`/api/trips/${tripId}`);
      if (!result?.trip) {
        toast(result?.error || 'Could not load trip details', 'error');
        return;
      }
      trip = result.trip;
    }
  }
  const startDateValue = trip?.start_date ? normalizeInputDate(trip.start_date) : todayStr();
  const endDateValue = trip?.end_date ? normalizeInputDate(trip.end_date) : '';
  const memberValue = trip?.members?.map((member) => member.member_name).join('\n') || '';
  openModal(trip ? 'Edit Trip' : 'Add Trip', `
    <div class="fg">
      <label class="fl full">Destination *
        <input class="fi" id="tripDestination" placeholder="Manali, Shimla, Thailand..." value="${escHtml(trip?.destination || trip?.name || '')}">
      </label>
      <label class="fl">Start Date *
        <input class="fi" type="date" id="tripStartDate" value="${escHtml(startDateValue)}">
      </label>
      <label class="fl">End Date
        <input class="fi" type="date" id="tripEndDate" value="${escHtml(endDateValue)}">
      </label>
      <label class="fl">Status
        <select class="fi" id="tripStatus">${tripOptionsHtml(TRIP_STATUS_OPTIONS, trip?.status || 'upcoming')}</select>
      </label>
      <label class="fl">Category
        <input class="fi" id="tripCategory" list="tripCategoryList" placeholder="Office Trip, Personal Trip..." value="${escHtml(trip?.category || '')}">
        <datalist id="tripCategoryList">${tripOptionsHtml(TRIP_CATEGORY_OPTIONS)}</datalist>
      </label>
      <label class="fl">Transport Mode
        <input class="fi" id="tripTransportMode" list="tripTransportList" placeholder="Car, Flight, Train..." value="${escHtml(trip?.transport_mode || '')}">
        <datalist id="tripTransportList">${tripOptionsHtml(TRIP_TRANSPORT_OPTIONS)}</datalist>
      </label>
      <label class="fl">Total Distance
        <input class="fi" id="tripDistance" type="number" min="0" step="0.01" placeholder="800" value="${trip?.total_distance ?? ''}">
      </label>
      <label class="fl full">Members
        <textarea class="fi" id="tripMembers" rows="4" placeholder="One name per line or comma separated">${escHtml(memberValue)}</textarea>
      </label>
      <label class="fl full">Notes
        <textarea class="fi" id="tripNotes" rows="3" placeholder="Any useful details">${escHtml(trip?.notes || '')}</textarea>
      </label>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="saveTripModal(${trip?.id || 'null'})">${trip ? 'Save Changes' : 'Create Trip'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

async function saveTripModal(tripId = null) {
  const wasDetailView = !!_tripDetail && !!tripId && String(_tripDetail.id) === String(tripId);
  const body = {
    destination: document.getElementById('tripDestination')?.value.trim(),
    start_date: document.getElementById('tripStartDate')?.value,
    end_date: document.getElementById('tripEndDate')?.value || null,
    status: document.getElementById('tripStatus')?.value || 'upcoming',
    category: document.getElementById('tripCategory')?.value.trim() || null,
    transport_mode: document.getElementById('tripTransportMode')?.value.trim() || null,
    total_distance: document.getElementById('tripDistance')?.value || null,
    members: tripParseMembersInput(document.getElementById('tripMembers')?.value),
    notes: document.getElementById('tripNotes')?.value.trim() || null,
  };
  if (!body.destination) {
    toast('Enter destination', 'warning');
    return;
  }
  if (!body.start_date) {
    toast('Select a start date', 'warning');
    return;
  }
  const result = await api(tripId ? `/api/trips/${tripId}` : '/api/trips', {
    method: tripId ? 'PUT' : 'POST',
    body,
  });
  if (result?.error) {
    toast(result.error, 'error');
    return;
  }
  closeModal();
  toast(tripId ? 'Trip updated' : 'Trip created', 'success');
  await loadTrips();
  if (tripId && wasDetailView) await openTripDetail(tripId);
}

function _findTripExpenseById(expenseId) {
  return (_tripDetail?.expenses || []).find((expense) => String(expense.id) === String(expenseId)) || null;
}

function _resolveTripExpenseMemberUiKey(rawKey, rawName, members = []) {
  const byName = (members || []).find((member) => tripSettlementNameKey(member?.member_name || '') === tripSettlementNameKey(rawName || ''));
  if (byName) return String(_memberKey(byName));
  const byKey = (members || []).find((member) => {
    const fallbackKey = String(_memberKey(member));
    const uiKey = String(member?.id ?? fallbackKey);
    return String(rawKey || '') === uiKey || String(rawKey || '') === fallbackKey;
  });
  return byKey ? String(_memberKey(byKey)) : String(rawKey || '');
}

async function ensureTripCurrenciesLoaded(force = false) {
  if (_tripCurrencies && !force) return _tripCurrencies;
  const result = await api('/api/currencies');
  if (result?.error) {
    toast(result.error, 'error');
    _tripCurrencies = [];
    return _tripCurrencies;
  }
  _tripCurrencies = Array.isArray(result?.currencies) ? result.currencies : [];
  return _tripCurrencies;
}

function getTripCurrencyMeta(currencyCode) {
  const defaultCurrencyCode = _currentUser?.currency_code || 'INR';
  const currencies = Array.isArray(_tripCurrencies) ? _tripCurrencies : [];
  return currencies.find((item) => String(item.currency_code || '').toUpperCase() === String(currencyCode || defaultCurrencyCode).toUpperCase())
    || currencies.find((item) => String(item.currency_code || '').toUpperCase() === defaultCurrencyCode.toUpperCase())
    || {
      currency_code: defaultCurrencyCode,
      conversion_rate_to_default: 1,
      rate_to_inr: defaultCurrencyCode === 'INR' ? 1 : null,
    };
}

function formatTripCurrencyHint(currencyCode) {
  return formatTripCurrencyHintWithRate(currencyCode, getTripCurrencyMeta(currencyCode)?.conversion_rate_to_default || 0);
}

function formatTripCurrencyHintWithRate(currencyCode, rateOverride) {
  const defaultCurrencyCode = _currentUser?.currency_code || 'INR';
  const meta = getTripCurrencyMeta(currencyCode);
  const rate = parseFloat(rateOverride || meta?.conversion_rate_to_default || 0);
  if (!Number.isFinite(rate) || rate <= 0) return '';
  if (String(currencyCode || defaultCurrencyCode).toUpperCase() === defaultCurrencyCode.toUpperCase()) {
    return `Saved in ${defaultCurrencyCode}.`;
  }
  return `1 ${meta.currency_code} = ${String(rate.toFixed(6)).replace(/\.?0+$/, '')} ${defaultCurrencyCode}`;
}

function getTripExpenseEffectiveRate(currencyCode) {
  const defaultCurrencyCode = _currentUser?.currency_code || 'INR';
  const selectedCurrency = String(currencyCode || defaultCurrencyCode).toUpperCase();
  if (selectedCurrency === defaultCurrencyCode.toUpperCase()) return 1;
  return parseFloat(getTripCurrencyMeta(selectedCurrency)?.conversion_rate_to_default || 0);
}

function recalcTripExpenseConvertedTotal() {
  const defaultCurrencyCode = _currentUser?.currency_code || 'INR';
  const currencyInput = document.getElementById('tripExpenseOrigCurrency');
  const originalAmountInput = document.getElementById('tripExpenseOrigAmount');
  const totalInput = document.getElementById('tripExpenseAmount');
  const rateInput = document.getElementById('tripExpenseConversionRateView');
  const rateWrap = document.getElementById('tripExpenseRateWrap');
  if (!currencyInput || !originalAmountInput || !totalInput) return;
  const originalCurrencyCode = currencyInput.value || defaultCurrencyCode;
  const originalAmountRaw = originalAmountInput.value;
  const originalAmount = parseFloat(originalAmountRaw || 0);
  const conversionRate = getTripExpenseEffectiveRate(originalCurrencyCode);
  if (rateWrap) rateWrap.style.display = originalCurrencyCode === defaultCurrencyCode ? 'none' : '';
  if (rateInput) rateInput.value = formatTripCurrencyHintWithRate(originalCurrencyCode, conversionRate);
  if (originalAmountRaw === '') {
    totalInput.value = '';
    return;
  }
  if (originalCurrencyCode === defaultCurrencyCode) {
    totalInput.value = (Math.round(originalAmount * 100) / 100).toFixed(2);
    return;
  }
  if (conversionRate > 0) {
    totalInput.value = (Math.round(originalAmount * conversionRate * 100) / 100).toFixed(2);
  }
}

async function showTripExpenseModal(expenseId = null) {
  if (!_tripDetail) return;
  await ensureTripCurrenciesLoaded();
  const expense = expenseId ? _findTripExpenseById(expenseId) : null;
  const defaultCurrencyCode = _currentUser?.currency_code || 'INR';
  const originalCurrencyCode = expense?.original_currency_code || defaultCurrencyCode;
  const originalAmount = expense?.original_amount ?? expense?.amount ?? '';
  const currentConversionRate = getTripExpenseEffectiveRate(originalCurrencyCode);
  const quantityValue = Number(expense?.quantity ?? 1);
  const normalizedQuantity = Number.isFinite(quantityValue) && quantityValue > 0 ? quantityValue : 1;
  const derivedUnitPrice = originalAmount !== '' && Number.isFinite(Number(originalAmount)) && normalizedQuantity > 0
    ? (Math.round((Number(originalAmount) / normalizedQuantity) * 100) / 100)
    : null;
  const displayUnitPrice = derivedUnitPrice != null
    ? derivedUnitPrice
    : (expense?.unit_price ?? expense?.amount ?? '');
  const convertedTotal = originalAmount !== ''
    ? (() => {
        const rate = currentConversionRate;
        if (String(originalCurrencyCode).toUpperCase() === defaultCurrencyCode.toUpperCase()) {
          return Math.round(Number(originalAmount) * 100) / 100;
        }
        if (Number.isFinite(rate) && rate > 0) {
          return Math.round(Number(originalAmount) * rate * 100) / 100;
        }
        return expense?.amount ?? '';
      })()
    : (expense?.amount ?? '');
  const currencyOptions = (Array.isArray(_tripCurrencies) && _tripCurrencies.length ? _tripCurrencies : [{ currency_code: defaultCurrencyCode }])
    .map((item) => String(item.currency_code || '').toUpperCase())
    .filter((code, index, arr) => code && arr.indexOf(code) === index);
  const members = _tripDetail.members || [];
  const fallbackPaidByKey = expense
    ? _resolveTripExpenseMemberUiKey(expense?.paid_by_key, expense?.paid_by_name, members)
    : (members[0] ? _memberKey(members[0]) : 'self');
  const resolvedSplitShares = expense?.splits?.length
    ? (expense.splits || []).map((split) => ({
        key: _resolveTripExpenseMemberUiKey(split?.member_key, split?.member_name, members),
        share: split?.share_amount,
      }))
    : [];
  const selectedKeys = resolvedSplitShares.length
    ? new Set(resolvedSplitShares.map((split) => split.key))
    : new Set([fallbackPaidByKey]);
  _tripExpSel = selectedKeys;
  _tripExpPaidBy = selectedKeys.has(fallbackPaidByKey) ? fallbackPaidByKey : [...selectedKeys][0] || fallbackPaidByKey;
  _tripExpMode = expense?.split_mode || 'equal';
  _tripExpValues = resolvedSplitShares.length
    ? _restoreSplitValues(
        _tripExpMode,
        resolvedSplitShares,
        parseFloat(expense.amount) || 0
      )
    : {};
  const splitModeChips = SPLIT_MODES.map((mode) =>
    `<button class="chip split-mode-chip ${_tripExpMode === mode.key ? 'active' : ''}" data-mode="${mode.key}" onclick="tripSetSplitMode('${mode.key}')">${mode.label}</button>`
  ).join('');
  const participantChips = members.map((member) => {
    const key = _memberKey(member);
    const selected = _tripExpSel.has(key);
    return `<button type="button" class="fr-chip ${selected ? 'sel' : ''}" onclick="tripToggleMember('${key}')">
      <span class="cbox ${selected ? 'chk' : ''}">${selected ? '&#10003;' : ''}</span>${escHtml(member.member_name)}
    </button>`;
  }).join('');
  openModal(expense ? 'Edit Trip Expense' : 'Add Trip Expense', `
    <div class="fg">
      <label class="fl">Expense Type *
        <input class="fi" id="tripExpenseType" list="tripExpenseTypeList" placeholder="Travel, Stay, Food..." value="${escHtml(expense?.expense_type || '')}">
        <datalist id="tripExpenseTypeList">${tripExpenseTypeDatalist(expense?.expense_type || '')}</datalist>
      </label>
      <label class="fl">Expense Date *
        <input class="fi" type="date" id="tripExpenseDate" value="${normalizeInputDate(expense?.expense_date) || todayStr()}">
      </label>
      <label class="fl full">Details *
        <input class="fi" id="tripExpenseDetails" placeholder="Hotel advance, petrol, dinner..." value="${escHtml(expense?.details || '')}">
      </label>
      <label class="fl">Quantity
        <input class="fi" id="tripExpenseQty" type="number" min="0" step="0.01" value="${normalizedQuantity}" oninput="tripExpenseAutoTotal()">
      </label>
      <label class="fl">Price
        <input class="fi" id="tripExpensePrice" type="number" min="0" step="0.01" value="${displayUnitPrice}" oninput="tripExpenseAutoTotal()">
      </label>
      <label class="fl">Total *
        <input class="fi" id="tripExpenseAmount" type="number" min="0" step="0.01" value="${convertedTotal}" readonly>
      </label>
      <label class="fl">Original Currency
        <select class="fi" id="tripExpenseOrigCurrency" onchange="tripExpenseCurrencyChanged()">
          ${currencyOptions.map((code) => `<option value="${code}" ${code === originalCurrencyCode ? 'selected' : ''}>${code}</option>`).join('')}
        </select>
      </label>
      <label class="fl">Original Amount
        <input class="fi" id="tripExpenseOrigAmount" type="number" min="0" step="0.01" value="${originalAmount}" oninput="tripExpenseCurrencyChanged()">
      </label>
      <label class="fl" id="tripExpenseRateWrap">Conversion
        <input class="fi" id="tripExpenseConversionRateView" type="text" value="${escHtml(formatTripCurrencyHintWithRate(originalCurrencyCode, currentConversionRate))}" readonly>
      </label>
      <label class="fl">Paid By
        <select class="fi" id="tripExpensePaidBy" onchange="tripExpenseChangePaidBy(this.value)">
          ${members.map((member) => {
            const key = _memberKey(member);
            return `<option value="${escHtml(key)}" ${String(key) === String(_tripExpPaidBy) ? 'selected' : ''}>${escHtml(member.member_name)}</option>`;
          }).join('')}
        </select>
      </label>
      <label class="fl full">Notes
        <textarea class="fi" id="tripExpenseNotes" rows="3" placeholder="Optional notes">${escHtml(expense?.notes || '')}</textarea>
      </label>
    </div>
    <div class="card" style="padding:14px 16px;margin-top:12px">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px">Share Expense With Members</div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:10px">Choose members who should share this expense. If only one member is selected, it stays as a personal trip expense.</div>
      <div id="tripDivChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${participantChips}</div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:6px">Split Mode</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${splitModeChips}</div>
      <div id="tripSplitInputs"></div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="saveTripExpenseModal(${expense?.id || 'null'})">${expense ? 'Save Expense' : 'Add Expense'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>
  `);
  tripExpenseCurrencyChanged();
  tripUpdateSplitInputs();
}

function tripExpenseAutoTotal() {
  const qty = parseFloat(document.getElementById('tripExpenseQty')?.value || 0);
  const price = parseFloat(document.getElementById('tripExpensePrice')?.value || 0);
  const originalAmountInput = document.getElementById('tripExpenseOrigAmount');
  const totalInput = document.getElementById('tripExpenseAmount');
  if (!totalInput) return;
  if (qty > 0 && price >= 0) {
    const originalTotal = (Math.round(qty * price * 100) / 100).toFixed(2);
    if (originalAmountInput) originalAmountInput.value = originalTotal;
  }
  recalcTripExpenseConvertedTotal();
  tripHandleAmountChange();
}

function tripExpenseCurrencyChanged() {
  recalcTripExpenseConvertedTotal();
  tripHandleAmountChange();
}

function tripExpenseChangePaidBy(key) {
  _tripExpPaidBy = key;
  if (!_tripExpSel.has(key)) _tripExpSel.add(key);
  const container = document.getElementById('tripDivChips');
  if (container) {
    container.querySelectorAll('.fr-chip').forEach((btn) => {
      const match = btn.getAttribute('onclick')?.match(/tripToggleMember\('(.+?)'\)/);
      if (!match) return;
      const chipKey = match[1];
      const selected = _tripExpSel.has(chipKey);
      btn.classList.toggle('sel', selected);
      const cbox = btn.querySelector('.cbox');
      if (cbox) { cbox.classList.toggle('chk', selected); cbox.innerHTML = selected ? '&#10003;' : ''; }
    });
  }
  tripHandleAmountChange();
}


async function saveTripExpenseModal(expenseId = null) {
  if (!_selectedTripId) return;
  const amountValue = document.getElementById('tripExpenseAmount')?.value || null;
  const members = _tripDetail?.members || [];
  const payer = members.find((member) => String(_memberKey(member)) === String(_tripExpPaidBy));
  if (!payer) {
    toast('Choose who paid this expense', 'warning');
    return;
  }
  if (_tripExpSel.size === 0) {
    toast('Select at least one member', 'warning');
    return;
  }
  if (!_tripExpSel.has(_tripExpPaidBy)) {
    toast('Paid by member must also be included in sharing', 'warning');
    return;
  }
  const people = _tripSelectedPeople();
  const amountNumber = parseFloat(amountValue || 0);
  const { valid, error, shares } = computeShares(amountNumber, _tripExpMode, people, _tripExpValues);
  if (!valid) {
    toast(error || 'Invalid split', 'warning');
    return;
  }
  const body = {
    expense_type: document.getElementById('tripExpenseType')?.value.trim(),
    details: document.getElementById('tripExpenseDetails')?.value.trim(),
    expense_date: document.getElementById('tripExpenseDate')?.value,
    quantity: document.getElementById('tripExpenseQty')?.value || null,
    unit_price: document.getElementById('tripExpensePrice')?.value || null,
    amount: amountValue,
    original_currency_code: document.getElementById('tripExpenseOrigCurrency')?.value || (_currentUser?.currency_code || 'INR'),
    original_amount: document.getElementById('tripExpenseOrigAmount')?.value || amountValue,
    conversion_rate: getTripExpenseEffectiveRate(document.getElementById('tripExpenseOrigCurrency')?.value || (_currentUser?.currency_code || 'INR')) || 1,
    notes: document.getElementById('tripExpenseNotes')?.value.trim() || null,
    paid_by_key: _tripExpPaidBy,
    paid_by_name: payer.member_name,
    split_mode: _tripExpMode,
    splits: shares.map((share) => ({ member_key: share.key, member_name: share.name, share_amount: share.share })),
  };
  if (!body.expense_type || !body.details || !body.expense_date) {
    toast('Type, detail, and date are required', 'warning');
    return;
  }
  const result = await api(expenseId ? `/api/trips/${_selectedTripId}/expenses/${expenseId}` : `/api/trips/${_selectedTripId}/expenses`, {
    method: expenseId ? 'PUT' : 'POST',
    body,
  });
  if (result?.error) {
    toast(result.error, 'error');
    return;
  }
  closeModal();
  toast(expenseId ? 'Expense updated' : 'Expense added', 'success');
  _tripExpMode = 'equal';
  _tripExpValues = {};
  await openTripDetail(_selectedTripId);
}

async function tripDeleteExpense(expenseId) {
  if (!await confirmDialog('Delete this trip expense?')) return;
  const result = await api(`/api/trips/${_selectedTripId}/expenses/${expenseId}`, { method: 'DELETE' });
  if (result?.error) {
    toast(result.error, 'error');
    return;
  }
  toast('Expense deleted', 'success');
  await openTripDetail(_selectedTripId);
}

async function tripDeleteAllExpenses() {
  if (!_selectedTripId || !_tripDetail) return;
  const count = Array.isArray(_tripDetail.expenses) ? _tripDetail.expenses.length : 0;
  if (!count) {
    toast('No expenses to delete', 'warning');
    return;
  }
  const tripName = _tripDetail.destination || _tripDetail.name || 'this trip';
  if (!await confirmDialog(`Delete all ${count} expenses inside "${tripName}"?`)) return;
  const result = await api(`/api/trips/${_selectedTripId}/expenses`, { method: 'DELETE' });
  if (result?.error) {
    toast(result.error, 'error');
    return;
  }
  toast('All trip expenses deleted', 'success');
  await openTripDetail(_selectedTripId);
}

async function tripDelete(tripId) {
  const targetId = tripId || _selectedTripId;
  const trip = (_tripDetail && String(_tripDetail.id) === String(targetId))
    ? _tripDetail
    : (_trips.find((row) => String(row.id) === String(targetId)) || null);
  if (!targetId || !trip) return;
  if (!await confirmDialog(`Delete trip "${trip.destination || trip.name}" and all its expenses?`)) return;
  const result = await api(`/api/trips/${targetId}`, { method: 'DELETE' });
  if (result?.error) {
    toast(result.error, 'error');
    return;
  }
  toast('Trip deleted', 'success');
  await loadTrips();
}

function showTripExpenseExcelImport(tripId = null) {
  const targetId = tripId || _selectedTripId;
  if (!targetId) {
    toast('Open a trip first', 'warning');
    return;
  }
  openModal('Import Trip Expenses From Excel', `
    <div style="background:var(--green-l);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:var(--t2)">
      <div style="font-weight:700;color:var(--green);margin-bottom:6px">Import expenses directly into this trip</div>
      <div>You can import detailed trip sheets like hotel, petrol, food, and other expense tables from your workbook.</div>
      <div style="margin-top:4px">You can also import shared split sheets with columns like <b>Date</b>, <b>Thing</b>, <b>Amount</b>, and <b>Equal Divide</b>. Codes like <b>HD</b> will split the row equally between matching trip members.</div>
    </div>
    <div class="fg" style="margin-bottom:14px">
      <label class="fl full">File (.xlsx / .xls / .ods)
        <input type="file" accept=".xlsx,.xls,.ods" id="tripExpenseXlsxFile" class="fi">
      </label>
      <label class="fl">Password (if protected)
        <input type="password" id="tripExpenseXlsxPass" class="fi" placeholder="Leave blank if none" autocomplete="new-password">
      </label>
      <label class="fl" style="justify-content:flex-end;padding-top:20px">
        <button class="btn btn-p" onclick="loadTripExpenseExcelSheets(${targetId})">Load Sheets &rarr;</button>
      </label>
    </div>
    <div id="tripExpenseXlsxSheetArea"></div>
    <div id="tripExpenseXlsxPreview"></div>
  `);
}

function getSelectedTripExpenseSheets() {
  return [...document.querySelectorAll('.trip-expense-xlsx-sheet-cb:checked')].map((checkbox) => checkbox.value);
}

async function loadTripExpenseExcelSheets(tripId = null) {
  const targetId = tripId || _selectedTripId;
  const file = document.getElementById('tripExpenseXlsxFile')?.files?.[0];
  if (!targetId) {
    toast('Open a trip first', 'warning');
    return;
  }
  if (!file) {
    toast('Please select a file first', 'warning');
    return;
  }
  const password = document.getElementById('tripExpenseXlsxPass')?.value || '';
  document.getElementById('tripExpenseXlsxSheetArea').innerHTML = `<div style="color:var(--t3);font-size:13px;margin-bottom:10px">Reading file...</div>`;
  document.getElementById('tripExpenseXlsxPreview').innerHTML = '';
  const fd = new FormData();
  fd.append('file', file);
  if (password) fd.append('password', password);
  const res = await fetch(`/api/trips/${targetId}/expenses/import-excel/sheets`, { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) {
    document.getElementById('tripExpenseXlsxSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px">${data.error}</p>`;
    return;
  }
  const checkboxes = (data.sheets || []).map((sheet, index) => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;cursor:pointer;background:var(--bg);margin-bottom:4px">
      <input type="checkbox" class="trip-expense-xlsx-sheet-cb" value="${sheet}" ${index === 0 ? 'checked' : ''} onchange="document.getElementById('tripExpenseXlsxPreview').innerHTML=''">
      <span style="font-size:13px">${sheet}</span>
    </label>
  `).join('');
  document.getElementById('tripExpenseXlsxSheetArea').innerHTML = `
    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600;color:var(--t2)">SELECT SHEETS</span>
        <span style="font-size:11px;color:var(--t3);cursor:pointer" onclick="document.querySelectorAll('.trip-expense-xlsx-sheet-cb').forEach(c=>c.checked=true)">Select all</span>
      </div>
      ${checkboxes}
    </div>
    <button class="btn btn-s" onclick="previewTripExpenseExcelImport(${targetId})">Preview &rarr;</button>
  `;
  if ((data.sheets || []).length === 1) previewTripExpenseExcelImport(targetId);
}

async function previewTripExpenseExcelImport(tripId = null) {
  const targetId = tripId || _selectedTripId;
  const file = document.getElementById('tripExpenseXlsxFile')?.files?.[0];
  const sheets = getSelectedTripExpenseSheets();
  const password = document.getElementById('tripExpenseXlsxPass')?.value || '';
  if (!targetId || !file) return;
  if (!sheets.length) {
    toast('Select at least one sheet', 'warning');
    return;
  }
  document.getElementById('tripExpenseXlsxPreview').innerHTML = `<div style="color:var(--t3);font-size:13px">Loading preview...</div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  if (password) fd.append('password', password);
  const res = await fetch(`/api/trips/${targetId}/expenses/import-excel/preview`, { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) {
    document.getElementById('tripExpenseXlsxPreview').innerHTML = `<p style="color:var(--red);font-size:13px">${data.error}</p>`;
    return;
  }
  if (!data.count) {
    document.getElementById('tripExpenseXlsxPreview').innerHTML = `<p style="color:var(--amber);font-size:13px">No valid expense rows found. Try a different sheet selection or workbook layout.</p>`;
    return;
  }
  document.getElementById('tripExpenseXlsxPreview').innerHTML = `
    <p style="font-size:13px;margin-bottom:10px">Found <b>${data.count}</b> valid expense row${data.count !== 1 ? 's' : ''} <span style="color:var(--t3)">(${data.skipped} skipped)</span></p>
    <div style="max-height:260px;overflow:auto;margin-bottom:14px">
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Type</th><th>Details</th><th class="td-m">Qty</th><th class="td-m">Price</th><th class="td-m">Amount</th></tr></thead>
        <tbody>${(data.preview || []).map((expense) => `<tr>
          <td>${expense.expense_date ? fmtDate(expense.expense_date) : '-'}</td>
          <td>${escHtml(expense.expense_type || '-')}</td>
          <td>${escHtml(expense.details || '-')}</td>
          <td class="td-m">${expense.quantity != null ? escHtml(String(expense.quantity)) : '-'}</td>
          <td class="td-m">${expense.unit_price != null ? fmtCur(expense.unit_price) : '-'}</td>
          <td class="td-m">${fmtCur(expense.amount || 0)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doTripExpenseExcelImport(${targetId})">Import ${data.count} Expense Row${data.count !== 1 ? 's' : ''}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>
  `;
}

async function doTripExpenseExcelImport(tripId = null) {
  const targetId = tripId || _selectedTripId;
  const file = document.getElementById('tripExpenseXlsxFile')?.files?.[0];
  const sheets = getSelectedTripExpenseSheets();
  const password = document.getElementById('tripExpenseXlsxPass')?.value || '';
  if (!targetId || !file || !sheets.length) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  if (password) fd.append('password', password);
  const res = await fetch(`/api/trips/${targetId}/expenses/import-excel`, { method: 'POST', body: fd });
  const data = await res.json();
  if (data.success) {
    toast(`Imported ${data.imported} trip expense item${data.imported !== 1 ? 's' : ''}`, 'success');
    closeModal();
    await openTripDetail(targetId);
  } else {
    toast(`Trip expense import failed: ${data.error || 'Unknown error'}`, 'error');
  }
}

function showTripExcelImport() {
  openModal('Import Trips From Excel', `
    <div style="background:var(--green-l);border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:12px;color:var(--t2)">
      <div style="font-weight:700;color:var(--green);margin-bottom:6px">Supported Excel styles</div>
      <div>1. Summary sheet with columns like Destination, Start date, End date, Total Distance, Total Expenditure, Status, Category, Members, Transport Mode.</div>
      <div style="margin-top:4px">2. Detailed trip sheet like your travel workbook with Location, Start Date, End Date, Total Distance Travelled, Persons, and grouped expense tables.</div>
    </div>
    <div class="fg" style="margin-bottom:14px">
      <label class="fl full">File (.xlsx / .xls / .ods)
        <input type="file" accept=".xlsx,.xls,.ods" id="tripXlsxFile" class="fi">
      </label>
      <label class="fl">Password (if protected)
        <input type="password" id="tripXlsxPass" class="fi" placeholder="Leave blank if none" autocomplete="new-password">
      </label>
      <label class="fl" style="justify-content:flex-end;padding-top:20px">
        <button class="btn btn-p" onclick="loadTripExcelSheets()">Load Sheets &rarr;</button>
      </label>
    </div>
    <div id="tripXlsxSheetArea"></div>
    <div id="tripXlsxPreview"></div>
  `);
}

function getSelectedTripSheets() {
  return [...document.querySelectorAll('.trip-xlsx-sheet-cb:checked')].map((checkbox) => checkbox.value);
}

async function loadTripExcelSheets() {
  const file = document.getElementById('tripXlsxFile')?.files?.[0];
  if (!file) {
    toast('Please select a file first', 'warning');
    return;
  }
  const password = document.getElementById('tripXlsxPass')?.value || '';
  document.getElementById('tripXlsxSheetArea').innerHTML = `<div style="color:var(--t3);font-size:13px;margin-bottom:10px">Reading file...</div>`;
  document.getElementById('tripXlsxPreview').innerHTML = '';
  const fd = new FormData();
  fd.append('file', file);
  if (password) fd.append('password', password);
  const res = await fetch('/api/trips/import-excel/sheets', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) {
    document.getElementById('tripXlsxSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px">${data.error}</p>`;
    return;
  }
  const checkboxes = (data.sheets || []).map((sheet, index) => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;cursor:pointer;background:var(--bg);margin-bottom:4px">
      <input type="checkbox" class="trip-xlsx-sheet-cb" value="${sheet}" ${index === 0 ? 'checked' : ''} onchange="document.getElementById('tripXlsxPreview').innerHTML=''">
      <span style="font-size:13px">${sheet}</span>
    </label>
  `).join('');
  document.getElementById('tripXlsxSheetArea').innerHTML = `
    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600;color:var(--t2)">SELECT SHEETS</span>
        <span style="font-size:11px;color:var(--t3);cursor:pointer" onclick="document.querySelectorAll('.trip-xlsx-sheet-cb').forEach(c=>c.checked=true)">Select all</span>
      </div>
      ${checkboxes}
    </div>
    <button class="btn btn-s" onclick="previewTripExcelImport()">Preview &rarr;</button>
  `;
  if ((data.sheets || []).length === 1) previewTripExcelImport();
}

async function previewTripExcelImport() {
  const file = document.getElementById('tripXlsxFile')?.files?.[0];
  const sheets = getSelectedTripSheets();
  const password = document.getElementById('tripXlsxPass')?.value || '';
  if (!file) return;
  if (!sheets.length) {
    toast('Select at least one sheet', 'warning');
    return;
  }
  document.getElementById('tripXlsxPreview').innerHTML = `<div style="color:var(--t3);font-size:13px">Loading preview...</div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  if (password) fd.append('password', password);
  const res = await fetch('/api/trips/import-excel/preview', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) {
    document.getElementById('tripXlsxPreview').innerHTML = `<p style="color:var(--red);font-size:13px">${data.error}</p>`;
    return;
  }
  if (!data.count) {
    document.getElementById('tripXlsxPreview').innerHTML = `<p style="color:var(--amber);font-size:13px">No valid trips found. Try another sheet selection or adjust the workbook layout.</p>`;
    return;
  }
  document.getElementById('tripXlsxPreview').innerHTML = `
    <p style="font-size:13px;margin-bottom:10px">Found <b>${data.count}</b> valid trip${data.count !== 1 ? 's' : ''} <span style="color:var(--t3)">(${data.skipped} sheet${data.skipped !== 1 ? 's' : ''} skipped)</span></p>
    <div style="max-height:260px;overflow:auto;margin-bottom:14px">
      <div class="table-wrap"><table>
        <thead><tr><th>Destination</th><th>Dates</th><th>Status</th><th>Category</th><th class="td-m">Distance</th><th class="td-m">Spend</th><th>Items</th></tr></thead>
        <tbody>${(data.preview || []).map((trip) => `<tr>
          <td>${escHtml(trip.destination || '-')}</td>
          <td>${trip.start_date ? fmtDate(trip.start_date) : '-'} ${trip.end_date ? `to ${fmtDate(trip.end_date)}` : ''}</td>
          <td>${tripStatusBadge(trip.status)}</td>
          <td>${escHtml(trip.category || '-')}</td>
          <td class="td-m">${trip.total_distance != null ? escHtml(String(trip.total_distance)) : '-'}</td>
          <td class="td-m">${fmtCur(trip.total_expenditure || 0)}</td>
          <td>${trip.expense_count || 0} expense item${Number(trip.expense_count || 0) !== 1 ? 's' : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doTripExcelImport()">Import ${data.count} Trip${data.count !== 1 ? 's' : ''}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>
  `;
}

async function doTripExcelImport() {
  const file = document.getElementById('tripXlsxFile')?.files?.[0];
  const sheets = getSelectedTripSheets();
  const password = document.getElementById('tripXlsxPass')?.value || '';
  if (!file || !sheets.length) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  if (password) fd.append('password', password);
  const res = await fetch('/api/trips/import-excel', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.success) {
    toast(`Imported ${data.imported_trips} trips and ${data.imported_expenses} expense items`, 'success');
    closeModal();
    await loadTrips();
  } else {
    toast(`Trip import failed: ${data.error || 'Unknown error'}`, 'error');
  }
}

async function checkTripInvite(token) {
  const data = await api(`/api/trips/invite/${token}`);
  if (!data?.invite) { toast('Invalid or expired invite link', 'error'); return; }
  const inv = data.invite;
  const confirmed = await confirmDialog(`${inv.owner_name} invited you to join trip "${inv.trip_name}" as "${inv.member_name}".\n\nAccept invite?`);
  if (!confirmed) return;
  const r = await api(`/api/trips/invite/${token}/accept`, { method: 'POST' });
  if (r?.success) {
    toast('Invite accepted! Opening trip...', 'success');
    switchTab('trips');
    await openTripDetail(r.tripId);
  } else {
    toast(r?.error || 'Failed to accept invite', 'error');
  }
}

// â”€â”€â”€ Friends Share Links â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function showFriendsShareModal() {
  const [frData, linksData] = await Promise.all([api('/api/friends'), api('/api/shares')]);
  const friends = frData?.friends || [];
  const links = linksData?.links || [];

  const friendCheckboxes = friends.map(f =>
    `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:3px 0">
      <input type="checkbox" class="share-friend-cb" value="${f.id}"> ${escHtml(f.name)} <span style="font-size:11px;color:var(--t3)">(${f.balance > 0 ? '+' : ''}${fmtCur(f.balance)})</span>
    </label>`
  ).join('') || '<div style="color:var(--t3);font-size:12px">No friends yet.</div>';

  const linkRows = links.length === 0
    ? '<div style="font-size:12px;color:var(--t3);padding:8px 0">No share links yet.</div>'
    : links.map(l => {
        const url = `${location.origin}/s/${l.token}`;
        const expired = l.expires_at && l.expires_at < new Date().toISOString().split('T')[0];
        return `<div style="border:1px solid var(--br);border-radius:10px;padding:12px;margin-bottom:10px;font-size:12px${expired ? ';opacity:0.5' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
            <div style="color:var(--em);word-break:break-all;line-height:1.5">${url}</div>
            <button class="btn-d" style="color:var(--red);flex-shrink:0;margin-left:8px" onclick="deleteShareLink(${l.id})" title="Delete link">x</button>
          </div>
          <div style="color:var(--t3);line-height:1.5">${expired ? '! Expired' : l.expires_at ? `Expires ${l.expires_at}` : 'No expiry'} - ${l.view_count} views</div>
          ${!expired ? `<button class="btn btn-g btn-sm" style="margin-top:6px" onclick="navigator.clipboard.writeText('${url}').then(()=>toast('Copied!','success'))">Copy Link</button>` : ''}
        </div>`;
      }).join('');

  openModal('Share Friends List', `
    <div style="font-size:13px;font-weight:600;margin-bottom:10px">Create a new share link</div>
    <div style="margin-bottom:12px">
      <div style="font-size:12px;color:var(--t2);margin-bottom:6px">Friends to include (leave all unchecked = show all)</div>
      <div style="max-height:150px;overflow-y:auto;border:1px solid var(--br);border-radius:6px;padding:8px">${friendCheckboxes}</div>
    </div>
    <div class="fg" style="margin-bottom:12px">
      <label class="fl">Filter Year (optional)<input class="fi" type="number" id="shareYear" placeholder="e.g. 2025" min="2020" max="2030"></label>
      <label class="fl">Filter Month (optional)<input class="fi" type="number" id="shareMonth" placeholder="1-12" min="1" max="12"></label>
      <label class="fl">Expires on (optional)<input class="fi" type="date" id="shareExpiry"></label>
    </div>
    <div class="fa" style="margin-bottom:16px">
      <button class="btn btn-p btn-sm" onclick="createShareLink()">Create Link</button>
    </div>
    <div style="border-top:1px solid var(--br);padding-top:14px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px">Existing links</div>
      <div id="shareLinksList">${linkRows}</div>
    </div>`);
}

async function createShareLink() {
  const year = parseInt(document.getElementById('shareYear').value) || null;
  const month = parseInt(document.getElementById('shareMonth').value) || null;
  const expires_at = document.getElementById('shareExpiry').value || null;
  const friendIds = [];
  document.querySelectorAll('.share-friend-cb:checked').forEach(cb => friendIds.push(parseInt(cb.value)));
  const filters = {};
  if (year) filters.year = year;
  if (month) filters.month = month;
  if (friendIds.length > 0) filters.friend_ids = friendIds;
  const r = await api('/api/shares', { method: 'POST', body: { filters, expires_at } });
  if (r?.token) {
    toast('Share link created!', 'success');
    showFriendsShareModal(); // refresh modal
  } else toast(r?.error || 'Failed', 'error');
}

async function deleteShareLink(id) {
  if (!await confirmDialog('Delete this share link? Anyone with it will no longer be able to access it.')) return;
  await api(`/api/shares/${id}`, { method: 'DELETE' });
  toast('Link deleted', 'success');
  showFriendsShareModal();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ADMIN PANEL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let adminSection = 'users'; // users | expense_stats | public_stats | plans | subscriptions | notifications | ai | currencies
let _adminNotifUsers = [];
let _adminNotifSelected = new Set();
let _adminNotifSearch = '';
let _adminNotifLastResult = null;
let _adminAiDays = 30;
let _adminAiReport = null;
let _adminAiTestResult = null;
let _adminAiTestError = '';
let _adminAiLoadError = '';
let _adminPublicStats = null;
let _adminExpenseStats = null;
let _adminAiTrainingDraft = null;

const ADMIN_AI_INTENTS = [
  { key: 'top_expenses', label: 'Most Expensive Item', description: 'Find the highest recent expense or top expense list.', examples: ['what is the most expensive item', 'what are my top expenses'] },
  { key: 'top_expense_year', label: 'Highest Spend Year', description: 'Tell which year had the most total spending.', examples: ['which year did i spend the most'] },
  { key: 'expense_year_total', label: 'Yearly Expense Total', description: 'Show total spending for a year.', examples: ['what is my total expense this year'] },
  { key: 'fair_expense_year', label: 'Fair Expense Total', description: 'Show fair spending for a year.', examples: ['what is my fair expense this year'] },
  { key: 'extra_expense_year', label: 'Extra Expense Total', description: 'Show extra spending for a year.', examples: ['what is my extra expense this year'] },
  { key: 'expense_month_total', label: 'Monthly Expense Total', description: 'Show spending for a given month.', examples: ['what did i spend this month'] },
  { key: 'expense_month_comparison', label: 'Month Comparison', description: 'Compare one month with another.', examples: ['compare this month vs last month'] },
  { key: 'expenses_last_3_months', label: 'Last 3 Months', description: 'Summarize last 3 months of spending.', examples: ['how much did i spend in the last 3 months'] },
  { key: 'expenses_last_6_months', label: 'Last 6 Months', description: 'Summarize last 6 months of spending.', examples: ['how much did i spend in the last 6 months'] },
  { key: 'recent_expenses', label: 'Recent Expenses', description: 'List the latest expenses or transactions.', examples: ['show my recent transactions'] },
  { key: 'category_total', label: 'Category Spend', description: 'Show spending for one category.', examples: ['how much did i spend on groceries'] },
  { key: 'top_category', label: 'Top Category', description: 'Find the category with the most spend.', examples: ['what is my top category'] },
  { key: 'friend_balance', label: 'Friend Balance', description: 'Show balance with a named friend.', examples: ['does neena owe me money'] },
  { key: 'friends_owe_me', label: 'Who Owes Me', description: 'List friends who owe you money.', examples: ['who owes me money'] },
  { key: 'i_owe_friends', label: 'I Owe Friends', description: 'List friends you owe money to.', examples: ['do i owe anyone'] },
  { key: 'trip_summary', label: 'Trip Summary', description: 'Show totals for a named trip.', examples: ['how much did i spend on goa trip'] },
  { key: 'trip_list', label: 'Trip List', description: 'List trips.', examples: ['show my trips'] },
  { key: 'expense_day_total', label: 'Day Expense Total', description: 'Show spending for a specific date.', examples: ['how much did i spend on 17 april 2026'] },
  { key: 'expense_today_total', label: 'Today Expense Total', description: 'Show total spending for today.', examples: ['what did i spend today', 'total my today expenses'] },
  { key: 'credit_card_detail', label: 'Credit Card Detail', description: 'Show due, spent, or limit for a card.', examples: ['what is the due on hdfc card'] },
  { key: 'credit_card_due', label: 'Credit Card Due', description: 'Show all current card dues.', examples: ['how much is my credit card due this month'] },
  { key: 'active_emis', label: 'Active EMIs', description: 'List active or pending EMI records.', examples: ['which emis are active'] },
  { key: 'recurring_payments', label: 'Recurring Payments', description: 'Show recurring and planner dues.', examples: ['what are my recurring monthly payments'] },
  { key: 'bank_balances', label: 'Bank Balances', description: 'Show bank totals and spendable balance.', examples: ['show my bank balances'] },
  { key: 'financial_overview', label: 'Financial Overview', description: 'Give a broad summary of finances.', examples: ['show my financial overview'] },
];

const ALL_PAGES = [
  { key: 'dashboard',   label: 'Dashboard' },
  { key: 'expenses',    label: 'Expenses' },
  { key: 'friends',     label: 'Friends & Loans' },
  { key: 'divide',      label: 'Split Expenses' },
  { key: 'livesplit',   label: 'Live Split' },
  { key: 'petroldivide', label: 'Divide Petrol' },
  { key: 'petrol_fake',  label: 'Petrol - Allow Fake Entries' },
  { key: 'trips',       label: 'Trips' },
  { key: 'reports',     label: 'Reports' },
  { key: 'emi',         label: 'EMI Calculator' },
  { key: 'emitracker',  label: 'My EMIs' },
  { key: 'friendemis',  label: 'Friend EMIs' },
  { key: 'creditcards', label: 'Credit Cards' },
  { key: 'banks',       label: 'Bank Accounts' },
  { key: 'planner',     label: 'Planner' },
  { key: 'tracker',     label: 'Daily Tracker' },
  { key: 'recurring',   label: 'Recurring' },
  { key: 'ailookup',    label: 'AI Lookup' },
  { key: 'notifications', label: 'Notifications' },
];

async function loadAdmin() {
  if (_userRole !== 'admin') {
    document.getElementById('main').innerHTML = '<div class="tab-content"><div style="text-align:center;padding:60px;color:var(--t3)">Access denied</div></div>';
    return;
  }
  renderAdminShell();
  if (adminSection === 'users') await loadAdminUsers();
  else if (adminSection === 'expense_stats') await loadAdminExpenseStats();
  else if (adminSection === 'public_stats') await loadAdminPublicStats();
  else if (adminSection === 'plans') await loadAdminPlans();
  else if (adminSection === 'subscriptions') await loadAdminSubscriptions();
  else if (adminSection === 'currencies') await loadAdminCurrencies();
  else if (adminSection === 'notifications') await loadAdminNotifications();
  else if (adminSection === 'ai') await loadAdminAiLearning();
}

function renderAdminShell() {
  const tabs = [['users','Users'], ['expense_stats','Expense Stats'], ['public_stats','Public Stats'], ['plans','Plans'], ['subscriptions','Subscriptions'], ['currencies','Currencies'], ['notifications','Notifications'], ['ai','AI Learning']];
  const tabHtml = tabs.map(([k,l]) =>
    `<button class="chip ${adminSection===k?'active':''}" onclick="adminSection='${k}';loadAdmin()">${l}</button>`
  ).join('');
  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="font-size:20px;font-weight:700;margin-bottom:16px">Admin Panel</div>
      <div style="display:flex;gap:8px;margin-bottom:20px">${tabHtml}</div>
      <div id="adminContent"></div>
    </div>`;
}

async function loadAdminCurrencies() {
  const result = await api('/api/admin/currencies');
  if (result?.error) {
    toast(result.error, 'error');
    _adminCurrencies = [];
  } else {
    _adminCurrencies = Array.isArray(result?.currencies) ? result.currencies : [];
  }
  renderAdminCurrencies();
}

function renderAdminCurrencies() {
  const rows = Array.isArray(_adminCurrencies) ? [..._adminCurrencies] : [];
  rows.sort((a, b) => String(a.currency_code || '').localeCompare(String(b.currency_code || '')));
  const html = rows.length
    ? rows.map((item) => `
        <tr>
          <td style="padding:12px">${escHtml(item.currency_code || '')}</td>
          <td style="padding:12px;text-align:right">${Number(item.rate_to_inr || 0).toFixed(6)}</td>
          <td style="padding:12px">${item.is_active ? '<span style="color:var(--ok)">Active</span>' : '<span style="color:var(--t3)">Inactive</span>'}</td>
          <td style="padding:12px">${fmtDate(item.updated_at)}</td>
          <td style="padding:12px;text-align:right;white-space:nowrap">
            <button class="btn btn-s btn-sm" onclick="openAdminCurrencyModal('${escHtml(item.currency_code || '')}')">Edit</button>
            ${String(item.currency_code || '').toUpperCase() === 'INR' ? '' : `<button class="btn btn-g btn-sm" style="margin-left:8px" onclick="deleteAdminCurrency('${escHtml(item.currency_code || '')}')">Delete</button>`}
          </td>
        </tr>`)
      .join('')
    : `<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--t3)">No currencies added yet.</td></tr>`;
  document.getElementById('adminContent').innerHTML = `
    <div class="card" style="padding:18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">
        <div>
          <div class="card-title">Currency Master</div>
          <div style="font-size:12px;color:var(--t3)">Manage currency rates once here. Trip expense forms will use these saved rates automatically.</div>
        </div>
        <button class="btn btn-p btn-sm" onclick="openAdminCurrencyModal()">Add Currency</button>
      </div>
      <div style="overflow:auto">
        <table style="width:100%;border-collapse:collapse;min-width:640px">
          <thead>
            <tr style="background:var(--bg2);color:var(--t2)">
              <th style="text-align:left;padding:10px 12px;font-size:12px">Currency</th>
              <th style="text-align:right;padding:10px 12px;font-size:12px">Rate To INR</th>
              <th style="text-align:left;padding:10px 12px;font-size:12px">Status</th>
              <th style="text-align:left;padding:10px 12px;font-size:12px">Updated</th>
              <th style="text-align:right;padding:10px 12px;font-size:12px">Actions</th>
            </tr>
          </thead>
          <tbody>${html}</tbody>
        </table>
      </div>
    </div>`;
}

function openAdminCurrencyModal(currencyCode = '') {
  const item = (Array.isArray(_adminCurrencies) ? _adminCurrencies : []).find((entry) => String(entry.currency_code || '').toUpperCase() === String(currencyCode || '').toUpperCase()) || null;
  openModal(item ? `Edit Currency: ${item.currency_code}` : 'Add Currency', `
    <div class="fg">
      <label class="fl">Currency Code *
        <input class="fi" id="adminCurrencyCode" value="${escHtml(item?.currency_code || '')}" placeholder="USD" ${item ? 'readonly' : ''}>
      </label>
      <label class="fl">Rate To INR *
        <input class="fi" id="adminCurrencyRate" type="number" min="0" step="0.000001" value="${item?.rate_to_inr ?? ''}" placeholder="83.500000">
      </label>
      <label class="fl">Status
        <select class="fi" id="adminCurrencyActive">
          <option value="1" ${item?.is_active !== false ? 'selected' : ''}>Active</option>
          <option value="0" ${item?.is_active === false ? 'selected' : ''}>Inactive</option>
        </select>
      </label>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="saveAdminCurrency('${escHtml(item?.currency_code || '')}')">${item ? 'Update' : 'Add'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveAdminCurrency(existingCode = '') {
  const currencyCode = String(document.getElementById('adminCurrencyCode')?.value || existingCode || '').trim().toUpperCase();
  const rateToInr = parseFloat(document.getElementById('adminCurrencyRate')?.value || 0);
  const isActive = String(document.getElementById('adminCurrencyActive')?.value || '1') === '1';
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    toast('Currency code must be a 3-letter code', 'warning');
    return;
  }
  if (!Number.isFinite(rateToInr) || rateToInr <= 0) {
    toast('Rate to INR must be greater than 0', 'warning');
    return;
  }
  const endpoint = existingCode ? `/api/admin/currencies/${encodeURIComponent(existingCode)}` : '/api/admin/currencies';
  const result = await api(endpoint, {
    method: existingCode ? 'PUT' : 'POST',
    body: { currency_code: currencyCode, rate_to_inr: rateToInr, is_active: isActive ? 1 : 0 },
  });
  if (result?.error) {
    toast(result.error, 'error');
    return;
  }
  _tripCurrencies = null;
  closeModal();
  toast(existingCode ? 'Currency updated' : 'Currency added', 'success');
  await loadAdminCurrencies();
}

async function deleteAdminCurrency(currencyCode) {
  if (!await confirmDialog(`Delete currency "${currencyCode}"?`)) return;
  const result = await api(`/api/admin/currencies/${encodeURIComponent(currencyCode)}`, { method: 'DELETE' });
  if (result?.error) {
    toast(result.error, 'error');
    return;
  }
  _tripCurrencies = null;
  toast('Currency deleted', 'success');
  await loadAdminCurrencies();
}

async function loadAdminExpenseStats() {
  const data = await api('/api/admin/expense-stats');
  _adminExpenseStats = data?.stats || null;
  renderAdminExpenseStats();
}

function renderAdminExpenseStats() {
  const stats = _adminExpenseStats || {};
  const totalExpenseItems = Number(stats.expense_items || 0);
  const userRows = Array.isArray(stats.users) ? stats.users : [];
  const rowsHtml = userRows.length
    ? userRows.map((user, index) => `
        <tr>
          <td>${index + 1}</td>
          <td style="font-weight:700;color:var(--t1)">@${escHtml(user.username || '-')}</td>
          <td>${escHtml(user.display_name || '-')}</td>
          <td>${escHtml(user.email || '-')}</td>
          <td>${escHtml(user.mobile || '-')}</td>
          <td style="text-align:right;font-weight:700">${Number(user.expense_items || 0).toLocaleString('en-IN')}</td>
        </tr>`)
        .join('')
    : `<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:24px">No users found.</td></tr>`;
  document.getElementById('adminContent').innerHTML = `
    <div style="display:grid;gap:16px">
      <div class="card" style="padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div>
            <div class="card-title">Expense Items Added By Users</div>
            <div style="font-size:12px;color:var(--t3)">Live total of all saved expense rows across users.</div>
          </div>
          <button class="btn btn-s btn-sm" onclick="loadAdminExpenseStats()">Refresh</button>
        </div>
      </div>
      <div class="card" style="padding:22px;max-width:420px">
        <div style="font-size:12px;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.05em">Total Expense Items</div>
        <div style="font-size:40px;font-weight:800;color:var(--t1);margin-top:10px;font-family:'JetBrains Mono',monospace">${totalExpenseItems.toLocaleString('en-IN')}</div>
        <div style="font-size:13px;color:var(--t2);margin-top:8px">This is the sum of expense items users have saved in the app.</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px">
          <div>
            <div class="card-title">User-wise Expense Items</div>
            <div style="font-size:12px;color:var(--t3)">Shows each user and how many expense items they have added.</div>
          </div>
          <div style="font-size:12px;color:var(--t3)">Users: ${userRows.length}</div>
        </div>
        <div style="overflow:auto">
          <table style="width:100%;border-collapse:collapse;min-width:760px">
            <thead>
              <tr style="background:var(--bg2);color:var(--t2)">
                <th style="text-align:left;padding:10px 12px;font-size:12px">#</th>
                <th style="text-align:left;padding:10px 12px;font-size:12px">Username</th>
                <th style="text-align:left;padding:10px 12px;font-size:12px">Name</th>
                <th style="text-align:left;padding:10px 12px;font-size:12px">Email</th>
                <th style="text-align:left;padding:10px 12px;font-size:12px">Phone Number</th>
                <th style="text-align:right;padding:10px 12px;font-size:12px">Total Expense Items</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function _adminNotifSelectedUsers() {
  return _adminNotifUsers.filter((user) => _adminNotifSelected.has(user.id));
}

async function loadAdminPublicStats() {
  const data = await api('/api/admin/public-stats');
  _adminPublicStats = data?.stats || null;
  renderAdminPublicStats();
}

function renderAdminPublicStats() {
  const stats = _adminPublicStats || {};
  const readonlyCard = (label, value, hint) => `
    <div class="card" style="padding:16px">
      <div style="font-size:12px;color:var(--t3);font-weight:700;text-transform:uppercase;letter-spacing:.05em">${label}</div>
      <div style="font-size:30px;font-weight:800;color:var(--t1);margin-top:8px;font-family:'JetBrains Mono',monospace">${Number(value || 0).toLocaleString('en-IN')}</div>
      <div style="font-size:12px;color:var(--t3);margin-top:6px">${hint}</div>
    </div>`;

  document.getElementById('adminContent').innerHTML = `
    <div style="display:grid;gap:16px">
      <div class="card" style="padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div>
            <div class="card-title">Landing Page Public Stats</div>
            <div style="font-size:12px;color:var(--t3)">Users and expense items come from live database counts. Downloads and daily visitors can be updated here for the public homepage circles.</div>
          </div>
          <button class="btn btn-s btn-sm" onclick="loadAdminPublicStats()">Refresh</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
        ${readonlyCard('Unique Users', stats.unique_users, 'Live count from active registered users')}
        ${readonlyCard('Expense Items', stats.expense_items, 'Live count from saved expense rows')}
      </div>
      <div class="card" style="padding:18px">
        <div class="card-title">Editable Public Counters</div>
        <div style="font-size:12px;color:var(--t3);margin-bottom:14px">Update the numbers shown on the landing page for app downloads and daily visitors.</div>
        <div class="fg">
          <label class="fl">App Downloads
            <input class="fi" id="adminPublicAppDownloads" type="number" min="0" step="1" value="${Number(stats.app_downloads || 0)}">
          </label>
          <label class="fl">Daily Visitors
            <input class="fi" id="adminPublicDailyVisitors" type="number" min="0" step="1" value="${Number(stats.daily_visitors || 0)}">
          </label>
        </div>
        <div class="fa" style="margin-top:14px">
          <button class="btn btn-p" onclick="adminSavePublicStats()">Save Public Stats</button>
        </div>
      </div>
    </div>`;
}

function _adminNotifToggleUser(userId) {
  if (_adminNotifSelected.has(userId)) _adminNotifSelected.delete(userId);
  else _adminNotifSelected.add(userId);
  renderAdminNotifications();
}

async function adminSavePublicStats() {
  try {
    const appDownloads = Number(document.getElementById('adminPublicAppDownloads')?.value || 0);
    const dailyVisitors = Number(document.getElementById('adminPublicDailyVisitors')?.value || 0);
    if (!Number.isFinite(appDownloads) || appDownloads < 0 || !Number.isFinite(dailyVisitors) || dailyVisitors < 0) {
      toast('Enter valid non-negative values', 'error');
      return;
    }
    const result = await api('/api/admin/public-stats', {
      method: 'PUT',
      body: {
        app_downloads: Math.round(appDownloads),
        daily_visitors: Math.round(dailyVisitors),
      },
    });
    _adminPublicStats = result?.stats || _adminPublicStats;
    toast('Public stats updated', 'success');
    renderAdminPublicStats();
  } catch (err) {
    toast(err?.message || 'Could not update public stats', 'error');
  }
}

function _adminNotifToggleVisible(selectAll) {
  (_adminNotifUsers || []).forEach((user) => {
    if (!user?.id) return;
    if (selectAll) _adminNotifSelected.add(user.id);
    else _adminNotifSelected.delete(user.id);
  });
  renderAdminNotifications();
}

async function loadAdminNotifications() {
  const data = await api(`/api/admin/notifications/users${_adminNotifSearch ? `?search=${encodeURIComponent(_adminNotifSearch)}` : ''}`);
  _adminNotifUsers = data?.users || [];
  const visibleIds = new Set(_adminNotifUsers.map((user) => user.id));
  _adminNotifSelected = new Set([..._adminNotifSelected].filter((userId) => visibleIds.has(userId)));
  renderAdminNotifications();
}

function renderAdminNotifications() {
  const users = _adminNotifUsers || [];
  const selectedUsers = _adminNotifSelectedUsers();
  const selectedReadyUsers = selectedUsers.filter((user) => Number(user.push_device_count || 0) > 0);
  const totalDevices = selectedReadyUsers.reduce((sum, user) => sum + Number(user.push_device_count || 0), 0);
  const allVisibleSelected = users.length > 0 && users.every((user) => _adminNotifSelected.has(user.id));

  const userCards = users.map((user) => {
    const selected = _adminNotifSelected.has(user.id);
    const ready = Number(user.push_device_count || 0) > 0;
    const deviceSummary = (Array.isArray(user.devices) ? user.devices : []).map((device) => {
      const platform = String(device?.platform || '').trim();
      const platformLabel = platform ? (platform === 'ios' ? 'iPhone' : platform.charAt(0).toUpperCase() + platform.slice(1)) : 'Unknown';
      const deviceName = String(device?.device_name || '').trim();
      const appVersion = String(device?.app_version || '').trim();
      return [platformLabel, deviceName, appVersion ? `v${appVersion}` : ''].filter(Boolean).join(' • ');
    }).filter(Boolean);
    return `
      <label style="display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid ${selected ? 'var(--green)' : 'var(--br)'};border-radius:14px;background:${selected ? '#f3fbf6' : '#fff'};cursor:pointer">
        <input type="checkbox" ${selected ? 'checked' : ''} onchange="_adminNotifToggleUser(${user.id})" style="margin-top:2px;width:16px;height:16px">
        <div style="min-width:0;flex:1">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
            <div style="min-width:0">
              <div style="font-weight:700;color:var(--t1)">${escHtml(user.display_name || '')}</div>
              <div style="font-size:12px;color:var(--t2)">@${escHtml(user.username || '')}</div>
              <div style="font-size:12px;color:var(--t3);word-break:break-all">${escHtml(user.email || '')}</div>
            </div>
            <span style="font-size:11px;padding:4px 8px;border-radius:999px;background:${ready ? 'var(--green-l)' : 'var(--border-l)'};color:${ready ? 'var(--green)' : 'var(--t3)'};white-space:nowrap">${ready ? `${user.push_device_count} device${user.push_device_count === 1 ? '' : 's'}` : 'No device'}</span>
          </div>
          <div style="font-size:11px;color:var(--t3);margin-top:6px">${user.push_last_seen_at ? `Last seen ${fmtDate(user.push_last_seen_at)}` : 'No app device registered yet'}</div>
          ${deviceSummary.length ? `<div style="display:grid;gap:4px;margin-top:8px">${deviceSummary.map((line) => `<div style="font-size:11px;color:var(--t2);padding:6px 8px;border:1px solid var(--br);border-radius:10px;background:var(--bg2)">${escHtml(line)}</div>`).join('')}</div>` : ''}
        </div>
      </label>`;
  }).join('');

  const resultBox = _adminNotifLastResult
    ? `<div class="card" style="margin-top:16px;background:${_adminNotifLastResult.success ? '#f3fbf6' : '#fff7f5'};border-color:${_adminNotifLastResult.success ? '#b8e0c2' : '#f1c7bf'}">
        <div style="font-size:14px;font-weight:700;color:${_adminNotifLastResult.success ? 'var(--green)' : 'var(--red)'}">${_adminNotifLastResult.success ? 'Notification sent' : 'Notification completed with issues'}</div>
        <div style="font-size:12px;color:var(--t2);margin-top:6px">
          Selected users: ${_adminNotifLastResult.requested_user_count || 0}
          &nbsp;&middot;&nbsp; Users with devices: ${_adminNotifLastResult.delivered_user_count || 0}
          &nbsp;&middot;&nbsp; Device sends: ${_adminNotifLastResult.device_count || 0}
        </div>
        ${_adminNotifLastResult.errors?.length ? `<div style="font-size:12px;color:var(--red);margin-top:8px">${escHtml(_adminNotifLastResult.errors.join(' | '))}</div>` : ''}
      </div>`
    : '';

  document.getElementById('adminContent').innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(280px,1fr) minmax(320px,1.1fr);gap:18px;align-items:start">
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:15px;font-weight:700">Recipients</div>
            <div style="font-size:12px;color:var(--t3)">Only users with registered app devices will receive the push.</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-s btn-sm" onclick="_adminNotifToggleVisible(true)">${allVisibleSelected ? 'Visible Selected' : 'Select Visible'}</button>
            <button class="btn btn-s btn-sm" onclick="_adminNotifToggleVisible(false)">Clear Visible</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          <input class="fi" id="adminNotifSearch" placeholder="Search by name, username, or email" value="${escHtml(_adminNotifSearch)}" onkeydown="if(event.key==='Enter'){_adminNotifSearch=this.value.trim();loadAdminNotifications()}">
          <button class="btn btn-p btn-sm" onclick="_adminNotifSearch=document.getElementById('adminNotifSearch').value.trim();loadAdminNotifications()">Search</button>
        </div>
        <div style="display:grid;gap:10px;max-height:520px;overflow:auto">
          ${userCards || '<div style="text-align:center;color:var(--t3);padding:30px 16px">No users found.</div>'}
        </div>
      </div>
      <div class="card">
        <div style="font-size:15px;font-weight:700;margin-bottom:6px">Compose Notification</div>
        <div style="font-size:12px;color:var(--t3);margin-bottom:14px">Select users on the left, then write the notification title and message you want to send to the app.</div>
        <div style="display:grid;gap:12px">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px">Title</div>
            <input class="fi" id="adminNotifTitle" maxlength="80" placeholder="e.g. Bill reminder">
          </div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px">Message</div>
            <textarea class="fi" id="adminNotifMessage" rows="6" maxlength="250" placeholder="Write the notification message here"></textarea>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px">
          <div style="padding:12px;border:1px solid var(--br);border-radius:12px;background:var(--bg2)">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">Selected Users</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px">${selectedUsers.length}</div>
          </div>
          <div style="padding:12px;border:1px solid var(--br);border-radius:12px;background:var(--bg2)">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">Ready Users</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px">${selectedReadyUsers.length}</div>
          </div>
          <div style="padding:12px;border:1px solid var(--br);border-radius:12px;background:var(--bg2)">
            <div style="font-size:11px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">Target Devices</div>
            <div style="font-size:22px;font-weight:700;margin-top:4px">${totalDevices}</div>
          </div>
        </div>
        <div style="font-size:12px;color:var(--t3);margin-top:12px">${selectedUsers.length ? selectedUsers.map((user) => escHtml(user.display_name)).join(', ') : 'No users selected yet.'}</div>
        <div class="fa" style="margin-top:16px">
          <button class="btn btn-p" onclick="adminSendNotification()">Send Notification</button>
        </div>
        ${resultBox}
      </div>
    </div>`;
}

async function adminSendNotification() {
  const title = document.getElementById('adminNotifTitle')?.value?.trim() || '';
  const message = document.getElementById('adminNotifMessage')?.value?.trim() || '';
  const userIds = [..._adminNotifSelected];
  if (!userIds.length) { toast('Select at least one user', 'warning'); return; }
  if (!title) { toast('Notification title is required', 'warning'); return; }
  if (!message) { toast('Notification message is required', 'warning'); return; }
  const result = await api('/api/admin/notifications/send', {
    method: 'POST',
    body: {
      user_ids: userIds,
      title,
      message,
    },
  });
  _adminNotifLastResult = result || null;
  toast(result?.success ? 'Notification sent' : (result?.error || 'Notification finished with issues'), result?.success ? 'success' : 'warning');
  renderAdminNotifications();
}

// â”€â”€ Users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadAdminAiLearning() {
  _adminAiLoadError = '';
  const data = await api(`/api/admin/ai-learning/report?days=${encodeURIComponent(_adminAiDays)}&_ts=${Date.now()}`);
  if (data?.success) {
    _adminAiReport = data?.report || null;
    _adminAiLoadError = '';
  } else {
    _adminAiReport = null;
    _adminAiLoadError = data?.error || 'Failed to load AI learning report';
  }
  renderAdminAiLearning();
}

function _adminAiIntentMeta(intentKey) {
  return ADMIN_AI_INTENTS.find((item) => item.key === intentKey) || { key: intentKey, label: intentKey, description: 'Custom intent', examples: [] };
}

function _adminAiJsString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}

function _adminAiBuildTrainingPayload(example = {}) {
  const question = String(example.question || '').trim();
  const intent = String(example.intent || '').trim();
  const answer = String(example.answer || '').trim();
  const notes = String(example.notes || '').trim();
  return {
    messages: [
      {
        role: 'system',
        content: "You are Expense Lite AI. Answer finance questions using the user's live financial data. Be concise, factual, and specific.",
      },
      {
        role: 'user',
        content: question,
      },
      {
        role: 'assistant',
        content: answer,
      },
    ],
    metadata: {
      intent: intent || 'custom',
      source: 'admin_ai_learning',
      notes,
    },
  };
}

function renderAdminAiLearning() {
  const report = _adminAiReport || {};
  const topIntents = report.top_intents || [];
  const topFallbacks = report.top_fallback_questions || [];
  const unknowns = report.unknown_intents || [];
  const topQuestions = report.top_questions || [];
  const recentQueries = report.recent_queries || [];
  const unresolvedQueries = report.unresolved_queries || [];

  const topIntentHtml = topIntents.length
    ? topIntents.slice(0, 6).map((item) => {
        const meta = _adminAiIntentMeta(item.detected_intent);
        return `<div class="admin-ai-stat">
          <div class="admin-ai-stat-label">${escHtml(meta.label)}</div>
          <div class="admin-ai-stat-value">${Number(item.ask_count || 0)}</div>
          <div class="admin-ai-stat-sub">${escHtml(item.detected_intent || '')}</div>
        </div>`;
      }).join('')
    : '<div style="color:var(--t3);font-size:13px">No AI query data yet.</div>';

  const fallbackHtml = topFallbacks.length
    ? topFallbacks.map((item) => `<div class="admin-ai-row">
        <div style="flex:1;min-width:0">
          <div class="admin-ai-question">${escHtml(item.normalized_question || '')}</div>
          <div class="admin-ai-meta">Fallbacks ${Number(item.fail_count || 0)} &middot; Last seen ${item.last_seen_at ? fmtDate(item.last_seen_at) : '-'}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-s btn-sm" onclick="showAdminAiTeachModal('${_adminAiJsString(item.normalized_question || '')}')">Teach</button>
          <button class="btn btn-p btn-sm" onclick="showAdminAiTrainingModal('${_adminAiJsString(item.normalized_question || '')}', '')">Train Model</button>
        </div>
      </div>`).join('')
    : '<div style="color:var(--t3);font-size:13px">No fallback questions in this time window.</div>';

  const unknownHtml = unknowns.length
    ? unknowns.map((item) => `<div class="admin-ai-row">
        <div style="flex:1;min-width:0">
          <div class="admin-ai-question">${escHtml(item.normalized_question || '')}</div>
          <div class="admin-ai-meta">Asked ${Number(item.ask_count || 0)} &middot; Last seen ${item.last_seen_at ? fmtDate(item.last_seen_at) : '-'}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-s btn-sm" onclick="showAdminAiTeachModal('${_adminAiJsString(item.normalized_question || '')}')">Map Intent</button>
          <button class="btn btn-p btn-sm" onclick="showAdminAiTrainingModal('${_adminAiJsString(item.normalized_question || '')}', '')">Train Model</button>
        </div>
      </div>`).join('')
    : '<div style="color:var(--t3);font-size:13px">No unknown intents found.</div>';

  const questionHtml = topQuestions.length
    ? topQuestions.map((item) => `<div class="admin-ai-row">
        <div style="flex:1;min-width:0">
          <div class="admin-ai-question">${escHtml(item.normalized_question || '')}</div>
          <div class="admin-ai-meta">Asked ${Number(item.ask_count || 0)} times &middot; Last seen ${item.last_seen_at ? fmtDate(item.last_seen_at) : '-'}</div>
        </div>
        <button class="btn btn-p btn-sm" onclick="showAdminAiTrainingModal('${_adminAiJsString(item.normalized_question || '')}', '')">Train Model</button>
      </div>`).join('')
    : '<div style="color:var(--t3);font-size:13px">No saved AI questions yet.</div>';

    
  const unresolvedHtml = unresolvedQueries.length
    ? unresolvedQueries.map((item) => {
        const question = item.question || item.normalized_question || '';
        return `<div class="admin-ai-row" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div class="admin-ai-question">${escHtml(question)}</div>
            <div class="admin-ai-meta">${escHtml(item.user_label || 'Unknown user')} &middot; ${item.created_at ? fmtDate(item.created_at) : '-'} &middot; intent ${escHtml(item.detected_intent || 'unknown')} &middot; ${item.was_fallback ? 'fallback' : escHtml(item.answer_type || 'unknown')}</div>
            <div style="font-size:12px;color:var(--t2);margin-top:6px;line-height:1.5">${escHtml(item.response_preview || 'No answer preview saved.')}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-s btn-sm" onclick="showAdminAiTeachModal('${_adminAiJsString(item.normalized_question || question || '')}')">Teach</button>
            <button class="btn btn-p btn-sm" onclick="showAdminAiTrainingModal('${_adminAiJsString(question || item.normalized_question || '')}', '${_adminAiJsString(item.detected_intent || '')}', '${_adminAiJsString(item.response_preview || '')}')">Train Model</button>
          </div>
        </div>`;
      }).join('')
    : '<div style="color:var(--t3);font-size:13px">No unresolved AI questions in this time window.</div>';

  const recentQueriesHtml = recentQueries.length
    ? recentQueries.map((item) => {
        const question = item.question || item.normalized_question || '';
        const statusLabel = item.was_fallback
          ? 'Fallback'
          : (item.answer_type === 'admin_trained_answer' ? 'Trained' : (item.answer_type || 'Answered'));
        return `<div class="admin-ai-row" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div class="admin-ai-question">${escHtml(question)}</div>
            <div class="admin-ai-meta">${escHtml(item.user_label || 'Unknown user')} &middot; ${item.created_at ? fmtDate(item.created_at) : '-'} &middot; ${escHtml(statusLabel)} &middot; intent ${escHtml(item.detected_intent || 'unknown')}</div>
            <div style="font-size:12px;color:var(--t2);margin-top:6px;line-height:1.5">${escHtml(item.response_preview || 'No answer preview saved.')}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-p btn-sm" onclick="showAdminAiTrainingModal('${_adminAiJsString(question || item.normalized_question || '')}', '${_adminAiJsString(item.detected_intent || '')}', '${_adminAiJsString(item.response_preview || '')}')">Train Model</button>
          </div>
        </div>`;
      }).join('')
    : '<div style="color:var(--t3);font-size:13px">No recent AI queries found.</div>';

  const intentDirectoryHtml = ADMIN_AI_INTENTS.map((intent) => `<div class="admin-ai-intent-card">
      <div class="admin-ai-intent-title">${escHtml(intent.label)}</div>
      <div class="admin-ai-intent-key">${escHtml(intent.key)}</div>
      <div class="admin-ai-intent-desc">${escHtml(intent.description)}</div>
      <div class="admin-ai-intent-ex">${escHtml(intent.examples[0] || '')}</div>
    </div>`).join('');

  const testResultHtml = _adminAiTestResult
    ? `<div class="admin-ai-test-result">
        <div class="admin-ai-test-label">Detected intent</div>
        <div class="admin-ai-test-value">${escHtml(_adminAiTestResult.ai_meta?.detected_intent || 'unknown')}</div>
        <div class="admin-ai-test-label">Detected confidence</div>
        <div class="admin-ai-test-value">${Number(_adminAiTestResult.ai_meta?.detected_confidence || 0).toFixed(2)}</div>
        <div class="admin-ai-test-label">Resolved intent</div>
        <div class="admin-ai-test-value">${escHtml(_adminAiTestResult.ai_meta?.resolved_intent || 'unknown')}</div>
        <div class="admin-ai-test-label">Resolved confidence</div>
        <div class="admin-ai-test-value">${Number(_adminAiTestResult.ai_meta?.resolved_confidence || 0).toFixed(2)}</div>
        <div class="admin-ai-test-label">Resolution method</div>
        <div class="admin-ai-test-value">${escHtml(_adminAiTestResult.ai_meta?.resolution_method || '-')}</div>
        <div class="admin-ai-test-label">Answer type</div>
        <div class="admin-ai-test-value">${escHtml(_adminAiTestResult.ai_meta?.answer_type || '-')}</div>
        ${_adminAiTestResult.ai_meta?.learned_match ? `<div class="admin-ai-test-label">Learned match</div>
        <div class="admin-ai-test-value">${escHtml(_adminAiTestResult.ai_meta.learned_match.method || '')} · ${escHtml(_adminAiTestResult.ai_meta.learned_match.example || '')}</div>` : ''}
        <div class="admin-ai-test-label">Answer</div>
        <div class="admin-ai-test-answer">${escHtml(_adminAiTestResult.answer || '')}</div>
      </div>`
    : '<div style="color:var(--t3);font-size:13px">Type a question and run a test to inspect how the assistant resolves it.</div>';
  const testErrorHtml = _adminAiTestError
    ? `<div class="admin-ai-test-error">${escHtml(_adminAiTestError)}</div>`
    : '';
  const loadErrorHtml = _adminAiLoadError
    ? `<div class="admin-ai-test-error" style="margin-bottom:16px">Could not load AI Learning data: ${escHtml(_adminAiLoadError)}</div>`
    : '';

  document.getElementById('adminContent').innerHTML = `
    <div class="admin-ai-topbar">
      <div>
        <div style="font-size:15px;font-weight:700">AI Learning</div>
        <div style="font-size:12px;color:var(--t3)">Review user queries, fallback patterns, teach intent mappings, and export real user questions as training examples for your external AI model.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="chip" onclick="loadAdminAiLearning()">Refresh</button>
        ${[7, 30, 90].map((days) => `<button class="chip ${Number(_adminAiDays)===days ? 'active' : ''}" onclick="_adminAiDays=${days};loadAdminAiLearning()">${days} days</button>`).join('')}
      </div>
    </div>

    ${loadErrorHtml}

    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Test Question</div>
      <div style="font-size:12px;color:var(--t3);margin-bottom:12px">Preview how the assistant interprets a question without using daily AI quota.</div>
      <div style="display:grid;gap:12px">
        <textarea class="fi" id="adminAiTestQuestion" rows="3" placeholder="e.g. what is the most expensive item">${escHtml(_adminAiTestResult?.question || '')}</textarea>
        <div class="fa">
          <button class="btn btn-p" onclick="adminAiRunTest()">Run Test</button>
          ${_adminAiTestResult?.question ? `<button class="btn btn-s" onclick="showAdminAiTrainingModal('${_adminAiJsString(_adminAiTestResult.question || '')}', '${_adminAiJsString(_adminAiTestResult.ai_meta?.resolved_intent || '')}', '${_adminAiJsString(_adminAiTestResult.answer || '')}')">Export Test For Training</button>` : ''}
        </div>
      </div>
      <div style="margin-top:14px">${testErrorHtml}${testResultHtml}</div>
    </div>

    <div class="admin-ai-grid">
      <div class="card">
        <div class="card-title">Top Intents</div>
        <div class="admin-ai-stats">${topIntentHtml}</div>
      </div>
      <div class="card">
        <div class="card-title">Top Questions</div>
        <div class="admin-ai-list">${questionHtml}</div>
      </div>
    </div>

    <div class="admin-ai-grid">
      <div class="card">
        <div class="card-title">Top Fallback Questions</div>
        <div class="admin-ai-list">${fallbackHtml}</div>
      </div>
      <div class="card">
        <div class="card-title">Unknown Intents</div>
        <div class="admin-ai-list">${unknownHtml}</div>
      </div>
    </div>

    <div class="admin-ai-grid">
      <div class="card">
        <div class="card-title">Needs Attention</div>
        <div style="font-size:12px;color:var(--t3);margin-bottom:14px">Queries where users likely did not get a useful result yet.</div>
        <div class="admin-ai-list">${unresolvedHtml}</div>
      </div>
      <div class="card">
        <div class="card-title">Recent User Queries</div>
        <div style="font-size:12px;color:var(--t3);margin-bottom:14px">Latest questions asked in AI Lookup, with user and answer preview.</div>
        <div class="admin-ai-list">${recentQueriesHtml}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Intent Directory</div>
      <div style="font-size:12px;color:var(--t3);margin-bottom:14px">Use these intent definitions when teaching repeated fallback questions.</div>
      <div class="admin-ai-directory">${intentDirectoryHtml}</div>
    </div>`;
}

function showAdminAiTeachModal(normalizedQuestion) {
  const selected = ADMIN_AI_INTENTS[0];
  openModal('Teach AI Intent', `
    <div class="admin-ai-teach-box">
      <label class="fl full">Normalized Question
        <textarea class="fi" id="adminAiTeachQuestion" rows="3">${escHtml(normalizedQuestion || '')}</textarea>
      </label>
      <div class="admin-ai-selected" id="adminAiSelectedIntentBox">
        <div class="admin-ai-intent-title">${escHtml(selected.label)}</div>
        <div class="admin-ai-intent-key">${escHtml(selected.key)}</div>
        <div class="admin-ai-intent-desc">${escHtml(selected.description)}</div>
        <div class="admin-ai-intent-ex">${escHtml((selected.examples || []).join(' | '))}</div>
      </div>
      <div class="admin-ai-directory">
        ${ADMIN_AI_INTENTS.map((intent, idx) => `<button type="button" class="admin-ai-intent-pick ${idx===0 ? 'active' : ''}" data-intent="${escHtml(intent.key)}" onclick="adminAiSelectIntent('${escHtml(intent.key)}', this)">${escHtml(intent.label)}</button>`).join('')}
      </div>
      <input type="hidden" id="adminAiTeachIntent" value="${escHtml(selected.key)}">
      <div class="fa" style="margin-top:16px">
        <button class="btn btn-p" onclick="adminAiTeachIntent()">Save Mapping</button>
      </div>
    </div>`);
}

function adminAiSelectIntent(intentKey, buttonEl) {
  const meta = _adminAiIntentMeta(intentKey);
  const hidden = document.getElementById('adminAiTeachIntent');
  if (hidden) hidden.value = meta.key;
  const box = document.getElementById('adminAiSelectedIntentBox');
  if (box) {
    box.innerHTML = `
      <div class="admin-ai-intent-title">${escHtml(meta.label)}</div>
      <div class="admin-ai-intent-key">${escHtml(meta.key)}</div>
      <div class="admin-ai-intent-desc">${escHtml(meta.description)}</div>
      <div class="admin-ai-intent-ex">${escHtml((meta.examples || []).join(' | '))}</div>`;
  }
  document.querySelectorAll('.admin-ai-intent-pick').forEach((node) => node.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
}

async function adminAiTeachIntent() {
  const normalizedQuestion = document.getElementById('adminAiTeachQuestion')?.value?.trim().toLowerCase() || '';
  const detectedIntent = document.getElementById('adminAiTeachIntent')?.value?.trim() || '';
  if (!normalizedQuestion) { toast('Normalized question is required', 'warning'); return; }
  if (!detectedIntent) { toast('Choose an intent first', 'warning'); return; }
  const result = await api('/api/admin/ai-learning/teach', {
    method: 'POST',
    body: {
      normalized_question: normalizedQuestion,
      detected_intent: detectedIntent,
    },
  });
  if (result?.success) {
    closeModal();
    toast(`Intent mapping saved (${Number(result.updated_count || 0)} rows updated)`, 'success');
    await loadAdminAiLearning();
  } else {
    toast(result?.error || 'Failed to save mapping', 'error');
  }
}

function showAdminAiTrainingModal(question, suggestedIntent = '', answer = '') {
  const suggestedMeta = _adminAiIntentMeta(suggestedIntent || ADMIN_AI_INTENTS[0]?.key || 'custom');
  _adminAiTrainingDraft = {
    question: String(question || '').trim(),
    intent: suggestedMeta.key,
    answer: String(answer || '').trim(),
    notes: '',
  };
  const payloadPreview = escHtml(JSON.stringify(_adminAiBuildTrainingPayload(_adminAiTrainingDraft), null, 2));
  openModal('Train AI From JSON', `
    <div class="admin-ai-teach-box">
      <div style="font-size:12px;color:var(--t3);margin-bottom:12px">Use a real user question, attach the target intent and ideal answer, then either send this JSON directly into Expense Lite AI memory or export it for your external model pipeline.</div>
      <label class="fl full">User Question
        <textarea class="fi" id="adminAiTrainQuestion" rows="3" oninput="adminAiRefreshTrainingPreview()">${escHtml(_adminAiTrainingDraft.question)}</textarea>
      </label>
      <div class="admin-ai-selected" id="adminAiTrainingIntentBox">
        <div class="admin-ai-intent-title">${escHtml(suggestedMeta.label)}</div>
        <div class="admin-ai-intent-key">${escHtml(suggestedMeta.key)}</div>
        <div class="admin-ai-intent-desc">${escHtml(suggestedMeta.description)}</div>
        <div class="admin-ai-intent-ex">${escHtml((suggestedMeta.examples || []).join(' | '))}</div>
      </div>
      <div class="admin-ai-directory">
        ${ADMIN_AI_INTENTS.map((intent) => `<button type="button" class="admin-ai-intent-pick ${intent.key===suggestedMeta.key ? 'active' : ''}" data-intent="${escHtml(intent.key)}" onclick="adminAiSelectTrainingIntent('${escHtml(intent.key)}', this)">${escHtml(intent.label)}</button>`).join('')}
      </div>
      <input type="hidden" id="adminAiTrainIntent" value="${escHtml(suggestedMeta.key)}">
      <label class="fl full">Ideal Assistant Answer
        <textarea class="fi" id="adminAiTrainAnswer" rows="6" placeholder="Write the exact answer you want your AI model to learn." oninput="adminAiRefreshTrainingPreview()">${escHtml(_adminAiTrainingDraft.answer)}</textarea>
      </label>
      <label class="fl full">Notes (optional)
        <input class="fi" id="adminAiTrainNotes" type="text" placeholder="e.g. finance summary / today total / fallback repair" oninput="adminAiRefreshTrainingPreview()">
      </label>
      <div>
        <div class="admin-ai-test-label" style="margin-bottom:8px">Training JSON Preview</div>
        <pre id="adminAiTrainingPreview" class="admin-ai-test-answer" style="white-space:pre-wrap;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:12px">${payloadPreview}</pre>
      </div>
      <div class="fa" style="margin-top:16px">
        <button class="btn btn-p" onclick="adminAiSendTrainingExample()">Send To AI Memory</button>
        <button class="btn btn-p" onclick="adminAiCopyTrainingExample()">Copy JSONL</button>
        <button class="btn btn-s" onclick="adminAiDownloadTrainingExample()">Download JSONL</button>
      </div>
    </div>`);
}

function adminAiSelectTrainingIntent(intentKey, buttonEl) {
  const meta = _adminAiIntentMeta(intentKey);
  const hidden = document.getElementById('adminAiTrainIntent');
  if (hidden) hidden.value = meta.key;
  const box = document.getElementById('adminAiTrainingIntentBox');
  if (box) {
    box.innerHTML = `
      <div class="admin-ai-intent-title">${escHtml(meta.label)}</div>
      <div class="admin-ai-intent-key">${escHtml(meta.key)}</div>
      <div class="admin-ai-intent-desc">${escHtml(meta.description)}</div>
      <div class="admin-ai-intent-ex">${escHtml((meta.examples || []).join(' | '))}</div>`;
  }
  document.querySelectorAll('.admin-ai-intent-pick').forEach((node) => node.classList.remove('active'));
  if (buttonEl) buttonEl.classList.add('active');
  adminAiRefreshTrainingPreview();
}

function adminAiRefreshTrainingPreview() {
  const draft = {
    question: document.getElementById('adminAiTrainQuestion')?.value?.trim() || '',
    intent: document.getElementById('adminAiTrainIntent')?.value?.trim() || '',
    answer: document.getElementById('adminAiTrainAnswer')?.value?.trim() || '',
    notes: document.getElementById('adminAiTrainNotes')?.value?.trim() || '',
  };
  _adminAiTrainingDraft = draft;
  const preview = document.getElementById('adminAiTrainingPreview');
  if (preview) preview.textContent = JSON.stringify(_adminAiBuildTrainingPayload(draft), null, 2);
}

async function adminAiCopyTrainingExample() {
  adminAiRefreshTrainingPreview();
  if (!_adminAiTrainingDraft?.question) { toast('User question is required', 'warning'); return; }
  if (!_adminAiTrainingDraft?.answer) { toast('Ideal answer is required', 'warning'); return; }
  const jsonl = `${JSON.stringify(_adminAiBuildTrainingPayload(_adminAiTrainingDraft))}\n`;
  await navigator.clipboard.writeText(jsonl);
  toast('Training JSONL copied', 'success');
}

function adminAiDownloadTrainingExample() {
  adminAiRefreshTrainingPreview();
  if (!_adminAiTrainingDraft?.question) { toast('User question is required', 'warning'); return; }
  if (!_adminAiTrainingDraft?.answer) { toast('Ideal answer is required', 'warning'); return; }
  const jsonl = `${JSON.stringify(_adminAiBuildTrainingPayload(_adminAiTrainingDraft))}\n`;
  const blob = new Blob([jsonl], { type: 'application/jsonl;charset=utf-8' });
  const link = document.createElement('a');
  const safeIntent = String(_adminAiTrainingDraft.intent || 'custom').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  link.href = URL.createObjectURL(blob);
  link.download = `ai-training-${safeIntent || 'example'}.jsonl`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
  toast('Training JSONL downloaded', 'success');
}

async function adminAiSendTrainingExample() {
  adminAiRefreshTrainingPreview();
  if (!_adminAiTrainingDraft?.question) { toast('User question is required', 'warning'); return; }
  if (!_adminAiTrainingDraft?.answer) { toast('Ideal answer is required', 'warning'); return; }
  try {
    const result = await api('/api/admin/ai-learning/training-example', {
      method: 'POST',
      body: {
        question: _adminAiTrainingDraft.question,
        normalized_question: (_adminAiTrainingDraft.question || '').trim().toLowerCase(),
        detected_intent: _adminAiTrainingDraft.intent || '',
        ideal_answer: _adminAiTrainingDraft.answer,
        notes: _adminAiTrainingDraft.notes || '',
        training_payload: _adminAiBuildTrainingPayload(_adminAiTrainingDraft),
      },
    });
    if (result?.success) {
      closeModal();
      toast('Training saved. Future exact matches will use this answer.', 'success');
      if (_adminAiTestResult?.question && String(_adminAiTestResult.question || '').trim().toLowerCase() === String(_adminAiTrainingDraft.question || '').trim().toLowerCase()) {
        _adminAiTestResult = {
          success: true,
          question: _adminAiTrainingDraft.question,
          normalized_question: (_adminAiTrainingDraft.question || '').trim().toLowerCase(),
          answer: _adminAiTrainingDraft.answer,
          ai_meta: {
            detected_intent: _adminAiTrainingDraft.intent || 'trained_answer',
            detected_confidence: 1,
            resolved_intent: _adminAiTrainingDraft.intent || 'trained_answer',
            resolved_confidence: 1,
            resolution_method: 'admin_training_store',
            learned_match: null,
            answer_type: 'admin_trained_answer',
          },
        };
      }
      await loadAdminAiLearning();
      return;
    }
    const errorMessage = String(result?.error || '').trim();
    if (result?.status === 404 || /server may need a restart/i.test(errorMessage)) {
      toast('Training save route is not active yet. Restart the server, then try again.', 'warning');
      return;
    }
    toast(errorMessage || 'Failed to save training example', 'error');
  } catch (err) {
    toast(err?.message || 'Failed to save training example', 'error');
  }
}

async function adminAiRunTest() {
  const question = document.getElementById('adminAiTestQuestion')?.value?.trim() || '';
  if (!question) { toast('Question is required', 'warning'); return; }
  try {
    _adminAiTestError = '';
    const result = await api('/api/admin/ai-learning/test', {
      method: 'POST',
      body: { question },
    });
    if (result?.success) {
      _adminAiTestResult = result;
      _adminAiTestError = '';
      toast('AI test complete', 'success');
      renderAdminAiLearning();
      return;
    }
    _adminAiTestResult = null;
    _adminAiTestError = result?.error || 'Failed to test question';
    toast(_adminAiTestError, 'error');
    renderAdminAiLearning();
  } catch (err) {
    _adminAiTestResult = null;
    _adminAiTestError = err?.message || 'Failed to test question';
    toast(_adminAiTestError, 'error');
    renderAdminAiLearning();
  }
}

let _adminUsersData = [];
let _adminUserFilter = 'all'; // 'all' | 'active' | 'deleted'
let _adminUserSearch = '';

async function loadAdminUsers() {
  const data = await api('/api/admin/users');
  _adminUsersData = data?.users || [];
  _adminUserFilter = 'all';
  _adminUserSearch = '';
  _renderAdminUsersPage();
}

function _renderAdminUserCard(u) {
  const shortAuditDate = (value) => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  const subBadge = u.subscription
    ? `<span style="font-size:11px;padding:2px 7px;background:var(--green-l);color:var(--green);border-radius:10px">${u.subscription.plan_name}</span>`
    : `<span style="font-size:11px;color:var(--t3)">No plan</span>`;
  const statusText = u.deleted_at ? 'Deleted' : (u.is_active ? 'Active' : 'Inactive');
  const statusColor = u.deleted_at ? 'var(--red)' : (u.is_active ? 'var(--green)' : 'var(--orange)');
  const activeBadge = `<span class="admin-user-status" style="color:${statusColor};background:${u.deleted_at ? 'var(--red-l)' : u.is_active ? 'var(--green-l)' : 'var(--border-l)'}">${statusText}</span>`;
  const safeDisplayName = (u.display_name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeMobile = (u.mobile || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const auditText = `
    <div class="admin-user-audit">
      <div><span>Created</span><strong>${shortAuditDate(u.created_at)}</strong></div>
      <div><span>Modified</span><strong>${shortAuditDate(u.updated_at)}</strong></div>
      <div><span>Deleted</span><strong>${shortAuditDate(u.deleted_at)}</strong></div>
    </div>`;
  return `<div class="admin-user-card">
    <div class="admin-user-top">
      <div>
        <div class="admin-user-name">${u.display_name}</div>
        <div class="admin-user-handle">@${u.username}</div>
      </div>
      ${activeBadge}
    </div>
    <div class="admin-user-meta">
      <div>
        <div class="admin-user-label">Contact</div>
        <div class="admin-user-value">${u.email}</div>
        <div class="admin-user-sub">${u.mobile || 'No phone added'}</div>
      </div>
      <div>
        <div class="admin-user-label">Role</div>
        <select class="admin-user-role"
        onchange="adminUpdateUser(${u.id},{role:this.value})">
        <option value="user" ${u.role==='user'?'selected':''}>User</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
      </select>
      </div>
      <div>
        <div class="admin-user-label">Subscription</div>
        <div class="admin-user-value">${subBadge}</div>
      </div>
    </div>
    ${auditText}
    <div class="admin-user-actions">
      <button class="btn btn-s btn-sm" onclick="showAdminUserModal(${u.id},'${safeDisplayName}','${safeMobile}',${u.is_active?1:0},${u.deleted_at ? 1 : 0})">Edit</button>
      <button class="btn btn-s btn-sm" onclick="adminGenOtp(${u.id})">OTP</button>
      <button class="btn btn-s btn-sm" onclick="adminResetLink(${u.id})">Reset Link</button>
      ${u.deleted_at
        ? `<button class="btn btn-s btn-sm" style="border-color:var(--green);color:var(--green)" onclick="adminRestoreUser(${u.id})">Restore</button>`
        : `<button class="btn btn-s btn-sm" style="border-color:var(--red);color:var(--red)" onclick="adminDeleteUser(${u.id})">Delete</button>`}
    </div>
  </div>`;
}

function _renderAdminUsersPage() {
  const q = _adminUserSearch.toLowerCase();
  const filtered = _adminUsersData.filter(u => {
    const matchFilter =
      _adminUserFilter === 'all' ? true :
      _adminUserFilter === 'active' ? (!u.deleted_at && u.is_active) :
      _adminUserFilter === 'inactive' ? (!u.deleted_at && !u.is_active) :
      _adminUserFilter === 'deleted' ? !!u.deleted_at : true;
    if (!matchFilter) return false;
    if (!q) return true;
    return (
      (u.display_name || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.mobile || '').toLowerCase().includes(q)
    );
  });

  const filterBtn = (val, label) => {
    const active = _adminUserFilter === val;
    return `<button class="chip${active ? ' chip-active' : ''}" style="cursor:pointer${active ? ';background:var(--primary);color:#fff;border-color:var(--primary)' : ''}" onclick="_adminUserSetFilter('${val}')">${label}</button>`;
  };

  const cards = filtered.map(_renderAdminUserCard).join('');
  document.getElementById('adminContent').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;flex-wrap:wrap">
      <div style="font-size:14px;font-weight:700">Users (${filtered.length}/${_adminUsersData.length})</div>
      <button class="btn btn-p btn-sm" onclick="showAdminCreateUserModal()">+ Add User</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <input class="fi" id="adminUserSearch" placeholder="Search name, username, email, phone…"
        style="flex:1;min-width:180px;max-width:320px;padding:7px 10px;font-size:13px"
        value="${escHtml(_adminUserSearch)}"
        oninput="_adminUserSearch=this.value;_renderAdminUsersPage()">
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${filterBtn('all','All')}
        ${filterBtn('active','Active')}
        ${filterBtn('inactive','Inactive')}
        ${filterBtn('deleted','Deleted')}
      </div>
    </div>
    <div class="admin-user-grid">${cards || '<div class="card" style="text-align:center;color:var(--t3);padding:30px">No users match</div>'}</div>`;
}

function _adminUserSetFilter(val) {
  _adminUserFilter = val;
  _renderAdminUsersPage();
}

function showAdminCreateUserModal() {
  openModal('Add User', `
    <div class="fg">
      <label class="fl">Username<input class="fi" id="acuUsername" placeholder="username123" autocomplete="off"></label>
      <label class="fl">Email<input class="fi" id="acuEmail" type="email" placeholder="user@example.com" autocomplete="off"></label>
      <label class="fl full">Display Name<input class="fi" id="acuName" placeholder="Full name"></label>
      <label class="fl full">Mobile Number (optional)<input class="fi" id="acuMobile" placeholder="+91 9876543210"></label>
      <label class="fl full">Password
        <div style="display:flex;gap:8px;align-items:center">
          <input class="fi" id="acuPassword" type="password" placeholder="Minimum 6 characters" style="flex:1">
          <button type="button" class="btn btn-s btn-sm" onclick="adminGenStrongPassword()">Generate</button>
        </div>
      </label>
    </div>
    <div style="display:flex;align-items:center;gap:16px;margin:8px 0 12px">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="radio" name="acuRole" value="user" checked> User
      </label>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="radio" name="acuRole" value="admin"> Admin
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-left:auto">
        <input type="checkbox" id="acuActive" checked style="width:16px;height:16px"> Account Active
      </label>
    </div>
    <div class="fa" style="margin-top:12px">
      <button class="btn btn-p" onclick="adminCreateUser()">Create User</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function adminCreateUser() {
  const username = document.getElementById('acuUsername').value.trim().toLowerCase();
  const email = document.getElementById('acuEmail').value.trim().toLowerCase();
  const display_name = document.getElementById('acuName').value.trim();
  const mobile = document.getElementById('acuMobile').value.trim();
  const password = document.getElementById('acuPassword').value;
  const role = document.querySelector('input[name="acuRole"]:checked')?.value || 'user';
  const is_active = document.getElementById('acuActive').checked ? 1 : 0;

  if (!username || !email || !display_name || !password) {
    toast('Username, email, name, and password are required', 'warning');
    return;
  }
  if (password.length < 6) {
    toast('Password min 6 chars', 'warning');
    return;
  }

  const r = await api('/api/admin/users', {
    method: 'POST',
    body: { username, email, display_name, mobile: mobile || null, password, role, is_active },
  });
  if (!r?.success) {
    toast(r?.error || 'Failed to create user', 'error');
    return;
  }
  toast('User created', 'success');
  closeModal();
  await loadAdminUsers();
}

function adminGenStrongPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';
  let out = '';
  for (let i = 0; i < 14; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  const el = document.getElementById('acuPassword');
  if (el) {
    el.value = out;
    el.focus();
  }
  toast('Strong password generated', 'success');
}

async function adminUpdateUser(id, data) {
  const r = await api(`/api/admin/users/${id}`, { method: 'PUT', body: data });
  if (r?.success) toast('Updated', 'success');
  else toast(r?.error || 'Failed', 'error');
  await loadAdminUsers();
}

function showAdminUserModal(id, name, mobile, isActive, isDeleted) {
  openModal('Edit User', `
    <div class="fg">
      <label class="fl full">Display Name<input class="fi" id="auName" value="${name}"></label>
      <label class="fl full">Mobile Number<input class="fi" id="auMobile" value="${mobile}" placeholder="+91 9876543210"></label>
    </div>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:14px">
      <input type="checkbox" id="auActive" ${isActive ? 'checked' : ''} style="width:16px;height:16px"> Account Active
    </label>
    <div style="border-top:1px solid var(--br);padding-top:14px">
      <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:8px">SET NEW PASSWORD (leave blank to keep current)</div>
      <label class="fl full"><input class="fi" type="password" id="auPwd" placeholder="New password (min 6 chars)"></label>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="adminSaveUser(${id})">Save</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
      ${isDeleted ? `<button class="btn" style="background:#eefaf3;color:var(--green);border:1px solid #b6e0c5" onclick="adminRestoreUser(${id})">Restore User</button>` : `<button class="btn" style="background:#fff5f5;color:var(--red);border:1px solid #f3c5c5" onclick="adminDeleteUser(${id})">Soft Delete</button>`}
    </div>`);
}

async function adminSaveUser(id) {
  const name = document.getElementById('auName').value.trim();
  const mobile = document.getElementById('auMobile').value.trim();
  const isActive = document.getElementById('auActive').checked;
  const pwd = document.getElementById('auPwd').value;
  if (!name) { toast('Name required', 'warning'); return; }
  const r = await api(`/api/admin/users/${id}`, { method: 'PUT', body: { display_name: name, mobile: mobile || null, is_active: isActive ? 1 : 0 } });
  if (!r?.success) { toast(r?.error || 'Update failed', 'error'); return; }
  if (pwd) {
    if (pwd.length < 6) { toast('Password min 6 chars', 'warning'); return; }
    const rp = await api(`/api/admin/users/${id}/set-password`, { method: 'POST', body: { password: pwd } });
    if (!rp?.success) { toast(rp?.error || 'Password update failed', 'error'); return; }
    toast('User & password updated', 'success');
  } else {
    toast('User updated', 'success');
  }
  closeModal();
  await loadAdminUsers();
}

async function adminGenOtp(userId) {
  openModal('Generate OTP', `
    <div class="fg">
      <label class="fl full">Purpose
        <select class="fi" id="otpPurpose">
          <option value="login">Login Verification</option>
          <option value="password_reset">Password Reset</option>
          <option value="verify_mobile">Verify Mobile</option>
        </select>
      </label>
      <label class="fl full">Channel
        <select class="fi" id="otpChannel">
          <option value="email">Email</option>
          <option value="mobile">Mobile / SMS</option>
        </select>
      </label>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="doGenOtp(${userId})">Generate OTP</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function doGenOtp(userId) {
  const purpose = document.getElementById('otpPurpose').value;
  const channel = document.getElementById('otpChannel').value;
  const r = await api(`/api/admin/users/${userId}/otp`, { method: 'POST', body: { purpose, channel } });
  if (r?.otp) {
    openModal('OTP Generated', `
      <div style="text-align:center;padding:20px 0">
        <div style="font-size:48px;font-weight:700;letter-spacing:10px;color:var(--em);font-family:monospace">${r.otp}</div>
        <div style="font-size:13px;color:var(--t2);margin-top:10px">Valid 10 minutes &nbsp;&middot;&nbsp; Purpose: <b>${purpose}</b> &nbsp;&middot;&nbsp; Channel: <b>${channel}</b></div>
        <div style="font-size:12px;color:var(--t3);margin-top:4px">Share this code with the user via ${channel}</div>
      </div>
      <div class="fa"><button class="btn btn-g" onclick="closeModal()">Close</button></div>`);
  } else toast(r?.error || 'Failed to generate OTP', 'error');
}

async function adminResetLink(userId) {
  const r = await api(`/api/admin/users/${userId}/reset-link`, { method: 'POST' });
  if (r?.link) {
    openModal('Password Reset Link', `
      <div style="font-size:13px;color:var(--t2);margin-bottom:12px">Valid for 24 hours. Copy and share with the user:</div>
      <div id="resetLinkBox" style="background:var(--bg2);border:1px solid var(--br);border-radius:6px;padding:12px;font-size:11px;word-break:break-all;font-family:monospace;line-height:1.6">${r.link}</div>
      <div class="fa" style="margin-top:16px">
        <button class="btn btn-p" onclick="navigator.clipboard.writeText(document.getElementById('resetLinkBox').textContent);toast('Copied!','success')">Copy Link</button>
        <button class="btn btn-g" onclick="closeModal()">Close</button>
      </div>`);
  } else toast(r?.error || 'Failed', 'error');
}

async function adminDeleteUser(id) {
  if (!await confirmDialog('Soft delete this user? They will be unable to log in, but their data will remain in the database.')) return;
  const r = await api(`/api/admin/users/${id}`, { method: 'DELETE' });
  if (r?.success) {
    toast('User deleted', 'success');
    closeModal();
    await loadAdminUsers();
  } else {
    toast(r?.error || 'Delete failed', 'error');
  }
}

async function adminRestoreUser(id) {
  const r = await api(`/api/admin/users/${id}/restore`, { method: 'POST' });
  if (r?.success) {
    toast('User restored', 'success');
    closeModal();
    await loadAdminUsers();
  } else {
    toast(r?.error || 'Restore failed', 'error');
  }
}

// â”€â”€ Plans â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadAdminPlans() {
  const data = await api('/api/admin/plans');
  const plans = data?.plans || [];
  const normalizedPlans = plans.map((plan) => ({
    ...plan,
    description: cleanMojibakeText(plan.description),
    pages: Array.isArray(plan.pages) ? plan.pages : [],
  }));

  const cards = normalizedPlans.length ? normalizedPlans.map(p => {
    const pageLabels = p.pages.map(k => ALL_PAGES.find(x => x.key === k)?.label || k).join(', ') || 'â€”';
    const statusColor = p.is_active ? 'var(--green)' : 'var(--t3)';
    return `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:15px;font-weight:700">${p.name}
            ${p.is_free ? '<span style="font-size:10px;padding:2px 7px;background:var(--blue-l);color:var(--blue);border-radius:10px;margin-left:6px">Free</span>' : ''}
            ${p.auto_assign_on_signup ? '<span style="font-size:10px;padding:2px 7px;background:var(--green-l);color:var(--green);border-radius:10px;margin-left:6px">Signup Default</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--t2);margin-top:2px">${escHtml(p.description || '-')}</div>
          <div style="font-size:12px;color:var(--t3);margin-top:4px">Pages: ${escHtml(cleanMojibakeText(pageLabels) || '-')}</div>
          <div style="font-size:12px;margin-top:4px">
            Monthly: <b>${p.price_monthly>0?fmtCur(p.price_monthly):'Free'}</b>
            &nbsp;|&nbsp; Yearly: <b>${p.price_yearly>0?fmtCur(p.price_yearly):'Free'}</b>
            &nbsp;|&nbsp; AI Queries/day: <b>${p.ai_query_limit===-1||p.ai_query_limit==null?'Unlimited':p.ai_query_limit===0?'None':p.ai_query_limit}</b>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <span style="font-size:11px;color:${statusColor};font-weight:600">${p.is_active?'Active':'Inactive'}</span>
          <button class="btn btn-g btn-sm" onclick="showPlanModal(${p.id})">Edit</button>
          <button class="btn-d" style="color:var(--red);font-size:12px" onclick="adminDeletePlan(${p.id})">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('') : '<div style="color:var(--t3);text-align:center;padding:30px">No plans yet. Create one to control page access.</div>';

  document.getElementById('adminContent').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="font-size:14px;font-weight:700">Plans (${plans.length})</div>
      <button class="btn btn-p btn-sm" onclick="showPlanModal(null)">+ New Plan</button>
    </div>
    ${cards}`;
}

async function showPlanModal(planId) {
  const data = await api('/api/admin/plans');
  const plan = planId ? data?.plans?.find(p => p.id === planId) : null;
  const pageCheckboxes = ALL_PAGES.map(pg =>
    `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer">
      <input type="checkbox" class="plan-page-cb" value="${pg.key}" ${plan?.pages?.includes(pg.key)?'checked':''}> ${pg.label}
    </label>`
  ).join('');
  const aiLimitVal = plan?.ai_query_limit != null ? plan.ai_query_limit : -1;
  openModal(plan ? `Edit Plan: ${plan.name}` : 'New Plan', `
    <div class="fg">
      <label class="fl full">Plan Name *<input class="fi" id="pName" value="${plan?.name||''}"></label>
      <label class="fl full">Description<input class="fi" id="pDesc" value="${plan?.description||''}" placeholder="Brief description..."></label>
      <label class="fl">Monthly Price (&#8377;)<input class="fi" type="number" step="0.01" id="pMonthly" value="${plan?.price_monthly||0}"></label>
      <label class="fl">Yearly Price (&#8377;)<input class="fi" type="number" step="0.01" id="pYearly" value="${plan?.price_yearly||0}"></label>
      <label class="fl full">AI Queries per day
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
          <input class="fi" type="number" id="pAiLimit" value="${aiLimitVal}" min="-1" step="1" style="flex:1" oninput="_updateAiLimitHint(this.value)">
          <span id="pAiLimitHint" style="font-size:12px;color:var(--t3);white-space:nowrap">${aiLimitVal===-1?'Unlimited':aiLimitVal===0?'No AI access':aiLimitVal+' queries/day'}</span>
        </div>
        <div style="font-size:11px;color:var(--t3);margin-top:3px">-1 = Unlimited &nbsp;&middot;&nbsp; 0 = Disable AI &nbsp;&middot;&nbsp; Any positive number = daily cap</div>
      </label>
    </div>
    <div style="display:flex;gap:16px;margin:12px 0">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="pFree" ${plan?.is_free?'checked':''} style="width:15px;height:15px"> Free plan (all users)
      </label>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="pActive" ${(plan===null||plan?.is_active)?'checked':''} style="width:15px;height:15px"> Active
      </label>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="pSignupDefault" ${plan?.auto_assign_on_signup?'checked':''} style="width:15px;height:15px"> Auto assign on signup
      </label>
    </div>
    <div>
      <div style="font-size:13px;font-weight:600;color:var(--t2);margin-bottom:8px">Pages Included</div>
      <div style="border:1px solid var(--br);border-radius:6px;padding:10px 14px">${pageCheckboxes}</div>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="adminSavePlan(${planId||'null'})">Save Plan</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

function _updateAiLimitHint(val) {
  const n = parseInt(val, 10);
  const hint = document.getElementById('pAiLimitHint');
  if (!hint) return;
  hint.textContent = isNaN(n) ? '' : n === -1 ? 'Unlimited' : n === 0 ? 'No AI access' : `${n} queries/day`;
}

async function adminSavePlan(planId) {
  const name = document.getElementById('pName').value.trim();
  if (!name) { toast('Plan name required', 'warning'); return; }
  const pages = [...document.querySelectorAll('.plan-page-cb:checked')].map(c => c.value);
  const aiLimit = parseInt(document.getElementById('pAiLimit')?.value ?? '-1', 10);
  const body = {
    name,
    description: document.getElementById('pDesc').value.trim(),
    price_monthly: parseFloat(document.getElementById('pMonthly').value)||0,
    price_yearly:  parseFloat(document.getElementById('pYearly').value)||0,
    is_free:   document.getElementById('pFree').checked ? 1 : 0,
    is_active: document.getElementById('pActive').checked ? 1 : 0,
    auto_assign_on_signup: document.getElementById('pSignupDefault').checked ? 1 : 0,
    ai_query_limit: isNaN(aiLimit) ? -1 : aiLimit,
    pages,
  };
  const r = planId
    ? await api(`/api/admin/plans/${planId}`, { method: 'PUT', body })
    : await api('/api/admin/plans', { method: 'POST', body });
  if (r?.success || r?.id) { closeModal(); toast('Plan saved', 'success'); await loadAdminPlans(); }
  else toast(r?.error || 'Failed', 'error');
}

async function adminDeletePlan(id) {
  if (!await confirmDialog('Delete this plan? Users with this subscription will lose access.')) return;
  const r = await api(`/api/admin/plans/${id}`, { method: 'DELETE' });
  if (r?.success) { toast('Plan deleted', 'success'); await loadAdminPlans(); }
  else toast(r?.error || 'Failed', 'error');
}

// â”€â”€ Subscriptions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _adminSubUsers = [];
let _adminSubPlans = [];
let _adminSubsData = [];
let _adminSubSearch = '';

async function loadAdminSubscriptions() {
  const [subData, usersData, plansData] = await Promise.all([
    api('/api/admin/subscriptions'),
    api('/api/admin/users'),
    api('/api/admin/plans'),
  ]);
  _adminSubsData = subData?.subscriptions || [];
  _adminSubUsers = (usersData?.users || []).map(u => ({ id: u.id, name: u.display_name, username: u.username }));
  _adminSubPlans = (plansData?.plans || []).map(p => ({ id: p.id, name: p.name }));
  _adminSubSearch = '';
  _renderAdminSubsPage();
}

function _renderAdminSubsPage() {
  const q = _adminSubSearch.toLowerCase();
  const filtered = q
    ? _adminSubsData.filter(s =>
        (s.display_name || '').toLowerCase().includes(q) ||
        (s.username || '').toLowerCase().includes(q) ||
        (s.plan_name || '').toLowerCase().includes(q) ||
        (s.status || '').toLowerCase().includes(q)
      )
    : _adminSubsData;

  const rows = filtered.length ? filtered.map(s => {
    const statusColor = s.status==='active' ? 'var(--green)' : s.status==='expired' ? 'var(--red)' : 'var(--t3)';
    return `<tr>
      <td><div style="font-weight:600">${s.display_name}</div><div style="font-size:11px;color:var(--t2)">@${s.username}</div></td>
      <td>${s.plan_name}</td>
      <td style="font-size:12px">${s.billing_cycle}</td>
      <td style="font-size:12px">${fmtDate(s.start_date)}</td>
      <td style="font-size:12px">${s.end_date ? fmtDate(s.end_date) : 'No expiry'}</td>
      <td style="color:${statusColor};font-weight:600;font-size:12px">${s.status}</td>
      <td>
        <button class="btn-d" style="color:var(--em)" onclick="showSubModal(${s.id},${s.plan_id},'${s.billing_cycle}','${s.end_date||''}','${s.status}')">Edit</button>
        <button class="btn-d" style="color:var(--red)" onclick="adminDeleteSub(${s.id})">Del</button>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:20px">${q ? 'No subscriptions match' : 'No subscriptions yet'}</td></tr>`;

  document.getElementById('adminContent').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;flex-wrap:wrap">
      <div style="font-size:14px;font-weight:700">Subscriptions (${filtered.length}/${_adminSubsData.length})</div>
      <button class="btn btn-p btn-sm" onclick="showNewSubModal()">+ Add Subscription</button>
    </div>
    <div style="margin-bottom:12px">
      <input class="fi" id="adminSubSearch" placeholder="Search user, plan, status…"
        style="width:100%;max-width:340px;padding:7px 10px;font-size:13px"
        value="${escHtml(_adminSubSearch)}"
        oninput="_adminSubSearch=this.value;_renderAdminSubsPage()">
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>User</th><th>Plan</th><th>Cycle</th><th>Start</th><th>End</th><th>Status</th><th style="width:100px">Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function _buildSubSelects(selPlanId) {
  const userOpts = _adminSubUsers.map(u =>
    `<option value="${u.id}">${u.name} (@${u.username})</option>`
  ).join('');
  const planOpts = _adminSubPlans.map(p =>
    `<option value="${p.id}" ${p.id==selPlanId?'selected':''}>${p.name}</option>`
  ).join('');
  return { userOpts, planOpts };
}

function showNewSubModal() {
  const { userOpts, planOpts } = _buildSubSelects(null);
  openModal('New Subscription', `
    <div class="fg">
      <label class="fl full">User<select class="fi" id="subUser">${userOpts}</select></label>
      <label class="fl full">Plan<select class="fi" id="subPlan">${planOpts}</select></label>
      <label class="fl">Billing Cycle
        <select class="fi" id="subCycle">
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="lifetime">Lifetime</option>
        </select>
      </label>
      <label class="fl">Start Date<input class="fi" type="date" id="subStart" value="${todayStr()}"></label>
      <label class="fl">End Date <span style="color:var(--t3);font-size:11px">(blank = no expiry)</span><input class="fi" type="date" id="subEnd"></label>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="adminSaveSub(null)">Create</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

function showSubModal(id, planId, cycle, endDate, status) {
  const { planOpts } = _buildSubSelects(planId);
  openModal('Edit Subscription', `
    <div class="fg">
      <label class="fl full">Plan<select class="fi" id="subPlan">${planOpts}</select></label>
      <label class="fl">Billing Cycle
        <select class="fi" id="subCycle">
          <option value="monthly" ${cycle==='monthly'?'selected':''}>Monthly</option>
          <option value="yearly" ${cycle==='yearly'?'selected':''}>Yearly</option>
          <option value="lifetime" ${cycle==='lifetime'?'selected':''}>Lifetime</option>
        </select>
      </label>
      <label class="fl">End Date<input class="fi" type="date" id="subEnd" value="${endDate||''}"></label>
      <label class="fl full">Status
        <select class="fi" id="subStatus">
          <option value="active" ${status==='active'?'selected':''}>Active</option>
          <option value="expired" ${status==='expired'?'selected':''}>Expired</option>
          <option value="cancelled" ${status==='cancelled'?'selected':''}>Cancelled</option>
        </select>
      </label>
    </div>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="adminSaveSub(${id})">Save</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function adminSaveSub(id) {
  const plan_id = parseInt(document.getElementById('subPlan').value);
  const billing_cycle = document.getElementById('subCycle').value;
  const end_date = document.getElementById('subEnd')?.value || null;
  let r;
  if (id) {
    const status = document.getElementById('subStatus').value;
    r = await api(`/api/admin/subscriptions/${id}`, { method: 'PUT', body: { plan_id, billing_cycle, end_date, status } });
  } else {
    const user_id = parseInt(document.getElementById('subUser').value);
    const start_date = document.getElementById('subStart').value;
    r = await api('/api/admin/subscriptions', { method: 'POST', body: { user_id, plan_id, billing_cycle, start_date, end_date } });
  }
  if (r?.success || r?.id) { closeModal(); toast('Saved', 'success'); await loadAdminSubscriptions(); }
  else toast(r?.error || 'Failed', 'error');
}

async function adminDeleteSub(id) {
  if (!await confirmDialog('Delete this subscription? User will lose access to plan pages.')) return;
  const r = await api(`/api/admin/subscriptions/${id}`, { method: 'DELETE' });
  if (r?.success) { toast('Deleted', 'success'); await loadAdminSubscriptions(); }
  else toast(r?.error || 'Failed', 'error');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EMI TRACKER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _emiFilter = 'all';
let _emiTagFilter = '';
let _emiSearch = '';
let _emiRecords = [];
let _emiFiltered = [];
let _emiExpandedId = null;
let _emiMonth = new Date().toISOString().slice(0, 7);
let _emiMonthlySummary = null;

let _friendEmiFilter = 'all';
let _friendEmiTagFilter = '';
let _friendEmiSearch = '';
let _friendEmiRecords = [];
let _friendEmiFiltered = [];
let _friendEmiExpandedId = null;

async function loadEmiTracker() {
  document.getElementById('main').innerHTML = '<div class="tab-content"><div style="text-align:center;padding:40px;color:var(--t3)">Loading...</div></div>';
  const [data, summary] = await Promise.all([
    api('/api/emi/records'),
    api('/api/emi/summary?month=' + _emiMonth)
  ]);
  if (!data) return;
  _emiRecords = Array.isArray(data) ? data : (data.records || []);
  _emiMonthlySummary = summary || null;
  renderEmiTracker();
}

// â”€â”€â”€ FRIEND EMI TRACKER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadFriendEmiTracker() {
  document.getElementById('main').innerHTML = '<div class="tab-content"><div style="text-align:center;padding:40px;color:var(--t3)">Loading...</div></div>';
  const data = await api('/api/emi/records?for_friend=1');
  if (!data) return;
  _friendEmiRecords = Array.isArray(data) ? data : (data.records || []);
  renderFriendEmiTracker();
}

function renderFriendEmiTracker() {
  const searchFocused = document.activeElement?.id === 'friendEmiSearch';
  const searchCursor = searchFocused ? document.getElementById('friendEmiSearch')?.selectionStart : null;
  const tags = [...new Set(_friendEmiRecords.map(r => r.tag).filter(Boolean))];
  const filterDefs = [
    { key: 'all',       label: 'All',         color: '' },
    { key: 'active',    label: 'Active',       color: 'var(--green)' },
    { key: 'pending',   label: 'Not Started',  color: '#6c8ebf' },
    { key: 'saved',     label: 'Saved',        color: 'var(--amber)' },
    { key: 'completed', label: 'Completed',    color: 'var(--primary)' },
  ];

  let records = _friendEmiRecords;
  if (_friendEmiFilter !== 'all') records = records.filter(r => r.status === _friendEmiFilter);
  if (_friendEmiTagFilter) records = records.filter(r => r.tag === _friendEmiTagFilter);
  if (_friendEmiSearch) {
    const q = _friendEmiSearch.toLowerCase();
    records = records.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.friend_name && r.friend_name.toLowerCase().includes(q)) ||
      (r.description && r.description.toLowerCase().includes(q)) ||
      (r.tag && r.tag.toLowerCase().includes(q))
    );
  }
  _friendEmiFiltered = records;

  const totalPrincipal = records.reduce((s, r) => s + r.principal, 0);
  const totalGrand     = records.reduce((s, r) => s + r.grand_total, 0);
  const activeCount    = _friendEmiRecords.filter(r => r.status === 'active' || r.status === 'pending').length;

  const filterChips = filterDefs.map(f => {
    const ct = _friendEmiRecords.filter(r => f.key === 'all' || r.status === f.key).length;
    const colorStyle = (f.color && _friendEmiFilter === f.key) ? 'color:' + f.color + ';border-color:' + f.color + ';' : (f.color && ct > 0 ? 'color:' + f.color + ';' : '');
    return '<button class="chip ' + (_friendEmiFilter === f.key ? 'chip-active' : '') + '" style="' + colorStyle + '" onclick="_friendEmiFilter=\'' + f.key + '\';renderFriendEmiTracker()">' + f.label + ' <span class="chip-ct">' + ct + '</span></button>';
  }).join('');

  const tagChips = tags.map(t =>
    '<button class="chip ' + (_friendEmiTagFilter === t ? 'chip-active' : '') + '" onclick="_friendEmiTagFilter=_friendEmiTagFilter===\'' + t + '\'?\'\':\'' + t + '\';renderFriendEmiTracker()">' + escHtml(t) + '</button>'
  ).join('');

  const portfolioStats = `
    <div class="emi-portfolio-bar">
      <div class="emi-p-stat"><div class="ps-lbl">Total Loans</div><div class="ps-val">${_friendEmiRecords.length}</div></div>
      <div class="emi-p-stat"><div class="ps-lbl">Active / Upcoming</div><div class="ps-val" style="color:var(--green)">${activeCount}</div></div>
      <div class="emi-p-stat"><div class="ps-lbl">Total Principal</div><div class="ps-val">${fmtCur(totalPrincipal)}</div></div>
      <div class="emi-p-stat"><div class="ps-lbl">Grand Total (P+I)</div><div class="ps-val">${fmtCur(totalGrand)}</div></div>
    </div>`;

  const cards = records.length === 0
    ? '<div class="empty-state"><div>No Friend EMIs found</div><div style="margin-top:8px;font-size:13px;color:var(--t3)">Add or import an EMI you\'ve created for a friend on your card.</div></div>'
    : records.map(r => renderEmiCard(r)).join('');

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div style="font-size:20px;font-weight:700">Friend EMIs</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-s" onclick="showEmiImportModal(true)">Import</button>
          <button class="btn btn-s" onclick="showEmiImportModal(true, 'simple')" title="Import sheets where Excel only has the monthly paid amount">Import Paid-Only EMI</button>
          <button class="btn btn-p" onclick="showAddFriendEmiModal()">+ Add Friend EMI</button>
        </div>
      </div>
      <input type="search" class="fi" id="friendEmiSearch" placeholder="Search by name, friend, tag or description..." value="${escHtml(_friendEmiSearch)}"
        oninput="_friendEmiSearch=this.value;renderFriendEmiTracker()"
        style="margin-bottom:12px;width:100%;box-sizing:border-box">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${filterChips}</div>
      ${tags.length ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center"><span style="font-size:12px;color:var(--t3)">Tag:</span>' + tagChips + '</div>' : ''}
      ${portfolioStats}
      <div id="emiCards" style="margin-top:12px">${cards}</div>
    </div>`;

  if (searchFocused) {
    const el = document.getElementById('friendEmiSearch');
    if (el) { el.focus(); if (searchCursor !== null) el.setSelectionRange(searchCursor, searchCursor); }
  }
}

function showAddFriendEmiModal() {
  const shortDate = (val) => {
    if (!val) return '-';
    const s = String(val);
    return s.slice(0, 10);
  };
  const today = new Date().toISOString().slice(0, 10);
  openModal('Add Friend EMI', `
    <div class="fg">
      <label class="fl full">Friend's Name
        <input type="text" id="femi_friend" class="fi" placeholder="e.g. Rahul Sharma">
      </label>
      <label class="fl full">Loan Name / Label
        <input type="text" id="femi_name" class="fi" placeholder="e.g. Rahul's Bike Loan">
      </label>
      <label class="fl">Principal (&#8377;)
        <input type="number" id="femi_principal" class="fi" placeholder="50000" min="1" oninput="_calcFriendEmiPreview()">
      </label>
      <label class="fl">Annual Rate (%)
        <input type="number" id="femi_rate" class="fi" placeholder="12" step="0.01" min="0" oninput="_calcFriendEmiPreview()">
      </label>
      <label class="fl">Tenure (months)
        <input type="number" id="femi_tenure" class="fi" placeholder="12" min="1" oninput="_calcFriendEmiPreview()">
      </label>
      <label class="fl">Start Date
        <input type="date" id="femi_start" class="fi" value="${today}">
      </label>
    </div>
    <div id="femi_preview" style="background:var(--bg3);border-radius:8px;padding:10px 14px;margin:4px 0 14px;font-size:13px;color:var(--t3);min-height:32px">Fill in principal, rate and tenure to preview.</div>
    <div class="fa">
      <button class="btn btn-p" onclick="doSaveFriendEmi()">Save &amp; Activate</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

function _calcFriendEmiPreview() {
  const P = parseFloat(document.getElementById('femi_principal')?.value) || 0;
  const R = parseFloat(document.getElementById('femi_rate')?.value) || 0;
  const N = parseInt(document.getElementById('femi_tenure')?.value) || 0;
  const el = document.getElementById('femi_preview');
  if (!el) return;
  if (!P || !N) { el.innerHTML = 'Fill in principal, rate and tenure to preview.'; el.style.color = 'var(--t3)'; return; }
  const r = R / 12 / 100;
  const emi = r === 0 ? P / N : Math.round((P * r * Math.pow(1+r,N)) / (Math.pow(1+r,N)-1) * 100) / 100;
  let bal = P, totI = 0;
  for (let m = 1; m <= N; m++) {
    const interest = Math.round(bal * r * 100) / 100;
    bal = Math.max(0, Math.round((bal - (emi - interest)) * 100) / 100);
    totI += interest;
  }
  totI = Math.round(totI * 100) / 100;
  el.style.color = 'var(--t1)';
  el.innerHTML = `Monthly EMI: <strong>${fmtCur(emi)}</strong> &nbsp;&middot;&nbsp; Total Interest: <strong>${fmtCur(totI)}</strong> &nbsp;&middot;&nbsp; Grand Total: <strong>${fmtCur(Math.round((P+totI)*100)/100)}</strong>`;
}

async function doSaveFriendEmi() {
  const friendName = document.getElementById('femi_friend').value.trim();
  const name       = document.getElementById('femi_name').value.trim();
  const P          = parseFloat(document.getElementById('femi_principal').value) || 0;
  const R          = parseFloat(document.getElementById('femi_rate').value) || 0;
  const N          = parseInt(document.getElementById('femi_tenure').value) || 0;
  const startDate  = document.getElementById('femi_start').value;
  if (!friendName) { toast('Enter friend\'s name', 'warning'); return; }
  if (!name)       { toast('Enter a loan name', 'warning'); return; }
  if (!P || !N)    { toast('Enter principal and tenure', 'warning'); return; }
  if (!startDate)  { toast('Pick a start date', 'warning'); return; }

  const r = R / 12 / 100;
  const emi = r === 0 ? P / N : Math.round((P * r * Math.pow(1+r,N)) / (Math.pow(1+r,N)-1) * 100) / 100;
  let bal = P, totI = 0;
  for (let m = 1; m <= N; m++) {
    const interest = Math.round(bal * r * 100) / 100;
    bal = Math.max(0, Math.round((bal - (emi - interest)) * 100) / 100);
    totI += interest;
  }
  totI = Math.round(totI * 100) / 100;
  const grandTotal = Math.round((P + totI) * 100) / 100;

  const saved = await api('/api/emi/records', { method: 'POST', body: {
    name, principal: P, annual_rate: R, tenure_months: N,
    monthly_emi: emi, total_interest: totI,
    gst_rate: 0, total_gst: 0, total_amount: Math.round((P+totI)*100)/100, grand_total: grandTotal,
    for_friend: 1, friend_name: friendName,
  }});
  if (!saved?.id) { toast(saved?.error || 'Save failed', 'error'); return; }

  const activated = await api('/api/emi/records/' + saved.id + '/activate', { method: 'POST', body: { start_date: startDate, add_expenses: false } });
  if (!activated?.success) { toast('Saved but activation failed', 'warning'); }
  else toast('Friend EMI added!', 'success');
  closeModal();
  await loadFriendEmiTracker();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function emiChangeMonth(delta) {
  const [y, m] = _emiMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  _emiMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  document.getElementById('emiMonthLabel').textContent = _emiMonthLabel();
  // Reload just the monthly summary
  const summary = await api('/api/emi/summary?month=' + _emiMonth);
  _emiMonthlySummary = summary || null;
  renderEmiMonthlySummary();
}

async function emiGoToMonth(val) {
  if (!val) return;
  _emiMonth = val;
  const summary = await api('/api/emi/summary?month=' + _emiMonth);
  _emiMonthlySummary = summary || null;
  renderEmiMonthlySummary();
}

function _emiMonthLabel() {
  const [y, m] = _emiMonth.split('-').map(Number);
  return MONTHS[m - 1] + ' ' + y;
}

function renderEmiMonthlySummary() {
  const el = document.getElementById('emiMonthlySummary');
  if (!el) return;
  el.innerHTML = buildEmiMonthlySummaryHtml();
}

function buildEmiMonthlySummaryHtml() {
  const s = _emiMonthlySummary;
  if (!s) return '';
  const isCurrentMonth = _emiMonth === new Date().toISOString().slice(0, 7);
  const remaining = Math.round((s.totalDue - s.totalPaid) * 100) / 100;
  const pct = s.totalDue > 0 ? Math.round(s.totalPaid / s.totalDue * 100) : 0;

  const rows = (s.installments || []).map(i => {
    const isPaid = i.paid_amount > 0;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1)">
      <div>
        <div style="font-weight:600;font-size:13px">${escHtml(i.name)}</div>
        <div style="font-size:11px;opacity:0.65">${i.due_date}${i.tag ? ' &middot; ' + escHtml(i.tag) : ''}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:var(--mono);font-size:13px;font-weight:600">${fmtCur(i.emi_amount)}</div>
        ${isPaid ? '<div style="font-size:11px;color:var(--amber)">Paid ' + fmtCur(i.paid_amount) + '</div>' : '<div style="font-size:11px;opacity:0.55">Pending</div>'}
      </div>
    </div>`;
  }).join('');

  return `<div class="emi-month-panel">
    <div class="emi-month-header">
      <button class="emi-month-nav" onclick="emiChangeMonth(-1)">&#8592;</button>
      <div style="display:flex;align-items:center;gap:10px">
        <span id="emiMonthLabel" style="font-size:15px;font-weight:700">${_emiMonthLabel()}</span>
        ${isCurrentMonth ? '<span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:10px">This Month</span>' : ''}
        <input type="month" id="emiMonthPicker" value="${_emiMonth}" onchange="emiGoToMonth(this.value)" style="opacity:0;position:absolute;width:1px;height:1px">
        <button class="emi-month-nav" onclick="document.getElementById('emiMonthPicker').showPicker?document.getElementById('emiMonthPicker').showPicker():document.getElementById('emiMonthPicker').click()" title="Pick month" style="font-size:14px">&#128197;</button>
      </div>
      <button class="emi-month-nav" onclick="emiChangeMonth(1)">&#8594;</button>
    </div>
    <div class="emi-month-stats">
      <div class="emi-month-stat"><div class="ms-lbl">Total Due</div><div class="ms-val">${fmtCur(s.totalDue)}</div></div>
      <div class="emi-month-stat"><div class="ms-lbl">Paid</div><div class="ms-val" style="color:var(--amber)">${fmtCur(s.totalPaid)}</div></div>
      <div class="emi-month-stat"><div class="ms-lbl">Remaining</div><div class="ms-val" style="color:${remaining > 0 ? '#FF8A8A' : 'var(--amber)'}">${fmtCur(remaining)}</div></div>
      <div class="emi-month-stat"><div class="ms-lbl">EMIs</div><div class="ms-val">${s.installments?.length || 0}</div></div>
    </div>
    ${s.totalDue > 0 ? `<div style="margin:0 0 12px;height:6px;background:rgba(255,255,255,0.15);border-radius:3px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:var(--amber);border-radius:3px;transition:width 0.4s"></div>
    </div>` : ''}
    ${s.installments?.length ? '<div style="max-height:220px;overflow-y:auto">' + rows + '</div>'
      : '<div style="text-align:center;padding:16px;opacity:0.6;font-size:13px">No EMIs due this month</div>'}
  </div>`;
}

function renderEmiTracker() {
  const searchFocused = document.activeElement?.id === 'emiSearch';
  const searchCursor = searchFocused ? document.getElementById('emiSearch')?.selectionStart : null;
  const tags = [...new Set(_emiRecords.map(r => r.tag).filter(Boolean))];
  const filterDefs = [
    { key: 'all',       label: 'All',         color: '' },
    { key: 'active',    label: 'Active',       color: 'var(--green)' },
    { key: 'pending',   label: 'Not Started',  color: '#6c8ebf' },
    { key: 'saved',     label: 'Saved',        color: 'var(--amber)' },
    { key: 'completed', label: 'Completed',    color: 'var(--primary)' },
  ];

  let records = _emiRecords;
  if (_emiFilter !== 'all') records = records.filter(r => r.status === _emiFilter);
  if (_emiTagFilter) records = records.filter(r => r.tag === _emiTagFilter);
  if (_emiSearch) {
    const q = _emiSearch.toLowerCase();
    records = records.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q)) ||
      (r.tag && r.tag.toLowerCase().includes(q))
    );
  }
  _emiFiltered = records;

  const totalPrincipal = records.reduce((s, r) => s + r.principal, 0);
  const totalGrand = records.reduce((s, r) => s + r.grand_total, 0);
  const activeCount = _emiRecords.filter(r => r.status === 'active' || r.status === 'pending').length;

  const filterChips = filterDefs.map(f => {
    const ct = _emiRecords.filter(r => f.key === 'all' || r.status === f.key).length;
    const colorStyle = (f.color && _emiFilter === f.key) ? 'color:' + f.color + ';border-color:' + f.color + ';' : (f.color && ct > 0 ? 'color:' + f.color + ';' : '');
    return '<button class="chip ' + (_emiFilter === f.key ? 'chip-active' : '') + '" style="' + colorStyle + '" onclick="_emiFilter=\'' + f.key + '\';renderEmiTracker()">' + f.label + ' <span class="chip-ct">' + ct + '</span></button>';
  }).join('');

  const tagChips = tags.map(t =>
    '<button class="chip ' + (_emiTagFilter === t ? 'chip-active' : '') + '" onclick="_emiTagFilter=_emiTagFilter===\'' + t + '\'?\'\':\'' + t + '\';renderEmiTracker()">' + escHtml(t) + '</button>'
  ).join('');

  const portfolioStats = `
    <div class="emi-portfolio-bar">
      <div class="emi-p-stat"><div class="ps-lbl">Total Loans</div><div class="ps-val">${_emiRecords.length}</div></div>
      <div class="emi-p-stat"><div class="ps-lbl">Active / Upcoming</div><div class="ps-val" style="color:var(--green)">${activeCount}</div></div>
      <div class="emi-p-stat"><div class="ps-lbl">Total Principal</div><div class="ps-val">${fmtCur(totalPrincipal)}</div></div>
      <div class="emi-p-stat"><div class="ps-lbl">Grand Total (P+I)</div><div class="ps-val">${fmtCur(totalGrand)}</div></div>
    </div>`;

  const cards = records.length === 0
    ? '<div class="empty-state"><div>No EMIs found</div><div style="margin-top:8px;font-size:13px;color:var(--t3)">Calculate an EMI and save it to track here.</div></div>'
    : records.map(r => renderEmiCard(r)).join('');

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div style="font-size:20px;font-weight:700">My EMIs</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-s" onclick="downloadEmisPdf(_emiFiltered)">PDF Overview</button>
          <button class="btn btn-s" onclick="showEmiImportModal()">Import EMI</button>
          <button class="btn btn-s" onclick="showEmiImportModal(false, 'simple')" title="Import sheets where Excel only has the monthly paid amount">Import Paid-Only EMI</button>
          <button class="btn btn-p" onclick="switchTab('emi')">+ New EMI</button>
        </div>
      </div>

      <div class="emi-tracker-layout">
        <div class="emi-tracker-main">
          <input type="search" class="fi" id="emiSearch" placeholder="Search by name, tag or description..." value="${escHtml(_emiSearch)}"
            oninput="_emiSearch=this.value;renderEmiTracker()"
            style="margin-bottom:12px;width:100%;box-sizing:border-box">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${filterChips}</div>
          ${tags.length ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center"><span style="font-size:12px;color:var(--t3)">Tag:</span>' + tagChips + '</div>' : ''}
          ${portfolioStats}
          <div id="emiCards" style="margin-top:12px">${cards}</div>
        </div>
        <div class="emi-tracker-side">
          <div id="emiMonthlySummary">${buildEmiMonthlySummaryHtml()}</div>
        </div>
      </div>
    </div>`;

  if (searchFocused) {
    const el = document.getElementById('emiSearch');
    if (el) { el.focus(); if (searchCursor !== null) el.setSelectionRange(searchCursor, searchCursor); }
  }
}

// â”€â”€â”€ EMI IMPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function showEmiImportModal(forFriend = false, preferredMode = '') {
  openModal((forFriend ? 'Import Friend EMI' : 'Import EMI') + ' from Excel', `
    <input type="hidden" id="emiImportForFriend" value="${forFriend ? 1 : 0}">
    <div class="fg" style="margin-bottom:14px">
      <label class="fl full">File (.xlsx / .xls)
        <input type="file" accept=".xlsx,.xls" id="emiXlsxFile" class="fi">
      </label>
      <label class="fl">Password (if protected)
        <input type="password" id="emiXlsxPass" class="fi" placeholder="Leave blank if none" autocomplete="new-password">
      </label>
      <label class="fl" style="justify-content:flex-end;padding-top:20px">
        <button class="btn btn-p" onclick="loadEmiSheets()">Load Sheets â†’</button>
      </label>
    </div>
    ${forFriend ? `
    <div style="margin-bottom:14px">
      <label class="fl full">Friend Name <span style="color:var(--red)">*</span>
        <input type="text" id="emiImportFriendName" class="fi" placeholder="e.g. Saurav">
      </label>
    </div>` : ''}
    <div style="background:var(--bg3);border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:6px">IMPORT MODES</div>
      <div style="font-size:12px;color:var(--t3);line-height:1.5">
        <div><strong>Detailed Import</strong> â€” use this when your Excel already has principal, interest, total, or EMI columns.</div>
        <div style="margin-top:4px"><strong>Paid-Only Import</strong> â€” use this when your Excel only has date + amount paid each month. We calculate principal, interest, inferred rate, and total from the loan amount and the payment rows in Excel.</div>
      </div>
    </div>
    <div id="emiSheetArea"></div>
    <div id="emiMappingArea"></div>
    <div id="emiImportPreview"></div>
  `);
  window._emiImportPreferredMode = preferredMode || '';
}
async function loadEmiSheets() {
  const file = document.getElementById('emiXlsxFile').files[0];
  if (!file) { toast('Please select a file first', 'warning'); return; }
  const password = document.getElementById('emiXlsxPass').value;
  document.getElementById('emiSheetArea').innerHTML = `<div style="color:var(--t3);font-size:13px;margin-bottom:10px">Reading fileâ€¦</div>`;
  document.getElementById('emiMappingArea').innerHTML = '';
  document.getElementById('emiImportPreview').innerHTML = '';
  const fd = new FormData();
  fd.append('file', file);
  if (password) fd.append('password', password);
  let res, data;
  try {
    res  = await fetch('/api/emi/import-excel/sheets', { method: 'POST', body: fd });
    data = await res.json();
  } catch (e) {
    document.getElementById('emiSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px">Network error: ${e.message}</p>`;
    return;
  }
  if (data.error) {
    document.getElementById('emiSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px">${escHtml(data.error)}</p>`;
    return;
  }
  const checkboxes = data.sheets.map((s, i) => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;cursor:pointer;background:var(--bg);margin-bottom:4px">
      <input type="checkbox" class="emi-sheet-cb" value="${escHtml(s)}" ${i===0?'checked':''} onchange="document.getElementById('emiMappingArea').innerHTML='';document.getElementById('emiImportPreview').innerHTML=''">
      <span style="font-size:13px">${escHtml(s)}</span>
    </label>`).join('');
  document.getElementById('emiSheetArea').innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:6px">SELECT SHEETS <span style="font-weight:400;color:var(--t3)">(check one or more)</span></div>
      ${checkboxes}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-s" onclick="loadEmiColumnMapping()">Detailed Import â†’</button>
      <button class="btn btn-s" onclick="loadEmiSimpleMapping()" title="You only have dates &amp; amounts paid â€” provide loan amount and rate, we calculate the rest">Calculate from Loan Amount â†’</button>
    </div>`;
  if (window._emiImportPreferredMode === 'simple') loadEmiSimpleMapping();
}

function _getSelectedEmiSheets() {
  return [...document.querySelectorAll('.emi-sheet-cb:checked')].map(cb => cb.value);
}

async function loadEmiColumnMapping() {
  const file = document.getElementById('emiXlsxFile').files[0];
  const sheets = _getSelectedEmiSheets();
  if (!file) return;
  if (sheets.length === 0) { toast('Select at least one sheet', 'warning'); return; }
  const password = document.getElementById('emiXlsxPass')?.value || '';
  document.getElementById('emiMappingArea').innerHTML = `<div style="color:var(--t3);font-size:13px;margin:10px 0">Reading columnsâ€¦</div>`;
  document.getElementById('emiImportPreview').innerHTML = '';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheet', sheets[0]);
  if (password) fd.append('password', password);
  const res  = await fetch('/api/emi/import-excel/headers', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) {
    document.getElementById('emiMappingArea').innerHTML = `<p style="color:var(--red);font-size:13px">${escHtml(data.error)}</p>`;
    return;
  }
  const cols = data.columns; // [{col, letter, header, sample}]
  const noneOpt = `<option value="0">â€” None / Skip â€”</option>`;
  const colOpts = (selected) => cols.map(c =>
    `<option value="${c.col}" ${c.col===selected?'selected':''}>${escHtml(c.letter)}: ${escHtml(c.header)}${c.sample?' ('+escHtml(c.sample)+')':''}</option>`
  ).join('');

  // default mapping â€” reset all to 0/unset
  const def = { srNo:0, date:0, principal:0, interest:0, gst:0, total:0, emiAmount:0, iPaid:0 };
  // auto-detect by header name (order matters: more specific checks first)
  cols.forEach(c => {
    const h = c.header.trim();
    if (/sr\.?\s*no/i.test(h))                                           def.srNo      = c.col;
    else if (/date/i.test(h))                                            def.date      = c.col;
    else if (/principal/i.test(h))                                       def.principal = c.col;
    else if (/interest/i.test(h) && !/gst/i.test(h))                    def.interest  = c.col;
    else if (/gst/i.test(h))                                             def.gst       = c.col;
    else if (/emi.*(amt|amount)/i.test(h) ||
             /total.*(with|w\/|incl|gst)/i.test(h) ||
             /\(\s*with\s*gst\s*\)/i.test(h))                            def.emiAmount = c.col;
    else if (/^total$/i.test(h) || /total.*(ex|excl|without|w\/o)/i.test(h)) def.total = c.col;
    else if (/i?\s*paid|amount\s*paid/i.test(h))                        def.iPaid     = c.col;
  });
  // fallback: if emiAmount not detected, try any "total" column
  if (!def.emiAmount && !def.total) {
    const tc = cols.find(c => /total/i.test(c.header));
    if (tc) def.emiAmount = tc.col;
  }

  const field = (id, label, required, selected, hint='') => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <label style="font-size:12px;color:var(--t2);width:130px;flex-shrink:0">${label}${required?'<span style="color:var(--red)"> *</span>':''}</label>
      <select id="emiMap_${id}" class="fi" style="flex:1;font-size:12px;padding:5px 8px">
        ${required?'':noneOpt}
        ${colOpts(selected)}
      </select>
      ${hint?`<span style="font-size:11px;color:var(--t3);white-space:nowrap">${hint}</span>`:''}
    </div>`;

  document.getElementById('emiMappingArea').innerHTML = `
    <div style="background:var(--bg3);border-radius:10px;padding:14px;margin:12px 0">
      <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:10px">MAP COLUMNS <span style="font-weight:400;color:var(--t3)">(from sheet: ${escHtml(sheets[0])})</span></div>
      ${field('srNo',      'Sr. No.',             false, def.srNo)}
      ${field('date',      'Date',                true,  def.date)}
      ${field('principal', 'Principal',           true,  def.principal)}
      ${field('interest',  'Interest',            false, def.interest,  'skip â†’ treated as 0')}
      ${field('gst',       'GST Amount',          false, def.gst,       'rate auto-read from header')}
      ${field('total',     'Total (ex-GST)',       false, def.total,     'principal + interest')}
      ${field('emiAmount', 'Total (with GST)',     false, def.emiAmount, 'used as EMI amount')}
      ${field('iPaid',     'Amount Paid',          false, def.iPaid)}
    </div>
    <div style="font-size:11px;color:var(--t3);margin:-6px 0 12px 0">* If "Total (with GST)" is not mapped, Total (ex-GST) + GST Amount will be used.</div>
    <button class="btn btn-s" onclick="previewEmiExcel()">Preview â†’</button>`;
}

function _getEmiMapping() {
  const ids = ['srNo','date','principal','interest','gst','total','emiAmount','iPaid'];
  const m = {};
  ids.forEach(id => {
    const el = document.getElementById('emiMap_' + id);
    if (el) m[id] = parseInt(el.value) || 0;
  });
  return m;
}

// â”€â”€â”€ SIMPLE IMPORT (loan amount + payment rows) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadEmiSimpleMapping() {
  const file   = document.getElementById('emiXlsxFile').files[0];
  const sheets = _getSelectedEmiSheets();
  if (!file) return;
  if (sheets.length === 0) { toast('Select at least one sheet', 'warning'); return; }
  const password = document.getElementById('emiXlsxPass')?.value || '';
  document.getElementById('emiMappingArea').innerHTML = `<div style="color:var(--t3);font-size:13px;margin:10px 0">Reading columnsâ€¦</div>`;
  document.getElementById('emiImportPreview').innerHTML = '';
  const fd = new FormData();
  fd.append('file', file); fd.append('sheet', sheets[0]);
  if (password) fd.append('password', password);
  const res  = await fetch('/api/emi/import-excel/headers', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) { document.getElementById('emiMappingArea').innerHTML = `<p style="color:var(--red);font-size:13px">${escHtml(data.error)}</p>`; return; }
  const cols = data.columns;
  const noneOpt = `<option value="0">â€” None / Skip â€”</option>`;
  const colOpts = (selected) => cols.map(c =>
    `<option value="${c.col}" ${c.col===selected?'selected':''}>${escHtml(c.letter)}: ${escHtml(c.header)}${c.sample?' ('+escHtml(c.sample)+')':''}</option>`
  ).join('');

  let defDate = 0, defSr = 0, defTotal = 0, defPaid = 0;
  cols.forEach(c => {
    const h = c.header.toLowerCase();
    if (/sr\.?\s*no/i.test(h))                   defSr   = c.col;
    else if (/date/i.test(h))                     defDate = c.col;
    else if (/total paid|amount paid|i paid/i.test(h)) defPaid = c.col;
    else if (/^total$|emi|installment|amount due/i.test(h)) defTotal = c.col;
  });

  const loanAmountInputs = sheets.length > 1
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        ${sheets.map((sheet, idx) => `
          <label style="font-size:12px;color:var(--t2)">Loan Amount for ${escHtml(sheet)} <span style="color:var(--red)">*</span>
            <input type="number" id="simLoanAmt_${idx}" class="fi sim-loan-amt" data-sheet="${escHtml(sheet)}" placeholder="e.g. 50000" min="1" style="margin-top:4px" oninput="_simpleEmiCalcPreview()">
          </label>`).join('')}
      </div>`
    : `<div style="display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:12px">
        <label style="font-size:12px;color:var(--t2)">Loan Amount (&#8377;) <span style="color:var(--red)">*</span>
          <input type="number" id="simLoanAmt" class="fi sim-loan-amt" data-sheet="__default__" placeholder="e.g. 50000" min="1" style="margin-top:4px" oninput="_simpleEmiCalcPreview()">
        </label>
      </div>`;

  document.getElementById('emiMappingArea').innerHTML = `
    <div style="background:var(--bg3);border-radius:10px;padding:14px;margin:12px 0">
      <div style="font-size:12px;font-weight:600;color:var(--t2);margin-bottom:12px">
        CALCULATE FROM LOAN AMOUNT
        <span style="font-weight:400;color:var(--t3);margin-left:6px">(from sheet: ${escHtml(sheets[0])})</span>
      </div>
      ${loanAmountInputs}
      <div id="simCalcHint" style="font-size:12px;color:var(--t3);margin-bottom:12px;min-height:18px"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <label style="font-size:12px;color:var(--t2);width:130px;flex-shrink:0">Sr. No.</label>
        <select id="simMap_sr" class="fi" style="flex:1;font-size:12px;padding:5px 8px">${noneOpt}${colOpts(defSr)}</select>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <label style="font-size:12px;color:var(--t2);width:130px;flex-shrink:0">Date <span style="color:var(--red)">*</span></label>
        <select id="simMap_date" class="fi" style="flex:1;font-size:12px;padding:5px 8px">${colOpts(defDate)}</select>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <label style="font-size:12px;color:var(--t2);width:130px;flex-shrink:0">Total <span style="color:var(--red)">*</span></label>
        <select id="simMap_total" class="fi" style="flex:1;font-size:12px;padding:5px 8px">${colOpts(defTotal || defPaid)}</select>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <label style="font-size:12px;color:var(--t2);width:130px;flex-shrink:0">Total Paid</label>
        <select id="simMap_paid" class="fi" style="flex:1;font-size:12px;padding:5px 8px">${noneOpt}${colOpts(defPaid)}</select>
      </div>
    </div>
    <button class="btn btn-s" onclick="previewEmiSimpleImport()">Preview â†’</button>`;
}

function _getSimpleLoanAmounts() {
  const amounts = {};
  document.querySelectorAll('.sim-loan-amt').forEach(input => {
    const key = input.getAttribute('data-sheet') || '__default__';
    const value = parseFloat(input.value);
    if (value > 0) amounts[key] = value;
  });
  return amounts;
}

function _simpleEmiCalcPreview() {
  const count = _getSelectedEmiSheets().length;
  const enteredCount = Object.keys(_getSimpleLoanAmounts()).length;
  const el = document.getElementById('simCalcHint');
  if (!el || enteredCount === 0) return;
  el.textContent = count > 1
    ? `Amounts entered: ${enteredCount}/${count}. We will infer the interest rate separately for each selected sheet using that sheet's payment rows.`
    : 'We will infer the interest rate from the Total column and use Total Paid only to decide which installments are already paid.';
}
async function previewEmiSimpleImport() {
  const file     = document.getElementById('emiXlsxFile').files[0];
  const sheets   = _getSelectedEmiSheets();
  const password = document.getElementById('emiXlsxPass')?.value || '';
  const forFriend = parseInt(document.getElementById('emiImportForFriend')?.value) || 0;
  const friendName = document.getElementById('emiImportFriendName')?.value?.trim() || '';
  const loanAmounts = _getSimpleLoanAmounts();
  const loanAmt  = loanAmounts.__default__ || Object.values(loanAmounts)[0];
  const dateCol  = document.getElementById('simMap_date')?.value || '2';
  const srCol    = document.getElementById('simMap_sr')?.value   || '0';
  const totalCol = document.getElementById('simMap_total')?.value || '0';
  const paidCol  = document.getElementById('simMap_paid')?.value || '0';
  if (!file || !loanAmt) { toast('Enter loan amount first', 'warning'); return; }
  if (!parseInt(totalCol)) { toast('Select the Total column', 'warning'); return; }
  if (sheets.length > 1 && sheets.some(sheet => !(parseFloat(loanAmounts[sheet]) > 0))) { toast('Enter loan amount for each selected sheet', 'warning'); return; }
  if (forFriend && !friendName) { toast('Enter friend name first', 'warning'); return; }
  if (sheets.length === 0) { toast('Select at least one sheet', 'warning'); return; }
  document.getElementById('emiImportPreview').innerHTML = `<div style="color:var(--t3);font-size:13px;margin:10px 0">Calculatingâ€¦</div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  fd.append('loan_amount', loanAmt);
  fd.append('loan_amounts', JSON.stringify(loanAmounts));
  fd.append('date_col', dateCol);
  fd.append('sr_col', srCol);
  fd.append('total_col', totalCol);
  fd.append('paid_col', paidCol);
  if (password) fd.append('password', password);
  const res  = await fetch('/api/emi/import-excel/simple-preview', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) { document.getElementById('emiImportPreview').innerHTML = `<p style="color:var(--red);font-size:13px">${escHtml(data.error)}</p>`; return; }
  const { results, errors } = data;
  let html = '';
  results.forEach(({ sheet, emiData, installments }) => {
    const paidCount = installments.filter(i => i.paid_amount >= i.emi_amount * 0.999).length;
    const allPaid   = paidCount === installments.length;
    const totalAmt  = installments.reduce((s, i) => s + i.emi_amount, 0);
    const totalInt  = installments.reduce((s, i) => s + i.interest_component, 0);
    const totalPr   = installments.reduce((s, i) => s + i.principal_component, 0);
    html += `
      <div style="background:var(--bg3);border-radius:10px;padding:14px;margin:8px 0;font-size:13px">
        ${sheets.length > 1 ? `<div style="font-size:11px;color:var(--t3);margin-bottom:4px">Sheet: ${escHtml(sheet)}</div>` : ''}
        <div style="font-weight:700;font-size:15px;margin-bottom:10px">${escHtml(emiData.name)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;color:var(--t2)">
          <div>Principal: <strong>${fmtCur(Math.round(totalPr*100)/100)}</strong></div>
          <div>Installments: <strong>${installments.length}</strong></div>
          <div>Status: <strong style="color:${allPaid?'var(--primary)':'var(--green)'}">${allPaid?'Completed':'Active'}</strong></div>
          <div>Paid: <strong style="color:var(--amber)">${paidCount} / ${installments.length}</strong></div>
          <div>Rate: <strong>${emiData.annual_rate}% p.a.</strong></div>
          <div>Monthly EMI: <strong>${fmtCur(installments[0]?.emi_amount||0)}</strong></div>
          <div>Total Interest: <strong>${fmtCur(Math.round(totalInt*100)/100)}</strong></div>
          <div>Start: <strong>${installments[0]?.due_date||'-'}</strong></div>
          <div>End: <strong>${installments[installments.length-1]?.due_date||'-'}</strong></div>
          <div style="grid-column:span 2">Grand Total: <strong>${fmtCur(Math.round(totalAmt*100)/100)}</strong></div>
        </div>
      </div>`;
  });
  errors.forEach(({ sheet, error }) => {
    html += `<div style="background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:10px 14px;margin:6px 0;font-size:13px;color:var(--red)"><b>${escHtml(sheet)}:</b> ${escHtml(error)}</div>`;
  });
  if (results.length > 0) {
    html += `<div class="fa" style="margin-top:10px">
      <button class="btn btn-p" onclick="doEmiSimpleImport()">Import ${results.length > 1 ? results.length + ' EMIs' : 'EMI'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`;
  }
  document.getElementById('emiImportPreview').innerHTML = html;
}

async function doEmiSimpleImport() {
  const file     = document.getElementById('emiXlsxFile').files[0];
  const sheets   = _getSelectedEmiSheets();
  const password = document.getElementById('emiXlsxPass')?.value || '';
  const forFriend = parseInt(document.getElementById('emiImportForFriend')?.value) || 0;
  const friendName = document.getElementById('emiImportFriendName')?.value?.trim() || '';
  const loanAmounts = _getSimpleLoanAmounts();
  const loanAmt  = loanAmounts.__default__ || Object.values(loanAmounts)[0];
  const dateCol  = document.getElementById('simMap_date')?.value || '2';
  const srCol    = document.getElementById('simMap_sr')?.value   || '0';
  const totalCol = document.getElementById('simMap_total')?.value || '0';
  const paidCol  = document.getElementById('simMap_paid')?.value || '0';
  if (!file) return;
  if (!loanAmt) { toast('Enter loan amount first', 'warning'); return; }
  if (!parseInt(totalCol)) { toast('Select the Total column', 'warning'); return; }
  if (sheets.length > 1 && sheets.some(sheet => !(parseFloat(loanAmounts[sheet]) > 0))) { toast('Enter loan amount for each selected sheet', 'warning'); return; }
  if (forFriend && !friendName) { toast('Enter friend name first', 'warning'); return; }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  fd.append('loan_amount', loanAmt);
  fd.append('loan_amounts', JSON.stringify(loanAmounts));
  fd.append('date_col', dateCol);
  fd.append('sr_col', srCol);
  fd.append('total_col', totalCol);
  fd.append('paid_col', paidCol);
  if (password)  fd.append('password', password);
  if (forFriend) fd.append('for_friend', '1');
  if (friendName) fd.append('friend_name', friendName);
  const res  = await fetch('/api/emi/import-excel/simple', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.success) {
    const count = data.imported || 1;
    toast(`${count} EMI${count>1?'s':''} imported successfully`, 'success');
    closeModal();
    if (forFriend) await loadFriendEmiTracker(); else await loadEmiTracker();
  } else {
    toast('Import failed: ' + (data.error || 'Unknown error'), 'error');
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function previewEmiExcel() {
  const file     = document.getElementById('emiXlsxFile').files[0];
  const sheets   = _getSelectedEmiSheets();
  const password = document.getElementById('emiXlsxPass')?.value || '';
  if (!file) return;
  if (sheets.length === 0) { toast('Select at least one sheet', 'warning'); return; }
  document.getElementById('emiImportPreview').innerHTML = `<div style="color:var(--t3);font-size:13px;margin:10px 0">Loading previewâ€¦</div>`;
  const mapping = _getEmiMapping();
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  if (password) fd.append('password', password);
  if (Object.keys(mapping).length) fd.append('mapping', JSON.stringify(mapping));
  const res  = await fetch('/api/emi/import-excel/preview', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) {
    document.getElementById('emiImportPreview').innerHTML = `<p style="color:var(--red);font-size:13px">${escHtml(data.error)}</p>`;
    return;
  }
  const { results, errors } = data;
  let html = '';
  results.forEach(({ sheet, emiData, installments }) => {
    const paidCount  = installments.filter(i => i.paid_amount >= i.emi_amount * 0.999).length;
    const allPaid    = paidCount === installments.length;
    const totalAmt   = installments.reduce((s, i) => s + i.emi_amount, 0);
    const totalGst   = installments.reduce((s, i) => s + (i.gst_amount || 0), 0);
    const totalExGst = totalAmt - totalGst;
    const hasGst     = totalGst > 0;
    html += `
      <div style="background:var(--bg3);border-radius:10px;padding:14px;margin:8px 0;font-size:13px">
        ${sheets.length > 1 ? `<div style="font-size:11px;color:var(--t3);margin-bottom:4px">Sheet: ${escHtml(sheet)}</div>` : ''}
        <div style="font-weight:700;font-size:15px;margin-bottom:10px">${escHtml(emiData.name)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;color:var(--t2)">
          <div>Installments: <strong>${installments.length}</strong></div>
          <div>Status: <strong style="color:${allPaid?'var(--primary)':'var(--green)'}">${allPaid?'Completed':'Active'}</strong></div>
          <div>Paid: <strong style="color:var(--amber)">${paidCount} / ${installments.length}</strong></div>
          <div>Rate: <strong>${emiData.annual_rate}% p.a.</strong></div>
          <div>Start: <strong>${installments[0]?.due_date||'-'}</strong></div>
          <div>End: <strong>${installments[installments.length-1]?.due_date||'-'}</strong></div>
          ${hasGst ? `
          <div>Total (ex-GST): <strong>${fmtCur(Math.round(totalExGst*100)/100)}</strong></div>
          <div>GST (${emiData.gst_rate}%): <strong>${fmtCur(Math.round(totalGst*100)/100)}</strong></div>
          <div style="grid-column:span 2">Grand Total (with GST): <strong>${fmtCur(Math.round(totalAmt*100)/100)}</strong></div>
          ` : `
          <div style="grid-column:span 2">Grand Total: <strong>${fmtCur(Math.round(totalAmt*100)/100)}</strong></div>
          `}
        </div>
      </div>`;
  });
  errors.forEach(({ sheet, error }) => {
    html += `<div style="background:rgba(239,68,68,0.07);border:1px solid rgba(239,68,68,0.25);border-radius:8px;padding:10px 14px;margin:6px 0;font-size:13px;color:var(--red)">
      <b>${escHtml(sheet)}:</b> ${escHtml(error)}</div>`;
  });
  if (results.length > 0) {
    html += `<div class="fa" style="margin-top:10px">
      <button class="btn btn-p" onclick="doEmiImport()">Import ${results.length > 1 ? results.length + ' EMIs' : 'EMI'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`;
  }
  document.getElementById('emiImportPreview').innerHTML = html;
}

async function doEmiImport() {
  const file      = document.getElementById('emiXlsxFile').files[0];
  const sheets    = _getSelectedEmiSheets();
  const password  = document.getElementById('emiXlsxPass')?.value || '';
  const forFriend = parseInt(document.getElementById('emiImportForFriend')?.value) || 0;
  const friendName = document.getElementById('emiImportFriendName')?.value?.trim() || '';
  if (!file) return;
  if (forFriend && !friendName) { toast('Enter friend name first', 'warning'); return; }
  const mapping = _getEmiMapping();
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  if (password)   fd.append('password', password);
  if (forFriend)  fd.append('for_friend', '1');
  if (friendName) fd.append('friend_name', friendName);
  if (Object.keys(mapping).length) fd.append('mapping', JSON.stringify(mapping));
  const res  = await fetch('/api/emi/import-excel', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.success) {
    const count = data.imported || 1;
    toast(`${count} EMI${count>1?'s':''} imported successfully`, 'success');
    closeModal();
    if (forFriend) await loadFriendEmiTracker(); else await loadEmiTracker();
  } else {
    toast('Import failed: ' + (data.error || 'Unknown error'), 'error');
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderEmiCard(r) {
  const isExpanded = String(_emiExpandedId) === String(r.id);
  const statusMeta = {
    active:    { color: 'var(--green)',   label: 'Active',      barColor: 'var(--green)',   bg: 'rgba(34,197,94,0.06)',   border: 'rgba(34,197,94,0.25)' },
    pending:   { color: '#6c8ebf',        label: 'Not Started', barColor: '#6c8ebf',        bg: 'rgba(108,142,191,0.07)', border: 'rgba(108,142,191,0.3)' },
    saved:     { color: 'var(--amber)',   label: 'Saved',       barColor: 'var(--amber)',   bg: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.25)' },
    completed: { color: 'var(--primary)', label: 'Completed',   barColor: 'var(--primary)', bg: 'rgba(22,163,74,0.05)',   border: 'rgba(22,163,74,0.2)' },
  };
  const sm = statusMeta[r.status] || { color: 'var(--t3)', label: r.status, barColor: 'var(--t3)', bg: '', border: '' };
  const progress = (r.status === 'active' || r.status === 'completed' || r.status === 'pending')
    ? Math.round((r.paidCount || 0) / r.tenure_months * 100) : null;
  let installmentsHtml = '';
  if (isExpanded) {
    if (r.status === 'active' || r.status === 'completed' || r.status === 'pending') installmentsHtml = renderEmiInstallments(r);
    else installmentsHtml = '<div style="text-align:center;padding:20px;color:var(--t3);font-size:13px">Activate this EMI to generate the installment schedule and start tracking payments.</div>';
  }

  return `<div class="emi-card" id="emiCard${r.id}" style="background:${sm.bg};border-color:${sm.border}">
    <div class="emi-card-header" onclick="_emiExpandedId=(String(_emiExpandedId)===String(${r.id})?null:${r.id});reRenderEmiCard(${r.id})" style="display:block">
      <div class="emi-card-top">
        <div class="emi-card-main">
          <div class="emi-card-title-row">
            <span class="emi-card-title">${escHtml(r.name)}</span>
            <span class="emi-card-badge" style="color:${sm.color};background:${sm.color}22">${sm.label}</span>
            ${r.friend_name ? '<span class="emi-card-badge emi-card-badge-blue">Friend: ' + escHtml(r.friend_name) + '</span>' : ''}
            ${r.tag ? '<span class="emi-card-badge emi-card-badge-muted">' + escHtml(r.tag) + '</span>' : ''}
          </div>
          ${r.description ? '<div class="emi-card-desc">' + escHtml(r.description) + '</div>' : ''}
        </div>
        <div class="emi-card-actions">
          ${r.status === 'saved' ? '<button class="btn btn-s btn-sm" onclick="event.stopPropagation();showActivateModal(' + r.id + ')">Activate</button>' : ''}
          <button class="btn btn-s btn-sm" title="Edit EMI info" onclick="event.stopPropagation();showEditEmiInfoModal(${r.id})">Edit</button>
          ${(!r.for_friend && (r.status === 'active' || r.status === 'pending')) ? (
            r.expenses_added
              ? '<button class="emi-action-pill emi-action-pill-green" title="Expenses added - click to re-add" onclick="event.stopPropagation();showAddEmiExpensesModal(' + r.id + ',1)">In Expenses</button>'
              : '<button class="btn btn-s btn-sm" title="Add installments to expenses" onclick="event.stopPropagation();showAddEmiExpensesModal(' + r.id + ',0)">Expenses</button>'
          ) : ''}
          ${(r.status === 'active' || r.status === 'pending' || r.status === 'completed') ? (
            r.credit_card_id
              ? '<button class="emi-action-pill emi-action-pill-blue" title="Added to credit card billing - click to change card" onclick="event.stopPropagation();showAddEmiToCreditCardModal(' + r.id + ',' + (r.credit_card_id || 0) + ',' + (r.gst_rate || 0) + ')">In Credit Card</button>'
              : '<button class="btn btn-s btn-sm" title="Add to credit card EMI billing" onclick="event.stopPropagation();showAddEmiToCreditCardModal(' + r.id + ',0,' + (r.gst_rate || 0) + ')">Card EMI</button>'
          ) : ''}
          ${r.status === 'active' ? (() => { const next = (r.installments||[]).find(i => i.paid_amount === 0); return next ? '<button class="btn btn-p btn-sm" onclick="event.stopPropagation();showPayInstallmentModal(' + next.id + ',' + next.emi_amount + ',' + r.id + ')">Pay #' + next.installment_no + '</button>' : ''; })() : ''}
          <button class="btn btn-s btn-sm" onclick="event.stopPropagation();downloadEmiDetailPdf(${r.id})">PDF</button>
          <button class="btn-del emi-card-delete" onclick="event.stopPropagation();deleteEmiRecord(${r.id})">Delete</button>
          <button
            class="btn btn-g btn-sm emi-card-toggle"
            title="${isExpanded ? 'Collapse details' : 'Expand details'}"
            onclick="event.stopPropagation();_emiExpandedId=(String(_emiExpandedId)===String(${r.id})?null:${r.id});reRenderEmiCard(${r.id})"
          >${isExpanded ? 'Hide' : 'Details'}</button>
        </div>
      </div>
      <div class="emi-card-meta">
        <span>Principal: <strong>${fmtCur(r.principal)}</strong></span>
        <span>Rate: <strong>${r.annual_rate}% p.a.</strong></span>
        <span>Tenure: <strong>${r.tenure_months} months</strong></span>
        <span>EMI: <strong class="emi-card-meta-highlight">${fmtCur(r.monthly_emi)}/mo</strong></span>
        ${(r.status === 'active' || r.status === 'pending') ? '<span>Paid: <strong>' + (r.paidCount || 0) + '/' + r.tenure_months + '</strong></span>' : ''}
      </div>
      ${progress !== null ? '<div class="emi-card-progress"><div class="emi-card-progress-track"><div class="emi-card-progress-fill" style="width:' + progress + '%;background:' + sm.barColor + ';"></div></div></div>' : ''}
    </div>
    ${isExpanded ? '<div class="emi-card-body">' + installmentsHtml + '</div>' : ''}
  </div>`;
}
async function showAddEmiToCreditCardModal(emiId, currentCardId = 0, gstRate = 0) {
  const data = await api('/api/cc/cards');
  const cards = data?.cards || [];
  if (!cards.length) {
    toast('Add a credit card first', 'warning');
    return;
  }
  const options = cards.map(c =>
    `<option value="${c.id}" ${(parseInt(currentCardId) === c.id) ? 'selected' : ''}>${escHtml(c.card_name)}${c.bank_name ? ' - ' + escHtml(c.bank_name) : ''}${c.last4 ? ' (' + escHtml(c.last4) + ')' : ''}</option>`
  ).join('');
  openModal('Add To Credit Card EMIs', `
    <div style="color:var(--t2);font-size:13px;line-height:1.5;margin-bottom:14px">
      We will add this EMI into the matching monthly billing cycles for the selected credit card. Missing cycles will be created automatically, and existing EMI entries for this loan will be refreshed instead of duplicated.
    </div>
    <label class="fl full">Credit Card
      <select id="emiCcLinkCard" class="fi">${options}</select>
    </label>
    ${gstRate > 0 ? `
    <label class="fl full" style="margin-top:12px">GST Billing Month
      <select id="emiCcLinkGstOffset" class="fi">
        <option value="0">Same billing month</option>
        <option value="1">Next billing month</option>
      </select>
    </label>` : ''}
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="doAddEmiToCreditCard(${emiId})">Save</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>
  `);
}

async function doAddEmiToCreditCard(emiId) {
  const credit_card_id = parseInt(document.getElementById('emiCcLinkCard')?.value) || 0;
  const gst_month_offset = parseInt(document.getElementById('emiCcLinkGstOffset')?.value) || 0;
  if (!credit_card_id) { toast('Select a credit card', 'warning'); return; }
  const res = await api('/api/emi/records/' + emiId + '/add-credit-card', {
    method: 'POST',
    body: { credit_card_id, gst_month_offset }
  });
  if (res?.success) {
    closeModal();
    toast('EMI added to credit card billing', 'success');
    if (currentTab === 'friendemis') await loadFriendEmiTracker();
    else await loadEmiTracker();
  } else {
    toast(res?.error || 'Failed to add EMI to credit card billing', 'error');
  }
}
function renderEmiInstallments(r) {
  if (!r.installments || r.installments.length === 0) {
    return '<div style="text-align:center;padding:24px;color:var(--t3);font-size:13px">No installments found</div>';
  }
  const shortDate = (val) => {
    if (!val) return '-';
    return String(val).slice(0, 10);
  };
  const today = new Date().toISOString().slice(0, 10);
  const rows = r.installments.map(inst => {
    const dueDate = shortDate(inst.due_date);
    const isPaid = inst.paid_amount > 0;
    const isOverdue = !isPaid && dueDate < today;
    let rowStyle = '';
    if (isPaid) rowStyle = 'background:rgba(34,197,94,0.07)';
    else if (isOverdue) rowStyle = 'background:rgba(239,68,68,0.07)';

    const isManual = inst.principal_component < 0 || inst.interest_component < 0;
    const gstCell = r.gst_rate > 0 ? '<td class="td-m" style="color:var(--t3)">' + (isManual ? 'â€”' : (inst.gst_amount || 0).toFixed(2)) + '</td>' : '';
    const emiCell = isPaid
      ? '<span style="font-weight:700">' + inst.emi_amount.toFixed(2) + '</span>'
      : '<span style="font-weight:700">' + inst.emi_amount.toFixed(2) + '</span> <button class="inst-edit-btn" title="Edit amount" onclick="showEditInstallmentModal(' + inst.id + ',' + inst.emi_amount + ',' + r.id + ')">Edit</button>';
    const statusCell = isPaid
      ? '<span style="color:var(--green);font-size:12px;font-weight:600">&#10003; ' + fmtCur(inst.paid_amount) + '<br><span style="font-size:10px;color:var(--t3)">' + (inst.paid_date || '') + '</span></span>'
      : '<button class="btn btn-p btn-sm" onclick="showPayInstallmentModal(' + inst.id + ',' + inst.emi_amount + ',' + r.id + ')">Pay</button>';

    const princCell = isManual ? '<td class="td-m" style="color:var(--t3)">â€”</td>' : '<td class="td-m">' + inst.principal_component.toFixed(2) + '</td>';
    const intCell   = isManual ? '<td class="td-m" style="color:var(--t3)">â€”</td>' : '<td class="td-m">' + inst.interest_component.toFixed(2) + '</td>';

    return '<tr style="' + rowStyle + '">' +
      '<td style="text-align:center;white-space:nowrap">' + statusCell + '</td>' +
      '<td style="text-align:center;font-weight:600;font-family:var(--mono)">' + inst.installment_no + '</td>' +
      '<td style="text-align:center;font-size:12px">' + dueDate + '</td>' +
      princCell + intCell +
      gstCell +
      '<td class="td-m">' + emiCell + '</td>' +
      '</tr>';
  }).join('');

  const totalPaid = r.installments.reduce((s, i) => s + (i.paid_amount || 0), 0);
  const remaining = r.grand_total - totalPaid;
  const gstHeader = r.gst_rate > 0 ? '<th style="text-align:right">GST</th>' : '';

  const unpaidCount = r.installments.filter(i => i.paid_amount === 0).length;

  return `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:12px;padding:12px;background:var(--bg);border-radius:8px">
      <span style="font-size:12px;color:var(--t2)">Total: <strong>${fmtCur(r.grand_total)}</strong></span>
      <span style="font-size:12px;color:var(--green)">Paid: <strong>${fmtCur(totalPaid)}</strong></span>
      <span style="font-size:12px;color:var(--amber)">Remaining: <strong>${fmtCur(remaining)}</strong></span>
      <span style="font-size:12px;color:var(--t2)">Start: <strong>${shortDate(r.start_date)}</strong></span>
      <div style="margin-left:auto;display:flex;gap:6px">
        ${unpaidCount > 0 ? `<button class="btn btn-s btn-sm" onclick="showBulkEditModal(${r.id},${r.monthly_emi},${unpaidCount})">Bulk Edit (${unpaidCount} unpaid)</button>` : ''}
        <button class="btn btn-s btn-sm" onclick="showEditEmiInfoModal(${r.id})">Edit Info</button>
      </div>
    </div>
    <div style="overflow-x:auto"><table style="min-width:900px">
      <thead><tr>
        <th>Pay</th><th>#</th><th>Due Date</th><th style="text-align:right">Principal</th><th style="text-align:right">Interest</th>
        ${gstHeader}
        <th style="text-align:right">EMI</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

async function reRenderEmiCard(id) {
  const isFriend = currentTab === 'friendemis';
  const store    = isFriend ? _friendEmiRecords : _emiRecords;
  const expId    = isFriend ? _friendEmiExpandedId : _emiExpandedId;
  const sameId = (a, b) => String(a) === String(b);
  if (sameId(expId, id)) {
    const data = await api('/api/emi/records/' + id);
    if (!data) return;
    const r = data.record || data;
    const idx = store.findIndex(x => sameId(x.id, id));
    if (idx >= 0) store[idx] = r;
  }
  const r = store.find(x => sameId(x.id, id));
  if (!r) return;
  const el = document.getElementById('emiCard' + r.id) || document.getElementById('emiCard' + id);
  if (el) el.outerHTML = renderEmiCard(r);
}

async function showActivateModal(id) {
  const today = new Date().toISOString().slice(0, 10);
  const isFriend = currentTab === 'friendemis';
  if (!isFriend && !_expenseCategories.length) await loadExpenseCategories();
  const expensesSection = isFriend ? '' :
    '<label class="fl" style="flex-direction:row;align-items:center;gap:8px;margin-top:12px">' +
    '<input type="checkbox" id="emiAddExpenses" checked style="width:auto;margin:0" onchange="_emiExpTypeToggle()"> Add installments to Expenses</label>' +
    '<div id="emiExpTypeWrap" style="margin-top:10px">' +
    '<label class="fl">Expense Type<select class="fi" id="emiExpType">' +
    '<option value="0">Fair (Essential)</option><option value="1">Extra (Discretionary)</option>' +
    '</select></label>' +
    '<label class="fl">Expense Category' + expenseCategoryDatalistHtml('') + '</label></div>';
  showModal('<div class="modal-title">Activate EMI</div>' +
    '<p style="color:var(--t2);font-size:14px;margin-bottom:16px">Choose start date to generate the installment schedule.</p>' +
    '<label class="fl">Start Date<input class="fi" type="date" id="emiStartDate" value="' + today + '"></label>' +
    expensesSection +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p" onclick="doActivateEmiTracker(' + id + ')">Activate</button>' +
    '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
    '</div>');
}

async function doActivateEmiTracker(id) {
  const start_date = document.getElementById('emiStartDate').value;
  if (!start_date) { toast('Pick a start date', 'warning'); return; }
  const isFriend = currentTab === 'friendemis';
  const add_expenses = !isFriend && document.getElementById('emiAddExpenses')?.checked;
  const expense_type = add_expenses ? parseInt(document.getElementById('emiExpType').value) : 0;
  const expense_category = add_expenses ? (document.getElementById('eCategory')?.value.trim() || null) : null;
  const r = await api('/api/emi/records/' + id + '/activate', { method: 'POST', body: { start_date, add_expenses, expense_type, expense_category } });
  if (r?.success) {
    closeModal();
    toast('Activated! Installments created.', 'success');
    if (isFriend) await loadFriendEmiTracker(); else await loadEmiTracker();
  } else toast(r?.error || 'Failed', 'error');
}

function showPayInstallmentModal(instId, emiAmt, emiId) {
  const today = new Date().toISOString().slice(0, 10);
  showModal('<div class="modal-title">Mark Installment Paid</div>' +
    '<div class="fg">' +
    '<label class="fl">Amount Paid (&#8377;)<input class="fi" type="number" id="payAmt" value="' + emiAmt + '" step="0.01"></label>' +
    '<label class="fl">Payment Date<input class="fi" type="date" id="payDate" value="' + today + '"></label>' +
    '</div>' +
    '<label class="fl" style="margin-top:8px">Notes (optional)<input class="fi" type="text" id="payNotes" placeholder="e.g. Paid via NEFT"></label>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p" onclick="doPayInstallment(' + instId + ',' + emiId + ')">Mark Paid</button>' +
    '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
    '</div>');
}

async function doPayInstallment(instId, emiId) {
  const paid_amount = parseFloat(document.getElementById('payAmt').value);
  const paid_date = document.getElementById('payDate').value;
  const notes = document.getElementById('payNotes').value.trim();
  if (!paid_amount || !paid_date) { toast('Fill all fields', 'warning'); return; }
  const r = await api('/api/emi/installments/' + instId + '/pay', { method: 'PUT', body: { paid_amount, paid_date, notes } });
  if (r?.success) {
    closeModal();
    toast('Installment marked paid!', 'success');
    if (currentTab === 'friendemis') _friendEmiExpandedId = emiId;
    else _emiExpandedId = emiId;
    await reRenderEmiCard(emiId);
  } else toast(r?.error || 'Failed', 'error');
}

async function deleteEmiRecord(id) {
  if (!await confirmDialog('Delete this EMI record? All installments will also be deleted.')) return;
  const r = await api('/api/emi/records/' + id, { method: 'DELETE' });
  if (r?.success) {
    toast('Deleted', 'success');
    if (currentTab === 'friendemis') {
      _friendEmiRecords = _friendEmiRecords.filter(x => x.id !== id);
      if (_friendEmiExpandedId === id) _friendEmiExpandedId = null;
      renderFriendEmiTracker();
    } else {
      _emiRecords = _emiRecords.filter(x => x.id !== id);
      if (_emiExpandedId === id) _emiExpandedId = null;
      renderEmiTracker();
    }
  } else toast(r?.error || 'Failed', 'error');
}

function _emiExpTypeToggle() {
  const wrap = document.getElementById('emiExpTypeWrap');
  if (wrap) wrap.style.display = document.getElementById('emiAddExpenses').checked ? '' : 'none';
}

async function showAddEmiExpensesModal(id, alreadyAdded) {
  if (!_expenseCategories.length) await loadExpenseCategories();
  const warning = alreadyAdded
    ? '<p style="color:var(--amber);font-size:13px;margin-bottom:12px">âš  Expenses are already added. Adding again will replace all existing entries.</p>'
    : '';
  showModal('<div class="modal-title">Add to Expenses</div>' +
    warning +
    '<label class="fl">Expense Type<select class="fi" id="emiExpType">' +
    '<option value="0">Fair (Essential)</option><option value="1">Extra (Discretionary)</option>' +
    '</select></label>' +
    '<label class="fl">Expense Category' + expenseCategoryDatalistHtml('') + '</label>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p" onclick="doAddEmiExpenses(' + id + ')">Add to Expenses</button>' +
    '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
    '</div>');
}

async function doAddEmiExpenses(id) {
  const expense_type = parseInt(document.getElementById('emiExpType').value);
  const expense_category = document.getElementById('eCategory')?.value.trim() || null;
  const r = await api('/api/emi/records/' + id + '/add-expenses', { method: 'POST', body: { expense_type, expense_category } });
  if (r?.success) {
    closeModal();
    const rec = _emiRecords.find(x => String(x.id) === String(id));
    if (rec) rec.expenses_added = 1;
    reRenderEmiCard(id);
    toast('Expenses added successfully', 'success');
  } else toast(r?.error || 'Failed', 'error');
}

// â”€â”€ Individual installment amount edit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showEditInstallmentModal(instId, currentAmt, emiId) {
  const rec = _emiRecords.find(x => x.id === emiId);
  const inst = rec?.installments?.find(i => i.id === instId);
  const interest = inst?.interest_component || 0;
  const currentPrinc = inst?.principal_component || 0;
  showModal(
    '<div class="modal-title">Edit Installment #' + (inst?.installment_no || '') + '</div>' +
    '<label class="fl" style="flex-direction:row;align-items:center;gap:8px;margin-bottom:14px">' +
    '<input type="checkbox" id="instAutoEmi" checked style="width:auto;margin:0" onchange="instToggleMode()"> Auto-calculate EMI from Interest + Principal</label>' +
    '<div class="fg">' +
    '<label class="fl">Interest (&#8377;)<input class="fi" type="number" id="editInstInterest" value="' + interest.toFixed(2) + '" step="0.01" oninput="instLive()"></label>' +
    '<label class="fl">Principal (&#8377;)<input class="fi" type="number" id="editInstPrinc" value="' + currentPrinc.toFixed(2) + '" step="0.01" oninput="instLive()"></label>' +
    '</div>' +
    '<label class="fl" style="margin-top:8px">EMI Amount (&#8377;)<input class="fi" type="number" id="editInstAmt" value="' + currentAmt.toFixed(2) + '" step="0.01" min="1" oninput="instEmiLive()" readonly style="background:var(--bg);color:var(--t3)"></label>' +
    '<div id="editInstPreview" style="background:var(--bg);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--t2);margin-top:4px"></div>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p" onclick="doEditInstallment(' + instId + ',' + emiId + ')">Save</button>' +
    '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
    '</div>'
  );
}

function instToggleMode() {
  const auto = document.getElementById('instAutoEmi').checked;
  const emiEl = document.getElementById('editInstAmt');
  const intEl = document.getElementById('editInstInterest');
  const prEl = document.getElementById('editInstPrinc');
  if (auto) {
    emiEl.readOnly = true; emiEl.style.background = 'var(--bg)'; emiEl.style.color = 'var(--t3)';
    intEl.readOnly = false; intEl.style.background = ''; intEl.style.color = '';
    prEl.readOnly = false; prEl.style.background = ''; prEl.style.color = '';
    instLive();
  } else {
    emiEl.readOnly = false; emiEl.style.background = ''; emiEl.style.color = '';
    intEl.readOnly = true; intEl.style.background = 'var(--bg)'; intEl.style.color = 'var(--t3)';
    prEl.readOnly = true; prEl.style.background = 'var(--bg)'; prEl.style.color = 'var(--t3)';
    instEmiLive();
  }
}

function instLive() {
  const i = parseFloat(document.getElementById('editInstInterest').value) || 0;
  const p = parseFloat(document.getElementById('editInstPrinc').value) || 0;
  const emi = Math.round((i + p) * 100) / 100;
  document.getElementById('editInstAmt').value = emi.toFixed(2);
  document.getElementById('editInstPreview').innerHTML = 'EMI = ' + i.toFixed(2) + ' + ' + p.toFixed(2) + ' = <strong>' + emi.toFixed(2) + '</strong>';
}

function instEmiLive() {
  const i = parseFloat(document.getElementById('editInstInterest').value) || 0;
  const emi = parseFloat(document.getElementById('editInstAmt').value) || 0;
  const p = Math.round((emi - i) * 100) / 100;
  const el = document.getElementById('editInstPreview');
  el.innerHTML = 'Principal = <strong>' + p.toFixed(2) + '</strong>' +
    (p < 0 ? ' <span style="color:var(--red)">(EMI less than interest)</span>' : '');
}

async function doEditInstallment(instId, emiId) {
  const auto = document.getElementById('instAutoEmi').checked;
  const interest_component = parseFloat(document.getElementById('editInstInterest').value) || 0;
  const emi_amount = parseFloat(document.getElementById('editInstAmt').value);
  if (!emi_amount || emi_amount <= 0) { toast('Enter a valid amount', 'warning'); return; }
  let principal_component;
  if (auto) {
    principal_component = parseFloat(document.getElementById('editInstPrinc').value) || 0;
  } else {
    principal_component = Math.round((emi_amount - interest_component) * 100) / 100;
    if (principal_component < 0) { toast('EMI cannot be less than interest (' + fmtCur(interest_component) + ')', 'error'); return; }
  }
  const r = await api('/api/emi/installments/' + instId + '/components', { method: 'PUT', body: { emi_amount, interest_component, principal_component } });
  if (r?.success) {
    closeModal();
    toast('Installment updated', 'success');
    _emiExpandedId = emiId;
    await reRenderEmiCard(emiId);
  } else toast(r?.error || 'Failed', 'error');
}

// â”€â”€ Bulk edit all unpaid installments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showBulkEditModal(emiId, currentAmt, unpaidCount) {
  showModal(
    '<div class="modal-title">Bulk Edit EMI Amount</div>' +
    '<p style="color:var(--t2);font-size:13px;margin-bottom:4px">Set a single EMI amount for all <strong>' + unpaidCount + ' unpaid</strong> installments.</p>' +
    '<p style="color:var(--t3);font-size:12px;margin-bottom:16px">Already paid installments will not be affected.</p>' +
    '<label class="fl">New EMI Amount (&#8377;)<input class="fi" type="number" id="bulkInstAmt" value="' + currentAmt + '" step="0.01" min="1"></label>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p" onclick="doBulkEditInstallment(' + emiId + ')">Apply to All Unpaid</button>' +
    '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
    '</div>'
  );
}

async function doBulkEditInstallment(emiId) {
  const emi_amount = parseFloat(document.getElementById('bulkInstAmt').value);
  if (!emi_amount || emi_amount <= 0) { toast('Enter a valid amount', 'warning'); return; }
  const r = await api('/api/emi/records/' + emiId + '/bulk-amount', { method: 'PUT', body: { emi_amount } });
  if (r?.success) {
    closeModal();
    toast('All unpaid installments updated', 'success');
    _emiExpandedId = emiId;
    await reRenderEmiCard(emiId);
  } else toast(r?.error || 'Failed', 'error');
}

// â”€â”€ Edit EMI record info (name, desc, tag) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showEditEmiInfoModal(emiId) {
  const rec = (_emiRecords || []).find(x => String(x.id) === String(emiId))
    || (_friendEmiRecords || []).find(x => String(x.id) === String(emiId));
  if (!rec) return;
  showModal(
    '<div class="modal-title">Edit EMI Info</div>' +
    '<div class="fg">' +
    '<label class="fl" style="flex:2">Loan Name<input class="fi" type="text" id="editEmiName" value="' + escHtml(rec.name) + '"></label>' +
    '<label class="fl">Tag / Group<input class="fi" type="text" id="editEmiTag" value="' + escHtml(rec.tag || '') + '"></label>' +
    '</div>' +
    '<label class="fl" style="margin-top:8px">Description<input class="fi" type="text" id="editEmiDesc" value="' + escHtml(rec.description || '') + '"></label>' +
    '<label class="fl" style="flex-direction:row;align-items:center;gap:8px;margin-top:12px">' +
    '<input type="checkbox" id="editEmiPlannerAdvance" ' + (rec.planner_advance_month ? 'checked' : '') + ' style="width:auto;margin:0">' +
    '<span>Show next month\'s EMI one month earlier in Planner</span></label>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p" onclick="doEditEmiInfo(' + emiId + ')">Save</button>' +
    '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
    '</div>'
  );
}

async function doEditEmiInfo(emiId) {
  const name = document.getElementById('editEmiName').value.trim();
  if (!name) { toast('Name is required', 'warning'); return; }
  const tag = document.getElementById('editEmiTag').value.trim();
  const description = document.getElementById('editEmiDesc').value.trim();
  const planner_advance_month = document.getElementById('editEmiPlannerAdvance').checked ? 1 : 0;
  const r = await api('/api/emi/records/' + emiId, { method: 'PUT', body: { name, tag, description, planner_advance_month } });
  if (r?.success) {
    closeModal();
    toast('Updated', 'success');
    await loadEmiTracker();
  } else toast(r?.error || 'Failed', 'error');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CREDIT CARDS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let _ccCards = [];
let _ccSelectedCardId = null;
let _ccView = 'current'; // 'current' | 'history' | 'monthly' | 'yearly'
let _ccYearFilter = new Date().getFullYear();
let _ccMonthlyYear = new Date().getFullYear();
let _ccHistoryCycles = [];

function _sameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function _findCcCardById(cardId) {
  return (_ccCards || []).find((card) => _sameId(card.id, cardId)) || null;
}

function _findCcTxnInCycles(cycles, txnId) {
  for (const cycle of (cycles || [])) {
    const txn = (cycle.txns || []).find((item) => _sameId(item.id, txnId));
    if (txn) return { cycle, txn };
  }
  return null;
}

async function loadCreditCards() {
  document.getElementById('main').innerHTML = '<div class="tab-content"><div style="color:var(--t3);padding:40px;text-align:center">Loading...</div></div>';
  const data = await api('/api/cc/cards');
  _ccCards = data?.cards || [];
  renderCcList();
}

function renderCcList() {
  const cards = _ccCards;

  const cardGrid = cards.length ? cards.map(c => renderCcCardTile(c)).join('') :
    `<div style="color:var(--t3);text-align:center;padding:40px;background:var(--white);border-radius:16px;border:2px dashed var(--border)">
      <div style="font-size:32px;margin-bottom:12px">&#128179;</div>
      <div style="font-weight:600;margin-bottom:6px">No credit cards added yet</div>
      <div style="font-size:13px">Click "Add Card" to get started</div>
    </div>`;

  let totalDue = 0, totalSpentAll = 0;
  cards.forEach(c => {
    if (c.currentCycle) totalDue += Number(c.currentCycle.net_payable) || 0;
    totalSpentAll += Number(c.totalSpent) || 0;
  });

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="margin-bottom:20px">
        <div class="summary-top">
          <div>
            <div class="summary-label">CURRENT CYCLE DUE (ALL CARDS)</div>
            <div class="summary-amount">${fmtCur(totalDue)}</div>
            <div class="summary-words">Total spent ever: ${fmtCur(totalSpentAll)}</div>
          </div>
          <div class="count-box"><div class="num">${cards.length}</div><div class="lbl">cards</div></div>
        </div>
      </div>

      <div class="cc-list-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700">My Credit Cards</div>
        <div class="cc-list-head-actions" style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadCreditCardsPdf()">PDF</button>
          <button class="btn btn-p btn-sm" onclick="showCcCardModal()">+ Add Card</button>
        </div>
      </div>

      <div class="cc-card-grid">${cardGrid}</div>
    </div>`;
}

function renderCcCardTile(c) {
  const cycle = c.currentCycle;
  const spent = cycle ? cycle.net_payable : 0;
  const limit = c.credit_limit || 0;
  const usePct = limit > 0 ? Math.min(100, Math.round(spent / limit * 100)) : 0;
  const expiry = c.expiry_month && c.expiry_year ? `${String(c.expiry_month).padStart(2,'0')}/${c.expiry_year}` : '-';
  const dueDate = cycle?.due_date ? fmtDate(cycle.due_date) : '-';
  const dueBadge = cycle?.status === 'billed'
    ? `<span class="cc-badge cc-badge-due">Bill Due ${dueDate}</span>`
    : cycle?.status === 'paid'
    ? `<span class="cc-badge cc-badge-paid">Paid</span>`
    : `<span class="cc-badge cc-badge-open">Due ${dueDate}</span>`;

  return `<div class="cc-tile" onclick="openCcDetail(${c.id})">
    <div class="cc-tile-header">
      <div>
        <div class="cc-tile-name">${escHtml(c.card_name)}</div>
        <div class="cc-tile-bank">${escHtml(c.bank_name)} **** ${escHtml(c.last4)}</div>
      </div>
      <div class="cc-tile-expiry">Exp ${expiry}</div>
    </div>
    <div class="cc-tile-amount">${fmtCur(spent)}</div>
    <div class="cc-tile-label">This Billing Cycle ${c.default_discount_pct > 0 ? '<span class="cc-disc-tag">'+c.default_discount_pct+'% off</span>' : ''}</div>
    ${limit > 0 ? `<div class="cc-limit-bar"><div class="cc-limit-fill" style="width:${usePct}%"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.6);margin-top:4px"><span>${usePct}% used</span><span>Limit ${fmtCur(limit)}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
      ${dueBadge}
      <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
        <button class="cc-action-btn" onclick="showCcCardModal(${c.id})">Edit</button>
        <button class="cc-action-btn cc-action-del" onclick="deleteCcCard(${c.id})">Delete</button>
      </div>
    </div>
  </div>`;
}

async function openCcDetail(cardId) {
  _ccSelectedCardId = cardId;
  _ccView = 'current';
  await renderCcDetail();
}

async function renderCcDetail() {
  const cardId = _ccSelectedCardId;
  document.getElementById('main').innerHTML = '<div class="tab-content"><div style="color:var(--t3);padding:40px;text-align:center">Loading...</div></div>';

  const [mainData, yearsData] = await Promise.all([
    api(`/api/cc/cards/${cardId}/current`),
    api(`/api/cc/cards/${cardId}/years`),
  ]);
  if (!mainData) { loadCreditCards(); return; }

  const card = mainData.card;
  const cycle = mainData.cycle;
  const txns  = mainData.txns || [];
  const availYears = yearsData?.years || [];

  // Sub-tabs
  const tabs = [
    ['current', 'Current Cycle'],
    ['history', 'Billing History'],
    ['monthly', 'Monthly View'],
    ['yearly',  'Yearly View'],
  ];
  const tabHtml = tabs.map(([k,l]) =>
    `<button class="chip ${_ccView===k?'active':''}" onclick="_ccView='${k}';renderCcDetail()">${l}</button>`
  ).join('');

  let bodyHtml = '';
  if (_ccView === 'current') {
    bodyHtml = renderCcCurrentCycle(card, cycle, txns);
  } else if (_ccView === 'history') {
    const hData = await api(`/api/cc/cards/${cardId}/cycles`);
    _ccHistoryCycles = hData?.cycles || [];
    bodyHtml = renderCcHistory(_ccHistoryCycles);
  } else if (_ccView === 'monthly') {
    // Default to most recent year with data if none selected or if out of range
    if (!availYears.includes(_ccMonthlyYear) && availYears.length) _ccMonthlyYear = availYears[0];
    const mData = await api(`/api/cc/cards/${cardId}/monthly?year=${_ccMonthlyYear}`);
    bodyHtml = renderCcMonthly(mData?.months || [], availYears);
  } else if (_ccView === 'yearly') {
    const yData = await api(`/api/cc/cards/${cardId}/yearly`);
    bodyHtml = renderCcYearly(yData?.years || []);
  }

  const expiry = card.expiry_month && card.expiry_year ? `${String(card.expiry_month).padStart(2,'0')}/${card.expiry_year}` : '-';

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="cc-detail-head" style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
        <button class="btn btn-g btn-sm" onclick="loadCreditCards()">&larr; Back</button>
        <div class="cc-detail-copy" style="flex:1">
          <div style="font-size:18px;font-weight:700">${escHtml(card.card_name)}</div>
          <div style="font-size:12px;color:var(--t2)">${escHtml(card.bank_name)} **** ${escHtml(card.last4)} &nbsp;&middot;&nbsp; Expires ${expiry} &nbsp;&middot;&nbsp; Bill on day ${card.bill_gen_day} &nbsp;&middot;&nbsp; Due ${card.due_days} days after</div>
        </div>
        <button class="btn btn-s btn-sm" onclick="showCcCardModal(${card.id})">Edit Card</button>
      </div>

      <div class="chip-group" style="margin-bottom:20px">${tabHtml}</div>

      ${bodyHtml}
    </div>`;
}

function renderCcCurrentCycle(card, cycle, txns) {
  if (!cycle) return `<div style="color:var(--t3);text-align:center;padding:40px">No active billing cycle found.</div>`;

  const totalAmt = cycle.total_amount || 0;
  const totalDisc = cycle.total_discount || 0;
  const netPay = cycle.net_payable || 0;

  const txnRows = txns.length
    ? txns.map(t => {
        const srcBadge = t.source !== 'manual'
          ? `<span class="cc-src-badge">${t.source}</span>` : '';
        return `<tr>
          <td>${fmtDate(t.txn_date)}</td>
          <td>${escHtml(t.description)} ${srcBadge}</td>
          <td class="td-m">${fmtCur(t.amount)}</td>
          <td class="td-m" style="color:var(--green)">${t.discount_pct > 0 ? t.discount_pct + '%' : '-'}</td>
          <td class="td-m" style="color:var(--green)">${t.discount_amount > 0 ? fmtCur(t.discount_amount) : '-'}</td>
          <td class="td-m" style="font-weight:700">${fmtCur(t.net_amount)}</td>
          <td style="text-align:right">
            <button class="btn-d" style="color:var(--em)" onclick="showCcTxnModal(${card.id},${t.id})">Edit</button>
            <button class="btn-d" onclick="deleteCcTxn(${t.id})">Del</button>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" class="empty-td">No transactions this cycle. Add one below.</td></tr>`;
  const txnCards = txns.length
    ? txns.map((t) => {
        const srcBadge = t.source !== 'manual'
          ? `<span class="cc-src-badge">${t.source}</span>` : '';
        return `<div class="cc-txn-card">
          <div class="cc-txn-card-head">
            <div class="cc-txn-card-copy">
              <div class="cc-txn-card-title">${escHtml(t.description)} ${srcBadge}</div>
              <div class="cc-txn-card-date">${fmtDate(t.txn_date)}</div>
            </div>
            <div class="cc-txn-card-amount">${fmtCur(t.net_amount)}</div>
          </div>
          <div class="cc-txn-card-meta">
            <span>Amount: <b>${fmtCur(t.amount)}</b></span>
            <span>Disc%: <b>${t.discount_pct > 0 ? `${t.discount_pct}%` : '-'}</b></span>
            <span>Discount: <b>${t.discount_amount > 0 ? fmtCur(t.discount_amount) : '-'}</b></span>
          </div>
          <div class="cc-txn-card-actions">
            <button class="btn btn-g btn-sm" onclick="showCcTxnModal(${card.id},${t.id})">Edit</button>
            <button class="btn btn-g btn-sm" style="color:var(--red)" onclick="deleteCcTxn(${t.id})">Delete</button>
          </div>
        </div>`;
      }).join('')
    : `<div class="cc-empty-card">No transactions this cycle. Add one below.</div>`;

  return `
    <div class="cc-cycle-summary">
      <div class="cc-cycle-stat"><div class="lbl">Cycle Period</div><div class="val">${fmtDate(cycle.cycle_start)} to ${fmtDate(cycle.cycle_end)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Payment Due</div><div class="val" style="color:var(--amber);font-weight:700">${fmtDate(cycle.due_date)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Total Spent</div><div class="val">${fmtCur(totalAmt)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Total Discount</div><div class="val" style="color:var(--green)">- ${fmtCur(totalDisc)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Net Payable</div><div class="val hl">${fmtCur(netPay)}</div></div>
    </div>

    <div class="card cc-current-cycle-card" style="margin-bottom:16px">
      <div class="cc-current-cycle-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">Transactions</div>
        <div class="cc-current-cycle-actions" style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadCcCyclePdf(${card.id},${cycle.id},'${escHtml(card.bank_name)} ${escHtml(card.card_name)}')">PDF</button>
          <button class="btn btn-p btn-sm" onclick="showCcTxnModal(${card.id})">+ Add Transaction</button>
          <button class="btn btn-s btn-sm" onclick="showCcExcelImportModal(${cycle.id}, '${cycle.cycle_start}', '${cycle.cycle_end}', ${card.default_discount_pct || 0})">Import Excel</button>
          <button class="btn btn-s btn-sm" onclick="showCloseCycleModal(${cycle.id},${netPay})">Close Cycle / Mark Paid</button>
        </div>
      </div>
      <div class="table-wrap cc-txn-table-wrap"><table>
        <thead><tr><th>Date</th><th>Description</th><th class="td-m">Amount</th><th class="td-m">Disc%</th><th class="td-m">Discount</th><th class="td-m">Net</th><th></th></tr></thead>
        <tbody>${txnRows}</tbody>
      </table></div>
      <div class="cc-txn-card-list">${txnCards}</div>
    </div>`;
}

function renderCcHistory(cycles) {
  const _ccCard = _findCcCardById(_ccSelectedCardId);
  const _ccLabel = _ccCard ? `${_ccCard.bank_name} ${_ccCard.card_name}` : 'Card';
  const importBtn = `<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px">
    <button class="btn btn-s btn-sm" onclick="downloadCcHistoryPdf(${_ccSelectedCardId},'${_ccLabel.replace(/'/g,"\\'")}')">PDF History</button>
    <button class="btn btn-s btn-sm" onclick="showImportHistoryModal(${_ccSelectedCardId})">Import Historical Data</button>
  </div>`;

  if (!cycles.length) return importBtn + `<div style="color:var(--t3);text-align:center;padding:40px">No billing history yet.<br><span style="font-size:13px">Use the import button above to add past billing cycle totals.</span></div>`;

  const today = new Date().toISOString().slice(0, 10);

  const rows = cycles.map(c => {
    const statusColor = c.status === 'paid' || c.status === 'closed' ? 'var(--green)' : c.status === 'partial' ? 'var(--amber)' : 'var(--red)';
    const statusLabel = c.status === 'paid' || c.status === 'closed' ? 'Paid' : c.status === 'partial' ? 'Partial' : c.status === 'open' ? 'Open' : 'Billed';
    const isImported  = !c.txns.length && (c.status === 'closed' || c.status === 'paid');
    const isFutureOpen = c.status === 'open' && c.cycle_start > today;

    const txnRows = c.txns.map(t => `<tr>
      <td>${fmtDate(t.txn_date)}</td>
      <td>${escHtml(t.description)}${t.source === 'emi' ? ' <span style="font-size:10px;background:var(--bg2);color:var(--t2);padding:1px 5px;border-radius:99px">emi</span>' : ''}</td>
      <td class="td-m">${fmtCur(t.amount)}</td>
      <td class="td-m">${t.discount_pct > 0 ? fmtCur(t.net_amount) : '-'}</td>
      ${c.status === 'open' ? `<td class="td-m" style="white-space:nowrap">
        <button class="btn-d" style="color:var(--em)" onclick="showEditCycleTxn(${t.id})">Edit</button>
        <button class="btn-d" onclick="deleteCycleTxn(${t.id})">Del</button>
      </td>` : '<td></td>'}
    </tr>`).join('');

    const txnTable = `<div class="table-wrap" style="margin-top:8px"><table>
      <thead><tr><th>Date</th><th>Description</th><th class="td-m">Amount</th><th class="td-m">Net</th><th class="td-m"></th></tr></thead>
      <tbody>${txnRows || `<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:12px">No transactions</td></tr>`}</tbody>
    </table></div>`;

    const canEditCycle = !isFutureOpen;
    const cycleActions = (c.status === 'open' || canEditCycle) ? `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--border-l)">
        ${c.status === 'open' ? `<button class="btn btn-s btn-sm" onclick="showAddCycleTxnModal(${c.id}, '${c.cycle_start}', '${c.cycle_end}')">+ Add Transaction</button>` : ''}
        <button class="btn btn-s btn-sm" onclick="showCcExcelImportModal(${c.id}, '${c.cycle_start}', '${c.cycle_end}', ${_ccCard?.default_discount_pct || 0})">Import Excel</button>
        <button class="btn btn-sm" style="border:1px solid var(--border)" onclick="showEditCycleModal(${c.id})">${c.status === 'open' ? 'Edit Cycle' : 'Edit / Mark Status'}</button>
        ${isFutureOpen ? `<button class="btn btn-sm" style="border:1px solid var(--red);color:var(--red);background:transparent" onclick="deleteFutureCycle(${c.id})">Delete Cycle</button>` : ''}
      </div>` : '';

    return `<div class="card" style="margin-bottom:12px${isFutureOpen ? ';border-color:var(--border);opacity:0.85' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-weight:700;font-size:15px">${fmtDate(c.cycle_start)} to ${fmtDate(c.cycle_end)}
            ${isImported ? '<span style="font-size:10px;background:var(--bg2);color:var(--t3);padding:1px 7px;border-radius:99px;margin-left:6px;font-weight:500">historical</span>' : ''}
            ${isFutureOpen ? '<span style="font-size:10px;background:var(--bg2);color:var(--t3);padding:1px 7px;border-radius:99px;margin-left:6px;font-weight:500">future</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--t2);margin-top:2px">Due: ${c.due_date ? fmtDate(c.due_date) : '-'} &nbsp;&middot;&nbsp; <span style="color:${statusColor};font-weight:600">${statusLabel}</span>${c.paid_date ? ' on ' + fmtDate(c.paid_date) : ''}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:700">${fmtCur(c.net_payable)}</div>
          <div style="font-size:11px;color:var(--t3)">${isImported ? 'Imported total' : `Spent ${fmtCur(c.total_amount)} &middot; Saved ${fmtCur(c.total_discount)}`}</div>
          <button class="btn btn-s btn-sm" style="margin-top:6px;font-size:11px" onclick="downloadCcCyclePdf(${_ccSelectedCardId},${c.id},'${_ccLabel.replace(/'/g,"\\'")}')">PDF</button>
        </div>
      </div>
      ${c.txns.length || c.status === 'open' ? `<details style="margin-top:10px">
        <summary style="font-size:13px;color:var(--t2);cursor:pointer">${c.txns.length} transaction${c.txns.length!==1?'s':''}</summary>
        ${txnTable}
      </details>` : ''}
      ${cycleActions}
    </div>`;
  }).join('');

  return importBtn + `<div>${rows}</div>`;
}

// â”€â”€ Cycle CRUD (open/future cycles in billing history) â”€â”€â”€â”€â”€â”€â”€â”€

function showAddCycleTxnModal(cycleId, cycleStart, cycleEnd) {
  openModal('Add Transaction', `
    <div class="fg">
      <label class="fl full">Description *<input class="fi" id="ctDesc" placeholder="e.g. Purchase, EMI..." autofocus></label>
      <label class="fl">Amount (&#8377;) *<input class="fi" type="number" step="0.01" id="ctAmt" placeholder="0.00"></label>
      <label class="fl">Discount %<input class="fi" type="number" step="0.01" id="ctDisc" placeholder="0" min="0" max="100"></label>
      <label class="fl full">Date<input class="fi" type="date" id="ctDate" value="${cycleEnd < todayStr() ? cycleEnd : (cycleStart > todayStr() ? cycleStart : todayStr())}"></label>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin:6px 0 10px;cursor:pointer">
      <input type="checkbox" id="ctAddExpense" style="width:15px;height:15px;cursor:pointer" onchange="document.getElementById('ctExpTypeWrap').style.display=this.checked?'':'none'">
      Also add as expense
    </label>
    <div id="ctExpTypeWrap" style="display:none;margin-bottom:12px">
      <label class="fl" style="max-width:260px">Expense Type
        <select class="fi" id="ctExpType">
          <option value="0">Fair / Regular</option>
          <option value="1">Extra / Non-essential</option>
        </select>
      </label>
      <label class="fl" style="max-width:260px">Expense Category${expenseCategoryDatalistHtml('')}</label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doAddCycleTxn(${cycleId})">Add</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

function showCcExcelImportModal(cycleId, cycleStart, cycleEnd, defaultDiscount) {
  const defaultDate = cycleEnd < todayStr() ? cycleEnd : (cycleStart > todayStr() ? cycleStart : todayStr());
  openModal('Import CC Transactions From Excel', `
    <div style="font-size:12px;color:var(--t2);margin-bottom:14px;background:var(--bg2);border-radius:8px;padding:10px">
      Import rows into this billing cycle. Your file should have columns like <strong>THING</strong> and <strong>AMOUNT</strong>.
      If the file has no date column, the transaction date below will be used for every row.
    </div>
    <div class="fg">
      <label class="fl full">File (.xlsx / .xls / .ods)<input type="file" accept=".xlsx,.xls,.ods" id="ccXlsxFile" class="fi"></label>
      <label class="fl">Password (if any)<input type="password" id="ccXlsxPass" class="fi" placeholder="Leave blank if none" autocomplete="new-password"></label>
      <label class="fl">Default Txn Date<input class="fi" type="date" id="ccImportDate" value="${defaultDate}"></label>
      <label class="fl">Discount %<input class="fi" type="number" step="0.01" min="0" max="100" id="ccImportDisc" value="${defaultDiscount || 0}"></label>
    </div>
    <div style="font-size:12px;color:var(--t3);margin:8px 0 12px">Cycle: ${fmtDate(cycleStart)} to ${fmtDate(cycleEnd)}</div>
    <div class="fa" style="justify-content:flex-start;margin-bottom:12px">
      <button class="btn btn-s" onclick="loadCcExcelSheets()">Load Sheets</button>
    </div>
    <div id="ccXlsxSheetArea"></div>
    <div id="ccXlsxPreview"></div>
    <div class="fa" style="margin-top:14px">
      <button class="btn btn-g" onclick="closeModal()">Close</button>
    </div>`);
  const previewEl = document.getElementById('ccXlsxPreview');
  if (previewEl) previewEl.dataset.cycleId = String(cycleId);
}

async function loadCcExcelSheets() {
  const file = document.getElementById('ccXlsxFile')?.files?.[0];
  if (!file) { toast('Please select a file first', 'warning'); return; }
  const password = document.getElementById('ccXlsxPass')?.value || '';
  document.getElementById('ccXlsxSheetArea').innerHTML = `<div style="color:var(--t3);font-size:13px;margin-bottom:10px">Reading file...</div>`;
  document.getElementById('ccXlsxPreview').innerHTML = '';
  const fd = new FormData();
  fd.append('file', file);
  if (password) fd.append('password', password);
  let res, data;
  try {
    res = await fetch('/api/cc/import-excel/sheets', { method: 'POST', body: fd });
    const rawText = await res.text();
    data = JSON.parse(rawText);
    if (!res.ok && !data?.error) data = { error: `Server [${res.status}]: ${rawText.slice(0, 200)}` };
  } catch (e) {
    document.getElementById('ccXlsxSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px">Network error: ${e.message}</p>`;
    return;
  }
  if (data.error) { document.getElementById('ccXlsxSheetArea').innerHTML = `<p style="color:var(--red);font-size:13px">${data.error}</p>`; return; }
  const checks = data.sheets.map((s, i) => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;cursor:pointer;background:var(--bg);margin-bottom:4px">
      <input type="checkbox" class="cc-xlsx-sheet-cb" value="${s}" ${i===0?'checked':''} onchange="document.getElementById('ccXlsxPreview').innerHTML=''">
      <span style="font-size:13px">${s}</span>
    </label>`).join('');
  document.getElementById('ccXlsxSheetArea').innerHTML = `
    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:12px;font-weight:600;color:var(--t2)">SELECT SHEETS</span>
        <span style="font-size:11px;color:var(--t3);cursor:pointer" onclick="document.querySelectorAll('.cc-xlsx-sheet-cb').forEach(c=>c.checked=true)">Select all</span>
      </div>
      ${checks}
    </div>
    <button class="btn btn-s" onclick="previewCcExcelImport()">Preview</button>`;
  if (data.sheets.length === 1) previewCcExcelImport();
}

function getSelectedCcSheets() {
  return [...document.querySelectorAll('.cc-xlsx-sheet-cb:checked')].map(c => c.value);
}

async function previewCcExcelImport() {
  const file = document.getElementById('ccXlsxFile')?.files?.[0];
  const sheets = getSelectedCcSheets();
  const password = document.getElementById('ccXlsxPass')?.value || '';
  const defaultTxnDate = document.getElementById('ccImportDate')?.value || '';
  const cycleId = document.getElementById('ccXlsxPreview')?.dataset?.cycleId;
  if (!file) return;
  if (!defaultTxnDate) { toast('Select a default transaction date', 'warning'); return; }
  if (sheets.length === 0) { toast('Select at least one sheet', 'warning'); return; }
  document.getElementById('ccXlsxPreview').innerHTML = `<div style="color:var(--t3);font-size:13px">Loading preview...</div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  fd.append('default_txn_date', defaultTxnDate);
  if (password) fd.append('password', password);
  const res = await fetch('/api/cc/import-excel/preview', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.error) { document.getElementById('ccXlsxPreview').innerHTML = `<p style="color:var(--red);font-size:13px">${data.error}</p>`; return; }
  if (data.count === 0) { document.getElementById('ccXlsxPreview').innerHTML = `<p style="color:var(--amber);font-size:13px">No valid rows found (${data.skipped} rows skipped).</p>`; return; }
  document.getElementById('ccXlsxPreview').innerHTML = `
    <p style="font-size:13px;margin-bottom:10px">Found <b>${data.count}</b> valid rows &nbsp;<span style="color:var(--t3)">(${data.skipped} skipped)</span></p>
    <div style="max-height:260px;overflow:auto;margin-bottom:14px">
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Description</th><th class="td-m">Amount</th></tr></thead>
        <tbody>${data.preview.map(r => `<tr>
          <td>${r.txn_date}</td>
          <td>${escHtml(r.description)}</td>
          <td class="td-m">${fmtCur(r.amount)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doCcExcelImport(${cycleId})">Import all ${data.count} rows</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`;
}

async function doCcExcelImport(cycleId) {
  const file = document.getElementById('ccXlsxFile')?.files?.[0];
  const sheets = getSelectedCcSheets();
  const password = document.getElementById('ccXlsxPass')?.value || '';
  const defaultTxnDate = document.getElementById('ccImportDate')?.value || '';
  const discountPct = document.getElementById('ccImportDisc')?.value || '0';
  if (!file || !cycleId || sheets.length === 0) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('sheets', JSON.stringify(sheets));
  fd.append('cycle_id', String(cycleId));
  fd.append('default_txn_date', defaultTxnDate);
  fd.append('discount_pct', discountPct);
  if (password) fd.append('password', password);
  const res = await fetch('/api/cc/import-excel', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.success) {
    closeModal();
    toast(`Imported ${data.imported} credit card transaction${data.imported !== 1 ? 's' : ''}`, 'success');
    renderCcDetail();
  } else {
    toast('Import failed: ' + (data.error || 'Unknown error'), 'error');
  }
}

async function doAddCycleTxn(cycleId) {
  const body = {
    description: document.getElementById('ctDesc').value.trim(),
    amount: parseFloat(document.getElementById('ctAmt').value) || 0,
    discount_pct: parseFloat(document.getElementById('ctDisc').value) || 0,
    txn_date: document.getElementById('ctDate').value,
  };
  if (!body.description || !body.amount) { toast('Description and amount required', 'warning'); return; }
  const r = await api(`/api/cc/cycles/${cycleId}/txns`, { method: 'POST', body });
  const addAsExpense = document.getElementById('ctAddExpense')?.checked;
  const expenseType = parseInt(document.getElementById('ctExpType')?.value || '0', 10) || 0;
  const expenseCategory = document.getElementById('eCategory')?.value.trim() || null;
  if (r?.success) {
    if (addAsExpense) {
      await api('/api/expenses', { method: 'POST', body: {
        item_name: body.description,
        category: expenseCategory,
        amount: body.amount,
        purchase_date: body.txn_date,
        is_extra: expenseType ? 1 : 0,
      }});
    }
    closeModal();
    toast('Transaction added' + (addAsExpense ? ' & added to expenses' : ''), 'success');
    renderCcDetail();
  }
  else toast(r?.error || 'Failed', 'error');
}

async function showEditCycleTxn(txnId) {
  const cardData = await api(`/api/cc/cards/${_ccSelectedCardId}/cycles`);
  const found = _findCcTxnInCycles(cardData?.cycles || [], txnId);
  const txn = found?.txn || null;
  if (!txn) { toast('Transaction not found', 'error'); return; }
  openModal('Edit Transaction', `
    <div class="fg">
      <label class="fl full">Description *<input class="fi" id="ctDesc" value="${escHtml(txn.description)}" autofocus></label>
      <label class="fl">Amount (&#8377;) *<input class="fi" type="number" step="0.01" id="ctAmt" value="${txn.amount}"></label>
      <label class="fl">Discount %<input class="fi" type="number" step="0.01" id="ctDisc" value="${txn.discount_pct || 0}" min="0" max="100"></label>
      <label class="fl full">Date<input class="fi" type="date" id="ctDate" value="${normalizeInputDate(txn.txn_date) || ''}"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doEditCycleTxn(${txnId})">Update</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function doEditCycleTxn(txnId) {
  const body = {
    description: document.getElementById('ctDesc').value.trim(),
    amount: parseFloat(document.getElementById('ctAmt').value) || 0,
    discount_pct: parseFloat(document.getElementById('ctDisc').value) || 0,
    txn_date: document.getElementById('ctDate').value,
  };
  if (!body.description || !body.amount) { toast('Description and amount required', 'warning'); return; }
  const r = await api(`/api/cc/txns/${txnId}`, { method: 'PUT', body });
  if (r?.success) { closeModal(); toast('Updated', 'success'); renderCcDetail(); }
  else toast(r?.error || 'Failed', 'error');
}

async function deleteCycleTxn(txnId) {
  if (!await confirmDialog('Delete this transaction?')) return;
  const r = await api(`/api/cc/txns/${txnId}`, { method: 'DELETE' });
  if (r?.success) { toast('Deleted', 'success'); renderCcDetail(); }
  else toast(r?.error || 'Failed', 'error');
}

function showEditCycleModal(cycleId) {
  const cycle = (_ccHistoryCycles || []).find(c => _sameId(c.id, cycleId));
  if (!cycle) { toast('Cycle not found', 'warning'); return; }
  const status = cycle.status === 'closed' ? 'paid' : cycle.status === 'partial' ? 'billed' : cycle.status;
  const paidDate = cycle.paid_date || cycle.due_date || todayStr();
  openModal('Edit Billing Cycle', `
    <div class="fg">
      <label class="fl">Cycle Start<input class="fi" type="date" id="csStart" value="${normalizeInputDate(cycle.cycle_start) || ''}"></label>
      <label class="fl">Cycle End<input class="fi" type="date" id="csEnd" value="${normalizeInputDate(cycle.cycle_end) || ''}"></label>
      <label class="fl">Due Date<input class="fi" type="date" id="csDue" value="${normalizeInputDate(cycle.due_date) || ''}"></label>
      <label class="fl">Total Amount (&#8377;)<input class="fi" type="number" step="0.01" min="0" id="csTotal" value="${(cycle.total_amount || cycle.net_payable || 0).toFixed(2)}"></label>
      <label class="fl">Status<select class="fi" id="csStatus" onchange="toggleCyclePaidDate()">
        <option value="open" ${status === 'open' ? 'selected' : ''}>Open</option>
        <option value="billed" ${status === 'billed' ? 'selected' : ''}>Billed</option>
        <option value="paid" ${status === 'paid' ? 'selected' : ''}>Paid</option>
      </select></label>
      <label class="fl" id="csPaidWrap" style="${status === 'paid' ? '' : 'display:none'}">Paid Date<input class="fi" type="date" id="csPaidDate" value="${normalizeInputDate(paidDate) || ''}"></label>
    </div>
    <div style="background:var(--bg);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:12px">
      Saved discount stays at <strong>${fmtCur(cycle.total_discount || 0)}</strong>. Updating total amount recalculates net payable.
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doEditCycle(${cycleId})">Update</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function doEditCycle(cycleId) {
  const body = {
    cycle_start: document.getElementById('csStart').value,
    cycle_end:   document.getElementById('csEnd').value,
    due_date:    document.getElementById('csDue').value,
    total_amount: parseFloat(document.getElementById('csTotal').value) || 0,
    status: document.getElementById('csStatus').value,
    paid_date: document.getElementById('csStatus').value === 'paid' ? document.getElementById('csPaidDate').value : null,
  };
  if (!body.cycle_start || !body.cycle_end) { toast('Start and end dates required', 'warning'); return; }
  if (body.status === 'paid' && !body.paid_date) { toast('Paid date required when status is Paid', 'warning'); return; }
  const r = await api(`/api/cc/cycles/${cycleId}`, { method: 'PUT', body });
  if (r?.success) { closeModal(); toast('Updated', 'success'); renderCcDetail(); }
  else toast(r?.error || 'Failed', 'error');
}

function toggleCyclePaidDate() {
  const status = document.getElementById('csStatus')?.value;
  const wrap = document.getElementById('csPaidWrap');
  if (wrap) wrap.style.display = status === 'paid' ? '' : 'none';
}

async function deleteFutureCycle(cycleId) {
  if (!await confirmDialog('Delete this future cycle and all its transactions?')) return;
  const r = await api(`/api/cc/cycles/${cycleId}`, { method: 'DELETE' });
  if (r?.success) { toast('Cycle deleted', 'success'); renderCcDetail(); }
  else toast(r?.error || 'Failed', 'error');
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showImportHistoryModal(cardId) {
  const card = _findCcCardById(cardId);
  if (!card) return;
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - 5; y <= currentYear + 1; y++) years.push(y);
  const yearOptions = years.map(y =>
    `<option value="${y}" ${y === currentYear - 1 ? 'selected' : ''}>${y}</option>`
  ).join('');
  openModal(`Import History \u2014 ${card.card_name}`, `
    <div style="font-size:12px;color:var(--t2);margin-bottom:14px;background:var(--bg2);border-radius:8px;padding:10px">
      Enter the <strong>total billing cycle amount</strong> for each month. Leave blank to skip that month.
      Existing cycles for the same period will be skipped (no duplicates).
    </div>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
      <label class="fl" style="flex-direction:row;align-items:center;gap:8px;margin:0">
        Year: <select class="fi" id="ihYear" style="width:auto" onchange="rebuildImportRows()">${yearOptions}</select>
      </label>
    </div>
    <div id="ihRows" data-card-id="${cardId}"></div>
    <div class="fa" style="margin-top:14px">
      <button class="btn btn-p" onclick="doImportHistory(${cardId})">Import</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`,
    { wide: true }
  );
  rebuildImportRows();
}

function getImportHistoryPaidDate(cardId, year, month) {
  const card = _findCcCardById(cardId);
  if (!card || !year || !month) return '';
  const dueDate = new Date(year, month - 1, (card.bill_gen_day || 1) + (card.due_days || 20));
  return `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;
}

function rebuildImportRows() {
  const year = parseInt(document.getElementById('ihYear')?.value);
  if (!year) return;
  const rowsEl = document.getElementById('ihRows');
  const cardId = parseInt(rowsEl?.dataset.cardId);
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const rows = monthNames.map((name, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-l)">
      <div style="width:90px;font-size:13px;font-weight:600;color:var(--t2)">${name}</div>
      <label class="fl" style="flex:1;margin:0;flex-direction:row;align-items:center;gap:6px">
        <span style="font-size:13px;color:var(--t3)">&#8377;</span>
        <input class="fi" type="number" step="0.01" min="0" placeholder="0.00" id="ihAmt_${i+1}" style="margin:0">
      </label>
      <label class="fl" style="margin:0;flex-direction:row;align-items:center;gap:6px;font-size:12px;color:var(--t2);white-space:nowrap">
        Paid on: <input class="fi" type="date" id="ihDate_${i+1}" value="${getImportHistoryPaidDate(cardId, year, i + 1)}" style="width:130px;margin:0">
      </label>
    </div>`).join('');
  rowsEl.innerHTML = rows;
}

async function doImportHistory(cardId) {
  try {
    const year = parseInt(document.getElementById('ihYear')?.value);
    if (!year) { toast('Select a year', 'warning'); return; }
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const el = document.getElementById(`ihAmt_${m}`);
      const amtVal = el ? parseFloat(el.value) : NaN;
      if (!amtVal || amtVal <= 0) continue;
      const dateEl = document.getElementById(`ihDate_${m}`);
      rows.push({ year, month: m, amount: amtVal, paid_date: dateEl?.value || null });
    }
    if (!rows.length) { toast('Enter at least one month amount', 'warning'); return; }
    const btn = document.querySelector('#modalContent .btn.btn-p');
    if (btn) btn.disabled = true;
    const r = await api('/api/cc/cycles/import', { method: 'POST', body: { card_id: cardId, rows } });
    if (r?.success) {
      closeModal();
      if (r.imported > 0) {
        toast(`Imported ${r.imported} billing cycle${r.imported !== 1 ? 's' : ''}`, 'success');
      } else {
        toast('No new cycles imported - all already exist or amounts were zero', 'info');
      }
      _ccView = 'history';
      renderCcDetail();
    } else {
      toast(r?.error || 'Import failed', 'error');
      const btn2 = document.querySelector('#modalContent .btn.btn-p');
      if (btn2) btn2.disabled = false;
    }
  } catch (err) {
    toast('Import error: ' + err.message, 'error');
    const btn2 = document.querySelector('#modalContent .btn.btn-p');
    if (btn2) btn2.disabled = false;
  }
}

function renderCcMonthly(months, availYears) {
  availYears = availYears || [];
  const yearChips = availYears.map(y =>
    `<button class="chip ${_ccMonthlyYear==y?'active':''}" onclick="_ccMonthlyYear=${y};renderCcDetail()">${y}</button>`
  ).join('');
  const yearBar = `<div class="chip-group" style="margin-bottom:16px">${yearChips || '<span style="color:var(--t3);font-size:13px">No data yet</span>'}</div>`;

  if (!months.length) return yearBar + `<div style="color:var(--t3);text-align:center;padding:40px">No data for ${_ccMonthlyYear}.</div>`;

  const yearTotal = months.reduce((s, m) => s + m.total_amount, 0);
  const yearNet   = months.reduce((s, m) => s + m.net_payable, 0);
  const yearDisc  = months.reduce((s, m) => s + m.total_discount, 0);

  const maxAmt = Math.max(...months.map(m => m.net_payable), 1);
  // Show all 12 months, fill missing with 0
  const monthMap = {};
  months.forEach(m => { monthMap[m.month] = m; });
  const allMonthBars = Array.from({ length: 12 }, (_, i) => {
    const key = `${_ccMonthlyYear}-${String(i + 1).padStart(2, '0')}`;
    const val = monthMap[key]?.net_payable || 0;
    const pct = Math.round(val / maxAmt * 100);
    return `<div class="cc-month-bar">
      <div class="cc-month-fill" style="height:${pct}%" title="${MONTHS[i]}: ${fmtCur(val)}"></div>
      <div class="cc-month-lbl">${MONTHS[i].slice(0,3)}</div>
    </div>`;
  }).join('');

  const rows = months.map(m => {
    const [, mo] = m.month.split('-');
    return `<tr>
      <td>${MONTHS[parseInt(mo)-1]}</td>
      <td class="td-m">${fmtCur(m.total_amount)}</td>
      <td class="td-m" style="color:var(--green)">${m.total_discount > 0 ? fmtCur(m.total_discount) : '-'}</td>
      <td class="td-m" style="font-weight:700">${fmtCur(m.net_payable)}</td>
      <td class="td-m">${m.txn_count || '-'}</td>
    </tr>`;
  }).join('');

  const _ccCardM = _findCcCardById(_ccSelectedCardId);
  const _ccLabelM = _ccCardM ? `${_ccCardM.bank_name} ${_ccCardM.card_name}` : 'Card';
  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button class="btn btn-s btn-sm" onclick="downloadCcMonthlySummaryPdf(${_ccSelectedCardId},'${_ccLabelM.replace(/'/g,"\\'")}',${_ccMonthlyYear})">PDF</button>
    </div>
    ${yearBar}
    <div class="cc-cycle-summary" style="margin-bottom:16px">
      <div class="cc-cycle-stat"><div class="lbl">Year Spent</div><div class="val">${fmtCur(yearTotal)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Discount Saved</div><div class="val" style="color:var(--green)">- ${fmtCur(yearDisc)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Net Paid</div><div class="val hl">${fmtCur(yearNet)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Months Active</div><div class="val">${months.length}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">${_ccMonthlyYear} - Monthly Spend</div>
      <div class="cc-chart-wrap">${allMonthBars}</div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Month</th><th class="td-m">Total Spent</th><th class="td-m">Discount</th><th class="td-m">Net Paid</th><th class="td-m">Transactions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderCcYearly(years) {
  const _ccCardY = _findCcCardById(_ccSelectedCardId);
  const _ccLabelY = _ccCardY ? `${_ccCardY.bank_name} ${_ccCardY.card_name}` : 'Card';
  const _ccLabelYQ = _ccLabelY.replace(/'/g, "\\'");
  if (!years.length) return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button class="btn btn-s btn-sm" onclick="downloadCcYearlySummaryPdf(${_ccSelectedCardId},'${_ccLabelYQ}')">PDF</button>
    </div>
    <div style="color:var(--t3);text-align:center;padding:40px">No historical data yet.</div>`;

  const grandTotal = years.reduce((s, y) => s + y.total_amount, 0);
  const grandDisc  = years.reduce((s, y) => s + y.total_discount, 0);
  const grandNet   = years.reduce((s, y) => s + y.net_payable, 0);

  const maxAmt = Math.max(...years.map(y => y.net_payable), 1);
  const bars = [...years].reverse().map(y => {
    const pct = Math.round(y.net_payable / maxAmt * 100);
    return `<div class="cc-month-bar" style="flex:1;min-width:40px;max-width:80px">
      <div class="cc-month-fill" style="height:${pct}%" title="${y.year}: ${fmtCur(y.net_payable)}"></div>
      <div class="cc-month-lbl">${y.year}</div>
    </div>`;
  }).join('');

  const rows = years.map(y => `<tr>
    <td style="font-weight:700;font-family:var(--mono)">${y.year}</td>
    <td class="td-m">${fmtCur(y.total_amount)}</td>
    <td class=”td-m” style=”color:var(--green)”>${y.total_discount > 0 ? fmtCur(y.total_discount) : '&mdash;'}</td>
    <td class=”td-m” style=”font-weight:700”>${fmtCur(y.net_payable)}</td>
    <td class=”td-m”>${y.txn_count || '&mdash;'}</td>
    <td class="td-m">${y.cycle_count}</td>
  </tr>`).join('');

  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button class=”btn btn-s btn-sm” onclick=”downloadCcYearlySummaryPdf(${_ccSelectedCardId},'${_ccLabelYQ}')”>&#8595; PDF</button>
    </div>
    <div class="cc-cycle-summary" style="margin-bottom:16px">
      <div class="cc-cycle-stat"><div class="lbl">All-time Spent</div><div class="val">${fmtCur(grandTotal)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Total Discount</div><div class="val" style="color:var(--green)">- ${fmtCur(grandDisc)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Net Paid</div><div class="val hl">${fmtCur(grandNet)}</div></div>
      <div class="cc-cycle-stat"><div class="lbl">Years Active</div><div class="val">${years.length}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Year-over-Year Spend</div>
      <div class="cc-chart-wrap" style="align-items:flex-end;justify-content:center;gap:12px">${bars}</div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Year</th><th class="td-m">Total Spent</th><th class="td-m">Discount</th><th class="td-m">Net Paid</th><th class="td-m">Transactions</th><th class="td-m">Cycles</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// â”€â”€ Add / Edit Card Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function showCcCardModal(id) {
  let card = { bank_name: '', card_name: '', last4: '', expiry_month: '', expiry_year: '', bill_gen_day: 1, due_days: 20, default_discount_pct: 0, credit_limit: '' };
  let currentCycle = null;
  if (id) {
    const c = _findCcCardById(id);
    if (c) {
      card = c;
      currentCycle = c.currentCycle || null;
    } else {
      const data = await api(`/api/cc/cards/${id}/current`);
      if (data?.card) {
        card = data.card;
        currentCycle = data.cycle || null;
      }
    }
  }
  openModal(id ? 'Edit Credit Card' : 'Add Credit Card', `
    <div class="fg">
      <label class="fl">Bank Name *<input class="fi" id="ccBank" value="${escHtml(card.bank_name)}" placeholder="e.g. HDFC, SBI, ICICI"></label>
      <label class="fl">Card Name *<input class="fi" id="ccName" value="${escHtml(card.card_name)}" placeholder="e.g. HDFC Regalia"></label>
      <label class="fl">Last 4 Digits *<input class="fi" id="ccLast4" value="${escHtml(card.last4)}" placeholder="1234" maxlength="4"></label>
      <label class="fl">Expiry Month<input class="fi" type="number" id="ccExpM" value="${card.expiry_month||''}" placeholder="MM" min="1" max="12"></label>
      <label class="fl">Expiry Year<input class="fi" type="number" id="ccExpY" value="${card.expiry_year||''}" placeholder="YYYY" min="2024" max="2040"></label>
      <label class="fl">Bill Generation Day *<input class="fi" type="number" id="ccBillDay" value="${card.bill_gen_day||1}" min="1" max="28" placeholder="e.g. 15"></label>
      <label class="fl">Payment Due (days after bill)<input class="fi" type="number" id="ccDueDays" value="${card.due_days||20}" min="1" max="60"></label>
      ${currentCycle ? `<label class="fl">Current Cycle Due Date<input class="fi" type="date" id="ccCurrentDueDate" value="${currentCycle.due_date || ''}"></label>` : ''}
      <label class="fl">Default Discount %<input class="fi" type="number" id="ccDisc" value="${card.default_discount_pct||0}" step="0.1" min="0" max="100" placeholder="0"></label>
      <label class="fl">Credit Limit (&#8377;)<input class="fi" type="number" id="ccLimit" value="${card.credit_limit||''}" placeholder="optional"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveCcCard(${id||'null'})">${id ? 'Update' : 'Add Card'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveCcCard(id) {
  const existingCard = id ? _findCcCardById(id) : null;
  const currentCycle = existingCard?.currentCycle || null;
  const originalBillDay = Number(existingCard?.bill_gen_day || 1);
  const originalDueDays = Number(existingCard?.due_days || 20);
  const thisYear = new Date().getFullYear();
  const maxYear = thisYear + 30;

  try {
    const bankName = document.getElementById('ccBank').value.trim();
    const cardName = document.getElementById('ccName').value.trim();
    const last4 = document.getElementById('ccLast4').value.trim();
    const expiryMonth = parseIntegerField(document.getElementById('ccExpM').value, 'Expiry month', { min: 1, max: 12, required: false });
    const expiryYear = parseIntegerField(document.getElementById('ccExpY').value, 'Expiry year', { min: thisYear - 1, max: maxYear, required: false });
    const billDay = parseIntegerField(document.getElementById('ccBillDay').value, 'Bill generation day', { min: 1, max: 28, required: true });
    const dueDays = parseIntegerField(document.getElementById('ccDueDays').value, 'Payment due days', { min: 1, max: 60, required: true });
    const discountPct = parseMoneyField(document.getElementById('ccDisc').value, 'Default discount %', { min: 0, required: false }) ?? 0;
    const creditLimit = parseMoneyField(document.getElementById('ccLimit').value, 'Credit limit', { min: 0, required: false }) ?? 0;

    if (!bankName || !cardName || !last4) {
      toast('Bank name, card name and last 4 digits are required', 'warning');
      return;
    }
    if (bankName.length > 80 || cardName.length > 80) {
      toast('Bank/Card name must be 80 characters or fewer', 'warning');
      return;
    }
    if (!/^\d{4}$/.test(last4)) {
      toast('Last 4 digits must be exactly 4 numbers', 'warning');
      return;
    }
    if ((expiryMonth && !expiryYear) || (!expiryMonth && expiryYear)) {
      toast('Provide both expiry month and expiry year together', 'warning');
      return;
    }
    if (discountPct > 100) {
      toast('Default discount cannot exceed 100%', 'warning');
      return;
    }

    const body = {
      bank_name: bankName,
      card_name: cardName,
      last4,
      expiry_month: expiryMonth,
      expiry_year: expiryYear,
      bill_gen_day: billDay,
      due_days: dueDays,
      default_discount_pct: discountPct,
      credit_limit: creditLimit,
    };

    const r = id
      ? await api(`/api/cc/cards/${id}`, { method: 'PUT', body })
      : await api('/api/cc/cards', { method: 'POST', body });

    if (r?.success || r?.id) {
      if (id && currentCycle) {
        const currentDueDate = document.getElementById('ccCurrentDueDate')?.value || '';
        const cycleSettingsChanged = billDay !== originalBillDay || dueDays !== originalDueDays;
        let targetCycleId = currentCycle.id;
        let targetCycleDueDate = currentCycle.due_date || '';

        if (cycleSettingsChanged) {
          const refreshed = await api(`/api/cc/cards/${id}/current`);
          targetCycleId = refreshed?.cycle?.id || null;
          targetCycleDueDate = refreshed?.cycle?.due_date || '';
        }

        if (currentDueDate && targetCycleId && currentDueDate !== targetCycleDueDate) {
          const cycleRes = await api(`/api/cc/cycles/${targetCycleId}`, { method: 'PUT', body: { due_date: currentDueDate } });
          if (!cycleRes?.success) {
            toast(cycleRes?.error || 'Card updated but current cycle due date update failed', 'warning');
          }
        }
      }
      closeModal();
      toast(id ? 'Card updated' : 'Card added', 'success');
      const cardsData = await api('/api/cc/cards');
      if (!cardsData?.error) _ccCards = cardsData?.cards || [];
      const shouldRefreshOpenDetail = _ccSelectedCardId && _sameId(_ccSelectedCardId, id || r?.id);
      if (shouldRefreshOpenDetail) {
        await renderCcDetail();
      } else {
        renderCcList();
      }
    } else toast(r?.error || 'Failed', 'error');
  } catch (err) {
    toast(err?.message || 'Please check card details', 'warning');
  }
}

async function deleteCcCard(id) {
  if (!await confirmDialog('Delete this credit card and all its transaction history?')) return;
  const r = await api(`/api/cc/cards/${id}`, { method: 'DELETE' });
  if (r?.success) { toast('Card deleted', 'success'); loadCreditCards(); }
  else toast(r?.error || 'Failed', 'error');
}

// â”€â”€ Add / Edit Transaction Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function showCcTxnModal(cardId, txnId) {
  const card = _findCcCardById(cardId) || { default_discount_pct: 0, card_name: '' };
  let txn = { txn_date: todayStr(), description: '', amount: '', discount_pct: card.default_discount_pct };
  if (txnId) {
    const data = await api(`/api/cc/cards/${cardId}/current`);
    const found = data?.txns?.find(t => _sameId(t.id, txnId));
    if (found) txn = found;
    else {
      const history = await api(`/api/cc/cards/${cardId}/cycles`);
      const historyTxn = _findCcTxnInCycles(history?.cycles || [], txnId)?.txn;
      if (historyTxn) txn = historyTxn;
    }
  }
  openModal(txnId ? 'Edit Transaction' : 'Add Transaction', `
    <div class="fg">
      <label class="fl">Date *<input class="fi" type="date" id="ctDate" value="${normalizeInputDate(txn.txn_date) || todayStr()}"></label>
      <label class="fl full">Description *<input class="fi" id="ctDesc" value="${escHtml(txn.description)}" placeholder="e.g. Amazon, Grocery..."></label>
      <label class="fl">Amount (&#8377;) *<input class="fi" type="number" step="0.01" id="ctAmt" value="${txn.amount||''}" placeholder="0.00" oninput="ccTxnPreview(${card.default_discount_pct})"></label>
      <label class="fl">Discount % <span style="font-size:11px;color:var(--t3)">(default: ${card.default_discount_pct}%)</span><input class="fi" type="number" step="0.1" id="ctDisc" value="${txn.discount_pct||0}" min="0" max="100" oninput="ccTxnPreview()"></label>
    </div>
    <div id="ctPreview" style="background:var(--bg);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--t2);margin:4px 0 12px">
      Enter amount to see net payable
    </div>
    ${!txnId ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-bottom:8px;cursor:pointer">
      <input type="checkbox" id="ctAddExpense" style="width:15px;height:15px;cursor:pointer" onchange="document.getElementById('ctExpTypeWrap').style.display=this.checked?'':'none'">
      Also add as expense
    </label>
    <div id="ctExpTypeWrap" style="display:none;margin-bottom:12px">
      <label class="fl" style="max-width:260px">Expense Type
        <select class="fi" id="ctExpType">
          <option value="0">Fair / Regular</option>
          <option value="1">Extra / Non-essential</option>
        </select>
      </label>
      <label class="fl" style="max-width:260px">Expense Category${expenseCategoryDatalistHtml('')}</label>
    </div>` : ''}
    <div class="fa">
      <button class="btn btn-p" onclick="saveCcTxn(${cardId},${txnId||'null'})">${txnId ? 'Update' : 'Add'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  if (txn.amount) ccTxnPreview();
}

function ccTxnPreview() {
  const amt  = parseFloat(document.getElementById('ctAmt')?.value) || 0;
  const disc = parseFloat(document.getElementById('ctDisc')?.value) || 0;
  if (!amt) { document.getElementById('ctPreview').innerHTML = 'Enter amount to see net payable'; return; }
  const discAmt = Math.round(amt * disc / 100 * 100) / 100;
  const net = Math.round(amt * 100) / 100;
  document.getElementById('ctPreview').innerHTML =
    `Amount: <strong>${fmtCur(amt)}</strong> &nbsp;â€“&nbsp; Discount: <strong style="color:var(--green)">${fmtCur(discAmt)}</strong> &nbsp;â€“&nbsp; Net Payable: <strong style="color:var(--em)">${fmtCur(net)}</strong>`;
}

async function saveCcTxn(cardId, txnId) {
  const body = {
    card_id: cardId,
    txn_date: document.getElementById('ctDate').value,
    description: document.getElementById('ctDesc').value.trim(),
    amount: Number(document.getElementById('ctAmt').value),
    discount_pct: Number(document.getElementById('ctDisc').value || 0),
  };
  if (!body.description || !body.txn_date) { toast('Fill all required fields', 'warning'); return; }
  if (!Number.isFinite(body.amount) || body.amount <= 0) { toast('Amount must be greater than 0', 'warning'); return; }
  if (!Number.isFinite(body.discount_pct) || body.discount_pct < 0 || body.discount_pct > 100) { toast('Discount % must be between 0 and 100', 'warning'); return; }
  const addAsExpense = !txnId && document.getElementById('ctAddExpense')?.checked;
  const expenseType = parseInt(document.getElementById('ctExpType')?.value || '0', 10) || 0;
  const expenseCategory = document.getElementById('eCategory')?.value.trim() || null;
  const r = txnId
    ? await api(`/api/cc/txns/${txnId}`, { method: 'PUT', body })
    : await api('/api/cc/txns', { method: 'POST', body });
  if (r?.success || r?.id) {
    if (addAsExpense) {
      await api('/api/expenses', { method: 'POST', body: {
        item_name: body.description,
        category: expenseCategory,
        amount: body.amount,
        purchase_date: body.txn_date,
        is_extra: expenseType ? 1 : 0,
      }});
    }
    closeModal();
    toast(txnId ? 'Transaction updated' : 'Transaction added' + (addAsExpense ? ' & added to expenses' : ''), 'success');
    renderCcDetail();
  } else toast(r?.error || 'Failed', 'error');
}

async function deleteCcTxn(txnId) {
  if (!await confirmDialog('Delete this transaction?')) return;
  const r = await api(`/api/cc/txns/${txnId}`, { method: 'DELETE' });
  if (r?.success) { toast('Deleted', 'success'); renderCcDetail(); }
  else toast(r?.error || 'Failed', 'error');
}

// â”€â”€ Close Cycle Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showCloseCycleModal(cycleId, netPayable) {
  openModal('Close Billing Cycle', `
    <p style="color:var(--t2);font-size:13px;margin-bottom:16px">Mark this billing cycle as closed. Optionally record your payment details.</p>
    <div class="fg">
      <label class="fl">Amount Paid (&#8377;)<input class="fi" type="number" step="0.01" id="ccPaidAmt" value="${netPayable.toFixed(2)}" placeholder="0.00"></label>
      <label class="fl">Payment Date<input class="fi" type="date" id="ccPaidDate" value="${todayStr()}"></label>
    </div>
    <div style="background:var(--bg);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:12px">
      Net Payable: <strong>${fmtCur(netPayable)}</strong>. A new billing cycle will be created automatically.
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doCloseCycle(${cycleId})">Close Cycle</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function doCloseCycle(cycleId) {
  const body = {
    paid_amount: parseFloat(document.getElementById('ccPaidAmt').value) || 0,
    paid_date: document.getElementById('ccPaidDate').value,
  };
  const r = await api(`/api/cc/cycles/${cycleId}/close`, { method: 'POST', body });
  if (r?.success) {
    closeModal();
    toast('Cycle closed successfully', 'success');
    renderCcDetail();
  } else toast(r?.error || 'Failed', 'error');
}

// â”€â”€ "Add to Credit Card" helper (called from expense/split/trip forms) â”€â”€
async function getCcCardsForForm() {
  if (_ccCards.length === 0) {
    const data = await api('/api/cc/cards');
    _ccCards = data?.cards || [];
  }
  return _ccCards;
}

// Per-item CC section for split form (shown inline in add-item form)
function _buildDivCcSection(existingCcInfo) {
  const cards = _ccCards;
  if (!cards.length) return '';
  const opts = cards.map(c =>
    `<option value="${c.id}" data-disc="${c.default_discount_pct}" ${existingCcInfo?.cardId === c.id ? 'selected' : ''}>${escHtml(c.card_name)} (${escHtml(c.bank_name)} **${escHtml(c.last4)})</option>`
  ).join('');
  const firstDisc = existingCcInfo?.discountPct ?? (cards[0]?.default_discount_pct || 0);
  const checked = existingCcInfo ? 'checked' : '';
  return `<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px">
    <label class="fc" style="margin-bottom:8px"><input type="checkbox" id="divCcCheck" ${checked} onchange="divCcToggle()"><span style="font-weight:600">Charge full amount to my Credit Card</span></label>
    <div id="divCcSection" style="${checked ? '' : 'display:none'}">
      <div class="fg" style="margin-top:8px">
        <label class="fl">Card<select class="fi" id="divCcCard" onchange="divCcCardChanged()">${opts}</select></label>
        <label class="fl">Discount %<input class="fi" type="number" step="0.1" id="divCcDisc" value="${firstDisc}" min="0" max="100" oninput="divCcPreview()"></label>
      </div>
      <div id="divCcPreview" style="font-size:12px;color:var(--t2);margin-top:2px"></div>
    </div>
  </div>`;
}

function divCcToggle() {
  const show = document.getElementById('divCcCheck')?.checked;
  const sec = document.getElementById('divCcSection');
  if (sec) sec.style.display = show ? '' : 'none';
  if (show) divCcPreview();
}

function divCcCardChanged() {
  const sel = document.getElementById('divCcCard');
  const disc = parseFloat(sel?.selectedOptions[0]?.dataset?.disc || 0);
  const discEl = document.getElementById('divCcDisc');
  if (discEl) discEl.value = disc;
  divCcPreview();
}

function divCcPreview() {
  const amt = parseFloat(document.getElementById('dAmount')?.value) || 0;
  const disc = parseFloat(document.getElementById('divCcDisc')?.value) || 0;
  const net = Math.round((amt - amt * disc / 100) * 100) / 100;
  const el = document.getElementById('divCcPreview');
  if (el && amt) el.innerHTML = `Full amount charged to card: <strong style="color:var(--em)">${fmtCur(net)}</strong> after ${disc}% discount`;
  else if (el) el.innerHTML = '';
}

function ccFormSection(existingLink = null) {
  const cards = _ccCards;
  if (!cards.length) return '';
  const opts = cards.map(c =>
    `<option value="${c.id}" data-disc="${c.default_discount_pct}" ${existingLink?.card_id == c.id ? 'selected' : ''}>${escHtml(c.card_name)} (${escHtml(c.bank_name)} **${escHtml(c.last4)})</option>`
  ).join('');
  const firstDisc = existingLink?.discount_pct ?? (cards[0]?.default_discount_pct || 0);
  const checked = existingLink ? 'checked' : '';
  return `<div style="border-top:1px solid var(--border);margin-top:14px;padding-top:14px">
    <label class="fc" style="margin-bottom:8px"><input type="checkbox" id="ccLink" ${checked} onchange="toggleCcLinkSection()"><span style="font-weight:600">Also charge to Credit Card</span></label>
    <div id="ccLinkSection" style="${checked ? '' : 'display:none'}">
      <div class="fg">
        <label class="fl">Card<select class="fi" id="ccLinkCard" onchange="ccLinkCardChanged()">${opts}</select></label>
        <label class="fl">Discount %<input class="fi" type="number" step="0.1" id="ccLinkDisc" value="${firstDisc}" min="0" max="100" oninput="ccLinkPreview()"></label>
      </div>
      <div id="ccLinkPreview" style="font-size:12px;color:var(--t2);margin-top:2px"></div>
    </div>
  </div>`;
}

function toggleCcLinkSection() {
  const show = document.getElementById('ccLink')?.checked;
  const sec = document.getElementById('ccLinkSection');
  if (sec) sec.style.display = show ? '' : 'none';
  if (show) ccLinkPreview();
}

function ccLinkCardChanged() {
  const sel = document.getElementById('ccLinkCard');
  const disc = parseFloat(sel?.selectedOptions[0]?.dataset?.disc || 0);
  const discEl = document.getElementById('ccLinkDisc');
  if (discEl) discEl.value = disc;
  ccLinkPreview();
}

function ccLinkPreview() {
  const amtEl = document.getElementById('eAmount') || document.getElementById('teAmount') || document.getElementById('dAmount') || document.getElementById('ctAmt');
  const amt = parseFloat(amtEl?.value) || 0;
  const disc = parseFloat(document.getElementById('ccLinkDisc')?.value) || 0;
  const net = Math.round((amt - amt * disc / 100) * 100) / 100;
  const el = document.getElementById('ccLinkPreview');
  if (el && amt) el.innerHTML = `Net charged to card: <strong style="color:var(--em)">${fmtCur(net)}</strong>`;
  else if (el) el.innerHTML = '';
}

async function saveCcLinkIfChecked(description, amount, txnDate, source, sourceId) {
  if (!document.getElementById('ccLink')?.checked) return;
  const cardId = parseInt(document.getElementById('ccLinkCard')?.value);
  const discPct = parseFloat(document.getElementById('ccLinkDisc')?.value) || 0;
  if (!cardId || !amount) return;
  await api('/api/cc/txns', { method: 'POST', body: {
    card_id: cardId, txn_date: txnDate, description, amount, discount_pct: discPct,
    source: source || 'manual', source_id: sourceId || null,
  }});
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BANK ACCOUNTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let _bankAccounts = [];

function _findBankAccountById(id) {
  return (_bankAccounts || []).find((account) => account?.id != null && id != null && String(account.id) === String(id)) || null;
}

function _findTrackerById(id) {
  return (_trackers || []).find((tracker) => tracker?.id != null && id != null && String(tracker.id) === String(id)) || null;
}

function _findRecurringEntryById(id) {
  return (_recurringEntries || []).find((entry) => entry?.id != null && id != null && String(entry.id) === String(id)) || null;
}

async function loadBankAccounts() {
  document.getElementById('main').innerHTML = '<div class="tab-content"><div style="color:var(--t3);padding:40px;text-align:center">Loadingâ€¦</div></div>';
  const data = await api('/api/banks');
  _bankAccounts = data?.accounts || [];
  renderBankAccounts();
}

function renderBankAccounts() {
  const accounts = _bankAccounts;
  const totalBal   = accounts.reduce((s, a) => s + a.balance, 0);
  const totalMin   = accounts.reduce((s, a) => s + a.min_balance, 0);
  const spendable  = totalBal - totalMin;

  const statBar = `
    <div class="bank-summary-bar">
      <div class="bank-stat"><div class="lbl">Total Balance</div><div class="val">${fmtCur(totalBal)}</div></div>
      <div class="bank-stat"><div class="lbl">Locked (Min Balance)</div><div class="val red">${fmtCur(totalMin)}</div></div>
      <div class="bank-stat"><div class="lbl">Spendable</div><div class="val green">${fmtCur(spendable)}</div></div>
      <div class="bank-stat"><div class="lbl">Accounts</div><div class="val">${accounts.length}</div></div>
    </div>`;

  const grid = accounts.length
    ? accounts.map(a => {
        const spnd = a.balance - a.min_balance;
        const typeLabel = { savings: 'Savings', current: 'Current', salary: 'Salary' }[a.account_type] || a.account_type;
        return `<div class="bank-card${a.is_default ? ' bank-card-default' : ''}" id="bankCard_${a.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div class="bank-card-name">${escHtml(a.bank_name)}${a.account_name ? ' â€” ' + escHtml(a.account_name) : ''}
                ${a.is_default ? '<span class="bank-default-badge">Default</span>' : ''}
              </div>
              <div class="bank-card-type">${typeLabel}</div>
            </div>
          </div>
          <div class="bank-card-balance-wrap" id="bankBalWrap_${a.id}" onclick="startBalanceEdit(${a.id}, ${a.balance})" title="Click to edit balance">
            <div class="bank-card-balance bank-bal-display" id="bankBalDisplay_${a.id}">${fmtCur(a.balance)}</div>
            <span class="bank-bal-edit-hint">Edit</span>
          </div>
          <div class="bank-card-spendable" id="bankSpend_${a.id}">Spendable: ${fmtCur(Math.max(0, spnd))}</div>
          <div class="bank-card-minbal">Min. balance locked: ${fmtCur(a.min_balance)}</div>
          <div class="bank-card-actions">
            <button class="btn btn-s btn-sm" onclick="showBankModal(${a.id})">Edit</button>
            ${!a.is_default ? `<button class="btn btn-sm" style="border:1px solid var(--acc);background:transparent;color:var(--acc)" onclick="setDefaultBank(${a.id})">Set Default</button>` : ''}
            <button class="btn-d" onclick="deleteBankAccount(${a.id})">Delete</button>
          </div>
        </div>`;
      }).join('')
    : `<div style="color:var(--t3);text-align:center;padding:40px;background:var(--white);border-radius:16px;border:2px dashed var(--border);grid-column:1/-1">
        <div style="font-size:32px;margin-bottom:12px">Bank</div>
        <div style="font-weight:600;margin-bottom:6px">No bank accounts added yet</div>
        <div style="font-size:13px">Click "Add Account" to track your balances</div>
      </div>`;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="margin-bottom:20px">
        <div class="summary-top">
          <div>
            <div class="summary-label">TOTAL SPENDABLE BALANCE</div>
            <div class="summary-amount">${fmtCur(spendable)}</div>
            <div class="summary-words">${amountWords(spendable)}</div>
          </div>
          <div class="count-box"><div class="num">${accounts.length}</div><div class="lbl">accounts</div></div>
        </div>
      </div>
      ${statBar}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-size:16px;font-weight:700">My Bank Accounts</div>
        <button class="btn btn-p btn-sm" onclick="showBankModal()">+ Add Account</button>
      </div>
      <div class="bank-grid">${grid}</div>
    </div>`;
}

function showBankModal(id) {
  const a = id ? (_findBankAccountById(id) || { bank_name: '', account_name: '', account_type: 'savings', balance: '', min_balance: '' }) : { bank_name: '', account_name: '', account_type: 'savings', balance: '', min_balance: '' };
  openModal(id ? 'Edit Bank Account' : 'Add Bank Account', `
    <div class="fg">
      <label class="fl">Bank Name *<input class="fi" id="baBank" value="${escHtml(a.bank_name)}" placeholder="e.g. HDFC, SBI, ICICI"></label>
      <label class="fl">Account Name<input class="fi" id="baName" value="${escHtml(a.account_name || '')}" placeholder="e.g. Primary Savings"></label>
      <label class="fl">Account Type<select class="fi" id="baType">
        <option value="savings" ${a.account_type==='savings'?'selected':''}>Savings</option>
        <option value="current" ${a.account_type==='current'?'selected':''}>Current</option>
        <option value="salary" ${a.account_type==='salary'?'selected':''}>Salary</option>
      </select></label>
      <label class="fl">Current Balance (&#8377;) *<input class="fi" type="number" step="0.01" id="baBal" value="${a.balance || ''}" placeholder="0.00"></label>
      <label class="fl">Minimum Balance (&#8377;)<input class="fi" type="number" step="0.01" id="baMin" value="${a.min_balance || ''}" placeholder="0.00">
        <span style="font-size:11px;color:var(--t3);margin-top:3px;display:block">Amount you cannot spend (locked by bank)</span>
      </label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveBankAccount(${id || 'null'})">${id ? 'Update' : 'Add Account'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveBankAccount(id) {
  const body = {
    bank_name: document.getElementById('baBank').value.trim(),
    account_name: document.getElementById('baName').value.trim(),
    account_type: document.getElementById('baType').value,
    balance: Number(document.getElementById('baBal').value),
    min_balance: Number(document.getElementById('baMin').value || 0),
  };
  if (!body.bank_name) { toast('Bank name is required', 'warning'); return; }
  if (body.bank_name.length > 80) { toast('Bank name must be 80 characters or fewer', 'warning'); return; }
  if (body.account_name && body.account_name.length > 80) { toast('Account name must be 80 characters or fewer', 'warning'); return; }
  if (!Number.isFinite(body.balance) || body.balance < 0) { toast('Current balance must be 0 or more', 'warning'); return; }
  if (!Number.isFinite(body.min_balance) || body.min_balance < 0) { toast('Minimum balance must be 0 or more', 'warning'); return; }
  if (body.min_balance > body.balance) { toast('Minimum balance cannot be greater than current balance', 'warning'); return; }
  const r = id ? await api(`/api/banks/${id}`, { method: 'PUT', body }) : await api('/api/banks', { method: 'POST', body });
  if (r?.success || r?.id) { closeModal(); toast(id ? 'Account updated' : 'Account added', 'success'); loadBankAccounts(); }
  else toast(r?.error || 'Failed', 'error');
}

function showUpdateBalanceModal(id) {
  const a = _findBankAccountById(id);
  if (!a) return;
  openModal('Update Balance', `
    <div style="font-size:13px;color:var(--t2);margin-bottom:12px">${escHtml(a.bank_name)}${a.account_name ? ' â€” ' + escHtml(a.account_name) : ''}</div>
    <label class="fl">Current Balance (&#8377;)<input class="fi" type="number" step="0.01" id="baNewBal" value="${a.balance}" autofocus></label>
    <div class="fa" style="margin-top:14px">
      <button class="btn btn-p" onclick="doUpdateBalance(${id})">Update</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function doUpdateBalance(id) {
  const balance = parseFloat(document.getElementById('baNewBal').value);
  if (isNaN(balance) || balance < 0) { toast('Enter a valid balance (0 or more)', 'warning'); return; }
  const a = _findBankAccountById(id);
  const r = await api(`/api/banks/${id}`, { method: 'PUT', body: { ...a, balance } });
  if (r?.success) { closeModal(); toast('Balance updated', 'success'); loadBankAccounts(); }
  else toast(r?.error || 'Failed', 'error');
}

async function deleteBankAccount(id) {
  if (!await confirmDialog('Delete this bank account?')) return;
  const r = await api(`/api/banks/${id}`, { method: 'DELETE' });
  if (r?.success) { toast('Deleted', 'success'); loadBankAccounts(); }
  else toast(r?.error || 'Failed', 'error');
}

async function setDefaultBank(id) {
  const r = await api(`/api/banks/${id}/default`, { method: 'PUT' });
  if (r?.success) { toast('Default bank updated', 'success'); loadBankAccounts(); }
  else toast(r?.error || 'Failed', 'error');
}

function startBalanceEdit(id, currentBalance) {
  const wrap = document.getElementById(`bankBalWrap_${id}`);
  if (!wrap || wrap.querySelector('input')) return;
  wrap.onclick = null;
  wrap.title = '';
  wrap.innerHTML = `
    <input type="number" id="bankBalInput_${id}" class="bank-bal-input" value="${currentBalance}" step="0.01" min="0" autofocus>
    <button class="bank-bal-btn bank-bal-save" onclick="saveInlineBalance(${id})" title="Save">&#10003;</button>
    <button class="bank-bal-btn bank-bal-cancel" onclick="cancelBalanceEdit(${id})" title="Cancel">&#10005;</button>`;
  const input = document.getElementById(`bankBalInput_${id}`);
  input.focus();
  input.select();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveInlineBalance(id);
    if (e.key === 'Escape') cancelBalanceEdit(id);
  });
}

async function saveInlineBalance(id) {
  const input = document.getElementById(`bankBalInput_${id}`);
  if (!input) return;
  const val = parseFloat(input.value);
  if (isNaN(val) || val < 0) { toast('Invalid amount', 'warning'); return; }
  const r = await api(`/api/banks/${id}/balance`, { method: 'PATCH', body: { balance: val } });
  if (r?.success) { toast('Balance updated', 'success'); loadBankAccounts(); }
  else { toast(r?.error || 'Failed', 'error'); cancelBalanceEdit(); }
}

function cancelBalanceEdit() {
  loadBankAccounts();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MONTHLY PLANNER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function _localYM(d) { d = d || new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function _addMonths(ym, n) { const [y,m]=ym.split('-').map(Number); const d=new Date(y,m-1+n,1); return _localYM(d); }
let _plannerMonth = _localYM();
let _plannerView  = 'monthly'; // 'monthly' | 'defaults'
const _todayMonth = _localYM();
let _previewBankBalances = {}; // in-memory overrides for preview mode {bankId: balance}
let _previewDataCache   = null; // cached preview response
let _defaultsCount = null; // cached count of active default payments

function invalidatePlannerPreviewCache() {
  _previewDataCache = null;
  _previewBankBalances = {};
}

async function loadPlanner() {
  invalidatePlannerPreviewCache();
  document.getElementById('main').innerHTML = '<div class="tab-content"><div style="color:var(--t3);padding:40px;text-align:center">Loading...</div></div>';
  await renderPlanner();
}

async function renderPlanner() {
  // Clamp to current month or one month ahead
  const _maxPlannerMonth = _addMonths(_todayMonth, 1);
  if (_plannerMonth < _todayMonth) _plannerMonth = _todayMonth;
  if (_plannerMonth > _maxPlannerMonth) _plannerMonth = _maxPlannerMonth;

  const isFuture = _plannerMonth > _todayMonth;

  // Month nav
  const [yr, mo] = _plannerMonth.split('-').map(Number);
  const nextMonth  = _addMonths(_plannerMonth, 1);
  const monthLabel = new Date(yr, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const futureBadge = isFuture
    ? `<span style="background:rgba(99,102,241,0.12);color:#6366f1;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;margin-left:8px">Preview</span>`
    : '';

  const canGoPrev = _plannerMonth > _todayMonth;
  const canGoNext = _plannerMonth < _maxPlannerMonth;

  const monthNav = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <button class="btn btn-g btn-sm" ${canGoPrev ? `onclick="_plannerMonth='${_todayMonth}';_previewBankBalances={};_previewDataCache=null;renderPlanner()"` : 'disabled style="opacity:0.3;cursor:default"'}>&lsaquo;</button>
      <div style="font-size:18px;font-weight:700;flex:1;text-align:center">${monthLabel}${futureBadge}</div>
      <button class="btn btn-s btn-sm" onclick="downloadPlannerPdf()">PDF</button>
      <button class="btn btn-g btn-sm" ${canGoNext ? `onclick="_plannerMonth='${nextMonth}';_previewBankBalances={};_previewDataCache=null;renderPlanner()"` : 'disabled style="opacity:0.3;cursor:default"'}>&rsaquo;</button>
    </div>`;

  const defaultsLabel = `Default Payments${_defaultsCount !== null ? ` (${_defaultsCount})` : ''}`;
  const tabs = [['monthly','This Month'],['defaults', defaultsLabel]].map(([k,l]) =>
    `<button class="chip ${_plannerView===k?'active':''}" onclick="_plannerView='${k}';renderPlanner()">${l}</button>`
  ).join('');

  let bodyHtml = '';
  if (_plannerView === 'monthly') {
    if (isFuture) {
      // Preview mode: fetch projected data, no DB writes
      if (!_previewDataCache) {
        _previewDataCache = await api(`/api/planner/preview?month=${_plannerMonth}`);
      }
      const pd = _previewDataCache || {};
      _bankAccounts = pd.accounts || [];
      bodyHtml = renderPlannerPreview(pd.projectedDefaults || [], _bankAccounts, pd.projectedCcDues || [], pd.emiDues || []);
    } else {
      const [data, banksData, dData] = await Promise.all([
        api(`/api/planner/monthly?month=${_plannerMonth}`),
        api('/api/banks'),
        _defaultsCount === null ? api('/api/planner/defaults') : Promise.resolve(null),
      ]);
      _bankAccounts = banksData?.accounts || [];
      if (dData) _defaultsCount = (dData.defaults || []).filter(d => d.is_active).length;
      bodyHtml = renderPlannerMonthly(data?.payments || [], _bankAccounts, data?.ccDues || [], data?.skipped || [], data?.emiDues || []);
    }
  } else {
    const banksData = await api('/api/banks');
    _bankAccounts = banksData?.accounts || [];
    const dData = await api('/api/planner/defaults');
    _defaultsCount = (dData?.defaults || []).filter(d => d.is_active).length;
    bodyHtml = renderPlannerDefaults(dData?.defaults || []);
  }

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      ${monthNav}
      <div class="chip-group" style="margin-bottom:20px">${tabs}</div>
      ${bodyHtml}
    </div>`;
}

// â”€â”€ Live preview of new balance as user types (updates tooltip only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function previewAddBalance(bankId, addVal, baseBalance) {
  const add = parseFloat(addVal) || 0;
  const newBal = baseBalance + add;
  const el = document.getElementById(`prevBalPreview_${bankId}`);
  if (el) {
    el.textContent = add !== 0 ? `New balance: ${fmtCur(newBal)}` : '';
    el.style.color = add > 0 ? 'var(--green)' : add < 0 ? 'var(--red)' : 'var(--t3)';
  }
}

// â”€â”€ Apply the added amount and re-render summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function applyPreviewBalance(bankId, baseBalance) {
  const inp = document.getElementById(`addBal_${bankId}`);
  const add = parseFloat(inp?.value) || 0;
  _previewBankBalances[bankId] = baseBalance + add;
  const pd = _previewDataCache || {};
  const accounts = (_bankAccounts || []).map(a => ({
    ...a,
    balance: _previewBankBalances[a.id] !== undefined ? _previewBankBalances[a.id] : a.balance,
  }));
  const summaryEl = document.getElementById('previewSummarySection');
  if (summaryEl) summaryEl.innerHTML = _renderPreviewSummary(accounts, pd.projectedDefaults || [], pd.projectedCcDues || [], pd.emiDues || []);
}

// â”€â”€ Reset a bank's simulated balance back to actual â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function resetPreviewBalance(bankId) {
  delete _previewBankBalances[bankId];
  const pd = _previewDataCache || {};
  const accounts = (_bankAccounts || []).map(a => ({
    ...a,
    balance: _previewBankBalances[a.id] !== undefined ? _previewBankBalances[a.id] : a.balance,
  }));
  const summaryEl = document.getElementById('previewSummarySection');
  if (summaryEl) summaryEl.innerHTML = _renderPreviewSummary(accounts, pd.projectedDefaults || [], pd.projectedCcDues || [], pd.emiDues || []);
}

function _renderPreviewSummary(accounts, defaults, ccDues, emiDues) {
  const emiUnpaid = (emiDues || []).filter(i => (parseFloat(i.paid_amount) || 0) < (parseFloat(i.emi_amount) || 0) * 0.999);
  const totalDue  = Math.round((defaults.reduce((s, p) => s + p.amount, 0) + ccDues.reduce((s, c) => s + c.net_payable, 0) + emiUnpaid.reduce((s, i) => s + ((parseFloat(i.emi_amount) || 0) - (parseFloat(i.paid_amount) || 0)), 0)) * 100) / 100;
  const totalBal  = Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100;
  const spendable = Math.round(accounts.reduce((s, a) => s + (a.balance - (a.min_balance || 0)), 0) * 100) / 100;
  const afterPay  = Math.round((spendable - totalDue) * 100) / 100;
  const surplus   = afterPay >= 0;

  const bankRows = accounts.map(a => {
    const assigned = defaults.filter(p => p.bank_account_id == a.id);
    const ccForBank = a.is_default ? ccDues : [];
    const due = Math.round((assigned.reduce((s, p) => s + p.amount, 0) + ccForBank.reduce((s, c) => s + c.net_payable, 0)) * 100) / 100;
    const bankSpend = Math.round((a.balance - (a.min_balance || 0)) * 100) / 100;
    const diff = Math.round((bankSpend - due) * 100) / 100;
    const ok = diff >= 0;
    const acctSuffix = a.account_name ? ` <span style="color:var(--t3);font-weight:400"> - ${escHtml(a.account_name)}</span>` : '';
    const override = _previewBankBalances[a.id] !== undefined;
    return `<div class="bank-due-row" style="flex-direction:column;align-items:flex-start;gap:6px">
      <div style="display:flex;align-items:center;gap:8px;width:100%;flex-wrap:wrap">
        <div class="bank-due-name" style="margin:0">${escHtml(a.bank_name)}${acctSuffix}${a.is_default ? ' <span class="bank-default-badge" style="font-size:10px">Default</span>' : ''}</div>
        <span style="color:var(--t2);font-size:13px">Balance: <strong style="font-family:var(--mono)">${fmtCur(a.balance)}</strong>${override ? ' <span style="background:rgba(99,102,241,0.12);color:#6366f1;font-size:10px;padding:1px 6px;border-radius:4px">simulated</span>' : ''}</span>
        <span style="color:var(--t2);font-size:13px">Spendable: <strong>${fmtCur(bankSpend)}</strong></span>
        <span style="color:var(--t2);font-size:13px">Dues: <strong>${fmtCur(due)}</strong></span>
        <span style="color:${ok ? 'var(--green)' : 'var(--red)'}"><strong>${ok ? 'Surplus' : 'Shortfall'}: ${fmtCur(Math.abs(diff))}</strong></span>
        ${override ? `<button onclick="resetPreviewBalance(${a.id})" style="font-size:11px;color:var(--red);background:none;border:none;cursor:pointer;padding:0;text-decoration:underline">Reset</button>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--t3)">+ Add to balance:</span>
        <input type="number" id="addBal_${a.id}" step="0.01" placeholder="e.g. 5000"
          style="width:110px;padding:3px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;font-family:var(--mono)"
          oninput="previewAddBalance(${a.id}, this.value, ${a.balance})"
          onkeydown="if(event.key==='Enter') applyPreviewBalance(${a.id}, ${a.balance})">
        <button onclick="applyPreviewBalance(${a.id}, ${a.balance})"
          style="padding:3px 10px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">Apply</button>
        <span id="prevBalPreview_${a.id}" style="font-size:12px;font-weight:600"></span>
      </div>
    </div>`;
  });

  return `
    <div style="background:rgba(99,102,241,0.06);border:1.5px dashed rgba(99,102,241,0.3);border-radius:12px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#6366f1;margin-bottom:4px">Preview Mode</div>
      <div style="font-size:12px;color:var(--t2)">Amounts are projected from your defaults, active EMIs, and estimated CC dues (based on latest cycle). <strong>Edit any bank balance below</strong> to simulate your future position - changes are not saved.</div>
    </div>
    <div class="planner-summary">
      <div class="pl-stat"><div class="lbl">Projected Due</div><div class="val">${fmtCur(totalDue)}</div></div>
      <div class="pl-stat"><div class="lbl">Bank Balance</div><div class="val">${fmtCur(totalBal)}</div></div>
      <div class="pl-stat"><div class="lbl">Bank Spendable</div><div class="val">${fmtCur(spendable)}</div></div>
      <div class="pl-stat"><div class="lbl">After All Dues</div><div class="val" style="color:${surplus ? 'var(--green)' : 'var(--red)'}">${fmtCur(afterPay)}</div></div>
    </div>
    <div class="pl-result ${surplus ? 'surplus' : 'deficit'}">
      <div class="pl-result-label" style="color:${surplus ? 'var(--green)' : 'var(--red)'}">${surplus ? 'After paying all projected dues you will have' : 'Projected shortfall - you need'}</div>
      <div class="pl-result-amt" style="color:${surplus ? 'var(--green)' : 'var(--red)'}">${fmtCur(Math.abs(afterPay))}</div>
      <div style="font-size:12px;color:var(--t2);margin-top:4px">Balance: ${fmtCur(totalBal)} &nbsp;&middot;&nbsp; Spendable: ${fmtCur(spendable)} &nbsp;&middot;&nbsp; Dues: ${fmtCur(totalDue)}</div>
    </div>
    ${accounts.length ? `<div class="bank-breakdown-wrap">
      <div style="font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Bank-wise Simulation</div>
      ${bankRows.join('')}
    </div>` : ''}`;
}

function renderPlannerPreview(defaults, accounts, ccDues, emiDues) {
  // Apply any in-memory balance overrides
  const accs = accounts.map(a => ({
    ...a,
    balance: _previewBankBalances[a.id] !== undefined ? _previewBankBalances[a.id] : a.balance,
  }));

  const summaryHtml = _renderPreviewSummary(accs, defaults, ccDues, emiDues);

  // Payment list rows (read-only, no action buttons)
  const previewPayRow = (p) => {
    const bankAcc = p.bank_account_id ? accounts.find(a => a.id == p.bank_account_id) : null;
    const bankLabel = bankAcc ? `<span style="background:var(--bg2);color:var(--t2);font-size:10px;padding:1px 6px;border-radius:99px;margin-left:5px">${escHtml(bankAcc.bank_name)}</span>` : '';
    const sourceTag = p.daily_tracker_id
      ? '<span style="font-size:10px;color:var(--t3);font-weight:400">daily tracker</span>'
      : '<span style="font-size:10px;color:var(--t3);font-weight:400">recurring</span>';
    return `<div class="pay-row">
      <div class="pay-row-check" style="background:var(--bg2);cursor:default"></div>
      <div style="flex:1;min-width:0">
        <div class="pay-row-name">${escHtml(p.name)} ${sourceTag}${bankLabel}</div>
        <div class="pay-row-sub">Due ${fmtDate(p.due_date)}</div>
      </div>
      <div class="pay-row-amt">${fmtCur(p.amount)}</div>
    </div>`;
  };

  const previewCcRow = (c) => `<div class="pay-row" style="border-left:3px solid var(--blue)">
    <div class="pay-row-check" style="background:rgba(59,130,246,0.08);cursor:default"></div>
    <div style="flex:1;min-width:0">
      <div class="pay-row-name">
        <span style="background:var(--blue-l);color:var(--blue);font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;margin-right:6px">CC</span>
        ${escHtml(c.card_name)}
        <span style="font-size:11px;color:var(--t3);font-weight:400">${escHtml(c.bank_name)} **${escHtml(String(c.last4))}</span>
        ${c.is_projected ? '<span style="background:rgba(99,102,241,0.1);color:#6366f1;font-size:10px;padding:1px 5px;border-radius:4px;margin-left:4px">estimated</span>' : ''}
      </div>
      <div class="pay-row-sub">Due ${fmtDate(c.due_date)} &middot; Cycle ${fmtDate(c.cycle_start)} to ${fmtDate(c.cycle_end)}</div>
    </div>
    <div class="pay-row-amt">${c.net_payable > 0 ? fmtCur(c.net_payable) : '<span style="color:var(--t3);font-size:12px">TBD</span>'}</div>
  </div>`;

  const previewEmiRow = (i) => `<div class="pay-row" style="border-left:3px solid var(--green)">
    <div class="pay-row-check" style="background:var(--green)22;cursor:default"></div>
    <div style="flex:1;min-width:0">
      <div class="pay-row-name">
        <span style="background:var(--green)22;color:var(--green);font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;margin-right:6px">EMI</span>
        ${escHtml(i.emi_name)}
        <span style="font-size:11px;color:var(--t3);font-weight:400">Installment #${i.installment_no}</span>
      </div>
      <div class="pay-row-sub">Due ${fmtDate(i.due_date)}</div>
    </div>
    <div class="pay-row-amt">${fmtCur(i.emi_amount)}</div>
  </div>`;

  const allItems = [
    ...ccDues.map(c  => ({ _type: 'cc',  _data: c, due_date: c.due_date })),
    ...(emiDues.filter(i => i.paid_amount < i.emi_amount * 0.999)).map(i => ({ _type: 'emi', _data: i, due_date: i.due_date })),
    ...defaults.map(p => ({ _type: 'pay', _data: p, due_date: p.due_date || '' })),
  ].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));

  const rows = allItems.length
    ? allItems.map(item =>
        item._type === 'cc'  ? previewCcRow(item._data) :
        item._type === 'emi' ? previewEmiRow(item._data) :
                               previewPayRow(item._data)
      ).join('')
    : `<div style="color:var(--t3);padding:16px;text-align:center;font-size:13px">No projected payments for this month.</div>`;

  return `
    <div id="previewSummarySection">${summaryHtml}</div>
    <div style="font-size:14px;font-weight:700;margin-bottom:8px">Projected Payments (${allItems.length})</div>
    <div class="table-wrap">${rows}</div>
    <div style="font-size:12px;color:var(--t3);margin-top:12px;padding:0 4px">
      CC amounts are estimated from your latest billing cycle. Actual amounts may vary.
      This view does not save or modify any data.
    </div>`;
}

function _bankDropdownOptions(selectedId) {
  const opts = `<option value="">-- None (Unassigned) --</option>` +
    _bankAccounts.map(a =>
      `<option value="${a.id}" ${selectedId == a.id ? 'selected' : ''}>${escHtml(a.bank_name)}${a.account_name ? ' - ' + escHtml(a.account_name) : ''}${a.is_default ? ' (Default)' : ''}</option>`
    ).join('');
  return opts;
}

function renderPlannerMonthly(payments, accounts, ccDues, skipped, emiDues) {
  ccDues   = ccDues   || [];
  skipped  = skipped  || [];
  emiDues  = emiDues  || [];

  // Totals â€” include CC dues + EMI dues in remaining calculation
  const ccUnpaid    = ccDues.filter(c => c.status !== 'paid');
  const ccPaidList  = ccDues.filter(c => c.status === 'paid');
  const emiUnpaid   = emiDues.filter(i => i.paid_amount < i.emi_amount * 0.999);
  const emiPaidList = emiDues.filter(i => i.paid_amount >= i.emi_amount * 0.999);
  const emiTotal    = emiUnpaid.reduce((s, i) => s + (i.emi_amount - i.paid_amount), 0);
  const totalDue    = Math.round((payments.reduce((s, p) => s + p.amount, 0) + ccUnpaid.reduce((s, c) => s + c.net_payable, 0) + emiUnpaid.reduce((s, i) => s + i.emi_amount, 0)) * 100) / 100;
  const totalPaid   = Math.round((payments.reduce((s, p) => s + p.paid_amount, 0) + ccPaidList.reduce((s, c) => s + c.paid_amount, 0) + emiPaidList.reduce((s, i) => s + i.paid_amount, 0)) * 100) / 100;
  const remaining   = Math.round((payments.filter(p => p.status !== 'paid').reduce((s, p) => s + p.amount - p.paid_amount, 0) + ccUnpaid.reduce((s, c) => s + c.net_payable - c.paid_amount, 0) + emiTotal) * 100) / 100;
  const totalBal    = Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100;
  const spendable   = Math.round(accounts.reduce((s, a) => s + (a.balance - a.min_balance), 0) * 100) / 100;
  const afterPay    = Math.round((spendable - remaining) * 100) / 100;
  const surplus     = afterPay >= 0;

  const summaryBar = `
    <div class="planner-summary">
      <div class="pl-stat"><div class="lbl">Total Due This Month</div><div class="val">${fmtCur(totalDue)}</div></div>
      <div class="pl-stat"><div class="lbl">Already Paid</div><div class="val green">${fmtCur(totalPaid)}</div></div>
      <div class="pl-stat"><div class="lbl">Remaining to Pay</div><div class="val amber">${fmtCur(remaining)}</div></div>
      <div class="pl-stat"><div class="lbl">Bank Spendable</div><div class="val">${fmtCur(spendable)}</div></div>
    </div>
    <div class="pl-result ${surplus ? 'surplus' : 'deficit'}">
      <div class="pl-result-label" style="color:${surplus ? 'var(--green)' : 'var(--red)'}">${surplus ? 'After paying all dues you will have' : 'Shortfall - you need'}</div>
      <div class="pl-result-amt" style="color:${surplus ? 'var(--green)' : 'var(--red)'}">${fmtCur(Math.abs(afterPay))}</div>
      <div style="font-size:12px;color:var(--t2);margin-top:4px">Bank balance: ${fmtCur(totalBal)} &nbsp;&middot;&nbsp; Spendable: ${fmtCur(spendable)} &nbsp;&middot;&nbsp; Remaining dues: ${fmtCur(remaining)}</div>
    </div>`;

  // Per-bank breakdown
  const defaultBank = accounts.find(a => a.is_default);
  const perBankHtml = accounts.length ? (() => {
    const bankRows = accounts.map(a => {
      const assigned = payments.filter(p => p.bank_account_id == a.id && p.status !== 'paid');
      // CC dues are not per-bank yet; assign all CC dues to default bank
      const ccForBank = (a.is_default ? ccUnpaid : []);
      const due = Math.round((assigned.reduce((s, p) => s + (p.amount - p.paid_amount), 0) + ccForBank.reduce((s, c) => s + (c.net_payable - c.paid_amount), 0)) * 100) / 100;
      const bankSpend = Math.round((a.balance - a.min_balance) * 100) / 100;
      const diff = Math.round((bankSpend - due) * 100) / 100;
      const ok = diff >= 0;
      const acctSuffix = a.account_name ? ` <span style="color:var(--t3);font-weight:400"> - ${escHtml(a.account_name)}</span>` : '';
      return `<div class="bank-due-row">
        <div class="bank-due-name">${escHtml(a.bank_name)}${acctSuffix}${a.is_default ? ' <span class="bank-default-badge" style="font-size:10px">Default</span>' : ''}</div>
        <div class="bank-due-stats">
          <span>Balance: <strong>${fmtCur(a.balance)}</strong></span>
          <span>Spendable: <strong>${fmtCur(bankSpend)}</strong></span>
          <span>Assigned dues: <strong>${fmtCur(due)}</strong></span>
          <span style="color:${ok ? 'var(--green)' : 'var(--red)'}"><strong>${ok ? 'Surplus' : 'Shortfall'}: ${fmtCur(Math.abs(diff))}</strong></span>
        </div>
      </div>`;
    });
    // Unassigned payments (no bank set, excluding those auto-assigned to default)
    const unassigned = payments.filter(p => !p.bank_account_id && p.status !== 'paid');
    const unassignedNote = (unassigned.length && !defaultBank)
      ? `<div style="font-size:12px;color:var(--amber);padding:6px 0">${unassigned.length} payment(s) not assigned to any bank (${fmtCur(unassigned.reduce((s, p) => s + p.amount - p.paid_amount, 0))})</div>`
      : '';
    return `<div class="bank-breakdown-wrap">
      <div style="font-size:12px;font-weight:700;color:var(--t2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Bank-wise Due Overview</div>
      ${bankRows.join('')}
      ${unassignedNote}
    </div>`;
  })() : '';

  // Regular payment row
  const payRow = (p) => {
    const isPaid    = p.status === 'paid';
    const isPartial = p.status === 'partial';
    const checkCls  = isPaid ? 'done' : isPartial ? 'partial' : '';
    const checkIcon = isPaid ? '&#10003;' : isPartial ? '~' : '';
    const dueLabel  = p.due_date ? `Due ${fmtDate(p.due_date)}` : '';
    const paidLabel = isPaid ? `Paid ${p.paid_date ? fmtDate(p.paid_date) : ''}` : isPartial ? `Partial: ${fmtCur(p.paid_amount)}` : '';
    const bankAcc   = p.bank_account_id ? accounts.find(a => a.id == p.bank_account_id) : null;
    const bankLabel = bankAcc ? `<span style="background:var(--bg2);color:var(--t2);font-size:10px;padding:1px 6px;border-radius:99px;font-weight:500;margin-left:5px">${escHtml(bankAcc.bank_name)}</span>` : '';
    return `<div class="pay-row ${isPaid ? 'paid' : ''}">
      <div class="pay-row-check ${checkCls}" onclick="quickTogglePay(${p.id}, ${isPaid ? 0 : p.amount})" title="${isPaid ? 'Mark unpaid' : 'Mark paid'}">${checkIcon}</div>
      <div style="flex:1;min-width:0">
        <div class="pay-row-name">${escHtml(p.name)}${p.daily_tracker_id ? ' <span style="font-size:10px;color:var(--t3);font-weight:400">daily tracker</span>' : ((p.default_payment_id || p.recurring_entry_id) ? ' <span style="font-size:10px;color:var(--t3);font-weight:400">recurring</span>' : '')}${bankLabel}</div>
        <div class="pay-row-sub">${dueLabel}${paidLabel ? (dueLabel ? ' &middot; ' : '') + paidLabel : ''}</div>
      </div>
      <div class="pay-row-amt ${isPaid ? 'paid' : ''}">${fmtCur(p.amount)}</div>
      <div class="pay-row-actions">
        <button class="btn-d" style="color:var(--em)" onclick="${isPaid ? `quickTogglePay(${p.id}, 0)` : `showPayModal(${p.id},${p.amount})`}">${isPaid ? 'Pending' : 'Pay'}</button>
        <button class="btn-d" style="color:var(--em)" onclick="showEditPaymentModal(${p.id})">Edit</button>
        <button class="btn-d" onclick="deleteMonthlyPayment(${p.id})">Del</button>
      </div>
    </div>`;
  };

  // Credit card due row
  const ccRow = (c) => {
    const isPaid    = c.status === 'paid';
    const isPartial = c.status === 'partial';
    const checkCls  = isPaid ? 'done' : isPartial ? 'partial' : '';
    const checkIcon = isPaid ? '&#10003;' : isPartial ? '~' : '';
    const txnNote   = c.txn_count > 0 ? `${c.txn_count} transaction${c.txn_count > 1 ? 's' : ''}` : 'no transactions yet';
    const paidLabel = isPaid ? `Paid ${c.paid_date ? fmtDate(c.paid_date) : ''}` : isPartial ? `Partial: ${fmtCur(c.paid_amount)}` : '';
    return `<div class="pay-row ${isPaid ? 'paid' : ''}" style="border-left:3px solid var(--blue)">
      <div class="pay-row-check ${checkCls}" onclick="showCcPayModal(${c.id}, ${c.net_payable})" title="Mark CC bill paid">${checkIcon}</div>
      <div style="flex:1;min-width:0">
        <div class="pay-row-name">
          <span style="background:var(--blue-l);color:var(--blue);font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;margin-right:6px">CC</span>
          ${escHtml(c.card_name)}
          <span style="font-size:11px;color:var(--t3);font-weight:400">${escHtml(c.bank_name)} **${escHtml(c.last4)}</span>
        </div>
        <div class="pay-row-sub">Due ${fmtDate(c.due_date)} &middot; Cycle ${fmtDate(c.cycle_start)} to ${fmtDate(c.cycle_end)} &middot; ${txnNote}${paidLabel ? ' &middot; ' + paidLabel : ''}</div>
      </div>
      <div class="pay-row-amt ${isPaid ? 'paid' : ''}">${fmtCur(c.net_payable)}</div>
      <div class="pay-row-actions">
        <button class="btn-d" style="color:var(--em)" onclick="showCcPayModal(${c.id}, ${c.net_payable})">Pay</button>
        <button class="btn-d" style="color:var(--blue)" onclick="_ccSelectedCardId=${c.card_id};_ccView='current';switchTab('creditcards')">View</button>
      </div>
    </div>`;
  };

  // EMI due row
  const emiRow = (i) => `<div class="pay-row" style="border-left:3px solid var(--green)">
    <div class="pay-row-check" title="Mark paid" onclick="showPlannerEmiPayModal(${i.id}, ${i.emi_amount})" style="cursor:pointer"></div>
    <div style="flex:1;min-width:0">
      <div class="pay-row-name">
        <span style="background:var(--green)22;color:var(--green);font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;margin-right:6px">EMI</span>
        ${escHtml(i.emi_name)}
        <span style="font-size:11px;color:var(--t3);font-weight:400">Installment #${i.installment_no}</span>
      </div>
      <div class="pay-row-sub">Due ${fmtDate(i.due_date)}${i.paid_amount > 0 ? ' &middot; Partial: ' + fmtCur(i.paid_amount) : ''}</div>
    </div>
    <div class="pay-row-amt">${fmtCur(i.emi_amount)}</div>
    <div class="pay-row-actions">
      <button class="btn-d" style="color:var(--em)" onclick="showPlannerEmiPayModal(${i.id}, ${i.emi_amount})">Pay</button>
      <button class="btn-d" style="color:var(--green)" onclick="switchTab('emitracker')">View</button>
    </div>
  </div>`;

  const pending    = payments.filter(p => p.status !== 'paid');
  const paid       = payments.filter(p => p.status === 'paid');
  const allPending = [
    ...ccUnpaid.map(c =>   ({ _type: 'cc',  _data: c, due_date: c.due_date })),
    ...emiUnpaid.map(i =>  ({ _type: 'emi', _data: i, due_date: i.due_date })),
    ...pending.map(p =>    ({ _type: 'pay', _data: p, due_date: p.due_date || '' })),
  ].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));

  const pendingRows = allPending.length
    ? allPending.map(item =>
        item._type === 'cc'  ? ccRow(item._data) :
        item._type === 'emi' ? emiRow(item._data) :
                               payRow(item._data)
      ).join('')
    : `<div style="color:var(--t3);padding:16px;text-align:center;font-size:13px">All paid!</div>`;

  const emiPaidRow = (i) => `<div class="pay-row paid" style="border-left:3px solid var(--green)">
    <div class="pay-row-check done" style="background:var(--green)22;color:var(--green)" onclick="doPlannerEmiUnpay(${i.id})" title="Move back to pending">&#10003;</div>
    <div style="flex:1;min-width:0">
      <div class="pay-row-name">
        <span style="background:var(--green)22;color:var(--green);font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;margin-right:6px">EMI</span>
        ${escHtml(i.emi_name)}
        <span style="font-size:11px;color:var(--t3);font-weight:400">Installment #${i.installment_no}</span>
      </div>
      <div class="pay-row-sub">Paid ${i.paid_date ? fmtDate(i.paid_date) : ''} &middot; Due was ${fmtDate(i.due_date)}</div>
    </div>
    <div class="pay-row-amt paid">${fmtCur(i.paid_amount)}</div>
    <div class="pay-row-actions">
      <button class="btn-d" style="color:var(--em)" onclick="doPlannerEmiUnpay(${i.id})">Pending</button>
      <button class="btn-d" style="color:var(--green)" onclick="switchTab('emitracker')">View</button>
    </div>
  </div>`;

  const paidRows = [...ccPaidList.map(c => ccRow(c)), ...emiPaidList.map(i => emiPaidRow(i)), ...paid.map(p => payRow(p))];

  const skippedSection = skipped.length ? `
    <div style="margin-top:16px">
      <div style="font-size:13px;font-weight:600;color:var(--t3);margin-bottom:6px">Skipped this month (${skipped.length})</div>
      <div class="table-wrap">
        ${skipped.map(p => `<div class="pay-row" style="opacity:0.6">
          <div style="flex:1;min-width:0">
            <div class="pay-row-name">${escHtml(p.name)} <span style="font-size:10px;color:var(--t3);font-weight:400">recurring</span></div>
            <div class="pay-row-sub">Removed for this month</div>
          </div>
          <div class="pay-row-amt">${fmtCur(p.amount)}</div>
          <div class="pay-row-actions">
            <button class="btn-d" style="color:var(--green)" onclick="restoreMonthlyPayment(${p.id})">Re-add</button>
            <button class="btn-d" onclick="permanentDeleteDefault(${p.id})">Delete Permanently</button>
          </div>
        </div>`).join('')}
      </div>
    </div>` : '';

  return `
    ${summaryBar}
    ${perBankHtml}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div style="font-size:14px;font-weight:700">Pending (${allPending.length})${emiUnpaid.length ? ' <span style="font-size:11px;color:var(--green);font-weight:500">incl. ' + emiUnpaid.length + ' EMI</span>' : ''}</div>
      <button class="btn btn-p btn-sm" onclick="showAddPaymentModal()">+ Add Payment</button>
    </div>
    <div class="table-wrap" style="margin-bottom:16px">${pendingRows}</div>
    ${paidRows.length ? `<div style="font-size:14px;font-weight:700;margin-bottom:8px;color:var(--t2)">Paid (${paidRows.length})</div>
    <div class="table-wrap">${paidRows.join('')}</div>` : ''}
    ${skippedSection}`;
}

function showPlannerEmiPayModal(instId, emiAmount) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultBank = _bankAccounts.find(a => a.is_default);
  const bankOpts = _bankAccounts.map(a =>
    '<option value="' + a.id + '"' + (a.is_default ? ' selected' : '') + '>' +
    escHtml(a.bank_name) + (a.account_name ? ' - ' + escHtml(a.account_name) : '') + '</option>'
  ).join('');
  const bankNote = defaultBank
    ? '<div style="font-size:12px;color:var(--t3);margin-top:2px">Paid amount will be deducted from selected bank balance</div>'
    : '';
  showModal(
    '<div class="modal-title">Mark EMI Installment Paid</div>' +
    '<div class="fg">' +
    '<label class="fl">Amount Paid (&#8377;)<input class="fi" type="number" id="plannerEmiAmt" value="' + emiAmount.toFixed(2) + '" step="0.01"></label>' +
    '<label class="fl">Payment Date<input class="fi" type="date" id="plannerEmiDate" value="' + today + '"></label>' +
    '</div>' +
    '<label class="fl" style="margin-top:8px">Deduct from Bank' +
    (_bankAccounts.length
      ? '<select class="fi" id="plannerEmiBankId">' + bankOpts + '</select>'
      : '<input class="fi" value="No bank accounts" readonly style="color:var(--t3)">') +
    '</label>' +
    bankNote +
    '<label class="fl" style="margin-top:8px">Notes (optional)<input class="fi" type="text" id="plannerEmiNotes" placeholder="e.g. Paid via NEFT"></label>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
    '<button class="btn btn-p" onclick="doPlannerEmiPay(' + instId + ')">Mark Paid</button>' +
    '<button class="btn btn-g" onclick="closeModal()">Cancel</button>' +
    '</div>'
  );
}

async function doPlannerEmiPay(instId) {
  const paid_amount = parseFloat(document.getElementById('plannerEmiAmt').value);
  const paid_date   = document.getElementById('plannerEmiDate').value;
  const notes       = document.getElementById('plannerEmiNotes').value.trim();
  const bankEl      = document.getElementById('plannerEmiBankId');
  const bank_account_id = bankEl ? (parseInt(bankEl.value) || null) : null;
  if (!paid_amount || !paid_date) { toast('Fill all fields', 'warning'); return; }
  const r = await api('/api/emi/installments/' + instId + '/pay', { method: 'PUT', body: { paid_amount, paid_date, notes, bank_account_id } });
  if (r?.success) {
    closeModal();
    toast('EMI installment marked paid', 'success');
    await renderPlanner();
  } else toast(r?.error || 'Failed', 'error');
}

async function doPlannerEmiUnpay(instId) {
  const r = await api('/api/emi/installments/' + instId + '/pay', {
    method: 'PUT',
    body: { paid_amount: 0, paid_date: null, notes: '' }
  });
  if (r?.success) {
    toast('Moved back to pending', 'success');
    await renderPlanner();
  } else toast(r?.error || 'Failed', 'error');
}

function renderPlannerDefaults(defaults) {
  const active   = defaults.filter(d => d.is_active);
  const inactive = defaults.filter(d => !d.is_active);
  const total    = active.reduce((s, d) => s + d.amount, 0);

  const defRow = (d) => {
    const bankAcc = d.bank_account_id ? _bankAccounts.find(a => a.id == d.bank_account_id) : null;
    const bankLabel = d.auto_detect_bank
      ? `<span style="background:var(--bg2);color:var(--t2);font-size:10px;padding:1px 6px;border-radius:99px">Auto-debit</span>`
      : bankAcc
        ? `<span style="background:var(--bg2);color:var(--t2);font-size:10px;padding:1px 6px;border-radius:99px">${escHtml(bankAcc.bank_name)}</span>`
        : '';
    const interval = parseInt(d.interval_months) || 1;
    const intervalLabel = interval <= 1 ? 'each month' : `every ${interval} months${d.start_month ? ` from ${fmtMonYear(d.start_month + '-01')}` : ''}`;
    return `<div class="def-pay-row ${d.is_active ? '' : 'inactive'}">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:600">${escHtml(d.name)} ${d.category ? `<span style="font-size:11px;color:var(--t3);font-weight:400">${escHtml(d.category)}</span>` : ''} ${bankLabel}</div>
        <div style="font-size:11px;color:var(--t3)">Due on day ${d.due_day} each month ${d.is_active ? '' : 'Â· <span style="color:var(--red)">Inactive</span>'}</div>
      </div>
      <div style="font-size:14px;font-weight:700;font-family:var(--mono);margin-right:8px">${fmtCur(d.amount)}</div>
      <button class="btn-d" style="color:var(--em)" onclick="showDefaultModal(${d.id})">Edit</button>
      <button class="btn-d" style="color:${d.is_active ? 'var(--amber)' : 'var(--green)'}" onclick="toggleDefault(${d.id},${d.is_active ? 0 : 1})">${d.is_active ? 'Disable' : 'Enable'}</button>
      <button class="btn-d" onclick="deleteDefault(${d.id})">Del</button>
    </div>`;
  };

  const rows = [...active, ...inactive].map(defRow).join('') ||
    `<div style="color:var(--t3);padding:24px;text-align:center;font-size:13px">No default payments yet. Add recurring bills, rent, subscriptions etc.</div>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:16px;font-weight:700">Default Monthly Payments</div>
        <div style="font-size:12px;color:var(--t2);margin-top:2px">${active.length} active Â· Monthly total: <strong>${fmtCur(total)}</strong></div>
      </div>
      <button class="btn btn-p btn-sm" onclick="showDefaultModal()">+ Add Default</button>
    </div>
    <div class="table-wrap">${rows}</div>
    <div style="font-size:12px;color:var(--t3);margin-top:10px;padding:0 4px">These payments are automatically added to each month's planner on the specified due day.</div>`;
}

// â”€â”€ Pay Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showPayModal(id, amount) {
  openModal('Mark as Paid', `
    <div class="fg">
      <label class="fl">Amount Paid (&#8377;)<input class="fi" type="number" step="0.01" id="pmAmt" value="${amount}" autofocus></label>
      <label class="fl">Payment Date<input class="fi" type="date" id="pmDate" value="${todayStr()}"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doPayMonthly(${id})">Mark Paid</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

// Pay CC bill from planner
function showCcPayModal(cycleId, netPayable) {
  openModal('Pay Credit Card Bill', `
    <div class="fg">
      <label class="fl">Amount Paid (&#8377;)<input class="fi" type="number" step="0.01" id="ccpAmt" value="${netPayable.toFixed(2)}" autofocus></label>
      <label class="fl">Payment Date<input class="fi" type="date" id="ccpDate" value="${todayStr()}"></label>
    </div>
    <div style="background:var(--blue-l);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--blue);margin-bottom:12px">
      Net payable: <strong>${fmtCur(netPayable)}</strong>. Paying closes this billing cycle.
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doCcPayFromPlanner(${cycleId})">Mark Paid</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function doCcPayFromPlanner(cycleId) {
  const body = {
    paid_amount: parseFloat(document.getElementById('ccpAmt').value) || 0,
    paid_date: document.getElementById('ccpDate').value,
  };
  const r = await api(`/api/cc/cycles/${cycleId}/close`, { method: 'POST', body });
  if (r?.success) { closeModal(); toast('CC bill marked as paid', 'success'); renderPlanner(); }
  else toast(r?.error || 'Failed', 'error');
}

async function doPayMonthly(id) {
  const body = {
    paid_amount: parseFloat(document.getElementById('pmAmt').value) || 0,
    paid_date: document.getElementById('pmDate').value,
  };
  const r = await api(`/api/planner/monthly/${id}/pay`, { method: 'PUT', body });
  if (r?.success) { closeModal(); toast('Marked as paid', 'success'); renderPlanner(); }
  else toast(r?.error || 'Failed', 'error');
}

async function quickTogglePay(id, amount) {
  const body = { paid_amount: amount, paid_date: amount > 0 ? todayStr() : null };
  const r = await api(`/api/planner/monthly/${id}/pay`, { method: 'PUT', body });
  if (r?.success) renderPlanner();
  else toast(r?.error || 'Failed', 'error');
}

// â”€â”€ Add / Edit Monthly Payment Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showAddPaymentModal() {
  const defaultDue = `${_plannerMonth}-01`;
  openModal('Add Payment', `
    <div class="fg">
      <label class="fl full">Name *<input class="fi" id="mpName" placeholder="e.g. Rent, Netflix, Electricity..." autofocus></label>
      <label class="fl">Amount (&#8377;) *<input class="fi" type="number" step="0.01" id="mpAmt" placeholder="0.00"></label>
      <label class="fl">Due Date<input class="fi" type="date" id="mpDue" value="${defaultDue}"></label>
      <label class="fl">Bank Account<select class="fi" id="mpBank"><option value="">-- None --</option>${_bankDropdownOptions(null)}</select></label>
      <label class="fl full">Notes<input class="fi" id="mpNotes" placeholder="optional"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveMonthlyPayment(null)">Add</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function showEditPaymentModal(id) {
  const data = await api(`/api/planner/monthly?month=${_plannerMonth}`);
  const p = data?.payments?.find(x => x.id === id);
  if (!p) return;
  openModal('Edit Payment', `
    <div class="fg">
      <label class="fl full">Name *<input class="fi" id="mpName" value="${escHtml(p.name)}" autofocus></label>
      <label class="fl">Amount (&#8377;) *<input class="fi" type="number" step="0.01" id="mpAmt" value="${p.amount}"></label>
      <label class="fl">Due Date<input class="fi" type="date" id="mpDue" value="${p.due_date || ''}"></label>
      <label class="fl">Bank Account<select class="fi" id="mpBank"><option value="">-- None --</option>${_bankDropdownOptions(p.bank_account_id)}</select></label>
      <label class="fl full">Notes<input class="fi" id="mpNotes" value="${escHtml(p.notes || '')}"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveMonthlyPayment(${id})">Update</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveMonthlyPayment(id) {
  const bankVal = document.getElementById('mpBank')?.value;
  const body = {
    month: _plannerMonth,
    name: document.getElementById('mpName').value.trim(),
    amount: Number(document.getElementById('mpAmt').value),
    due_date: document.getElementById('mpDue').value || null,
    notes: document.getElementById('mpNotes').value.trim() || null,
    bank_account_id: bankVal ? parseInt(bankVal) : null,
  };
  if (!body.name) { toast('Name is required', 'warning'); return; }
  if (body.name.length > 120) { toast('Name must be 120 characters or fewer', 'warning'); return; }
  if (!Number.isFinite(body.amount) || body.amount <= 0) { toast('Amount must be greater than 0', 'warning'); return; }
  if (body.notes && body.notes.length > 240) { toast('Notes must be 240 characters or fewer', 'warning'); return; }
  const r = id
    ? await api(`/api/planner/monthly/${id}`, { method: 'PUT', body })
    : await api('/api/planner/monthly', { method: 'POST', body });
  if (r?.success || r?.id) { closeModal(); toast(id ? 'Updated' : 'Added', 'success'); renderPlanner(); }
  else toast(r?.error || 'Failed', 'error');
}

async function deleteMonthlyPayment(id) {
  if (!await confirmDialog('Remove this payment from this month?')) return;
  const r = await api(`/api/planner/monthly/${id}`, { method: 'DELETE' });
  if (r?.success) { toast('Removed', 'success'); renderPlanner(); }
  else toast(r?.error || 'Failed', 'error');
}

async function restoreMonthlyPayment(id) {
  const r = await api(`/api/planner/monthly/${id}/restore`, { method: 'PUT' });
  if (r?.success) { toast('Added back', 'success'); renderPlanner(); }
  else toast(r?.error || 'Failed', 'error');
}

async function permanentDeleteDefault(monthlyId) {
  if (!await confirmDialog('Permanently remove this payment from the current month?')) return;
  const r = await api(`/api/planner/monthly/${monthlyId}/hard`, { method: 'DELETE' });
  if (r?.success) { toast('Permanently deleted', 'success'); renderPlanner(); }
  else toast(r?.error || 'Failed', 'error');
}

// â”€â”€ Default Payments Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function showDefaultModal(id) {
  let d = { name: '', amount: '', due_day: 1, category: '', is_active: 1, bank_account_id: null, auto_detect_bank: 0 };
  if (id) {
    const data = await api('/api/planner/defaults');
    const found = data?.defaults?.find(x => x.id === id);
    if (found) d = found;
  }
  const autoDetectChecked = d.auto_detect_bank ? 'checked' : '';
  openModal(id ? 'Edit Default Payment' : 'Add Default Payment', `
    <div class="fg">
      <label class="fl full">Name *<input class="fi" id="dpName" value="${escHtml(d.name)}" placeholder="e.g. Rent, Netflix, EMI..." autofocus></label>
      <label class="fl">Amount (&#8377;) *<input class="fi" type="number" step="0.01" id="dpAmt" value="${d.amount || ''}" placeholder="0.00"></label>
      <label class="fl">Due Day (1-28)<input class="fi" type="number" id="dpDay" value="${d.due_day || 1}" min="1" max="28">
        <span style="font-size:11px;color:var(--t3);margin-top:3px;display:block">Day of month when payment is due</span>
      </label>
      <label class="fl">Category<input class="fi" id="dpCat" value="${escHtml(d.category || '')}" placeholder="e.g. Rent, Utilities, Subscriptions"></label>
      <label class="fl">Bank Account<select class="fi" id="dpBank"><option value="">-- None --</option>${_bankDropdownOptions(d.bank_account_id)}</select></label>
      <label class="fl" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="dpAutoBank" ${autoDetectChecked}>
        <span>Auto-debit from this bank account</span>
      </label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveDefault(${id || 'null'})">${id ? 'Update' : 'Add'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}


async function saveDefault(id) {
  const autoDetect = document.getElementById('dpAutoBank')?.checked ? 1 : 0;
  const bankVal = document.getElementById('dpBank')?.value;
  const body = {
    name: document.getElementById('dpName').value.trim(),
    amount: Number(document.getElementById('dpAmt').value),
    due_day: Number(document.getElementById('dpDay').value),
    category: document.getElementById('dpCat').value.trim() || null,
    is_active: 1,
    bank_account_id: bankVal ? parseInt(bankVal) : null,
    auto_detect_bank: autoDetect,
  };
  if (!body.name) { toast('Name is required', 'warning'); return; }
  if (body.name.length > 120) { toast('Name must be 120 characters or fewer', 'warning'); return; }
  if (!Number.isFinite(body.amount) || body.amount <= 0) { toast('Amount must be greater than 0', 'warning'); return; }
  if (!Number.isInteger(body.due_day) || body.due_day < 1 || body.due_day > 28) { toast('Due day must be between 1 and 28', 'warning'); return; }
  if (body.category && body.category.length > 80) { toast('Category must be 80 characters or fewer', 'warning'); return; }
  const r = id
    ? await api(`/api/planner/defaults/${id}`, { method: 'PUT', body })
    : await api('/api/planner/defaults', { method: 'POST', body });
  if (r?.success || r?.id) { closeModal(); toast(id ? 'Updated' : 'Added', 'success'); renderPlanner(); }
  else toast(r?.error || 'Failed', 'error');
}

async function toggleDefault(id, active) {
  const data = await api('/api/planner/defaults');
  const d = data?.defaults?.find(x => x.id === id);
  if (!d) return;
  await api(`/api/planner/defaults/${id}`, { method: 'PUT', body: { ...d, is_active: active } });
  renderPlanner();
}

async function deleteDefault(id) {
  if (!await confirmDialog('Delete this default payment? It won\'t be added to future months automatically.')) return;
  const r = await api(`/api/planner/defaults/${id}`, { method: 'DELETE' });
  if (r?.success) { toast('Deleted', 'success'); renderPlanner(); }
  else toast(r?.error || 'Failed', 'error');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AI LOOKUP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let _aiHistory = []; // { role: 'user'|'assistant', content: string }
let _aiStatus = null;
let _aiPastHistory = []; // from DB
let _aiHistoryExpanded = false;

function _aiRewriteQuestion(question) {
  const raw = String(question || '').trim();
  const normalized = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const asksExpense = /\b(expense|expenses|spend|spent|spending|cost|costs)\b/.test(normalized);
  const asksToday = /\btoday\b/.test(normalized);
  if (asksExpense && asksToday) return 'what did i spend today';
  return raw;
}

async function loadAiLookup() {
  _aiHistory = [];
  _aiHistoryExpanded = false;
  const [statusRes, histRes] = await Promise.all([
    api('/api/ai/lookup/status'),
    api('/api/ai/lookup/history'),
  ]);
  _aiStatus = statusRes?.success ? statusRes : null;
  _aiPastHistory = histRes?.history || [];
  document.getElementById('main').innerHTML = `
    <div class="tab-content" style="display:flex;flex-direction:column;height:calc(100vh - 40px);max-height:900px">
      <div style="margin-bottom:10px">
        <div style="font-size:22px;font-weight:700;color:var(--t1)">AI Lookup</div>
        <div style="font-size:13px;color:var(--t3);margin-top:2px">Ask anything about your expenses, loans, EMIs, credit cards, trips, and more.</div>
        ${_renderAiStatusBanner()}
      </div>

      ${_renderAiHistoryPanel()}

      <!-- Chat messages -->
      <div id="aiChat" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px;padding:4px 0;min-height:0">
        <div id="aiWelcome" style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:16px;padding:40px 0;color:var(--t3)">
          <div style="font-size:48px">AI</div>
          <div style="font-size:15px;font-weight:500;color:var(--t2)">Your personal finance AI assistant</div>
          <div style="font-size:13px;color:var(--t3);text-align:center;max-width:420px">Ask in plain English - totals, trends, who owes what, upcoming EMIs, CC dues, anything in your data.</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px">
            ${[
              'What is my total expense this year?',
              'Who owes me money?',
              'Which EMIs are active?',
              'How much is my credit card due this month?',
              'What are my recurring monthly payments?',
              'Show my bank account balances',
            ].map(q => `<button class="chip" style="cursor:pointer;font-size:12px" data-q="${escHtml(q)}" onclick="aiAskSuggestion(this.dataset.q)">${escHtml(q)}</button>`).join('')}
          </div>
        </div>
      </div>

      <!-- Input bar -->
      <div style="border-top:1.5px solid var(--border);padding-top:14px;margin-top:8px">
        <div style="display:flex;gap:8px;align-items:flex-end">
          <textarea id="aiInput" placeholder="Ask anything about your finances..."
            style="flex:1;padding:10px 14px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;font-family:var(--sans);resize:none;min-height:44px;max-height:120px;outline:none;transition:border-color 0.15s;line-height:1.4"
            rows="1"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();doAiAsk();}"
            oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"
            onfocus="this.style.borderColor='var(--em)'" onblur="this.style.borderColor='var(--border)'"></textarea>
          <button id="aiSendBtn" onclick="doAiAsk()"
            style="padding:10px 18px;background:var(--em);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;height:44px;transition:opacity 0.15s">
            Ask
          </button>
        </div>
        <div style="font-size:11px;color:var(--t3);margin-top:6px">Enter to send &middot; Shift+Enter for new line &middot; Answers are based on your live data</div>
      </div>
    </div>`;
}

function _renderAiHistoryPanel() {
  if (!_aiPastHistory.length) return '';
  const fmtRelTime = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };
  const items = _aiPastHistory.map((h, i) => {
    const answerHtml = h.response_preview
      ? escHtml(h.response_preview).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')
      : '<span style="color:var(--t3);font-style:italic">No preview</span>';
    return `<div style="border-bottom:1px solid var(--border);padding:8px 0;${i===_aiPastHistory.length-1?'border-bottom:none':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div style="font-size:13px;font-weight:500;color:var(--t1);flex:1">${escHtml(h.question)}</div>
        <span style="font-size:11px;color:var(--t3);white-space:nowrap;margin-top:2px">${fmtRelTime(h.created_at)}</span>
      </div>
      <div style="display:none;margin-top:6px;font-size:12px;color:var(--t2);line-height:1.5;background:var(--bg2);border-radius:8px;padding:8px 10px">${answerHtml}</div>
    </div>`;
  }).join('');

  return `<div id="aiHistoryPanel" style="border:1px solid var(--border);border-radius:10px;margin-bottom:10px;overflow:hidden">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;cursor:pointer;background:var(--bg2)" onclick="_aiToggleHistory()">
      <div style="font-size:13px;font-weight:600;color:var(--t1)">Recent History <span style="font-size:11px;color:var(--t3);font-weight:400">(${_aiPastHistory.length})</span></div>
      <span id="aiHistoryChevron" style="font-size:12px;color:var(--t3)">${_aiHistoryExpanded ? '&#9650;' : '&#9660;'}</span>
    </div>
    <div id="aiHistoryList" style="display:${_aiHistoryExpanded ? 'block' : 'none'};padding:0 12px;max-height:260px;overflow-y:auto">
      ${items}
    </div>
  </div>`;
}

function _aiToggleHistory() {
  _aiHistoryExpanded = !_aiHistoryExpanded;
  const list = document.getElementById('aiHistoryList');
  const chevron = document.getElementById('aiHistoryChevron');
  if (list) list.style.display = _aiHistoryExpanded ? 'block' : 'none';
  if (chevron) chevron.innerHTML = _aiHistoryExpanded ? '&#9650;' : '&#9660;';
}

async function aiAskSuggestion(q) {
  document.getElementById('aiInput').value = q;
  await doAiAsk();
}

async function doAiAsk() {
  const inp = document.getElementById('aiInput');
  const question = inp.value.trim();
  if (!question) return;
  const lookupQuestion = _aiRewriteQuestion(question);

  inp.value = '';
  inp.style.height = 'auto';

  // Hide welcome screen
  const welcome = document.getElementById('aiWelcome');
  if (welcome) welcome.style.display = 'none';

  const chat = document.getElementById('aiChat');
  if (!chat) return;

  // Append user bubble
  chat.innerHTML += _aiUserBubble(question);
  // Append thinking bubble
  const thinkingId = 'aiThinking_' + Date.now();
  chat.innerHTML += `<div id="${thinkingId}" class="ai-bubble ai-bubble-assistant" style="display:flex;align-items:center;gap:6px">
    <span class="ai-thinking-dot"></span><span class="ai-thinking-dot"></span><span class="ai-thinking-dot"></span>
  </div>`;
  chat.scrollTop = chat.scrollHeight;

  // Disable send
  const btn = document.getElementById('aiSendBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

  const r = await api('/api/ai/lookup', { method: 'POST', body: { question: lookupQuestion, history: _aiHistory } });

  // Update history
  _aiHistory.push({ role: 'user', content: question });

  // Replace thinking with answer
  const thinkingEl = document.getElementById(thinkingId);
  if (r?.success && r.answer) {
    _aiStatus = r.ai_status || _aiStatus;
    _refreshAiStatusBanner();
    _aiHistory.push({ role: 'assistant', content: r.answer });
    if (thinkingEl) thinkingEl.outerHTML = _aiAssistantBubble(r.answer);
  } else {
    const errMsg = r?.error || 'Something went wrong. Please try again.';
    if (r?.ai_status) _aiStatus = r.ai_status;
    _refreshAiStatusBanner();
    if (thinkingEl) thinkingEl.outerHTML = _aiAssistantBubble(errMsg, true);
  }

  chat.scrollTop = chat.scrollHeight;
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  if (inp) inp.focus();
}

function _aiUserBubble(text) {
  return `<div class="ai-bubble ai-bubble-user">${escHtml(text).replace(/\n/g, '<br>')}</div>`;
}

function _renderAiStatusBanner() {
  if (!_aiStatus) return '';
  const isAdmin = !!_aiStatus.isAdmin;
  const isUnlimited = isAdmin || _aiStatus.dailyFreeLimit === -1 || _aiStatus.remainingFreeQueries === -1;
  const bgColor = isAdmin ? 'var(--orange-l,#fff3e0)' : isUnlimited ? 'var(--green-l)' : 'var(--blue-l)';
  const fgColor = isAdmin ? 'var(--orange,#e65100)' : isUnlimited ? 'var(--green)' : 'var(--blue)';
  const planLabel = _aiStatus.planName ? `Plan: <b>${escHtml(_aiStatus.planName)}</b> &middot; ` : '';
  const headline = isAdmin
    ? 'Admin — Unlimited AI queries'
    : isUnlimited
      ? 'Unlimited AI enabled'
      : `${_aiStatus.remainingFreeQueries}/${_aiStatus.dailyFreeLimit} AI queries left today`;
  const upsell = (!isAdmin && !isUnlimited)
    ? `<div style="margin-top:4px;color:var(--t2)">Upgrade your plan to unlock more AI lookups per day.</div>` : '';
  return `
    <div id="aiStatusBanner" style="margin-top:12px;background:${bgColor};color:${fgColor};border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.6">
      <div style="font-weight:700">${headline}</div>
      <div style="margin-top:2px">${planLabel}${escHtml(_aiStatus.message || '')}</div>
      ${upsell}
    </div>`;
}

function _refreshAiStatusBanner() {
  const node = document.getElementById('aiStatusBanner');
  if (!node || !_aiStatus) return;
  node.outerHTML = _renderAiStatusBanner();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DAILY TRACKER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _trackers = [];
let _selectedTrackerId = null;
let _trackerYear = new Date().getFullYear();
let _trackerMonth = new Date().getMonth() + 1;
const _MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function fmtMonYear(dateStr) {
  if (!dateStr) return '';
  const dt = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return String(dateStr).slice(0, 7);
  return `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

async function loadTracker() {
  const data = await api('/api/trackers');
  _trackers = data?.trackers || [];
  if (_selectedTrackerId && _trackers.find(t => t.id === _selectedTrackerId)) {
    await renderTrackerDetail();
  } else {
    _selectedTrackerId = null;
    renderTrackerGrid();
  }
}

function renderTrackerGrid() {
  const cards = _trackers.length ? _trackers.map(t => `
    <div class="cc-tile" onclick="openTrackerDetail(${t.id})" style="cursor:pointer">
      <div class="cc-tile-header">
        <div>
          <div class="cc-tile-name">${escHtml(t.name)}</div>
          <div class="cc-tile-bank">${fmtCur(t.price_per_unit)} / ${escHtml(t.unit)} &nbsp;Â·&nbsp; Default: ${t.default_qty} ${escHtml(t.unit)}/day</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.65)">${t.is_active ? 'Active' : 'Inactive'}</div>
      </div>
      <div class="cc-tile-amount">${fmtCur(t.current_month_total)}</div>
      <div class="cc-tile-label">This Month &nbsp;Â·&nbsp; ${t.current_month_days} days tracked</div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px;gap:6px" onclick="event.stopPropagation()">
        <button class="cc-action-btn" onclick="showTrackerModal(${t.id})">Edit</button>
        <button class="cc-action-btn cc-action-del" onclick="deleteTracker(${t.id})">Delete</button>
      </div>
    </div>`).join('') :
    `<div style="color:var(--t3);text-align:center;padding:48px 20px;background:var(--white);border-radius:16px;border:2px dashed var(--border);grid-column:1/-1">
      <div style="font-size:36px;margin-bottom:12px">ðŸ“‹</div>
      <div style="font-weight:600;margin-bottom:6px;color:var(--t1)">No trackers yet</div>
      <div style="font-size:13px">Add items like Milk, Newspaper to track daily and see monthly totals</div>
    </div>`;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="margin-bottom:20px">
        <div class="summary-top">
          <div>
            <div class="summary-label">DAILY TRACKERS</div>
            <div class="summary-amount">${_trackers.length}</div>
            <div class="summary-words">Track daily recurring items Â· auto-filled each day</div>
          </div>
          <div class="count-box"><div class="num">${_trackers.filter(t => t.is_active).length}</div><div class="lbl">active</div></div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700;color:var(--t1)">My Trackers</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadTrackersOverviewPdf(new Date().getFullYear(),new Date().getMonth()+1)">â†“ PDF Overview</button>
          <button class="btn btn-p btn-sm" onclick="showTrackerModal()">+ Add Tracker</button>
        </div>
      </div>
      <div class="cc-card-grid">${cards}</div>
    </div>`;
}

async function openTrackerDetail(id) {
  _selectedTrackerId = id;
  _trackerYear = new Date().getFullYear();
  _trackerMonth = new Date().getMonth() + 1;
  await api(`/api/trackers/${id}/autofill`, { method: 'POST', body: { year: _trackerYear, month: _trackerMonth } });
  await renderTrackerDetail();
}

async function renderTrackerDetail() {
  const tracker = _trackers.find(t => t.id === _selectedTrackerId);
  if (!tracker) { renderTrackerGrid(); return; }

  const [entriesRes, summaryRes] = await Promise.all([
    api(`/api/trackers/${_selectedTrackerId}/entries?year=${_trackerYear}&month=${_trackerMonth}`),
    api(`/api/trackers/${_selectedTrackerId}/summary?year=${_trackerYear}&month=${_trackerMonth}`)
  ]);

  const entries = entriesRes?.entries || [];
  const summary = summaryRes?.summary || {};
  const entryMap = {};
  entries.forEach(e => { entryMap[e.entry_date] = e; });

  const today = new Date().toISOString().split('T')[0];
  const daysInMonth = new Date(_trackerYear, _trackerMonth, 0).getDate();
  const currentMonthKey = `${_trackerYear}-${String(_trackerMonth).padStart(2, '0')}`;
  const isCurrentMonth = currentMonthKey === today.slice(0, 7);

  let rows = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentMonthKey}-${String(d).padStart(2, '0')}`;
    const e = entryMap[dateStr];
    const dayLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
    const isFuture = dateStr > today;
    const isToday = dateStr === today;
    const rowStyle = isToday ? 'background:var(--bg2)' : '';

    if (isFuture) {
      rows += `<tr style="color:var(--t3);${rowStyle}">
        <td><span style="font-weight:${isToday?600:400}">${d}</span> <span style="font-size:11px">${dayLabel}</span></td>
        <td style="text-align:right;color:var(--t3)">â€”</td><td style="text-align:right">â€”</td><td></td><td></td></tr>`;
    } else if (e) {
      const badge = e.is_auto
        ? `<span class="badge" style="background:var(--bg2);color:var(--t3);font-size:10px">Auto</span>`
        : `<span class="badge b-fair" style="font-size:10px">Edited</span>`;
      rows += `<tr id="trow-${dateStr}" style="${rowStyle}">
        <td><strong>${d}</strong> <span style="font-size:11px;color:var(--t3)">${dayLabel}</span>${isToday ? ' <span style="font-size:10px;color:var(--em)">Today</span>' : ''}</td>
        <td style="text-align:right" id="tqty-${dateStr}">${e.quantity} <span style="color:var(--t3);font-size:12px">${escHtml(tracker.unit)}</span></td>
        <td style="text-align:right;font-weight:600">${fmtCur(e.amount)}</td>
        <td>${badge}</td>
        <td><button class="btn-d" style="color:var(--em)" onclick="editDayEntry(${tracker.id},'${dateStr}',${e.quantity})">Edit</button></td>
      </tr>`;
    } else {
      rows += `<tr id="trow-${dateStr}" style="color:var(--t3);${rowStyle}">
        <td><strong>${d}</strong> <span style="font-size:11px">${dayLabel}</span></td>
        <td style="text-align:right">â€”</td><td style="text-align:right">â€”</td>
        <td><span class="badge" style="background:var(--bg2);color:var(--t3);font-size:10px">Missing</span></td>
        <td><button class="btn-d" onclick="editDayEntry(${tracker.id},'${dateStr}',${tracker.default_qty})">Add</button></td>
      </tr>`;
    }
  }

  const totalQty = summary.total_qty ? parseFloat(summary.total_qty).toFixed(2) : '0';
  const totalAmt = summary.total_amount || 0;
  const addedToExpense = summary.added_to_expense;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-g btn-sm" onclick="_selectedTrackerId=null;renderTrackerGrid()">â† Back</button>
        <div>
          <span style="font-size:18px;font-weight:700">${escHtml(tracker.name)}</span>
          <span style="color:var(--t2);font-size:13px;margin-left:10px">${fmtCur(tracker.price_per_unit)}/${escHtml(tracker.unit)} &nbsp;Â·&nbsp; Default: ${tracker.default_qty} ${escHtml(tracker.unit)}/day</span>
        </div>
        <button class="btn btn-g btn-sm" style="margin-left:auto" onclick="showTrackerModal(${tracker.id})">Edit</button>
      </div>

      <div class="summary-card" style="margin-bottom:16px">
        <div class="summary-top">
          <div>
            <div class="summary-label">${_MONTHS_LONG[_trackerMonth - 1].toUpperCase()} ${_trackerYear}</div>
            <div class="summary-amount">${fmtCur(totalAmt)}</div>
            <div class="summary-words">${totalQty} ${escHtml(tracker.unit)} Â· ${summary.days || 0} days Â· ${summary.auto_days || 0} auto, ${summary.edited_days || 0} edited</div>
          </div>
          <div class="count-box" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">
            ${addedToExpense
              ? `<div style="font-size:11px;color:rgba(255,255,255,0.8);font-weight:600;text-align:center">âœ“ Added to<br>Expenses</div>`
              : `<button class="btn btn-p btn-sm" onclick="addTrackerExpense(${tracker.id},${_trackerYear},${_trackerMonth})" ${totalAmt ? '' : 'disabled'}>+ To Expenses</button>`}
          </div>
        </div>
      </div>

      <div class="filter-row" style="justify-content:space-between;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-g btn-sm" onclick="trackerPrevMonth()">â†</button>
          <span style="font-weight:600;min-width:130px;text-align:center">${_MONTHS_LONG[_trackerMonth - 1]} ${_trackerYear}</span>
          <button class="btn btn-g btn-sm" onclick="trackerNextMonth()" ${isCurrentMonth ? 'disabled' : ''}>â†’</button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadTrackerMonthPdf(${tracker.id},'${escHtml(tracker.name)}',${_trackerYear},${_trackerMonth})">â†“ PDF</button>
          ${isCurrentMonth ? `<button class="btn btn-s btn-sm" onclick="autoFillTracker(${tracker.id})">Auto-fill Missing</button>` : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Date</th>
            <th style="text-align:right">Quantity</th>
            <th style="text-align:right">Amount</th>
            <th>Status</th>
            <th style="width:80px">Action</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function editDayEntry(trackerId, date, currentQty) {
  const tracker = _trackers.find(t => t.id === trackerId);
  const row = document.getElementById(`trow-${date}`);
  if (!row) return;
  row.cells[1].innerHTML = `<input type="number" step="0.01" min="0" id="tedit-${date}" value="${currentQty}" style="width:80px;text-align:right" class="fi" onkeydown="if(event.key==='Enter')saveDayEntry(${trackerId},'${date}')">`;
  row.cells[2].innerHTML = `<span style="color:var(--t3);font-size:12px">${escHtml(tracker?.unit || '')}</span>`;
  row.cells[3].innerHTML = '';
  row.cells[4].innerHTML = `
    <button class="btn-d" style="color:var(--green)" onclick="saveDayEntry(${trackerId},'${date}')">&#10003;</button>
    <button class="btn-d" onclick="renderTrackerDetail()">&#10005;</button>`;
  document.getElementById(`tedit-${date}`)?.focus();
}

async function saveDayEntry(trackerId, date) {
  const qty = parseFloat(document.getElementById(`tedit-${date}`)?.value);
  if (isNaN(qty) || qty < 0) { toast('Enter a valid quantity', 'warning'); return; }
  const r = await api(`/api/trackers/${trackerId}/entries`, { method: 'POST', body: { date, qty, is_auto: 0 } });
  if (r?.success) {
    invalidatePlannerPreviewCache();
    const data = await api('/api/trackers');
    _trackers = data?.trackers || [];
    await renderTrackerDetail();
  } else toast(r?.error || 'Failed', 'error');
}

async function trackerPrevMonth() {
  _trackerMonth--;
  if (_trackerMonth < 1) { _trackerMonth = 12; _trackerYear--; }
  await renderTrackerDetail();
}

async function trackerNextMonth() {
  const now = new Date();
  if (_trackerYear === now.getFullYear() && _trackerMonth >= now.getMonth() + 1) return;
  _trackerMonth++;
  if (_trackerMonth > 12) { _trackerMonth = 1; _trackerYear++; }
  await renderTrackerDetail();
}

async function autoFillTracker(trackerId) {
  const r = await api(`/api/trackers/${trackerId}/autofill`, { method: 'POST', body: { year: _trackerYear, month: _trackerMonth } });
  if (r?.success) {
    invalidatePlannerPreviewCache();
    toast(r.filled > 0 ? `${r.filled} day${r.filled !== 1 ? 's' : ''} auto-filled` : 'All days already have entries', r.filled > 0 ? 'success' : 'info');
    await renderTrackerDetail();
  } else toast(r?.error || 'Failed', 'error');
}

async function addTrackerExpense(trackerId, year, month) {
  if (!_expenseCategories.length) await loadExpenseCategories();
  const sourceMonth = `${year}-${String(month).padStart(2, '0')}`;
  const nextMonth = _addMonths(sourceMonth, 1);
  const [nextYear, nextMonthNum] = nextMonth.split('-').map(Number);
  openModal('Add Tracker Month to Expenses', `
    <div class="fg">
      <div style="font-size:13px;color:var(--t2)">Choose which expense month should receive the total for <strong>${escHtml(_MONTHS_LONG[month - 1])} ${year}</strong>.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
        <label class="chip active" id="trackerExpMonth_same" style="cursor:pointer" onclick="setTrackerExpenseMonthChoice('same')">
          <input type="radio" name="trackerExpMonthChoice" value="same" checked style="display:none">
          Same month (${escHtml(_MONTHS_LONG[month - 1])} ${year})
        </label>
        <label class="chip" id="trackerExpMonth_next" style="cursor:pointer" onclick="setTrackerExpenseMonthChoice('next')">
          <input type="radio" name="trackerExpMonthChoice" value="next" style="display:none">
          Next month (${escHtml(_MONTHS_LONG[nextMonthNum - 1])} ${nextYear})
        </label>
      </div>
    </div>
    <label class="fl full" style="margin-top:12px">Expense Category${expenseCategoryDatalistHtml('')}</label>
    <div class="fa">
      <button class="btn btn-p" onclick="confirmAddTrackerExpense(${trackerId}, ${year}, ${month})">Add</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  window._trackerExpenseMonthChoice = 'same';
  repairMojibakeInNode(document.getElementById('modalContent'));
}

function setTrackerExpenseMonthChoice(choice) {
  window._trackerExpenseMonthChoice = choice === 'next' ? 'next' : 'same';
  document.getElementById('trackerExpMonth_same')?.classList.toggle('active', window._trackerExpenseMonthChoice === 'same');
  document.getElementById('trackerExpMonth_next')?.classList.toggle('active', window._trackerExpenseMonthChoice === 'next');
}

async function confirmAddTrackerExpense(trackerId, year, month) {
  const sourceMonth = `${year}-${String(month).padStart(2, '0')}`;
  const expenseMonth = window._trackerExpenseMonthChoice === 'next' ? _addMonths(sourceMonth, 1) : sourceMonth;
  const expenseCategory = document.getElementById('eCategory')?.value.trim() || null;
  const r = await api(`/api/trackers/${trackerId}/month-expense`, { method: 'POST', body: { year, month, expense_month: expenseMonth, expense_category: expenseCategory } });
  if (r?.success) {
    invalidatePlannerPreviewCache();
    closeModal();
    toast(`${fmtCur(r.amount)} added to expenses`, 'success');
    const data = await api('/api/trackers');
    _trackers = data?.trackers || [];
    await renderTrackerDetail();
  } else toast(r?.error || 'Failed', 'error');
}

async function showTrackerModal(id) {
  const t = id ? _findTrackerById(id) : null;
  openModal(id ? 'Edit Tracker' : 'Add Tracker', `
    <div class="fg">
      <label class="fl full">Name *<input class="fi" id="trName" value="${escHtml(t?.name || '')}" placeholder="e.g. Milk, Newspaper, Maid..."></label>
      <label class="fl">Unit *<input class="fi" id="trUnit" value="${escHtml(t?.unit || 'unit')}" placeholder="litre, piece, visit..."></label>
      <label class="fl">Price per Unit (&#8377;) *<input class="fi" type="number" step="0.01" id="trPrice" value="${t?.price_per_unit || ''}" placeholder="0.00"></label>
      <label class="fl">Default Qty / Day<input class="fi" type="number" step="0.01" min="0" id="trDefaultQty" value="${t?.default_qty ?? 1}" placeholder="1"></label>
    </div>
    <p style="font-size:12px;color:var(--t3);margin:0 0 12px">Each day will be auto-filled with the default quantity. You can edit any day individually.</p>
    <div class="fa">
      <button class="btn btn-p" onclick="saveTracker(${id || 'null'})">${id ? 'Update' : 'Add Tracker'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

async function saveTracker(id) {
  const name = document.getElementById('trName').value.trim();
  const unit = document.getElementById('trUnit').value.trim() || 'unit';
  const price_per_unit = parseFloat(document.getElementById('trPrice').value);
  const default_qty = parseFloat(document.getElementById('trDefaultQty').value) || 1;
  if (!name || !price_per_unit) { toast('Name and price are required', 'warning'); return; }
  const body = { name, unit, price_per_unit, default_qty };
  const r = id
    ? await api(`/api/trackers/${id}`, { method: 'PUT', body })
    : await api('/api/trackers', { method: 'POST', body });
  if (r?.success || r?.id) {
    invalidatePlannerPreviewCache();
    closeModal();
    toast(id ? 'Tracker updated' : 'Tracker added', 'success');
    await loadTracker();
  } else toast(r?.error || 'Failed', 'error');
}

async function deleteTracker(id) {
  if (!await confirmDialog('Delete this tracker and all its daily entries?')) return;
  const r = await api(`/api/trackers/${id}`, { method: 'DELETE' });
  if (r?.success) {
    invalidatePlannerPreviewCache();
    toast('Deleted', 'success');
    if (_selectedTrackerId === id) _selectedTrackerId = null;
    await loadTracker();
  } else toast(r?.error || 'Failed', 'error');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RECURRING ENTRIES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let _recurringEntries = [];

function _recurringReminderSummary(entry) {
  const dueDay = Math.max(1, Math.min(28, parseInt(entry?.due_day, 10) || 1));
  if (!entry?.reminder_enabled) return `Due on day ${dueDay}`;
  const daysBefore = Math.max(0, parseInt(entry?.reminder_days_before, 10) || 0);
  const frequency = String(entry?.reminder_frequency || 'once').toLowerCase();
  const freqLabel = frequency === 'daily' ? 'daily' : frequency === 'weekly' ? 'weekly' : 'once';
  const startLabel = daysBefore > 0 ? `${daysBefore} day${daysBefore === 1 ? '' : 's'} before` : 'on due date';
  const silentLabel = entry?.reminder_silent ? ' · silent' : '';
  return `Due on day ${dueDay} · Remind ${freqLabel} from ${startLabel}${silentLabel}`;
}

function toggleRecurringReminderFields() {
  const enabled = !!document.getElementById('reReminderEnabled')?.checked;
  const wrap = document.getElementById('reReminderFields');
  if (wrap) wrap.style.display = enabled ? '' : 'none';
}

async function loadRecurring() {
  const data = await api('/api/recurring');
  _recurringEntries = data?.entries || [];
  renderRecurring();
}

function renderRecurring() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const entries = _recurringEntries;
  const activeCount = entries.filter(e => e.is_active).length;
  const appliedCount = entries.filter(e => e.last_applied === currentMonth).length;

  const rows = entries.length ? entries.map(e => {
    const isCC = e.type === 'cc_txn';
    const appliedThisMonth = e.last_applied === currentMonth;
    const cardLabel = isCC ? `<br><span style="font-size:11px;color:var(--t3)">${escHtml(e.bank_name || '')} ${escHtml(e.card_name || '')} **${escHtml(e.last4 || '')}</span>` : '';
    const interval = parseInt(e.interval_months) || 1;
    const scheduleLabel = interval <= 1 ? 'Every month' : `Every ${interval} months${e.start_month ? ` from ${fmtMonYear(e.start_month + '-01')}` : ''}`;
    const reminderLabel = _recurringReminderSummary(e);
    const typeBadge = `<span class="badge ${isCC ? 'b-extra' : 'b-fair'}">${isCC ? 'CC Txn' : 'Expense'}</span>`;
    const extraBadge = isCC && e.also_expense ? `<span class="badge b-fair">+Exp</span>` : (!isCC && e.is_extra ? `<span class="badge b-extra">Extra</span>` : '');
    const statusBadge = appliedThisMonth
      ? `<span class="badge b-fair">Applied</span>`
      : (e.is_active ? `<span class="badge" style="background:var(--bg2);color:var(--t3)">Pending</span>` : `<span class="badge" style="background:var(--bg2);color:var(--t3)">Inactive</span>`);
    return `<tr>
      <td><input type="checkbox" title="${e.is_active ? 'Active - click to disable' : 'Inactive - click to enable'}" ${e.is_active ? 'checked' : ''} onchange="toggleRecurringActive(${e.id},this.checked)"></td>
      <td>${typeBadge}${extraBadge}</td>
      <td>${escHtml(e.description)}${cardLabel}<br><span style="font-size:11px;color:var(--t3)">${scheduleLabel}</span><br><span style="font-size:11px;color:var(--t3)">${escHtml(reminderLabel)}</span></td>
      <td class="td-m" style="font-weight:600">${fmtCur(e.amount)}</td>
      <td>${statusBadge}</td>
      <td><button class="btn-d" style="color:var(--em)" onclick="showRecurringModal(${e.id})">Edit</button><button class="btn-d" onclick="deleteRecurring(${e.id})">Del</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" class="empty-td">No recurring entries yet. Click "+ Add Recurring" to get started.</td></tr>`;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="margin-bottom:20px">
        <div class="summary-top">
          <div>
            <div class="summary-label">RECURRING ENTRIES</div>
            <div class="summary-amount">${entries.length}</div>
            <div class="summary-words">${activeCount} active � auto-applied on day 1 of every month</div>
          </div>
          <div class="count-box"><div class="num">${appliedCount}</div><div class="lbl">applied<br>this month</div></div>
        </div>
      </div>

      <div class="filter-row" style="justify-content:space-between">
        <div style="font-size:15px;font-weight:700;color:var(--t1)">All Entries</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="applyRecurringNow()">Apply Now</button>
          <button class="btn btn-p btn-sm" onclick="showRecurringModal()">+ Add Recurring</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="width:36px">On</th>
            <th>Type</th>
            <th>Description</th>
            <th style="text-align:right">Amount</th>
            <th>This Month</th>
            <th style="width:100px">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

async function applyRecurringNow() {
  const r = await api('/api/recurring/apply', { method: 'POST' });
  if (r?.success) {
    toast(r.applied > 0 ? `${r.applied} entr${r.applied === 1 ? 'y' : 'ies'} applied for this month` : 'All entries already applied for this month', r.applied > 0 ? 'success' : 'info');
    loadRecurring();
  } else toast(r?.error || 'Failed', 'error');
}

async function toggleRecurringActive(id, active) {
  const entry = _recurringEntries.find(e => e.id === id);
  if (!entry) return;
  await api(`/api/recurring/${id}`, { method: 'PUT', body: { ...entry, is_active: active ? 1 : 0 } });
  loadRecurring();
}

async function showRecurringModal(id) {
  const entry = id ? _findRecurringEntryById(id) : null;
  if (!_expenseCategories.length) await loadExpenseCategories();
  const cards = _ccCards && _ccCards.length ? _ccCards : (await api('/api/cc/cards'))?.cards || [];
  if (!_ccCards || !_ccCards.length) _ccCards = cards;
  const currentMonth = _localYM();

  const isCC = entry?.type === 'cc_txn';
  const dueDay = Math.max(1, Math.min(28, parseInt(entry?.due_day, 10) || 1));
  const reminderEnabled = !!entry?.reminder_enabled;
  const reminderDaysBefore = Math.max(0, parseInt(entry?.reminder_days_before, 10) || 0);
  const reminderFrequency = String(entry?.reminder_frequency || 'once').toLowerCase();
  const cardOptions = cards.map(c => `<option value="${c.id}" ${entry?.card_id === c.id ? 'selected' : ''}>${escHtml(c.bank_name)} ${escHtml(c.card_name)} **${escHtml(c.last4)}</option>`).join('');

  openModal(id ? 'Edit Recurring Entry' : 'Add Recurring Entry', `
    <div class="fg">
      <label class="fl full">Type
        <select class="fi" id="reType" onchange="recurringTypeToggle()">
          <option value="expense" ${!isCC ? 'selected' : ''}>Expense</option>
          <option value="cc_txn" ${isCC ? 'selected' : ''}>Credit Card Transaction</option>
        </select>
      </label>
      <label class="fl full">Description *<input class="fi" id="reDesc" value="${escHtml(entry?.description || '')}" placeholder="e.g. Netflix, Gym, Electricity..."></label>
      <label class="fl">Amount (&#8377;) *<input class="fi" type="number" step="0.01" id="reAmt" value="${entry?.amount || ''}" placeholder="0.00"></label>
      <label class="fl">Payment Day (1-28)<input class="fi" type="number" id="reDueDay" value="${dueDay}" min="1" max="28"></label>
      <label class="fl">Repeat Every<select class="fi" id="reInterval">
        <option value="1" ${(parseInt(entry?.interval_months) || 1) === 1 ? 'selected' : ''}>Every month</option>
        <option value="2" ${(parseInt(entry?.interval_months) || 1) === 2 ? 'selected' : ''}>Every 2 months</option>
        <option value="3" ${(parseInt(entry?.interval_months) || 1) === 3 ? 'selected' : ''}>Every 3 months</option>
        <option value="6" ${(parseInt(entry?.interval_months) || 1) === 6 ? 'selected' : ''}>Every 6 months</option>
        <option value="12" ${(parseInt(entry?.interval_months) || 1) === 12 ? 'selected' : ''}>Every 12 months</option>
      </select></label>
      <label class="fl">Starts From Month<input class="fi" type="month" id="reStartMonth" value="${escHtml(entry?.start_month || currentMonth)}"></label>
    </div>

    <div id="reCcFields" style="${isCC ? '' : 'display:none'}">
      <div class="fg">
        <label class="fl full">Credit Card
          <select class="fi" id="reCard">${cardOptions || '<option value="">No cards found</option>'}</select>
        </label>
        <label class="fl">Discount %<input class="fi" type="number" step="0.1" id="reDisc" value="${entry?.discount_pct || 0}" min="0" max="100"></label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-bottom:12px;cursor:pointer">
        <input type="checkbox" id="reAlsoExpense" ${entry?.also_expense ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer">
        Also add as expense
      </label>
      <label class="fl full" id="reCcExpenseCategoryRow" style="${isCC && !entry?.also_expense ? 'display:none' : ''}">Expense Category
        <input class="fi" id="reCcExpenseCategory" list="expenseCategoryList" value="${escHtml(entry?.expense_category || '')}" placeholder="e.g. Subscriptions, Bills, Shopping">
        <datalist id="expenseCategoryList">${_expenseCategories.map((cat) => `<option value="${escHtml(cat)}"></option>`).join('')}</datalist>
      </label>
    </div>

    <div id="reExpenseFields" style="${isCC ? 'display:none' : ''}">
      <label class="fl full">Expense Category
        <input class="fi" id="reExpenseCategory" list="expenseCategoryList" value="${escHtml(entry?.expense_category || '')}" placeholder="e.g. Bills, Rent, Groceries">
        <datalist id="expenseCategoryList">${_expenseCategories.map((cat) => `<option value="${escHtml(cat)}"></option>`).join('')}</datalist>
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-bottom:12px;cursor:pointer">
        <input type="checkbox" id="reIsExtra" ${entry?.is_extra ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer">
        Mark as extra spending
      </label>
      ${!id ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-bottom:12px;cursor:pointer">
        <input type="checkbox" id="reApplyCurrentMonth" style="width:15px;height:15px;cursor:pointer">
        Add this recurring expense for the current month as well
      </label>` : ''}
    </div>

    <div style="margin:14px 0;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--card2)">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-bottom:10px;cursor:pointer">
        <input type="checkbox" id="reReminderEnabled" ${reminderEnabled ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer" onchange="toggleRecurringReminderFields()">
        Enable payment reminders
      </label>
      <div id="reReminderFields" style="${reminderEnabled ? '' : 'display:none'}">
        <div class="fg">
          <label class="fl">Start Before (days)<input class="fi" type="number" id="reReminderDaysBefore" value="${reminderDaysBefore}" min="0" max="31"></label>
          <label class="fl">Reminder Frequency<select class="fi" id="reReminderFrequency">
            <option value="once" ${reminderFrequency === 'once' ? 'selected' : ''}>Once</option>
            <option value="daily" ${reminderFrequency === 'daily' ? 'selected' : ''}>Daily</option>
            <option value="weekly" ${reminderFrequency === 'weekly' ? 'selected' : ''}>Weekly</option>
          </select></label>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-top:8px;cursor:pointer">
          <input type="checkbox" id="reReminderSilent" ${entry?.reminder_silent ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer">
          Silent only: track in Notifications tab but do not send push alert
        </label>
      </div>
    </div>

    <div class="fa">
      <button class="btn btn-p" onclick="saveRecurring(${id || 'null'})">${id ? 'Update' : 'Add'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
}

function recurringTypeToggle() {
  const isCC = document.getElementById('reType').value === 'cc_txn';
  document.getElementById('reCcFields').style.display = isCC ? '' : 'none';
  document.getElementById('reExpenseFields').style.display = isCC ? 'none' : '';
  const bankRow = document.getElementById('reBankRow');
  if (bankRow) bankRow.style.display = isCC ? 'none' : '';
  toggleRecurringExpenseCategory();
  if (isCC) {
    const bankEl = document.getElementById('reBank');
    if (bankEl) bankEl.value = '';
  }
}

function toggleRecurringExpenseCategory() {
  const row = document.getElementById('reCcExpenseCategoryRow');
  if (!row) return;
  row.style.display = document.getElementById('reAlsoExpense')?.checked ? '' : 'none';
}

async function saveRecurring(id) {
  const type = document.getElementById('reType').value;
  const description = document.getElementById('reDesc').value.trim();
  const amount = parseFloat(document.getElementById('reAmt').value);
  if (!description || !amount) { toast('Fill all required fields', 'warning'); return; }
  const body = {
    type,
    description,
    amount,
    interval_months: parseInt(document.getElementById('reInterval').value) || 1,
    start_month: document.getElementById('reStartMonth').value || _localYM(),
    due_day: parseInt(document.getElementById('reDueDay').value, 10) || 1,
    reminder_enabled: document.getElementById('reReminderEnabled')?.checked ? 1 : 0,
    reminder_days_before: parseInt(document.getElementById('reReminderDaysBefore')?.value, 10) || 0,
    reminder_frequency: document.getElementById('reReminderFrequency')?.value || 'once',
    reminder_silent: document.getElementById('reReminderSilent')?.checked ? 1 : 0,
  };
  if (!Number.isInteger(body.due_day) || body.due_day < 1 || body.due_day > 28) { toast('Payment day must be between 1 and 28', 'warning'); return; }
  if (!Number.isInteger(body.reminder_days_before) || body.reminder_days_before < 0 || body.reminder_days_before > 31) { toast('Reminder days before must be between 0 and 31', 'warning'); return; }
  if (type === 'cc_txn') {
    body.card_id = parseInt(document.getElementById('reCard').value) || null;
    body.discount_pct = parseFloat(document.getElementById('reDisc').value) || 0;
    body.also_expense = document.getElementById('reAlsoExpense').checked ? 1 : 0;
  } else {
    body.is_extra = document.getElementById('reIsExtra').checked ? 1 : 0;
    if (!id) body.apply_current_month = document.getElementById('reApplyCurrentMonth')?.checked ? 1 : 0;
  }
  const r = id
    ? await api(`/api/recurring/${id}`, { method: 'PUT', body })
    : await api('/api/recurring', { method: 'POST', body });
  if (r?.success || r?.id) {
    closeModal();
    toast(id ? 'Updated' : 'Recurring entry added', 'success');
    loadRecurring();
  } else toast(r?.error || 'Failed', 'error');
}

async function deleteRecurring(id) {
  if (!await confirmDialog('Delete this recurring entry?')) return;
  const r = await api(`/api/recurring/${id}`, { method: 'DELETE' });
  if (r?.success) { toast('Deleted', 'success'); loadRecurring(); }
  else toast(r?.error || 'Failed', 'error');
}

function showAddFriend() {
  openModal('Add Friend', `
    <label class="fl">Friend's Name<input class="fi" id="fName" placeholder="Enter name" maxlength="80" autofocus></label>
    <div class="fa" style="margin-top:16px"><button class="btn btn-p" onclick="addFriend()">Add</button><button class="btn btn-g" onclick="closeModal()">Cancel</button></div>`);
  bindModalSubmit(addFriend);
}

function showEditFriend(id, currentName) {
  openModal('Edit Friend', `
    <label class="fl">Friend's Name
      <input class="fi" id="fEditName" value="${escHtml(currentName || '')}" maxlength="80" autofocus>
    </label>
    <div class="fa" style="margin-top:16px">
      <button class="btn btn-p" onclick="renameFriend(${id})">Save</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => renameFriend(id));
}

async function loadFriendsOld() {
  const data = await api('/api/friends');
  if (!data) return;
  let list = data.friends || [];
  const nb = data.netBalance;

  if (friendSort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (friendSort === 'high') list.sort((a, b) => b.balance - a.balance);
  else list.sort((a, b) => a.balance - b.balance);

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="text-align:center">
        <div class="summary-label">NET BALANCE</div>
        <div class="summary-amount" style="color:${balColorLight(nb)}">${fmtCur(nb)}</div>
        <div class="summary-words">${nb < 0 ? 'Overall you owe' : 'Overall you are owed'}</div>
      </div>
      <div class="filter-row">
        <button class="btn btn-p btn-sm" onclick="showAddFriend()">+ Add Friend</button>
        <button class="btn btn-s btn-sm" onclick="showFriendExcelImport()">Import Excel</button>
        <button class="btn btn-s btn-sm" onclick="showFriendsShareModal()" title="Share your friends list">Share</button>
        <button class="btn btn-s btn-sm" onclick="downloadFriendsPdf()">PDF</button>
        <div class="chip-group">
          ${['name', 'high', 'low'].map((s) => `<button class="chip ${friendSort === s ? 'active' : ''}" onclick="friendSort='${s}';loadFriends()">${s === 'name' ? 'A-Z' : s === 'high' ? 'Highest' : 'Lowest'}</button>`).join('')}
        </div>
      </div>
      <div>${list.length === 0 ? '<div class="empty-td">No friends yet. Add one to start tracking loans.</div>' : ''}
        ${list.map((f) => {
          const safeName = String(f.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const safeDeleteName = safeName || 'this friend';
          return `<div class="friend-card">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer" onclick="selectedFriend=${f.id};loadFriendDetail()">
            <div class="avatar">${escHtml((f.name || '?')[0].toUpperCase())}</div>
            <div class="friend-info"><div class="friend-name">${escHtml(f.name)}</div><div style="font-size:11px;color:${balColor(f.balance)}">${f.balance < 0 ? 'You owe' : f.balance > 0 ? 'They owe' : 'Settled'}</div></div>
            <div class="friend-bal" style="color:${balColor(f.balance)}">${fmtCur(f.balance)}</div>
          </div>
          <button class="btn-d" style="color:var(--em)" onclick="stopEvent(event);showEditFriend(${f.id}, '${safeName}')">Edit</button>
          <button class="btn-d" style="color:var(--red)" onclick="stopEvent(event);deleteFriend(${f.id}, '${safeDeleteName}')">Del</button>
        </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderBankAccounts() {
  const accounts = _bankAccounts;
  const totalBal = accounts.reduce((s, a) => s + a.balance, 0);
  const totalMin = accounts.reduce((s, a) => s + a.min_balance, 0);
  const spendable = totalBal - totalMin;

  const statBar = `
    <div class="bank-summary-bar">
      <div class="bank-stat"><div class="lbl">Total Balance</div><div class="val">${fmtCur(totalBal)}</div></div>
      <div class="bank-stat"><div class="lbl">Locked (Min Balance)</div><div class="val red">${fmtCur(totalMin)}</div></div>
      <div class="bank-stat"><div class="lbl">Spendable</div><div class="val green">${fmtCur(spendable)}</div></div>
      <div class="bank-stat"><div class="lbl">Accounts</div><div class="val">${accounts.length}</div></div>
    </div>`;

  const grid = accounts.length
    ? accounts.map((a) => {
        const spnd = a.balance - a.min_balance;
        const typeLabel = { savings: 'Savings', current: 'Current', salary: 'Salary' }[a.account_type] || a.account_type;
        return `<div class="bank-card${a.is_default ? ' bank-card-default' : ''}" id="bankCard_${a.id}" onclick="showBankModal(${a.id})" style="cursor:pointer">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div class="bank-card-name">${escHtml(a.bank_name)}${a.account_name ? ' â€” ' + escHtml(a.account_name) : ''}
                ${a.is_default ? '<span class="bank-default-badge">Default</span>' : ''}
              </div>
              <div class="bank-card-type">${typeLabel}</div>
            </div>
          </div>
          <div class="bank-card-balance-wrap" id="bankBalWrap_${a.id}" onclick="stopEvent(event);startBalanceEdit(${a.id}, ${a.balance})" title="Click to edit balance">
            <div class="bank-card-balance bank-bal-display" id="bankBalDisplay_${a.id}">${fmtCur(a.balance)}</div>
            <span class="bank-bal-edit-hint">Edit</span>
          </div>
          <div class="bank-card-spendable" id="bankSpend_${a.id}">Spendable: ${fmtCur(Math.max(0, spnd))}</div>
          <div class="bank-card-minbal">Min. balance locked: ${fmtCur(a.min_balance)}</div>
          <div class="bank-card-actions" onclick="stopEvent(event)">
            <button class="btn btn-s btn-sm" onclick="showBankModal(${a.id})">Edit</button>
            ${!a.is_default ? `<button class="btn btn-sm" style="border:1px solid var(--acc);background:transparent;color:var(--acc)" onclick="setDefaultBank(${a.id})">Set Default</button>` : ''}
            <button class="btn-d" onclick="deleteBankAccount(${a.id})">Delete</button>
          </div>
        </div>`;
      }).join('')
    : `<div style="color:var(--t3);text-align:center;padding:40px;background:var(--white);border-radius:16px;border:2px dashed var(--border);grid-column:1/-1">
        <div style="font-size:32px;margin-bottom:12px">Bank</div>
        <div style="font-weight:600;margin-bottom:6px">No bank accounts added yet</div>
        <div style="font-size:13px">Click "Add Account" to track your balances</div>
      </div>`;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="margin-bottom:20px">
        <div class="summary-top">
          <div>
            <div class="summary-label">TOTAL SPENDABLE BALANCE</div>
            <div class="summary-amount">${fmtCur(spendable)}</div>
            <div class="summary-words">${amountWords(spendable)}</div>
          </div>
          <div class="count-box"><div class="num">${accounts.length}</div><div class="lbl">accounts</div></div>
        </div>
      </div>
      ${statBar}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-size:16px;font-weight:700">My Bank Accounts</div>
        <button class="btn btn-p btn-sm" onclick="showBankModal()">+ Add Account</button>
      </div>
      <div class="bank-grid">${grid}</div>
    </div>`;
}

function showBankModal(id) {
  const found = id ? _findBankAccountById(id) : null;
  const a = found || { bank_name: '', account_name: '', account_type: 'savings', balance: '', min_balance: '' };
  openModal(id ? 'Edit Bank Account' : 'Add Bank Account', `
    <div class="fg">
      <label class="fl">Bank Name *<input class="fi" id="baBank" value="${escHtml(a.bank_name)}" placeholder="e.g. HDFC, SBI, ICICI" maxlength="80"></label>
      <label class="fl">Account Name<input class="fi" id="baName" value="${escHtml(a.account_name || '')}" placeholder="e.g. Primary Savings" maxlength="80"></label>
      <label class="fl">Account Type<select class="fi" id="baType">
        <option value="savings" ${a.account_type === 'savings' ? 'selected' : ''}>Savings</option>
        <option value="current" ${a.account_type === 'current' ? 'selected' : ''}>Current</option>
        <option value="salary" ${a.account_type === 'salary' ? 'selected' : ''}>Salary</option>
      </select></label>
      <label class="fl">Current Balance (Rs) *<input class="fi" type="number" step="0.01" id="baBal" value="${a.balance || ''}" placeholder="0.00"></label>
      <label class="fl">Minimum Balance (Rs)<input class="fi" type="number" step="0.01" id="baMin" value="${a.min_balance || ''}" placeholder="0.00">
        <span style="font-size:11px;color:var(--t3);margin-top:3px;display:block">Amount you cannot spend (locked by bank)</span>
      </label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveBankAccount(${id || 'null'})">${id ? 'Update' : 'Add Account'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => saveBankAccount(id || null));
}

function renderTrackerGrid() {
  const cards = _trackers.length ? _trackers.map((t) => `
    <div class="cc-tile" onclick="openTrackerDetail(${t.id})" style="cursor:pointer">
      <div class="cc-tile-header">
        <div>
          <div class="cc-tile-name">${escHtml(t.name)}</div>
          <div class="cc-tile-bank">${fmtCur(t.price_per_unit)} / ${escHtml(t.unit)} &nbsp;Â·&nbsp; Default: ${t.default_qty} ${escHtml(t.unit)}/day</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.65)">${t.is_active ? 'Active' : 'Inactive'}</div>
      </div>
      <div class="cc-tile-amount">${fmtCur(t.current_month_total)}</div>
      <div class="cc-tile-label">This Month &nbsp;Â·&nbsp; ${t.current_month_days} days tracked</div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px;gap:6px" onclick="stopEvent(event)">
        <button class="cc-action-btn" onclick="showTrackerModal(${t.id})">Edit</button>
        <button class="cc-action-btn cc-action-del" onclick="deleteTracker(${t.id})">Delete</button>
      </div>
    </div>`).join('') :
    `<div style="color:var(--t3);text-align:center;padding:48px 20px;background:var(--white);border-radius:16px;border:2px dashed var(--border);grid-column:1/-1">
      <div style="font-size:36px;margin-bottom:12px">Tracker</div>
      <div style="font-weight:600;margin-bottom:6px;color:var(--t1)">No trackers yet</div>
      <div style="font-size:13px">Add items like Milk, Newspaper to track daily and see monthly totals</div>
    </div>`;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="margin-bottom:20px">
        <div class="summary-top">
          <div>
            <div class="summary-label">DAILY TRACKERS</div>
            <div class="summary-amount">${_trackers.length}</div>
            <div class="summary-words">Track daily recurring items</div>
          </div>
          <div class="count-box"><div class="num">${_trackers.filter((t) => t.is_active).length}</div><div class="lbl">active</div></div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700;color:var(--t1)">My Trackers</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadTrackersOverviewPdf(new Date().getFullYear(),new Date().getMonth()+1)">PDF Overview</button>
          <button class="btn btn-p btn-sm" onclick="showTrackerModal()">+ Add Tracker</button>
        </div>
      </div>
      <div class="cc-card-grid">${cards}</div>
    </div>`;
}

async function showTrackerModal(id) {
  const t = id ? _findTrackerById(id) : null;
  openModal(id ? 'Edit Tracker' : 'Add Tracker', `
    <div class="fg">
      <label class="fl full">Name *<input class="fi" id="trName" value="${escHtml(t?.name || '')}" placeholder="e.g. Milk, Newspaper, Maid..." maxlength="80"></label>
      <label class="fl">Unit *<input class="fi" id="trUnit" value="${escHtml(t?.unit || 'unit')}" placeholder="litre, piece, visit..." maxlength="30"></label>
      <label class="fl">Price per Unit (Rs) *<input class="fi" type="number" step="0.01" id="trPrice" value="${t?.price_per_unit || ''}" placeholder="0.00"></label>
      <label class="fl">Default Qty / Day<input class="fi" type="number" step="0.01" min="0" id="trDefaultQty" value="${t?.default_qty ?? 1}" placeholder="1"></label>
    </div>
    <p style="font-size:12px;color:var(--t3);margin:0 0 12px">Each day will be auto-filled with the default quantity. You can edit any day individually.</p>
    <div class="fa">
      <button class="btn btn-p" onclick="saveTracker(${id || 'null'})">${id ? 'Update' : 'Add Tracker'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => saveTracker(id || null));
}

async function showCcCardModal(id) {
  let card = { bank_name: '', card_name: '', last4: '', expiry_month: '', expiry_year: '', bill_gen_day: 1, due_days: 20, default_discount_pct: 0, credit_limit: '' };
  let currentCycle = null;
  if (id) {
    const c = _findCcCardById(id);
    if (c) {
      card = c;
      currentCycle = c.currentCycle || null;
    } else {
      const data = await api(`/api/cc/cards/${id}/current`);
      if (data?.card) {
        card = data.card;
        currentCycle = data.cycle || null;
      }
    }
  }
  openModal(id ? 'Edit Credit Card' : 'Add Credit Card', `
    <div class="fg">
      <label class="fl">Bank Name *<input class="fi" id="ccBank" value="${escHtml(card.bank_name)}" placeholder="e.g. HDFC, SBI, ICICI" maxlength="80"></label>
      <label class="fl">Card Name *<input class="fi" id="ccName" value="${escHtml(card.card_name)}" placeholder="e.g. HDFC Regalia" maxlength="80"></label>
      <label class="fl">Last 4 Digits *<input class="fi" id="ccLast4" value="${escHtml(card.last4)}" placeholder="1234" maxlength="4"></label>
      <label class="fl">Expiry Month<input class="fi" type="number" id="ccExpM" value="${card.expiry_month || ''}" placeholder="MM" min="1" max="12"></label>
      <label class="fl">Expiry Year<input class="fi" type="number" id="ccExpY" value="${card.expiry_year || ''}" placeholder="YYYY" min="2024" max="2040"></label>
      <label class="fl">Bill Generation Day *<input class="fi" type="number" id="ccBillDay" value="${card.bill_gen_day || 1}" min="1" max="28" placeholder="e.g. 15"></label>
      <label class="fl">Payment Due (days after bill)<input class="fi" type="number" id="ccDueDays" value="${card.due_days || 20}" min="1" max="60"></label>
      ${currentCycle ? `<label class="fl">Current Cycle Due Date<input class="fi" type="date" id="ccCurrentDueDate" value="${normalizeInputDate(currentCycle.due_date) || ''}"></label>` : ''}
      <label class="fl">Default Discount %<input class="fi" type="number" id="ccDisc" value="${card.default_discount_pct || 0}" step="0.1" min="0" max="100" placeholder="0"></label>
      <label class="fl">Credit Limit (Rs)<input class="fi" type="number" id="ccLimit" value="${card.credit_limit || ''}" placeholder="optional"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveCcCard(${id || 'null'})">${id ? 'Update' : 'Add Card'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => saveCcCard(id || null));
}

function showAddPaymentModal() {
  const defaultDue = `${_plannerMonth}-01`;
  openModal('Add Payment', `
    <div class="fg">
      <label class="fl full">Name *<input class="fi" id="mpName" placeholder="e.g. Rent, Netflix, Electricity..." maxlength="120" autofocus></label>
      <label class="fl">Amount (Rs) *<input class="fi" type="number" step="0.01" id="mpAmt" placeholder="0.00"></label>
      <label class="fl">Due Date<input class="fi" type="date" id="mpDue" value="${defaultDue}"></label>
      <label class="fl">Bank Account<select class="fi" id="mpBank"><option value="">-- None --</option>${_bankDropdownOptions(null)}</select></label>
      <label class="fl full">Notes<input class="fi" id="mpNotes" placeholder="optional" maxlength="240"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveMonthlyPayment(null)">Add</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => saveMonthlyPayment(null));
}

async function showEditPaymentModal(id) {
  const data = await api(`/api/planner/monthly?month=${_plannerMonth}`);
  const p = data?.payments?.find((x) => x.id === id);
  if (!p) return;
  openModal('Edit Payment', `
    <div class="fg">
      <label class="fl full">Name *<input class="fi" id="mpName" value="${escHtml(p.name)}" maxlength="120" autofocus></label>
      <label class="fl">Amount (Rs) *<input class="fi" type="number" step="0.01" id="mpAmt" value="${p.amount}"></label>
      <label class="fl">Due Date<input class="fi" type="date" id="mpDue" value="${normalizeInputDate(p.due_date) || ''}"></label>
      <label class="fl">Bank Account<select class="fi" id="mpBank"><option value="">-- None --</option>${_bankDropdownOptions(p.bank_account_id)}</select></label>
      <label class="fl full">Notes<input class="fi" id="mpNotes" value="${escHtml(p.notes || '')}" maxlength="240"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveMonthlyPayment(${id})">Update</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => saveMonthlyPayment(id));
}

async function showDefaultModal(id) {
  let d = { name: '', amount: '', due_day: 1, category: '', is_active: 1, bank_account_id: null, auto_detect_bank: 0 };
  if (id) {
    const data = await api('/api/planner/defaults');
    const found = data?.defaults?.find((x) => x.id === id);
    if (found) d = found;
  }
  const autoDetectChecked = d.auto_detect_bank ? 'checked' : '';
  openModal(id ? 'Edit Default Payment' : 'Add Default Payment', `
    <div class="fg">
      <label class="fl full">Name *<input class="fi" id="dpName" value="${escHtml(d.name)}" placeholder="e.g. Rent, Netflix, EMI..." maxlength="120" autofocus></label>
      <label class="fl">Amount (Rs) *<input class="fi" type="number" step="0.01" id="dpAmt" value="${d.amount || ''}" placeholder="0.00"></label>
      <label class="fl">Due Day (1-28)<input class="fi" type="number" id="dpDay" value="${d.due_day || 1}" min="1" max="28"></label>
      <label class="fl">Category<input class="fi" id="dpCat" value="${escHtml(d.category || '')}" placeholder="e.g. Rent, Utilities, Subscriptions" maxlength="80"></label>
      <label class="fl">Bank Account<select class="fi" id="dpBank"><option value="">-- None --</option>${_bankDropdownOptions(d.bank_account_id)}</select></label>
      <label class="fl" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="dpAutoBank" ${autoDetectChecked}>
        <span>Auto-debit from this bank account</span>
      </label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="saveDefault(${id || 'null'})">${id ? 'Update' : 'Add'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => saveDefault(id || null));
}

function showPayModal(id, amount) {
  openModal('Mark as Paid', `
    <div class="fg">
      <label class="fl">Amount Paid (Rs)<input class="fi" type="number" step="0.01" id="pmAmt" value="${amount}" autofocus></label>
      <label class="fl">Payment Date<input class="fi" type="date" id="pmDate" value="${todayStr()}"></label>
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doPayMonthly(${id})">Mark Paid</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => doPayMonthly(id));
}

async function showRecurringModal(id) {
  const entry = id ? _findRecurringEntryById(id) : null;
  if (!_expenseCategories.length) await loadExpenseCategories();
  const cards = _ccCards && _ccCards.length ? _ccCards : (await api('/api/cc/cards'))?.cards || [];
  if (!_ccCards || !_ccCards.length) _ccCards = cards;
  if (!_bankAccounts.length) {
    const banksData = await api('/api/banks');
    _bankAccounts = banksData?.accounts || [];
  }
  const currentMonth = _localYM();
  const isCC = entry?.type === 'cc_txn';
  const dueDay = Math.max(1, Math.min(28, parseInt(entry?.due_day, 10) || 1));
  const reminderEnabled = !!entry?.reminder_enabled;
  const reminderDaysBefore = Math.max(0, parseInt(entry?.reminder_days_before, 10) || 0);
  const reminderFrequency = String(entry?.reminder_frequency || 'once').toLowerCase();
  const cardOptions = cards.map((c) => `<option value="${c.id}" ${entry?.card_id === c.id ? 'selected' : ''}>${escHtml(c.bank_name)} ${escHtml(c.card_name)} **${escHtml(c.last4)}</option>`).join('');
  const bankOptions = `<option value="">-- Default / none --</option>${_bankDropdownOptions(entry?.bank_account_id)}`;

  openModal(id ? 'Edit Recurring Entry' : 'Add Recurring Entry', `
    <div class="fg">
      <label class="fl full">Type
        <select class="fi" id="reType" onchange="recurringTypeToggle()">
          <option value="expense" ${!isCC ? 'selected' : ''}>Expense</option>
          <option value="cc_txn" ${isCC ? 'selected' : ''}>Credit Card Transaction</option>
        </select>
      </label>
      <label class="fl full">Description *<input class="fi" id="reDesc" value="${escHtml(entry?.description || '')}" placeholder="e.g. Netflix, Gym, Electricity..." maxlength="160"></label>
      <label class="fl">Amount (Rs) *<input class="fi" type="number" step="0.01" id="reAmt" value="${entry?.amount || ''}" placeholder="0.00"></label>
      <label class="fl">Payment Day (1-28)<input class="fi" type="number" id="reDueDay" value="${dueDay}" min="1" max="28"></label>
      <label class="fl">Repeat Every<select class="fi" id="reInterval">
        <option value="1" ${(parseInt(entry?.interval_months) || 1) === 1 ? 'selected' : ''}>Every month</option>
        <option value="2" ${(parseInt(entry?.interval_months) || 1) === 2 ? 'selected' : ''}>Every 2 months</option>
        <option value="3" ${(parseInt(entry?.interval_months) || 1) === 3 ? 'selected' : ''}>Every 3 months</option>
        <option value="6" ${(parseInt(entry?.interval_months) || 1) === 6 ? 'selected' : ''}>Every 6 months</option>
        <option value="12" ${(parseInt(entry?.interval_months) || 1) === 12 ? 'selected' : ''}>Every 12 months</option>
      </select></label>
      <label class="fl">Starts From Month<input class="fi" type="month" id="reStartMonth" value="${escHtml(entry?.start_month || currentMonth)}"></label>
      <label class="fl full" id="reBankRow" style="${isCC ? 'display:none' : ''}">Deduct From Bank<select class="fi" id="reBank">${bankOptions}</select></label>
    </div>

    <div id="reCcFields" style="${isCC ? '' : 'display:none'}">
      <div class="fg">
        <label class="fl full">Credit Card
          <select class="fi" id="reCard">${cardOptions || '<option value="">No cards found</option>'}</select>
        </label>
        <label class="fl">Discount %<input class="fi" type="number" step="0.1" id="reDisc" value="${entry?.discount_pct || 0}" min="0" max="100"></label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-bottom:12px;cursor:pointer">
        <input type="checkbox" id="reAlsoExpense" ${entry?.also_expense ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer" onchange="toggleRecurringExpenseCategory()">
        Also add as expense
      </label>
      <label class="fl full" id="reCcExpenseCategoryRow" style="${isCC && !entry?.also_expense ? 'display:none' : ''}">Expense Category
        <input class="fi" id="reCcExpenseCategory" list="expenseCategoryList" value="${escHtml(entry?.expense_category || '')}" placeholder="e.g. Subscriptions, Bills, Shopping">
      </label>
    </div>

    <div id="reExpenseFields" style="${isCC ? 'display:none' : ''}">
      <label class="fl full">Expense Category
        <input class="fi" id="reExpenseCategory" list="expenseCategoryList" value="${escHtml(entry?.expense_category || '')}" placeholder="e.g. Bills, Rent, Groceries">
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-bottom:12px;cursor:pointer">
        <input type="checkbox" id="reIsExtra" ${entry?.is_extra ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer">
        Mark as extra spending
      </label>
      ${!id ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-bottom:12px;cursor:pointer">
        <input type="checkbox" id="reApplyCurrentMonth" style="width:15px;height:15px;cursor:pointer">
        Add this recurring expense for the current month as well
      </label>` : ''}
    </div>
    <div style="margin:14px 0;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--card2)">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-bottom:10px;cursor:pointer">
        <input type="checkbox" id="reReminderEnabled" ${reminderEnabled ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer" onchange="toggleRecurringReminderFields()">
        Enable payment reminders
      </label>
      <div id="reReminderFields" style="${reminderEnabled ? '' : 'display:none'}">
        <div class="fg">
          <label class="fl">Start Before (days)<input class="fi" type="number" id="reReminderDaysBefore" value="${reminderDaysBefore}" min="0" max="31"></label>
          <label class="fl">Reminder Frequency<select class="fi" id="reReminderFrequency">
            <option value="once" ${reminderFrequency === 'once' ? 'selected' : ''}>Once</option>
            <option value="daily" ${reminderFrequency === 'daily' ? 'selected' : ''}>Daily</option>
            <option value="weekly" ${reminderFrequency === 'weekly' ? 'selected' : ''}>Weekly</option>
          </select></label>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--t2);margin-top:8px;cursor:pointer">
          <input type="checkbox" id="reReminderSilent" ${entry?.reminder_silent ? 'checked' : ''} style="width:15px;height:15px;cursor:pointer">
          Silent only: track in Notifications tab but do not send push alert
        </label>
      </div>
    </div>
    <datalist id="expenseCategoryList">${_expenseCategories.map((cat) => `<option value="${escHtml(cat)}"></option>`).join('')}</datalist>

    <div class="fa">
      <button class="btn btn-p" onclick="saveRecurring(${id || 'null'})">${id ? 'Update' : 'Add'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => saveRecurring(id || null));
}

async function saveRecurring(id) {
  const type = document.getElementById('reType').value;
  const description = document.getElementById('reDesc').value.trim();
  const amount = parseFloat(document.getElementById('reAmt').value);
  if (!description) { toast('Description is required', 'warning'); return; }
  if (description.length > 140) { toast('Description must be 140 characters or fewer', 'warning'); return; }
  if (!Number.isFinite(amount) || amount <= 0) { toast('Amount must be greater than 0', 'warning'); return; }
  const bankVal = document.getElementById('reBank')?.value;
  const intervalMonths = parseInt(document.getElementById('reInterval').value, 10) || 1;
  const startMonth = document.getElementById('reStartMonth').value || _localYM();
  if (!/^\d{4}-\d{2}$/.test(startMonth)) { toast('Start month must be in YYYY-MM format', 'warning'); return; }
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 24) { toast('Repeat interval must be between 1 and 24 months', 'warning'); return; }
  const body = {
    type,
    description,
    amount,
    interval_months: intervalMonths,
    start_month: startMonth,
    due_day: parseInt(document.getElementById('reDueDay').value, 10) || 1,
    reminder_enabled: document.getElementById('reReminderEnabled')?.checked ? 1 : 0,
    reminder_days_before: parseInt(document.getElementById('reReminderDaysBefore')?.value, 10) || 0,
    reminder_frequency: document.getElementById('reReminderFrequency')?.value || 'once',
    reminder_silent: document.getElementById('reReminderSilent')?.checked ? 1 : 0,
    bank_account_id: type === 'expense' ? (bankVal ? parseInt(bankVal, 10) : null) : null,
    expense_category: type === 'cc_txn'
      ? (document.getElementById('reCcExpenseCategory')?.value.trim() || null)
      : (document.getElementById('reExpenseCategory')?.value.trim() || null),
  };
  if (!Number.isInteger(body.due_day) || body.due_day < 1 || body.due_day > 28) { toast('Payment day must be between 1 and 28', 'warning'); return; }
  if (!Number.isInteger(body.reminder_days_before) || body.reminder_days_before < 0 || body.reminder_days_before > 31) { toast('Reminder days before must be between 0 and 31', 'warning'); return; }
  if (type === 'cc_txn') {
    body.card_id = parseInt(document.getElementById('reCard').value, 10) || null;
    body.discount_pct = parseFloat(document.getElementById('reDisc').value) || 0;
    body.also_expense = document.getElementById('reAlsoExpense').checked ? 1 : 0;
    if (!body.card_id) { toast('Please select a credit card', 'warning'); return; }
    if (!Number.isFinite(body.discount_pct) || body.discount_pct < 0 || body.discount_pct > 100) {
      toast('Discount % must be between 0 and 100', 'warning');
      return;
    }
  } else {
    body.is_extra = document.getElementById('reIsExtra').checked ? 1 : 0;
    if (!id) body.apply_current_month = document.getElementById('reApplyCurrentMonth')?.checked ? 1 : 0;
  }
  const r = id
    ? await api(`/api/recurring/${id}`, { method: 'PUT', body })
    : await api('/api/recurring', { method: 'POST', body });
  if (r?.success || r?.id) {
    closeModal();
    toast(id ? 'Updated' : 'Recurring entry added', 'success');
    loadRecurring();
  } else toast(r?.error || 'Failed', 'error');
}

function _aiAssistantBubble(text, isError = false) {
  // Convert markdown-like formatting: **bold**, `code`, newlines
  let html = escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.06);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px">$1</code>')
    .replace(/\n/g, '<br>');
  return `<div class="ai-bubble ai-bubble-assistant" style="${isError ? 'color:var(--red)' : ''}">${html}</div>`;
}

function trackerMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function parseTrackerMonthKey(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number);
  return { year, month };
}

function getTrackerMonthSequence(count = 6) {
  const months = [];
  const base = new Date(_trackerYear, _trackerMonth - 1, 1);
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: trackerMonthKey(d.getFullYear(), d.getMonth() + 1) });
  }
  return months;
}

async function renderTrackerGrid() {
  const cards = _trackers.length ? _trackers.map((t) => `
    <div class="cc-tile" onclick="openTrackerDetail(${t.id})" style="cursor:pointer">
      <div class="cc-tile-header">
        <div>
          <div class="cc-tile-name">${escHtml(t.name)}</div>
          <div class="cc-tile-bank">${fmtCur(t.price_per_unit)} / ${escHtml(t.unit)} &nbsp;·&nbsp; Default: ${t.default_qty} ${escHtml(t.unit)}/day</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.65)">${t.is_active ? 'Active' : 'Inactive'}</div>
      </div>
      <div class="cc-tile-amount">${fmtCur(t.current_month_total)}</div>
      <div class="cc-tile-label">
        This Month · ${t.current_month_days} days tracked
        ${t.auto_add_to_expense ? '<br><span style="font-size:10px;opacity:.9">Auto-adds previous month to expenses</span>' : ''}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px;gap:6px" onclick="stopEvent(event)">
        <button class="cc-action-btn" onclick="showTrackerModal(${t.id})">Edit</button>
        <button class="cc-action-btn cc-action-del" onclick="deleteTracker(${t.id})">Delete</button>
      </div>
    </div>`).join('') :
    `<div style="color:var(--t3);text-align:center;padding:48px 20px;background:var(--white);border-radius:16px;border:2px dashed var(--border);grid-column:1/-1">
      <div style="font-size:36px;margin-bottom:12px">Tracker</div>
      <div style="font-weight:600;margin-bottom:6px;color:var(--t1)">No trackers yet</div>
      <div style="font-size:13px">Add items like Milk, Newspaper to track daily and see monthly totals</div>
    </div>`;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="margin-bottom:20px">
        <div class="summary-top">
          <div>
            <div class="summary-label">DAILY TRACKERS</div>
            <div class="summary-amount">${_trackers.length}</div>
            <div class="summary-words">Track daily recurring items month by month</div>
          </div>
          <div class="count-box"><div class="num">${_trackers.filter((t) => t.is_active).length}</div><div class="lbl">active</div></div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700;color:var(--t1)">My Trackers</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadTrackersOverviewPdf(new Date().getFullYear(),new Date().getMonth()+1)">PDF Overview</button>
          <button class="btn btn-p btn-sm" onclick="showTrackerModal()">+ Add Tracker</button>
        </div>
      </div>
      <div class="cc-card-grid">${cards}</div>
    </div>`;
}

async function renderTrackerDetail() {
  const tracker = _trackers.find((t) => t.id === _selectedTrackerId);
  if (!tracker) { renderTrackerGrid(); return; }

  const monthSeq = getTrackerMonthSequence(6);
  const [entriesRes, summaryRes, tileSummaries] = await Promise.all([
    api(`/api/trackers/${_selectedTrackerId}/entries?year=${_trackerYear}&month=${_trackerMonth}`),
    api(`/api/trackers/${_selectedTrackerId}/summary?year=${_trackerYear}&month=${_trackerMonth}`),
    Promise.all(monthSeq.map(({ year, month, key }) =>
      api(`/api/trackers/${_selectedTrackerId}/summary?year=${year}&month=${month}`).then((res) => ({
        key,
        year,
        month,
        summary: res?.summary || { total_amount: 0, days: 0, added_to_expense: 0 },
      }))
    )),
  ]);

  const entries = entriesRes?.entries || [];
  const summary = summaryRes?.summary || {};
  const entryMap = {};
  entries.forEach((e) => { entryMap[e.entry_date] = e; });

  const today = new Date().toISOString().split('T')[0];
  const daysInMonth = new Date(_trackerYear, _trackerMonth, 0).getDate();
  const currentMonthKey = trackerMonthKey(_trackerYear, _trackerMonth);
  const isCurrentMonth = currentMonthKey === today.slice(0, 7);

  let rows = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentMonthKey}-${String(d).padStart(2, '0')}`;
    const e = entryMap[dateStr];
    const dayLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
    const isFuture = dateStr > today;
    const isToday = dateStr === today;
    const rowStyle = isToday ? 'background:var(--bg2)' : '';

    if (isFuture) {
      rows += `<tr style="color:var(--t3);${rowStyle}">
        <td><span style="font-weight:${isToday ? 600 : 400}">${d}</span> <span style="font-size:11px">${dayLabel}</span></td>
        <td style="text-align:right;color:var(--t3)">-</td><td style="text-align:right">-</td><td></td><td></td></tr>`;
    } else if (e) {
      const badge = e.is_auto
        ? `<span class="badge" style="background:var(--bg2);color:var(--t3);font-size:10px">Auto</span>`
        : `<span class="badge b-fair" style="font-size:10px">Edited</span>`;
      rows += `<tr id="trow-${dateStr}" style="${rowStyle}">
        <td><strong>${d}</strong> <span style="font-size:11px;color:var(--t3)">${dayLabel}</span>${isToday ? ' <span style="font-size:10px;color:var(--em)">Today</span>' : ''}</td>
        <td style="text-align:right" id="tqty-${dateStr}">${e.quantity} <span style="color:var(--t3);font-size:12px">${escHtml(tracker.unit)}</span></td>
        <td style="text-align:right;font-weight:600">${fmtCur(e.amount)}</td>
        <td>${badge}</td>
        <td><button class="btn-d" style="color:var(--em)" onclick="editDayEntry(${tracker.id},'${dateStr}',${e.quantity})">Edit</button></td>
      </tr>`;
    } else {
      rows += `<tr id="trow-${dateStr}" style="color:var(--t3);${rowStyle}">
        <td><strong>${d}</strong> <span style="font-size:11px">${dayLabel}</span></td>
        <td style="text-align:right">-</td><td style="text-align:right">-</td>
        <td><span class="badge" style="background:var(--bg2);color:var(--t3);font-size:10px">Missing</span></td>
        <td><button class="btn-d" onclick="editDayEntry(${tracker.id},'${dateStr}',${tracker.default_qty})">Add</button></td>
      </tr>`;
    }
  }

  const totalQty = summary.total_qty ? parseFloat(summary.total_qty).toFixed(2) : '0';
  const totalAmt = summary.total_amount || 0;
  const addedToExpense = summary.added_to_expense;
  const monthTiles = tileSummaries.map(({ key, year, month, summary: tile }) => {
    const active = key === currentMonthKey;
    const complete = key < today.slice(0, 7);
    const canAdd = complete && tile.total_amount > 0 && !tile.added_to_expense;
    return `<button class="chip ${active ? 'active' : ''}" style="display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:120px;padding:10px 12px" onclick="_trackerYear=${year};_trackerMonth=${month};renderTrackerDetail()">
      <span style="font-weight:700">${_MONTHS_LONG[month - 1]} ${year}</span>
      <span style="font-size:11px;opacity:.8">${fmtCur(tile.total_amount || 0)} · ${tile.days || 0} days</span>
      <span style="font-size:10px;opacity:.8">${tile.added_to_expense ? 'Added to expenses' : canAdd ? 'Ready to add' : complete ? 'No amount' : 'Current month'}</span>
    </button>`;
  }).join('');

  const trackerBank = tracker.expense_bank_account_id ? _bankAccounts.find((a) => a.id == tracker.expense_bank_account_id) : null;
  const autoNote = tracker.auto_add_to_expense
    ? `Auto-add enabled${trackerBank ? ` · deduct from ${trackerBank.bank_name}` : ''}`
    : 'Auto-add disabled';

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-g btn-sm" onclick="_selectedTrackerId=null;renderTrackerGrid()">← Back</button>
        <div>
          <span style="font-size:18px;font-weight:700">${escHtml(tracker.name)}</span>
          <span style="color:var(--t2);font-size:13px;margin-left:10px">${fmtCur(tracker.price_per_unit)}/${escHtml(tracker.unit)} · Default: ${tracker.default_qty} ${escHtml(tracker.unit)}/day</span>
          <div style="font-size:11px;color:var(--t3);margin-top:2px">${autoNote}</div>
        </div>
        <button class="btn btn-g btn-sm" style="margin-left:auto" onclick="showTrackerModal(${tracker.id})">Edit</button>
      </div>

      <div class="filter-row" style="gap:8px;overflow:auto;margin-bottom:12px">${monthTiles}</div>

      <div class="summary-card" style="margin-bottom:16px">
        <div class="summary-top">
          <div>
            <div class="summary-label">${_MONTHS_LONG[_trackerMonth - 1].toUpperCase()} ${_trackerYear}</div>
            <div class="summary-amount">${fmtCur(totalAmt)}</div>
            <div class="summary-words">${totalQty} ${escHtml(tracker.unit)} · ${summary.days || 0} days · ${summary.auto_days || 0} auto, ${summary.edited_days || 0} edited</div>
          </div>
          <div class="count-box" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">
            ${addedToExpense
              ? `<div style="font-size:11px;color:rgba(255,255,255,0.8);font-weight:600;text-align:center">Added to<br>Expenses</div>`
              : `<button class="btn btn-p btn-sm" onclick="addTrackerExpense(${tracker.id},${_trackerYear},${_trackerMonth})" ${totalAmt ? '' : 'disabled'}>+ To Expenses</button>`}
          </div>
        </div>
      </div>

      <div class="filter-row" style="justify-content:space-between;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-g btn-sm" onclick="trackerPrevMonth()">←</button>
          <span style="font-weight:600;min-width:130px;text-align:center">${_MONTHS_LONG[_trackerMonth - 1]} ${_trackerYear}</span>
          <button class="btn btn-g btn-sm" onclick="trackerNextMonth()" ${isCurrentMonth ? 'disabled' : ''}>→</button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadTrackerMonthPdf(${tracker.id},'${escHtml(tracker.name)}',${_trackerYear},${_trackerMonth})">PDF</button>
          ${isCurrentMonth ? `<button class="btn btn-s btn-sm" onclick="autoFillTracker(${tracker.id})">Auto-fill Missing</button>` : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Date</th>
            <th style="text-align:right">Quantity</th>
            <th style="text-align:right">Amount</th>
            <th>Status</th>
            <th style="width:80px">Action</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

async function showTrackerModal(id) {
  if (!_bankAccounts.length) {
    const banksData = await api('/api/banks');
    _bankAccounts = banksData?.accounts || [];
  }
  if (!_expenseCategories.length) await loadExpenseCategories();
  const t = id ? _findTrackerById(id) : null;
  const bankOpts = `<option value="">-- Do not deduct --</option>${_bankDropdownOptions(t?.expense_bank_account_id)}`;
  openModal(id ? 'Edit Tracker' : 'Add Tracker', `
    <div class="fg">
      <label class="fl full">Name *<input class="fi" id="trName" value="${escHtml(t?.name || '')}" placeholder="e.g. Milk, Newspaper, Maid..." maxlength="80"></label>
      <label class="fl">Unit *<input class="fi" id="trUnit" value="${escHtml(t?.unit || 'unit')}" placeholder="litre, piece, visit..." maxlength="30"></label>
      <label class="fl">Price per Unit (Rs) *<input class="fi" type="number" step="0.01" id="trPrice" value="${t?.price_per_unit || ''}" placeholder="0.00"></label>
      <label class="fl">Default Qty / Day<input class="fi" type="number" step="0.01" min="0" id="trDefaultQty" value="${t?.default_qty ?? 1}" placeholder="1"></label>
      <label class="fl full">Expense Bank<select class="fi" id="trExpenseBank">${bankOpts}</select></label>
      <label class="fl full">Default Expense Category${expenseCategoryDatalistHtml(t?.expense_category || '')}</label>
      <label class="fl full" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="trAutoExpense" ${t?.auto_add_to_expense ? 'checked' : ''}>
        <span>Automatically add the previous completed month to Expenses</span>
      </label>
      <label class="fl full" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="trIsActive" ${(t?.is_active ?? true) ? 'checked' : ''}>
        <span>Active tracker</span>
      </label>
    </div>
    <p style="font-size:12px;color:var(--t3);margin:0 0 12px">When auto-add is enabled, the previous month is converted into an expense on the next month automatically.</p>
    <div class="fa">
      <button class="btn btn-p" onclick="saveTracker(${id || 'null'})">${id ? 'Update' : 'Add Tracker'}</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => saveTracker(id || null));
}

async function saveTracker(id) {
  const name = document.getElementById('trName').value.trim();
  const unit = document.getElementById('trUnit').value.trim() || 'unit';
  const price_per_unit = parseFloat(document.getElementById('trPrice').value);
  const default_qty = parseFloat(document.getElementById('trDefaultQty').value) || 1;
  const bankVal = document.getElementById('trExpenseBank')?.value;
  const expense_category = document.getElementById('eCategory')?.value.trim() || null;
  if (!name) { toast('Name is required', 'warning'); return; }
  if (name.length > 80) { toast('Name must be 80 characters or fewer', 'warning'); return; }
  if (!unit) { toast('Unit is required', 'warning'); return; }
  if (unit.length > 30) { toast('Unit must be 30 characters or fewer', 'warning'); return; }
  if (!Number.isFinite(price_per_unit) || price_per_unit <= 0) { toast('Price per unit must be greater than 0', 'warning'); return; }
  if (!Number.isFinite(default_qty) || default_qty < 0) { toast('Default quantity cannot be negative', 'warning'); return; }
  const body = {
    name,
    unit,
    price_per_unit,
    default_qty,
    is_active: document.getElementById('trIsActive')?.checked ? 1 : 0,
    auto_add_to_expense: document.getElementById('trAutoExpense')?.checked ? 1 : 0,
    expense_bank_account_id: bankVal ? parseInt(bankVal, 10) : null,
    expense_category,
  };
  const r = id
    ? await api(`/api/trackers/${id}`, { method: 'PUT', body })
    : await api('/api/trackers', { method: 'POST', body });
  if (r?.success || r?.id) {
    closeModal();
    toast(id ? 'Tracker updated' : 'Tracker added', 'success');
    await loadTracker();
  } else toast(r?.error || 'Failed', 'error');
}

function showCcPayModal(cycleId, netPayable) {
  const defaultBank = _bankAccounts.find((a) => a.is_default);
  const bankOptions = `<option value="">${defaultBank ? `Default: ${escHtml(defaultBank.bank_name)}` : '-- No default bank --'}</option>${_bankDropdownOptions(null)}`;
  openModal('Pay Credit Card Bill', `
    <div class="fg">
      <label class="fl">Amount Paid (Rs)<input class="fi" type="number" step="0.01" id="ccpAmt" value="${netPayable.toFixed(2)}" autofocus></label>
      <label class="fl">Payment Date<input class="fi" type="date" id="ccpDate" value="${todayStr()}"></label>
      <label class="fl full">Deduct From Bank<select class="fi" id="ccpBank">${bankOptions}</select></label>
    </div>
    <div style="background:var(--blue-l);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--blue);margin-bottom:12px">
      Net payable: <strong>${fmtCur(netPayable)}</strong>. Paying closes this billing cycle.
    </div>
    <div class="fa">
      <button class="btn btn-p" onclick="doCcPayFromPlanner(${cycleId})">Mark Paid</button>
      <button class="btn btn-g" onclick="closeModal()">Cancel</button>
    </div>`);
  bindModalSubmit(() => doCcPayFromPlanner(cycleId));
}

async function doCcPayFromPlanner(cycleId) {
  const bankVal = document.getElementById('ccpBank')?.value;
  const paidAmount = parseFloat(document.getElementById('ccpAmt').value);
  const paidDate = document.getElementById('ccpDate').value;
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) { toast('Amount paid must be greater than 0', 'warning'); return; }
  if (!paidDate) { toast('Payment date is required', 'warning'); return; }
  const body = {
    paid_amount: paidAmount,
    paid_date: paidDate,
    bank_account_id: bankVal ? parseInt(bankVal, 10) : null,
  };
  const r = await api(`/api/cc/cycles/${cycleId}/close`, { method: 'POST', body });
  if (r?.success) { closeModal(); toast('CC bill marked as paid', 'success'); renderPlanner(); }
  else toast(r?.error || 'Failed', 'error');
}

function renderBankAccounts() {
  const accounts = _bankAccounts;
  const totalBal = accounts.reduce((s, a) => s + a.balance, 0);
  const totalMin = accounts.reduce((s, a) => s + a.min_balance, 0);
  const spendable = totalBal - totalMin;

  const statBar = `
    <div class="bank-summary-bar">
      <div class="bank-stat"><div class="lbl">Total Balance</div><div class="val">${fmtCur(totalBal)}</div></div>
      <div class="bank-stat"><div class="lbl">Locked (Min Balance)</div><div class="val red">${fmtCur(totalMin)}</div></div>
      <div class="bank-stat"><div class="lbl">Spendable</div><div class="val green">${fmtCur(spendable)}</div></div>
      <div class="bank-stat"><div class="lbl">Accounts</div><div class="val">${accounts.length}</div></div>
    </div>`;

  const grid = accounts.length
    ? accounts.map((a) => {
        const spnd = a.balance - a.min_balance;
        const typeLabel = { savings: 'Savings', current: 'Current', salary: 'Salary' }[a.account_type] || a.account_type;
        return `<div class="bank-card${a.is_default ? ' bank-card-default' : ''}" id="bankCard_${a.id}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div class="bank-card-name">${escHtml(a.bank_name)}${a.account_name ? ' - ' + escHtml(a.account_name) : ''}
                ${a.is_default ? '<span class="bank-default-badge">Default</span>' : ''}
              </div>
              <div class="bank-card-type">${typeLabel}</div>
            </div>
          </div>
          <div class="bank-card-balance-wrap" id="bankBalWrap_${a.id}" onclick="stopEvent(event);startBalanceEdit(${a.id}, ${a.balance})" title="Click to edit balance">
            <div class="bank-card-balance bank-bal-display" id="bankBalDisplay_${a.id}">${fmtCur(a.balance)}</div>
            <span class="bank-bal-edit-hint">Edit</span>
          </div>
          <div class="bank-card-spendable" id="bankSpend_${a.id}">Spendable: ${fmtCur(Math.max(0, spnd))}</div>
          <div class="bank-card-minbal">Min. balance locked: ${fmtCur(a.min_balance)}</div>
          <div class="bank-card-actions" onclick="stopEvent(event)">
            <button class="btn btn-s btn-sm" onclick="showBankModal(${a.id})">Edit</button>
            ${!a.is_default ? `<button class="btn btn-sm" style="border:1px solid var(--acc);background:transparent;color:var(--acc)" onclick="setDefaultBank(${a.id})">Set Default</button>` : ''}
            <button class="btn-d" onclick="deleteBankAccount(${a.id})">Delete</button>
          </div>
        </div>`;
      }).join('')
    : `<div style="color:var(--t3);text-align:center;padding:40px;background:var(--white);border-radius:16px;border:2px dashed var(--border);grid-column:1/-1">
        <div style="font-size:32px;margin-bottom:12px">Bank</div>
        <div style="font-weight:600;margin-bottom:6px">No bank accounts added yet</div>
        <div style="font-size:13px">Click "Add Account" to track your balances</div>
      </div>`;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="margin-bottom:20px">
        <div class="summary-top">
          <div>
            <div class="summary-label">TOTAL SPENDABLE BALANCE</div>
            <div class="summary-amount">${fmtCur(spendable)}</div>
            <div class="summary-words">${amountWords(spendable)}</div>
          </div>
          <div class="count-box"><div class="num">${accounts.length}</div><div class="lbl">accounts</div></div>
        </div>
      </div>
      ${statBar}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-size:16px;font-weight:700">My Bank Accounts</div>
        <button class="btn btn-p btn-sm" onclick="showBankModal()">+ Add Account</button>
      </div>
      <div class="bank-grid">${grid}</div>
    </div>`;
  repairMojibakeInNode(document.getElementById('main'));
}

async function renderTrackerGrid() {
  const cards = _trackers.length ? _trackers.map((t) => `
    <div class="cc-tile tracker-tile" data-tracker-id="${t.id}" onclick="openTrackerDetail(${t.id})" style="cursor:pointer" role="button" tabindex="0" onkeydown="if(event.key==='Enter' || event.key===' '){ event.preventDefault(); openTrackerDetail(${t.id}); }">
      <div class="cc-tile-header">
        <div>
          <div class="cc-tile-name">${escHtml(t.name)}</div>
          <div class="cc-tile-bank">${fmtCur(t.price_per_unit)} / ${escHtml(t.unit)} &nbsp;·&nbsp; Default: ${t.default_qty} ${escHtml(t.unit)}/day</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.65)">${t.is_active ? 'Active' : 'Inactive'}</div>
      </div>
      <div class="cc-tile-amount">${fmtCur(t.current_month_total)}</div>
      <div class="cc-tile-label">
        This Month · ${t.current_month_days} days tracked
        ${t.auto_add_to_expense ? '<br><span style="font-size:10px;opacity:.9">Auto-adds previous month to expenses</span>' : ''}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px;gap:6px" onclick="stopEvent(event)">
        <button class="cc-action-btn" onclick="showTrackerModal(${t.id})">Edit</button>
        <button class="cc-action-btn cc-action-del" onclick="deleteTracker(${t.id})">Delete</button>
      </div>
    </div>`).join('') :
    `<div style="color:var(--t3);text-align:center;padding:48px 20px;background:var(--white);border-radius:16px;border:2px dashed var(--border);grid-column:1/-1">
      <div style="font-size:36px;margin-bottom:12px">Tracker</div>
      <div style="font-weight:600;margin-bottom:6px;color:var(--t1)">No trackers yet</div>
      <div style="font-size:13px">Add items like Milk, Newspaper to track daily and see monthly totals</div>
    </div>`;

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div class="summary-card" style="margin-bottom:20px">
        <div class="summary-top">
          <div>
            <div class="summary-label">DAILY TRACKERS</div>
            <div class="summary-amount">${_trackers.length}</div>
            <div class="summary-words">Track daily recurring items month by month</div>
          </div>
          <div class="count-box"><div class="num">${_trackers.filter((t) => t.is_active).length}</div><div class="lbl">active</div></div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700;color:var(--t1)">My Trackers</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadTrackersOverviewPdf(new Date().getFullYear(),new Date().getMonth()+1)">PDF Overview</button>
          <button class="btn btn-p btn-sm" onclick="showTrackerModal()">+ Add Tracker</button>
        </div>
      </div>
      <div class="cc-card-grid">${cards}</div>
    </div>`;
  repairMojibakeInNode(document.getElementById('main'));
}

async function loadTracker() {
  const data = await api('/api/trackers');
  _trackers = data?.trackers || [];
  if (_selectedTrackerId && _trackers.find((t) => String(t.id) === String(_selectedTrackerId))) {
    await renderTrackerDetail();
  } else {
    _selectedTrackerId = null;
    renderTrackerGrid();
  }
}

async function openTrackerDetail(id) {
  _selectedTrackerId = String(id);
  _trackerYear = new Date().getFullYear();
  _trackerMonth = new Date().getMonth() + 1;
  await api(`/api/trackers/${id}/autofill`, { method: 'POST', body: { year: _trackerYear, month: _trackerMonth } });
  await renderTrackerDetail();
}

async function renderTrackerDetail() {
  const tracker = _trackers.find((t) => String(t.id) === String(_selectedTrackerId));
  if (!tracker) { renderTrackerGrid(); return; }

  const monthSeq = getTrackerMonthSequence(6);
  const [entriesRes, summaryRes, tileSummaries] = await Promise.all([
    api(`/api/trackers/${_selectedTrackerId}/entries?year=${_trackerYear}&month=${_trackerMonth}`),
    api(`/api/trackers/${_selectedTrackerId}/summary?year=${_trackerYear}&month=${_trackerMonth}`),
    Promise.all(monthSeq.map(({ year, month, key }) =>
      api(`/api/trackers/${_selectedTrackerId}/summary?year=${year}&month=${month}`).then((res) => ({
        key,
        year,
        month,
        summary: res?.summary || { total_amount: 0, days: 0, added_to_expense: 0 },
      }))
    )),
  ]);

  
  const entries = entriesRes?.entries || [];
  const summary = summaryRes?.summary || {};
  const entryMap = {};
  entries.forEach((e) => {
    const key = String(e.entry_date || '').slice(0, 10);
    if (key) entryMap[key] = e;
  });

  const today = new Date().toISOString().split('T')[0];
  const daysInMonth = new Date(_trackerYear, _trackerMonth, 0).getDate();
  const currentMonthKey = trackerMonthKey(_trackerYear, _trackerMonth);
  const isCurrentMonth = currentMonthKey === today.slice(0, 7);

  let rows = '';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentMonthKey}-${String(d).padStart(2, '0')}`;
    const e = entryMap[dateStr];
    const dayLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
    const isFuture = dateStr > today;
    const isToday = dateStr === today;
    const rowStyle = isToday ? 'background:var(--bg2)' : '';

    if (isFuture) {
      rows += `<tr style="color:var(--t3);${rowStyle}">
        <td><span style="font-weight:${isToday ? 600 : 400}">${d}</span> <span style="font-size:11px">${dayLabel}</span></td>
        <td style="text-align:right;color:var(--t3)">-</td><td style="text-align:right">-</td><td></td><td></td></tr>`;
    } else if (e) {
      const badge = e.is_auto
        ? `<span class="badge" style="background:var(--bg2);color:var(--t3);font-size:10px">Auto</span>`
        : `<span class="badge b-fair" style="font-size:10px">Edited</span>`;
      rows += `<tr id="trow-${dateStr}" style="${rowStyle}">
        <td><strong>${d}</strong> <span style="font-size:11px;color:var(--t3)">${dayLabel}</span>${isToday ? ' <span style="font-size:10px;color:var(--em)">Today</span>' : ''}</td>
        <td style="text-align:right" id="tqty-${dateStr}">${e.quantity} <span style="color:var(--t3);font-size:12px">${escHtml(tracker.unit)}</span></td>
        <td style="text-align:right;font-weight:600">${fmtCur(e.amount)}</td>
        <td>${badge}</td>
        <td><button class="btn-d" style="color:var(--em)" onclick="editDayEntry(${tracker.id},'${dateStr}',${e.quantity})">Edit</button></td>
      </tr>`;
    } else {
      rows += `<tr id="trow-${dateStr}" style="color:var(--t3);${rowStyle}">
        <td><strong>${d}</strong> <span style="font-size:11px">${dayLabel}</span></td>
        <td style="text-align:right">-</td><td style="text-align:right">-</td>
        <td><span class="badge" style="background:var(--bg2);color:var(--t3);font-size:10px">Missing</span></td>
        <td><button class="btn-d" onclick="editDayEntry(${tracker.id},'${dateStr}',${tracker.default_qty})">Add</button></td>
      </tr>`;
    }
  }

  const totalQty = summary.total_qty ? parseFloat(summary.total_qty).toFixed(2) : '0';
  const totalAmt = summary.total_amount || 0;
  const addedToExpense = summary.added_to_expense;
  const monthTiles = tileSummaries
    .filter(({ key, summary: tile }) => key === currentMonthKey || (tile.total_amount || 0) > 0 || (tile.days || 0) > 0)
    .map(({ key, year, month, summary: tile }) => {
    const active = key === currentMonthKey;
    const complete = key < today.slice(0, 7);
    const canAdd = complete && tile.total_amount > 0 && !tile.added_to_expense;
    return `<button class="chip ${active ? 'active' : ''}" style="display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:120px;padding:10px 12px" onclick="_trackerYear=${year};_trackerMonth=${month};renderTrackerDetail()">
      <span style="font-weight:700">${_MONTHS_LONG[month - 1]} ${year}</span>
      <span style="font-size:11px;opacity:.8">${fmtCur(tile.total_amount || 0)} · ${tile.days || 0} days</span>
      <span style="font-size:10px;opacity:.8">${tile.added_to_expense ? 'Added to expenses' : canAdd ? 'Ready to add' : complete ? 'No amount' : 'Current month'}</span>
    </button>`;
  }).join('');

  const trackerBank = tracker.expense_bank_account_id ? _bankAccounts.find((a) => a.id == tracker.expense_bank_account_id) : null;
  const autoNote = tracker.auto_add_to_expense
    ? `Auto-add enabled${trackerBank ? ` · deduct from ${trackerBank.bank_name}` : ''}`
    : 'Auto-add disabled';

  document.getElementById('main').innerHTML = `
    <div class="tab-content">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-g btn-sm" onclick="_selectedTrackerId=null;renderTrackerGrid()"><- Back</button>
        <div>
          <span style="font-size:18px;font-weight:700">${escHtml(tracker.name)}</span>
          <span style="color:var(--t2);font-size:13px;margin-left:10px">${fmtCur(tracker.price_per_unit)}/${escHtml(tracker.unit)} · Default: ${tracker.default_qty} ${escHtml(tracker.unit)}/day</span>
          <div style="font-size:11px;color:var(--t3);margin-top:2px">${autoNote}</div>
        </div>
        <button class="btn btn-g btn-sm" style="margin-left:auto" onclick="showTrackerModal(${tracker.id})">Edit</button>
      </div>

      
      <div class="filter-row" style="gap:8px;overflow:auto;margin-bottom:12px">${monthTiles}</div>

      <div class="summary-card" style="margin-bottom:16px">
        <div class="summary-top">
          <div>
            <div class="summary-label">${_MONTHS_LONG[_trackerMonth - 1].toUpperCase()} ${_trackerYear}</div>
            <div class="summary-amount">${fmtCur(totalAmt)}</div>
            <div class="summary-words">${totalQty} ${escHtml(tracker.unit)} · ${summary.days || 0} days · ${summary.auto_days || 0} auto, ${summary.edited_days || 0} edited</div>
          </div>
          <div class="count-box" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">
            ${addedToExpense
              ? `<div style="font-size:11px;color:rgba(255,255,255,0.8);font-weight:600;text-align:center">Added to<br>Expenses</div>`
              : `<button class="btn btn-p btn-sm" onclick="addTrackerExpense(${tracker.id},${_trackerYear},${_trackerMonth})" ${totalAmt && currentMonthKey < today.slice(0, 7) ? '' : 'disabled'}>+ To Expenses</button>`}
          </div>
        </div>
      </div>

      <div class="filter-row" style="justify-content:space-between;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-g btn-sm" onclick="trackerPrevMonth()"><-</button>
          <span style="font-weight:600;min-width:130px;text-align:center">${_MONTHS_LONG[_trackerMonth - 1]} ${_trackerYear}</span>
          <button class="btn btn-g btn-sm" onclick="trackerNextMonth()" ${isCurrentMonth ? 'disabled' : ''}>-></button>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-s btn-sm" onclick="downloadTrackerMonthPdf(${tracker.id},'${escHtml(tracker.name)}',${_trackerYear},${_trackerMonth})">PDF</button>
          ${isCurrentMonth ? `<button class="btn btn-s btn-sm" onclick="autoFillTracker(${tracker.id})">Auto-fill Missing</button>` : ''}
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Date</th>
            <th style="text-align:right">Quantity</th>
            <th style="text-align:right">Amount</th>
            <th>Status</th>
            <th style="width:80px">Action</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  repairMojibakeInNode(document.getElementById('main'));
}
