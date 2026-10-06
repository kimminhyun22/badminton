'use strict';
// Fail closed until a specific test window and the approved UIDs are configured.
// Counters bound admitted work, not the billing account's dollar spend.
const {identity}=require('./admin-workspace');
const {transaction}=require('./workspace-transaction');
const deny=(message,code='permission-denied')=>{throw Object.assign(Error(message),{code});};
async function authorize(db,auth,data,kind,env=process.env,now=Date.now()){
 const uid=identity(auth),allowed=String(env.MINTON_WORKSPACE_PILOT_UIDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const expiry=Date.parse(env.MINTON_WORKSPACE_PILOT_UNTIL||''),run=String(env.MINTON_WORKSPACE_PILOT_RUN||'');
 if(!allowed.includes(uid)||allowed.length>2||!Number.isFinite(expiry)||now>=expiry||expiry-now>86400000||!/^[a-zA-Z0-9_-]{8,80}$/.test(run))deny('승인된 동기화 시험 계정과 기간을 확인해 주세요.');
 if(!data||Buffer.byteLength(JSON.stringify(data))>65536)deny('한정 시험은 요청당 64KB까지입니다.','resource-exhausted');
 if(kind==='game'&&data.action==='create'){
  const s=data.state||{},players=data.mode==='daily'?s.players:[...(s.members?.blue||[]),...(s.members?.red||[]),...(s.members?.all||[])];
  if(!Array.isArray(players)||players.length>12)deny('한정 시험은 가명 선수 12명까지입니다.','resource-exhausted');
 }
 const command=kind==='game'&&data.action==='command';
 return transaction(db.ref('adminWorkspacePilot/'+run),current=>{
  const row=current||{calls:0,commands:0};
  if(row.calls>=1500||(command&&row.commands>=200))deny('동기화 시험 요청 한도에 도달했습니다.','resource-exhausted');
  return {...row,calls:row.calls+1,commands:row.commands+(command?1:0),updatedAt:now,expiresAt:expiry};
 });
}
module.exports={authorize};
