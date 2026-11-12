'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),build=require('./helpers/team-competition-context');
const fields=['team1A','team1B','team2C','team2D'],source=fs.readFileSync('js/women-doubles.js','utf8');
function schedule(ratings,female,perTeam,rows){
 const participants=ratings.map((skillRating,i)=>({name:'E2Ethree'+i,gender:female.includes(i)?'F':'M',team:i<perTeam?'청팀':'홍팀',skillRating,level:3,grade:'C',_goal:3}));
 const matches=rows.map(([round,court,...ids])=>{const ps=ids.map(i=>participants[i]),n=ps.filter(p=>p.gender==='F').length;return {round,court,type:n===4?'여복':n===0?'남복':n===2?'혼복':'보정',...Object.fromEntries(fields.map((k,i)=>[k,ps[i]]))};});
 return {participants,matches};
}
function mixed(ratings=Array(8).fill(3)){return schedule(ratings,[0,1,4,5],4,[1,2,3].flatMap(round=>[[round,1,0,2,4,6],[round,2,1,3,5,7]]));}
function burden(b){return Object.fromEntries(b.participants.map(p=>[p.name,b.matches.filter(m=>fields.some(k=>m[k].name===p.name)).map(m=>m.round).sort((a,b)=>a-b)]));}
function assertStrict(c,b,n,s){
 const a=c._teamCompetitionEvaluation(b,s),z=c._teamCompetitionEvaluation(n,s),ad=a.score.diagnostics,zd=z.score.diagnostics;
 assert(z.score.eligible);assert(z.score.components.games>=a.score.components.games-1e-9);
 for(const k of ['maxAdjustedGap','tailAdjustedGap','meanAdjustedGap'])assert(zd[k]<=ad[k]+1e-9,k);
 assert(Math.abs(zd.netPerGame)<=Math.abs(ad.netPerGame)+1e-9);
 const favored=d=>Math.abs(d.closeSensitivity[1].blue-d.closeSensitivity[1].white);assert(favored(zd)<=favored(ad));
 for(const k of ['structureErr','genderErr','underSlots','overSlots','avoidableOverSlots','balanceHardCount','balanceCautionCount','balanceSevereCount','asymSevereCount','restWorstExcess','restTotalExcess','avoidablePartnerExcess','excessConsec','avoidableSameFour','avoidableExact','sameFourRepeats','exactMatchRepeats','maxPartnerRepeat'])assert((z.legacy[k]||0)<=(a.legacy[k]||0),k);
 assert.deepEqual(burden(n),burden(b),'recovery preserves each person’s appearance and rest rounds');
}
const c=build(71),s={teamMode:true,gamesPerPlayer:3,courts:2},base=mixed(),snapshot=JSON.stringify(base),r=c.KokWomenDoubles.recover(c,base,s);
assert(r.accepted>0,'three-game recovery must be reached');assert.equal(JSON.stringify(base),snapshot);
assert(c.KokWomenDoubles.status(r.candidate.matches,r.candidate.participants,s).rows.every(p=>p.women===2&&p.total===3));assertStrict(c,base,r.candidate,s);
assert(r.evaluations<=384&&r.examined<=6000);
const saved=JSON.parse(JSON.stringify(r.candidate)),anchor=JSON.stringify(saved.womenRecoveryOrigin),again=c.KokWomenDoubles.recover(c,saved,s);
assert.equal(JSON.stringify(again.candidate.womenRecoveryOrigin),anchor,'reload/retry cannot reset the original allowance');assertStrict(c,base,again.candidate,s);assertStrict(c,saved,again.candidate,s);
for(const key of ['win','voided']){const b=mixed();b.matches[0][key]=true;assert.equal(c.KokWomenDoubles.recover(c,b,s).accepted,0);}
assert.equal(c.KokWomenDoubles.recover(c,mixed(),{...s,gamesPerPlayer:2}).accepted,0);
assert.equal(c.KokWomenDoubles.recover(c,mixed(),{...s,teamMode:false}).accepted,0);
assert.equal(c.KokWomenDoubles.recover(c,mixed(),s,{budget:0}).accepted,0);
assert.equal(c.KokWomenDoubles.recover(c,saved,{...s,courts:3}).reason,'mismatched-origin');

