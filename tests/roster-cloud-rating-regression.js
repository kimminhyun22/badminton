'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../functions/skill-event-core'),B=require('../js/club-skill-batch');
const R=require('../functions/roster-cloud'),T=require('../js/roster-transfer');
const clone=v=>structuredClone(v);
const evaluator=Array.from({length:3},(_,i)=>({memberKey:'E2E-officer-'+i,name:'E2E임원'+i}));
function fit(kind){
  const members=Array.from({length:8},(_,i)=>({memberId:'E2E-member-'+i,name:'E2E회원'+i,
    grade:kind==='lower'?'E':'S',gender:kind==='lower'?'여':'남',ageGroup:kind==='lower'?'60대+':'20대',skillStep:0,
    level:kind==='lower'?1:10,...(kind==='upper'?{skillRating:10}:{}),isClubOfficial:i===0}));
  const original={clubs:[{id:'E2E-'+kind,name:'E2E클럽',members}]},before=JSON.stringify(original);
  const session={...E.creation({event:{id:'E2E-event-'+kind,title:'E2E 팀전'},clubName:'E2E클럽',players:members.map(m=>({...m,memberKey:m.memberId})),evaluators:evaluator}),id:'E2E-review-'+kind};
  const votes=Object.fromEntries(session.questions.map(q=>[q.id,'a']));
  session.votes=Object.fromEntries(evaluator.map((_,i)=>['u_r'+i,clone(votes)]));
  const projected=E.project(session,'owner');
  assert(projected.proposals.every(p=>p.ready&&p.experts===3&&p.resolved===7));
  const prepared=B.prepare(original,original.clubs[0].id,projected.proposals.map(p=>({id:p.id,original:members[Number(p.id.slice(1))],step:p.step,skillRating:p.skillRating})),session.id,'E2E-batch',200,{kind:'team-event',createdAt:100});
  const club=prepared.state.clubs[0];
  assert.equal(JSON.stringify(original),before,'fitting and preparing do not mutate the official roster');
  assert(kind==='lower'?club.members.some(m=>m.level<0):club.members.some(m=>m.level>10),'actual fitted scores cross the old cloud boundary');
  assert.deepEqual(R.cleanClub(club),club,'cloud cleaning preserves fitted scores and provenance exactly');
  const imported=T.clean(T.packet(club))[0];
  assert.deepEqual(imported.members.map(m=>[m.skillRating,m.level]),club.members.map(m=>[m.skillRating,m.level]),'transfer and cloud agree on learned score range');
  return {original,club,session};
}
const lower=fit('lower'),upper=fit('upper');
assert.equal(Math.min(...lower.club.members.map(m=>m.skillRating)),-2.514);
const base={...lower.original.clubs[0].members[0]},clubFor=m=>({id:'E2E-validation',name:'E2E클럽',members:[m]});
for(const absent of [{},{skillRating:null},{skillRating:undefined}]){
  for(const level of [0,10]){const input=clubFor({...base,...absent,level});assert.equal(R.cleanClub(input).members[0].level,level);T.clean({clubs:[input]});}
  for(const level of [-.001,10.001]){const input=clubFor({...base,...absent,level});assert.throws(()=>R.cleanClub(input));assert.throws(()=>T.clean({clubs:[input]}));}
}
for(const skillRating of [NaN,Infinity,-Infinity,'3',{},false])for(const level of [1,-1,11]){
  const input=clubFor({...base,level,skillRating});assert.throws(()=>R.cleanClub(input),'invalid supplied ratings cannot bypass validation');assert.throws(()=>T.clean({clubs:[input]}));
}
for(const level of [NaN,Infinity,-Infinity,null,undefined,'1'])for(const skillRating of [undefined,3]){
  const input=clubFor({...base,level,skillRating});assert.throws(()=>R.cleanClub(input),'level remains a required finite number');assert.throws(()=>T.clean({clubs:[input]}));
}
assert.equal(R.cleanClub(clubFor({...base,skillRating:null})).members[0].skillRating,null,'null remains a missing learned score, not zero');
assert(!Object.hasOwn(R.cleanClub(clubFor(base)).members[0],'skillRating'),'legacy missing score stays absent');
const data=new Map(),snapshot=v=>({val:()=>v==null?null:clone(v)});
const db={ref(path){return {async once(){return snapshot(data.get(path));},child(id){return db.ref(path+'/'+id);},async set(v){data.set(path,clone(v));},async transaction(fn){const value=fn(clone(data.get(path)??null));if(value===undefined)return {committed:false,snapshot:snapshot(data.get(path))};data.set(path,clone(value));return {committed:true,snapshot:snapshot(value)};}};}};
(async()=>{
  const owner={uid:'E2E-owner',token:{email_verified:true}},stranger={uid:'E2E-stranger',token:{email_verified:true}};
  for(const [index,fixture] of [lower,upper].entries()){
    const created=await R.handle(db,owner,{action:'create',club:fixture.original.clubs[0]},100);
    const request={action:'save',id:created.id,revision:1,operationId:'E2E-rating-save-'+index,club:fixture.club};
    const saved=await R.handle(db,owner,request,200);assert.deepEqual(saved.club,fixture.club);
    assert.deepEqual((await R.handle(db,owner,{action:'read',id:created.id})).club,fixture.club,'authenticated cloud read returns exact fitted scores');
    assert.deepEqual((await R.handle(db,owner,request,201)).club,fixture.club,'same write retry is idempotent');
    await assert.rejects(R.handle(db,stranger,{action:'read',id:created.id}),{code:'permission-denied'});
    await assert.rejects(R.handle(db,owner,{...request,operationId:'E2E-stale-write-'+index}),{code:'aborted'});
    const restored=await R.handle(db,owner,{action:'restore',id:created.id,revision:2,operationId:'E2E-rating-undo-'+index,target:1},300);
    assert.deepEqual(restored.club,fixture.original.clubs[0],'history restoration retains the exact pre-calibration score');
  }
  // The actual lower-range fit must catch a return to the old unconditional bound.
  const source=fs.readFileSync(require.resolve('../functions/roster-cloud'),'utf8');
  const mutant={module:{exports:{}},require,Buffer};
  vm.runInNewContext(source.replace('(!Number.isFinite(m.skillRating)&&(m.level<0||m.level>10))','(m.level<0||m.level>10)'),mutant);
  assert.throws(()=>mutant.module.exports.cleanClub(lower.club),'mutation detects a regression to clipping or rejection at the old range');
  console.log('roster learned ratings: actual event fit → prepare → cloud/transfer roundtrip; lower/upper, null/invalid/legacy bounds, auth, retries, stale writes, history and mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
