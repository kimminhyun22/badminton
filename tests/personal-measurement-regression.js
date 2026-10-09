'use strict';
const assert=require('assert'),crypto=require('crypto'),fs=require('fs'),vm=require('vm');
const core=require('../functions/skill-calibration-core'),{handle,project}=require('../functions/skill-calibration');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function fixture(){
  const now=Date.now(),id='1'.repeat(32),key='2'.repeat(32),invites=['3','4','5'].map(s=>s.repeat(32));
  const players=core.players(Array.from({length:20},(_,i)=>({name:'E2E선수'+i,grade:i<10?'D':'C',gender:'남',ageGroup:'20대',skillStep:0,level:i<10?3:4})));
  const questions=core.measurementPairs(players),votes={};let n=0;
  for(let j=0;j<7;j++){votes['u_e2e'+j]={};for(const q of questions)if(n++<620)votes['u_e2e'+j][q.id]='a';}
  const session={id,owner:hash(key),invites:invites.map(hash),shared:hash('6'.repeat(32)),players,questions,votes,participants:{p0:{key:hash('7'.repeat(32))}},clubName:'E2E 예시 클럽',createdAt:now,expiresAt:now+86400000};
  const values={['skillCalibration/'+id]:session};
  const db={values,ref(path){return {async once(){return {val:()=>structuredClone(values[path]??null)};},async transaction(fn){const first=fn(null);if(first===undefined)return {committed:false,snapshot:{val:()=>structuredClone(values[path]??null)}};const next=fn(structuredClone(values[path]??null));if(next!==undefined)values[path]=next;return {committed:next!==undefined,snapshot:{val:()=>structuredClone(values[path]??null)}};}};}};
  return {db,session,id,key,invites,now};
}
async function run(){
  const f=fixture(),before=structuredClone(f.session),path='skillCalibration/'+f.id;
  assert.equal(project(before,'owner').count,620,'synthetic 620 response preservation fixture');
  assert.deepEqual(project(before,'owner').storedQuestionIds,before.questions.map(q=>q.id),'preview distinguishes stored from projected all-pair questions');
  const legacy=core.proposals(before.players,before.questions,before.votes);
  assert(legacy.some(p=>p.ready),'fixture must expose within-grade inferred corrections');
  assert(project(before,'owner').proposals.every(p=>!p.ready),'legacy owner results also require grade connectivity');
  const params={action:'measurement',id:f.id,key:f.key,boundaryIds:['p0','p19']};
  let owner=await handle(f.db,params,'local',f.now);
  assert.equal(owner.count,620);assert.equal(owner.assessmentVersion,2);assert.equal(owner.questions.length,before.questions.length+1);
  for(const field of ['votes','players','participants','owner','invites','shared'])assert.deepEqual(f.db.values[path][field],before[field],field+' must survive extension exactly');
  assert.deepEqual(owner.questions.slice(0,before.questions.length),before.questions,'existing IDs, orientation and order survive');
  assert(owner.proposals.every(p=>!p.ready&&p.state==='평가 부족'),'disconnected grades cannot be applied');
  assert.deepEqual(owner.proposals.map(p=>p.skillRating),legacy.map(p=>p.skillRating),'inferred existing evidence is retained');
  owner=await handle(f.db,params,'local',f.now);assert.equal(owner.questions.length,91,'idempotent configuration');
  const cross=owner.questions.find(q=>q.kind==='cross-grade');assert(cross);assert.equal(cross.id,'p0_p19');
  for(const key of [f.invites[0],'6'.repeat(32),'7'.repeat(32)]){
    await assert.rejects(handle(f.db,{...params,key},'local',f.now));
    await assert.rejects(handle(f.db,{action:'assess',id:f.id,key,answers:{[cross.id]:'a'}},'local',f.now));
  }
  const preInvalid=JSON.stringify(f.db.values[path]);
  for(const boundaryIds of [['unknown'],['p0','p0']])await assert.rejects(handle(f.db,{...params,boundaryIds},'local',f.now));
  assert.equal(JSON.stringify(f.db.values[path]),preInvalid,'invalid selection is atomic');
  owner=await handle(f.db,{action:'assess',id:f.id,key:f.key,answers:{[cross.id]:'a'}},'local',f.now);
  assert.equal(owner.count,621);assert.equal(owner.ownerAnswers[cross.id],'a');
  assert(owner.proposals.every(p=>p.assessment.scaleConnected),'boundary bridges the existing same-grade evidence');
  assert(owner.proposals.some(p=>p.reviewed));
  const raw=core.proposals(owner.players,owner.questions,f.db.values[path].votes,before.players);
  assert.deepEqual(owner.proposals.map(p=>p.skillRating),raw.map(p=>p.skillRating),'comparison-v4 values remain exact; only readiness is gated');
  const thin=core.measurementProposals(before.players,owner.questions,{'owner-review':{[cross.id]:'a'}});
  assert(thin.every(p=>!p.ready),'one opponent cannot qualify an isolated member');
  await assert.rejects(handle(f.db,{action:'assess',id:f.id,key:f.key,answers:{}},'local',f.now));
  await assert.rejects(handle(f.db,{action:'assess',id:f.id,key:f.key,answers:Object.fromEntries(owner.questions.slice(0,6).map(q=>[q.id,'a']))},'local',f.now));
  assert(owner.proposals.every(p=>p.comparisons.every(c=>c.grade&&['same-grade','cross-grade'].includes(c.kind))));
  const retry=await handle(f.db,{action:'assess',id:f.id,key:f.key,answers:{[cross.id]:'a'}},'local',f.now);assert.equal(retry.count,621,'retry replaces the same owner vote');
  const publicResult=await handle(f.db,{action:'read',id:f.id,key:f.invites[0]},'local',f.now);
  assert.deepEqual(publicResult.proposals,[]);assert(!Object.hasOwn(publicResult,'ownerAnswers'));assert(!Object.hasOwn(publicResult.players[0],'base'));
  const conflicted=structuredClone(f.db.values[path]);conflicted.votes.other={[cross.id]:'b'};
  assert(core.measurementProposals(conflicted.players,conflicted.questions,conflicted.votes).every(p=>!p.assessment.scaleConnected&&!p.ready),'disputed bridge does not connect grades');
  conflicted.votes['owner-review'][cross.id]='skip';delete conflicted.votes.other;
  assert(core.measurementProposals(conflicted.players,conflicted.questions,conflicted.votes).every(p=>!p.assessment.scaleConnected),'skip is not comparison evidence');
  const current=before.players.map(p=>({...p,skillStep:1,level:p.level+.2}));
  const rebased=project(f.db.values[path],'owner',current);
  assert(rebased.proposals.every(p=>p.current===1&&p.basis.base===before.players.find(v=>v.id===p.id).base),'age and sex baseline not added twice');
  await assert.rejects(handle(f.db,{...params},'local',f.now+86400001));
  f.db.values[path].closed=true;
  await assert.rejects(handle(f.db,params,'local',f.now));
  await assert.rejects(handle(f.db,{action:'assess',id:f.id,key:f.key,answers:{[cross.id]:'a'}},'local',f.now));
  const source=fs.readFileSync('functions/skill-calibration-core.js','utf8'),ctx={module:{exports:{}}};
  vm.runInNewContext(source.replace('requiredGrades.every(g=>linkedGrades.includes(g))','true'),ctx);
  assert.throws(()=>assert(ctx.module.exports.measurementProposals(before.players,before.questions,before.votes).every(p=>!p.ready)),'mutation must detect missing grade connection gate');
  console.log('individual measurement: synthetic 620 preserved, IDs and originals stable, boundary evidence, permissions, retry, conflicts, insufficient evidence, private results, rebase, expiry and mutation passed');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture};
