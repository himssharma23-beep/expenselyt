const {query,withTransaction}=require('./postgres');
const core=require('./postgres-core');
const model=require('../public/js/emi-friend-split-model');
let ready;
async function ensureSchema(){
  if(!ready)ready=query(`CREATE TABLE IF NOT EXISTS emi_friend_splits (
    emi_id BIGINT PRIMARY KEY REFERENCES emi_records(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    group_id BIGINT NOT NULL REFERENCES live_split_groups(id) ON DELETE CASCADE,
    total_amount NUMERIC(14,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); ALTER TABLE emi_records ADD COLUMN IF NOT EXISTS upfront_charge NUMERIC(14,2);`).catch(error=>{ready=null;throw error;});
  return ready;
}
const fail=(message,status=400)=>Object.assign(new Error(message),{statusCode:status});
async function quote(userId,emiId,client={query},lock=false){
  const record=(await client.query(`SELECT * FROM emi_records WHERE id=$1 AND user_id=$2${lock?' FOR UPDATE':''}`,[emiId,userId])).rows[0];
  if(!record)throw fail('EMI not found',404);
  const installments=(await client.query('SELECT * FROM emi_installments WHERE emi_id=$1 ORDER BY installment_no',[emiId])).rows;
  const linked=(await client.query(`SELECT link.group_id, g.owner_added_to_expense,
    GREATEST(0, g.total_amount - COALESCE((SELECT SUM(s.share_amount)
      FROM live_split_splits s LEFT JOIN live_split_friends f ON f.id=s.friend_id
      WHERE s.group_id=g.id AND f.linked_user_id IS DISTINCT FROM g.user_id),0)) AS my_share
    FROM emi_friend_splits link JOIN live_split_groups g ON g.id=link.group_id
    WHERE link.emi_id=$1 AND link.user_id=$2`,[emiId,userId])).rows[0];
  const user=(await client.query('SELECT currency_code FROM users WHERE id=$1',[userId])).rows[0];
  return {emi_id:Number(emiId),name:record.name,currency_code:record.currency_code||user?.currency_code||'INR',...model.breakdown(record,installments),group_id:linked?Number(linked.group_id):null,my_share:linked?Number(linked.my_share):0,expense_added:!!linked?.owner_added_to_expense};
}
async function getQuote(userId,emiId){await ensureSchema();return quote(userId,emiId);}
async function create(userId,emiId,data){
  await ensureSchema();
  return withTransaction(async client=>{
    const cost=await quote(userId,emiId,client,true);
    if(cost.group_id)throw fail('This EMI is already split. Manage its existing entry in Live Split.',409);
    if(!Number.isFinite(Number(data.expected_total))||Math.round(Number(data.expected_total)*100)!==Math.round(cost.total*100))throw fail('EMI costs changed. Reopen the split to review the updated total.',409);
    if(!Array.isArray(data.friend_ids))throw fail('Select friends from your Live Split list.');
    const ids=[...new Set(data.friend_ids.map(Number))];
    if(!ids.length||ids.some(id=>!Number.isInteger(id)||id<=0))throw fail('Select at least one friend.');
    const friends=(await client.query('SELECT id,name,linked_user_id FROM live_split_friends WHERE user_id=$1 AND id=ANY($2::bigint[]) AND deleted_at IS NULL',[userId,ids])).rows;
    if(friends.length!==ids.length||friends.some(friend=>Number(friend.linked_user_id)===Number(userId)))throw fail('Select friends from your Live Split list.');
    const people=[...(data.include_self!==false?[{key:'self',name:'You'}]:[]),...ids.map(id=>{const friend=friends.find(row=>Number(row.id)===id);return {key:String(id),name:friend.name,friend_id:id};})];
    const preview=model.shares(cost.total,people,data.mode,data.values||{});
    if(!preview.valid)throw fail(preview.error);
    const myShare=preview.shares.find(person=>person.key==='self')?.share||0;
    const expenseAdded=myShare>0;
    const groupId=await core.addLiveSplitGroup(userId,{divide_date:data.date,details:`EMI: ${cost.name} - full cost (${cost.installment_count} installments)`,heading:`EMI: ${cost.name}`,paid_by:'You',total_amount:cost.total,currency_code:cost.currency_code,split_mode:data.mode,splits:preview.shares.filter(person=>person.friend_id).map(person=>({friend_id:person.friend_id,friend_name:person.name,share_amount:person.share})),owner_added_to_expense:expenseAdded,finance:expenseAdded?{add_expense:true}:null},client);
    await client.query('INSERT INTO emi_friend_splits (emi_id,user_id,group_id,total_amount) VALUES ($1,$2,$3,$4)',[emiId,userId,groupId,cost.total]);
    return {group_id:groupId,total:cost.total,shares:preview.shares,my_share:myShare,expense_added:expenseAdded};
  });
}
module.exports={ensureSchema,getQuote,create};
