'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/manual-quickstart.js','utf8');
function setup(nav={},query='?manual=1',code=source){
  const buttons={},status={},fallback={hidden:true,focus(){},select(){this.selected=true;}};
  let opened=0,inserted=0;
  const section={querySelector(s){return s==='[role="status"]'?status:s==='textarea'?fallback:(buttons[s]??={});}};
  vm.runInNewContext(code,{navigator:nav,location:{search:query},URLSearchParams,
    window:{openManual(){opened++;}},document:{readyState:'complete',createElement:()=>section,
      querySelector:()=>({querySelector:()=>({after(){inserted++;}})})}});
  return {buttons,status,fallback,get opened(){return opened;},get inserted(){return inserted;}};
}
(async()=>{
  let copied='',shared;
  const s=setup({clipboard:{async writeText(text){copied=text;}}});
  assert.equal(s.opened,1);assert.equal(s.inserted,1);
  await s.buttons['[data-guide-share]'].onclick();
  for(const text of ['Safari','Chrome','명부 만들기','대진 게시','운동 링크','?manual=1','앱 삭제'])assert(copied.includes(text));
  assert(!copied.includes('콕매치'));assert(copied.length<700);
  assert.equal(copied+'\n',fs.readFileSync('docs/public-rollout/KAKAO_START.txt','utf8'));
  const n=setup({share:async data=>{shared=data;}},'');
  await n.buttons['[data-guide-share]'].onclick();assert.equal(n.opened,0);assert.equal(shared.text,copied);
  const cancelled=setup({share:async()=>{throw {name:'AbortError'};},clipboard:{writeText(){throw Error('must not copy');}}});
  await cancelled.buttons['[data-guide-share]'].onclick();assert(cancelled.fallback.hidden);
  const denied=setup({share:async()=>{throw {name:'NotAllowedError'};}});
  await denied.buttons['[data-guide-share]'].onclick();assert(!denied.fallback.hidden);assert(denied.fallback.selected);
  const mutated=setup({},'?manual=1',source.replace("get('manual')==='1'","get('manual')==='0'"));
  assert.notEqual(mutated.opened,1,'deep-link mutation detected');
  for(const file of ['index.html','team.html']){
    const html=fs.readFileSync(file,'utf8');
    assert(html.includes('js/manual-quickstart.js?'));assert(html.includes('css/manual-quickstart.css?'));
  }
  console.log('manual quickstart copy/share/cancel/fallback/deep-link passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
