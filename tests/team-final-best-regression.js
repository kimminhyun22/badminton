'use strict';
const assert=require('assert'),fs=require('fs'),build=require('./helpers/team-competition-context');
const source=fs.readFileSync('js/team.js','utf8'),fields=['team1A','team1B','team2C','team2D'];
const settings={teamMode:true,gamesPerPlayer:2,courts:2};
function fixture(c){
  const participants=[1,2,3,4,1.2,2.2,2.8,3.8].map((skillRating,i)=>({name:'E2E'+i,skillRating,gender:'M',team:i<4?'청팀':'홍팀',grade:'C',_goal:2}));
  const matches=[[0,1,4,6],[2,3,5,7],[0,2,4,7],[1,3,5,6]].map((ns,i)=>({round:1+Math.floor(i/2),court:1+i%2,matchNumber:i+1,type:'남복',...Object.fromEntries(fields.map((k,j)=>[k,participants[ns[j]]]))}));
  return c._teamCopyFinalCandidate({participants,matches});
}
function rounds(candidate){return candidate.participants.map(p=>[p.name,candidate.matches.filter(m=>fields.some(k=>m[k].name===p.name)).map(m=>m.round).sort()]);}
const c=build(71),base=fixture(c),before=JSON.stringify(base),initial=c._teamCompetitionEvaluation(base,settings);
const improved=c._teamPreserveFinalBest(base,[],settings),after=c._teamCompetitionEvaluation(improved,settings);
assert(after.score.eligible);assert.equal(after.score.version,9);
assert(after.score.diagnostics.meanAdjustedGap<initial.score.diagnostics.meanAdjustedGap);
assert(after.score.diagnostics.closeSensitivity[1].close>initial.score.diagnostics.closeSensitivity[1].close);
assert(c._teamFinalCandidateSafe(base,improved,settings,initial,after));
assert.deepEqual(rounds(improved),rounds(base),'Individual appearance and rest rounds must be unchanged');
assert.equal(JSON.stringify(base),before,'The original finished fallback must be immutable');
assert.deepEqual(improved.participants.map(p=>[p.name,p.team,p.skillRating]),base.participants.map(p=>[p.name,p.team,p.skillRating]));
const by=new Map(improved.participants.map(p=>[p.name,p]));
for(const m of improved.matches){for(const k of fields)assert.strictEqual(m[k],by.get(m[k].name));assert.equal(m.team1Level,c.effLevel(m.team1A)+c.effLevel(m.team1B));assert.equal(m.team2Level,c.effLevel(m.team2C)+c.effLevel(m.team2D));}
const history=c._buildHistoryFromMatches(improved.matches);
for(const p of improved.participants){assert.equal(p.gamesPlayed,2);assert.deepEqual(p.partnerCount,history[p.name].partnerCount);assert.deepEqual(p.opponentCount,history[p.name].opponentCount);}

const copy=c._teamCopyFinalCandidate(base);copy.participants[0].partnerCount.E2E99=9;copy.matches[0].team1A.skillRating=99;
assert.equal(JSON.stringify(base),before,'Checkpoint players/history must not alias the source');
assert.strictEqual(copy.matches[0].team1A,copy.participants[0]);
for(const flag of ['win','voided']){const played=c._teamCopyFinalCandidate(base);played.matches[0][flag]=true;const snap=JSON.stringify(played);assert.strictEqual(c._teamPreserveFinalBest(played,[improved],settings),played);assert.equal(JSON.stringify(played),snap);}
const locked=c._teamCopyFinalCandidate(base);locked.participants.forEach(p=>p.partnerName='E2E-fixed');assert.strictEqual(c._teamRefineFinalIndividuals(locked,settings),locked);
assert.strictEqual(c._teamRefineFinalIndividuals(base,settings,base,{passes:0}),base);
assert.strictEqual(c._teamRefineFinalIndividuals(base,settings,base,{budget:0}),base);
const invalid=c._teamCopyFinalCandidate(base);invalid.matches.pop();assert.strictEqual(c._teamPreserveFinalBest(invalid,[improved],settings),invalid,'This bounded polish must not mask an incomplete original schedule');

// Exercise the actual final-selection call chain: a legacy helper loses a good
// schedule, the new checkpoint path recovers it, and no individual search masks
// a disconnected recorder. This models the observed postprocessing regression.
function pipeline(src){
  const x=build(71,true,src),old=fixture(x),good=x._teamCopyFinalCandidate(improved);
  x._teamRefineRoundPairs=()=>{};x._optimizeFutureRounds=()=>{};
  x._teamImproveIndividualBalance=candidate=>{candidate.matches=x._teamCopyFinalCandidate(old).matches;};
  x._teamImproveRepeatBalance=()=>{};x._teamRefineCloseOpponents=()=>{};
  x._teamRefineFinalIndividuals=candidate=>candidate;
  const review=[],result=x._teamSelectFinalBracket([good],good.participants,settings,4,{review});
  return {x,result,old,good,review};
}
const recovered=pipeline(source),recoveredScore=recovered.x._teamCompetitionEvaluation(recovered.result,settings).score;
assert.equal(recoveredScore.total,after.score.total,'A superior checkpoint survives the worse legacy final result');
assert(recovered.review.some(x=>recovered.x._teamCompetitionEvaluation(x,settings).score.total===after.score.total),'Review evidence must contain the retained intermediate schedule');
const mutation=source.replace('return _teamPreserveFinalBest(best,checkpoints,settings);','return _teamPreserveFinalBest(best,[],settings);');assert.notEqual(mutation,source);
const lost=pipeline(mutation);assert.equal(lost.x._teamCompetitionEvaluation(lost.result,settings).score.total,initial.score.total,'Mutation disconnecting checkpoints reproduces the loss');

// Better gaps cannot purchase repeated partners: disable individual search so
// this independently tests the checkpoint's complete final safeguard.
const guarded=build(71);guarded._teamRefineFinalIndividuals=x=>x;
const repeated=guarded._teamCopyFinalCandidate(base);
[repeated.matches[0].team1B,repeated.matches[1].team1A]=[repeated.matches[1].team1A,repeated.matches[0].team1B];
const repeatCandidate=guarded._teamCopyFinalCandidate(repeated),rq=guarded._teamCompetitionEvaluation(repeatCandidate,settings);
assert(rq.score.diagnostics.meanAdjustedGap<initial.score.diagnostics.meanAdjustedGap);
assert(rq.legacy.avoidablePartnerExcess>initial.legacy.avoidablePartnerExcess);
assert.strictEqual(guarded._teamPreserveFinalBest(base,[repeatCandidate],settings),base);
const noGuard=source.replace('||!policy.protects(before.legacy,after.legacy,before.score,after.score,base.matches,next.matches)','');assert.notEqual(noGuard,source);
const unsafe=build(71,true,noGuard);unsafe._teamRefineFinalIndividuals=x=>x;
assert.notStrictEqual(unsafe._teamPreserveFinalBest(base,[repeatCandidate],settings),base,'Mutation of safety guard must admit the rejected partner regression');
console.log('PASS final checkpoints recover legacy losses; individual swaps preserve profiles, rounds, metadata, history, results and locks; both disconnect/safety mutations detected');
