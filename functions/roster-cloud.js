'use strict';
const crypto=require('crypto');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
function fail(message,code='failed-precondition'){const e=Error(message);e.code=code;throw e;}
function identity(auth){
  if(!auth?.uid||auth.token?.email_verified!==true||auth.token?.firebase?.sign_in_provider==='anonymous')fail('Google 계정으로 로그인해 주세요.','unauthenticated');
  return auth.uid;
}
function cleanClub(c){
  if(!c||typeof c.id!=='string'||c.id.length>160||typeof c.name!=='string'||!c.name.trim()||c.name.length>80||!Array.isArray(c.members)||c.members.length>500)fail('클럽 명부 형식을 확인해 주세요.');
  const members=c.members.map(m=>{
    if(!m||typeof m.name!=='string'||!m.name.trim()||m.name.length>80||!['S','A','B','C','D','E'].includes(m.grade)||!['남','여','M','F'].includes(m.gender)||!Number.isFinite(m.level)||m.level<0||m.level>10)fail('회원 정보를 확인해 주세요.');
    const out={...m};
    // Preserve manual adjustments and survey provenance without session credentials.
    for(const [k,v] of Object.entries(m)){
      if(['ageGroup','memberId','id','skillStep','isClubOfficial','skillReviewedAt','skillReview','skillCalibration','skillCalibrationAppliedAt','skillCalibrationSessionId'].includes(k)||k.startsWith('skill'))out[k]=v;
    }
    for(const k of Object.keys(out))if(/token|secret|password|invite|grant/i.test(k))delete out[k];
    if(out.skillStep!==undefined&&(!Number.isInteger(out.skillStep)||Math.abs(out.skillStep)>4))fail('개인 보정값을 확인해 주세요.');
    return out;
  });
  const out={...c,id:c.id,name:c.name.trim(),members};
  // The club object contains only roster preferences and review metadata.
  for(const k of Object.keys(out))if(/token|secret|password|invite|grant/i.test(k))delete out[k];
  if(Buffer.byteLength(JSON.stringify(out))>220000)fail('명부가 너무 큽니다.');
  return JSON.parse(JSON.stringify(out));
}
function authorized(doc,uid){return !!doc&&(doc.owner===uid||doc.editors?.[uid]===true);}
function project(doc,id){return {id,revision:doc.revision,club:doc.club,updatedAt:doc.updatedAt,owner:doc.owner};}
function change(doc,uid,data,now){
  if(!authorized(doc,uid))fail('이 클럽 명부에 접근할 권한이 없습니다.','permission-denied');
  if(!/^[a-zA-Z0-9_-]{12,100}$/.test(data.operationId||''))fail('저장 요청 정보를 확인해 주세요.');
  const fingerprint=digest(JSON.stringify({action:data.action,club:data.club,revision:data.revision,target:data.target}));
  const duplicate=(doc.receipts||[]).find(r=>r.id===data.operationId&&r.uid===uid);
  if(duplicate){
    if(duplicate.fingerprint!==fingerprint)fail('같은 요청 번호에 다른 내용이 있습니다.');
    if(duplicate.revision!==doc.revision)fail('다른 기기에서 명부가 변경됐습니다. 서버 명부를 확인해 주세요.','aborted');
    return doc;
  }
  if(data.revision!==doc.revision)fail('다른 기기에서 명부가 변경됐습니다. 서버 명부를 확인해 주세요.','aborted');
  let club;
  if(data.action==='restore'){
    const version=(doc.history||[]).find(h=>h.revision===data.target);
    if(!version)fail('복원할 저장 이력이 없습니다.');
    club=version.club;
  }else club=cleanClub(data.club);
  if(!club.members.length)fail('빈 명부는 서버 원본에 자동 저장하지 않습니다.');
  if(club.id!==doc.club.id)fail('클럽 식별자가 변경됐습니다.');
  return {...doc,club,revision:doc.revision+1,updatedAt:now,
    history:[...(doc.history||[]),{revision:doc.revision,updatedAt:doc.updatedAt,club:doc.club}].slice(-10),
    receipts:[...(doc.receipts||[]),{id:data.operationId,uid,fingerprint,revision:doc.revision+1}].slice(-30)};
}
async function handle(db,auth,data,now=Date.now()){
  const uid=identity(auth);
  if(!data||Buffer.byteLength(JSON.stringify(data))>240000)fail('요청 크기를 확인해 주세요.');
  const account=db.ref('rosterAccounts/'+uid);
  if(data.action==='list'){
    const index=(await account.once('value')).val()||{};
    const docs=await Promise.all(Object.keys(index).slice(0,20).map(async id=>{
      const d=(await db.ref('clubRosters/'+id).once('value')).val();
      return authorized(d,uid)?project(d,id):null;
    }));return {clubs:docs.filter(Boolean)};
  }
  if(data.action==='create'){
    const club=cleanClub(data.club);if(!club.members.length)fail('회원이 있는 명부를 선택해 주세요.');
    const id=digest(uid+'|'+club.id).slice(0,40);
    const reserved=await account.transaction(old=>{const next=old||{};if(!next[id]&&Object.keys(next).length>=20)return;return {...next,[id]:true};});
    if(!reserved.committed)fail('연결할 수 있는 클럽 수를 초과했습니다.');
    const result=await db.ref('clubRosters/'+id).transaction(old=>old||{owner:uid,club,revision:1,updatedAt:now,editors:{}});
    if(!authorized(result.snapshot.val(),uid))fail('클럽 연결을 확인해 주세요.','permission-denied');
    return project(result.snapshot.val(),id);
  }
  if(!/^[a-f0-9]{40}$/.test(data.id||''))fail('클럽 연결을 확인해 주세요.');
  const ref=db.ref('clubRosters/'+data.id);
  if(data.action==='join'){
    if(!/^[a-f0-9]{64}$/.test(data.key||''))fail('초대 링크를 확인해 주세요.');
    const index=(await account.once('value')).val()||{};
    if(!index[data.id]&&Object.keys(index).length>=20)fail('연결할 수 있는 클럽 수를 초과했습니다.');
    const result=await ref.transaction(old=>{
      if(!old?.invite||old.invite.hash!==digest(data.key)||old.invite.expiresAt<=now)return;
      if(Object.keys(old.editors||{}).length>=20&&!old.editors?.[uid])return;
      return {...old,editors:{...(old.editors||{}),[uid]:true}};
    });
    if(!result.committed)fail('만료됐거나 취소된 초대 링크입니다.');
    await account.child(data.id).set(true);return project(result.snapshot.val(),data.id);
  }
  const doc=(await ref.once('value')).val();
  if(!authorized(doc,uid))fail('이 클럽 명부에 접근할 권한이 없습니다.','permission-denied');
  if(data.action==='read')return project(doc,data.id);
  if(data.action==='history')return {versions:(doc.history||[]).map(h=>({revision:h.revision,updatedAt:h.updatedAt,count:h.club.members.length}))};
  if(data.action==='invite'||data.action==='revoke'){
    if(doc.owner!==uid)fail('명부 소유자만 공유를 관리할 수 있습니다.','permission-denied');
    const key=crypto.randomBytes(32).toString('hex');
    const result=await ref.transaction(old=>{
      if(old?.owner!==uid)return;
      if(data.action==='revoke')return {...old,editors:{},invite:null};
      return {...old,invite:{hash:digest(key),expiresAt:now+86400000}};
    });
    if(!result.committed)fail('공유 설정이 변경됐습니다.');
    return data.action==='invite'?{key,expiresAt:now+86400000}:{revoked:true};
  }
  if(!['save','restore'].includes(data.action))fail('지원하지 않는 요청입니다.');
  let error;
  const result=await ref.transaction(old=>{
    if(!old)return null;
    try{error=null;return change(old,uid,data,now);}catch(e){error=e;return;}
  });
  if(error)throw error;
  if(!result.committed||!result.snapshot.val())fail('명부를 저장하지 못했습니다.');
  return project(result.snapshot.val(),data.id);
}
module.exports={handle,change,cleanClub,identity,authorized};
