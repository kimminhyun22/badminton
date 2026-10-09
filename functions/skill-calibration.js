'use strict';
const crypto=require('crypto');
const core=require('./skill-calibration-core');
const reference=require('./skill-assessment-reference');
const adaptive=require('./skill-adaptive-batch');
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
function project(s,role,baselines,anchors=s.players){
  // Stable IDs preserve all old answers while opening cross-age/grade comparisons.
  const questions=reference.questions(s);
  let effective=s.players;
  if(baselines!==undefined){
    if(role!=='owner'||!Array.isArray(baselines)||baselines.length>s.players.length)throw Error('보정 기준을 확인해 주세요.');
    const byId=new Map();
    for(const raw of baselines){
      const original=s.players.find(p=>p.id===raw?.id);
      if(!original||byId.has(raw.id))throw Error('보정 대상이 올바르지 않습니다.');
      const p=core.player(raw);
      if(p.name!==original.name)throw Error('회원 이름이 변경됐습니다. 대상을 확인해 주세요.');
      byId.set(raw.id,{...p,id:original.id});
    }
    effective=s.players.map(p=>byId.get(p.id)||p);
  }
  const players=role==='owner'?effective:s.players.map(({id,name,grade,gender,ageGroup})=>({id,name,grade,gender,ageGroup}));
  const evidence=Object.fromEntries(questions.map(q=>{
    const counts={a:0,b:0,tie:0};
    Object.values(s.votes||{}).forEach(a=>{if(Object.hasOwn(counts,a[q.id]))counts[a[q.id]]++;});
    const count=Object.values(counts).reduce((a,b)=>a+b,0);
    return [q.id,{count,needsReview:count>0&&Math.max(...Object.values(counts))<=count/2}];
  }));
  return {id:s.id,clubId:s.clubId||null,clubName:s.clubName,players,questions,expiresAt:s.expiresAt,closed:!!s.closed,
    evidence,storedQuestionIds:s.questions.map(q=>q.id),reviewQuestionIds:s.reviewQuestionIds||null,assessmentVersion:s.assessmentVersion||1,boundaryIds:s.boundaryIds||[],
    ...(role==='owner'&&s.assessmentVersion===2?{ownerAnswers:s.votes?.['owner-review']||{}}:{}),
    reviewedAt:s.reviewedAt||0,
    legacyCount:role==='owner'?Object.entries(s.votes||{}).filter(([who])=>/^e[0-2]$/.test(who)).reduce((n,[,a])=>n+Object.values(a).filter(v=>v!=='skip').length,0):0,
    adaptiveSupported:s.assessmentVersion===2,needsIdentity:role==='shared',respondentName:role.startsWith('u_')?s.players.find(p=>p.id===role.slice(2))?.name:null,
    answers:role==='owner'||role==='shared'?{}:s.votes?.[role]||{},
    proposals:role==='owner'?core.measurementProposals(effective,questions,s.votes,anchors).map((p,i)=>({...p,basis:effective[i]})):[],
    count:Object.values(s.votes||{}).reduce((n,a)=>n+Object.values(a).filter(v=>v!=='skip').length,0)};
}
async function handle(db,data,ip,now=Date.now()){
  if(!data||JSON.stringify(data).length>40000||!token(data.id)||!token(data.key))throw Error('요청 정보를 확인해 주세요.');
  const ref=db.ref('skillCalibration/'+data.id);
  if(data.action==='create'){
    const existing=(await ref.once('value')).val();
    if(existing){if(authorize(existing,data.key)!=='owner')throw Error('링크를 확인해 주세요.');return project(existing,'owner');}
    if(typeof data.clubName!=='string'||!data.clubName.trim()||data.clubName.length>80||!Array.isArray(data.invites)||data.invites.length!==3||data.invites.some(k=>!token(k))||new Set([data.key,...data.invites]).size!==4)throw Error('클럽 정보를 확인해 주세요.');
    if(data.clubId!==undefined&&(typeof data.clubId!=='string'||!data.clubId||data.clubId.length>160))throw Error('클럽 식별자를 확인해 주세요.');
    const list=core.players(data.players),measurement=data.assessmentVersion===2;
    const questions=measurement?core.measurementPairs(list,data.boundaryIds||[]):core.pairs(list);
    if(!questions.length&&!measurement)throw Error('비교할 회원이 부족합니다.');
    const rate=db.ref('skillCalibrationLimits/'+hash(String(ip)));
    const limit=await rate.transaction(old=>{
      const current=old&&now-old.at<86400000?old:{at:now,n:0};
      if(current.n>=10)return;
      return {...current,n:current.n+1};
    });
    if(!limit.committed)throw Error('오늘 만든 링크가 많습니다. 기존 링크를 사용해 주세요.');
    const s={id:data.id,...(data.clubId?{clubId:data.clubId}:{}),clubName:data.clubName.trim(),players:list,questions,...(measurement?{assessmentVersion:2,boundaryIds:data.boundaryIds||[]}:{}),owner:hash(data.key),invites:data.invites.map(hash),createdAt:now,expiresAt:now+30*86400000,votes:{}};
    const result=await ref.transaction(old=>old?undefined:s);
    if(!result.committed){const raced=result.snapshot.val();if(authorize(raced,data.key)!=='owner')throw Error('다시 시도해 주세요.');return project(raced,'owner');}
    return project(s,'owner');
  }
  let s=(await ref.once('value')).val(),role=authorize(s,data.key);
  if(role!=='owner'&&s.expiresAt<=now)throw Error('만료된 링크입니다.');
  if(data.action==='batch'){
    if(role==='shared'||s.assessmentVersion!==2)throw Error('본인 이름을 선택한 새 평가에서 진행해 주세요.');
    let source,approval,roster;
    if(s.assessmentReference){
      approval=(await db.ref('skillCalibrationReferenceApprovals/'+s.id).once('value')).val();
      source=(await db.ref('skillCalibration/'+s.assessmentReference.sourceId).once('value')).val();
      roster=approval&&(await db.ref('clubRosters/'+approval.clubRosterId).once('value')).val();
    }
    const r=await ref.transaction(old=>{
      if(!old)return null;
      const actualRole=authorize(old,data.key),merged=old.assessmentReference?reference.materialize(old,source,approval,roster):null;
      return adaptive.allocate(old,actualRole,data.requestId,now,merged).state;
    });
    if(!r.committed)throw Error('평가 묶음을 준비하지 못했습니다. 다시 시도해 주세요.');
    const fresh=r.snapshot.val(),entry=fresh.adaptiveBatches[role],batch=entry.history[data.requestId]||entry.current;
    const result=await handle(db,{action:'read',id:data.id,key:data.key},ip,now);
    return {...result,adaptiveBatch:batch};
  }
  if(data.action==='read'){
    if(s.clubId&&data.clubId!==undefined&&data.clubId!==s.clubId)throw Error('다른 클럽 평가를 이 명부에 적용할 수 없습니다.');
    const approval=(await db.ref('skillCalibrationReferenceApprovals/'+s.id).once('value')).val();
    if(s.assessmentReference){
      const source=(await db.ref('skillCalibration/'+s.assessmentReference.sourceId).once('value')).val();
      const roster=approval&&(await db.ref('clubRosters/'+approval.clubRosterId).once('value')).val();
      const merged=reference.materialize(s,source,approval,roster),result=project(merged.session,role,data.baselines,merged.anchors);
      return {...result,answers:role==='owner'||role==='shared'?{}:s.votes?.[role]||{},...(role==='owner'?{ownerAnswers:merged.ownerAnswers,referenceInfo:merged.info,reusedQuestionIds:merged.reusedQuestionIds}:{}),referenceRevision:reference.revision(s)};
    }
    const result=project(s,role,data.baselines);
    if(role==='owner'&&approval){
      try{const source=(await db.ref('skillCalibration/'+approval.sourceId).once('value')).val(),roster=(await db.ref('clubRosters/'+approval.clubRosterId).once('value')).val();reference.verify(s,source,approval,roster,true);result.referenceAvailable={sourceCount:project(source,'owner').count};}catch(_){result.referenceAvailable=null;}
    }
    return {...result,referenceRevision:reference.revision(s)};
  }
  if(data.action==='reference'){
    if(role!=='owner'||s.closed||s.expiresAt<=now)throw Error('운영자 화면에서 열린 평가만 연결할 수 있습니다.');
    const approval=(await db.ref('skillCalibrationReferenceApprovals/'+s.id).once('value')).val();
    if(!approval?.approved)throw Error('기존 자료 연결 승인 정보가 없습니다.');
    const source=(await db.ref('skillCalibration/'+approval.sourceId).once('value')).val(),roster=(await db.ref('clubRosters/'+approval.clubRosterId).once('value')).val();
    const r=await ref.transaction(old=>{
      if(!old)return null;
      if(old.closed||old.expiresAt<=now||authorize(old,data.key)!=='owner')return;
      return reference.connect(old,source,approval,roster,data.expectedRevision,now);
    });
    if(!r.committed)throw Error('평가가 변경됐습니다. 새로고침해 주세요.');
    return handle(db,{action:'read',id:data.id,key:data.key,...(s.clubId?{clubId:s.clubId}:{}),baselines:data.baselines},ip,now);
  }
  if(data.action==='measurement'){
    if(role!=='owner'||s.closed||s.expiresAt<=now)throw Error('만든 기기에서 열린 평가만 확장할 수 있습니다.');
    core.measurementPairs(s.players,data.boundaryIds||[]);
    if(data.questionIds!==undefined){
      const allowed=new Set(core.measurementPairs(s.players,s.players.map(p=>p.id)).filter(q=>q.kind==='cross-grade').map(q=>q.id));
      if(!Array.isArray(data.questionIds)||!data.questionIds.length||data.questionIds.length>150||new Set(data.questionIds).size!==data.questionIds.length||data.questionIds.some(id=>!allowed.has(id)))throw Error('추가 교차 질문을 확인해 주세요.');
    }
    const r=await ref.transaction(old=>{
      if(!old)return null;
      if(authorize(old,data.key)!=='owner'||old.closed||old.expiresAt<=now)return;
      const planned=data.questionIds?new Set(data.questionIds):null;
      const additions=core.measurementPairs(old.players,planned?old.players.map(p=>p.id):data.boundaryIds||[]).filter(q=>q.kind==='cross-grade'&&(!planned||planned.has(q.id))),seen=new Set(old.questions.map(q=>q.id));
      // Append only. Existing question IDs, ordering, responses and credentials survive.
      const retained=reference.questions(old),retainedIds=new Set(retained.map(q=>q.id));
      const questions=[...retained,...additions.filter(q=>!retainedIds.has(q.id))];
      return {...old,questions,...(planned?{reviewQuestionIds:[...new Set([...(old.reviewQuestionIds||[]),...data.questionIds])]}:{}),assessmentVersion:2,boundaryIds:[...(data.boundaryIds||[])],assessmentConfiguredAt:now};
    });
    if(!r.committed||!r.snapshot.val())throw Error('평가가 변경되거나 마감됐습니다.');
    return project(r.snapshot.val(),role);
  }
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
  const ownerAssessment=data.action==='assess'&&role==='owner'&&s.assessmentVersion===2;
  if(!ownerAssessment&&(data.action!=='answer'||role==='owner'||role==='shared'))throw Error('응답 링크를 확인해 주세요.');
  const voteRole=ownerAssessment?'owner-review':role;
  if(!data.answers||typeof data.answers!=='object'||Array.isArray(data.answers)||Object.keys(data.answers).length<1||Object.keys(data.answers).length>5)throw Error('한 번에 1~5문제만 응답할 수 있습니다.');
  for(const [id,value] of Object.entries(data.answers))if(!reference.questions(s).some(q=>q.id===id)||!['a','b','tie','skip'].includes(value))throw Error('응답을 확인해 주세요.');
  const result=await ref.transaction(old=>{
    // RTDB may first invoke with an empty local cache despite the preceding read.
    // Null lets the server compare-and-retry; undefined would abort immediately.
    if(!old)return null;
    if(old.closed||old.expiresAt<=now||ownerAssessment&&(old.assessmentVersion!==2||authorize(old,data.key)!=='owner'))return;
    const votes={...old.votes,[voteRole]:{...old.votes?.[voteRole],...data.answers}};
    const meaningful=Object.values(votes[voteRole]).filter(v=>v!=='skip').length;
    // First completed batch only: retries and reopening must not postpone review.
    const reviewedAt=old.reviewedAt||(meaningful>=Math.min(5,old.questions.length)?now:0);
    return {...old,votes,reviewedAt};
  });
  if(!result.committed||!result.snapshot.val())throw Error('마감되었거나 만료된 링크입니다.');
  return project(result.snapshot.val(),role);
}
module.exports={handle,authorize,project};
