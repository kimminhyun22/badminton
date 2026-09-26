'use strict';
const crypto=require('crypto');
const core=require('./skill-calibration-core');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const token=s=>typeof s==='string'&&/^[a-f0-9]{32}$/.test(s);
function authorize(s,key){
  if(!s||!token(key))throw Error('링크를 확인해 주세요.');
  const h=hash(key);
  if(h===s.owner)return 'owner';
  if(h===s.shared)return 'shared';
  const participant=Object.entries(s.participants||{}).find(([,p])=>p.key===h);
  if(participant)return 'u_'+participant[0];
  const i=s.invites.indexOf(h);
  if(i<0)throw Error('링크를 확인해 주세요.');
  return 'e'+i;
}
function project(s,role){
  const players=role==='owner'?s.players:s.players.map(({id,name,grade,gender,ageGroup})=>({id,name,grade,gender,ageGroup}));
  const evidence=Object.fromEntries(s.questions.map(q=>{
    const counts={a:0,b:0,tie:0};
    Object.values(s.votes||{}).forEach(a=>{if(Object.hasOwn(counts,a[q.id]))counts[a[q.id]]++;});
    const count=Object.values(counts).reduce((a,b)=>a+b,0);
    return [q.id,{count,needsReview:count>0&&Math.max(...Object.values(counts))<=count/2}];
  }));
  return {id:s.id,clubName:s.clubName,players,questions:s.questions,expiresAt:s.expiresAt,closed:!!s.closed,
    evidence,
    reviewedAt:s.reviewedAt||0,
    legacyCount:role==='owner'?Object.entries(s.votes||{}).filter(([who])=>/^e[0-2]$/.test(who)).reduce((n,[,a])=>n+Object.values(a).filter(v=>v!=='skip').length,0):0,
    needsIdentity:role==='shared',respondentName:role.startsWith('u_')?s.players.find(p=>p.id===role.slice(2))?.name:null,
    answers:role==='owner'||role==='shared'?{}:s.votes?.[role]||{},
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
  if(data.action==='share'){
    if(role!=='owner'||!token(data.sharedKey)||data.sharedKey===data.key)throw Error('공유 정보를 확인해 주세요.');
    const shared=hash(data.sharedKey);
    const r=await ref.transaction(old=>{
      if(!old)return null;
      if(old.closed||old.expiresAt<=now||old.invites.includes(shared)||Object.values(old.participants||{}).some(p=>p.key===shared)||(old.shared&&old.shared!==shared))return;
      return {...old,shared};
    });
    if(!r.committed||!r.snapshot.val())throw Error('공유 링크를 만들 수 없습니다. 만든 기기에서 다시 확인해 주세요.');
    return project(r.snapshot.val(),'owner');
  }
  if(data.action==='join'){
    if(role!=='shared'||!token(data.respondentKey)||!s.players.some(p=>p.id===data.playerId))throw Error('본인 이름을 선택해 주세요.');
    const credential=hash(data.respondentKey);
    const r=await ref.transaction(old=>{
      if(!old)return null;
      if(old.closed||old.expiresAt<=now||[old.owner,old.shared,...old.invites].includes(credential))return;
      const participants=old.participants||{},existing=participants[data.playerId];
      if(existing&&existing.key!==credential)return;
      if(Object.entries(participants).some(([id,p])=>id!==data.playerId&&p.key===credential))return;
      return {...old,participants:{...participants,[data.playerId]:{key:credential}}};
    });
    if(!r.committed||!r.snapshot.val())throw Error('이미 다른 이름이나 기기로 참여했습니다. 처음 참여한 기기에서 이어가 주세요. 마감된 링크는 참여할 수 없습니다.');
    return project(r.snapshot.val(),'u_'+data.playerId);
  }
  if(data.action==='close'){
    if(role!=='owner')throw Error('만든 기기에서만 마감할 수 있습니다.');
    const r=await ref.transaction(old=>old?{...old,closed:true}:null);
    if(!r.snapshot.val())throw Error('링크를 확인해 주세요.');
    return project(r.snapshot.val(),role);
  }
  if(data.action!=='answer'||role==='owner'||role==='shared')throw Error('응답 링크를 확인해 주세요.');
  if(!data.answers||typeof data.answers!=='object'||Array.isArray(data.answers)||Object.keys(data.answers).length<1||Object.keys(data.answers).length>5)throw Error('한 번에 1~5문제만 응답할 수 있습니다.');
  for(const [id,value] of Object.entries(data.answers))if(!s.questions.some(q=>q.id===id)||!['a','b','tie','skip'].includes(value))throw Error('응답을 확인해 주세요.');
  const result=await ref.transaction(old=>{
    // RTDB may first invoke with an empty local cache despite the preceding read.
    // Null lets the server compare-and-retry; undefined would abort immediately.
    if(!old)return null;
    if(old.closed||old.expiresAt<=now)return;
    const votes={...old.votes,[role]:{...old.votes?.[role],...data.answers}};
    const meaningful=Object.values(votes[role]).filter(v=>v!=='skip').length;
    // First completed batch only: retries and reopening must not postpone review.
    const reviewedAt=old.reviewedAt||(meaningful>=Math.min(5,old.questions.length)?now:0);
    return {...old,votes,reviewedAt};
  });
  if(!result.committed||!result.snapshot.val())throw Error('마감되었거나 만료된 링크입니다.');
  return project(result.snapshot.val(),role);
}
module.exports={handle,authorize,project};