// All original mixed games are exactly even. Separating genders can increase
// the women bonus while making the women/men games .2 points apart. This is a
// genuinely higher-total but worse-closeness candidate, not an invented score.
const harmful=mixed([3.1,3.1,3,3,3,3,3.1,3.1]),harmfulSnapshot=JSON.stringify(harmful),rejected=c.KokWomenDoubles.recover(c,harmful,s);
assert.equal(rejected.accepted,0,'a women bonus must not purchase a wider gap');assert.equal(JSON.stringify(harmful),harmfulSnapshot);
const loose={};vm.createContext(loose);assert(source.includes('const strict=settings.gamesPerPlayer===3;'));vm.runInContext(source.replace('const strict=settings.gamesPerPlayer===3;','const strict=false;'),loose);
const wrong=loose.KokWomenDoubles.recover(c,harmful,s),bad=c._teamCompetitionEvaluation(wrong.candidate,s),before=c._teamCompetitionEvaluation(harmful,s);
assert(wrong.accepted>0,'removing the strict adoption guard must expose the regression');assert(bad.score.total>before.score.total);assert(bad.score.diagnostics.maxAdjustedGap>before.score.diagnostics.maxAdjustedGap);
assert.throws(()=>assertStrict(c,harmful,wrong.candidate,s),'the test must reject the higher-scoring but worse fixture');
const bypass={};vm.createContext(bypass);assert(source.includes('&&safe(p.candidate,e,true)'));vm.runInContext(source.replace('&&safe(p.candidate,e,true)',''),bypass);assert(bypass.KokWomenDoubles.recover(c,harmful,s).accepted>0,'removing final adoption recheck exposes the same regression');
assert.equal(c.KokWomenDoubles.recover(c,wrong.candidate,s).reason,'input-outside-origin-protection','the original anchor is also checked after reload');

// Independent hand-built 16-player example: one difficult women game can be
// exchanged for two compensation games while keeping all three appearances.
const flex=schedule([4,4,2,2,2.3,2.3,4,4,3,3,2,2,2.6,2.6,4,4],[0,1,2,3,8,9,10,11],8,[
 [1,1,0,1,8,9],[1,2,2,3,10,11],[1,3,4,5,12,13],[1,4,6,7,14,15],
 [2,1,0,2,8,10],[2,2,1,3,9,11],[2,3,4,6,12,14],[2,4,5,7,13,15],
 [3,1,0,6,8,14],[3,2,1,7,9,15],[3,3,2,4,10,12],[3,4,3,5,11,13]]),fs3={...s,courts:4},flexSnapshot=JSON.stringify(flex),relaxed=c.KokWomenDoubles.relax(c,flex,fs3),qb=c._teamCompetitionEvaluation(flex,fs3),qa=c._teamCompetitionEvaluation(relaxed.candidate,fs3);
assert.equal(relaxed.accepted,1);assert.equal(JSON.stringify(flex),flexSnapshot);assert.deepEqual(burden(relaxed.candidate),burden(flex));
assert(qa.score.diagnostics.maxAdjustedGap<=qb.score.diagnostics.maxAdjustedGap*.9+1e-9);assertStrict(c,flex,relaxed.candidate,fs3);
const women=c.KokWomenDoubles.status(relaxed.candidate.matches,relaxed.candidate.participants,fs3).rows;assert(women.every(p=>p.total===3&&p.women>=1));assert(women.some(p=>p.women===1));
const goals=JSON.parse(JSON.stringify(flex));goals.participants[0]._goal=4;assert.equal(c.KokWomenDoubles.relax(c,goals,fs3).accepted,0,'mixed per-person goals need their own validation');
const oldGate={};vm.createContext(oldGate);vm.runInContext(source.replaceAll('![3,4].includes(settings.gamesPerPlayer)','settings.gamesPerPlayer!==4'),oldGate);assert.equal(oldGate.KokWomenDoubles.recover(c,base,s).accepted,0);assert.equal(oldGate.KokWomenDoubles.relax(c,flex,fs3).accepted,0,'restoring the four-only gate breaks both useful examples');
console.log('PASS three-game women policy: recovery and relaxation, strict closeness/advantage adoption, original+working protection, immutable reload anchor, bounded search, participation/rest/locks and gate/adoption mutations');
