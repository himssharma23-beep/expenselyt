let ownTripsLoadError = '';
function showOwnTripsLoadFailure(message) {
  ownTripsLoadError = message || 'Trip request failed';
  _selectedTripId = null;
  _tripDetail = null;
  renderTripList();
}
function ownTripStatus(trip) {
  const status = String(trip.status || 'upcoming').toLowerCase();
  return ({ pending: 'upcoming', planned: 'upcoming', active: 'ongoing' })[status] || status;
}
function ownTripDays(date) {
  const value = Date.parse(normalizeInputDate(date || ''));
  return Number.isFinite(value) ? Math.round((value - Date.parse(todayStr())) / 86400000) : null;
}
function ownTripDate(date, year = true) {
  if (!date) return 'Dates not set';
  const parsed = new Date(`${normalizeInputDate(date)}T12:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }) : 'Dates not set';
}
function ownTripDateRange(trip) {
  if (!trip.end_date || normalizeInputDate(trip.start_date) === normalizeInputDate(trip.end_date)) return ownTripDate(trip.start_date);
  const sameYear = String(trip.start_date).slice(0, 4) === String(trip.end_date).slice(0, 4);
  return `${ownTripDate(trip.start_date, !sameYear)} – ${ownTripDate(trip.end_date)}`;
}
function ownTripDateNote(trip) {
  const start = Date.parse(normalizeInputDate(trip.start_date || ''));
  const end = Date.parse(normalizeInputDate(trip.end_date || ''));
  const nights = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 86400000)) : 0;
  const days = ownTripDays(trip.start_date);
  const countdown = ownTripStatus(trip) === 'upcoming' && days !== null && days >= 0
    ? (days ? `Starts in ${days} days` : 'Starts today') : '';
  return `${nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Single date'}${countdown ? ` · ${countdown}` : ''}`;
}
function ownTripInitials(trip) {
  const words = String(trip.destination || trip.name || 'Trip').split(/\s+/).filter(p => /^\p{L}/u.test(p));
  return (words.length > 1 ? words.slice(0, 2).map(p => p[0]).join('') : (words[0] || 'TR').slice(0, 2)).toUpperCase();
}
function ownTripPacking(trip) {
  const packing = trip.packing_summary;
  if (!packing || !packing.total_checks) return `<button class="own-packing-add" onclick="openOwnTripPacking(${Number(trip.id)})"><span aria-hidden="true">+</span> Packing list</button>`;
  const percent = Math.max(0, Math.min(100, Number(packing.percent) || 0));
  return `<button class="own-packing-progress" onclick="openOwnTripPacking(${Number(trip.id)})" title="${Number(packing.ready_members) || 0}/${Number(packing.member_count) || 0} members ready · ${Number(packing.remaining) || 0} checks left"><span>${percent}% packed</span><span class="own-progress-track"><i style="width:${percent}%"></i></span></button>`;
}
async function openOwnTripPacking(tripId) {
  await openTripDetail(tripId);
  if (String(_selectedTripId) !== String(tripId)) return;
  selectOwnTripTab('packing');
  document.getElementById('tripPackingPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('packingNewItem')?.focus({ preventScroll: true });
}
function ownTripRowMenuItems(trip) {
  const id = Number(trip.id);
  const item = (label, action, danger = false) => `<button role="menuitem" type="button" class="trip-ledger-menu-item${danger ? ' danger' : ''}" onclick="closeTripRowMenu();${action}">${label}</button>`;
  return `${trip.isOwner ? item('Edit trip', `showTripModal(${id})`) : ''}
    ${item('Packing list', `openOwnTripPacking(${id})`)}
    ${trip.isOwner ? item('Duplicate', `showTripModal(${id},true)`) : ''}
    ${trip.isOwner ? item('Share trip', `showTripShareModal(${id})`) : ''}
    ${trip.isOwner ? item('Add itinerary', `showTripItineraryModal(null,${id})`) : ''}
    ${item('Download PDF', `downloadTripPdfById(${id})`)}
    ${trip.isOwner ? item('Settle trip', `showTripSettlementModal(${id})`) : ''}
    ${trip.isOwner ? item('Delete', `tripDelete(${id})`, true) : ''}`;
}
function ownTripMenuKeydown(event) { if (event.key === 'Escape') closeTripRowMenu(); }
function resetOwnTripsFilters() {
  const advanced = document.getElementById('ownTripsAdvanced');
  if (advanced) advanced.open = false;
  tripsFilters = { search: '', status: 'all', category: 'all', transport: 'all', member: 'all', packing: 'all', sort: 'latest' };
  tripsPage = 1;
  renderTripList();
}
function showTripsNeedingPacking() {
  tripsFilters.status = 'upcoming';
  tripsFilters.packing = 'missing';
  tripsPage = 1;
  renderTripList();
}
function renderOwnTripsListing() {
  closeTripRowMenu();
  if (ownTripsLoadError && !(_trips || []).length) {
    document.getElementById('main').innerHTML = `<div class="tab-content own-trips-page"><header class="own-trips-header"><div><div class="own-eyebrow">OWN TRIPS · TRAVEL PLANNER</div><div class="own-title-row"><h1>All trips</h1></div></div></header><section class="own-trips-panel own-empty" role="alert"><strong>Could not load your trips</strong><p>Try again to retrieve your saved trips.</p><button class="own-primary" onclick="loadTrips()">Retry loading trips</button></section></div>`;
    return;
  }
  const active = document.activeElement;
  const focusId = ['tripsSearchInput', 'ownTripsCategory', 'ownTripsSort', 'ownTripsMember', 'ownTripsTransport', 'ownTripsPacking'].includes(active?.id) ? active.id : '';
  const selection = focusId === 'tripsSearchInput' ? [active.selectionStart, active.selectionEnd] : null;
  const advancedOpen = document.getElementById('ownTripsAdvanced')?.open || false;
  if (tripsFilters.status !== 'all') tripsFilters.status = ownTripStatus({ status: tripsFilters.status });
  const baseRows = tripFilteredRows(true);
  const filtered = tripFilteredRows().sort((a, b) => {
    const time = t => Date.parse(normalizeInputDate(t.start_date || '')) || 0;
    const name = t => String(t.destination || t.name || '');
    switch (tripsFilters.sort || 'latest') {
      case 'earliest': return time(a) - time(b) || name(a).localeCompare(name(b));
      case 'spend': return tripDisplayAmount(b, tripsFilters.member || 'all') - tripDisplayAmount(a, tripsFilters.member || 'all') || time(b) - time(a);
      case 'name': return name(a).localeCompare(name(b));
      default: return time(b) - time(a) || name(a).localeCompare(name(b));
    }
  });
  _tripsFiltered = filtered;
  const pageSize = 7;
  tripsPage = Math.min(Math.max(1, tripsPage), Math.max(1, Math.ceil(filtered.length / pageSize)));
  const rows = filtered.slice(0, tripsPage * pageSize);
  const upcoming = baseRows.filter(t => ownTripStatus(t) === 'upcoming' && ownTripDays(t.start_date) !== null && ownTripDays(t.start_date) >= 0)
    .sort((a, b) => ownTripDays(a.start_date) - ownTripDays(b.start_date));
  const next = upcoming[0];
  const attention = baseRows.filter(t => ownTripStatus(t) === 'upcoming' && !t.packing_summary?.item_count).length;
  const spend = filtered.reduce((sum, t) => sum + tripDisplayAmount(t, tripsFilters.member || 'all'), 0);
  const nextPacking = Math.max(0, Math.min(100, Number(next?.packing_summary?.percent) || 0));
  const categories = [...new Set([...TRIP_CATEGORY_OPTIONS, ...(_trips || []).map(t => t.category).filter(Boolean)])];
  const tabs = [['all', 'All'], ['upcoming', 'Upcoming'], ['ongoing', 'Ongoing'], ['completed', 'Completed']];
  if (baseRows.some(t => ownTripStatus(t) === 'cancelled')) tabs.push(['cancelled', 'Cancelled']);
  const extraFilters = ['transport', 'packing'].filter(k => tripsFilters[k] && tripsFilters[k] !== 'all').length;
  const hasFilters = tripsFilters.search || ['category', 'member', 'transport', 'packing'].some(k => tripsFilters[k] && tripsFilters[k] !== 'all') || tripsFilters.status !== 'all';
  document.getElementById('main').innerHTML = `<div class="tab-content own-trips-page">
    <header class="own-trips-header"><div><div class="own-eyebrow">OWN TRIPS · TRAVEL PLANNER</div><div class="own-title-row"><h1>All trips</h1><span class="own-count">${(_trips || []).length} trip${(_trips || []).length === 1 ? '' : 's'}</span></div></div><div class="own-header-actions"><details class="own-tools"><summary aria-label="Trip listing tools">&#8943;</summary><div><button onclick="downloadTripsPdf(_tripsFiltered)">Export PDF</button><button onclick="showTripExcelImport()">Import Excel</button></div></details><button class="own-primary" onclick="showTripModal()"><span aria-hidden="true">+</span> New trip</button></div></header>
    ${ownTripsLoadError ? '<div class="own-load-warning" role="alert"><span>Could not refresh trips. Showing the previously loaded list.</span><button class="own-secondary" onclick="loadTrips()">Retry</button></div>' : ''}
    <section class="own-summary" aria-label="Trip overview">
      <button class="own-summary-card own-next" ${next ? `onclick="openTripDetail(${Number(next.id)})"` : 'disabled'}><span class="own-eyebrow">NEXT TRIP</span><span class="own-next-main"><span><strong>${escHtml(next?.destination || next?.name || 'Your next adventure awaits')}</strong><small>${next ? escHtml(ownTripDateRange(next)) : 'Create a trip to start planning'}</small></span><span class="own-countdown"><b>${next ? ownTripDays(next.start_date) : '—'}</b><small>${next ? 'days to go' : 'no trip planned'}</small></span></span><span class="own-next-packing"><span>Packing</span><span class="own-progress-track"><i style="width:${nextPacking}%"></i></span><strong>${nextPacking}%</strong></span></button>
      <div class="own-summary-card"><span class="own-eyebrow">TOTAL SPEND · SHOWN TRIPS</span><strong class="own-summary-value own-money">${fmtCur(spend)}</strong><small>Across ${filtered.length} trip${filtered.length === 1 ? '' : 's'} in this view${tripsFilters.member !== 'all' ? ' · selected member’s share' : ''}</small></div>
      <button class="own-summary-card own-attention" onclick="showTripsNeedingPacking()"><span class="own-eyebrow">NEEDS ATTENTION</span><strong class="own-summary-value">${attention}</strong><small>${attention === 1 ? 'upcoming trip with no packing list' : 'upcoming trips with no packing list'}</small></button>
    </section>
    <section class="own-trips-panel" aria-label="All trips">
      <div class="own-toolbar"><div class="own-status-tabs" role="group" aria-label="Filter trips by status">${tabs.map(([key, label]) => `<button type="button" aria-pressed="${tripsFilters.status === key}" class="${tripsFilters.status === key ? 'is-active' : ''}" onclick="setTripsFilter('status','${key}')">${label} <span>${key === 'all' ? baseRows.length : baseRows.filter(t => ownTripStatus(t) === key).length}</span></button>`).join('')}</div>
        <div class="own-toolbar-fields"><label class="own-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input id="tripsSearchInput" aria-label="Search trips" placeholder="Search destination" value="${escHtml(tripsFilters.search || '')}" oninput="setTripsFilter('search',this.value)"></label><select id="ownTripsMember" aria-label="Filter by user" onchange="setTripsFilter('member',this.value)">${tripOptionsHtml(tripMemberOptions(_trips || []), tripsFilters.member, true, 'All users')}</select><select id="ownTripsCategory" aria-label="Trip type" onchange="setTripsFilter('category',this.value)">${tripOptionsHtml(categories, tripsFilters.category, true, 'All types')}</select><select id="ownTripsSort" aria-label="Sort trips" onchange="setTripsFilter('sort',this.value)">${tripOptionsHtml([{value:'latest',label:'Latest first'},{value:'earliest',label:'Earliest first'},{value:'spend',label:'Highest spend'},{value:'name',label:'Destination A–Z'}], tripsFilters.sort || 'latest')}</select></div>
      </div>
      <details class="own-advanced" id="ownTripsAdvanced" ${advancedOpen || extraFilters ? 'open' : ''}><summary>More filters${extraFilters ? ` <span>${extraFilters} active</span>` : ''}</summary><div><label>Transport<select id="ownTripsTransport" onchange="setTripsFilter('transport',this.value)">${tripOptionsHtml(TRIP_TRANSPORT_OPTIONS, tripsFilters.transport, true, 'All modes')}</select></label><label>Packing<select id="ownTripsPacking" onchange="setTripsFilter('packing',this.value)">${tripOptionsHtml([{value:'missing',label:'No packing list'},{value:'incomplete',label:'Packing in progress'},{value:'complete',label:'Everyone packed'}], tripsFilters.packing || 'all', true, 'Any progress')}</select></label><button class="own-text-button" onclick="resetOwnTripsFilters()">Clear filters</button></div></details>
      ${hasFilters ? `<div class="own-filter-note">${filtered.length} matching trip${filtered.length === 1 ? '' : 's'}${tripsFilters.packing === 'missing' ? ' · No packing list' : ''}<button class="own-text-button" onclick="resetOwnTripsFilters()">Clear filters &times;</button></div>` : ''}
      <div class="own-table-wrap"><table class="own-trips-table"><thead><tr><th>DESTINATION</th><th>DATES</th><th>PACKING</th><th class="own-spend">${tripsFilters.member !== 'all' ? 'USER SHARE' : 'TOTAL SPENT'}</th><th class="own-actions-heading">ACTIONS</th></tr></thead><tbody>${rows.map(trip => {
        const category = String(trip.category || '').toLowerCase();
        const tone = category.includes('family') ? 'amber' : category.includes('office') ? 'blue' : 'green';
        const status = ownTripStatus(trip);
        const amount = tripDisplayAmount(trip, tripsFilters.member || 'all');
        const shared = trip.isOwner === false || trip.is_owner === false;
        return `<tr><td><div class="own-destination"><span class="own-initials own-tone-${tone}" aria-hidden="true">${escHtml(ownTripInitials(trip))}</span><div><button class="own-trip-name" onclick="openTripDetail(${Number(trip.id)})">${escHtml(trip.destination || trip.name || 'Untitled trip')}</button><div class="own-trip-tags">${tripCategoryChip(trip.category)}<span class="own-status own-status-${escHtml(status)}">${escHtml(tripStatusLabel(status))}</span><span class="own-member-count" data-member-count="${(trip.members || []).length}" title="${escHtml((trip.members || []).map(m => m.member_name || m.name || m).join(', '))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 4v2"/></svg>${(trip.members || []).length} member${(trip.members || []).length === 1 ? '' : 's'}</span>${shared ? `<span class="own-shared" title="Shared by ${escHtml(trip.owner_name || 'Owner')}">Shared</span>` : ''}</div></div></div></td><td><div class="own-dates">${escHtml(ownTripDateRange(trip))}</div><div class="own-date-note">${escHtml(ownTripDateNote(trip))}</div></td><td>${ownTripPacking(trip)}</td><td class="own-spend"><strong class="own-money${!amount ? ' own-zero' : ''}">${fmtCur(amount)}</strong>${!amount ? '<small>No expenses yet</small>' : ''}</td><td><div class="own-row-actions"><button class="own-open" onclick="openTripDetail(${Number(trip.id)})">Open <span aria-hidden="true">&#8250;</span></button><button class="trip-ledger-more-btn own-more" aria-label="Actions for ${escHtml(trip.destination || trip.name || 'trip')}" aria-haspopup="menu" aria-expanded="false" onclick="toggleTripRowMenu(event,${Number(trip.id)})">&#8942;</button></div></td></tr>`;
      }).join('')}</tbody></table></div>
      ${!rows.length ? `<div class="own-empty"><strong>${(_trips || []).length ? 'No trips match these filters' : 'Your first trip starts here'}</strong><p>${(_trips || []).length ? 'Try another destination or clear your filters.' : 'Plan your dates, track spending, and keep everyone packed.'}</p><button class="${(_trips || []).length ? 'own-secondary' : 'own-primary'}" onclick="${(_trips || []).length ? 'resetOwnTripsFilters()' : 'showTripModal()'}">${(_trips || []).length ? 'Clear filters' : '+ New trip'}</button></div>` : ''}
      <footer class="own-table-footer"><span>Showing ${rows.length} of ${filtered.length} trip${filtered.length === 1 ? '' : 's'}${filtered.length !== (_trips || []).length ? ` · ${(_trips || []).length} total` : ''}</span>${rows.length < filtered.length ? '<button class="own-secondary" onclick="tripsPage++;renderTripList()">Load more trips</button>' : '<span class="own-list-end">You’re all caught up</span>'}</footer>
    </section>
  </div>`;
  if (focusId) {
    const input = document.getElementById(focusId);
    input?.focus({ preventScroll: true });
    if (input && selection) input.setSelectionRange(...selection.map(n => Math.min(n || 0, input.value.length)));
  }
}
