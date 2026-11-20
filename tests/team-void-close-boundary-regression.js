'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const build = require('./helpers/team-competition-context');
const c = build(71);
const settings = {teamMode:true, gamesPerPlayer:3, courts:2};
const slots = [[0,1,4,5],[2,3,6,7],[0,2,4,6],[1,3,5,7],[0,3,4,7],[1,2,5,6]];

function draw(blue,red) {
  const participants = Array.from({length:8}, (_,i) => ({
    name:'E2E선수'+i, level:3, skillRating:i<4?blue:red, gender:'F', grade:'C', team:i<4?'청팀':'홍팀'
  }));
  const matches = slots.map(([a,b,x,y], i) => ({
    round:Math.floor(i/2)+1, court:i%2+1, matchNumber:i+1, type:'여복',
    team1A:participants[a], team1B:participants[b], team2C:participants[x], team2D:participants[y]
  }));
  return {matches,participants};
}

const evaluate = event => c._teamCompetitionEvaluation(event,settings);
for (const [blue,red,side] of [[3.1,3,'close'],[4.1,4,'close'],[3,3.1,'close'],[4,4.1,'close'],
                             [3.10001,3,'blue'],[3,3.10001,'white']]) {
  const diagnostics = evaluate(draw(blue,red)).score.diagnostics;
  assert.equal(diagnostics.closeSensitivity[1][side],6);
  assert.equal(diagnostics.formatBalance[0][side],6);
}
const event = draw(3.1,3);
const {matches,participants} = event;
const signature = c.KokTeamCompetition.scheduleKey(matches);
const initial = evaluate(event);
const eventSettings = {...settings,conditionalReview:{
  version:5, context:c.KokTeamCompetition.reviewContext(participants,settings),
  selectedSignature:signature, references:[{score:initial.score},{score:initial.score}]
}};
assert(c._teamConditionalAssessment(matches,participants,eventSettings).verified);
const oldSettings = {...eventSettings,conditionalReview:{...eventSettings.conditionalReview,version:4}};
assert(!c._teamConditionalAssessment(matches,participants,oldSettings).verified);
matches[0].voided=true;
const result = evaluate(event);
assert.equal(result.legacy.underSlots,4);
assert.equal(result.score.eligible,false);
assert.deepEqual(Array.from(result.score.issues),['출전 목표 미달']);
assert.equal(result.score.diagnostics.closeSensitivity[1].close,5);
assert.equal(result.score.diagnostics.formatBalance[0].games,5);
assert.equal(result.score.diagnostics.womenPreference.rows.filter(p=>p.total===2).length,4);
assert.notEqual(c.KokTeamCompetition.scheduleKey(matches),signature);
assert(!c._teamConditionalAssessment(matches,participants,eventSettings).verified);

const adminSource = fs.readFileSync(path.join(__dirname,'../js/team.js'),'utf8');
const el = {};
Object.assign(c,{document:{getElementById:()=>el},_liveMatchStartedAt:1,_teamFinishedAt:0,currentMatches:matches,
  _teamFullReassignmentLocked:()=>true,_teamAssignmentBusy:false,_teamReshuffleState:'',_teamReshuffleMessage:'',esc:String});
vm.runInContext(adminSource.slice(adminSource.indexOf('var _teamQualitySummary='),adminSource.indexOf('function openQualityPanelAfterRender(')),c);
c.renderQualityDashboard(matches,participants,eventSettings);
assert.match(el.innerHTML,/미실시 1경기를 제외한 5경기/);
assert.match(el.innerHTML,/접전 5\/5경기/);
assert.match(el.innerHTML,/미달 4명/);
assert.match(el.innerHTML,/보완 필요/);
assert.equal(c._teamQualitySummary.voidedGames,'1');
assert(c._teamQualitySummary.issues.some(issue=>issue.includes('4명에게 총 4회')));
assert(!c._teamQualitySummary.issues.some(issue=>issue.includes('특이사항 없음')));
assert.match(c._teamQualitySummary.opTitle,/현장 편성 확인/);
const updatedSummary=c._teamQualitySummary;
matches.forEach(m=>m.voided=true);
c.renderQualityDashboard(matches,participants,eventSettings);
assert.match(el.innerHTML,/모든 경기가 미실시/);
assert.equal(c._teamQualitySummary,null);
matches.forEach(m=>delete m.voided);
assert.equal(c.KokTeamCompetition.scheduleKey(matches),signature);
assert(evaluate(event).score.eligible);
c.renderQualityDashboard(matches,participants,eventSettings);
assert.equal(c._teamQualitySummary.voidedGames,'');

const memberSource=fs.readFileSync(path.join(__dirname,'../js/live-view.js'),'utf8');
const member={_canFixResult:()=>true,_liveTimeLeft:()=>null,_officialQualityOpen:false,esc:String};
vm.createContext(member);
vm.runInContext(memberSource.slice(memberSource.indexOf('function _officialQualityHtml('),memberSource.indexOf('/* 지금 메워야 하는 자리')),member);
const published=matches.map(m=>({num:m.matchNumber,round:m.round,type:m.type}));
published[0].voided=true;
const html = quality => member._officialQualityHtml({matches:published,quality});
const stale=html(c._teamQualitySummary);
assert.match(stale,/미실시 1경기를 제외한 5경기/);
assert.match(stale,/다시 계산/);
assert(!stale.includes('합산 품질점수'));
assert.match(html(updatedSummary),/합산 품질점수/);
delete published[0].voided;
assert(!html(updatedSummary).includes('합산 품질점수'));
const oldSummary={...c._teamQualitySummary,conditional:{...c._teamQualitySummary.conditional,version:4}};
assert(!html(oldSummary).includes('후보 비교 100점'));
assert.match(html(oldSummary),/이전 접전 기준/);
console.log('PASS team closeness boundaries, void-aware participation/grades, local restore and live summary freshness');
