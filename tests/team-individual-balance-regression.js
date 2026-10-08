'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('js/team.js','utf8'),fixture=require('./fixtures/team-individual-balance.json');
function context(code){
 const cut=(a,b)=>code.slice(code.indexOf(a),code.indexOf(b,code.indexOf(a)+a.length));
 const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('js/match-quality.js','utf8'),c);
 vm.runInContext(code.split('let _currentRound=1;')[0]+cut('function _matchGenderErrorCount(','function formTeams(')+cut('function _qualityAssessment(','/* ═══ 대진 품질 대시보드')+cut('function _buildHistoryFromMatches(','/* ═══ 간편 재배정')+cut('function _teamIndividualRisk(','function _teamRefineRoundPairs('),c);return c;
}
function data(){
 const participants=fixture.players.map(([level,gender,ageGroup,team],i)=>({name:'E2E'+i,level,gender,ageGroup,team,_goal:4}));
 const matches=fixture.matches.map(([round,court,type,a,b,c,d],i)=>({round,court,type,matchNumber:i+1,team1A:participants[a],team1B:participants[b],team2C:participants[c],team2D:participants[d]}));
 const model=context(src);matches.forEach(m=>{m.team1Level=model.effLevel(m.team1A)+model.effLevel(m.team1B);m.team2Level=model.effLevel(m.team2C)+model.effLevel(m.team2D);m.levelDiff=Math.round(Math.abs(m.team1Level-m.team2Level)*10)/10;});
 return {matches,participants};
}
const settings={teamMode:true,courts:5,gamesPerPlayer:4},c=context(src),d=data(),fields=['team1A','team1B','team2C','team2D'];
const rounds=ms=>Object.fromEntries(d.participants.map(p=>[p.name,ms.filter(m=>fields.some(f=>m[f].name===p.name)).map(m=>m.round).sort().join(',')]));
const beforeRounds=rounds(d.matches),before=c._qualityAssessment(d.matches,d.participants,settings),risk=ms=>ms.reduce((s,m)=>s+c._teamIndividualRisk(m),0),oldRisk=risk(d.matches);
c._teamImproveIndividualBalance(d,settings);
const after=c._qualityAssessment(d.matches,d.participants,settings);
assert(risk(d.matches)<oldRisk-1,'Find a meaningful reduction in individual mismatch');
assert.deepStrictEqual(rounds(d.matches),beforeRounds,'Every player keeps their exact playing/rest rounds');
for(const key of ['structureErr','genderErr','avoidableUnderSlots','avoidableOverSlots','balanceHardCount','balanceSevereCount','balanceCautionCount','asymSevereCount','maxLD','avgLD','balanceRoundBiasMax','avoidableExact','avoidableSameFour','partner4','diversityPenalty'])assert((after[key]||0)<=(before[key]||0)+1e-9,key);
for(const key of ['total','sBalance','sFair','sDiversity','sInterval'])assert(after[key]>=before[key],key);
for(const m of d.matches){assert.equal(m.team1A.team,m.team1B.team);assert.equal(m.team2C.team,m.team2D.team);assert.notEqual(m.team1A.team,m.team2C.team);}
// Finished/void games and fixed partners must never move.
for(const kind of ['win','voided','fixed']){
 const locked=data();if(kind==='fixed')locked.participants.forEach(p=>p.partnerName='E2Efixed');else locked.matches.forEach(m=>m[kind]=kind==='win'?'t1':true);
 const before=JSON.stringify(locked.matches);c._teamImproveIndividualBalance(locked,settings);assert.equal(JSON.stringify(locked.matches),before,kind);
}
const broken=context(src.replace('const gain=oldRisk-_teamIndividualRisk(a)-_teamIndividualRisk(b);','const gain=0;')),mutant=data();broken._teamImproveIndividualBalance(mutant,settings);assert.equal(risk(mutant.matches),oldRisk,'Mutation must lose the improvement');
assert(src.includes('_teamImproveIndividualBalance(best,settings);'),'Production winner passes through refinement');
// +5 is a display translation: -0.7 internal is 4.3 on the comparison screen.
assert(Math.abs(c.effLevel({level:1,gender:'F',ageGroup:'50대'})+.7)<1e-9);
console.log(JSON.stringify({before:before.total,after:after.total,riskBefore:oldRisk,riskAfter:risk(d.matches),preservedRounds:true}));
