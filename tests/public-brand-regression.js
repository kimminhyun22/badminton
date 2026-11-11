'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const pages=['index.html','team.html','checkin.html','rsvp.html','view.html','skill-review.html','quiz.html'];
function verifyPage(text){
  assert(!text.includes('콕매치'),'retired public brand');
  assert(text.includes('<meta property="og:site_name" content="민턴라이브">'),'share service name');
}
for(const page of pages)verifyPage(fs.readFileSync(page,'utf8'));
for(const file of fs.readdirSync('js').filter(f=>f.endsWith('.js')))assert(!fs.readFileSync('js/'+file,'utf8').includes('콕매치'),file);
const html=fs.readFileSync('skill-review.html','utf8'),js=fs.readFileSync('js/club-skill-review.js','utf8');
const question='현재 개인 실력은 누가 더 강한가요?';
assert(html.includes('<h2 id="questionTitle">'+question+'</h2>'));
assert(!html.includes('id="questionHint"')&&!html.includes('id="encouragement"'));
async function verifyShare(source,event){
  const nodes={},$=id=>nodes[id]||(nodes[id]={}),shares=[];
  const ctx={$,busy:false,session:{event:event?{id:'E2E'}:null},ownerLink:()=>({id:'E2E',sharedKey:'E2Eshared',sharedReady:true}),URL,location:{href:'https://example.test/skill-review.html'},document:{querySelector:()=>({content:'1.10.test'})},navigator:{share:async value=>shares.push(value)},message(){},prompt(){}};
  vm.runInNewContext(source.slice(source.indexOf("  $('share').onclick="),source.indexOf("  $('answerSelf').onclick=")),ctx);
  await $('share').onclick();assert.equal(shares.length,1);
  assert.equal(shares[0].title,event?'민턴라이브 · 팀전 신청자 밸런스게임':'민턴라이브 · 우리 클럽 밸런스게임');
  assert.equal(shares[0].text,event?'이번 팀전 신청자의 현재 개인 실력을 비교해 주세요.':'현재 개인 실력을 비교해 주세요.');
  assert.equal(new URL(shares[0].url).searchParams.get('v'),'1.10.test');
}
assert(js.includes("url.searchParams.set('v',document.querySelector('meta[name=\"app-version\"]').content)"),'new shares use versioned previews');
assert(!JSON.stringify(JSON.parse(fs.readFileSync('manifest.json','utf8'))).includes('콕매치'));
assert.throws(()=>verifyPage(html.replace('민턴라이브','콕매치')));
assert.throws(()=>verifyPage(html.replace('property="og:site_name"','property="old:site_name"')));
(async()=>{for(const event of[false,true])await verifyShare(js,event);await assert.rejects(verifyShare(js.replace('민턴라이브 · 팀전 신청자 밸런스게임','콕매치 · 팀전 신청자 밸런스게임'),true),assert.AssertionError);console.log('public brand: current pages, runtime club/event shares, scripts, manifest, concise question, mutation passed');})().catch(e=>{console.error(e);process.exitCode=1;});
