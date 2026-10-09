'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const core=require('../functions/skill-calibration-core');
const batch=require('../js/club-skill-batch');
const engine=require('../functions/daily-server-matchmaker');
const ctx={};vm.runInNewContext(fs.readFileSync('js/match-quality.js','utf8'),ctx);
const Q=ctx.KokMatchQuality;
for(const ageGroup of ['20대','30대','40대','50대','60대+'])for(let skillStep=-4;skillStep<=4;skillStep++){
  const m={name:'E2E초보',grade:'E',gender:'여',ageGroup,skillStep};
  const p=core.player(m),score=Q.skillBreakdown(m);
  assert(Math.abs(score.level-p.level)<1e-9);
  assert(Math.abs(score.total-engine.effectiveLevel(p))<1e-9);
  assert(score.total+5>0,'display remains positive, including oldest beginner at lower bound');
  assert.equal(core.proposals([p],[],{})[0].step,skillStep,'no evidence must preserve manual baseline');
}
for(const skillStep of [-5,5,1.5])assert.throws(()=>core.player({name:'E2E',grade:'E',gender:'여',ageGroup:'40대',skillStep}));
const members=[-4,4,0].map((skillStep,i)=>({name:'E2E'+i,grade:'E',gender:'여',ageGroup:'40대',skillStep,level:1+skillStep*.2}));
members.forEach(m=>m.level=Math.round(m.level*10)/10);
const original={clubs:[{id:'test',members}]},before=JSON.stringify(original);
const prepared=batch.prepare(original,'test',[{id:'p0',original:members[0],step:4}],'review','batch');
assert.equal(prepared.state.clubs[0].members[0].level,1.8);
assert.equal(batch.reviewBaselines({clubId:'test',snapshots:members},prepared.state.clubs[0]).length,3);
assert.equal(batch.undo(prepared.state,'test','batch').state.clubs[0].members[0].level,.2);
assert.equal(JSON.stringify(original),before,'no writes before explicit commit');
// All old values retain their exact meaning; a wider allowed interval is not a rescale.
for(let step=-2;step<=2;step++)assert.equal(core.player({...members[2],skillStep:step,level:undefined}).level,Math.round((1+step*.2)*10)/10);
const source=fs.readFileSync('functions/skill-calibration-core.js','utf8');
const broken={module:{exports:{}}};vm.runInNewContext(source.replace('Math.abs(step)>4','Math.abs(step)>2'),broken);
assert.throws(()=>broken.module.exports.player(members[0]),'mutation detects old server range');
assert(fs.readFileSync('js/club-skill-review.js','utf8').includes('p.skillRating??'));
console.log('legacy manual range preserved; learned rating uses independent final score');
