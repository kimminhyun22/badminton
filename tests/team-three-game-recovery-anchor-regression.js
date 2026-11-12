'use strict';
const assert=require('assert/strict'),fs=require('fs'),build=require('./helpers/team-competition-context');
const source=fs.readFileSync('js/team.js','utf8'),fields=['team1A','team1B','team2C','team2D'];
// Independent equal-skill doubles schedule, not a copy of an actual roster.
// The old fallback retains an empty opening round. The final-preservation
// stage removes it, so the actual chosen schedule is shorter with identical
// players, appearances, pairs and rating gaps. Recovery must use that result.
function schedule(gpp,offset=0){
 const participants=Array.from({length:8},(_,i)=>({name:'E2Eanchor'+i,team:i<4?'청팀':'홍팀',gender:[0,1,4,5].includes(i)?'F':'M',skillRating:3,level:3,grade:'C',_goal:gpp})),matches=[];
 for(let r=1;r<=gpp;r++)for(const [court,ids]of[[1,[0,2,4,6]],[2,[1,3,5,7]]])matches.push({round:r+offset,court,type:'혼복',...Object.fromEntries(fields.map((k,i)=>[k,participants[ids[i]]]))});
 return {participants,matches};
}
function run(src,gpp,{savedAnchor=false,fallbackAnchor=false}={}){
 const c=build(71,true,src),settings={teamMode:true,gamesPerPlayer:gpp,courts:2},fallback=schedule(gpp,1),selected=schedule(gpp);
 if(savedAnchor)selected.womenRecoveryOrigin=JSON.parse(JSON.stringify(fallback));
 if(fallbackAnchor)fallback.womenRecoveryOrigin=JSON.parse(JSON.stringify(fallback));
 const snapshot=JSON.stringify({fallback,selected});
 // Stub candidate discovery only. The real final selector, quality checks,
 // recovery search, anchor validation and public result choice all execute.
 c._teamOptimizeFinalists=xs=>xs[0];c._teamWomenPriorityChoice=b=>b;c._teamRefineCloseOpponents=()=>{};
 c.KokWomenDoubles.relax=()=>({accepted:0});c._teamRepairBalanceFirst=()=>({accepted:0});c._teamPreserveFinalBest=()=>selected;
 const calls=[],recover=c.KokWomenDoubles.recover,signature=b=>c.KokTeamCompetition.scheduleKey(b.matches);
 c.KokWomenDoubles.recover=(ctx,b,s,options)=>{const r=recover(ctx,b,s,options);calls.push({input:signature(b),origin:signature(options.origin),reason:r.reason,accepted:r.accepted});return r;};
 const result=c._teamSelectFinalBracket([fallback],fallback.participants,settings,gpp*2);
 assert.equal(JSON.stringify({fallback,selected}),snapshot,'candidate discovery and recovery leave the supplied schedules unchanged');
 return {c,result,settings,calls,fallback,selected,signature};
}
function assertFresh(r){
 const {c,result,settings,calls,selected,signature}=r;
 assert(calls.length>=2);assert(calls.every(x=>x.origin===signature(selected)),'new three-game recovery must start from the chosen complete schedule');
 assert.equal(Math.max(...result.matches.map(m=>m.round)),3,'finished three-game result must retain the shorter chosen schedule');
 assert(c.KokWomenDoubles.status(result.matches,result.participants,settings).rows.every(p=>p.women===2&&p.total===3),'real recovery must reach the result, not just receive the new anchor');
 assert.equal(signature(result.womenRecoveryOrigin),signature(selected),'the shown result persists that same first recovery anchor');
 assert(calls.some(x=>x.accepted>0));
}
const fresh=run(source,3);assertFresh(fresh);
const saved=run(source,3,{savedAnchor:true});assert(saved.calls.every(x=>x.origin===saved.signature(saved.fallback)),'a restored selected candidate keeps its original anchor');assert.equal(saved.signature(saved.result.womenRecoveryOrigin),saved.signature(saved.fallback));
const inherited=run(source,3,{fallbackAnchor:true});assert(inherited.calls.every(x=>x.origin===inherited.signature(inherited.fallback)),'an existing fallback anchor also precedes a fresh baseline');
const four=run(source,4);assert(four.calls.every(x=>x.origin===four.signature(four.fallback)),'four-game recovery keeps its prior baseline policy');assert.equal(four.signature(four.result.womenRecoveryOrigin),four.signature(four.fallback));
// Undo only the new caller decision: real recovery again selects the longer
// fallback, proving the output invariant detects the original integration bug.
const old=source.replace(/const recoveryOrigin=settings\.gamesPerPlayer===3\s*\?\(preserved\.womenRecoveryOrigin\|\|best\.womenRecoveryOrigin\|\|preserved\):best;/,'const recoveryOrigin=best;');
assert.notEqual(old,source,'mutation must change the recovery caller');const mutant=run(old,3);assert.equal(Math.max(...mutant.result.matches.map(m=>m.round)),4);assert.throws(()=>assertFresh(mutant),/chosen complete schedule|shorter chosen schedule/);
console.log('PASS three-game final recovery wiring: chosen schedule becomes first anchor, real women recovery reaches output, saved/fallback anchors survive, four-game baseline unchanged and old-caller mutation fails');
