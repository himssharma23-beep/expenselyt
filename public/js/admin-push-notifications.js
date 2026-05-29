(function () {
  if (!window) return;

  const state = window.__adminPushState = window.__adminPushState || {
    dashboard: null,
    tab: 'campaigns',
    campaigns: [],
    campaignPagination: { page: 1, page_size: 12, total: 0, total_pages: 1 },
    campaignFilters: { search: '', status: 'all' },
    templates: [],
    logs: [],
    logsPagination: { page: 1, page_size: 20, total: 0, total_pages: 1 },
    logFilters: { search: '', status: 'all', from_date: '', to_date: '' },
    devices: [],
    devicesPagination: { page: 1, page_size: 20, total: 0, total_pages: 1 },
    deviceSearch: '',
    users: [],
    userPagination: { page: 1, page_size: 10, total: 0, total_pages: 1 },
    userSearch: '',
    selectedUsers: new Set(),
    plans: [],
  };

  function esc(value) {
    return typeof escHtml === 'function' ? escHtml(value == null ? '' : String(value)) : String(value || '');
  }

  function fmtAdminDate(value) {
    return value ? (typeof fmtDate === 'function' ? fmtDate(value) : String(value)) : '-';
  }

  function chip(status) {
    const normalized = String(status || 'draft').toLowerCase();
    const map = {
      draft: ['#eef2ff', '#4f46e5', 'Draft'],
      queued: ['#ecfeff', '#0f766e', 'Queued'],
      scheduled: ['#fef3c7', '#b45309', 'Scheduled'],
      processing: ['#dbeafe', '#1d4ed8', 'Processing'],
      completed: ['#dcfce7', '#15803d', 'Completed'],
      sent: ['#dcfce7', '#15803d', 'Sent'],
      failed: ['#fee2e2', '#b91c1c', 'Failed'],
      cancelled: ['#f3f4f6', '#6b7280', 'Cancelled'],
      pending: ['#fff7ed', '#c2410c', 'Pending'],
    };
    const current = map[normalized] || map.draft;
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:${current[0]};color:${current[1]};font-size:12px;font-weight:700">${esc(current[2])}</span>`;
  }

  async function fetchJson(url) {
    const result = await api(url);
    if (result?.error) throw new Error(result.error);
    return result;
  }

  async function fetchWithBody(url, method, body) {
    const result = await api(url, { method, body });
    if (result?.error) throw new Error(result.error);
    return result;
  }

  function campaignStatusOptions() {
    return ['all', 'draft', 'queued', 'scheduled', 'processing', 'completed', 'failed', 'cancelled'];
  }

  function templateTypeOptions() {
    return ['general', 'billing', 'reminder', 'announcement', 'promotion', 'system'];
  }

  function renderDashboardCards(summary = {}) {
    const cards = [
      ['Total notifications', summary.total_notifications || 0, 'All campaigns'],
      ['Sent today', summary.sent_today || 0, 'Delivered today'],
      ['Failed today', summary.failed_today || 0, 'Need attention'],
      ['Delivery success %', `${summary.delivery_success_percent || 0}%`, 'Across all logs'],
      ['Active scheduled jobs', summary.active_scheduled_jobs || 0, 'Future or recurring'],
      ['Pending deliveries', summary.pending_deliveries || 0, 'Queued or retrying'],
    ];
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px">
        ${cards.map(([label, value, note]) => `
          <div class="card" style="padding:16px">
            <div style="font-size:12px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em">${esc(label)}</div>
            <div style="font-size:28px;font-weight:800;margin-top:6px">${esc(value)}</div>
            <div style="font-size:12px;color:var(--t3);margin-top:4px">${esc(note)}</div>
          </div>`).join('')}
      </div>`;
  }

  function renderTabs() {
    const tabs = [
      ['campaigns', 'Campaigns'],
      ['templates', 'Templates'],
      ['logs', 'Delivery Logs'],
      ['devices', 'Device Tokens'],
    ];
    return `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px">
        ${tabs.map(([key, label]) => `<button class="btn ${state.tab === key ? 'btn-p' : 'btn-s'}" onclick="window.__adminPushState.tab='${key}';loadAdminNotifications()">${esc(label)}</button>`).join('')}
      </div>`;
  }

  function renderCampaignsTab() {
    const rows = (state.campaigns || []).map((item) => `
      <tr>
        <td style="padding:12px 10px">
          <div style="font-weight:700">${esc(item.title)}</div>
          <div style="font-size:12px;color:var(--t3);margin-top:4px">${esc(item.body || '').slice(0, 110)}</div>
        </td>
        <td style="padding:12px 10px">${chip(item.status)}</td>
        <td style="padding:12px 10px">${esc(item.target_mode || 'all')}</td>
        <td style="padding:12px 10px">${esc(item.send_mode || 'immediate')}</td>
        <td style="padding:12px 10px">${fmtAdminDate(item.scheduled_for || item.created_at)}</td>
        <td style="padding:12px 10px">${Number(item.sent_count || 0)} / ${Number(item.total_recipients || 0)}</td>
        <td style="padding:12px 10px">
          <div class="fa" style="justify-content:flex-end">
            <button class="btn btn-s btn-sm" onclick="adminPushOpenCampaignModal(${item.id})">View</button>
            <button class="btn btn-s btn-sm" onclick="adminPushOpenCampaignModal(${item.id}, true)">Edit</button>
            <button class="btn btn-s btn-sm" onclick="adminPushDuplicateCampaign(${item.id})">Clone</button>
            ${(String(item.status || '').toLowerCase() === 'scheduled' || String(item.status || '').toLowerCase() === 'processing') ? `<button class="btn btn-g btn-sm" onclick="adminPushCancelCampaign(${item.id})">Cancel</button>` : ''}
            <button class="btn btn-g btn-sm" onclick="adminPushDeleteCampaign(${item.id})">Delete</button>
          </div>
        </td>
      </tr>`).join('');
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
          <div>
            <div style="font-size:18px;font-weight:800">Push Notification Campaigns</div>
            <div style="font-size:12px;color:var(--t3)">Create, schedule, clone, preview, and monitor admin push notifications.</div>
          </div>
          <div class="fa">
            <button class="btn btn-s" onclick="adminPushRunQueueNow()">Process Queue</button>
            <button class="btn btn-p" onclick="adminPushOpenCampaignModal()">Create Notification</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <input class="fi" style="max-width:260px" placeholder="Search title or message" value="${esc(state.campaignFilters.search || '')}" oninput="window.__adminPushState.campaignFilters.search=this.value">
          <select class="fi" style="max-width:180px" onchange="window.__adminPushState.campaignFilters.status=this.value">
            ${campaignStatusOptions().map((status) => `<option value="${status}" ${String(state.campaignFilters.status || 'all') === status ? 'selected' : ''}>${esc(status === 'all' ? 'All statuses' : status)}</option>`).join('')}
          </select>
          <button class="btn btn-p btn-sm" onclick="window.__adminPushState.campaignPagination.page=1;loadAdminNotifications()">Apply</button>
        </div>
        <div style="overflow:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:var(--bg2);text-align:left">
                <th style="padding:10px">Notification</th>
                <th style="padding:10px">Status</th>
                <th style="padding:10px">Target</th>
                <th style="padding:10px">Send</th>
                <th style="padding:10px">Schedule</th>
                <th style="padding:10px">Sent</th>
                <th style="padding:10px;text-align:right">Actions</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--t3)">No notifications found.</td></tr>'}</tbody>
          </table>
        </div>
        <div class="fa" style="justify-content:space-between;margin-top:14px">
          <div style="font-size:12px;color:var(--t3)">Showing page ${state.campaignPagination.page} of ${state.campaignPagination.total_pages || 1}</div>
          <div class="fa">
            <button class="btn btn-s btn-sm" ${state.campaignPagination.page <= 1 ? 'disabled' : ''} onclick="window.__adminPushState.campaignPagination.page=Math.max(1,window.__adminPushState.campaignPagination.page-1);loadAdminNotifications()">Prev</button>
            <button class="btn btn-s btn-sm" ${state.campaignPagination.page >= (state.campaignPagination.total_pages || 1) ? 'disabled' : ''} onclick="window.__adminPushState.campaignPagination.page+=1;loadAdminNotifications()">Next</button>
          </div>
        </div>
      </div>`;
  }

  function renderTemplatesTab() {
    const cardsHtml = (state.templates || []).map((item) => `
      <div class="card" style="padding:16px">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div>
            <div style="font-size:16px;font-weight:800">${esc(item.name)}</div>
            <div style="font-size:12px;color:var(--t3);margin-top:4px">${esc(item.description || 'No description')}</div>
          </div>
          ${chip(item.is_active ? 'completed' : 'cancelled')}
        </div>
        <div style="margin-top:12px;font-size:13px;color:var(--t2)"><strong>${esc(item.title)}</strong></div>
        <div style="margin-top:6px;font-size:13px;color:var(--t3)">${esc(item.body)}</div>
        <div class="fa" style="margin-top:14px">
          <button class="btn btn-s btn-sm" onclick="adminPushOpenTemplateModal(${item.id})">Edit</button>
          <button class="btn btn-s btn-sm" onclick="adminPushUseTemplate(${item.id})">Use</button>
          <button class="btn btn-g btn-sm" onclick="adminPushDeleteTemplate(${item.id})">Delete</button>
        </div>
      </div>`).join('');
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
          <div>
            <div style="font-size:18px;font-weight:800">Notification Templates</div>
            <div style="font-size:12px;color:var(--t3)">Save reusable notification content and launch campaigns faster.</div>
          </div>
          <button class="btn btn-p" onclick="adminPushOpenTemplateModal()">New Template</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">${cardsHtml || '<div style="color:var(--t3)">No templates created yet.</div>'}</div>
      </div>`;
  }

  function renderLogsTab() {
    const rows = (state.logs || []).map((row) => `
      <tr>
        <td style="padding:12px 10px">${esc(row.notification_title)}</td>
        <td style="padding:12px 10px">${esc(row.display_name || row.email || '-')}</td>
        <td style="padding:12px 10px">${esc(row.provider)}</td>
        <td style="padding:12px 10px">${chip(row.status)}</td>
        <td style="padding:12px 10px">${Number(row.attempt_no || 1)}</td>
        <td style="padding:12px 10px">${fmtAdminDate(row.delivered_at || row.created_at)}</td>
        <td style="padding:12px 10px;color:var(--red)">${esc(row.error_message || '')}</td>
      </tr>`).join('');
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
          <div>
            <div style="font-size:18px;font-weight:800">Delivery Logs</div>
            <div style="font-size:12px;color:var(--t3)">Provider-level delivery attempts, retries, errors, and timestamps.</div>
          </div>
          <a class="btn btn-s" href="/api/v1/admin/push-notifications/logs/export.csv?search=${encodeURIComponent(state.logFilters.search || '')}&status=${encodeURIComponent(state.logFilters.status || 'all')}&from_date=${encodeURIComponent(state.logFilters.from_date || '')}&to_date=${encodeURIComponent(state.logFilters.to_date || '')}">Export CSV</a>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <input class="fi" style="max-width:220px" placeholder="Search logs" value="${esc(state.logFilters.search || '')}" oninput="window.__adminPushState.logFilters.search=this.value">
          <select class="fi" style="max-width:160px" onchange="window.__adminPushState.logFilters.status=this.value">
            ${['all', 'sent', 'failed'].map((status) => `<option value="${status}" ${String(state.logFilters.status || 'all') === status ? 'selected' : ''}>${esc(status === 'all' ? 'All statuses' : status)}</option>`).join('')}
          </select>
          <input class="fi" type="date" value="${esc(state.logFilters.from_date || '')}" onchange="window.__adminPushState.logFilters.from_date=this.value">
          <input class="fi" type="date" value="${esc(state.logFilters.to_date || '')}" onchange="window.__adminPushState.logFilters.to_date=this.value">
          <button class="btn btn-p btn-sm" onclick="window.__adminPushState.logsPagination.page=1;loadAdminNotifications()">Apply</button>
        </div>
        <div style="overflow:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:var(--bg2);text-align:left"><th style="padding:10px">Notification</th><th style="padding:10px">User</th><th style="padding:10px">Provider</th><th style="padding:10px">Status</th><th style="padding:10px">Attempt</th><th style="padding:10px">Time</th><th style="padding:10px">Error</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--t3)">No delivery logs found.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderDevicesTab() {
    const rows = (state.devices || []).map((row) => `
      <tr>
        <td style="padding:12px 10px">${esc(row.display_name)}</td>
        <td style="padding:12px 10px">${esc(row.email)}</td>
        <td style="padding:12px 10px">${esc(row.platform || '-')}</td>
        <td style="padding:12px 10px">${esc(row.device_name || '-')}</td>
        <td style="padding:12px 10px">${esc(row.app_version || '-')}</td>
        <td style="padding:12px 10px">${esc(row.token_preview || '')}</td>
        <td style="padding:12px 10px">${fmtAdminDate(row.last_seen_at)}</td>
      </tr>`).join('');
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
          <div>
            <div style="font-size:18px;font-weight:800">Registered Device Tokens</div>
            <div style="font-size:12px;color:var(--t3)">Inspect device registrations before sending bulk pushes.</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <input class="fi" style="max-width:280px" placeholder="Search user, platform, device" value="${esc(state.deviceSearch || '')}" oninput="window.__adminPushState.deviceSearch=this.value">
          <button class="btn btn-p btn-sm" onclick="window.__adminPushState.devicesPagination.page=1;loadAdminNotifications()">Apply</button>
        </div>
        <div style="overflow:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:var(--bg2);text-align:left"><th style="padding:10px">User</th><th style="padding:10px">Email</th><th style="padding:10px">Platform</th><th style="padding:10px">Device</th><th style="padding:10px">App</th><th style="padding:10px">Token</th><th style="padding:10px">Last Seen</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--t3)">No device tokens found.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderAdminNotifications() {
    const root = document.getElementById('adminContent');
    if (!root) return;
    let body = '';
    if (state.tab === 'campaigns') body = renderCampaignsTab();
    else if (state.tab === 'templates') body = renderTemplatesTab();
    else if (state.tab === 'logs') body = renderLogsTab();
    else body = renderDevicesTab();
    root.innerHTML = `${renderDashboardCards(state.dashboard || {})}${renderTabs()}${body}`;
  }

  async function loadAdminNotifications() {
    const tab = state.tab || 'campaigns';
    const [dashboardData, plansData, tabData] = await Promise.all([
      fetchJson('/api/v1/admin/push-notifications/dashboard'),
      fetchJson('/api/admin/plans'),
      (async () => {
        if (tab === 'campaigns') {
          const f = state.campaignFilters;
          return fetchJson(`/api/v1/admin/push-notifications/campaigns?page=${state.campaignPagination.page}&page_size=${state.campaignPagination.page_size}&status=${encodeURIComponent(f.status || 'all')}&search=${encodeURIComponent(f.search || '')}`);
        }
        if (tab === 'logs') {
          const f = state.logFilters;
          const query = new URLSearchParams({
            page: String(state.logsPagination.page || 1),
            page_size: String(state.logsPagination.page_size || 20),
            status: f.status || 'all',
            search: f.search || '',
          });
          if (f.from_date) query.set('from_date', f.from_date);
          if (f.to_date) query.set('to_date', f.to_date);
          return fetchJson(`/api/v1/admin/push-notifications/logs?${query.toString()}`);
        }
        if (tab === 'devices') {
          return fetchJson(`/api/v1/admin/push-notifications/devices?page=${state.devicesPagination.page}&page_size=${state.devicesPagination.page_size}&search=${encodeURIComponent(state.deviceSearch || '')}`);
        }
        return fetchJson('/api/v1/admin/push-notifications/templates');
      })(),
    ]);

    state.dashboard = dashboardData?.summary || null;
    state.plans = plansData?.plans || [];
    if (tab === 'campaigns') {
      state.campaigns = tabData?.campaigns || [];
      state.campaignPagination = tabData?.pagination || state.campaignPagination;
    } else if (tab === 'logs') {
      state.logs = tabData?.logs || [];
      state.logsPagination = tabData?.pagination || state.logsPagination;
    } else if (tab === 'devices') {
      state.devices = tabData?.devices || [];
      state.devicesPagination = tabData?.pagination || state.devicesPagination;
    } else {
      state.templates = tabData?.templates || [];
    }
    renderAdminNotifications();
  }

  async function loadTargetUsers(page) {
    const query = new URLSearchParams({
      page: String(page || 1),
      page_size: String(state.userPagination.page_size || 10),
      search: state.userSearch || '',
      active_only: 'true',
    });
    const result = await fetchJson(`/api/v1/admin/push-notifications/users?${query.toString()}`);
    state.users = result?.users || [];
    state.userPagination = result?.pagination || state.userPagination;
  }

  function renderUserPicker() {
    const list = document.getElementById('adminPushUserPicker');
    if (!list) return;
    list.innerHTML = (state.users || []).map((user) => `
      <label class="admin-push-user-row ${state.selectedUsers.has(user.id) ? 'selected' : ''}">
        <input type="checkbox" ${state.selectedUsers.has(user.id) ? 'checked' : ''} onchange="adminPushToggleUser(${user.id})">
        <div class="admin-push-user-copy">
          <div class="admin-push-user-name">${esc(user.display_name || user.email || `User ${user.id}`)}</div>
          <div class="admin-push-user-email">${esc(user.email || '')}</div>
          <div class="admin-push-user-meta">${esc(user.role || 'user')} • ${Number(user.push_device_count || 0)} devices</div>
        </div>
      </label>`).join('') || '<div style="color:var(--t3);padding:12px">No users found.</div>';
    const meta = document.getElementById('adminPushUserPickerMeta');
    if (meta) meta.textContent = `Page ${state.userPagination.page} of ${state.userPagination.total_pages || 1} • ${state.selectedUsers.size} selected`;
  }

  function collectCampaignForm(editingId) {
    return {
      id: editingId || null,
      title: document.getElementById('adminPushTitle')?.value?.trim() || '',
      body: document.getElementById('adminPushBody')?.value?.trim() || '',
      image_url: document.getElementById('adminPushImageUrl')?.value?.trim() || '',
      redirect_url: document.getElementById('adminPushRedirectUrl')?.value?.trim() || '',
      notification_type: document.getElementById('adminPushType')?.value || 'general',
      priority: document.getElementById('adminPushPriority')?.value || 'normal',
      status: document.getElementById('adminPushStatus')?.value || 'draft',
      is_active: document.getElementById('adminPushIsActive')?.checked !== false,
      target_config: {
        target_mode: document.getElementById('adminPushTargetMode')?.value || 'all',
        user_ids: [...state.selectedUsers],
        roles: [...document.querySelectorAll('.admin-push-role-cb:checked')].map((node) => node.value).filter(Boolean),
        plan_ids: [...document.querySelectorAll('.admin-push-plan-cb:checked')].map((node) => Number(node.value)).filter((value) => value > 0),
        topics: (document.getElementById('adminPushTopics')?.value || '').split(',').map((item) => item.trim()).filter(Boolean),
        channels: (document.getElementById('adminPushChannels')?.value || '').split(',').map((item) => item.trim()).filter(Boolean),
        active_only: document.getElementById('adminPushActiveOnly')?.checked === true,
        has_push_device: document.getElementById('adminPushHasDevice')?.checked === true,
      },
      schedule: {
        send_mode: document.getElementById('adminPushSendMode')?.value || 'immediate',
        recurrence_type: document.getElementById('adminPushRecurrenceType')?.value || 'none',
        recurrence_interval: Number(document.getElementById('adminPushRecurrenceInterval')?.value || 1),
        schedule_date: document.getElementById('adminPushScheduleDate')?.value || '',
        schedule_time: document.getElementById('adminPushScheduleTime')?.value || '',
        timezone: document.getElementById('adminPushTimezone')?.value || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Calcutta',
        start_date: document.getElementById('adminPushStartDate')?.value || '',
        end_date: document.getElementById('adminPushEndDate')?.value || '',
        expiry_at: (() => {
          const date = document.getElementById('adminPushExpiryDate')?.value || '';
          const time = document.getElementById('adminPushExpiryTime')?.value || '';
          return date ? `${date}T${time || '23:59'}:00` : '';
        })(),
      },
    };
  }

  function campaignPreview(campaign) {
    return `
      <div class="admin-push-preview-card">
        <div class="admin-push-preview-type">${esc(campaign?.notification_type || 'general')}</div>
        <div class="admin-push-preview-title">${esc(campaign?.title || 'Notification title')}</div>
        <div class="admin-push-preview-body">${esc(campaign?.body || 'Notification body preview')}</div>
        ${(campaign?.redirect_url || campaign?.image_url) ? `<div class="admin-push-preview-link">${esc(campaign?.redirect_url || campaign?.image_url || '')}</div>` : ''}
      </div>`;
  }

  async function adminPushOpenCampaignModal(id, editMode) {
    try {
      const campaign = id ? await fetchJson(`/api/v1/admin/push-notifications/campaigns/${id}`).then((r) => r?.campaign || null) : null;
      state.selectedUsers = new Set(((campaign?.target_config?.user_ids) || []).map((value) => Number(value)).filter((value) => value > 0));
      await loadTargetUsers(1);
      const targetConfig = campaign?.target_config || {};
      const schedule = campaign || {};
      window.__modalClassName = 'modal-wide admin-push-modal-shell';
      openModal(id ? (editMode ? 'Edit Notification' : 'Notification Details') : 'Create Notification', `
        <div class="admin-push-builder">
          <div class="admin-push-builder-main">
            <section class="card admin-push-section-card">
              <div class="admin-push-section-head">
                <div>
                  <div class="admin-push-section-title">Content</div>
                  <div class="admin-push-section-sub">Define the message copy, links, and delivery settings.</div>
                </div>
              </div>
              <div class="admin-push-grid admin-push-grid-2">
                <label class="fl">Title<input class="fi" id="adminPushTitle" maxlength="80" value="${esc(campaign?.title || '')}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">Type<select class="fi" id="adminPushType" ${!editMode && id ? 'disabled' : ''}>${templateTypeOptions().map((item) => `<option value="${item}" ${String(campaign?.notification_type || 'general') === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label>
              </div>
              <label class="fl admin-push-stack-gap">Message<textarea class="fi" id="adminPushBody" rows="6" maxlength="250" ${!editMode && id ? 'disabled' : ''}>${esc(campaign?.body || '')}</textarea></label>
              <div class="admin-push-grid admin-push-grid-2 admin-push-stack-gap">
                <label class="fl">Image URL<input class="fi" id="adminPushImageUrl" value="${esc(campaign?.image_url || '')}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">Redirect URL<input class="fi" id="adminPushRedirectUrl" value="${esc(campaign?.redirect_url || '')}" ${!editMode && id ? 'disabled' : ''}></label>
              </div>
              <div class="admin-push-grid admin-push-grid-4 admin-push-stack-gap">
                <label class="fl">Priority<select class="fi" id="adminPushPriority" ${!editMode && id ? 'disabled' : ''}>${['low', 'normal', 'high', 'critical'].map((item) => `<option value="${item}" ${String(campaign?.priority || 'normal') === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label>
                <label class="fl">Status<select class="fi" id="adminPushStatus" ${!editMode && id ? 'disabled' : ''}>${['draft', 'queued', 'scheduled'].map((item) => `<option value="${item}" ${String(campaign?.status || 'draft') === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label>
                <label class="fl">Send Mode<select class="fi" id="adminPushSendMode" ${!editMode && id ? 'disabled' : ''}>${['immediate', 'scheduled', 'recurring'].map((item) => `<option value="${item}" ${String(campaign?.send_mode || 'immediate') === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label>
                <label class="fl admin-push-toggle-field"><span>Active</span><input id="adminPushIsActive" type="checkbox" ${campaign?.is_active !== false ? 'checked' : ''} ${!editMode && id ? 'disabled' : ''}></label>
              </div>
            </section>

            <section class="card admin-push-section-card">
              <div class="admin-push-section-head">
                <div>
                  <div class="admin-push-section-title">Scheduling</div>
                  <div class="admin-push-section-sub">Send immediately, schedule a future run, or set recurrence.</div>
                </div>
              </div>
              <div class="admin-push-grid admin-push-grid-3">
                <label class="fl">Schedule Date<input class="fi" id="adminPushScheduleDate" type="date" value="${esc(schedule?.schedule_date || '')}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">Schedule Time<input class="fi" id="adminPushScheduleTime" type="time" value="${esc(schedule?.schedule_time || '')}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">Time Zone<input class="fi" id="adminPushTimezone" value="${esc(schedule?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Calcutta')}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">Recurring<select class="fi" id="adminPushRecurrenceType" ${!editMode && id ? 'disabled' : ''}>${['none', 'daily', 'weekly', 'monthly'].map((item) => `<option value="${item}" ${String(schedule?.recurrence_type || 'none') === item ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></label>
                <label class="fl">Repeat every<input class="fi" id="adminPushRecurrenceInterval" type="number" min="1" value="${Number(schedule?.recurrence_interval || 1)}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">Start Date<input class="fi" id="adminPushStartDate" type="date" value="${esc(schedule?.start_date || '')}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">End Date<input class="fi" id="adminPushEndDate" type="date" value="${esc(schedule?.end_date || '')}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">Expiry Date<input class="fi" id="adminPushExpiryDate" type="date" value="${esc(String(schedule?.expiry_at || '').slice(0, 10) || '')}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">Expiry Time<input class="fi" id="adminPushExpiryTime" type="time" value="${esc(String(schedule?.expiry_at || '').slice(11, 16) || '')}" ${!editMode && id ? 'disabled' : ''}></label>
              </div>
            </section>

            <section class="card admin-push-section-card">
              <div class="admin-push-section-head">
                <div>
                  <div class="admin-push-section-title">Targeting</div>
                  <div class="admin-push-section-sub">Choose recipients by users, roles, topics, channels, or filters.</div>
                </div>
              </div>
              <div class="admin-push-grid admin-push-grid-2">
                <label class="fl">Mode<select class="fi" id="adminPushTargetMode" ${!editMode && id ? 'disabled' : ''}>${[['all', 'All users'], ['selected_users', 'Selected users'], ['roles', 'User roles'], ['topic', 'Topics / channels'], ['active_only', 'Active users only'], ['custom_filters', 'Custom filters']].map(([key, label]) => `<option value="${key}" ${String(targetConfig?.target_mode || 'all') === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
                <label class="fl">Topics<input class="fi" id="adminPushTopics" placeholder="billing, offers" value="${esc((targetConfig?.topics || []).join(', '))}" ${!editMode && id ? 'disabled' : ''}></label>
                <label class="fl">Channels<input class="fi" id="adminPushChannels" placeholder="android, ios" value="${esc((targetConfig?.channels || []).join(', '))}" ${!editMode && id ? 'disabled' : ''}></label>
                <div class="admin-push-target-switches">
                  <label class="fl admin-push-toggle-field"><span>Active only</span><input id="adminPushActiveOnly" type="checkbox" ${targetConfig?.active_only ? 'checked' : ''} ${!editMode && id ? 'disabled' : ''}></label>
                  <label class="fl admin-push-toggle-field"><span>Push device only</span><input id="adminPushHasDevice" type="checkbox" ${targetConfig?.has_push_device ? 'checked' : ''} ${!editMode && id ? 'disabled' : ''}></label>
                </div>
              </div>
              <div class="admin-push-grid admin-push-grid-2 admin-push-stack-gap">
                <div class="admin-push-selection-box">
                  <div class="admin-push-mini-title">Roles</div>
                  <div class="admin-push-selection-list">${['admin', 'user'].map((role) => `<label class="admin-push-checkbox-chip"><input class="admin-push-role-cb" type="checkbox" value="${role}" ${(targetConfig?.roles || []).includes(role) ? 'checked' : ''} ${!editMode && id ? 'disabled' : ''}><span>${esc(role)}</span></label>`).join('')}</div>
                </div>
                <div class="admin-push-selection-box">
                  <div class="admin-push-mini-title">Plans</div>
                  <div class="admin-push-selection-list">${(state.plans || []).map((plan) => `<label class="admin-push-checkbox-chip"><input class="admin-push-plan-cb" type="checkbox" value="${plan.id}" ${((targetConfig?.plan_ids) || []).includes(Number(plan.id)) ? 'checked' : ''} ${!editMode && id ? 'disabled' : ''}><span>${esc(plan.name)}</span></label>`).join('') || '<span style="color:var(--t3)">No plans</span>'}</div>
                </div>
              </div>
              <div class="admin-push-selection-box admin-push-stack-gap">
                <div class="admin-push-user-picker-head">
                  <div>
                    <div class="admin-push-mini-title">Selected users</div>
                    <div id="adminPushUserPickerMeta" class="admin-push-meta"></div>
                  </div>
                  ${!editMode && id ? '' : `<div class="fa admin-push-user-toolbar"><input class="fi" id="adminPushUserSearch" placeholder="Search users" value="${esc(state.userSearch || '')}" oninput="window.__adminPushState.userSearch=this.value"><button class="btn btn-s btn-sm" onclick="adminPushRefreshUserPicker(1)">Search</button><button class="btn btn-s btn-sm" onclick="adminPushSelectVisibleUsers()">Select visible</button></div>`}
                </div>
                <div id="adminPushUserPicker" class="admin-push-user-picker"></div>
                <div class="fa" style="justify-content:flex-end;margin-top:10px">
                  <button class="btn btn-s btn-sm" onclick="adminPushRefreshUserPicker(Math.max(1, (window.__adminPushState.userPagination.page || 1)-1))" ${state.userPagination.page <= 1 ? 'disabled' : ''}>Prev</button>
                  <button class="btn btn-s btn-sm" onclick="adminPushRefreshUserPicker((window.__adminPushState.userPagination.page || 1)+1)" ${state.userPagination.page >= (state.userPagination.total_pages || 1) ? 'disabled' : ''}>Next</button>
                </div>
              </div>
            </section>
          </div>

          <aside class="admin-push-builder-side">
            <div class="card admin-push-side-card">
              <div class="admin-push-section-title">Preview</div>
              ${campaignPreview(campaign)}
              ${id && !editMode ? `<div class="admin-push-meta" style="margin-top:12px">Created ${fmtAdminDate(campaign?.created_at)} by ${esc(campaign?.created_by_name || '-')}</div>` : ''}
            </div>
            <div class="card admin-push-side-card">
              <div class="admin-push-section-title">Quick actions</div>
              <div class="admin-push-quick-actions">
                ${(!editMode && id) ? '' : `<button class="btn btn-s" onclick="adminPushSendTest(${id || 'null'})">Send test to me</button>`}
                ${id ? `<button class="btn btn-s" onclick="adminPushDuplicateCampaign(${id})">Clone campaign</button>` : ''}
                ${id ? `<button class="btn btn-s" onclick="adminPushRunQueueNow()">Process queue now</button>` : ''}
              </div>
            </div>
          </aside>
        </div>
        <div class="fa admin-push-modal-actions">
          <button class="btn btn-g" onclick="closeModal()">Close</button>
          ${(!editMode && id) ? '' : `<button class="btn btn-p" onclick="adminPushSaveCampaign(${id || 'null'})">${id ? 'Save Changes' : 'Save Notification'}</button>`}
        </div>`);
      renderUserPicker();
    } catch (err) {
      toast(err?.message || 'Could not load notification', 'error');
    }
  }

  async function adminPushSaveCampaign(id) {
    try {
      const result = await fetchWithBody(id ? `/api/v1/admin/push-notifications/campaigns/${id}` : '/api/v1/admin/push-notifications/campaigns', id ? 'PUT' : 'POST', collectCampaignForm(id));
      closeModal();
      toast(id ? 'Notification updated' : 'Notification saved', 'success');
      if (result?.campaign?.status && String(result.campaign.status).toLowerCase() !== 'draft') {
        setTimeout(() => loadAdminNotifications().catch(() => {}), 300);
      }
      await loadAdminNotifications();
    } catch (err) {
      toast(err?.message || 'Could not save notification', 'error');
    }
  }

  async function adminPushDeleteCampaign(id) {
    if (!await confirmDialog('Delete this notification campaign?')) return;
    try {
      await fetchWithBody(`/api/v1/admin/push-notifications/campaigns/${id}`, 'DELETE');
      toast('Notification deleted', 'success');
      await loadAdminNotifications();
    } catch (err) {
      toast(err?.message || 'Could not delete notification', 'error');
    }
  }

  async function adminPushDuplicateCampaign(id) {
    try {
      await fetchWithBody(`/api/v1/admin/push-notifications/campaigns/${id}/duplicate`, 'POST', {});
      toast('Notification cloned', 'success');
      await loadAdminNotifications();
    } catch (err) {
      toast(err?.message || 'Could not clone notification', 'error');
    }
  }

  async function adminPushCancelCampaign(id) {
    if (!await confirmDialog('Cancel this scheduled notification?')) return;
    try {
      await fetchWithBody(`/api/v1/admin/push-notifications/campaigns/${id}/cancel`, 'POST', {});
      toast('Scheduled notification cancelled', 'success');
      await loadAdminNotifications();
    } catch (err) {
      toast(err?.message || 'Could not cancel notification', 'error');
    }
  }

  async function adminPushRunQueueNow() {
    try {
      const result = await fetchWithBody('/api/v1/admin/push-notifications/process-now', 'POST', {});
      toast(`Queue processed (${Number(result?.outcome?.processed || 0)} schedule${Number(result?.outcome?.processed || 0) === 1 ? '' : 's'})`, 'success');
      await loadAdminNotifications();
    } catch (err) {
      toast(err?.message || 'Could not process queue', 'error');
    }
  }

  async function adminPushSendTest(campaignId) {
    try {
      let payload;
      if (campaignId) {
        const campaign = await fetchJson(`/api/v1/admin/push-notifications/campaigns/${campaignId}`).then((r) => r?.campaign || null);
        payload = {
          user_id: typeof _currentUserId !== 'undefined' ? _currentUserId : null,
          title: campaign?.title || 'Test notification',
          body: campaign?.body || 'Test notification body',
          image_url: campaign?.image_url || '',
          redirect_url: campaign?.redirect_url || '',
          notification_type: campaign?.notification_type || 'general',
          priority: campaign?.priority || 'normal',
        };
      } else {
        payload = collectCampaignForm(null);
        payload.user_id = typeof _currentUserId !== 'undefined' ? _currentUserId : null;
      }
      const result = await fetchWithBody('/api/v1/admin/push-notifications/test', 'POST', payload);
      toast(`Test notification sent to ${Number(result?.result?.sent_count || 0)} device${Number(result?.result?.sent_count || 0) === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      toast(err?.message || 'Could not send test notification', 'error');
    }
  }

  async function adminPushOpenTemplateModal(id) {
    const template = id ? (state.templates || []).find((item) => Number(item.id) === Number(id)) : null;
    openModal(id ? 'Edit Template' : 'New Template', `
      <div style="display:grid;gap:12px">
        <label class="fl">Template Name<input class="fi" id="adminPushTemplateName" value="${esc(template?.name || '')}"></label>
        <label class="fl">Description<input class="fi" id="adminPushTemplateDescription" value="${esc(template?.description || '')}"></label>
        <label class="fl">Title<input class="fi" id="adminPushTemplateTitle" maxlength="80" value="${esc(template?.title || '')}"></label>
        <label class="fl">Message<textarea class="fi" id="adminPushTemplateBody" rows="5" maxlength="250">${esc(template?.body || '')}</textarea></label>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
          <label class="fl">Image URL<input class="fi" id="adminPushTemplateImage" value="${esc(template?.image_url || '')}"></label>
          <label class="fl">Redirect URL<input class="fi" id="adminPushTemplateRedirect" value="${esc(template?.redirect_url || '')}"></label>
        </div>
      </div>
      <div class="fa" style="margin-top:16px;justify-content:flex-end">
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        <button class="btn btn-p" onclick="adminPushSaveTemplate(${id || 'null'})">${id ? 'Save Template' : 'Create Template'}</button>
      </div>`);
  }

  async function adminPushSaveTemplate(id) {
    try {
      const payload = {
        name: document.getElementById('adminPushTemplateName')?.value?.trim() || '',
        description: document.getElementById('adminPushTemplateDescription')?.value?.trim() || '',
        title: document.getElementById('adminPushTemplateTitle')?.value?.trim() || '',
        body: document.getElementById('adminPushTemplateBody')?.value?.trim() || '',
        image_url: document.getElementById('adminPushTemplateImage')?.value?.trim() || '',
        redirect_url: document.getElementById('adminPushTemplateRedirect')?.value?.trim() || '',
      };
      await fetchWithBody(id ? `/api/v1/admin/push-notifications/templates/${id}` : '/api/v1/admin/push-notifications/templates', id ? 'PUT' : 'POST', payload);
      closeModal();
      toast(id ? 'Template updated' : 'Template created', 'success');
      state.tab = 'templates';
      await loadAdminNotifications();
    } catch (err) {
      toast(err?.message || 'Could not save template', 'error');
    }
  }

  async function adminPushDeleteTemplate(id) {
    if (!await confirmDialog('Delete this notification template?')) return;
    try {
      await fetchWithBody(`/api/v1/admin/push-notifications/templates/${id}`, 'DELETE');
      toast('Template deleted', 'success');
      await loadAdminNotifications();
    } catch (err) {
      toast(err?.message || 'Could not delete template', 'error');
    }
  }

  function adminPushUseTemplate(id) {
    const template = (state.templates || []).find((item) => Number(item.id) === Number(id));
    if (!template) return;
    adminPushOpenCampaignModal().then(() => {
      const title = document.getElementById('adminPushTitle');
      const body = document.getElementById('adminPushBody');
      const image = document.getElementById('adminPushImageUrl');
      const redirect = document.getElementById('adminPushRedirectUrl');
      const type = document.getElementById('adminPushType');
      const priority = document.getElementById('adminPushPriority');
      if (title) title.value = template.title || '';
      if (body) body.value = template.body || '';
      if (image) image.value = template.image_url || '';
      if (redirect) redirect.value = template.redirect_url || '';
      if (type) type.value = template.notification_type || 'general';
      if (priority) priority.value = template.priority || 'normal';
    });
  }

  async function adminPushRefreshUserPicker(page) {
    try {
      await loadTargetUsers(page);
      renderUserPicker();
    } catch (err) {
      toast(err?.message || 'Could not load users', 'error');
    }
  }

  function adminPushToggleUser(userId) {
    if (state.selectedUsers.has(userId)) state.selectedUsers.delete(userId);
    else state.selectedUsers.add(userId);
    renderUserPicker();
  }

  function adminPushSelectVisibleUsers() {
    (state.users || []).forEach((user) => state.selectedUsers.add(Number(user.id)));
    renderUserPicker();
  }

  window.loadAdminNotifications = loadAdminNotifications;
  window.renderAdminNotifications = renderAdminNotifications;
  window.adminPushOpenCampaignModal = adminPushOpenCampaignModal;
  window.adminPushSaveCampaign = adminPushSaveCampaign;
  window.adminPushDeleteCampaign = adminPushDeleteCampaign;
  window.adminPushDuplicateCampaign = adminPushDuplicateCampaign;
  window.adminPushCancelCampaign = adminPushCancelCampaign;
  window.adminPushRunQueueNow = adminPushRunQueueNow;
  window.adminPushSendTest = adminPushSendTest;
  window.adminPushOpenTemplateModal = adminPushOpenTemplateModal;
  window.adminPushSaveTemplate = adminPushSaveTemplate;
  window.adminPushDeleteTemplate = adminPushDeleteTemplate;
  window.adminPushUseTemplate = adminPushUseTemplate;
  window.adminPushRefreshUserPicker = adminPushRefreshUserPicker;
  window.adminPushToggleUser = adminPushToggleUser;
  window.adminPushSelectVisibleUsers = adminPushSelectVisibleUsers;
})();
