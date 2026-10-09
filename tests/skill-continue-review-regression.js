'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),C=require('../functions/skill-calibration-core'),P=require('../functions/skill-boundary-plan');
const source=fs.readFileSync('js/club-skill-review.js','utf8');
const players=C.players(Array.from({length:16},(_,i)=>({name:'E2E'+i,grade:i<8?'C':'B',gender:'남',ageGroup:'40대'}))),questions=C.pairs(players);
function context(code=source){
  const ctx={session:{players,questions,reviewQuestionIds:questions.slice(0,20).map(q=>q.id),answers:Object.fromEntries(questions.slice(0,20).map(q=>[q.id,'a'])),assessmentVersion:2,evidence:{},expiresAt:Date.now()+100000},answers:{},evaluatingAsOwner:false,ownerLink:()=>null,window:{KokSkillPlan:P},read:()=>({}),active:{id:'test',key:'test'},Date};
  const fragment=code.slice(code.indexOf('  function reviewQuestions('),code.indexOf('  function renderQuizProgress('));
  vm.runInNewContext(fragment+';this.pool=ownerMeasurementQuestions;this.plan=reviewPlan;this.more=hasMoreComparisons;this.progress=cumulativeProgress;',ctx);return ctx;
}
function check(ctx){
  const batch=ctx.plan(ctx.pool(),ctx.session.answers,{},[],null,{},players);
  assert.equal(batch.length,20,'participant can continue beyond the exhausted recommended twenty');
  assert(!batch.some(q=>Object.hasOwn(ctx.session.answers,q.id)),'already answered pairs excluded');
  assert.equal(ctx.more(),true);
  assert.equal(ctx.progress().count,20);assert.equal(ctx.progress().goal,undefined,'no fixed respondent quota');assert.equal(ctx.progress().percent,undefined,'contribution is not readiness');
  for(let i=0;i<4;i++){
    const next=ctx.plan(ctx.pool(),ctx.session.answers,{},[],null,{},players);
    assert.equal(next.length,20);for(const q of next)ctx.session.answers[q.id]='tie';
  }
  assert.equal(ctx.progress().count,100);assert.equal(ctx.more(),true,'100 responses cannot impose a lifetime cap');
  const before=ctx.progress().count;ctx.answers={[questions.find(q=>!Object.hasOwn(ctx.session.answers,q.id)).id]:'skip'};assert.equal(ctx.progress().count,before,'unknown votes do not count as useful evaluation');
  ctx.session.closed=true;assert.equal(ctx.more(),false);
}
check(context());
const restriction="    if(session.reviewQuestionIds?.length){const ids=new Set(session.reviewQuestionIds);return session.questions.filter(q=>ids.has(q.id));}\n";
assert.throws(()=>check(context(source.replace('    // A recommended set is a starting batch, never a participant\'s lifetime limit.',restriction))),'restored lifetime restriction must fail');
const owner=context();owner.evaluatingAsOwner=true;owner.session.proposals=C.measurementProposals(players,questions,{reviewer:owner.session.answers});assert.equal(owner.more(),true,'owners can request the next adaptive set');
assert(source.includes("$('more').onclick=continueReview"));assert(source.includes("session=await api({action:'read',...active});"));assert(source.includes('busy=false;startBatch();'));
assert(!source.includes('Math.min(100,known.size)'));assert(!source.includes('내 평가 목표'));
assert(source.includes('초기 준비 → 명부 반영 → 필요한 비교로 추가 보정'));
const initialVotes={first:Object.fromEntries(questions.map(q=>[q.id,'tie']))};
const initialProposals=C.measurementProposals(players,questions,initialVotes);
assert(initialProposals.every(p=>p.reviewed),'initial minimum evidence can prepare scores before a respondent quota');
const stored=players.map((p,i)=>({...p,skillRating:initialProposals[i].skillRating})),snapshot=JSON.stringify({players,stored,initialVotes});
const extraVotes={...initialVotes,second:{[questions[0].id]:'a'},third:{[questions[0].id]:'a'}};
const refined=C.measurementProposals(stored,questions,extraVotes,players),direct=C.measurementProposals(players,questions,extraVotes,players);
assert(refined.some(p=>p.ready&&p.skillRating!==p.currentRating),'additional evidence after initial application prepares a new correction');
assert.deepEqual(refined.map(p=>p.skillRating),direct.map(p=>p.skillRating),'stored prior results cannot compound a new correction');
assert.deepEqual(C.measurementProposals(stored,questions,extraVotes,players),refined,'refreshing keeps the same correction');
assert.equal(JSON.stringify({players,stored,initialVotes}),snapshot,'planning additional correction preserves prior data');
console.log('continuation: no quota, distinct batches, skip/closure, owner next batch, mutation; initial score then new correction without compounded priors or writes passed');
