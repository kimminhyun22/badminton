'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),Q=require('../js/team-competition');
const players=Array.from({length:4},(_,i)=>({name:'E2E배점'+i,gender:'M',team:i<2?'청팀':'홍팀',skillRating:3}));
const matches=[{team1A:players[0],team1B:players[1],team2C:players[2],team2D:players[3]}];
const legacy={sFair:20,sDiversity:20,sInterval:10,safetyIssues:[],total:100},settings={teamMode:true};
const score=(q=legacy,s=settings,policy=Q)=>policy.assess(q,matches,players,s,p=>p.skillRating,()=>0);
const perfect=score(),expected={games:45,roster:10,overall:15,participation:15,diversity:5,rest:10};
assert.equal(perfect.version,8);assert.deepEqual(perfect.maxima,expected);assert.equal(perfect.total,100);
assert.equal(perfect.total-score({...legacy,sDiversity:0}).total,5,'repeat avoidance cannot claim 20% of the new total');
assert.equal(perfect.total-score({...legacy,sFair:0}).total,15);
assert.equal(perfect.total-score({...legacy,sInterval:0}).total,10,'rest keeps its weight');
assert(!score({...legacy,sFair:0,safetyIssues:['目標未達']}).eligible,'mandatory attendance cannot be offset by other scores');
const fractional=score({...legacy,sFair:17,sDiversity:19,sInterval:6});
assert.equal(fractional.total,Math.round(Object.values(fractional.components).reduce((a,b)=>a+b,0)*10)/10);
for(const [key,value] of Object.entries(fractional.components)){
 assert(value>=0&&value<=expected[key]);assert.equal(value,Math.round(value*10)/10,'visible components sum without hidden decimals');
}
const previous=score(legacy,{...settings,_qualityScoreVersion:7});assert.equal(previous.version,7);assert.equal(previous.maxima.diversity,20);
assert.equal(score(legacy,{...settings,_legacyCompetition:true}).version,4);
assert(!Q.compareCandidates(perfect,[previous,previous]).verified,'old weights must not serve as new comparison evidence');
const mutant={module:{exports:{}}};vm.runInNewContext(fs.readFileSync('js/team-competition.js','utf8').replace('diversity:5,rest:10','diversity:20,rest:10'),mutant);
assert.notEqual(score(legacy,settings,mutant.module.exports).total,100,'restoring the old repeat weight breaks the 100-point allocation');
console.log('PASS v8 weights: balance70/operation30, repeat5, rest10, mandatory attendance, exact displayed sum, historical rubrics, stale evidence and mutation');
