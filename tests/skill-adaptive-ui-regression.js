'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),crypto=require('crypto'),C=require('../functions/skill-calibration-core'),S=require('../functions/skill-calibration');
const source=fs.readFileSync('js/club-skill-review.js','utf8'),h=s=>crypto.createHash('sha256').update(s).digest('hex'),id='a'.repeat(32),key='b'.repeat(32);
const players=C.players(Array.from({length:16},(_,i)=>({name:'E2E자동'+i,grade:i<8?'C':'B',gender:'남',ageGroup:'40대'})));
function environment(code=source){
  let value={id,clubName:'E2E',players,questions:C.pairs(players),assessmentVersion:2,owner:h('c'.repeat(32)),invites:[h(key),h('d'.repeat(32)),h('e'.repeat(32))],votes:{},expiresAt:Date.now()+86400000},calls=0,request=0;
  const values={},db={ref:p=>({once:async()=>({val:()=>structuredClone(p==='skillCalibration/'+id?value:null)}),transaction:async fn=>{const next=fn(structuredClone(value));if(next!==undefined)value=next;return {committed:next!==undefined,snapshot:{val:()=>structuredClone(value)}};}})};
  function mount(){
    const nodes={},buttons=['a','b','tie','skip'].map(v=>({dataset:{vote:v},setAttribute(){}})),$=i=>nodes[i]||(nodes[i]={hidden:false,disabled:false,textContent:'',querySelectorAll:()=>buttons});
    const ctx={$,Object,Date,Math,parseInt,window:{matchMedia:()=>({matches:true})},esc:String,at:0,batch:[],answers:{},busy:false,flipped:false,evaluatingAsOwner:false,adaptiveMode:false,autoCheckpointPending:false,visitCount:0,active:{id,key},
      session:S.project(value,'e0'),write:(k,v)=>values[k]=JSON.parse(JSON.stringify(v)),read:(k,f)=>values[k]??f,localStorage:{removeItem:k=>delete values[k]},ownerLink:()=>null,persist(){},message:s=>ctx.messageText=s,panels:s=>ctx.panel=s,
      nonce:()=> (++request).toString(16).padStart(32,'0'),api:async data=>{const result=await S.handle(db,data,'local');if(data.action==='answer'&&++calls===2)throw Error('save committed but reply lost');return result;}};
    vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('  function reviewQuestions('),code.indexOf("  $('ownerReturn').onclick=")),ctx);
    return {ctx,$,vote:value=>$('choices').onclick({target:{closest:()=>({dataset:{vote:value}})}})};
  }
  return {mount,values,state:()=>value};
}
async function idle(ctx){for(let i=0;i<100;i++){await new Promise(r=>setImmediate(r));if(!ctx.busy)return;}throw Error('UI did not settle');}
async function check(code=source){
  const e=environment(code);let f=e.mount();f.ctx.startBatch();await idle(f.ctx);assert.equal(f.ctx.batch.length,10);
  for(let i=0;i<10;i++)await f.vote('tie');await idle(f.ctx);assert.equal(Object.keys(e.state().votes.e0).length,10);assert(!f.$('retry').hidden,'automatic checkpoint exposes retry after lost reply');
  await f.$('retry').onclick();await idle(f.ctx);assert.equal(f.ctx.visitCount,10);assert.equal(f.ctx.at,0);assert.equal(f.ctx.batch.length,10);assert.equal(Object.keys(e.state().votes.e0).length,10);
  for(let i=0;i<3;i++)await f.vote('tie');f=e.mount();f.ctx.startBatch();await idle(f.ctx);assert.equal(f.ctx.at,3,'partial second checkpoint resumes');
  assert.equal(f.$('progress').textContent,'14 / 20문항');
  assert.equal(f.$('quizProgress').value,13);
  assert.equal(f.$('quizProgress').max,20);
  for(let i=0;i<7;i++)await f.vote('tie');await idle(f.ctx);assert.equal(f.ctx.panel,'done');assert.equal(f.ctx.visitCount,20);assert.equal(Object.keys(e.state().votes.e0).length,20);assert(!f.$('more').hidden);assert(f.$('doneText').textContent.includes('20문항의 응답을 자동 저장'));
  await f.$('more').onclick();await idle(f.ctx);assert.equal(f.ctx.at,0);assert.equal(f.ctx.visitCount,0);assert(f.ctx.batch.every(q=>!Object.hasOwn(e.state().votes.e0,q.id)));
  assert.deepEqual(e.state().players,players,'automatic checkpoints cannot change roster scores');
}
async function twoShortBatches(){
  const e=environment(),state=e.state(),requestId='f'.repeat(32);
  const prior={requestId,questions:state.questions.slice(0,4),issuedAt:Date.now(),expiresAt:Date.now()+600000};
  state.adaptiveBatches={e0:{current:prior,history:{[requestId]:prior}}};
  const f=e.mount();f.ctx.startBatch();await idle(f.ctx);assert.equal(f.ctx.batch.length,4);
  assert.equal(f.$('progress').textContent,'1 / 최대 14문항');
  for(let i=0;i<4;i++)await f.vote('tie');
  await idle(f.ctx);assert.equal(f.ctx.batch.length,10);
  assert.equal(f.$('progress').textContent,'5 / 14문항');
  assert.equal(f.$('quizProgress').value,4);
  for(let i=0;i<10;i++)await f.vote('tie');
  await idle(f.ctx);await f.$('retry').onclick();await idle(f.ctx);
  assert.equal(f.ctx.panel,'done','a short first lease must not trigger a third automatic batch');
  assert.equal(f.ctx.visitCount,14);assert(!f.$('more').hidden);
}
async function emptyThenRevisit(){
  const e=environment(),state=e.state(),first=state.questions[0].id;
  state.votes.e0=Object.fromEntries(state.questions.map(q=>[q.id,'tie']));
  let f=e.mount();f.ctx.startBatch();await idle(f.ctx);
  assert.equal(f.ctx.panel,'done');
  const draft='kokmatch_skill_draft_'+id+'_'+key;
  assert(!e.values[draft+'_adaptiveRequest'],'a completed empty lease must not pin future visits');
  e.values[draft]={[first]:'a'};f=e.mount();f.ctx.startBatch();await idle(f.ctx);
  assert.equal(f.ctx.panel,'quiz');assert(!f.$('finishReview').hidden,'an earlier valid local edit remains reviewable');
  await f.$('saveAnswers').onclick();assert.equal(state.votes.e0[first],'tie');
  assert.equal(e.state().votes.e0[first],'a','a pending allowed edit can be saved');
  delete e.state().votes.e0[first];
  f=e.mount();f.ctx.startBatch();await idle(f.ctx);assert.equal(f.ctx.panel,'quiz');assert.equal(f.ctx.batch[0].id,first);
}
(async()=>{await check();await twoShortBatches();await emptyThenRevisit();await assert.rejects(check(source.replace('if(adaptiveMode){autoCheckpointPending=true;submit(true);return;}','if(false){autoCheckpointPending=true;submit(true);return;}')),'manual-only checkpoint mutation must fail');console.log('adaptive UI: automatic 10+10, partial commit/reply loss/retry, reload, exactly twenty then optional next, no repeated votes or score writes, mutation passed');})().catch(e=>{console.error(e);process.exitCode=1;});
