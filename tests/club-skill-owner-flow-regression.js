'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/club-skill-review.js','utf8'),html=fs.readFileSync('skill-review.html','utf8');
async function creation(code,quick,reuse){
  const nodes={},$=id=>nodes[id]||(nodes[id]={value:'0'}),members=[{name:'E2E'}];
  const entry={id:'test',key:'owner',clubId:'club',snapshots:members,createdAt:Date.now()};
  const ctx={window:{KokSkillBatch:require('../js/club-skill-batch')},$,quick,busy:false,clubs:[{id:'club',name:'E2E'}],links:reuse?[entry]:[],checkRoster:()=>({members,issues:[]}),C:{players:m=>m,pairs:()=>[{}]},nonce:()=> 'token',persist(){},message(){},api:async()=>({}),renderOwner(){ctx.result='owner';},open:async link=>{ctx.result=link.key;},openShared:async()=>{ctx.result='participant';},Date};
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
function participation(){
  const own={id:'example',key:'owner'},button={},draft={};
  const ctx={$:()=>button,session:{assessmentVersion:2,namedOwnerReview:true},Object,read:()=>draft,draftKey:()=>own.key,ownerLink:()=>own,evaluatingAsOwner:false,openShared:()=>{ctx.route='identity';},startBatch:()=>{ctx.route='owner';}};
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('  function namedOwnerReview('),source.indexOf('  function assessmentPlan(')),ctx);
  vm.runInContext(source.slice(source.indexOf("  $('answerSelf').onclick="),source.indexOf('  function renderIdentity(')),ctx);
  button.onclick();assert.equal(ctx.route,'identity');
  draft.partial='tie';button.onclick();assert.equal(ctx.route,'owner','retain old owner draft');
  delete draft.partial;ctx.session.ownerAnswers={p1_p2:'tie'};button.onclick();assert.equal(ctx.route,'owner','reuse the same owner slot for legacy answers');
  ctx.session.ownerAnswers={};ctx.session.namedOwnerReview=false;button.onclick();assert.equal(ctx.route,'owner');
}
async function linkRecovery(code=source){
  const nodes={},$=id=>nodes[id]||(nodes[id]={hidden:true,textContent:''});
  const link={id:'test',key:'shared'};
  const ctx={$,busy:false,active:null,read:()=>null,ownerLink:()=>null,panels:id=>ctx.panel=id,message:m=>ctx.lastMessage=m,
    eventHeading(){},renderIdentity:()=>ctx.panel='identity',api:async()=>{throw Object.assign(Error('offline'),{name:'ConnectionError'});}};
  vm.createContext(ctx);
  vm.runInContext(code.slice(code.indexOf('  function showLinkError('),code.indexOf('  function resultState(')),ctx);
  await ctx.open(link);
  assert.equal(ctx.panel,'linkUnavailable');assert(!$('retryOpen').hidden);
  ctx.api=async()=>({needsIdentity:true});$('retryOpen').onclick();await new Promise(r=>setImmediate(r));
  assert.equal(ctx.panel,'identity');
  ctx.api=async()=>{throw Error('만료된 링크입니다.');};await ctx.open(link);
  assert.equal(ctx.panel,'linkUnavailable');assert($('retryOpen').hidden);assert($('linkHelp').textContent.includes('새 링크'));
  $('owner').hidden=false;ctx.ownerLink=()=>link;ctx.panel='owner';ctx.api=async()=>{throw Object.assign(Error('offline'),{name:'ConnectionError'});};await ctx.open(link);
  assert.equal(ctx.panel,'owner');assert(ctx.lastMessage.includes('이전 결과'));
}
(async()=>{
  await linkRecovery();await assert.rejects(linkRecovery(source.replace("else showLinkError('연결을 확인하고 다시 열어 주세요.',true);","else panels('setup');")));
  for(const quick of [true,false])for(const reuse of [true,false])await creation(source,quick,reuse);
  await assert.rejects(creation(source.replace('      renderOwner();','      await openShared(entry);'),true,false));
  await preparation();participation();
  const owner=html.slice(html.indexOf('<section id="owner"'),html.indexOf('<section id="identity"'));
  assert(owner.indexOf('id="share"')<owner.indexOf('id="answerSelf"'));
  assert(owner.indexOf('id="refresh"')>0&&owner.indexOf('id="refresh"')<owner.indexOf('<details>'));
  assert(owner.indexOf('id="share"')<owner.indexOf('<details>'));
  assert(owner.includes('id="share" class="primary"'));
  assert(!owner.includes('id="answerSelf" class="primary"'));
  assert(source.includes("$('ownerResults').hidden=!session.count"));
  console.log('owner flow: normal/quick creation and reuse stay owner, prominent share, optional participation, empty results, retry/closed guards, mutation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
