'use strict';
const crypto=require('crypto'),core=require('./skill-calibration-core');
const clone=v=>JSON.parse(JSON.stringify(v));
function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const identity=p=>({name:p.name,grade:p.grade,gender:['F','여'].includes(p.gender)?'여':'남',ageGroup:p.ageGroup||'40대'});
function sourceHash(s){return hash({id:s.id,clubName:s.clubName,players:s.players,questions:s.questions,votes:s.votes||{}});}
function revision(s){return hash({id:s.id,owner:s.owner,players:s.players,questions:s.questions,votes:s.votes||{},closed:!!s.closed,assessmentReference:s.assessmentReference||null});}
function questions(s){
 const out=clone(s.questions),seen=new Set(out.map(q=>q.id)),all=core.pairs(s.players),valid=new Set(all.map(q=>q.id));
 const missing=Object.values(s.votes||{}).some(v=>Object.keys(v).some(id=>valid.has(id)&&!seen.has(id)));
 // v1 projected all pairs; preserve their pending drafts and saved responses on upgrade.
 if(s.assessmentVersion!==2||missing)for(const q of all)if(!seen.has(q.id)){out.push({...q,kind:s.players.find(p=>p.id===q.a).grade===s.players.find(p=>p.id===q.b).grade?'same-grade':'cross-grade'});seen.add(q.id);}
 return out;
}
function mapping(target,source,roster){
 if(target.id===source.id||source.assessmentReference||target.players.length!==source.players.length)throw Error('원본 평가 범위를 확인해 주세요.');
 if(target.clubName!==roster.club.name||source.clubName!==roster.club.name)throw Error('평가와 클럽 명부가 다릅니다.');
 for(const s of [target,source])if(s.clubId&&s.clubId!==roster.club.id)throw Error('다른 클럽의 평가입니다.');
 const map={};for(const p of source.players){const matches=target.players.filter(t=>hash(identity(t))===hash(identity(p))),members=roster.club.members.filter(m=>hash(identity(m))===hash(identity(p)));if(matches.length!==1||members.length!==1)throw Error('선수의 클럽·프로필 대응을 확인해 주세요.');map[p.id]=matches[0].id;}
 if(new Set(Object.values(map)).size!==target.players.length)throw Error('선수 대응이 중복됐습니다.');return map;
}
function draft(target,source,roster){return {approved:false,targetId:target.id,sourceId:source.id,clubId:roster.club.id,clubOwner:roster.owner,targetOwner:target.owner,sourceOwner:source.owner,sourceHash:sourceHash(source),targetPlayersHash:hash(target.players),rosterRevision:roster.revision,map:mapping(target,source,roster)};}
function verify(target,source,approval,roster,link=false){
 // Approval must come from the protected server store, never from a request body.
 if(approval?.approved!==true||!/^([a-f0-9]{32})$/.test(approval.approvalId||'')||!['both-assessment-owners','approved-club-data-owner'].includes(approval.authorizationBasis))throw Error('기존 자료 연결 승인 정보가 없습니다.');
 if(approval.targetId!==target.id||approval.sourceId!==source.id||approval.targetOwner!==target.owner||approval.sourceOwner!==source.owner||approval.clubId!==roster.club.id||approval.clubOwner!==roster.owner)throw Error('기존 자료 연결 권한 또는 클럽이 변경됐습니다.');
 if(sourceHash(source)!==approval.sourceHash||hash(target.players)!==approval.targetPlayersHash)throw Error('평가 원본이 변경됐습니다. 다시 확인해 주세요.');
 if(hash(mapping(target,source,roster))!==hash(approval.map))throw Error('선수 대응이 변경됐습니다.');
 if(link&&roster.revision!==approval.rosterRevision)throw Error('클럽 명부가 변경됐습니다. 다시 확인해 주세요.');
 return approval;
}
function connect(target,source,approval,roster,expected,now=Date.now()){
 verify(target,source,approval,roster);
 const reference={approvalId:approval.approvalId,sourceId:source.id,sourceHash:approval.sourceHash,clubId:approval.clubId};
 if(target.assessmentReference){if(hash(target.assessmentReference)!==hash(reference))throw Error('다른 원본이 이미 연결됐습니다.');return clone(target);}
 verify(target,source,approval,roster,true);
 if(revision(target)!==expected)throw Error('새 답안이 저장됐습니다. 결과를 새로고침해 주세요.');
 return {...clone(target),questions:questions(target),assessmentVersion:2,assessmentReference:reference,assessmentReferenceAt:now};
}
function materialize(target,source,approval,roster){
 verify(target,source,approval,roster);
 const expected={approvalId:approval.approvalId,sourceId:source.id,sourceHash:approval.sourceHash,clubId:approval.clubId};
 if(hash(target.assessmentReference)!==hash(expected))throw Error('자료 연결 기록을 확인해 주세요.');
 const out={...clone(target),questions:questions(target),votes:{}},seen=new Set(out.questions.map(q=>q.id)),anchors=source.players.map(p=>({...clone(p),id:approval.map[p.id]})),provenance={};
 function mapped(q,origin){const a=origin===source?approval.map[q.a]:q.a,b=origin===source?approval.map[q.b]:q.b,ids=[a,b].sort((x,y)=>Number(x.slice(1))-Number(y.slice(1)));return {id:ids.join('_'),a:ids[0],b:ids[1],flip:ids[0]!==a};}
 for(const origin of [source,target]){
  const all=new Map(core.pairs(origin.players).map(q=>[q.id,q]));
  for(const q of questions(origin)){const m=mapped(q,origin);if(!seen.has(m.id)){out.questions.push({id:m.id,a:m.a,b:m.b});seen.add(m.id);}}
  for(const [who,answers] of Object.entries(origin.votes||{})){
   // Registered members share one identity within the explicitly verified club mapping.
   // Anonymous invite/owner slots remain distinct; independent humans are not assumed.
   const member=who.startsWith('u_')?(origin===source?approval.map[who.slice(2)]:who.slice(2)):null;
   const actor=member?'member:'+member:'origin:'+origin.id+':'+who;
   out.votes[actor]=out.votes[actor]||{};provenance[actor]=provenance[actor]||{};
   for(const [id,value] of Object.entries(answers)){const q=all.get(id);if(!q)throw Error('원본 답안의 선수를 확인해 주세요.');const m=mapped(q,origin);out.votes[actor][m.id]=m.flip&&(value==='a'||value==='b')?(value==='a'?'b':'a'):value;provenance[actor][m.id]={sourceId:origin.id,respondent:who,questionId:id};}
  }
 }
 const count=s=>Object.values(s.votes||{}).reduce((n,a)=>n+Object.values(a).filter(v=>v!=='skip').length,0),total=count(out),sourceCount=count(source),targetCount=count(target);
 return {session:out,anchors,ownerAnswers:target.votes?.['owner-review']||{},reusedQuestionIds:[...new Set(Object.values(out.votes).flatMap(a=>Object.keys(a)))],info:{sourceId:source.id,sourceCount,targetCount,total,deduplicated:sourceCount+targetCount-total,originalPriors:true,anonymousReviewerIdentityUnverified:true},provenance};
}
module.exports={hash,sourceHash,revision,questions,draft,verify,connect,materialize};
