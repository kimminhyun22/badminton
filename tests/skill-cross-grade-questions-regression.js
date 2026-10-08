'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('js/club-skill-review.js','utf8'),C=require('../functions/skill-calibration-core');
function load(s=source){const ctx={};vm.runInNewContext(s.slice(s.indexOf('  function comparisonCoverage('),s.indexOf('  function reviewProgress('))+s.slice(s.indexOf('  function reviewQuestions('),s.indexOf('  const draftKey='))+';this.plan=reviewQuestions;this.resume=reviewPlan;this.coverage=comparisonCoverage;',ctx);return ctx;}
const L=load();
const players=C.players(Array.from({length:24},(_,i)=>({name:'E2E'+i,grade:['B','C'][Math.floor(i/12)],gender:'남',ageGroup:'40대'}))),questions=C.pairs(players),byId=new Map(players.map(p=>[p.id,p]));
const cross=q=>byId.get(q.a).grade!==byId.get(q.b).grade;
const evidence=Object.fromEntries(questions.filter(q=>!cross(q)&&[0,1].some(x=>q.a==='p'+(Math.floor(Number(q.a.slice(1))/12)*12+x))).map(q=>[q.id,{count:2,needsReview:false}]));
function checkPlanner(lib){
 const batch=lib.plan(questions,{},12,evidence,players);
 assert(batch.every(cross),'first batch covers missing cross-grade comparisons');
 assert.equal(new Set(batch.flatMap(q=>[q.a,q.b])).size,24,'cross-grade coverage spread across members');
 assert(batch.every(q=>Math.abs('BCD'.indexOf(byId.get(q.a).grade)-'BCD'.indexOf(byId.get(q.b).grade))===1),'prefer adjacent grades where available');
}
checkPlanner(L);
const spread=players.slice(0,4).map((p,i)=>({...p,grade:['S','E','A','D'][i]}));
const nearest=L.plan(C.pairs(spread),{},1,{},spread)[0];
assert.notEqual(nearest.id,'p0_p1','avoid obvious distant-grade pair when adjacent comparison is available');
assert(['p0_p2','p1_p3'].includes(nearest.id));
const allSame=players.map(p=>({...p,grade:'C'}));assert.equal(L.plan(questions,{},20,evidence,allSame).length,20,'same-grade comparisons remain allowed');
const noEvidence=L.coverage(players,questions,{});assert.equal(noEvidence.cross,0);assert.equal(noEvidence.missing,24);
const within=L.coverage(players,questions,evidence);assert(within.same>0);assert.equal(within.cross,0);assert.equal(within.missing,24);
const bridge=questions.find(cross),coverage=L.coverage(players,questions,{...evidence,[bridge.id]:{count:3}});assert.equal(coverage.cross,3);assert.equal(coverage.missing,22);
assert.equal(L.coverage(allSame,questions,evidence).multiGrade,false);
const old=questions.filter(q=>!cross(q)).slice(0,20).map(q=>q.id),pending={[old[0]]:'tie',[old[1]]:'skip'},previous={[old[2]]:'a'};
const before=JSON.stringify({pending,previous,old});const upgraded=L.resume(questions,previous,pending,old,null,evidence,players);
assert.equal(upgraded.length,20);assert.equal(new Set(upgraded.map(q=>q.id)).size,20);
assert.deepEqual(Array.from(upgraded.slice(0,3),q=>q.id),old.slice(0,3),'keep pending answers, skips and already submitted retry chunks');
assert(upgraded.slice(3).some(cross),'unanswered legacy plan receives cross-grade questions');
assert.equal(JSON.stringify({pending,previous,old}),before,'planner does not mutate answers');
assert.deepEqual(Array.from(L.resume(questions,previous,pending,old,'cross-grade-v1',evidence,players),q=>q.id),old,'new plan remains stable during navigation');
assert.throws(()=>checkPlanner(load(source.replace('crossNeed(b)-crossNeed(a)||near(b)-near(a)||',''))),'removing cross-grade priority must fail');
assert(source.includes('comparisonCoverage(session.players,session.questions,session.evidence)'));
assert(source.includes("read(draftKey()+'_planVersion',null)"));
console.log('cross-grade: coverage, adjacent grades, same-grade fallback, old draft migration, skips/retries, stable navigation and mutation passed');
