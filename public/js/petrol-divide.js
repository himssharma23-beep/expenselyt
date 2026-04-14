(function () {
  window.__petrolDivideLoaded = true;
  let petrolMonth = new Date().toISOString().slice(0, 7);
  let petrolData = null;
  let petrolMonths = [];
  let monthOpened = false;
  let entryEditId = null;
  let petrolShareMode = 'real';
  let petrolShareUrl = '';

  const n = (v) => {
    const val = Number(v);
    return Number.isFinite(val) ? val : 0;
  };
  const toDateInputValue = (raw, monthKey) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const monthMatch = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    const monthYear = monthMatch ? Number(monthMatch[1]) : new Date().getFullYear();
    const monthFromKey = monthMatch ? Number(monthMatch[2]) : null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const dmyMatch = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

    // Handles strings like "Mon Apr 13" or "Apr 13" by using the current month tile year.
    const namedMonthMatch = s.match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})$/);
    if (namedMonthMatch) {
      const map = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const mm = map[String(namedMonthMatch[1] || '').toLowerCase()] || monthFromKey || 1;
      const dd = Math.max(1, Math.min(31, Number(namedMonthMatch[2] || 1)));
      return `${monthYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }

    const dayOnlyMatch = s.match(/(\d{1,2})$/);
    if (dayOnlyMatch && monthFromKey) {
      const dd = Math.max(1, Math.min(31, Number(dayOnlyMatch[1] || 1)));
      return `${monthYear}-${String(monthFromKey).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }

    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() >= 2010) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    return '';
  };
  const toApiDateValue = (raw, monthKey) => {
    const normalized = toDateInputValue(raw, monthKey);
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
    return '';
  };
  const monthBounds = (monthKey) => {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return { min: '', max: '' };
    const y = Number(m[1]);
    const mm = Number(m[2]);
    const lastDay = new Date(y, mm, 0).getDate();
    return {
      min: `${m[1]}-${m[2]}-01`,
      max: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}`,
    };
  };
  const cleanFakeSuffix = (remarks) => String(remarks || '').replace(/\s*\(fake\)\s*$/i, '').trim();

  function friendOptionLabel(friend) {
    const linked = friend?.linked_user_display_name || friend?.linked_user_username;
    return linked ? `${friend.name} (${linked})` : String(friend?.name || 'Friend');
  }

  function selectedValues(selectEl) {
    if (!selectEl) return [];
    return Array.from(selectEl.selectedOptions || []).map((opt) => Number(opt.value)).filter((id) => id > 0);
  }

  function clearMultiSelect(selectId) {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;
    Array.from(selectEl.options || []).forEach((opt) => { opt.selected = false; });
  }

  function monthCardHtml(m) {
    const active = monthOpened && String(m.month_key) === String(petrolMonth);
    return `<div class="cc-tile tracker-tile" data-month-key="${escHtml(m.month_key)}" onclick="petrolOpenMonth('${escHtml(m.month_key)}')" style="cursor:pointer;${active ? 'outline:2px solid rgba(255,255,255,0.75);outline-offset:2px;' : ''}" role="button" tabindex="0" onkeydown="if(event.key==='Enter' || event.key===' '){ event.preventDefault(); petrolOpenMonth('${escHtml(m.month_key)}'); }">
      <div class="cc-tile-header">
        <div>
          <div class="cc-tile-name">${escHtml(m.month_key)}</div>
          <div class="cc-tile-bank">${fmtCur(m.petrol_price || 0)} / litre &middot; ${m.members_count} members</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.75)">${m.entries_count} entries</div>
      </div>
      <div class="cc-tile-amount">${fmtCur(m.total_amount || 0)}</div>
      <div class="cc-tile-label">Month total share</div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px;gap:6px" onclick="stopEvent(event)">
        <button class="cc-action-btn" onclick="petrolEditMonth('${escHtml(m.month_key)}')">Edit</button>
        <button class="cc-action-btn cc-action-del" onclick="petrolDeleteMonth('${escHtml(m.month_key)}')">Delete</button>
      </div>
    </div>`;
  }

  function renderGrid() {
    if (!petrolMonths.length) {
      return `<div style="color:var(--t3);text-align:center;padding:48px 20px;background:var(--white);border-radius:16px;border:2px dashed var(--border);grid-column:1/-1">
        <div style="font-size:36px;margin-bottom:12px">Fuel</div>
        <div style="font-weight:600;margin-bottom:6px;color:var(--t1)">No months yet</div>
        <div style="font-size:13px">Add first month, set petrol price and members.</div>
      </div>`;
    }
    return petrolMonths.map(monthCardHtml).join('');
  }

  function renderListOnly() {
    document.getElementById('main').innerHTML = `
      <div class="tab-content">
        <div class="summary-card" style="margin-bottom:20px">
          <div class="summary-top">
            <div>
              <div class="summary-label">PETROL MONTHS</div>
              <div class="summary-amount">${petrolMonths.length}</div>
              <div class="summary-words">Daily tracker style month tiles</div>
            </div>
            <div class="count-box"><div class="num">${petrolMonths.filter((m) => (m.entries_count || 0) > 0).length}</div><div class="lbl">active</div></div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <div>
            <div style="font-size:16px;font-weight:700;color:var(--t1)">My Petrol Months</div>
            <div style="font-size:12px;color:var(--t3);margin-top:2px">Tap month tile to open daily entries table</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="petrolMonthKey" type="month" class="fi" style="max-width:180px" value="${escHtml(petrolMonth)}">
            <button class="btn btn-p btn-sm" onclick="petrolCreateMonth()">+ Add Month</button>
          </div>
        </div>

        <div class="cc-card-grid">${renderGrid()}</div>
      </div>`;
  }

  function renderDetail() {
    const month = petrolData?.month || { month_key: petrolMonth };
    const entries = petrolData?.entries || [];
    const realEntries = entries.filter((entry) => !entry.is_fake);
    const fakeEntries = entries.filter((entry) => !!entry.is_fake);
    const realTotal = Number(realEntries.reduce((sum, entry) => sum + n(entry.amount_used), 0).toFixed(2));
    const fakeTotal = Number(fakeEntries.reduce((sum, entry) => sum + n(entry.amount_used), 0).toFixed(2));
    const memberTotals = Array.isArray(petrolData?.totals) ? petrolData.totals : [];
    const fakePct = n(month.fake_increase_pct || 0);
    const memberTotalsHtml = memberTotals.length
      ? memberTotals.map((row) => `
        <button type="button" onclick="petrolOpenAdjustmentModal(${Number(row.friend_id)})" style="border:1px solid var(--border);border-radius:12px;padding:10px 12px;background:var(--white);display:flex;flex-direction:column;align-items:flex-start;gap:3px;cursor:pointer;min-width:200px">
          <span style="font-size:13px;color:var(--t1);font-weight:800">${escHtml(row.friend_name || 'Member')}</span>
          <span style="font-size:12px;color:var(--t2)">Real Amount: <b style="color:var(--t1)">${fmtCur(row.real_total || 0)} <span style="color:var(--t3);font-weight:700">(${fmtCur(n(row.real_total) + n(row.adjustment || 0))})</span></b></span>
          <span style="font-size:12px;color:var(--t2)">Fake Amount: <b style="color:var(--t1)">${fmtCur(row.fake_total || 0)} <span style="color:var(--t3);font-weight:700">(${fmtCur(n(row.fake_total) + n(row.adjustment || 0))})</span></b></span>
          <span style="font-size:12px;color:var(--t2)">Extra Added: <b style="color:var(--t1)">${fmtCur(row.adjustment || 0)}</b></span>
          <span style="font-size:12px;color:var(--t2)">Difference of Real and Fake: <b style="color:var(--primary)">${fmtCur(n(row.fake_total) - n(row.real_total))}</b></span>
        </button>
      `).join('')
      : '<div style="font-size:12px;color:var(--t3)">No member totals yet.</div>';
    const buildEntryRows = (list) => list.length
      ? list.map((entry) => {
        const badges = (entry.members || []).length
          ? (entry.members || []).map((m) => `<div style="line-height:1.35">${escHtml(m.friend_name)}: <span style="font-weight:600">${fmtCur(m.share_amount)}</span></div>`).join('')
          : '-';
        return `<tr>
          <td style="white-space:nowrap;vertical-align:top">${escHtml(entry.entry_date)}</td>
          <td style="min-width:140px;vertical-align:top">${escHtml(cleanFakeSuffix(entry.remarks) || '-')}</td>
          <td style="white-space:nowrap;vertical-align:top">${n(entry.distance_km).toFixed(1)}</td>
          <td style="white-space:nowrap;vertical-align:top">${n(entry.average_kmpl).toFixed(1)}</td>
          <td style="white-space:nowrap;vertical-align:top">${n(entry.petrol_used_litre).toFixed(2)} L</td>
          <td style="white-space:nowrap;vertical-align:top;font-weight:700">${fmtCur(entry.amount_used)}</td>
          <td style="font-size:12px;color:var(--t2);min-width:160px;vertical-align:top">${badges}</td>
          <td style="white-space:nowrap;vertical-align:top">
            <div style="display:inline-flex;align-items:center;gap:6px">
              ${entry.is_fake ? '' : `<button class="btn btn-g btn-sm" title="Edit" aria-label="Edit" style="padding:6px 9px;line-height:1" onclick="petrolOpenEntryModal(${entry.id})">&#9998;</button>`}
              <button class="btn btn-g btn-sm" title="Delete" aria-label="Delete" style="padding:6px 9px;line-height:1;color:var(--red)" onclick="petrolDeleteEntry(${entry.id})">&#128465;</button>
            </div>
          </td>
        </tr>`;
      }).join('')
      : '<tr><td colspan="8" style="text-align:center;color:var(--t3);padding:16px">No daily entries yet.</td></tr>';
    const realEntryRows = buildEntryRows(realEntries);
    const fakeEntryRows = buildEntryRows(fakeEntries);

    document.getElementById('main').innerHTML = `
      <div class="tab-content">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px">
          <button class="btn btn-g btn-sm" onclick="petrolBackToList()"><- Back</button>
          <div style="font-size:18px;font-weight:700;color:var(--t1);flex:1;text-align:center">${escHtml(month.month_key || petrolMonth)}</div>
          <button class="btn btn-g btn-sm" onclick="petrolEditMonth('${escHtml(month.month_key || petrolMonth)}')">Edit</button>
        </div>

        <div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <div style="font-size:14px;font-weight:700;color:var(--t1)">Total of each member for this month</div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${memberTotalsHtml}
          </div>
        </div>

        <div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div>
              <div style="font-size:16px;font-weight:700">Daily Entries - Original - ${escHtml(month.month_key || petrolMonth)}</div>
              <div style="font-size:12px;color:var(--t3)">Total: ${fmtCur(realTotal)}</div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-g btn-sm" onclick="petrolDownloadPdf('real')">PDF</button>
              <button class="btn btn-g btn-sm" onclick="petrolOpenShareModal('real')">Share Link</button>
              <button class="btn btn-g btn-sm" onclick="petrolOpenGenerateFakeModal()">Generate Fake (${fakePct.toFixed(2)}%)</button>
              <button class="btn btn-g btn-sm" onclick="petrolOpenImportModal()">Import Excel</button>
              <button class="btn btn-p btn-sm" onclick="petrolOpenEntryModal()">+ Add Entry</button>
            </div>
          </div>
          <div style="margin-top:10px">
            <table class="tbl">
              <thead><tr><th style="min-width:90px">Date</th><th style="min-width:140px">Remarks</th><th style="min-width:86px">Distance</th><th style="min-width:86px">Average</th><th style="min-width:82px">Petrol</th><th style="min-width:90px">Amount</th><th style="min-width:160px">Per person share</th><th style="min-width:76px">Action</th></tr></thead>
              <tbody>${realEntryRows}</tbody>
            </table>
          </div>
        </div>

        <div class="card" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div>
              <div style="font-size:16px;font-weight:700">Daily Entries - Fake - ${escHtml(month.month_key || petrolMonth)}</div>
              <div style="font-size:12px;color:var(--t3)">Total: ${fmtCur(fakeTotal)}</div>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-g btn-sm" onclick="petrolDownloadPdf('fake')">PDF</button>
              <button class="btn btn-g btn-sm" onclick="petrolOpenShareModal('fake')">Share Link</button>
            </div>
          </div>
          <div style="margin-top:10px">
            <table class="tbl">
              <thead><tr><th style="min-width:90px">Date</th><th style="min-width:140px">Remarks</th><th style="min-width:86px">Distance</th><th style="min-width:86px">Average</th><th style="min-width:82px">Petrol</th><th style="min-width:90px">Amount</th><th style="min-width:160px">Per person share</th><th style="min-width:76px">Action</th></tr></thead>
              <tbody>${fakeEntryRows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  function render() {
    if (!monthOpened || !petrolData) renderListOnly();
    else renderDetail();
  }

  async function refreshMonths() {
    const res = await api('/api/petrol-divide/months');
    if (res?.error) {
      toast(res.error, 'error');
      return;
    }
    petrolMonths = Array.isArray(res?.months) ? res.months : [];
  }

  async function refresh() {
    if (typeof currentTab !== 'undefined' && currentTab !== 'petroldivide') return;
    try {
      await refreshMonths();
      if (monthOpened) {
        const next = await api(`/api/petrol-divide?month=${encodeURIComponent(petrolMonth)}`);
        if (next?.error) {
          toast(next.error, 'error');
        } else if (next?.month) {
          petrolData = next;
        } else if (!petrolData) {
          petrolData = null;
        }
      }
      render();
    } catch (err) {
      console.error('[petroldivide] refresh failed', err);
      const main = document.getElementById('main');
      if (main) {
        main.innerHTML = `
          <div class="tab-content">
            <div class="card" style="padding:20px">
              <div style="font-size:16px;font-weight:700;color:var(--red);margin-bottom:6px">Could not load Divide Petrol</div>
              <div style="font-size:13px;color:var(--t2)">${escHtml(String(err?.message || 'Unknown error'))}</div>
            </div>
          </div>`;
      }
    }
  }

  async function loadPetrolDivide() {
    monthOpened = false;
    petrolData = null;
    entryEditId = null;
    await refresh();
  }

  async function petrolBackToList() {
    monthOpened = false;
    petrolData = null;
    entryEditId = null;
    render();
  }

  async function petrolOpenMonth(monthKey) {
    petrolMonth = String(monthKey || '').trim();
    if (!/^\d{4}-\d{2}$/.test(petrolMonth)) return toast('Select a valid month', 'warning');
    monthOpened = true;
    entryEditId = null;
    await refresh();
  }

  async function petrolCreateMonth() {
    const monthKey = String(document.getElementById('petrolMonthKey')?.value || '').trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return toast('Select a valid month', 'warning');
    await showMonthConfigModal(monthKey, true);
  }

  async function petrolEditMonth(monthKey) {
    await showMonthConfigModal(monthKey, false);
  }

  async function showMonthConfigModal(monthKey, isCreate) {
    const monthData = await api(`/api/petrol-divide?month=${encodeURIComponent(monthKey)}`);
    if (monthData?.error || !monthData?.month) {
      toast(monthData?.error || 'Could not load month', 'error');
      return;
    }
    const friends = monthData?.live_split_friends || [];
    const selected = new Set((monthData?.month_members || []).map((m) => Number(m.friend_id)).filter((id) => id > 0));
    const options = friends.map((f) => {
      const sid = Number(f.id);
      const isSel = selected.has(sid) ? 'selected' : '';
      return `<option value="${sid}" ${isSel}>${escHtml(friendOptionLabel(f))}</option>`;
    }).join('');
    openModal(`${isCreate ? 'Add' : 'Edit'} Month - ${escHtml(monthKey)}`, `
      <div class="fg">
        <label class="fl">Petrol Price (per litre)
          <input class="fi" id="petrolEditPrice" type="number" step="0.01" value="${escHtml(String(n(monthData?.month?.petrol_price || 0)))}">
        </label>
        <label class="fl">Members (Live Split friends)
          <select class="fi" id="petrolEditMembers" multiple style="min-height:180px">${options}</select>
        </label>
      </div>
      <div class="fa" style="margin-top:12px">
        <button class="btn btn-p" onclick="petrolSaveMonthConfigFromModal('${escHtml(monthKey)}', ${isCreate ? 'true' : 'false'})">${isCreate ? 'Create Month' : 'Save'}</button>
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
      </div>
    `);
  }

  async function petrolSaveMonthConfigFromModal(monthKey, openAfterSave) {
    const price = n(document.getElementById('petrolEditPrice')?.value);
    const memberIds = selectedValues(document.getElementById('petrolEditMembers'));
    const data = await api('/api/petrol-divide/config', {
      method: 'PUT',
      body: { month_key: monthKey, petrol_price: price, member_friend_ids: memberIds },
    });
    if (data?.error || !data?.month) return toast(data?.error || 'Could not save month', 'error');
    closeModal();
    toast('Month settings saved', 'success');
    petrolMonth = monthKey;
    if (openAfterSave) monthOpened = true;
    await refresh();
  }

  async function petrolDeleteMonth(monthKey) {
    const ok = await confirmDialog(`Delete month ${monthKey}? This removes all entries and adjustments of that month.`);
    if (!ok) return;
    const data = await api(`/api/petrol-divide/months/${encodeURIComponent(monthKey)}`, { method: 'DELETE' });
    if (data?.error) return toast(data.error, 'error');
    if (petrolMonth === monthKey) {
      monthOpened = false;
      petrolData = null;
    }
    toast(`Deleted ${monthKey}`, 'success');
    await refresh();
  }

  function buildEntryModal(entry) {
    const friends = petrolData?.live_split_friends || [];
    const monthMembers = new Set((petrolData?.month_members || []).map((m) => Number(m.friend_id)).filter((id) => id > 0));
    const selectedIds = entry
      ? new Set((entry.members || []).map((m) => Number(m.friend_id)).filter((id) => id > 0))
      : monthMembers;
    const options = friends.map((f) => {
      const id = Number(f.id);
      const selected = selectedIds.has(id) ? 'selected' : '';
      return `<option value="${id}" ${selected}>${escHtml(friendOptionLabel(f))}</option>`;
    }).join('');

    const { min: minDate, max: maxDate } = monthBounds(petrolMonth);
    const today = new Date().toISOString().slice(0, 10);
    const defaultDate = today.slice(0, 7) === petrolMonth ? today : minDate;
    const pickedDate = entry ? toDateInputValue(entry.entry_date, petrolMonth) : defaultDate;
    const dateVal = String(pickedDate || '').slice(0, 7) === String(petrolMonth) ? pickedDate : defaultDate;
    const remarksVal = entry ? cleanFakeSuffix(entry.remarks) : '';
    const distanceVal = entry ? String(n(entry.distance_km).toFixed(1)) : '';
    const averageVal = entry ? String(n(entry.average_kmpl).toFixed(1)) : '';

    return `
      <div class="fg">
        <label class="fl">Date<input id="petrolEntryDate" class="fi" type="date" value="${escHtml(dateVal)}" min="${escHtml(minDate)}" max="${escHtml(maxDate)}"></label>
        <label class="fl">Remarks<input id="petrolEntryRemarks" class="fi" type="text" value="${escHtml(remarksVal)}" placeholder="Office commute"></label>
        <label class="fl">Distance (km)<input id="petrolEntryDistance" class="fi" type="number" step="0.1" value="${escHtml(distanceVal)}"></label>
        <label class="fl">Average (km/l)<input id="petrolEntryAverage" class="fi" type="number" step="0.1" value="${escHtml(averageVal)}"></label>
        <label class="fl">Members
          <select id="petrolEntryMembers" class="fi" multiple style="min-height:170px">${options}</select>
        </label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn btn-g btn-sm" onclick="clearMultiSelect('petrolEntryMembers')">Only Me</button>
          <div style="font-size:12px;color:var(--t3)">Leave members empty for a self-only entry. Hold Ctrl/Cmd to select multiple members.</div>
        </div>
      </div>
      <div class="fa" style="margin-top:12px">
        <button class="btn btn-p" onclick="petrolSaveEntryFromModal()">${entry ? 'Update Entry' : 'Add Entry'}</button>
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
      </div>`;
  }

  async function petrolOpenEntryModal(entryId) {
    entryEditId = entryId ? Number(entryId) : null;
    const entry = entryEditId ? (petrolData?.entries || []).find((e) => Number(e.id) === entryEditId) : null;
    openModal(entry ? 'Edit Entry' : 'Add Entry', buildEntryModal(entry));
  }

  async function petrolSaveEntryFromModal() {
    try {
      const dateRaw = document.getElementById('petrolEntryDate')?.value || '';
      const entryDate = toApiDateValue(dateRaw, petrolMonth) || new Date().toISOString().slice(0, 10);
      if (String(entryDate).slice(0, 7) !== String(petrolMonth)) {
        return toast(`Date must be in ${petrolMonth}`, 'warning');
      }
      const payload = {
        month_key: petrolMonth,
        entry_date: entryDate,
        remarks: document.getElementById('petrolEntryRemarks')?.value || '',
        distance_km: n(document.getElementById('petrolEntryDistance')?.value),
        average_kmpl: n(document.getElementById('petrolEntryAverage')?.value),
        member_friend_ids: selectedValues(document.getElementById('petrolEntryMembers')),
      };
      if (payload.distance_km <= 0 || payload.average_kmpl <= 0) return toast('Distance and average must be greater than 0', 'warning');
      let data;
      if (entryEditId) data = await api(`/api/petrol-divide/entries/${entryEditId}`, { method: 'PUT', body: payload });
      else data = await api('/api/petrol-divide/entries', { method: 'POST', body: payload });
      if (!data) return toast('Network error while saving entry', 'error');
      if (data?.error || !data?.month) return toast(data?.error || 'Could not save entry', 'error');

      closeModal();
      entryEditId = null;
      toast('Entry saved', 'success');
      await refresh();
    } catch (err) {
      toast(err?.message || 'Could not save entry', 'error');
    }
  }

  async function petrolDeleteEntry(entryId) {
    try {
      const ok = await confirmDialog('Delete this petrol entry?');
      if (!ok) return;
      const data = await api(`/api/petrol-divide/entries/${entryId}`, { method: 'DELETE' });
      if (!data) return toast('Network error while deleting entry', 'error');
      if (data?.error || !data?.month) return toast(data?.error || 'Could not delete entry', 'error');
      toast('Entry deleted', 'success');
      await refresh();
    } catch (err) {
      toast(err?.message || 'Could not delete entry', 'error');
    }
  }

  function petrolOpenGenerateFakeModal() {
    const currentPct = n(petrolData?.month?.fake_increase_pct || 0);
    openModal('Generate Fake Entries', `
      <div class="fg">
        <label class="fl">Increase entries by (%)
          <input id="petrolFakePct" class="fi" type="number" step="0.01" value="${escHtml(String(currentPct))}" placeholder="5">
        </label>
        <div style="font-size:12px;color:var(--t3)">This sets month fake % and auto-syncs fake rows from original entries.</div>
      </div>
      <div class="fa" style="margin-top:12px">
        <button class="btn btn-p" onclick="petrolGenerateFakeFromModal()">Generate</button>
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
      </div>
    `);
  }

  async function petrolGenerateFakeFromModal() {
    try {
      const pct = n(document.getElementById('petrolFakePct')?.value);
      if (!Number.isFinite(pct) || pct < 0) return toast('Increase % must be 0 or more', 'warning');
      const data = await api('/api/petrol-divide/fake/generate', {
        method: 'POST',
        body: { month_key: petrolMonth, increase_pct: pct },
      });
      if (!data) return toast('Network error while generating fake entries', 'error');
      if (data?.error) return toast(data.error, 'error');
      if (!data?.month) return toast('Could not save fake %', 'error');
      closeModal();
      petrolData = data || null;
      toast('Fake entries generated', 'success');
      await refreshMonths();
      render();
    } catch (err) {
      toast(err?.message || 'Could not generate fake entries', 'error');
    }
  }

  function petrolOpenAdjustmentModal(friendId) {
    const fid = Number(friendId);
    if (!(fid > 0)) return;
    const row = (petrolData?.totals || []).find((r) => Number(r.friend_id) === fid);
    const adj = (petrolData?.adjustments || []).find((a) => Number(a.friend_id) === fid);
    if (!row) return;
    openModal(`Adjust - ${escHtml(row.friend_name || 'Member')}`, `
      <div class="fg">
        <div style="font-size:12px;color:var(--t2)">Real: ${fmtCur(row.real_total || 0)} | Fake: ${fmtCur(row.fake_total || 0)}</div>
        <label class="fl">Adjustment Amount
          <input id="petrolAdjAmt" class="fi" type="number" step="0.01" value="${escHtml(String(n(adj?.adjust_amount || 0)))}" placeholder="0">
        </label>
        <label class="fl">Note
          <input id="petrolAdjNote" class="fi" type="text" value="${escHtml(String(adj?.note || ''))}" placeholder="Round off">
        </label>
      </div>
      <div class="fa" style="margin-top:12px">
        <button class="btn btn-p" onclick="petrolSaveAdjustmentFromModal(${fid})">Save</button>
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
      </div>
    `);
  }

  async function petrolSaveAdjustmentFromModal(friendId) {
    try {
      const fid = Number(friendId);
      if (!(fid > 0)) return;
      const amt = n(document.getElementById('petrolAdjAmt')?.value);
      const note = String(document.getElementById('petrolAdjNote')?.value || '').trim();
      const existing = Array.isArray(petrolData?.adjustments) ? petrolData.adjustments : [];
      const merged = [];
      let found = false;
      for (const item of existing) {
        const id = Number(item.friend_id || 0);
        if (!(id > 0)) continue;
        if (id === fid) {
          found = true;
          if (Math.abs(amt) > 0.0001 || note) merged.push({ friend_id: fid, adjust_amount: amt, note });
        } else {
          merged.push({ friend_id: id, adjust_amount: n(item.adjust_amount), note: String(item.note || '') });
        }
      }
      if (!found && (Math.abs(amt) > 0.0001 || note)) {
        merged.push({ friend_id: fid, adjust_amount: amt, note });
      }

      const data = await api('/api/petrol-divide/adjustments', {
        method: 'PUT',
        body: { month_key: petrolMonth, adjustments: merged },
      });
      if (!data || data?.error || !data?.month) return toast(data?.error || 'Could not save adjustment', 'error');
      closeModal();
      petrolData = data || null;
      toast('Adjustment saved', 'success');
      await refreshMonths();
      render();
    } catch (err) {
      toast(err?.message || 'Could not save adjustment', 'error');
    }
  }

  function petrolDownloadPdf(kind = 'real') {
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

  function petrolOpenShareModal(mode = 'real') {
    petrolShareMode = String(mode || 'real').toLowerCase() === 'fake' ? 'fake' : 'real';
    petrolShareUrl = '';
    const today = new Date().toISOString().slice(0, 10);
    openModal('Generate Share Link', `
      <div class="fg">
        <label class="fl">What to share
          <select id="petrolShareType" class="fi">
            <option value="entries">Daily entries</option>
            <option value="summary">Only monthly summary</option>
          </select>
        </label>
        <label class="fl">Expiry date (optional)
          <input id="petrolShareExpiry" class="fi" type="date" min="${escHtml(today)}">
        </label>
        <div id="petrolShareLinkOut" style="font-size:12px;color:var(--t2);word-break:break-all"></div>
      </div>
      <div class="fa" style="margin-top:12px;gap:8px">
        <button class="btn btn-p" onclick="petrolCreateShareLinkFromModal()">Generate Link</button>
        <button class="btn btn-g" onclick="petrolCopyShareLink()">Copy</button>
        <button class="btn btn-g" onclick="petrolShareLinkNative()">Share</button>
        <button class="btn btn-g" onclick="closeModal()">Close</button>
      </div>
    `);
  }

  async function petrolCreateShareLinkFromModal() {
    try {
      const shareType = String(document.getElementById('petrolShareType')?.value || 'entries').toLowerCase() === 'summary' ? 'summary' : 'entries';
      const expiry = String(document.getElementById('petrolShareExpiry')?.value || '').trim();
      const payload = {
        month_key: petrolMonth,
        view_mode: petrolShareMode,
        share_type: shareType,
        expires_at: expiry || null,
      };
      const data = await api('/api/petrol-divide/share-link', { method: 'POST', body: payload });
      if (!data || data?.error || !data?.url) return toast(data?.error || 'Could not generate link', 'error');
      petrolShareUrl = String(data.url || '').trim();
      const out = document.getElementById('petrolShareLinkOut');
      if (out) out.innerHTML = `<b>Link:</b> ${escHtml(petrolShareUrl)}`;
      toast('Share link generated', 'success');
    } catch (err) {
      toast(err?.message || 'Could not generate link', 'error');
    }
  }

  async function petrolCopyShareLink() {
    try {
      if (!petrolShareUrl) return toast('Generate link first', 'warning');
      await navigator.clipboard.writeText(petrolShareUrl);
      toast('Link copied', 'success');
    } catch (_err) {
      toast('Could not copy link', 'error');
    }
  }

  async function petrolShareLinkNative() {
    try {
      if (!petrolShareUrl) return toast('Generate link first', 'warning');
      if (navigator.share) {
        await navigator.share({ title: 'Petrol Divide Share', text: petrolShareUrl, url: petrolShareUrl });
      } else {
        await navigator.clipboard.writeText(petrolShareUrl);
        toast('Link copied (native share not supported)', 'success');
      }
    } catch (_err) {
      toast('Could not share link', 'error');
    }
  }

  function petrolOpenImportModal() {
    const currentUserName = String(window.currentUser?.display_name || window.currentUser?.username || '').trim();
    const defaultSelfInitial = (currentUserName.charAt(0) || 'H').toUpperCase();
    openModal('Import From Excel', `
      <div class="fg">
        <div style="font-size:12px;color:var(--t2)">
          Expected columns: <b>Date</b>, <b>Remarks</b>, <b>Petrol price</b>, <b>Distance (in km)</b>, <b>members</b>.<br>
          Example members: <b>HDS</b> where <b>${escHtml(defaultSelfInitial)}</b> is you.
        </div>
        <label class="fl">Excel File
          <input id="petrolImportFile" class="fi" type="file" accept=".xlsx,.xls,.csv">
        </label>
        <label class="fl">Default Average (km/l) for rows where average is missing
          <input id="petrolImportAvg" class="fi" type="number" step="0.1" min="0.1" placeholder="10.0">
        </label>
        <label class="fl">Your Initial
          <input id="petrolImportSelfInitial" class="fi" type="text" maxlength="1" value="${escHtml(defaultSelfInitial)}" placeholder="H">
        </label>
      </div>
      <div class="fa" style="margin-top:12px;gap:8px">
        <button class="btn btn-p" onclick="petrolImportExcelFromModal()">Import</button>
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
      </div>
    `);
  }

  async function petrolImportExcelFromModal() {
    try {
      const file = document.getElementById('petrolImportFile')?.files?.[0];
      if (!file) return toast('Choose an Excel file first', 'warning');
      const avg = n(document.getElementById('petrolImportAvg')?.value);
      const selfInitial = String(document.getElementById('petrolImportSelfInitial')?.value || '').trim().charAt(0).toUpperCase() || 'H';

      const fd = new FormData();
      fd.append('file', file);
      fd.append('month_key', petrolMonth);
      if (avg > 0) fd.append('default_average_kmpl', String(avg));
      fd.append('self_initial', selfInitial);

      const res = await fetch('/api/petrol-divide/import-excel', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) return toast(data?.error || 'Import failed', 'error');

      closeModal();
      petrolData = data || null;
      const skipped = Number(data?.skipped || 0);
      const imported = Number(data?.imported || 0);
      if (skipped > 0) {
        const first = Array.isArray(data?.skipped_rows) && data.skipped_rows.length
          ? ` First issue: Row ${data.skipped_rows[0].row} - ${data.skipped_rows[0].reason}`
          : '';
        toast(`Imported ${imported}, skipped ${skipped}.${first}`, 'warning');
      } else {
        toast(`Imported ${imported} entries`, 'success');
      }
      await refreshMonths();
      render();
    } catch (err) {
      toast(err?.message || 'Import failed', 'error');
    }
  }

  window.loadPetrolDivide = loadPetrolDivide;
  window.petrolBackToList = petrolBackToList;
  window.petrolOpenMonth = petrolOpenMonth;
  window.petrolCreateMonth = petrolCreateMonth;
  window.petrolEditMonth = petrolEditMonth;
  window.petrolSaveMonthConfigFromModal = petrolSaveMonthConfigFromModal;
  window.petrolDeleteMonth = petrolDeleteMonth;
  window.petrolOpenEntryModal = petrolOpenEntryModal;
  window.petrolSaveEntryFromModal = petrolSaveEntryFromModal;
  window.petrolDeleteEntry = petrolDeleteEntry;
  window.petrolOpenGenerateFakeModal = petrolOpenGenerateFakeModal;
  window.petrolGenerateFakeFromModal = petrolGenerateFakeFromModal;
  window.petrolOpenAdjustmentModal = petrolOpenAdjustmentModal;
  window.petrolSaveAdjustmentFromModal = petrolSaveAdjustmentFromModal;
  window.petrolDownloadPdf = petrolDownloadPdf;
  window.petrolOpenShareModal = petrolOpenShareModal;
  window.petrolCreateShareLinkFromModal = petrolCreateShareLinkFromModal;
  window.petrolCopyShareLink = petrolCopyShareLink;
  window.petrolShareLinkNative = petrolShareLinkNative;
  window.petrolOpenImportModal = petrolOpenImportModal;
  window.petrolImportExcelFromModal = petrolImportExcelFromModal;
  window.clearMultiSelect = clearMultiSelect;
})();
