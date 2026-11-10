(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.emiFriendSplitModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const cents=value=>Math.round((Number(value)||0)*100);
  function breakdown(record,installments=record.installments||[]) {
    let amount=0,gst=0;
    if(installments.length) installments.forEach(row=>{
      const tax=cents(row.gst_amount);
      const components=Number(row.principal_component)>=0&&Number(row.interest_component)>=0;
      amount+=components?cents(row.principal_component)+cents(row.interest_component):Math.max(0,cents(row.emi_amount)-tax);
      gst+=tax;
    });
    else {amount=cents(record.total_amount || Number(record.principal)+Number(record.total_interest));gst=cents(record.total_gst);}
    const processing=cents(record.cc_processing_charge);
    const processingGst=Math.round(processing*(Number(record.cc_processing_gst_pct)||0)/100);
    const upfront=record.upfront_charge!=null?cents(record.upfront_charge):record.status==='saved'?Math.max(0,cents(record.grand_total)-amount-gst):0;
    const lines=[{label:'All installments (principal + interest)',amount:amount/100},{label:'GST on installment interest',amount:gst/100},{label:'Upfront charges',amount:upfront/100},{label:'Card processing fee',amount:processing/100},{label:'GST on processing fee',amount:processingGst/100}];
    return {lines,total:(amount+gst+processing+processingGst+upfront)/100,installment_count:installments.length||Number(record.tenure_months)||0};
  }
  function shares(total,people,mode='equal',values={}) {
    const target=cents(total);
    if(target<=0||!people.length)return {valid:false,error:'Select at least one friend and a positive EMI total.',shares:[]};
    if(!['equal','percent','parts','amount'].includes(mode))return {valid:false,error:'Choose a valid split mode.',shares:[]};
    const weights=people.map(person=>mode==='equal'?1:Number(values[person.key]));
    if(weights.some(value=>!Number.isFinite(value)||value<0)||mode==='parts'&&weights.some(value=>value<=0))return {valid:false,error:'Enter a valid value for every selected person.',shares:[]};
    const sum=weights.reduce((a,b)=>a+b,0);
    if(mode==='amount') {
      const amounts=weights.map(cents);
      if(amounts.reduce((a,b)=>a+b,0)!==target)return {valid:false,error:'Direct amounts must add up to the full total.',shares:[]};
      return {valid:true,shares:people.map((person,index)=>({...person,share:amounts[index]/100}))};
    }
    if(!Number.isFinite(sum)||sum<=0||mode==='percent'&&Math.abs(sum-100)>0.0001)return {valid:false,error:mode==='percent'?'Percentages must add up to 100%.':'Enter positive parts.',shares:[]};
    const raw=weights.map(weight=>target*weight/sum),amounts=raw.map(Math.floor);
    const order=raw.map((value,index)=>({index,remainder:value-amounts[index]})).sort((a,b)=>b.remainder-a.remainder||(people[a.index].key==='self'?-1:people[b.index].key==='self'?1:String(people[a.index].key).localeCompare(String(people[b.index].key),undefined,{numeric:true})));
    let remaining=target-amounts.reduce((a,b)=>a+b,0);
    for(let i=0;i<remaining;i++)amounts[order[i%order.length].index]++;
    return {valid:true,shares:people.map((person,index)=>({...person,share:amounts[index]/100}))};
  }
  function defaults(total,people,mode) {
    if(mode==='equal')return {};
    if(mode==='parts')return Object.fromEntries(people.map(person=>[person.key,'1']));
    const result=shares(mode==='percent'?100:total,people,'equal');
    return Object.fromEntries((result.shares||[]).map(person=>[person.key,String(person.share)]));
  }
  return {breakdown,shares,defaults};
});
