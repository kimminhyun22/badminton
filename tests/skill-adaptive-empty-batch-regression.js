'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const S=require('../functions/skill-calibration'),A=require('../functions/skill-adaptive-batch');
const now=1900000000000,owner='b'.repeat(32),shared='c'.repeat(32),keys=['1'.repeat(32),'2'.repeat(32)];
const request=n=>n.toString(16).padStart(32,'0');
// RTDB deletes nulls and recursively empty arrays/objects, including a batch's
// questions:[] while retaining the batch's scalar metadata and history entry.
function prune(value){
  if(value==null)return undefined;
  if(typeof value!=='object')return value;
  if(Array.isArray(value)){const a=value.map(v=>prune(v)??null);return a.some(v=>v!==null)?a:undefined;}
  const entries=Object.entries(value).flatMap(([key,v])=>{const cleaned=prune(v);return cleaned===undefined?[]:[[key,cleaned]];});
  return entries.length?Object.fromEntries(entries):undefined;
}
function database(){const values={};return {values,ref:p=>({once:async()=>({val:()=>structuredClone(values[p]??null)}),transaction:async fn=>{
  assert.notEqual(fn(null),undefined,'cold local cache must permit server retry');
  const next=fn(structuredClone(values[p]??null));if(next!==undefined){const saved=prune(next);if(saved===undefined)delete values[p];else values[p]=saved;}
  return {committed:next!==undefined,snapshot:{val:()=>structuredClone(values[p]??null)}};
}})};}
const empty=batch=>assert(Array.isArray(batch.questions)&&batch.questions.length===0,'completed batch must return questions:[]');
function load(file,transform){const source=fs.readFileSync(require.resolve('../functions/'+file),'utf8'),changed=transform(source);assert.notEqual(source,changed,'mutation target must exist');const context={module:{exports:{}},require:n=>n.startsWith('.')?require(path.resolve(__dirname,'../functions',n)):require(n)};vm.runInNewContext(changed,context);return context.module.exports;}
async function exercise(eventMode){
  const id=(eventMode?'a':'f').repeat(32),db=database(),store='skillCalibration/'+id;
  const players=Array.from({length:eventMode?8:4},(_,i)=>({memberKey:'E2E-member-'+i,name:'E2E선수'+i,grade:'C',gender:'남',ageGroup:'40대'}));
  const call=(data,server=S)=>server.handle(db,{id,key:owner,...data},'E2E-empty-'+eventMode,now);
  const payload={action:'create',clubName:'E2E클럽',players,assessmentVersion:2,invites:['d','e','f'].map(v=>v.repeat(32)),...(eventMode?{event:{id:'E2E-event',title:'E2E팀전'},evaluators:[{memberKey:players[0].memberKey,name:players[0].name},{memberKey:'E2E-officer',name:'E2E외부임원'}]}:{})};
  await call(payload);assert(!Object.hasOwn(db.values[store],'votes'),'empty vote object is actually pruned');
  await call({action:'share',sharedKey:shared});
  for(let i=0;i<2;i++)await call({action:'join',key:shared,playerId:(eventMode?'r':'p')+i,respondentKey:keys[i]});
  const revision=eventMode?{expectedRevision:1}:{},role=eventMode?'u_r0':'u_p0';let completedRequest,batchCount=0;
  const seen=new Set();
  for(let i=1;i<20;i++){
    const response=await call({action:'batch',key:keys[0],requestId:request(i),...revision}),batch=response.adaptiveBatch;
    assert(Array.isArray(batch.questions),'even the first completed response must restore the pruned array');
    if(!batch.questions.length){completedRequest=request(i);break;}
    batchCount++;for(const q of batch.questions){assert(!seen.has(q.id));seen.add(q.id);if(eventMode)assert(q.a!=='p0'&&q.b!=='p0');}
    for(let j=0;j<batch.questions.length;j+=5)await call({action:'answer',key:keys[0],answers:Object.fromEntries(batch.questions.slice(j,j+5).map(q=>[q.id,'tie'])),...revision});
  }
  assert(completedRequest,'bounded fixture reaches the completion response');assert.equal(seen.size,eventMode?21:6);
  const stored=db.values[store];assert.equal(Object.keys(stored.votes[role]).length,seen.size);
  assert(!Object.hasOwn(stored.adaptiveBatches[role].current,'questions'),'fixture reproduces real pruned current');
  assert(!Object.hasOwn(stored.adaptiveBatches[role].history[completedRequest],'questions'),'fixture reproduces real pruned history');
  const savedVotes=JSON.stringify(stored.votes),beforeReplay=JSON.stringify(stored);
  empty((await call({action:'batch',key:keys[0],requestId:completedRequest,...revision})).adaptiveBatch);
  assert.equal(JSON.stringify(db.values[store]),beforeReplay,'completed request replay does not rewrite the session');
  empty(A.allocate(stored,role,completedRequest,now).batch);
  empty(A.allocate(stored,role,request(50),now).batch);
  empty((await call({action:'batch',key:keys[0],requestId:request(50),...revision})).adaptiveBatch);
  const other=await call({action:'batch',key:keys[1],requestId:request(51),...revision});
  assert(other.adaptiveBatch.questions.length>0,'another evaluator allocates normally past a completed empty reservation');
  assert.equal(JSON.stringify(db.values[store].votes),savedVotes,'completion/replay and new allocation never erase or add answers');
  assert.equal((await call({action:'read'})).count,seen.size);
  return {db,store,stored,role,call,revision,completedRequest,batchCount};
}
(async()=>{
  assert.equal(prune({questions:[],votes:{},metadata:{empty:[]}}),undefined);
  const e=await exercise(true);await exercise(false);
  const noHistory=load('skill-adaptive-batch',s=>s.replace('batch:batchView(prior.history[requestId])','batch:prior.history[requestId]'));
  assert.throws(()=>empty(noHistory.allocate(e.stored,e.role,e.completedRequest,now).batch),'mutation catches missing history normalization');
  const noCurrent=load('skill-adaptive-batch',s=>s.replace('(prior.current.questions||[]).some','prior.current.questions.some'));
  assert.throws(()=>noCurrent.allocate(e.stored,e.role,request(60),now),'mutation catches missing current fallback');
  const noReservations=load('skill-adaptive-batch',s=>s.replace('for(const q of current.questions||[])','for(const q of current.questions)'));
  assert.throws(()=>noReservations.allocate(e.stored,'u_r1',request(61),now),'mutation catches another reviewer traversing empty reservations');
  const noProjection=load('skill-calibration',s=>s.replace('adaptiveBatch:{...batch,questions:batch.questions||[]}','adaptiveBatch:batch'));
  await assert.rejects(async()=>empty((await e.call({action:'batch',key:keys[0],requestId:e.completedRequest,...e.revision},noProjection)).adaptiveBatch),'mutation catches API returning a pruned array');
  console.log('adaptive empty batches: RTDB empty array/object pruning, all 21 event / 6 legacy answers preserved, first completion, replay, fresh request, second evaluator, cold cache and four mutations passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
