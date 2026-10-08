'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('js/team.js','utf8');
function context(code){
 const c={};vm.createContext(c);vm.runInContext(fs.readFileSync('js/match-quality.js','utf8'),c);
 const cut=(a,b)=>code.slice(code.indexOf(a),code.indexOf(b,code.indexOf(a)+a.length));
 vm.runInContext(code.split('let _currentRound=1;')[0]+cut('function _matchGenderErrorCount(','function formTeams(')+cut('function _bracketQualityScore(','function _isBetterQualityKey(')+cut('function _qualityAssessment(','/* ═══ 대진 품질 대시보드'),c);return c;
}
function fixture(n,rounds){
 const ps=Array.from({length:n},(_,i)=>({name:'E2E'+i,gender:'M',level:3,team:i%4<2?'청팀':'홍팀',_goal:0,gamesPlayed:0}));
 const matches=[];rounds.forEach((ids,r)=>{for(let j=0;j<ids.length;j+=4){const p=ids.slice(j,j+4).map(i=>ps[i]);p.forEach(p=>{p._goal++;p.gamesPlayed++;});matches.push({round:r+1,court:j/4+1,type:'남복',matchNumber:matches.length+1,team1A:p[0],team1B:p[1],team2C:p[2],team2D:p[3]});}});
 return {ps,matches};
}
const cases=[
 ['partial final round',fixture(8,[[0,1,2,3,4,5,6,7],[0,1,2,3]]),0,10],
 ['expanded round with avoidable repeats',fixture(12,[[0,1,2,3],[0,1,2,3,4,5,6,7]]),4,0],
 ['expanded round rotating players',fixture(12,[[0,1,2,3],[4,5,6,7,8,9,10,11]]),0,10],
 ['same-size avoidable repeat',fixture(8,[[0,1,2,3],[0,1,2,3]]),4,0],
 ['same-size unavoidable repeat',fixture(4,[[0,1,2,3],[0,1,2,3]]),0,10]
];
const settings={teamMode:false,gamesPerPlayer:2,courts:2};
function check(c){return cases.map(([name,x,excess,interval])=>{const q=c._qualityAssessment(x.matches,x.ps,settings);assert.equal(q.excessConsec,excess,name);assert.equal(q.sInterval,interval,name);const key=c._candidateQualityKey(x.matches,x.ps,settings,0);assert.equal(key[13],excess,name+' candidate parity');return {name,interval:q.sInterval,total:q.total};});}
if(process.env.DIAGNOSE){const c=context(src);console.log(JSON.stringify(cases.map(([name,x])=>{const q=c._qualityAssessment(x.matches,x.ps,settings);return {name,interval:q.sInterval,total:q.total,excess:q.excessConsec};})));}
else {console.log(JSON.stringify(check(context(src))));const old=src.replace('rRest=N-prev.size','rRest=N-rPlay').replace('cur.length-(participants.length-prev.size)','cur.length-(participants.length-cur.length)').replace('cur.length-(nPlayers-prev.size)','cur.length-(nPlayers-cur.length)');assert.throws(()=>check(context(old)),/partial final round/);console.log('PASS unequal-round interval capacity and mutation');}

const six=fixture(6,[[0,1,2,3],[0,1,3,4],[0,1,4,5],[0,1,5,2]]);six.ps.forEach((p,i)=>p.team=i<2?'청팀':'홍팀');
const sixQ=context(src)._qualityAssessment(six.matches,six.ps,{...settings,teamMode:true,courts:1});
console.log('fixed 2 vs 4:',JSON.stringify({total:sixQ.total,diversity:sixQ.sDiversity,partnerExcess:sixQ.avoidablePartnerExcess,unavoidable:sixQ.unavoidablePartnerExcess,interval:sixQ.sInterval}));

assert.equal(sixQ.sDiversity,20,'Two-player fixed team cannot rotate partners; other team already uses distinct pairs');
assert.equal(sixQ.unavoidablePartnerExcess,3);
const sixBad=fixture(6,[[0,1,2,3],[0,1,2,3],[0,1,4,5],[0,1,4,5]]);sixBad.ps.forEach((p,i)=>p.team=i<2?'청팀':'홍팀');
const sixBadQ=context(src)._qualityAssessment(sixBad.matches,sixBad.ps,{...settings,teamMode:true,courts:1});
assert(sixBadQ.sDiversity<sixQ.sDiversity,'Still penalize avoidable repetitions in the larger team');
const oldPool=src.replaceAll('_teamUnavoidablePartnerRepeats(matches,participants,settings);','Math.max(0,Object.values(partnerCounts).reduce((s,n)=>s+n,0)-participants.reduce((sum,p,i)=>sum+participants.slice(i+1).filter(q=>q.team===p.team).length,0));');
assert(context(oldPool)._qualityAssessment(six.matches,six.ps,{...settings,teamMode:true,courts:1}).sDiversity<20,'Old pooled capacity must expose false penalty');
console.log('PASS team-specific repeat capacity, avoidable repeats and mutation');
