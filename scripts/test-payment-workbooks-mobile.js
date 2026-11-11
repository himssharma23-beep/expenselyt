const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const mobile=path.resolve(__dirname,'../../ExpenseManager_mobile');
const babel=require(path.join(mobile,'node_modules/@babel/core'));
const M=require('../public/js/payment-manager-workbook-model');
test('native saved manager supports guests, different expense participants, accounts, rounding and persisted checklist',async()=>{
  const slots=[],effects=[],records=[],requests=[],alerts=[];let cursor=0,synced=0;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const respond=w=>({...clone(w),plan:M.calculate(w.document)});
  const save=async(url,body)=>{
    requests.push({url,body});const id=Number(url.match(/workbooks\/(\d+)/)?.[1]);let w=id?records.find(w=>w.id===id):{id:1,revision:0};if(!id)records.push(w);
    w.document=clone(body.document);w.revision++;w.posted=body.publish;w.synced=body.publish;return {success:true,workbook:respond(w)};
  };
  const context={React:{createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'Fragment'},
    useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},
    useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    useEffect:fn=>{const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(fn);}},
    useAuth:()=>({user:{id:1,currency_code:'INR'}}),StyleSheet:{create:v=>v},Platform:{OS:'android'},Alert:{alert:(...args)=>alerts.push(args)},M,
    formatLiveSplitMoney:v=>'Rs '+Number(v).toFixed(2),todayISO:()=> '2026-11-10',
    get:async url=>url.endsWith('payment-workbooks')?{success:true,workbooks:records.map(respond)}:{success:true,workbook:respond(records[0])},post:save,put:save,
    patch:async(url,body)=>{requests.push({url,body});const w=records[0];assert.equal(body.revision,w.revision);w.document.checklist[body.key]=body.paid;w.revision++;return {success:true,workbook:respond(w)};}
  };
  for(const name of ['ActivityIndicator','KeyboardAvoidingView','Modal','ScrollView','Text','TextInput','TouchableOpacity','View','Switch','SafeAreaView','NativeDateField','Ionicons'])context[name]=name;
  const source=fs.readFileSync(path.join(mobile,'src/components/PaymentWorkbooksModal.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
  vm.createContext(context);vm.runInContext(babel.transformSync(source,{plugins:[require.resolve(path.join(mobile,'node_modules/@babel/plugin-transform-react-jsx'))],configFile:false,babelrc:false}).code,context);
  const flatten=node=>!node||typeof node!=='object'?[]:typeof node.type==='function'?flatten(node.type(node.props)):[node,...(node.children||[]).flat(Infinity).flatMap(flatten)];
  const content=node=>(node.children||[]).flat(Infinity).map(c=>c&&typeof c==='object'?content(c):c||'').join('');
  const render=()=>{cursor=0;return flatten(context.PaymentWorkbooksModal({friends:[{id:2,name:'Deepak'}],banks:[{id:7,bank_name:'Bank'}],cards:[{id:8,card_name:'Card'}],onClose:()=>{},onSaved:()=>{synced++;}}));};
  const button=(text,index=0)=>render().filter(n=>n.type==='TouchableOpacity'&&content(n).trim()===text)[index];
  const field=(label,index=0)=>render().filter(n=>n.type==='TextInput'&&n.props.accessibilityLabel===label)[index];
  const checkbox=label=>render().find(n=>n.props.accessibilityRole==='checkbox'&&content(n)===label);
  render();effects.forEach(fn=>fn());await new Promise(r=>setImmediate(r));
  button('+ New split').props.onPress();field('Description').props.onChangeText('Mobile dinner');field('Guest name').props.onChangeText('Guest');button('Add guest').props.onPress();button('+ Deepak').props.onPress();
  button('+ Add expense').props.onPress();field('Expense name').props.onChangeText('Food');field('Amount').props.onChangeText('60');checkbox('Guest').props.onPress();button('Bank').props.onPress();button('Bank',1).props.onPress();
  // The first Bank press selects the source, the second selects the only account.
  button('+ Add expense').props.onPress();field('Expense name',1).props.onChangeText('Snacks');field('Amount',1).props.onChangeText('60');
  button('Review split').props.onPress();field('You final share').props.onChangeText('49');field('Deepak final share').props.onChangeText('49');
  assert.equal(button('Save & sync Live Split').props.disabled,true);
  const receivers=render().filter(n=>n.props.accessibilityRole==='checkbox'&&content(n)==='Receive difference');receivers[1].props.onPress();
  button('Distribute difference').props.onPress();assert.equal(button('Save & sync Live Split').props.disabled,false);
  render().find(n=>n.type==='Switch').props.onValueChange(true);
  await button('Save & sync Live Split').props.onPress();assert.equal(synced,1);assert.equal(records[0].document.people.length,3);
  assert.equal(records[0].document.expenses[0].participants.length,2);assert.equal(records[0].document.expenses[1].participants.length,3);
  assert.equal(records[0].document.expenses[0].payment_source,'bank');assert.equal(records[0].document.expenses[0].payment_account_id,'7');
  assert.equal(records[0].document.overrides[records[0].document.people[1].key],'22.00');assert.equal(records[0].document.finance.add_expense,true);
  await checkbox('Guest').props.onPress();assert.equal(M.calculate(records[0].document).paid_count,1);
  await button('Saved splits').props.onPress();
  const saved=render().find(n=>n.type==='TouchableOpacity'&&content(n).startsWith('Mobile dinner'));await saved.props.onPress();
  assert.equal(checkbox('Guest').props.accessibilityState.checked,true);
  assert.ok(!alerts.some(a=>/Could not/.test(a[0])));
});
