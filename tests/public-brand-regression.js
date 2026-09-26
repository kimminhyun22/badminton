'use strict';
const assert=require('assert'),fs=require('fs');
const pages=['index.html','team.html','checkin.html','rsvp.html','view.html','skill-review.html','quiz.html'];
function verifyPage(text){
  assert(!text.includes('콕매치'),'retired public brand');
  assert(text.includes('<meta property="og:site_name" content="민턴라이브">'),'share service name');
}
for(const page of pages)verifyPage(fs.readFileSync(page,'utf8'));
for(const file of fs.readdirSync('js').filter(f=>f.endsWith('.js')))assert(!fs.readFileSync('js/'+file,'utf8').includes('콕매치'),file);
const html=fs.readFileSync('skill-review.html','utf8'),js=fs.readFileSync('js/club-skill-review.js','utf8');
const question='반드시 이겨야 하는 게임, 누구와 파트너를 하시겠어요?';
assert(html.includes('<h2 id="questionTitle">'+question+'</h2>'));
assert(!html.includes('id="questionHint"')&&!html.includes('id="encouragement"'));
assert(js.includes("title:'민턴라이브 · 우리 클럽 밸런스게임'"));
assert(js.includes("text:'"+question+"'"));
assert(js.includes("url.searchParams.set('v',document.querySelector('meta[name=\"app-version\"]').content)"),'new shares use versioned previews');
assert(!JSON.stringify(JSON.parse(fs.readFileSync('manifest.json','utf8'))).includes('콕매치'));
assert.throws(()=>verifyPage(html.replace('민턴라이브','콕매치')));
assert.throws(()=>verifyPage(html.replace('property="og:site_name"','property="old:site_name"')));
console.log('public brand: current pages, shares, scripts, manifest, concise question, mutation passed');
