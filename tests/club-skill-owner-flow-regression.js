'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/club-skill-review.js','utf8'),html=fs.readFileSync('skill-review.html','utf8');
async function creation(code,quick,reuse){
  const nodes={},$=id=>nodes[id]||(nodes[id]={value:'0'}),members=[{name:'E2E'}];
  const entry={id:'test',key:'owner',clubId:'club',snapshots:members,createdAt:Date.now()};
  const ctx={$,quick,busy:false,clubs:[{id:'club',name:'E2E'}],links:reuse?[entry]:[],checkRoster:()=>({members,issues:[]}),C:{players:m=>m,pairs:()=>[{}]},nonce:()=> 'token',persist(){},message(){},api:async()=>({}),renderOwner(){ctx.result='owner';},open:async link=>{ctx.result=link.key;},openShared:async()=>{ctx.result='participant';},Date};
  ctx.reviewProfile=m=>m;
  vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf("  $('create').onclick="),code.indexOf("  $('club').onchange=")),ctx);
  await $('create').onclick();assert.equal(ctx.result,'owner',`quick=${quick} reuse=${reuse}`);
}
async function preparation(){
  const nodes={},$=id=>nodes[id]||(nodes[id]={hidden:false}),own={key:'owner'};
  const ctx={$,active:own,session:{count:0,players:[{},{}],expiresAt:Date.now()+10000},sharedLink:async()=>{},message(){},Date};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function prepareOwnerShare('),source.indexOf("  $('retryShare').onclick=")),ctx);
  await ctx.prepareOwnerShare(own);assert.equal($('ownerState').textContent,'준비 완료 · 2명');assert(!$('share').disabled);
  ctx.sharedLink=async()=>{throw Error('offline');};await ctx.prepareOwnerShare(own);assert($('share').disabled);assert(!$('retryShare').hidden);
  ctx.sharedLink=async()=>{};ctx.session.count=1;await ctx.prepareOwnerShare(own);assert.equal($('ownerState').textContent,'응답 수집 중');
  ctx.sharedLink=async()=>{ctx.session.closed=true;};await ctx.prepareOwnerShare(own);assert($('share').disabled,'late completion must not reopen closed sharing');
}
(async()=>{
  for(const quick of [true,false])for(const reuse of [true,false])await creation(source,quick,reuse);
  await assert.rejects(creation(source.replace('      renderOwner();','      await openShared(entry);'),true,false));
  await preparation();
  const owner=html.slice(html.indexOf('<section id="owner"'),html.indexOf('<section id="identity"'));
  assert(owner.indexOf('id="share"')<owner.indexOf('id="answerSelf"'));
  assert(owner.indexOf('id="share"')<owner.indexOf('<details>'));
  assert(owner.includes('id="share" class="primary"'));
  assert(!owner.includes('id="answerSelf" class="primary"'));
  assert(source.includes("$('ownerResults').hidden=!session.count"));
  console.log('owner flow: normal/quick creation and reuse stay owner, prominent share, optional participation, empty results, retry/closed guards, mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
