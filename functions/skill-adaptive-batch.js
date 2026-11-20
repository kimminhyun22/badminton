'use strict';
const crypto=require('crypto'),core=require('./skill-calibration-core'),reference=require('./skill-assessment-reference'),planner=require('./skill-boundary-plan');
const ttl=15*60*1000;
function clubAnswerQuestions(questions,role){
  const self=/^u_(p\d+)$/.exec(role)?.[1];
  return self?questions.filter(q=>q.a!==self&&q.b!==self):questions;
}
// Reference materialization maps named voters into member:pN. Anonymous invite
// and owner slots cannot establish that two different people judged a boundary.
function evidenceFor(s,questions,votes){
  const ballots=Object.entries(votes||{}),reviewers=core.namedReviewers(s,votes);
  return Object.fromEntries(questions.map(q=>{
    const counts={a:0,b:0,tie:0},values=[];
    for(const [who,answers] of ballots){
      const value=answers[q.id];if(!Object.hasOwn(counts,value))continue;
      counts[value]++;values.push({who,value});
    }
    const count=counts.a+counts.b+counts.tie;
    const {namedJudgments,directionalSupport}=core.namedEvidence(q,values,reviewers);
    return [q.id,{count,needsReview:count>0&&Math.max(...Object.values(counts))<=count/2,namedJudgments,directionalSupport}];
  }));
}
function allocate(s,role,requestId,now,merged){
  if(role==='shared'||s.event&&role==='owner'||s.assessmentVersion!==2||s.closed||s.expiresAt<=now)throw Error('열린 평가에서 본인 이름을 선택해 주세요.');
  if(!/^[a-f0-9]{32}$/.test(requestId||''))throw Error('평가 묶음 요청을 확인해 주세요.');
  const event=s.event?require('./skill-event-core'):null;
  if(event&&!event.respondent(s,role))throw Error('현재 평가자로 등록되어 있지 않습니다.');
  const effective=event?event.activeSession(s):merged?.session||s,questions=event?event.questions(s):reference.questions(effective),allowed=event?event.answerQuestions(s,role):clubAnswerQuestions(questions,role);
  const answersFor=who=>who==='owner'?s.votes?.['owner-review']||{}:{...(who.startsWith('u_')?effective.votes?.['member:'+who.slice(2)]:{}),...s.votes?.[who]};
  const own=answersFor(role),allowedIds=new Set(allowed.map(q=>q.id));
  // RTDB drops empty arrays. Filter leases from before self-exclusion without
  // altering the stored historical request or any existing answers.
  const batchView=batch=>({...batch,questions:(batch.questions||[]).filter(q=>allowedIds.has(q.id))});
  const prior=s.adaptiveBatches?.[role];
  const currentRevision=b=>!event||b?.eventRevision===s.event.revision;
  if(prior?.history?.[requestId]&&currentRevision(prior.history[requestId]))return {state:s,batch:batchView(prior.history[requestId])};
  if(prior?.current?.expiresAt>now&&currentRevision(prior.current)&&(prior.current.questions||[]).some(q=>allowedIds.has(q.id)&&!Object.hasOwn(own,q.id)))return {state:s,batch:batchView(prior.current)};
  const reservationCounts={},namedReservations={};
  for(const [who,entry] of Object.entries(s.adaptiveBatches||{})){
    const current=entry.current;if(who===role||!current||current.expiresAt<=now||!currentRevision(current))continue;
    if(event&&!event.respondent(s,who))continue;
    const judge=core.namedReviewer(s,who),answers=answersFor(who);
    for(const q of current.questions||[]){
      if(Object.hasOwn(answers,q.id)||judge&&(judge.self===q.a||judge.self===q.b))continue;
      reservationCounts[q.id]=(reservationCounts[q.id]||0)+1;
      if(judge)namedReservations[q.id]=(namedReservations[q.id]||0)+1;
    }
  }
  const evidence=evidenceFor(s,questions,effective.votes);
  const session={...(event?{eventOnly:true,latePlayerIds:event.latePlayerIds(s)}:{}),players:effective.players,questions,allowedQuestionIds:[...allowedIds],evidence,ownerAnswers:own,
    proposals:event?event.measurementProposals(s,effective.players,questions):core.measurementProposals(effective.players,questions,effective.votes,merged?.anchors||s.players),
    namedConfirmation:!!core.namedReviewer(s,role),namedReservations,reservationCounts,...(role==='owner'&&merged?{reusedQuestionIds:merged.reusedQuestionIds}:{})};
  const selected=planner.nextQuestions(session,10),batch={id:crypto.createHash('sha256').update(s.id+role+requestId+(event?':'+s.event.revision:'')).digest('hex').slice(0,32),requestId,questions:selected,issuedAt:now,expiresAt:now+ttl,...(event?{eventRevision:s.event.revision}:{})};
  const history=Object.fromEntries(Object.entries(prior?.history||{}).filter(([,batch])=>currentRevision(batch)).sort((a,b)=>b[1].issuedAt-a[1].issuedAt).slice(0,3));history[requestId]=batch;
  return {state:{...s,adaptiveBatches:{...s.adaptiveBatches,[role]:{current:batch,history}}},batch};
}
module.exports={allocate,ttl,clubAnswerQuestions,evidenceFor};
