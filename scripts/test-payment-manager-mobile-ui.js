const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const mobile=path.resolve(__dirname,'../../ExpenseManager_mobile');
const babel=require(path.join(mobile,'node_modules/@babel/core'));
const {buildPaymentManagerPlan}=require('../utils/payment-manager-plan');
test('native payment manager keeps inputs while switching details and review, with fraction shares',async()=>{
  const slots=[];let cursor=0;const requests=[];
  const context={React:{createElement:(type,props,...children)=>({type,props:props||{},children}),Fragment:'Fragment'},
    useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef:initial=>{const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
    StyleSheet:{create:value=>value},Platform:{OS:'android'},Alert:{alert:(title,message)=>{throw Error(message);}},
    fmtCur:value=>Number(value).toFixed(2),todayISO:()=> '2026-10-09',
    post:async(url,body)=>{requests.push(body);const plan=buildPaymentManagerPlan(body.people.map(person=>({...person,name:person.key==='self'?'A':'B'})),body.manager_key,body.split_mode);plan.finance={source:'none'};return {success:true,plan};}
  };
  for(const name of ['KeyboardAvoidingView','Modal','ScrollView','Text','TextInput','TouchableOpacity','View','Switch','SafeAreaView','NativeDateField','Ionicons']) context[name]=name;
  const source=fs.readFileSync(path.join(mobile,'src/components/PaymentManagerModal.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default function','function');
  vm.createContext(context);vm.runInContext(babel.transformSync(source,{plugins:[require.resolve(path.join(mobile,'node_modules/@babel/plugin-transform-react-jsx'))],configFile:false,babelrc:false}).code,context);
  const flatten=node=>!node||typeof node!=='object'?[]:[node,...(node.children||[]).flat(Infinity).flatMap(flatten)];
  const content=node=>(node.children||[]).flat(Infinity).map(child=>typeof child==='object'&&child?content(child):child||'').join('');
  const render=()=>{cursor=0;return flatten(context.PaymentManagerModal({friends:[{id:2,name:'B'}],banks:[{id:7,bank_name:'Bank'}],cards:[{id:8,card_name:'Card',last4:'1234'}],onClose:()=>{},onSaved:()=>{}}));};
  let nodes=render();nodes.find(node=>node.props.accessibilityLabel==='Add B').props.onPress();
  nodes=render();nodes.find(node=>node.props.accessibilityLabel==='Amount paid by You').props.onChangeText('100');
  nodes=render();nodes.find(node=>node.props.accessibilityRole==='radio'&&content(node)==='Fraction').props.onPress();
  nodes=render();nodes.find(node=>node.props.accessibilityLabel==='Share for You').props.onChangeText('1/2');
  nodes=render();nodes.find(node=>node.props.accessibilityLabel==='Share for B').props.onChangeText('1/2');
  nodes=render();const review=nodes.find(node=>node.type==='TouchableOpacity'&&content(node)==='Review split');assert.equal(review.props.disabled,false);
  await review.props.onPress();nodes=render();assert.ok(nodes.some(node=>content(node)==='Will be posted to friend transactions'));
  assert.equal(requests[0].split_mode,'fraction');
  nodes.find(node=>node.props.accessibilityLabel==='Edit split type').props.onPress();nodes=render();
  assert.equal(nodes.find(node=>node.props.accessibilityLabel==='Amount paid by You').props.value,'100');
  assert.equal(nodes.find(node=>node.props.accessibilityLabel==='Share for You').props.value,'1/2');
  nodes.find(node=>node.type==='TouchableOpacity'&&content(node)==='Bank').props.onPress();nodes=render();
  nodes.find(node=>node.props.accessibilityLabel==='Select bank account').props.onPress();nodes=render();
  nodes.find(node=>node.props.accessibilityRole==='radio'&&content(node).trim()==='Bank').props.onPress();nodes=render();
  assert.ok(content(nodes.find(node=>node.props.accessibilityLabel==='Select bank account')).includes('Bank'));
  nodes.find(node=>node.type==='TouchableOpacity'&&content(node)==='Credit card').props.onPress();nodes=render();
  nodes.find(node=>node.props.accessibilityLabel==='Select credit card').props.onPress();nodes=render();
  nodes.find(node=>node.props.accessibilityRole==='radio'&&content(node).includes('1234')).props.onPress();nodes=render();
  assert.ok(content(nodes.find(node=>node.props.accessibilityLabel==='Select credit card')).includes('1234'));

});
