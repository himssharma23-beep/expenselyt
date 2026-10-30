function tripPackingSummary(c) {
  if (!c?.items) return null;
  const total = c.items.length * c.participants.length;
  const complete = c.participants.reduce((n, p) => n + p.complete, 0);
  return { item_count: c.items.length, member_count: c.participants.length, total_checks: total, complete,
    remaining: total - complete, percent: total ? Math.round(complete / total * 100) : 0,
    ready_members: c.items.length ? c.participants.filter(p => !p.remaining).length : 0, participants: c.participants };
}
function renderTripPackingIndicator(summary) {
  if (!summary) return '';
  const active = summary.total_checks > 0;
  const title = active ? `${summary.ready_members}/${summary.member_count} members ready. ${summary.remaining} packing checks left.` : 'Add items to start packing';
  return `<span class="packing-indicator ${active && !summary.remaining ? 'is-ready' : ''}" title="${escHtml(title)}"><span aria-hidden="true">&#9745;</span> ${active ? `Packing ${summary.percent}%` : 'No packing list'}${active ? `<span class="packing-indicator-track"><i style="width:${summary.percent}%"></i></span>` : ''}</span>`;
}
function renderTripPacking(trip) {
  const c = trip.checklist;
  if (!c?.items) return `<section class="card packing-panel"><h3>Packing checklist</h3><p>Could not load the checklist.</p><button class="btn btn-s" onclick="refreshTripPacking()">Retry</button></section>`;
  const r = c.reminder;
  const summary = tripPackingSummary(c);
  const active = summary.total_checks > 0;
  return `<section class="card packing-panel">
    <div class="packing-heading"><div class="packing-title-icon" aria-hidden="true">&#9745;</div><div class="packing-heading-copy"><h3>Packing checklist</h3><p>${c.items.length} item${c.items.length === 1 ? '' : 's'} &middot; ${c.participants.length} member${c.participants.length === 1 ? '' : 's'} &middot; Separate checks for everyone</p></div><span class="packing-status ${active && !summary.remaining ? 'is-ready' : ''}">${active ? (!summary.remaining ? '&#10003; Everyone is ready' : `${summary.ready_members}/${summary.member_count} ready`) : 'Ready to plan'}</span></div>
    <div class="packing-members">${c.participants.map(p => `<div class="packing-member">
      <div class="packing-ring" role="img" aria-label="${p.percent}% complete, ${c.items.length ? 100 - p.percent : 0}% left" style="--packing-progress:${p.percent}%"><span>${p.percent}<small>%</small></span></div>
      <div class="packing-member-copy"><strong title="${escHtml(p.name)}">${escHtml(p.name)}</strong><span>${p.complete}/${c.items.length} packed</span><small class="${!p.remaining && c.items.length ? 'is-ready' : ''}">${c.items.length ? (p.remaining ? `${p.remaining} left &middot; ${100 - p.percent}%` : 'All packed') : 'No items yet'}</small></div>
    </div>`).join('')}</div>
    ${c.can_edit ? `<form class="packing-add" onsubmit="event.preventDefault();addTripPackingItem()"><input class="fi" id="packingNewItem" aria-label="Item to carry" maxlength="160" placeholder="What do you need to carry?" required><button class="btn btn-p" type="submit">+ Add item</button></form>` : ''}
    ${c.items.length ? `<div class="packing-table-wrap"><table class="packing-table"><thead><tr><th>Item to carry</th>${c.participants.map(p => `<th>${escHtml(p.name)}</th>`).join('')}${c.can_edit ? '<th class="packing-actions">Actions</th>' : ''}</tr></thead><tbody>${c.items.map(i => `<tr><td><span class="packing-item-dot" aria-hidden="true"></span>${escHtml(i.title)}</td>${c.participants.map((p, pi) => `<td><input type="checkbox" aria-label="${escHtml(p.name)}: ${escHtml(i.title)}" ${p.checked_items.includes(String(i.id)) ? 'checked' : ''} ${p.can_check ? '' : 'disabled'} onchange="checkTripPackingItem('${i.id}',${pi},this.checked)"></td>`).join('')}${c.can_edit ? `<td class="packing-actions"><button type="button" class="packing-icon-button" title="Edit item" aria-label="Edit ${escHtml(i.title)}" onclick="editTripPackingItem('${i.id}')">&#9998;</button><button type="button" class="packing-icon-button packing-remove" title="Remove item" aria-label="Remove ${escHtml(i.title)}" onclick="deleteTripPackingItem('${i.id}')">&times;</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<div class="packing-empty">A little planning, a smoother trip.<br><span>Add your first item to build everyone’s packing list.</span></div>'}
    ${c.items.length ? '<div class="packing-scroll-hint">Swipe to see all member checkboxes &rarr;</div>' : ''}
    ${c.can_remind ? `<details class="packing-reminders"><summary><span class="packing-reminder-icon" aria-hidden="true">&#9201;</span><span><strong>Packing reminders</strong><small>${r.enabled ? `${escHtml(r.frequency)} &middot; ${r.days_before} days before &middot; ${escHtml(r.time)}` : 'Set a time to remember what’s left'}</small></span><span class="packing-reminder-state">${r.enabled ? 'On' : 'Off'} <span aria-hidden="true">&#8964;</span></span></summary><form onsubmit="event.preventDefault();saveTripPackingReminder()">
      <label class="packing-toggle"><input id="packingReminderEnabled" type="checkbox" ${r.enabled ? 'checked' : ''}> Remind me about unpacked items</label>
      <div class="packing-reminder-fields"><label class="fl">Days before trip<input class="fi" id="packingReminderDays" type="number" min="0" max="365" value="${r.days_before}" required></label>
      <label class="fl">Repeat<select class="fi" id="packingReminderFrequency">${['once', 'daily', 'weekly'].map(f => `<option value="${f}" ${r.frequency === f ? 'selected' : ''}>${f[0].toUpperCase() + f.slice(1)}</option>`).join('')}</select></label>
      <label class="fl">Time<input class="fi" id="packingReminderTime" type="time" value="${escHtml(r.time)}" required></label><label class="fl">Timezone<input class="fi" id="packingReminderTimezone" value="${escHtml(r.timezone)}" placeholder="Asia/Kolkata" required></label></div>
      <div class="packing-reminder-footer"><small>Only unpacked items. Stops after the trip date. Account notification preferences apply.</small><button class="btn btn-s btn-sm" type="submit">Save reminder</button></div>
    </form></details>` : ''}
  </section>`;
}
async function refreshTripPacking() {
  const trip = _tripDetail;
  if (!trip) return;
  const checklist = await api(`/api/trips/${trip.id}/checklist`);
  if (_tripDetail !== trip) return;
  trip.checklist = checklist;
  trip.packing_summary = tripPackingSummary(checklist);
  if (typeof syncTripListRowFromDetail === 'function') syncTripListRowFromDetail(trip);
  const panel = document.getElementById('tripPackingPanel');
  if (panel) {
    const reminderOpen = panel.querySelector('details')?.open;
    panel.innerHTML = renderTripPacking(trip);
    if (reminderOpen && panel.querySelector('details')) panel.querySelector('details').open = true;
  }
}
async function mutateTripPacking(path, method, body) {
  const result = await api(`/api/trips/${_tripDetail.id}/checklist${path}`, { method, body });
  if (!result?.success) { toast(result?.error || 'Could not save checklist', 'error'); await refreshTripPacking(); return false; }
  await refreshTripPacking();
  return true;
}
async function addTripPackingItem() {
  const title = document.getElementById('packingNewItem').value.trim();
  if (title) await mutateTripPacking('/items', 'POST', { title });
}
async function editTripPackingItem(id) {
  const item = _tripDetail.checklist.items.find(i => String(i.id) === id);
  const title = prompt('Item to carry', item.title);
  if (title?.trim()) await mutateTripPacking(`/items/${id}`, 'PUT', { title: title.trim() });
}
async function deleteTripPackingItem(id) {
  if (await confirmDialog('Remove this item for every traveller?')) await mutateTripPacking(`/items/${id}`, 'DELETE');
}
async function checkTripPackingItem(id, index, checked) {
  await mutateTripPacking(`/items/${id}/check`, 'PUT', { participant_key: _tripDetail.checklist.participants[index].key, checked });
}
async function saveTripPackingReminder() {
  const ok = await mutateTripPacking('/reminder', 'PUT', {
    enabled: document.getElementById('packingReminderEnabled').checked,
    days_before: Number(document.getElementById('packingReminderDays').value),
    frequency: document.getElementById('packingReminderFrequency').value,
    time: document.getElementById('packingReminderTime').value,
    timezone: document.getElementById('packingReminderTimezone').value.trim(),
  });
  if (ok) toast('Your packing reminder was saved', 'success');
}
