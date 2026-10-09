'use strict';
const assert=require('assert'),crypto=require('crypto'),fs=require('fs'),vm=require('vm'),C=require('../functions/skill-calibration-core'),S=require('../functions/skill-calibration'),A=require('../functions/skill-adaptive-batch');
const h=s=>crypto.createHash('sha256').update(s).digest('hex'),id='a'.repeat(32),owner='b'.repeat(32),shared='c'.repeat(32),now=Date.now();
const players=C.players(Array.from({length:16},(_,i)=>({name:'E2E배정'+i,grade:i<8?'C':'B',gender:'남',ageGroup:'40대'}))),questions=C.pairs(players),keys=Array.from({length:8},(_,i)=>(i+1).toString(16).repeat(32));
const initial={id,owner:h(owner),shared:h(shared),clubName:'E2E',players,questions,assessmentVersion:2,votes:{},participants:Object.fromEntries(keys.map((key,i)=>['p'+i,{key:h(key)}])),invites:[h('d'.repeat(32)),h('e'.repeat(32)),h('f'.repeat(32))],expiresAt:now+86400000};
let value=structuredClone(initial),cold=true;
const db={ref:p=>({once:async()=>({val:()=>structuredClone(p==='skillCalibration/'+id?value:null)}),transaction:async fn=>{
  if(cold){assert.equal(fn(null),null,'cold cache must retry');cold=false;}
  const next=fn(structuredClone(value));if(next!==undefined)value=next;return {committed:next!==undefined,snapshot:{val:()=>structuredClone(value)}};
}})};
const request=(i,req=(i+3).toString(16).repeat(32),time=now)=>S.handle(db,{action:'batch',id,key:keys[i],requestId:req},'local',time);
(async()=>{
  const results=await Promise.all(Array.from({length:7},(_,i)=>request(i))),seen=new Set();
  for(const result of results){assert.equal(result.adaptiveBatch.questions.length,10);assert.equal(result.proposals.length,0,'participant must not receive full score proposals');assert(!result.adaptiveBatches);assert(result.adaptiveSupported);for(const q of result.adaptiveBatch.questions){assert(!seen.has(q.id),'simultaneous allocation spreads initial work');seen.add(q.id);assert(questions.some(p=>p.id===q.id));}}
  assert.deepEqual(value.votes,initial.votes);assert.deepEqual(value.players,initial.players);assert.equal(value.owner,initial.owner);
  const snapshot=JSON.stringify(value),retry=await request(0);assert.deepEqual(retry.adaptiveBatch,results[0].adaptiveBatch);assert.equal(JSON.stringify(value),snapshot,'same request replays without creating another lease');
  const active=await request(0,'9'.repeat(32));assert.deepEqual(active.adaptiveBatch,results[0].adaptiveBatch,'new request cannot replace an unfinished active lease');
  const answers=Object.fromEntries(results[0].adaptiveBatch.questions.map(q=>[q.id,'tie']));
  for(let i=0;i<10;i+=5)await S.handle(db,{action:'answer',id,key:keys[0],answers:Object.fromEntries(Object.entries(answers).slice(i,i+5))},'local',now+1);
  const next=await request(0,'9'.repeat(32),now+2);assert(next.adaptiveBatch.questions.every(q=>!Object.hasOwn(answers,q.id)));assert.equal(next.adaptiveBatch.questions.length,10);
  const replay=await request(0);assert.deepEqual(replay.adaptiveBatch,results[0].adaptiveBatch,'late retry of completed batch cannot allocate new work');
  const expired=await request(7,'a'.repeat(32),now+A.ttl+10);assert(expired.adaptiveBatch.questions.length);
  await assert.rejects(S.handle(db,{action:'batch',id,key:shared,requestId:'a'.repeat(32)},'local',now));
  await assert.rejects(S.handle(db,{action:'batch',id,key:'0'.repeat(32),requestId:'a'.repeat(32)},'local',now));
  await assert.rejects(S.handle(db,{action:'batch',id,key:keys[0],requestId:'wrong'},'local',now));
  value.closed=true;await assert.rejects(request(0));value.closed=false;
  const same=C.players(Array.from({length:8},(_,i)=>({name:'E2E상충'+i,grade:'C',gender:'남',ageGroup:'40대'}))),qs=C.pairs(same),v=Object.fromEntries(qs.map(q=>[q.id,q.id==='p0_p7'?'tie':'a']));
  const conflict={...initial,players:same,questions:qs,votes:{e0:v,e1:v,e2:v},adaptiveBatches:{}};
  const selected=A.allocate(conflict,'u_p0','a'.repeat(32),now).batch.questions;
  assert(selected.some(q=>q.id==='p0_p7'&&q.reason.includes('상충')),'participant allocation uses the fitted score, not only vote counts');
  const confirm={...conflict,votes:{e0:v}},assigned=A.allocate(confirm,'u_p0','a'.repeat(32),now);
  const other=A.allocate(assigned.state,'u_p1','b'.repeat(32),now).batch.questions;
  assert(other.some(q=>q.id==='p0_p7'&&q.reason.includes('상충')),'important contradictory pair can intentionally overlap despite reservations');
  const capped={...initial,questions:questions.slice(0,3),adaptiveBatches:{}};assert(A.allocate(capped,'u_p0','a'.repeat(32),now).batch.questions.every(q=>capped.questions.some(p=>p.id===q.id)),'no unauthorized question expansion');
  const planner=require('../functions/skill-boundary-plan'),bad={module:{exports:{}}};vm.runInNewContext(fs.readFileSync('functions/skill-adaptive-batch.js','utf8').replace('reservationCounts,...','reservationCounts:{},...'),{...bad,require:n=>n==='./skill-calibration-core'?C:n==='./skill-assessment-reference'?require('../functions/skill-assessment-reference'):n==='./skill-boundary-plan'?planner:require(n)});
  const allocated=A.allocate(initial,'u_p0','a'.repeat(32),now),proper=A.allocate(allocated.state,'u_p1','b'.repeat(32),now).batch.questions,broken=bad.module.exports.allocate(allocated.state,'u_p1','b'.repeat(32),now).batch.questions;
  assert.notDeepEqual(proper.map(q=>q.id),broken.map(q=>q.id),'reservation removal mutation must change distribution');
  console.log('adaptive batch: seven concurrent respondents, lease/idempotency/expiry/cold cache, separate answers, rights, original preservation, fitted contradiction and allowed question bounds, mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
