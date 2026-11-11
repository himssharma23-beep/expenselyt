(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.paymentManagerWorkbookModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const key=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
  function money(value){
    const n=Number(value),c=Math.round(n*100);
    if(!Number.isFinite(n)||n<0||!Number.isSafeInteger(c)||c>100000000000||Math.abs(n*100-c)>.00001)throw Error('Amounts must be positive numbers with at most two decimal places.');
    return c;
  }
  function allocate(total,people,mode='equal',values={}){
    if(!people.length)throw Error('Select participants for each expense.');
    if(!['equal','percent','parts','amount','fraction'].includes(mode))throw Error('Choose a valid split mode.');
    const weights=people.map(p=>{
      if(mode==='equal')return 1;
      let v=values[p.key];
      if(v==null||String(v).trim()==='')throw Error('Enter a split value for every participant.');
      if(mode==='fraction'&&String(v).includes('/')){const a=String(v).split('/');v=a.length===2&&Number(a[1])>0?Number(a[0])/Number(a[1]):NaN;}
      v=mode==='amount'?money(v):Number(v);
      if(!Number.isFinite(v)||v<0||v>100000000000)throw Error('Enter valid non-negative split values.');
      return v;
    });
    const sum=weights.reduce((a,b)=>a+b,0);
    if(mode==='amount'&&sum!==total)throw Error('Direct amounts must equal this expense total.');
    if(mode==='percent'&&Math.abs(sum-100)>.000001)throw Error('Percentages must total 100%.');
    if(mode==='fraction'&&Math.abs(sum-1)>.000001)throw Error('Fractions must total 1.');
    if(sum<=0||!Number.isFinite(sum))throw Error('Enter a positive split total.');
    const exact=weights.map(v=>mode==='amount'?v:total*v/sum),shares=exact.map(Math.floor);
    const order=exact.map((v,i)=>({i,remainder:v-shares[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
    const rest=total-shares.reduce((a,b)=>a+b,0);
    for(let i=0;i<rest;i++)shares[order[i%order.length].i]++;
    return Object.fromEntries(people.map((p,i)=>[p.key,shares[i]]));
  }
  function calculate(doc){
    const errors=[],people=(doc.people||[]).map(p=>({...p,paid:0,base_share:0,share:0,balance:0})),expenses=[];
    let total=0;
    try{
      if(people.length<2||people.length>50)throw Error('Choose between 2 and 50 members.');
      if(new Set(people.map(p=>p.key)).size!==people.length)throw Error('Members must be distinct.');
      if(!people.some(p=>p.key===doc.manager_key))throw Error('Choose a payment manager.');
      if(!(doc.expenses||[]).length||(doc.expenses||[]).length>200)throw Error('Add between 1 and 200 expenses.');
      const expenseKeys=new Set();
      for(const e of doc.expenses){
        if(expenseKeys.has(e.key))throw Error('Expense rows must be distinct.');expenseKeys.add(e.key);
        const amount=money(e.amount);
        if(!amount)throw Error('Enter a positive amount for each expense.');
        const payer=people.find(p=>p.key===e.paid_by);
        if(!payer)throw Error('Choose who paid for each expense.');
        const ids=e.participants||[];
        if(new Set(ids).size!==ids.length||ids.some(id=>!people.some(p=>p.key===id)))throw Error('Choose valid expense participants.');
        const participants=people.filter(p=>ids.includes(p.key));
        const shares=allocate(amount,participants,e.mode||'equal',e.values||{});
        payer.paid+=amount;total+=amount;
        participants.forEach(p=>p.base_share+=shares[p.key]);
        expenses.push({...e,amount:amount/100,shares:Object.fromEntries(Object.entries(shares).map(([k,v])=>[k,v/100]))});
      }
      if(!Number.isSafeInteger(total)||total>100000000000)throw Error('Total is too large.');
      people.forEach(p=>{p.share=doc.overrides?.[p.key]!=null&&String(doc.overrides[p.key]).trim()!==''?money(doc.overrides[p.key]):p.base_share;});
    }catch(error){errors.push(error.message);}
    const allocated=people.reduce((sum,p)=>sum+p.share,0),difference=total-allocated;
    if(!errors.length&&difference!==0)errors.push('Final shares must equal the expense total. Distribute the remaining difference.');
    const entries=[];
    people.forEach(p=>{
      if(p.key!==doc.manager_key){
        if(p.share>0)entries.push({key:'collection:'+p.key,from:p.key,to:doc.manager_key,amount:p.share/100,kind:'collection'});
        if(p.paid>0)entries.push({key:'reimbursement:'+p.key,from:doc.manager_key,to:p.key,amount:p.paid/100,kind:'reimbursement'});
      }
      p.balance=(p.paid-p.share)/100;p.paid/=100;p.base_share/=100;p.share/=100;
    });
    const collected=people.filter(p=>doc.checklist?.[p.key]===true).reduce((sum,p)=>sum+Math.round(p.share*100),0);
    return {valid:!errors.length,errors,total:total/100,allocated:allocated/100,difference:difference/100,people,expenses,entries,collected:collected/100,pending:(total-collected)/100,paid_count:people.filter(p=>doc.checklist?.[p.key]===true).length};
  }
  function distribute(doc,keys){
    const plan=calculate(doc);
    if(plan.errors.length&&!(plan.errors.length===1&&plan.errors[0].startsWith('Final shares')))throw Error(plan.errors[0]);
    const chosen=plan.people.filter(p=>keys.includes(p.key));
    if(!chosen.length)throw Error('Choose members to receive the rounding difference.');
    const difference=Math.round(plan.difference*100),base=Math.trunc(difference/chosen.length),rest=difference-base*chosen.length;
    const overrides={...(doc.overrides||{})};
    chosen.forEach((p,i)=>{const n=Math.round(p.share*100)+base+(i<Math.abs(rest)?Math.sign(rest):0);if(n<0)throw Error('This adjustment would make a share negative.');overrides[p.key]=(n/100).toFixed(2);});
    return overrides;
  }
  function fresh(date,currency='INR'){return {title:'',date,currency_code:currency,manager_key:'self',people:[{key:'self',name:'You',post_to_live_split:true}],expenses:[],overrides:{},checklist:{},finance:{add_expense:false,source:'none',account_id:''},client_key:key()};}
  return {key,money,allocate,calculate,distribute,fresh};
});
