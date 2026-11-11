'use strict';
const crypto=require('crypto'),core=require('./skill-calibration-core');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const clean=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'를 확인해 주세요.');return v.trim();};
function event(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('팀전 정보를 확인해 주세요.');return {id:clean(raw.id,160,'팀전 식별자'),title:clean(raw.title,80,'팀전 이름')};}
function players(raw,min=2){if(!Array.isArray(raw)||raw.length<min||raw.length>150)throw Error('팀전 신청자는 '+min+'~150명이어야 합니다.');const keys=new Set();return core.players(raw).map((p,i)=>{const memberKey=clean(raw[i].memberKey,160,'회원 식별자');if(keys.has(memberKey))throw Error('회원 식별자가 중복됐습니다.');keys.add(memberKey);return {...p,memberKey,skillRating:p.skillRating??p.base+(p.skillStep||0)*.2};});}
function evaluators(raw){if(!Array.isArray(raw)||!raw.length||raw.length>150)throw Error('평가자는 1~150명이어야 합니다.');const names=new Set(),keys=new Set();return raw.map(p=>{const memberKey=clean(p?.memberKey,160,'평가자 식별자'),name=clean(p?.name,40,'평가자 이름');if(names.has(name)||keys.has(memberKey))throw Error('평가자 이름 또는 식별자가 중복됐습니다. 명부를 확인해 주세요.');names.add(name);keys.add(memberKey);return {memberKey,name};});}
const identity=p=>({memberKey:p.memberKey,name:p.name,grade:p.grade,gender:p.gender,ageGroup:p.ageGroup});
function creation(data){
 if(['votes','assessmentReference','sourceVotes'].some(k=>Object.hasOwn(data,k)))throw Error('팀전 평가는 이전 답안을 가져올 수 없습니다.');
 const e=event(data.event),ps=players(data.players,4),es=evaluators(data.evaluators),fingerprint=digest({event:e,clubId:data.clubId||null,clubName:data.clubName.trim(),players:ps.slice().sort((a,b)=>a.memberKey.localeCompare(b.memberKey)),evaluators:es.slice().sort((a,b)=>a.memberKey.localeCompare(b.memberKey))});
 return {event:{...e,revision:1},players:ps,eventActiveIds:ps.map(p=>p.id),eventEvaluators:es.map((p,i)=>({...p,id:'r'+i})),eventEvaluatorIds:es.map((_,i)=>'r'+i),questions:questionsFor(ps),eventCreationFingerprint:fingerprint,assessmentVersion:2};
}
function verifyCreation(s,data){if(!!s.event!==!!data.event)throw Error('다른 종류의 평가가 이미 있습니다.');if(s.event&&s.eventCreationFingerprint!==creation(data).eventCreationFingerprint)throw Error('생성 요청의 팀전 또는 최초 명부가 다릅니다. 기존 평가를 새로고침해 주세요.');}
function questionsFor(ps){return core.pairs(ps).map(q=>({...q,kind:ps.find(p=>p.id===q.a).grade===ps.find(p=>p.id===q.b).grade?'same-grade':'cross-grade'}));}
const activePlayers=s=>{const ids=new Set(s.eventActiveIds||[]);return s.players.filter(p=>ids.has(p.id));};
const activeEvaluators=s=>{const ids=new Set(s.eventEvaluatorIds||[]);return (s.eventEvaluators||[]).filter(p=>ids.has(p.id));};
function questions(s){const ids=new Set(s.eventActiveIds||[]);return s.questions.filter(q=>ids.has(q.a)&&ids.has(q.b));}
function activeSession(s){return {...s,players:activePlayers(s),questions:questions(s)};}
function checkRevision(s,expected){if(!Number.isSafeInteger(expected)||expected!==s.event.revision)throw Error('팀전 신청자가 변경됐습니다. 새로고침 후 다시 진행해 주세요.');}
function respondent(s,role){return role.startsWith('u_')?activeEvaluators(s).find(p=>p.id===role.slice(2)):null;}
function answerQuestions(s,role){
 const evaluator=respondent(s,role);if(!evaluator)return [];
 const self=activePlayers(s).find(p=>p.memberKey===evaluator.memberKey);
 return questions(s).filter(q=>!self||q.a!==self.id&&q.b!==self.id);
}
function resultRevision(s){return digest({event:s.event,players:activePlayers(s),evaluators:activeEvaluators(s),questions:questions(s),votes:s.votes||{},closed:!!s.closed});}
function sync(s,data,now){
 checkRevision(s,data.expectedRevision);
 const requested=data.event?event(data.event):{id:s.event.id,title:s.event.title};if(requested.id!==s.event.id)throw Error('다른 팀전으로 평가를 바꿀 수 없습니다.');
 const incoming=players(data.players,2),byKey=new Map(s.players.map(p=>[p.memberKey,p])),stored=s.players.slice(),active=[];
 for(const p of incoming){const old=byKey.get(p.memberKey);if(old){if(digest(identity(old))!==digest(identity(p)))throw Error('회원 프로필이 변경됐습니다. 새 팀전 평가를 만들어 주세요.');active.push(old.id);}else{if(stored.length>=500)throw Error('추가·제외 기록이 많습니다. 새 팀전 평가를 만들어 주세요.');const next={...p,id:'p'+stored.length};stored.push(next);byKey.set(next.memberKey,next);active.push(next.id);}}
 const currentEvaluators=s.eventEvaluators||[],allEvaluators=currentEvaluators.slice();let evaluatorIds=s.eventEvaluatorIds;
 if(data.evaluators!==undefined){const incomingEvaluators=evaluators(data.evaluators),map=new Map(currentEvaluators.map(p=>[p.memberKey,p]));evaluatorIds=[];for(const p of incomingEvaluators){const old=map.get(p.memberKey);if(old){const index=allEvaluators.findIndex(e=>e.id===old.id);allEvaluators[index]={...old,name:p.name};evaluatorIds.push(old.id);}else{if(allEvaluators.length>=500)throw Error('평가자 변경 기록이 많습니다. 새 평가를 만들어 주세요.');const next={...p,id:'r'+allEvaluators.length};allEvaluators.push(next);map.set(next.memberKey,next);evaluatorIds.push(next.id);}}}
 const live=stored.filter(p=>active.includes(p.id)),seen=new Set(s.questions.map(q=>q.id)),added=questionsFor(live).filter(q=>!seen.has(q.id));
 return {...s,event:{...requested,revision:s.event.revision+1},players:stored,eventActiveIds:active,eventEvaluators:allEvaluators,eventEvaluatorIds:evaluatorIds,questions:[...s.questions,...added],adaptiveBatches:{},eventSyncedAt:now};
}
function project(s,role,baselines){
 if(baselines!==undefined)throw Error('팀전 평가의 시작 점수는 변경할 수 없습니다.');
 const ps=activePlayers(s),qs=questions(s),ids=new Set(qs.map(q=>q.id)),owner=role==='owner',filter=a=>Object.fromEntries(Object.entries(a||{}).filter(([id])=>ids.has(id))),votes=s.votes||{},evidence=Object.fromEntries(qs.map(q=>{const n={a:0,b:0,tie:0};for(const a of Object.values(votes))if(Object.hasOwn(n,a[q.id]))n[a[q.id]]++;const count=n.a+n.b+n.tie;return [q.id,{count,needsReview:count>0&&Math.max(...Object.values(n))<=count/2}];}));
 const count=Object.values(votes).reduce((n,a)=>n+Object.values(filter(a)).filter(v=>v!=='skip').length,0),totalCount=Object.values(votes).reduce((n,a)=>n+Object.values(a).filter(v=>v!=='skip').length,0);
 return {id:s.id,clubId:s.clubId||null,clubName:s.clubName,event:s.event,players:owner?ps:ps.map(({id,name,grade,gender,ageGroup})=>({id,name,grade,gender,ageGroup})),evaluators:activeEvaluators(s).map(({id,name,memberKey})=>({id,name,...(owner?{memberKey}:{})})),questions:qs,storedQuestionIds:qs.map(q=>q.id),assessmentVersion:2,boundaryIds:[],expiresAt:s.expiresAt,closed:!!s.closed,evidence,reviewedAt:s.reviewedAt||0,legacyCount:0,adaptiveSupported:true,needsIdentity:role==='shared',respondentName:respondent(s,role)?.name||null,answers:owner||role==='shared'?{}:filter(votes[role]),proposals:owner?core.measurementProposals(ps,qs,votes,s.players).map(p=>({...p,basis:ps.find(v=>v.id===p.id),eventRevision:s.event.revision})):[],count,totalCount,archivedCount:totalCount-count,archivedPlayerCount:s.players.length-ps.length,resultRevision:resultRevision(s)};
}
module.exports={creation,verifyCreation,activePlayers,activeEvaluators,activeSession,questions,answerQuestions,checkRevision,respondent,resultRevision,sync,project};
