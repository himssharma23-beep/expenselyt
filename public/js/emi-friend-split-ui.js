let _emiFriendSplit = null;
async function openEmiFriendSplit(id) {
  try {
    const [cost,list]=await Promise.all([api(`/api/emi/records/${id}/friend-split`),api('/api/live-split/friends')]);
    if(!cost?.success||list?.error)throw new Error(cost?.error||list?.error||'Could not load EMI split');
    _emiFriendSplit={quote:cost.quote,friends:list.friends||[],selected:[],includeSelf:true,mode:'equal',values:{},date:typeof todayLocal==='function'?todayLocal():new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0'),busy:false};
    renderEmiFriendSplit();
  } catch(error){toast(error.message,'error');}
}
function emiFriendSplitPeople(){
  const form=_emiFriendSplit;
  return [...(form.includeSelf?[{key:'self',name:'You'}]:[]),...form.friends.filter(friend=>form.selected.includes(Number(friend.id))).map(friend=>({key:String(friend.id),name:friend.linked_user_display_name||friend.name}))];
}
function emiFriendSplitSelection(id,checked){
  const form=_emiFriendSplit;
  if(id==='self')form.includeSelf=checked;
  else form.selected=checked?[...form.selected,Number(id)]:form.selected.filter(value=>value!==Number(id));
  form.values=emiFriendSplitModel.defaults(form.quote.total,emiFriendSplitPeople(),form.mode);
  renderEmiFriendSplit();
}
function emiFriendSplitMode(mode){
  _emiFriendSplit.mode=mode;
  _emiFriendSplit.values=emiFriendSplitModel.defaults(_emiFriendSplit.quote.total,emiFriendSplitPeople(),mode);
  renderEmiFriendSplit();
}
function emiFriendSplitValue(key,value){_emiFriendSplit.values[key]=value;refreshEmiFriendSplit();}
function refreshEmiFriendSplit(){
  const form=_emiFriendSplit,preview=emiFriendSplitModel.shares(form.quote.total,emiFriendSplitPeople(),form.mode,form.values);
  document.querySelectorAll('[data-emi-share]').forEach(el=>{const person=preview.shares.find(row=>row.key===el.dataset.emiShare);el.textContent=person?formatLiveSplitMoney(person.share,form.quote.currency_code):'—';});
  document.getElementById('emiFriendSplitError').textContent=preview.valid?'Paid by you. Your share is added to Expenses; friends\' shares go to Live Split.':preview.error;
  document.getElementById('emiFriendSplitSave').disabled=form.busy||!preview.valid||!form.selected.length;
}
function renderEmiFriendSplit(){
  const form=_emiFriendSplit,q=form.quote,money=value=>formatLiveSplitMoney(value,q.currency_code),people=emiFriendSplitPeople();
  openModal('Split EMI with friends',`<div style="display:grid;gap:14px">
    <div class="card" style="padding:14px;background:var(--em-xl)"><b>${escHtml(q.name)}</b><p style="font-size:12px;margin:5px 0 10px">All ${q.installment_count} installments, including paid and unpaid amounts.</p>${q.lines.filter(line=>line.amount!==0).map(line=>`<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;margin-top:7px"><span>${escHtml(line.label)}</span><b>${money(line.amount)}</b></div>`).join('')}<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border);padding-top:10px;margin-top:10px"><b>Full total</b><b>${money(q.total)}</b></div></div>
    ${q.group_id?`<p>This EMI has already been split. Edit or settle its existing entry in Live Split.</p>${q.my_share>0?`<p>Your share: <b>${money(q.my_share)}</b>${q.expense_added?' - added to Expenses.':''}</p>${!q.expense_added?'<button class="btn btn-p" id="emiAddOwnShare" onclick="addEmiOwnShareToExpenses()">Add my share to Expenses</button>':''}`:''}<button class="btn btn-p" onclick="closeModal();switchTab('livesplit')">Open Live Split</button>`:`
    <label class="fl">Split date<input class="fi" type="date" value="${escHtml(form.date)}" onchange="_emiFriendSplit.date=this.value"></label>
    <label class="fc"><input type="checkbox" ${form.includeSelf?'checked':''} onchange="emiFriendSplitSelection('self',this.checked)">Include my share</label>
    <div><b style="font-size:13px">Choose friends</b><div style="max-height:180px;overflow:auto;display:grid;gap:9px;margin-top:10px">${form.friends.filter(friend=>Number(friend.linked_user_id)!==Number(window._currentUser?.id)).map(friend=>`<label class="fc"><input type="checkbox" ${form.selected.includes(Number(friend.id))?'checked':''} onchange="emiFriendSplitSelection(${Number(friend.id)},this.checked)">${escHtml(friend.linked_user_display_name||friend.name)}</label>`).join('')||'<p>Add friends in Live Split first.</p>'}</div></div>
    <div class="chip-group">${[['equal','Equal'],['percent','Percentage'],['parts','Parts'],['amount','Direct']].map(([key,label])=>`<button class="chip ${form.mode===key?'active':''}" onclick="emiFriendSplitMode('${key}')">${label}</button>`).join('')}</div>
    <div style="display:grid;gap:9px">${people.map(person=>`<div style="display:grid;grid-template-columns:minmax(0,1fr) 90px 100px;gap:8px;align-items:center"><span>${escHtml(person.name)}</span>${form.mode==='equal'?'<small>Equal</small>':`<input class="fi" type="number" min="0" step="0.01" aria-label="${escHtml(person.name)} split value" value="${escHtml(form.values[person.key]??'')}" oninput="emiFriendSplitValue('${person.key}',this.value)">`}<b style="text-align:right;font-size:12px" data-emi-share="${person.key}"></b></div>`).join('')}</div>
    <p id="emiFriendSplitError" style="font-size:12px;color:var(--t2)"></p><button class="btn btn-p" id="emiFriendSplitSave" onclick="saveEmiFriendSplit()">${form.busy?'Saving...':'Create split'}</button>`}
    <button class="btn btn-s" onclick="closeModal()">Close</button></div>`);
  if(!q.group_id)refreshEmiFriendSplit();
}
async function saveEmiFriendSplit(){
  const form=_emiFriendSplit;
  if(!form||form.busy)return;
  form.busy=true;refreshEmiFriendSplit();
  try{
    const result=await api(`/api/emi/records/${form.quote.emi_id}/friend-split`,{method:'POST',body:{expected_total:form.quote.total,friend_ids:form.selected,include_self:form.includeSelf,mode:form.mode,values:form.values,date:form.date}});
    if(!result?.success)throw new Error(result?.error||'Could not create split');
    Object.assign(form.quote,{group_id:result.group_id,my_share:result.my_share,expense_added:result.expense_added});renderEmiFriendSplit();toast('EMI split added to Live Split','success');
  }catch(error){toast(error.message,'error');}finally{form.busy=false;if(!form.quote.group_id)refreshEmiFriendSplit();}
}

async function addEmiOwnShareToExpenses(){
  const form=_emiFriendSplit;
  if(!form||form.busy||!form.quote.group_id)return;
  form.busy=true;
  const button=document.getElementById('emiAddOwnShare');if(button)button.disabled=true;
  try{
    const result=await api('/api/live-split/groups/'+form.quote.group_id+'/add-to-expense',{method:'POST',body:{}});
    if(!result?.success)throw new Error(result?.error||'Could not add your share');
    form.quote.expense_added=true;renderEmiFriendSplit();toast('Your EMI share was added to Expenses','success');
  }catch(error){toast(error.message,'error');if(button)button.disabled=false;}finally{form.busy=false;}
}
