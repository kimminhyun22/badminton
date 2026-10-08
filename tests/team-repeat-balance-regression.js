'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('js/team.js','utf8'),fixture=require('./fixtures/team-repeat-balance.json');
function context(code){
 const cut=(a,b)=>code.slice(code.indexOf(a),code.indexOf(b,code.indexOf(a)+a.length));
 const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('js/match-quality.js','utf8'),c);
 vm.runInContext(code.split('let _currentRound=1;')[0]+cut('function _matchGenderErrorCount(','function formTeams(')+cut('function _qualityAssessment(','/* ═══ 대진 품질 대시보드')+cut('function _buildHistoryFromMatches(','/* ═══ 간편 재배정')+cut('function _isBetterQualityKey(','function _autoSearchTries(')+cut('function _teamIndividualRisk(','function _teamRefineRoundPairs('),c);return c;
}
function data(){
 const participants=fixture.players.map(([level,gender,ageGroup,team],i)=>({name:'E2E'+i,level,gender,ageGroup,team,_goal:4}));
 const matches=fixture.matches.map(([round,court,type,a,b,c,d],i)=>({round,court,type,matchNumber:i+1,team1A:participants[a],team1B:participants[b],team2C:participants[c],team2D:participants[d]}));
 const model=context(src);matches.forEach(m=>{m.team1Level=model.effLevel(m.team1A)+model.effLevel(m.team1B);m.team2Level=model.effLevel(m.team2C)+model.effLevel(m.team2D);m.levelDiff=Math.round(Math.abs(m.team1Level-m.team2Level)*10)/10;});
 return {matches,participants};
}
const settings={teamMode:true,courts:5,gamesPerPlayer:4},c=context(src),d=data(),fields=['team1A','team1B','team2C','team2D'];
const rounds=ms=>Object.fromEntries(d.participants.map(p=>[p.name,ms.filter(m=>fields.some(f=>m[f].name===p.name)).map(m=>m.round).sort().join(',')]));
const beforeRounds=rounds(d.matches),before=c._qualityAssessment(d.matches,d.participants,settings),oldStats=c._teamRepeatBalanceStats(d.matches);
c._teamImproveRepeatBalance(d,settings);
const after=c._qualityAssessment(d.matches,d.participants,settings),stats=c._teamRepeatBalanceStats(d.matches);
assert.equal(before.total,87);assert.equal(after.total,89);assert.equal(stats.partnerExcess,0);assert.equal(stats.opponentExcess,1);assert.equal(oldStats.opponentExcess,2);
assert.equal(after.sBalance,before.sBalance);assert.equal(after.sFair,before.sFair);assert.equal(after.sInterval,before.sInterval);assert(after.sDiversity>before.sDiversity);
assert(after.avgLD<=before.avgLD+.05+1e-9);assert(after.maxLD<=Math.min(1.5,before.maxLD+.2)+1e-9);
assert(stats.risk<=oldStats.risk);assert(stats.maxRisk<=oldStats.maxRisk);
assert.deepStrictEqual(rounds(d.matches),beforeRounds,'Preserve every person’s appearances and rest');
for(const key of ['structureErr','genderErr','avoidableUnderSlots','avoidableOverSlots','balanceHardCount','balanceSevereCount','balanceCautionCount','asymSevereCount','avoidableExact','avoidableSameFour','partner4'])assert((after[key]||0)<=(before[key]||0),key);
for(const m of d.matches){assert.equal(m.team1A.team,m.team1B.team);assert.equal(m.team2C.team,m.team2D.team);assert.notEqual(m.team1A.team,m.team2C.team);}
for(const kind of ['win','voided','fixed']){const locked=data();if(kind==='fixed')locked.participants.forEach(p=>p.partnerName='E2Efixed');else locked.matches.forEach(m=>m[kind]=kind==='win'?'t1':true);const old=JSON.stringify(locked.matches);c._teamImproveRepeatBalance(locked,settings);assert.equal(JSON.stringify(locked.matches),old,kind);}
const mutation=context(src.replace('next.avgLD<=base.avgLD+0.05+1e-9','next.avgLD<=base.avgLD+1e-9')),broken=data();mutation._teamImproveRepeatBalance(broken,settings);assert(mutation._qualityAssessment(broken.matches,broken.participants,settings).total<89,'Mutation detects old rigid precision lock');
assert(src.includes('_teamImproveRepeatBalance(best,settings);'));
console.log(JSON.stringify({before:before.total,after:after.total,partnerExcess:stats.partnerExcess,opponentExcess:stats.opponentExcess,avg:after.avgLD,max:after.maxLD,preservedRounds:true}));
