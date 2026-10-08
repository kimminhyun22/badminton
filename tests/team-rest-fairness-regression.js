'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('js/team.js','utf8');
function context(code){
 const cut=(a,b)=>code.slice(code.indexOf(a),code.indexOf(b,code.indexOf(a)+a.length));
 let seed=733;const math=Object.create(Math);math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const c={Math:math};vm.createContext(c);vm.runInContext(fs.readFileSync('js/match-quality.js','utf8'),c);
 vm.runInContext(code.split('let _currentRound=1;')[0]+cut('function _matchGenderErrorCount(','function formTeams(')+cut('function _qualityAssessment(','/* ═══ 대진 품질 대시보드')+cut('function _isBetterQualityKey(','function _autoSearchTries(')+cut('function _teamFinalQualityKey(','function _teamKeepFinalist(')+cut('function _optimizeFutureRounds(','/* ── 빈 코트 감지'),c);return c;
}
const fixture={"players": [[5, "F", "40대", "청팀"], [5, "F", "50대", "청팀"], [3.4, "F", "30대", "청팀"], [1, "F", "50대", "청팀"], [3.2, "M", "30대", "청팀"], [4.6, "M", "50대", "청팀"], [4, "M", "40대", "청팀"], [3.6, "M", "30대", "청팀"], [3.8, "M", "40대", "청팀"], [4.4, "M", "50대", "청팀"], [2.4, "M", "40대", "청팀"], [2.8, "M", "30대", "청팀"], [2.6, "M", "30대", "청팀"], [3.6, "M", "50대", "청팀"], [2.8, "M", "40대", "청팀"], [2.8, "M", "40대", "청팀"], [2.4, "M", "30대", "청팀"], [5, "M", "30대", "청팀"], [5, "F", "50대", "홍팀"], [2.8, "F", "30대", "홍팀"], [2, "F", "40대", "홍팀"], [4.6, "M", "30대", "홍팀"], [4.2, "M", "30대", "홍팀"], [4, "M", "30대", "홍팀"], [4, "M", "30대", "홍팀"], [4.8, "M", "50대", "홍팀"], [4.4, "M", "50대", "홍팀"], [3.6, "M", "40대", "홍팀"], [3, "M", "50대", "홍팀"], [2.8, "M", "30대", "홍팀"], [2.6, "M", "40대", "홍팀"], [2.6, "M", "40대", "홍팀"], [2.2, "M", "30대", "홍팀"], [2.4, "M", "40대", "홍팀"], [2, "M", "50대", "홍팀"]], "matches": [[1, 1, "남복", 10, 11, 33, 29], [1, 2, "보정", 1, 0, 22, 18], [1, 3, "남복", 16, 4, 30, 27], [1, 4, "남복", 8, 6, 26, 25], [1, 5, "남복", 7, 15, 23, 32], [2, 1, "남복", 13, 5, 24, 31], [2, 2, "보정", 14, 17, 19, 21], [2, 3, "혼복", 3, 12, 20, 34], [2, 4, "보정", 2, 9, 33, 23], [2, 5, "보정", 10, 8, 28, 18], [3, 1, "보정", 11, 0, 29, 22], [3, 2, "보정", 1, 4, 26, 27], [3, 3, "남복", 16, 6, 30, 25], [3, 4, "남복", 7, 14, 32, 24], [3, 5, "보정", 15, 12, 19, 31], [4, 1, "남복", 17, 5, 21, 23], [4, 2, "혼복", 2, 13, 33, 18], [4, 3, "보정", 3, 9, 34, 28], [4, 4, "보정", 10, 8, 20, 24], [4, 5, "남복", 7, 16, 31, 25], [5, 1, "보정", 11, 1, 26, 29], [5, 2, "보정", 0, 4, 27, 22], [5, 3, "보정", 15, 14, 19, 30], [5, 4, "남복", 6, 12, 32, 25], [5, 5, "보정", 17, 9, 21, 18], [6, 1, "보정", 2, 8, 28, 24], [6, 2, "보정", 13, 10, 20, 23], [6, 3, "보정", 3, 5, 34, 31], [6, 4, "보정", 16, 0, 33, 21], [6, 5, "남복", 7, 12, 29, 27], [7, 1, "보정", 15, 4, 26, 19], [7, 2, "남복", 14, 6, 32, 22], [7, 3, "남복", 11, 13, 30, 28], [7, 4, "보정", 1, 3, 20, 34], [7, 5, "남복", 9, 5, 29, 21], [8, 1, "보정", 17, 2, 23, 24]]};
const ps=fixture.players.map(([level,gender,ageGroup,team],i)=>({name:'E2E'+i,level,gender,ageGroup,team,_goal:4}));
const matches=fixture.matches.map(([round,court,type,a,b,d,e],i)=>({round,court,type,matchNumber:i+1,team1A:ps[a],team1B:ps[b],team2C:ps[d],team2D:ps[e]}));
const settings={teamMode:true,courts:5,gamesPerPlayer:4},c=context(src);
const alternative=matches.map(m=>({...m,round:[6,5,4,3,2,1,7,8].indexOf(m.round)+1}));
const before=c._qualityAssessment(matches,ps,settings),after=c._qualityAssessment(alternative,ps,settings);
assert.equal(before.restMaxRun,4);assert.equal(after.restMaxRun,3);
assert(after.total>before.total,'Less individual burden must score higher, despite two more pairwise consecutive slots');
assert.equal(after.sBalance,before.sBalance);assert.equal(after.sFair,before.sFair);assert.equal(after.sDiversity,before.sDiversity);
assert(c._isBetterQualityKey(c._teamFinalQualityKey(alternative,ps,settings),c._teamFinalQualityKey(matches,ps,settings)));
const legacy=context(src.replace('-rest.penalty,0,10)',',0,10)'));
assert(legacy._qualityAssessment(alternative,ps,settings).total<legacy._qualityAssessment(matches,ps,settings).total,'Mutation exposes the former 89-vs-90 inversion');
const forced=c._restRunStats(Array.from({length:5},()=>new Set(['A','B','C','D'])));assert.equal(forced.penalty,0,'Do not punish unavoidable play when nobody can rest');
const optimized=matches.map(m=>({...m}));c._optimizeFutureRounds(optimized,settings);
const final=c._qualityAssessment(optimized,ps,settings);assert(final.restMaxRun<=3);assert(final.total>before.total);
assert.equal(final.balanceHardCount,0);assert.equal(final.underSlots,0);assert.equal(final.overSlots,4);
for(let i=0;i<matches.length;i++)for(const key of ['team1A','team1B','team2C','team2D'])assert.strictEqual(optimized[i][key],matches[i][key],'Preserve every pairing');
for(const r of new Set(optimized.map(m=>m.round))){const ns=optimized.filter(m=>m.round===r).flatMap(m=>[m.team1A,m.team1B,m.team2C,m.team2D].map(p=>p.name));assert.equal(ns.length,new Set(ns).size);}
console.log(JSON.stringify({before:before.total,alternative:after.total,optimized:final.total,maxRun:final.restMaxRun}));
