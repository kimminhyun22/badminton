'use strict';
const crypto=require('crypto');
const core=require('./skill-calibration-core');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const token=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
function authorize(s,key){
  if(!s||!token(key))throw Error('링크를 확인해 주세요.');
  const h=hash(key);
  if(h===s.owner)return 'owner';
  const i=s.invites.indexOf(h);
  if(i<0)throw Error('링크를 확인해 주세요.');
  return 'e'+i;
}
function project(s,role){
  const players=role==='owner'?s.players:s.players.map(({id,name,grade,gender,ageGroup})=>({id,name,grade,gender,ageGroup}));
  return {id:s.id,clubName:s.clubName,players,questions:s.questions,expiresAt:s.expiresAt,closed:!!s.closed,
    answers:role==='owner'?{}:s.votes?.[role]||{},
    proposals:role==='owner'?core.proposals(s.players,s.questions,s.votes):[],
    count:Object.values(s.votes||{}).reduce((n,a)=>n+Object.values(a).filter(v=>v!=='skip').length,0)};
}
async function handle(db,data,ip,now=Date.now()){
  if(!data||JSON.stringify(data).length>40000||!token(data.id)||!token(data.key))throw Error('요청 정보를 확인해 주세요.');
  const ref=db.ref('skillCalibration/'+data.id);
  if(data.action==='create'){
    const existing=(await ref.once('value')).val();
    if(existing){if(authorize(existing,data.key)!=='owner')throw Error('링크를 확인해 주세요.');return project(existing,'owner');}
    if(typeof data.clubName!=='string'||!data.clubName.trim()||data.clubName.length>80||!Array.isArray(data.invites)||data.invites.length!==3||data.invites.some(k=>!token(k))||new Set([data.key,...data.invites]).size!==4)throw Error('클럽 정보를 확인해 주세요.');
    const list=core.players(data.players),questions=core.pairs(list);
    if(!questions.length)throw Error('같은 급수에서 비교할 회원이 부족합니다.');
    const rate=db.ref('skillCalibrationLimits/'+hash(String(ip)));
    const limit=await rate.transaction(old=>{
      const current=old&&now-old.at<86400000?old:{at:now,n:0};
      if(current.n>=10)return;
      return {...current,n:current.n+1};
    });
    if(!limit.committed)throw Error('오늘 만든 링크가 많습니다. 기존 링크를 사용해 주세요.');
    const s={id:data.id,clubName:data.clubName.trim(),players:list,questions,owner:hash(data.key),invites:data.invites.map(hash),createdAt:now,expiresAt:now+30*86400000,votes:{}};
    const result=await ref.transaction(old=>old?undefined:s);
    if(!result.committed){const raced=result.snapshot.val();if(authorize(raced,data.key)!=='owner')throw Error('다시 시도해 주세요.');return project(raced,'owner');}
    return project(s,'owner');
  }
  let s=(await ref.once('value')).val(),role=authorize(s,data.key);
  if(role!=='owner'&&s.expiresAt<=now)throw Error('만료된 링크입니다.');
  if(data.action==='read')return project(s,role);
  if(data.action==='close'){
    if(role!=='owner')throw Error('만든 기기에서만 마감할 수 있습니다.');
    const r=await ref.transaction(old=>old?{...old,closed:true}:undefined);return project(r.snapshot.val(),role);
  }
  if(data.action!=='answer'||role==='owner')throw Error('응답 링크를 확인해 주세요.');
  if(!data.answers||typeof data.answers!=='object'||Array.isArray(data.answers)||Object.keys(data.answers).length<1||Object.keys(data.answers).length>5)throw Error('한 번에 1~5문제만 응답할 수 있습니다.');
  for(const [id,value] of Object.entries(data.answers))if(!s.questions.some(q=>q.id===id)||!['a','b','tie','skip'].includes(value))throw Error('응답을 확인해 주세요.');
  const result=await ref.transaction(old=>{
    if(!old||old.closed||old.expiresAt<=now)return;
    return {...old,votes:{...old.votes,[role]:{...old.votes?.[role],...data.answers}}};
  });
  if(!result.committed)throw Error('마감되었거나 만료된 링크입니다.');
  return project(result.snapshot.val(),role);
}
module.exports={handle,authorize,project};
