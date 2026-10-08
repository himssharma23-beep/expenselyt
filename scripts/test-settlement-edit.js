const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const mobileRoot = path.resolve(__dirname, '../../ExpenseManager_mobile');
const parser = require(path.join(mobileRoot, 'node_modules/@babel/parser'));
for (const platform of ['web', 'mobile']) {
  const source = fs.readFileSync(platform === 'web' ? path.join(__dirname, '../public/js/live-split.js') : path.join(mobileRoot, 'src/screens/LiveSplitScreen.js'), 'utf8');
  const functions = {};
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration') functions[node.id.name] = source.slice(node.start, node.end);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
  }
  walk(parser.parse(source, {sourceType:'unambiguous', plugins:['jsx']}));
  for (const paidBy of ['Harsh', 'You']) for (const amount of [1930, 2100]) {
    test(`${platform}: settlement paid by ${paidBy}, saved amount ${amount}`, async () => {
      let payload;
      const fail = message => { throw Error(message); };
      const context = vm.createContext({
        r2:v=>Math.round(Number(v)*100)/100, n:Number,
        toLocalIsoDate:v=>v, todayLocalIso:()=> '2026-10-08', todayISO:()=> '2026-10-08',
        editPersonIdentity:person=>person.key,
        state:{},
        computeShares:()=>fail('Settlement must not use expense share calculations'),
        renderExpenseEditorModal:()=>{}, loadLiveSplit:async()=>{}, reopenExpenseDetails:async()=>{},
        api:async(url, options)=>{payload=options.body;return {success:true};},
        toast:(message,type)=>{if(type!=='success') fail(message);},
        Alert:{alert:(title,message)=>{if(title!=='Updated') fail(message);}},
        setEditExpense:()=>{}, put:async(url,body)=>{payload=body;},get:async()=>({}),load:async()=>{},restoreEditReturnView:()=>{},
      });
      for (const name of ['inferEditSplitMode','buildEditSplitValuesForMode','createExpenseEditorState','settlementEditSplits','saveEditedExpense']) vm.runInContext(functions[name],context);
      const group={id:1,user_id:7,owner_name:'Me',total_amount:1930,paid_by:paidBy,split_mode:'settlement',details:'Settlement',divide_date:'2026-10-08',splits:[{friend_id:2,friend_name:'Harsh',share_amount:1930}]};
      const form=context.createExpenseEditorState(group,7);
      assert.equal(form.isSettlement,true);
      if(platform==='web') {
        form.total_amount=amount;context.state.editExpense=form;
        context.peopleForEditExpense=context.editPayerPeople=()=>[{key:'owner',name:'Me'},{key:'2',friend_id:2,name:'Harsh'}];
      } else {
        form.amount=String(amount);context.editExpense=form;context.editPayerPeople=form.people;
        context.editPreview={valid:false,shares:[]};
      }
      if (platform === 'web') {
        let html;
        context.escHtml = value => String(value);
        context.openModal = (title, body) => { html = body; };
        vm.runInContext(functions.renderSettlementEditor, context);
        context.renderSettlementEditor(form);
        assert.ok(html.includes(`Paid to: <strong>${paidBy === 'You' ? 'Harsh' : 'Me'}</strong>`));
        assert.ok(!html.includes('Split mode'));
      }
      await context.saveEditedExpense();
      assert.equal(payload.split_mode,'settlement');
      assert.equal(payload.total_amount,amount);
      assert.equal(payload.paid_by,paidBy==='You'?'Me':'Harsh');
      assert.equal(payload.splits.length,1);
      assert.equal(payload.splits[0].friend_id,2);
      assert.equal(payload.splits[0].share_amount,amount);
    });
  }
}
