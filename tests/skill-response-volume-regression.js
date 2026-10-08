'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('functions/skill-calibration-core.js','utf8');
const load=s=>{const ctx={module:{exports:{}}};vm.runInNewContext(s,ctx);return ctx.module.exports;};
const C=load(source);
const make=(n=4)=>C.players(Array.from({length:n},(_,i)=>({name:'E2E비교'+i,grade:'C',gender:'남',ageGroup:'40대',skillStep:0})));
const ratings=r=>Array.from(r,p=>p.skillRating);
function duplication(core){
 const p=make(),q=core.pairs(p);
 const votes={u0:Object.fromEntries(q.map(x=>[x.id,'a'])),u1:Object.fromEntries(q.map(x=>[x.id,x.id==='p0_p1'?'b':'tie']))};
 const once=core.proposals(p,q,votes),many=Object.fromEntries(Array.from({length:100},(_,i)=>['u'+i,votes['u'+i%2]]));
 const repeated=core.proposals(p,q,many);
 assert.deepEqual(ratings(once),ratings(repeated),'50x identical opinion distribution must not enlarge scores');
 assert(repeated[0].experts>once[0].experts,'evidence metadata still accumulates');
 // Extra unanimous responses on just one pair must not overweight that pair.
 const one={u0:Object.fromEntries(q.map(x=>[x.id,'a']))};
 const extra={...one,...Object.fromEntries(Array.from({length:80},(_,i)=>['extra'+i,{p0_p1:'a'}]))};
 assert.deepEqual(ratings(core.proposals(p,q,one)),ratings(core.proposals(p,q,extra)));
}
function opponentCount(core){
 const star=n=>{const p=make(n+1),q=core.pairs(p).filter(x=>x.a==='p0');return core.proposals(p,q,{u0:Object.fromEntries(q.map(x=>[x.id,'a']))});};
 const one=star(1),many=star(30);
 assert.equal(one[0].skillRating,many[0].skillRating,'more equivalent opponents must not inflate the same average evidence');
 assert(many.slice(1).every(x=>x.skillRating===one[1].skillRating));
}
duplication(C);opponentCount(C);
const p=make(2),q=C.pairs(p);
const estimate=a=>C.proposals(p,q,Object.fromEntries(a.map((v,i)=>['u'+i,{p0_p1:v}])))[0].skillRating;
assert(estimate(['a','a','a'])>estimate(['a','a','b']),'changed opinion proportion changes the score');
assert(estimate(['a','a','b'])>estimate(['a','b']));
assert.equal(estimate(['a','b']),p[0].base);
assert.equal(estimate(['tie']),p[0].base);
assert.equal(C.proposals(p,q,{u0:{p0_p1:'skip'}})[0].skillRating,p[0].base);
const close=make(2);close[0].base-=.7;
const reversed=C.proposals(close,C.pairs(close),{u0:{p0_p1:'a'}});
assert(reversed[0].skillRating>reversed[1].skillRating,'evidence can reverse a nearby baseline order');
assert.throws(()=>duplication(load(source.replace('probability-e.wins/e.n','e.n*probability-e.wins').replace('curvature[e.i]+=.5;curvature[e.j]+=.5','curvature[e.i]+=e.n*.5;curvature[e.j]+=e.n*.5'))),'mutation: summed vote loss');
assert.throws(()=>opponentCount(load(source.replace('lambda*Math.max(1,a.length)','lambda'))),'mutation: fixed prior with growing opponent count');
console.log('response volume: pair ratios, opponent normalization, direction, ties, sparse data, order reversal, count metadata and two mutations passed');
