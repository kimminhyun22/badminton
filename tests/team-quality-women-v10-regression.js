'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm'),build=require('./helpers/team-competition-context'),fixture=require('./fixtures/team-women-missing.json'),Q=require('../js/team-competition');
const fields=['team1A','team1B','team2C','team2D'],c=build(),s=fixture.settings;
function candidate(){const participants=fixture.players.map(p=>({...p}));return c._teamCopyFinalCandidate({participants,matches:fixture.matches.map(([round,court,type,...ids])=>Object.assign({round,court,type},Object.fromEntries(fields.map((k,i)=>[k,participants[ids[i]]]))))});}
const base=candidate(),snapshot=JSON.stringify(base),old=c._teamCompetitionEvaluation(base,{...s,_qualityScoreVersion:9}),now=c._teamCompetitionEvaluation(base,s);
assert.equal(old.score.total,79.3);assert.equal(old.score.components.games,49.7);
assert.equal(now.score.version,10);assert.equal(now.score.total,76.7);assert.deepEqual(JSON.parse(JSON.stringify(now.score.maxima)),{games:55,overall:20,women:10,diversity:5,rest:10});
assert.equal(now.score.components.games,47.1);assert.equal(now.score.components.women,0);assert.equal(now.score.diagnostics.womenPreference.zero,7);
assert(now.score.components.games/55>old.score.components.games/65,'close games get a fairer rating while zero women games incur a separate cost');
const r=c.KokWomenDoubles.recover(c,base,s),next=c._teamCompetitionEvaluation(r.candidate,s);
assert(r.accepted>0);assert.equal(JSON.stringify(base),snapshot);assert(r.evaluations<=384&&r.examined<=6000);
assert.equal(next.score.diagnostics.womenPreference.zero,3);assert(next.score.total>now.score.total);
for(const k of ['underSlots','overSlots','balanceHardCount','balanceCautionCount','balanceSevereCount','asymSevereCount','restWorstExcess','restTotalExcess','excessConsec','avoidablePartnerExcess','avoidableSameFour','avoidableExact','sameFourRepeats','exactMatchRepeats','maxPartnerRepeat'])assert((next.legacy[k]||0)<=(now.legacy[k]||0),k);
const rounds=b=>Object.fromEntries(b.participants.map(p=>[p.name,b.matches.filter(m=>fields.some(k=>m[k].name===p.name)).map(m=>m.round).sort((a,b)=>a-b)]));assert.deepEqual(rounds(r.candidate),rounds(base));
const rd=next.score.diagnostics,bd=now.score.diagnostics;assert(rd.maxAdjustedGap<=Math.min(1.5,bd.maxAdjustedGap+.35)+1e-9);assert(rd.meanAdjustedGap<=bd.meanAdjustedGap+.1+1e-9);assert(rd.tailAdjustedGap<=bd.tailAdjustedGap+.25+1e-9);assert(rd.closeSensitivity[1].close>=bd.closeSensitivity[1].close-2);
const anchor=JSON.stringify(r.candidate.womenRecoveryOrigin),again=c.KokWomenDoubles.recover(c,JSON.parse(JSON.stringify(r.candidate)),s);assert.equal(JSON.stringify(again.candidate.womenRecoveryOrigin),anchor);assert(c._teamCompetitionEvaluation(again.candidate,s).score.diagnostics.closeSensitivity[1].close>=bd.closeSensitivity[1].close-2,'repeated recovery may not reset the original allowance');
const chosen=c._teamChooseReshuffleCandidate(base,[],s);assert(c._teamCompetitionEvaluation(chosen,s).score.diagnostics.womenPreference.zero<7,'the actual reshuffle path must consider women recovery');
const copied=c._teamCopyFinalCandidate(r.candidate);copied.womenRecoveryOrigin.participants[0].skillRating=99;assert.notEqual(r.candidate.womenRecoveryOrigin.participants[0].skillRating,99,'undo/candidate copies own their recovery anchor');
for(const kind of ['win','voided']){const b=candidate();b.matches[0][kind]=true;assert.equal(c.KokWomenDoubles.recover(c,b,s).accepted,0);}
assert.equal(c.KokWomenDoubles.recover(c,base,s,{budget:0}).accepted,0);
assert.equal(c.KokWomenDoubles.recover(c,base,{...s,teamMode:false}).accepted,0);
assert(!Q.compareCandidates(now.score,[old.score,old.score]).verified);
console.log('PASS v10 actual anonymous schedule: v9 preserved, softer closeness plus real women penalty, guarded recovery, fixed origin across repeats/reload, input and profile copies');

