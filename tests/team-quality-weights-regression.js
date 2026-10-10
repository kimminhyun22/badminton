'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),Q=require('../js/team-competition');
const players=Array.from({length:4},(_,i)=>({name:'E2E배점'+i,gender:'M',team:i<2?'청팀':'홍팀',skillRating:3}));
const matches=[{team1A:players[0],team1B:players[1],team2C:players[2],team2D:players[3]}];
const legacy={sFair:20,sDiversity:20,sInterval:10,safetyIssues:[],total:100},settings={teamMode:true};
const score=(q=legacy,s=settings,policy=Q)=>policy.assess(q,matches,players,s,p=>p.skillRating,()=>0);
const perfect=score(),expected={games:65,overall:20,diversity:5,rest:10};
assert.equal(perfect.version,9);assert.deepEqual(perfect.maxima,expected);assert.equal(perfect.total,100);
assert.equal(perfect.total-score({...legacy,sDiversity:0}).total,5,'repeat avoidance cannot claim 20% of the new total');
assert.equal(perfect.total-score({...legacy,sFair:0}).total,0);
assert.equal(perfect.total-score({...legacy,sInterval:0}).total,10,'rest keeps its weight');
assert(!score({...legacy,sFair:0,safetyIssues:['출전 목표 미달']}).eligible,'mandatory attendance cannot be offset by other scores');
const fractional=score({...legacy,sFair:17,sDiversity:19,sInterval:6});
assert.equal(fractional.total,Math.round(Object.values(fractional.components).reduce((a,b)=>a+b,0)*10)/10);
for(const [key,value] of Object.entries(fractional.components)){
 assert(value>=0&&value<=expected[key]);assert.equal(value,Math.round(value*10)/10,'visible components sum without hidden decimals');
}
const v8=score(legacy,{...settings,_qualityScoreVersion:8});assert.equal(v8.version,8);assert.equal(v8.maxima.participation,15);assert.equal(v8.maxima.roster,10);assert.equal(v8.total,100);
const previous=score(legacy,{...settings,_qualityScoreVersion:7});assert.equal(previous.version,7);assert.equal(previous.maxima.diversity,20);
assert.equal(score(legacy,{...settings,_legacyCompetition:true}).version,4);
assert(!Q.compareCandidates(perfect,[previous,previous]).verified,'old weights must not serve as new comparison evidence');
const mutant={module:{exports:{}}};vm.runInNewContext(fs.readFileSync('js/team-competition.js','utf8').replace('games:65,overall:20,diversity:5,rest:10','games:65,overall:20,diversity:20,rest:10'),mutant);
assert.notEqual(score(legacy,settings,mutant.module.exports).total,100,'restoring the old repeat weight breaks the 100-point allocation');
// Mandatory status must come from the actual counters, not a positive score or a prefilled issue label.
for(const field of ['underSlots','avoidableUnderSlots','avoidableOverSlots']){
 const bad=score({...legacy,[field]:1});assert.equal(bad.total,100);assert(!bad.eligible,field);
 assert(Q.rankKey(bad)[0]>Q.rankKey(perfect)[0]);assert(!Q.compareCandidates(bad,[perfect,perfect]).verified);
}
const unavoidable=score({...legacy,underSlots:0,overSlots:4,avoidableUnderSlots:0,avoidableOverSlots:0});assert(unavoidable.eligible);assert.equal(unavoidable.total,100);
assert(!Object.hasOwn(perfect.components,'participation'));assert(!Object.hasOwn(perfect.components,'roster'));assert(Number.isFinite(perfect.diagnostics.rosterQuality));
assert(!Q.compareCandidates(perfect,[v8,v8]).verified);
const gateMutant={module:{exports:{}}};vm.runInNewContext(fs.readFileSync('js/team-competition.js','utf8').replace("if(q.avoidableOverSlots>0)issues.push('회피 가능한 추가 출전');",''),gateMutant);
assert(score({...legacy,avoidableOverSlots:1},settings,gateMutant.module.exports).eligible,'removing excess gate must reintroduce the false pass');
console.log('PASS v9 weights: four components65/20/5/10, attendance hard gate, unavoidable allowances, roster diagnostic, exact sum, historical rubrics, stale evidence and mutations');

const c=require('./helpers/team-competition-context')(),ps=Array.from({length:8},(_,i)=>({name:'E2E필수'+i,gender:'M',team:i<4?'청팀':'홍팀',skillRating:3,level:3,grade:'C'})),s={teamMode:true,courts:2,gamesPerPlayer:1};
const match=(ids,round,court)=>({round,court,type:'남복',team1A:ps[ids[0]],team1B:ps[ids[1]],team2C:ps[ids[2]],team2D:ps[ids[3]],levelDiff:0});
const valid=[match([0,1,4,5],1,1),match([2,3,6,7],1,2)],extra=[...valid,match([0,2,4,6],2,1)];
const read=matches=>c._teamCompetitionEvaluation({matches,participants:ps},s);
assert(read(valid).score.eligible);assert.equal(read(extra).legacy.avoidableOverSlots,4);assert(!read(extra).score.eligible);assert(read(extra).score.issues.includes('회피 가능한 추가 출전'));
assert.equal(read(valid.slice(0,1)).legacy.avoidableUnderSlots,4);assert(!read(valid.slice(0,1)).score.eligible);
console.log('PASS actual schedule attendance: full participation passes, missing or avoidable extra games fail');

assert(!score({...legacy,underSlots:1,avoidableUnderSlots:0,parityAdjustment:1}).eligible,'legacy gender-parity allowance must not mark a missing appearance fulfilled');
