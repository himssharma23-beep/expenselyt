/* Saved multi-expense payment manager; calculations are shared with the server and native app. */
(function(){
  const M=()=>paymentManagerWorkbookModel;
  let state=null;
  const esc=v=>escHtml(String(v??''));
  const money=v=>formatLiveSplitMoney(Number(v)||0,state?.doc?.currency_code||window._currentUser?.currency_code||'INR');
  const apiCall=async(url,options)=>{const r=await api(url,options);if(!r?.success)throw Error(r?.error||'Could not load payment manager');return r;};
  const button=(text,handler,primary=false,disabled=false)=>`<button type="button" class="btn ${primary?'btn-p':'btn-s'} btn-sm" onclick="${handler}" ${disabled?'disabled':''}>${text}</button>`;
  const input=(value,handler,type='text',label='')=>`<input class="fi" type="${type}" ${type==='number'?'min="0" step="0.01"':''} value="${esc(value)}" aria-label="${esc(label)}" oninput="${handler}">`;
  const members=()=>state.doc.people;
  const plan=()=>M().calculate(state.doc);
  const changed=()=>state.record&&JSON.stringify({...state.doc,checklist:null})!==JSON.stringify({...state.record.document,checklist:null});
  const name=key=>members().find(p=>p.key===key)?.name||key;
  function modal(html,view='list'){
    const old=document.querySelector('#modalContent .modal-body'),scroll=state?.view===view?old?.scrollTop||0:0;
    window.__modalClassName='pm-workbook-modal';window.__modalOverlayClassName='pw-workbook-overlay';
    openModal('Payment manager',html);
    document.querySelector('#modalContent .modal-body').scrollTop=scroll;
    if(state)state.view=view;
  }
  window.openPaymentWorkbooks=async()=>{
    try{
      const [saved,friends,banks,cards]=await Promise.all([apiCall('/api/live-split/payment-workbooks'),api('/api/live-split/friends'),api('/api/banks'),api('/api/cc/cards')]);
      state={saved:saved.workbooks,friends:friends?.friends||[],banks:banks?.accounts||[],cards:cards?.cards||[],doc:null,record:null,tab:'details',busy:false,rounding:new Set(),remainder:new Set(),roundStep:'1'};
      list();
    }catch(e){toast(e.message,'error');}
  };
  function list(){
    modal(`<div class="pw-shell"><div class="pw-toolbar"><p>Create a split, choose who shares each expense, and keep a payment checklist.</p>${button('+ New split','pwNew()',true)}</div><div class="pw-list">${state.saved.length?state.saved.map(w=>`<button class="pw-saved" onclick="pwOpen(${w.id})"><span><b>${esc(w.document.title)}</b><small>${esc(w.document.date)} · ${w.document.people.length} members · ${w.plan.paid_count}/${w.document.people.length} paid</small><small>${w.posted?(w.synced?'Live Split updated':'Saved changes need syncing'):'Draft'}</small></span><strong>${formatLiveSplitMoney(w.plan.total,w.document.currency_code)}</strong></button>`).join(''):'<p>No saved splits yet.</p>'}</div></div>`);
  }
  window.pwNew=()=>{state.doc=M().fresh(typeof todayLocal==='function'?todayLocal():new Date().toISOString().slice(0,10),window._currentUser?.currency_code||'INR');state.doc.people[0].name=window._currentUser?.display_name||window._currentUser?.username||'You';state.record=null;state.tab='details';state.rounding=new Set();state.remainder=new Set();render();};
  window.pwOpen=async id=>{try{const r=await apiCall('/api/live-split/payment-workbooks/'+id);state.record=r.workbook;state.doc=structuredClone(r.workbook.document);state.tab='payments';state.rounding=new Set();state.remainder=new Set();render();}catch(e){toast(e.message,'error');}};
  window.pwList=async()=>{if(state.busy)return;try{state.saved=(await apiCall('/api/live-split/payment-workbooks')).workbooks;list();}catch(e){toast(e.message,'error');}};
  window.pwTab=tab=>{state.tab=tab;render();};
  window.pwField=(field,value)=>{state.doc[field]=value;refresh();};
  window.pwAddFriend=id=>{
    const friend=state.friends.find(f=>Number(f.id)===Number(id));if(!friend)return;
    if(members().some(p=>Number(p.friend_id)===Number(id)))return;
    members().push({key:'friend:'+friend.id,friend_id:Number(friend.id),name:friend.name,post_to_live_split:true});render();
  };
  window.pwGuest=()=>{const el=document.getElementById('pwGuestName'),n=el.value.trim();if(!n)return;members().push({key:'guest:'+M().key(),name:n,post_to_live_split:false});render();};
  window.pwMember=(key,field,value)=>{const p=members().find(p=>p.key===key);if(p)p[field]=value;refresh();};
  window.pwRemoveMember=key=>{
    state.doc.people=members().filter(p=>p.key!==key);
    state.doc.expenses.forEach(e=>{e.participants=e.participants.filter(k=>k!==key);if(e.paid_by===key){e.paid_by='';e.payment_source='none';e.payment_account_id=null;}});
    delete state.doc.overrides[key];delete state.doc.checklist[key];state.rounding.delete(key);state.remainder.delete(key);
    if(state.doc.manager_key===key)state.doc.manager_key=members()[0]?.key||'';render();
  };
  window.pwExpenseAdd=()=>{state.doc.expenses.push({key:M().key(),title:'',amount:'',paid_by:members()[0]?.key||'',participants:members().map(p=>p.key),mode:'equal',values:{},payment_source:'none',payment_account_id:null});render();};
  window.pwExpense=(key,field,value,repaint=false)=>{
    const e=state.doc.expenses.find(e=>e.key===key);e[field]=value;
    if(field==='paid_by'&&value!=='self'){e.payment_source='none';e.payment_account_id=null;}
    if(field==='payment_source')e.payment_account_id=null;
    if(field==='mode')defaults(e);
    repaint?render():refresh();
  };
  function defaults(e){
    const selected=members().filter(p=>e.participants.includes(p.key));e.values={};
    if(e.mode==='equal'||!selected.length)return;
    if(['parts','fraction'].includes(e.mode)){selected.forEach(p=>e.values[p.key]=e.mode==='parts'?'1':'1/'+selected.length);return;}
    let amounts;try{amounts=M().allocate(e.mode==='percent'?10000:M().money(e.amount||0),selected);}catch{return;}
    selected.forEach(p=>e.values[p.key]=String(amounts[p.key]/100));
  }
  window.pwParticipant=(key,person)=>{const e=state.doc.expenses.find(e=>e.key===key);e.participants=e.participants.includes(person)?e.participants.filter(k=>k!==person):[...e.participants,person];defaults(e);render();};
  window.pwValue=(expense,key,value)=>{state.doc.expenses.find(e=>e.key===expense).values[key]=value;refresh();};
  window.pwExpenseRemove=key=>{state.doc.expenses=state.doc.expenses.filter(e=>e.key!==key);render();};
  window.pwOverride=(key,value)=>{state.doc.overrides[key]=value;refresh();};
  window.pwSelect=(kind,key,checked)=>{checked?state[kind].add(key):state[kind].delete(key);};
  window.pwRound=()=>{try{const step=M().money(state.roundStep);if(!step)throw Error('Enter a positive rounding step.');if(!state.rounding.size)throw Error('Select members to round.');for(const p of plan().people.filter(p=>state.rounding.has(p.key)))state.doc.overrides[p.key]=(Math.round(Math.round(p.share*100)/step)*step/100).toFixed(2);render();}catch(e){toast(e.message,'error');}};
  window.pwDistribute=()=>{try{state.doc.overrides=M().distribute(state.doc,[...state.remainder]);render();}catch(e){toast(e.message,'error');}};
  window.pwResetShares=()=>{state.doc.overrides={};render();};
  window.pwSave=async publish=>{
    if(state.busy)return;state.busy=true;render();
    try{
      const url='/api/live-split/payment-workbooks'+(state.record?'/'+state.record.id:'');
      const result=await apiCall(url,{method:state.record?'PUT':'POST',body:{revision:state.record?.revision,document:state.doc,publish}});
      state.record=result.workbook;state.doc=structuredClone(result.workbook.document);state.tab=publish?'payments':'review';
      if(publish&&typeof window.loadLiveSplit==='function')await window.loadLiveSplit();
      toast(publish?'Split saved and Live Split updated':'Draft saved','success');
    }catch(e){toast(e.message,'error');}finally{state.busy=false;render();}
  };
  window.pwChecklist=async(key,paid,reset=false)=>{
    if(state.busy||!state.record||changed()||!plan().valid)return;
    if(reset&&!await confirmDialog('Reset the paid checklist for this split?'))return;
    state.busy=true;render();
    try{
      const r=await apiCall('/api/live-split/payment-workbooks/'+state.record.id+'/checklist',{method:'PATCH',body:{key,paid,reset,revision:state.record.revision}});
      state.record=r.workbook;state.doc.checklist={...r.workbook.document.checklist};
    }catch(e){toast(e.message,'error');}finally{state.busy=false;render();}
  };
  function expenseHtml(e,index){
    const chosen=members().filter(p=>e.participants.includes(p.key)),accounts=e.payment_source==='bank'?state.banks:state.cards;
    return `<section class="pw-panel"><div class="pw-toolbar"><b>Expense ${index+1}</b>${button('Remove',`pwExpenseRemove('${e.key}')`)}</div><div class="pw-grid"><label>Expense name${input(e.title,`pwExpense('${e.key}','title',this.value)`,'text','Expense name')}</label><label>Amount${input(e.amount,`pwExpense('${e.key}','amount',this.value)`,'number','Expense amount')}</label><label>Paid by<select class="fi" onchange="pwExpense('${e.key}','paid_by',this.value,true)"><option value="">Choose payer</option>${members().map(p=>`<option value="${p.key}" ${e.paid_by===p.key?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>Split type<select class="fi" onchange="pwExpense('${e.key}','mode',this.value,true)">${[['equal','Equal'],['percent','Percentage'],['parts','Parts'],['amount','Direct amounts'],['fraction','Fractions']].map(([v,n])=>`<option value="${v}" ${e.mode===v?'selected':''}>${n}</option>`).join('')}</select></label></div><p>Participants: ${chosen.length} of ${members().length}</p><div class="pw-chips">${members().map(p=>`<label><input type="checkbox" ${e.participants.includes(p.key)?'checked':''} onchange="pwParticipant('${e.key}','${p.key}')">${esc(p.name)}</label>`).join('')}</div>${e.mode!=='equal'?`<div class="pw-grid">${chosen.map(p=>`<label>${esc(p.name)}${input(e.values?.[p.key]??'',`pwValue('${e.key}','${p.key}',this.value)`,e.mode==='fraction'?'text':'number',p.name+' split value')}</label>`).join('')}</div>`:''}${e.paid_by==='self'?`<div class="pw-grid"><label>Your payment source<select class="fi" onchange="pwExpense('${e.key}','payment_source',this.value,true)">${[['none','Do not record payment'],['bank','Bank account'],['card','Credit card']].map(([v,n])=>`<option value="${v}" ${e.payment_source===v?'selected':''}>${n}</option>`).join('')}</select></label>${e.payment_source!=='none'?`<label>Account<select class="fi" onchange="pwExpense('${e.key}','payment_account_id',this.value)"><option value="">Choose account</option>${accounts.map(a=>`<option value="${a.id}" ${Number(e.payment_account_id)===Number(a.id)?'selected':''}>${esc(a.card_name||a.bank_name)} ${esc(a.account_name||a.last4||'')}</option>`).join('')}</select></label>`:''}</div>`:''}</section>`;
  }
  function details(){return `<div class="pw-grid"><label>Description${input(state.doc.title,"pwField('title',this.value)",'text','Split description')}</label><label>Date<input class="fi" type="date" value="${esc(state.doc.date)}" onchange="pwField('date',this.value)"></label></div><section class="pw-panel"><h4>Members</h4><div class="pw-members">${members().map(p=>`<div><b>${esc(p.name)}</b>${p.key==='self'?'<small>You</small>':`<label><input type="checkbox" ${p.post_to_live_split?'checked':''} onchange="pwMember('${p.key}','post_to_live_split',this.checked)">Add to Live Split</label>${button('Remove',`pwRemoveMember('${p.key}')`)}`}</div>`).join('')}</div><div class="pw-grid"><label>Add existing friend<select class="fi" onchange="pwAddFriend(this.value)"><option value="">Choose a friend</option>${state.friends.filter(f=>!members().some(p=>Number(p.friend_id)===Number(f.id))&&Number(f.linked_user_id)!==Number(window._currentUser?.id)).map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></label><label>Add guest<div class="pw-inline"><input class="fi" id="pwGuestName" placeholder="Guest name" maxlength="120" onkeydown="if(event.key==='Enter'){event.preventDefault();pwGuest()}">${button('Add','pwGuest()')}</div></label></div><p>Guests can join without an app account. Select “Add to Live Split” to create their friend entry when you sync.</p><label>Payment manager<select class="fi" onchange="pwField('manager_key',this.value)">${members().map(p=>`<option value="${p.key}" ${state.doc.manager_key===p.key?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label></section><div class="pw-toolbar"><h4>Expenses</h4>${button('+ Add expense','pwExpenseAdd()',true)}</div>${state.doc.expenses.map(expenseHtml).join('')}`;}
  function review(){
    const p=plan();
    return `<p>Already paid is reimbursed by the manager; each member contributes their final share. Only transfers between selected Live Split members are posted.</p><div class="pw-review">${p.people.map(person=>`<section class="pw-panel"><div class="pw-toolbar"><b>${esc(person.name)}</b><strong data-pw-balance="${person.key}"></strong></div><p>Already paid ${money(person.paid)} · Calculated share ${money(person.base_share)}</p><label>Final share (optional override)${input(state.doc.overrides[person.key]??'',`pwOverride('${person.key}',this.value)`,'number',person.name+' final share')}</label><div class="pw-chips"><label><input type="checkbox" ${state.rounding.has(person.key)?'checked':''} onchange="pwSelect('rounding','${person.key}',this.checked)">Round this share</label><label><input type="checkbox" ${state.remainder.has(person.key)?'checked':''} onchange="pwSelect('remainder','${person.key}',this.checked)">Receive difference</label></div></section>`).join('')}</div><div class="pw-toolbar"><label>Round to${input(state.roundStep,"pwRoundStep(this.value)",'number','Round to')}</label>${button('Round selected','pwRound()')}${button('Distribute difference','pwDistribute()')}${button('Reset shares','pwResetShares()')}</div><label class="pw-check"><input type="checkbox" ${state.doc.finance.add_expense?'checked':''} onchange="pwFinance(this.checked)">Add my final share to Expenses</label><p>Your bank/card records only the expense amounts you paid from the accounts chosen above. Drafts do not post payments.</p><h4>Transfers through ${esc(name(state.doc.manager_key))}</h4><div id="pwTransfers"></div>`;
  }
  window.pwRoundStep=value=>{state.roundStep=value;};
  window.pwFinance=value=>{state.doc.finance.add_expense=value;refresh();};
  function payments(){
    const p=plan();return `<div class="pw-toolbar"><h4>Payment progress</h4><b>${p.paid_count}/${members().length} paid</b></div><progress value="${p.paid_count}" max="${members().length||1}"></progress><h2>${money(p.collected)}</h2><p>Amount marked collected · pending ${money(p.pending)}</p><p>The checklist tracks collection progress. Marking paid does not create a bank transfer or Live Split settlement.</p>${!state.record||changed()?'<p>Save this split before updating the checklist.</p>':!state.record.synced&&state.record.posted?'<p class="pw-warning">Saved changes have not been synced to Live Split.</p>':''}<div class="pw-payments">${p.people.map(person=>`<label class="pw-payment"><input type="checkbox" ${state.doc.checklist[person.key]?'checked':''} ${!state.record||state.busy||changed()||!p.valid?'disabled':''} onchange="pwChecklist('${person.key}',this.checked)"><span><b>${esc(person.name)}</b><small>Paid upfront ${money(person.paid)} · ${person.balance<0?'Initial net owed ':person.balance>0?'Initial net credit ':'Balanced '}${money(Math.abs(person.balance))}</small></span><strong>${money(person.share)}</strong><small>${state.doc.checklist[person.key]?'Paid':'Pending'}</small></label>`).join('')}</div>${button('Reset checklist',"pwChecklist('',false,true)",false,!state.record||state.busy||changed())}`;
  }
  function render(){
    modal(`<section class="pw-shell"><div class="pw-toolbar">${button('Saved splits','pwList()')}<small>${state.record?'Saved · revision '+state.record.revision:'New split'}</small></div><nav class="pw-tabs">${[['details','1 Members & expenses'],['review','2 Review & rounding'],['payments','3 Payment checklist']].map(([k,n])=>`<button class="${state.tab===k?'active':''}" onclick="pwTab('${k}')">${n}</button>`).join('')}</nav><fieldset ${state.busy?'disabled':''} class="pw-body">${state.tab==='details'?details():state.tab==='review'?review():payments()}</fieldset><footer class="pw-footer"><div id="pwVerification" role="status"></div><div class="pw-toolbar">${button(state.busy?'Saving...':'Save draft','pwSave(false)',false,state.busy)}${state.tab==='details'?button('Review split',"pwTab('review')",true,state.busy):button(state.busy?'Saving...':state.record?.posted?'Save & update Live Split':'Save & sync Live Split','pwSave(true)',true,state.busy||!plan().valid)}</div></footer></section>`,(state.record?.id||'new')+':'+state.tab);
    refresh();
  }
  function refresh(){
    if(!state?.doc)return;const p=plan(),el=document.getElementById('pwVerification');
    if(el){el.textContent=`Expenses ${money(p.total)} · Final shares ${money(p.allocated)} · Difference ${money(p.difference)}${p.valid?' · Verified':p.errors[0]?' · '+p.errors[0]:''}`;el.className=p.valid?'pw-ok':'pw-warning';}
    document.querySelectorAll('[data-pw-balance]').forEach(el=>{const person=p.people.find(p=>p.key===el.dataset.pwBalance);el.textContent=person?(person.balance<0?'Owes ':person.balance>0?'Gets ':'Balanced ')+money(Math.abs(person.balance)):'';});
    const transfers=document.getElementById('pwTransfers');if(transfers)transfers.innerHTML=p.valid?p.entries.map(e=>`<div class="pw-transfer"><span>${esc(name(e.from))} → ${esc(name(e.to))}<small>${e.kind==='collection'?'Contribution':'Reimbursement'}</small></span><b>${money(e.amount)}</b></div>`).join(''):'<p>Verify the total to preview transfers.</p>';
    document.querySelectorAll('button[onclick="pwSave(true)"]').forEach(b=>b.disabled=state.busy||!p.valid);
  }
})();
