'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const policy=require('../js/team-competition');
const fixture=require('./fixtures/women-flex-roster.json');
const build=require('./helpers/team-competition-context');

const ctx=build();
const settings={gamesPerPlayer:4,teamMode:true,courts:5};
const participants=fixture.players.map(player=>({...player,_goal:4,level:3,grade:'C',ageGroup:'30대',partnerCount:{},opponentCount:{}}));
const slots=['team1A','team1B','team2C','team2D'];
const original={participants,matches:fixture.matches.map(([round,court,type,...ids])=>({
  round,court,type,...Object.fromEntries(slots.map((slot,i)=>[slot,participants[ids[i]]]))
}))};
const alternative=ctx.KokWomenDoubles.relax(ctx,original,settings).candidate;
const getScore=event=>ctx._teamCompetitionEvaluation(event,settings).score;
const base=getScore(original),alt=getScore(alternative),scores=[base,alt];
const draft={blocking:[],caution:[],phase:'draft',canCompare:true};
const decide=(score,review,options=draft)=>policy.scheduleDecision(score,review,options);
const baseComparison=policy.compareCandidates(base,scores);
const alternativeComparison=policy.compareCandidates(alt,scores);
assert.equal(baseComparison.rank,1);
assert.equal(alternativeComparison.rank,2);
// The absolute number has no influence on a verified feasibility recommendation.
assert.equal(decide({...base,total:59},baseComparison).title,'현재 대진으로 진행 권장');
const tradeoff=decide(alt,alternativeComparison);
assert.equal(tradeoff.title,'장단점이 다른 후보 있음');
for(const message of ['접전 1경기 감소','여복 1경기 증가','여복 목표 달성 3명 증가','최대 실력 차 1.17 → 1.36']){
  assert.ok(tradeoff.detail.includes(message),tradeoff.detail);
}
assert.match(decide(base,baseComparison,{...draft,caution:['여복 목표 미달']}).detail,/여복 목표 미달/);
assert.equal(decide(base,baseComparison,{...draft,blocking:['종목 성별 오류']}).title,'편성 확인 필요');
const fixed=decide({...base,eligible:false,issues:['출전 목표 미달']},{verified:false,repairAvailable:{maxBefore:2.3,maxAfter:1.4}},draft);
assert.match(fixed.detail,/출전 목표 미달.*2.30 → 1.40/);
assert(!fixed.detail.includes('1위'));
const missing={verified:false,reason:'현재 조건의 비교 기록이 없습니다.'};
assert.equal(decide(base,missing).title,'현재 조건의 후보 비교 필요');
assert.match(decide({...base,version:9},baseComparison).title,/이전 기준/);
for(const phase of ['live','published','finished']){
  assert.doesNotMatch(decide(base,baseComparison,{...draft,phase}).title,/진행 권장|재생성/);
  assert.doesNotMatch(decide(base,missing,{...draft,phase}).title,/비교 필요|재생성/);
}
assert.doesNotMatch(decide(base,missing,{...draft,canCompare:false}).title,/비교 필요/);
for(const refs of [null,{},[null,base],[{eligible:true,version:10},alt],[{...base,diagnostics:{...base.diagnostics,closeSensitivity:[null]}}]]){
  assert.equal(policy.compareCandidates(base,refs).verified,false,'malformed stored evidence cannot establish rank');
}
const src=fs.readFileSync(path.resolve(__dirname,'../js/team.js'),'utf8');
const slice=(begin,end)=>src.slice(src.indexOf(begin),src.indexOf(end,src.indexOf(begin)));
vm.runInContext(slice('function _teamLiveSigName(','function _teamLiveSignatureFromData('),ctx);
vm.runInContext(slice('var _teamQualitySummary=','function openQualityPanelAfterRender('),ctx);
const panel={};
Object.assign(ctx,{document:{getElementById:()=>panel},_teamFinishedAt:0,_liveOn:false,_liveMatchStartedAt:0,currentMatches:original.matches,
  _teamFullReassignmentLocked:()=>ctx._liveOn,_teamAssignmentBusy:false,_isMatchDone:()=>false,_teamReshuffleState:'',_teamReshuffleMessage:'',esc:String});
function review(event,other){
  const evidence=ctx._teamBuildConditionalReview(event,[other],settings,2);
  return {...settings,conditionalReview:evidence};
}
const reviewed=review(original,alternative);
function render(event,config){
  ctx.currentMatches=event.matches;
  ctx.renderQualityDashboard(event.matches,event.participants,config);
  return panel.innerHTML;
}
const html=render(original,reviewed);
const details=html.indexOf('<details class="team-quality-details">');
assert(details>html.indexOf('현재 대진으로 진행 권장')&&details<html.indexOf('합산 품질점수'));
assert.equal(ctx._teamQualitySummary.bracketKey,ctx._teamLiveSignatureFromMatches(original.matches));
assert.equal(ctx._teamQualitySummary.decisionPhase,'draft');
assert(!html.includes('onclick="teamReviewCurrentBracket()"'));
assert.match(render(alternative,review(alternative,original)),/장단점이 다른 후보 있음/);
for(const refs of [null,{},[],[{},{}],reviewed.conditionalReview.references.map(()=>reviewed.conditionalReview.references[0])]){
  const absent={...reviewed,conditionalReview:{...reviewed.conditionalReview,references:refs}};
  const output=render(original,absent);
  assert.match(output,/현재 조건의 후보 비교 필요/);
  assert.match(output,/onclick="teamReviewCurrentBracket\(\)"/);
  assert.doesNotMatch(output,/현재 대진으로 진행 권장/);
}
const brokenRepair={...reviewed,conditionalReview:{...reviewed.conditionalReview,repairAvailable:{maxBefore:'old'}}};
assert.doesNotThrow(()=>render(original,brokenRepair));
render(original,settings);
Object.assign(ctx,{currentSettings:settings,currentParticipants:participants});
vm.runInContext(slice('function _teamRefreshQualityPhase(', 'function _liveKey('),ctx);
ctx._liveOn=true;
ctx._teamRefreshQualityPhase();
assert(!panel.innerHTML.includes('onclick="teamReviewCurrentBracket()"'));
assert.equal(ctx._teamQualitySummary.decisionPhase,'published');
ctx._liveMatchStartedAt=1;
ctx._teamRefreshQualityPhase();
assert.equal(ctx._teamQualitySummary.decisionPhase,'live');
const stableSummary=ctx._teamQualitySummary;
ctx._teamRefreshQualityPhase();
assert.equal(ctx._teamQualitySummary,stableSummary,'score updates in the same phase should not repeat the quality calculation');
console.log('PASS actionable quality starts with same-roster evidence, names tradeoffs, keeps details, rejects incomplete or stale evidence and respects the event phase');
