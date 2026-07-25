'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.join(__dirname,'..');
const daily=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const checkin=fs.readFileSync(path.join(root,'checkin.html'),'utf8');
const engine=fs.readFileSync(path.join(root,'functions','daily-official-engine.js'),'utf8');

const start=daily.indexOf('const DAILY_FAIR_PRIORITY_GAP');
const end=daily.indexOf('function _dailyIsDeferred',start);
assert(start>=0&&end>start,'민턴LIVE 공정성 계산 함수 범위를 찾을 수 있어야 합니다.');

const sandbox={
  _dailyPlayers:[
    ...Array.from({length:6},(_,index)=>({id:`p${index+1}`,status:'wait',games:0,fairExpected:0,currentMatchId:''})),
    {id:'rest',status:'rest',games:0,fairExpected:0,currentMatchId:''},
    {id:'playing',status:'playing',games:0,fairExpected:1,currentMatchId:'active'}
  ],
  _dailyNormalizeStatus:status=>status,
  _dailyNow:()=>1234
};
sandbox._dailyPlayer=id=>sandbox._dailyPlayers.find(player=>player.id===id);
sandbox._dailyEligible=()=>sandbox._dailyPlayers.filter(player=>player.status==='wait'&&!player.currentMatchId);
vm.createContext(sandbox);
vm.runInContext(`${daily.slice(start,end)};this.api={apply:_dailyApplyFairOpportunity,rollback:_dailyRollbackFairOpportunity,summary:_dailyFairSummary};`,sandbox);

const first={team1:['p1','p2'],team2:['p3','p4']};
sandbox.api.apply(first);
assert(sandbox._dailyPlayers.slice(0,6).every(player=>Math.abs(player.fairExpected-4/6)<1e-9),'한 경기 네 자리는 당시 참가 가능한 선수에게 균등하게 기록해야 합니다.');
assert.strictEqual(sandbox._dailyPlayers.find(player=>player.id==='rest').fairExpected,0,'휴식 선수에게는 공정 기회가 누적되면 안 됩니다.');
assert.strictEqual(sandbox._dailyPlayers.find(player=>player.id==='playing').fairExpected,1,'이미 경기 중인 선수에게 중복 기회가 누적되면 안 됩니다.');
assert.strictEqual(sandbox.api.summary().count,0,'한 경기 미만의 자연스러운 순환 차이는 정상으로 표시해야 합니다.');

const second={team1:['p1','p2'],team2:['p3','p4']};
sandbox.api.apply(second);
assert.strictEqual(sandbox.api.summary().count,6,'참여 기회가 한 경기 가까이 뒤처진 선수는 간단한 보정 대상으로 집계해야 합니다.');
sandbox.api.rollback(second);
assert.strictEqual(sandbox.api.summary().count,0,'취소 경기의 공정 기회는 즉시 원복되어야 합니다.');
const once=sandbox._dailyPlayers[0].fairExpected;
sandbox.api.rollback(second);
assert.strictEqual(sandbox._dailyPlayers[0].fairExpected,once,'취소 원복은 중복 실행되어도 한 번만 반영되어야 합니다.');

assert((daily.match(/_dailyApplyFairOpportunity\(/g)||[]).length>=3,'수동 경기와 자동 대진 시작 모두 공정 기회를 기록해야 합니다.');
assert(daily.includes('_dailyRollbackFairOpportunity(m);'),'진행 경기 취소와 이번만 뒤로에서 공정 기회를 원복해야 합니다.');
assert(daily.includes('fairExpected:_dailyFairExpected(p)'),'회원 세션에 공정 기준값을 함께 게시해야 합니다.');
assert(checkin.includes("priority?'우선 반영 중':'공정 배정'"),'회원 화면은 공정 상태를 두 가지 짧은 표현으로 보여야 합니다.');
assert(checkin.includes("priority?`공정 보정 ${priority}명`:'공정 배정 정상'"),'임원 화면은 보정 인원만 짧게 집계해야 합니다.');
assert(engine.includes('applyFairOpportunity(session, match);'),'앱이 꺼져 있어도 Firebase 경기 투입이 공정 기회를 기록해야 합니다.');
assert(engine.includes('rollbackFairOpportunity(session, match, now);'),'Firebase 이번만 뒤로도 공정 기회를 원복해야 합니다.');

console.log('daily fairness regression ok');
