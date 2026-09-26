'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/club-skill-review.js','utf8');
const fragment=source.slice(source.indexOf('  function reviewProgress('),source.indexOf('  function renderOwner('));
function load(code=fragment){const ctx={};vm.runInNewContext(code+';this.run=reviewProgress;',ctx);return ctx.run;}
const players=[0,1,2,3].map(i=>({id:'p'+i,name:'E2E'+i}));
const questions=players.flatMap((a,i)=>players.slice(i+1).map(b=>({a:a.id,b:b.id})));
const p=(i,extra={})=>({id:'p'+i,current:0,step:0,opponents:0,support:0,conflicts:0,ready:false,...extra});
function check(run){
  let r=run(players,questions,[]);assert.equal(r.percent,0);assert.equal(r.remaining,100);assert.equal(r.pending.length,4);assert.equal(r.minimumQuestions,6);
  r=run(players,questions,[p(0,{opponents:2,experts:20})]);assert.equal(r.done,0,'many people do not replace distinct opponents');
  r=run(players,questions,[p(0,{opponents:3}),p(1,{opponents:3,ready:true,step:1,support:3}),p(2,{opponents:3,conflicts:1}),p(3,{opponents:3,step:1,support:2})]);
  assert.equal(r.percent,100);assert.equal(r.remaining,0);assert.equal(r.done,4,'collection progress is independent of proposal approval');assert.equal(r.pending.length,0);
  r=run(players,questions,players.map((_,i)=>p(i,{opponents:3})));assert.equal(r.percent,100);assert.equal(r.pending.length,0);assert.equal(r.minimumQuestions,0);
  r=run([...players,{id:'rare',name:'E2E희소'}],questions,players.map((_,i)=>p(i,{opponents:3})));
  assert.equal(r.total,4);assert.equal(r.excluded.length,1,'unreachable members remain visible separately');
  r=run(players.slice(0,3),questions.filter(q=>q.a!=='p3'&&q.b!=='p3'),[]);assert.equal(r.percent,null);assert.equal(r.excluded.length,3);
}
check(load());assert.throws(()=>check(load(fragment.replace('const required=3','const required=1'))));
console.log('review progress: distinct opponents, ready/unchanged, conflicts, directional support, unsupported members, empty denominator, mutation passed');
