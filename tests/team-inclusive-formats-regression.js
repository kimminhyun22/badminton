'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('js/team.js','utf8');
function context(code){
 const cut=(a,b)=>code.slice(code.indexOf(a),code.indexOf(b,code.indexOf(a)+a.length));
 let seed=731;const math=Object.create(Math);math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const c={Math:math,_skipNewFirstRound:true,getPartnerOf:()=>null};vm.createContext(c);vm.runInContext(fs.readFileSync('js/match-quality.js','utf8'),c);
 vm.runInContext(code.split('let _currentRound=1;')[0]+'let _currentRound=1,_partnerGapThreshold=2;'+cut('function generateMatches(','/* ═══ WIN BUTTON')+cut('function _qualityAssessment(','/* ═══ 대진 품질 대시보드'),c);return c;
}
function player(i,f){return {name:'E2E'+i,gender:f?'F':'M',level:f?3.5:3,ageGroup:'20대',team:i<6?'청팀':'홍팀',gamesPlayed:0,lastRoundPlayed:0,_goal:4,partnerCount:{},opponentCount:{}};}
const c=context(src),settings={teamMode:true,courts:3,gamesPerPlayer:4,mixedDoublesPerPerson:0,targetMixedDoubles:0,targetWomenDoubles:0,targetMenDoubles:12};
for(const minority of [1,2,3])for(const sex of ['F','M']){
 const ps=Array.from({length:12},(_,i)=>player(i,sex==='F'?i<minority:i>=minority));
 const ms=c.generateMatches(ps,settings,12);c.fillMissingGames(ps,settings,ms,12);
 const q=c._qualityAssessment(ms,ps,settings);
 assert.equal(q.underSlots,0,`${sex}${minority}: everyone reaches target`);
 assert.equal(q.overSlots,0,`${sex}${minority}: no one subsidizes extra games`);
 assert.equal(q.balanceHardCount,0,`${sex}${minority}: preserve balance`);
 assert.equal(q.structureErr+q.genderErr,0);
 assert(ms.some(m=>m.type==='보정'),`${sex}${minority}: use adjustment for one-sided minority`);
 for(const round of new Set(ms.map(m=>m.round))){const names=ms.filter(m=>m.round===round).flatMap(m=>[m.team1A,m.team1B,m.team2C,m.team2D].map(p=>p.name));assert.equal(new Set(names).size,names.length);}
}
// A lower-scoring invalid quartet must not hide a valid regular match.
const pool=[player(0,true),player(1,false),player(2,false),player(6,false),player(7,false)];
const regular=c.tryCreateMatch(pool,settings,'any',1);assert(regular&&regular.type==='남복');
const old=context(src.replace("if(f1!==f2||(type==='mixed'&&f1!==1))continue;",''));
old.diversityScore=four=>four.some(p=>p.gender==='F')?-100000:0;
c.diversityScore=old.diversityScore;
assert(c.tryCreateMatch(pool,settings,'any',1),'Filter invalid format before choosing');
assert.equal(old.tryCreateMatch(pool,settings,'any',1),null,'Mutation recreates hidden feasible match');
// The choice follows skill balance rather than penalizing the adjustment label.
const four=[player(0,true),player(1,false),player(6,false),player(7,false)];
const adjustment=c.formTeams(four,true,'adjust',1);assert(adjustment);
const regularCopy={...adjustment,type:'남복'};
assert.deepEqual(c._inclusiveMatchKey(adjustment),c._inclusiveMatchKey(regularCopy),'Format carries no preference penalty');
assert(src.includes("const formats=settings.teamMode?['any','adjust']:to;"));
const mixedPool=[player(0,true),player(1,false),player(6,true),player(7,false)];
assert.equal(c.tryCreateMatch(mixedPool,settings,'mixed',1).type,'혼복');
const fixed=[player(0,true),player(1,true),player(6,false),player(7,false)];
fixed[0].partnerName=fixed[1].name;fixed[1].partnerName=fixed[0].name;
const cross=c.formTeams(fixed,true,'adjust',1);assert(cross,'Balanced women vs men can preserve requested partners');
assert.equal(c._matchGenderErrorCount(cross),0);
assert.equal(cross.team1A.partnerName,cross.team1B.name);
console.log('inclusive formats: 1/2/3 female or male minority, fairness, balance, format filtering and mutation passed');