const legacy={sFair:20,sDiversity:20,sInterval:10,safetyIssues:[],total:100};
function scalar(gap,gender='M'){const ps=Array.from({length:4},(_,i)=>({name:'E2Escale'+i,gender,team:i<2?'청팀':'홍팀',skillRating:i<2?3+gap/2:3}));return {ps,ms:[{round:1,court:1,type:gender==='F'?'여복':'남복',team1A:ps[0],team1B:ps[1],team2C:ps[2],team2D:ps[3]}]};}
const score=(x,settings={teamMode:true,gamesPerPlayer:2},policy=Q)=>policy.assess(legacy,x.ms,x.ps,settings,p=>p.skillRating,()=>0);
assert.equal(score(scalar(.2)).components.games,65);assert.equal(score(scalar(0)).components.games,65);assert(score(scalar(.4)).components.games<65);assert.equal(score(scalar(2)).components.games,0);assert(score(scalar(.199)).total-score(scalar(.201)).total<.2);
const onlyWomen=scalar(0,'F');assert.equal(score(onlyWomen).components.women,10);assert.equal(score(onlyWomen,{teamMode:true,gamesPerPlayer:4}).components.women,7);
const impossible=scalar(4,'F'),excluded=score(impossible);assert(!('women' in excluded.maxima));assert.equal(excluded.maxima.games,65);assert.equal(excluded.diagnostics.womenPreference.scored,0);
const fixed=scalar(0,'F');fixed.ps[0].partnerName='E2Eabsent';assert.equal(score(fixed).diagnostics.womenPreference.scored,0);
const changed=scalar(4,'F');score(changed);changed.ps.forEach(p=>p.skillRating=3);assert.equal(score(changed).diagnostics.womenPreference.scored,4,'feasibility cache changes with ratings');
const boundary=scalar(0,'F');[4.017,2.517,3.767,3.767].forEach((n,i)=>boundary.ps[i].skillRating=n);assert(c._teamPairBalance(boundary.ps.slice(0,2),boundary.ps.slice(2)).allowed);assert.equal(score(boundary).diagnostics.womenPreference.scored,4,'compound threshold must use the common floating-point tolerance');
const late=scalar(0,'F');late.ps.forEach(p=>p._goal=2);assert.equal(score(late,{teamMode:true,gamesPerPlayer:4}).diagnostics.womenPreference.rows[0].target,1);
const noFeasible={...now.score,diagnostics:{...now.score.diagnostics,womenPreference:{rows:now.score.diagnostics.womenPreference.rows.map((p,i)=>({...p,eligible:i>0}))}}};assert(!c._teamAllocationCandidateSafe(base,base,s,now,{legacy:now.legacy,score:noFeasible}),'changing teams cannot earn an exemption by removing an existing woman’s possible quartet');
assert(Q.rankKey(score(scalar(1.51)))[2]>Q.rankKey(score(scalar(1.49)))[2],'large-gap caution band precedes preference points');
const src=fs.readFileSync('js/team-competition.js','utf8'),mutant={module:{exports:{}}};vm.runInNewContext(src.replace('women:preference?.fraction','women:1'),mutant);assert(mutant.module.exports.assess(now.legacy,base.matches,base.participants,s,c.effLevel,c._teamBalanceDiff).total>now.score.total,'removing the women penalty breaks the reproduced total');
console.log('PASS policy boundaries: full close credit, smooth loss, large-gap guard, first experience, proven quartet exclusions, cache invalidation and mutation');

function load(ctx,f){const participants=f.players.map(p=>({...p,_goal:p._goal??4}));return ctx._teamCopyFinalCandidate({participants,matches:f.matches.map(([round,court,type,...ids])=>Object.assign({round,court,type},Object.fromEntries(fields.map((k,i)=>[k,participants[ids[i]]]))))});}
const generated=load(c,require('./fixtures/team-women-recovery-choice.json')),direct=c.KokWomenDoubles.recover(c,generated,s),selected=c._teamChooseReshuffleCandidate(generated,[],s);
assert(direct.accepted);assert(c._teamCompetitionEvaluation(selected,s).score.total>=c._teamCompetitionEvaluation(direct.candidate,s).score.total,'refinement must not discard the better recovery from its original input');
assert(c._teamCompetitionEvaluation(selected,s).score.diagnostics.womenPreference.zero<7);
const retained=c._teamChooseReshuffleCandidate(selected,[],s);assert.equal(c.KokTeamCompetition.scheduleKey(retained.womenRecoveryOrigin.matches),c.KokTeamCompetition.scheduleKey(generated.matches),'a generated candidate cannot replace the first anchor');
assert.equal(c.KokWomenDoubles.recover(c,selected,{...s,courts:4}).reason,'mismatched-origin');
function pipeline(f){const x=build(),b=load(x,f);x._teamOptimizeFinalists=xs=>xs[0];x._teamWomenPriorityChoice=b=>b;x._teamRefineCloseOpponents=()=>{};const next=x._teamSelectFinalBracket([b],b.participants,s,b.matches.length);return {x,b,next,before:x._teamCompetitionEvaluation(b,s),after:x._teamCompetitionEvaluation(next,s)};}
const small=pipeline(require('./fixtures/women-flex-roster.json'));assert(small.after.score.diagnostics.womenPreference.rows.every(p=>p.women>=p.target),'a small closeness gain must not force a larger women preference loss');
const large=pipeline(require('./fixtures/team-women-v10-relax.json'));assert(large.before.score.diagnostics.maxAdjustedGap>1.5);assert(large.after.score.diagnostics.maxAdjustedGap<1.5);assert(large.after.score.total>=large.before.score.total);assert(large.after.score.diagnostics.womenPreference.rows.every(p=>p.women>=1));assert(large.after.score.diagnostics.womenPreference.rows.some(p=>p.women<p.target),'large guarded gain can still justify a conditional quota reduction');
console.log('PASS complete selection paths: original recovery retained, repeated anchor/settings protection, small relaxation rejected and large guarded relaxation accepted');
