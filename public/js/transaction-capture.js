let captureState = null;
let captureItems = [];
let captureAdminUser = null;
let captureBusy = false;
async function refreshCaptureAvailability() {
  try {
    const response = await fetch('/api/capture/access',{credentials:'same-origin',signal:AbortSignal.timeout(2500)});
    if(!response.ok) return;
    window.captureAvailability = await response.json();
    const button = document.querySelector('[data-tab="smartcapture"]');
    if(button) button.style.display = Object.values(window.captureAvailability.permissions || {}).some(Boolean) ? '' : 'none';
  } catch (_) { /* Optional feature stays hidden; normal pages are already loaded. */ }
}
async function captureRequest(path, options = {}) {
  const response = await fetch('/api/capture'+path, { credentials:'same-origin', ...options,
    headers:options.body instanceof FormData ? {} : {'Content-Type':'application/json'},
    body:options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || 'Capture request failed.');
  return data;
}
async function captureRun(work) {
  if(captureBusy) return;
  captureBusy = true;
  try { await work(); } catch(e) { toast(escHtml(e.message),'error'); }
  finally { captureBusy = false; }
}
async function showCapturePermissions(userId) {
  return captureRun(async () => {
    const data = await captureRequest('/admin/users/'+userId);
    captureAdminUser = Number(userId);
    openModal('Transaction capture permissions', `<p>Choose methods for this user. All methods are off by default. The user must separately enable capture and grant device or mailbox access.</p>
      ${Object.entries(data.methods).map(([key,label]) => `<label style="display:flex;gap:12px;align-items:center;padding:10px 0"><input type="checkbox" data-capture-permission="${key}" ${data.permissions[key] ? 'checked' : ''}>${escHtml(label)}</label>`).join('')}
      <div class="modal-footer"><button class="btn btn-s" onclick="closeModal()">Cancel</button><button class="btn btn-p" onclick="saveCapturePermissions()">Save permissions</button></div>`);
  });
}
async function saveCapturePermissions() {
  return captureRun(async () => {
    const permissions = Object.fromEntries([...document.querySelectorAll('[data-capture-permission]')].map(el => [el.dataset.capturePermission,el.checked]));
    await captureRequest('/admin/users/'+captureAdminUser,{method:'PUT',body:{permissions}});
    closeModal(); toast('Capture permissions saved.','success');
  });
}
async function loadTransactionCapture() {
  try {
    const [state,items] = await Promise.all([captureRequest('/methods'),captureRequest('/items')]);
    captureState = state; captureItems = items.items;
    const enabled = key => state.permissions[key] && state.preferences[key];
    document.getElementById('main').innerHTML = `<div class="tab-content">
      <div class="page-header"><h1>Smart Capture</h1><button class="btn btn-s" onclick="loadTransactionCapture()">Refresh</button></div>
      <p>Transaction alerts, emails, receipts and statements share this review inbox. AI reading sends selected transaction content to the configured AI provider.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
        <div class="card"><h3>Capture methods</h3>${Object.entries(state.methods).filter(([key]) => state.permissions[key]).map(([key,label]) => `<label style="display:flex;align-items:center;gap:10px;padding:9px 0"><input type="checkbox" ${state.preferences[key] ? 'checked' : ''} ${Object.hasOwn(state.configured,key) && !state.configured[key] ? 'disabled' : ''} onchange="captureToggle('${key}',this.checked)">${escHtml(label)}${Object.hasOwn(state.configured,key) && !state.configured[key] ? ' (server setup required)' : ''}</label>`).join('') || '<p>No capture methods enabled. Contact your administrator.</p>'}
        <p>Android SMS and notification capture are configured in the mobile app. iPhone automation uses Apple Shortcuts.</p>
        ${enabled('ios_shortcut') ? '<button class="btn btn-s" onclick="captureGenerateToken(\'ios_shortcut\')">Generate Shortcuts setup</button> <button class="btn btn-s" onclick="captureRevokeToken(\'ios_shortcut\')">Revoke token</button>' : ''}
        ${enabled('email_forward') ? '<button class="btn btn-s" onclick="captureGenerateToken(\'email_forward\')">Generate forwarding address</button> <button class="btn btn-s" onclick="captureRevokeToken(\'email_forward\')">Revoke address</button>' : ''}
        </div>
        <div class="card"><h3>Add transaction text</h3><textarea class="fi" id="captureText" rows="6" placeholder="Paste a bank alert or payment receipt"></textarea>
          ${enabled('manual') ? '<button class="btn btn-p" onclick="captureSubmitText(\'manual\')">Extract transaction</button>' : ''}
          ${enabled('clipboard') ? '<button class="btn btn-s" onclick="capturePaste()">Read clipboard</button><button class="btn btn-s" onclick="captureSubmitText(\'clipboard\')">Import pasted text</button>' : ''}
          <p>${enabled('ai_read') ? 'AI reading enabled.' : 'Rule-based extraction enabled.'}</p>
          ${['receipt_image','statement_import','voice'].filter(enabled).map(key => `<label style="display:block;margin-top:12px">${escHtml(state.methods[key])}<input type="file" ${key === 'receipt_image' ? 'accept="image/*"' : key === 'voice' ? 'accept="audio/*"' : 'accept=".csv,.xlsx,.xls,.pdf"'} onchange="captureImport('${key}',this)"></label>`).join('')}
          <p>Statement columns: date, description, debit/credit or amount/type, optional reference. Maximum 200 rows. PDF imports need a text layer.</p>
        </div>
        <div class="card"><h3>Transaction emails</h3><label>Exact bank or receipt sender addresses, separated by commas<input class="fi" id="captureSenders" placeholder="alerts@yourbank.example"></label>
          ${['email_gmail','email_outlook'].filter(enabled).map(key => `<div style="margin-top:12px"><strong>${escHtml(state.methods[key])}</strong><p>${state.mailboxes.filter(m => m.method === key).map(m => escHtml(m.email)+(m.last_error ? ' · '+escHtml(m.last_error) : '')).join('') || 'Not connected'}</p><button class="btn btn-s" onclick="captureConnectEmail('${key}')">Connect</button> <button class="btn btn-s" onclick="captureSyncEmail('${key}')">Sync</button> <button class="btn btn-s" onclick="captureDisconnectEmail('${key}')">Disconnect</button></div>`).join('')}
        </div>
      </div>
      <h2>Review inbox</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">${captureItems.filter(i => i.status === 'pending').map(item => `<div class="card"><strong>${escHtml(item.item_name)}</strong><p>${escHtml(item.currency)} ${Number(item.amount).toFixed(2)} · ${escHtml(item.purchase_date)} · ${escHtml(item.transaction_direction)}</p><p>${escHtml(state.methods[item.source] || item.source)}</p>${item.possible_duplicate_id ? '<p style="color:var(--red)">Possible duplicate: check your existing entries.</p>' : ''}<p style="white-space:pre-wrap">${escHtml(String(item.parsed_text || '').slice(0,300))}</p><button class="btn btn-p" onclick="captureReview(${Number(item.id)})">Review</button> <button class="btn btn-s" onclick="captureIgnore(${Number(item.id)})">Ignore</button></div>`).join('') || '<p>No pending transactions.</p>'}</div>
      <h3>Recent processed transactions</h3>${captureItems.filter(i => i.status !== 'pending').slice(0,20).map(i => `<p>${escHtml(i.item_name)} · ${Number(i.amount).toFixed(2)} · ${escHtml(i.status)}</p>`).join('')}
      </div>`;
  } catch(e) { document.getElementById('main').innerHTML = '<div class="tab-content">'+escHtml(e.message)+'</div>'; }
}
async function captureToggle(key,value) { return captureRun(async () => { await captureRequest('/preferences',{method:'PUT',body:{preferences:{[key]:value}}}); await loadTransactionCapture(); }); }
async function capturePaste() { return captureRun(async () => { document.getElementById('captureText').value = await navigator.clipboard.readText(); }); }
async function captureSubmitText(method) {
  return captureRun(async () => { const text = document.getElementById('captureText').value; await captureRequest('/items',{method:'POST',body:{method,text,ai:!!captureState.preferences.ai_read}}); await loadTransactionCapture(); });
}
async function captureImport(method,input) {
  const file = input.files[0]; if(!file) return;
  return captureRun(async () => { const body = new FormData(); body.append('file',file); body.append('ai',captureState.preferences.ai_read ? 'true' : 'false'); const result = await captureRequest('/import/'+method,{method:'POST',body}); toast(`${result.items.length} suggestions, ${result.skipped.length} skipped.`,'success'); await loadTransactionCapture(); });
}
async function captureGenerateToken(method) {
  return captureRun(async () => {
    const result = await captureRequest('/tokens/'+method,{method:'POST'});
    const value = result.address || `URL: ${result.endpoint}\nMethod: POST\nAuthorization: Bearer ${result.token}\nContent-Type: application/json\nJSON: {"text":"<Shortcut Input>","ai":false}`;
    openModal(method === 'email_forward' ? 'Forwarding address' : 'Apple Shortcuts setup',`<p>Keep these details private. Generating another token revokes the previous one.</p><textarea class="fi" id="captureSetupSecret" rows="8" readonly>${escHtml(value)}</textarea><p>${method === 'email_forward' ? 'Create an email rule that forwards transaction alerts to this address.' : 'Create an Apple Shortcuts Message, supported Notification (iOS 27), or Wallet automation. Use Get Contents of URL and pass the available transaction text as the JSON text field.'}</p><button class="btn btn-s" onclick="navigator.clipboard.writeText(document.getElementById('captureSetupSecret').value)">Copy</button><button class="btn btn-p" onclick="closeModal()">Close</button>`);
  });
}
async function captureRevokeToken(method) { return captureRun(async () => { await captureRequest('/tokens/'+method,{method:'DELETE'}); toast('Capture token revoked.','success'); }); }
async function captureConnectEmail(method) { return captureRun(async () => { const result = await captureRequest('/email/'+method+'/connect',{method:'POST',body:{senders:document.getElementById('captureSenders').value}}); window.location.assign(result.url); }); }
async function captureSyncEmail(method) { return captureRun(async () => { const result = await captureRequest('/email/'+method+'/sync',{method:'POST'}); toast(`${result.imported} imported, ${result.skipped} skipped.${result.has_more ? ' Sync again for more.' : ''}`,'success'); await loadTransactionCapture(); }); }
async function captureDisconnectEmail(method) { return captureRun(async () => { await captureRequest('/email/'+method,{method:'DELETE'}); await loadTransactionCapture(); }); }
async function captureIgnore(id) { return captureRun(async () => { await captureRequest('/items/'+id,{method:'PATCH',body:{status:'ignored'}}); await loadTransactionCapture(); }); }
async function captureReview(id) {
  return captureRun(async () => {
    const item = captureItems.find(i => Number(i.id) === id);
    const bankResult = await api('/api/banks'), cardResult = await api('/api/cc/cards');
    openModal('Review transaction',`<p>Direction: ${escHtml(item.transaction_direction)}. Credits, refunds, transfers and unsuccessful payments cannot be added as spending.</p>${item.possible_duplicate_id ? '<p style="color:var(--red)">Possible duplicate. Check your expenses first.</p>' : ''}
      <label>Name<input class="fi" id="captureName" value="${escHtml(item.item_name)}"></label><label>Amount<input class="fi" id="captureAmount" type="number" min="0.01" step="0.01" value="${Number(item.amount)}"></label><label>Date<input class="fi" id="captureDate" type="date" value="${escHtml(item.purchase_date)}"></label><label>Category<input class="fi" id="captureCategory" value="${escHtml(item.category)}"></label>
      <label>Bank<select class="fi" id="captureBank"><option value="">None</option>${(bankResult.banks || []).map(b => `<option value="${Number(b.id)}" ${Number(item.bank_account_id) === Number(b.id) ? 'selected' : ''}>${escHtml(b.bank_name)} ${escHtml(b.account_name || '')}</option>`).join('')}</select></label>
      <label>Credit card<select class="fi" id="captureCard"><option value="">None</option>${(cardResult.cards || []).map(c => `<option value="${Number(c.id)}" ${Number(item.card_id) === Number(c.id) ? 'selected' : ''}>${escHtml(c.card_name)} **${escHtml(c.last4)}</option>`).join('')}</select></label>
      <label><input id="captureConfirmed" type="checkbox"> I confirm this is an expense and have checked for duplicates.</label>
      <div class="modal-footer"><button class="btn btn-s" onclick="closeModal()">Cancel</button><button class="btn btn-p" onclick="captureConfirm(${id})">Add expense</button></div>`);
  });
}
async function captureConfirm(id) {
  return captureRun(async () => {
    if(!document.getElementById('captureConfirmed').checked) throw new Error('Confirm this expense first.');
    await captureRequest('/items/'+id+'/confirm',{method:'POST',body:{item_name:document.getElementById('captureName').value,amount:Number(document.getElementById('captureAmount').value),purchase_date:document.getElementById('captureDate').value,category:document.getElementById('captureCategory').value,bank_account_id:Number(document.getElementById('captureBank').value) || null,card_id:Number(document.getElementById('captureCard').value) || null,confirm_expense:true}});
    closeModal(); await loadTransactionCapture();
  });
}
