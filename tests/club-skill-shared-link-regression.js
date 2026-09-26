'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const core=require('../functions/skill-calibration-core');
const source=fs.readFileSync('functions/skill-calibration.js','utf8');
function service(code=source){
  const ctx={require:n=>n==='./skill-calibration-core'?core:require(n),module:{exports:{}}};
  vm.runInNewContext(code,ctx);return ctx.module.exports.handle;
}
function database(){
  const values={};return {ref(path){return {once:async()=>({val:()=>structuredClone(values[path]??null)}),transaction:async fn=>{
    fn(null);const value=fn(structuredClone(values[path]??null));
    if(value!==undefined)values[path]=value;
    return {committed:value!==undefined,snapshot:{val:()=>structuredClone(values[path]??null)}};
  }};}};
}
async function run(handle){
  const db=database(),id='1'.repeat(32),key='2'.repeat(32),sharedKey='6'.repeat(32),a='7'.repeat(32),b='8'.repeat(32),other='9'.repeat(32);
  const call=data=>handle(db,{id,key,...data},'test');
  await call({action:'create',invites:['3','4','5'].map(n=>n.repeat(32)),clubName:'E2E밸런스',players:[0,1,2,3].map(i=>({name:'E2E'+i,grade:'C',gender:'남',ageGroup:'40대',level:4,skillStep:0}))});
  await call({action:'share',sharedKey});await call({action:'share',sharedKey});
  await assert.rejects(call({action:'share',sharedKey:other}));
  const lobby=await call({action:'read',key:sharedKey});assert(lobby.needsIdentity);assert.equal(Object.keys(lobby.answers).length,0);assert.equal(lobby.proposals.length,0);
  assert(!JSON.stringify(lobby).includes(a));
  await assert.rejects(call({action:'answer',key:sharedKey,answers:{[lobby.questions[0].id]:'a'}}));
  await assert.rejects(call({action:'join',key:sharedKey,playerId:'p999',respondentKey:a}));
  await Promise.all([call({action:'join',key:sharedKey,playerId:'p0',respondentKey:a}),call({action:'join',key:sharedKey,playerId:'p1',respondentKey:b})]);
  await call({action:'join',key:sharedKey,playerId:'p0',respondentKey:a});
  await assert.rejects(call({action:'join',key:sharedKey,playerId:'p0',respondentKey:other}));
  await assert.rejects(call({action:'join',key:sharedKey,playerId:'p2',respondentKey:a}));
  const q=lobby.questions[0].id;
  await Promise.all([call({action:'answer',key:a,answers:{[q]:'a'}}),call({action:'answer',key:b,answers:{[q]:'b'}})]);
  assert.equal((await call({action:'read',key:a})).answers[q],'a');
  assert.equal((await call({action:'read',key:b})).answers[q],'b');
  assert.equal((await call({action:'read'})).count,2);
  await call({action:'answer',key:a,answers:{[q]:'tie'}});
  assert.equal((await call({action:'read'})).count,2);
  assert.equal((await call({action:'read',key:b})).answers[q],'b');
  await assert.rejects(call({action:'close',key:a}));
  await assert.rejects(call({action:'share',key:b,sharedKey}));
  await call({action:'close'});
  await assert.rejects(call({action:'join',key:sharedKey,playerId:'p2',respondentKey:other}));
  await assert.rejects(call({action:'answer',key:a,answers:{[q]:'a'}}));
}
(async()=>{
  await run(service());
  await assert.rejects(run(service(source.replace('if(existing&&existing.key!==credential)return;',''))));
  console.log('shared skill link: named identity, separate votes, concurrent answers, retry, overwrite isolation, closed/capability boundaries, mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
