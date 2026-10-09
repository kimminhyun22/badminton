'use strict';
const crypto=require('crypto'),core=require('./skill-calibration-core'),reference=require('./skill-assessment-reference'),planner=require('./skill-boundary-plan');
const ttl=15*60*1000;
function allocate(s,role,requestId,now,merged){
  if(role==='shared'||s.assessmentVersion!==2||s.closed||s.expiresAt<=now)throw Error('열린 평가에서 본인 이름을 선택해 주세요.');
  if(!/^[a-f0-9]{32}$/.test(requestId||''))throw Error('평가 묶음 요청을 확인해 주세요.');
  const effective=merged?.session||s,questions=reference.questions(effective),own=role==='owner'?s.votes?.['owner-review']||{}:
    {...(role.startsWith('u_')?effective.votes?.['member:'+role.slice(2)]:{}),...s.votes?.[role]};
  const prior=s.adaptiveBatches?.[role];
  if(prior?.history?.[requestId])return {state:s,batch:prior.history[requestId]};
  if(prior?.current?.expiresAt>now&&prior.current.questions.some(q=>!Object.hasOwn(own,q.id)))return {state:s,batch:prior.current};
  const reservationCounts={};
  for(const [who,entry] of Object.entries(s.adaptiveBatches||{})){
    const current=entry.current;if(who===role||!current||current.expiresAt<=now)continue;
    const answers=who==='owner'?s.votes?.['owner-review']:s.votes?.[who];
    for(const q of current.questions)if(!Object.hasOwn(answers||{},q.id))reservationCounts[q.id]=(reservationCounts[q.id]||0)+1;
  }
  const evidence=Object.fromEntries(questions.map(q=>{
    const counts={a:0,b:0,tie:0};for(const v of Object.values(effective.votes||{}))if(Object.hasOwn(counts,v[q.id]))counts[v[q.id]]++;
    const count=counts.a+counts.b+counts.tie;return [q.id,{count,needsReview:count>0&&Math.max(...Object.values(counts))<=count/2}];
  }));
  const session={players:effective.players,questions,allowedQuestionIds:questions.map(q=>q.id),evidence,ownerAnswers:own,
    proposals:core.measurementProposals(effective.players,questions,effective.votes,merged?.anchors||s.players),
    reservationCounts,...(role==='owner'&&merged?{reusedQuestionIds:merged.reusedQuestionIds}:{})};
  const selected=planner.nextQuestions(session,10),batch={id:crypto.createHash('sha256').update(s.id+role+requestId).digest('hex').slice(0,32),requestId,questions:selected,issuedAt:now,expiresAt:now+ttl};
  const history=Object.fromEntries(Object.entries(prior?.history||{}).sort((a,b)=>b[1].issuedAt-a[1].issuedAt).slice(0,3));history[requestId]=batch;
  return {state:{...s,adaptiveBatches:{...s.adaptiveBatches,[role]:{current:batch,history}}},batch};
}
module.exports={allocate,ttl};
