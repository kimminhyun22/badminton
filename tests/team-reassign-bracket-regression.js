'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const build=require('./helpers/team-competition-context'),f=require('./fixtures/team-reassign-swap.json');
const source=fs.readFileSync(path.join(__dirname,'../js/team.js'),'utf8'),fields=['team1A','team1B','team2C','team2D'],s=f.settings;
function fixture(c){const participants=f.players.map(p=>({...p,_goal:s.gamesPerPlayer}));return c._teamCopyFinalCandidate({participants,matches:f.matches.map(([round,court,type,...ids])=>({round,court,type,...Object.fromEntries(fields.map((k,i)=>[k,participants[ids[i]]]))}))});}
function run(src=source){
 const c=build(71,true,src),base=fixture(c),b=base.participants.filter(p=>p.team==='청팀'),w=base.participants.filter(p=>p.team==='홍팀'),snapshot=JSON.stringify(base);
 // Isolate the warm comparison: this improvement must not require a fresh
 // random generation, and must include swaps outside the four-item shortlist.
 c._teamAllocationBracket=()=>null;
 const out=c._teamJointAllocation(b,w,s,[],{currentCandidate:{...base,settings:s}});
 const before=c._teamCompetitionEvaluation(base,s),after=c._teamCompetitionEvaluation(out.bracket,s);
 assert(after.score.total>before.score.total,'complete-bracket exchange improves visible total');
 assert(c._isBetterQualityKey(c.KokTeamCompetition.rankKey(after.score),c.KokTeamCompetition.rankKey(before.score)));
 assert(c._teamAllocationCandidateSafe(base,out.bracket,s,before,after));
 assert.equal(JSON.stringify(base),snapshot,'immutable current bracket');
 assert.notEqual(out.blue.map(p=>p.name).sort().join('|'),b.map(p=>p.name).sort().join('|'));
 const ps=[...out.blue.map(p=>({...p,team:'청팀'})),...out.white.map(p=>({...p,team:'홍팀'}))];
 const materialized=c._teamValidatePreferredCandidate(out.bracket,ps,s);
 assert.equal(c.KokTeamCompetition.scheduleKey(materialized.matches),c.KokTeamCompetition.scheduleKey(out.bracket.matches));
 assert.notEqual(materialized.matches,out.bracket.matches);assert.notEqual(materialized.participants[0],out.bracket.participants[0]);
 for(const change of [xs=>xs.slice(1),xs=>xs.map((p,i)=>i?p:{...p,skillRating:p.skillRating+.1}),xs=>xs.map((p,i)=>i?p:{...p,team:'invalid'})])assert.throws(()=>c._teamValidatePreferredCandidate(out.bracket,change(ps),s),/다릅니다/);
 assert.throws(()=>c._teamValidatePreferredCandidate({...out.bracket,settings:{...s,courts:s.courts+1}},ps,s),/다릅니다/);
 assert.throws(()=>c._teamValidatePreferredCandidate({...out.bracket,matches:out.bracket.matches.map((m,i)=>i?m:{...m,win:'청팀'})},ps,s),/다릅니다/);
 const locked=c._teamJointAllocation(b,w,s,base.participants.map(p=>p.name),{currentCandidate:base});
 assert.equal(c.KokTeamCompetition.scheduleKey(locked.bracket.matches),c.KokTeamCompetition.scheduleKey(base.matches));
 assert.equal(locked.blue,b);assert.equal(locked.white,w);
 const singles=c.KokTeamCompetition.allocationCandidates(b,w,[],c.effLevel,{allSingles:true});
 assert(singles.some(x=>x.kind==='men'));assert(singles.some(x=>x.kind==='women'));assert(singles.length>4);
 // Same members/teams can keep improving after the first reshuffle. Every
 // accepted result must protect the original displayed total and safeguards.
 const first=c._teamChooseReshuffleCandidate(base,[],s),second=c._teamChooseReshuffleCandidate(first,[],s);
 assert(c._teamCompetitionEvaluation(first,s).score.total>=before.score.total);
 assert(c._teamCompetitionEvaluation(second,s).score.total>=c._teamCompetitionEvaluation(first,s).score.total);
 assert.equal(JSON.stringify(base),snapshot);
 return {before:before.score.total,after:after.score.total,swaps:singles.length};
}
const result=run();
function profiles(c){
 const base=fixture(c),latest=base.participants.map(p=>({...p,memberId:'current-'+p.name,clubId:'current-club',club:'E2Eclub',isGuest:false,isClubOfficial:false}));
 base.participants.forEach(p=>{p.memberId='';p.clubId='';p.club='old';p.isGuest=true;p.isClubOfficial=true;});
 const copy=c._teamValidatePreferredCandidate(base,latest,s);
 assert.equal(copy.participants[0].memberId,latest[0].memberId);assert.equal(copy.participants[0].clubId,'current-club');
 assert.equal(copy.participants[0].club,'E2Eclub');assert.equal(copy.participants[0].isGuest,false);assert.equal(copy.participants[0].isClubOfficial,false);
 const by=new Map(copy.participants.map(p=>[p.name,p]));assert(copy.matches.every(m=>fields.every(k=>m[k]===by.get(m[k].name))));
 base.participants[0].memberId='different';assert.throws(()=>c._teamValidatePreferredCandidate(base,latest,s),/다릅니다/);
 base.participants[0].memberId='';base.participants[0].clubId='different';assert.throws(()=>c._teamValidatePreferredCandidate(base,latest,s),/다릅니다/);
}
profiles(build());
const staleProfile=source.replace('_teamCopyFinalCandidate({...candidate,participants:players.map(p=>({...p,_goal:p._goal??settings.gamesPerPlayer}))})','_teamCopyFinalCandidate(candidate)');
assert.notEqual(staleProfile,source);assert.throws(()=>profiles(build(71,true,staleProfile)),assert.AssertionError,'stale profile mutation fails');
const mutant=source.replace('effLevel,{allSingles:true}','effLevel,{allSingles:false}');assert.notEqual(mutant,source);
assert.throws(()=>run(mutant),/complete-bracket exchange improves/,'shortlist-only mutation loses real improvement');
// One unusable original seed must not prevent testing valid alternative teams.
const c=build(),base=fixture(c),blue=base.participants.filter(p=>p.team==='청팀'),white=base.participants.filter(p=>p.team==='홍팀');
let calls=0;const policies=[];
c.KokTeamCompetition={...c.KokTeamCompetition,allocationCandidates:()=>[{blue,white}]};
c._teamAllocationBracket=(b,w,settings)=>{policies.push(settings._closePriority);return ++calls===1?null:fixture(c);};
const chosen=c._teamJointAllocation(blue,white,s);
assert.equal(calls,6);assert(policies.every(Boolean));assert(chosen.bracket);assert(c._teamCompetitionEvaluation(chosen.bracket,s).score.eligible);
console.log('PASS whole-bracket exchange, all legal singles, exact handoff, locks/profiles/settings, repeated nondecreasing reshuffle, failed seed continuation and mutation',result);
