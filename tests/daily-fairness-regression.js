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
// 2026-08-15 운영자: "게임 수가 부족한 인원에 대해 알림이 있어야 운영진이 챙길 거
// 아냐" — 숫자 집계에서 이름·부족량 명시로 바뀌었다. fairExpected 는 명단 합류
// 시점부터 쌓이므로 지각자는 자동으로 제외된다(같은 시간 체류 대비 부족만 잡힘).
assert(checkin.includes('게임 부족 ${priority.length}명'),
  '임원 화면은 게임 부족 인원의 이름을 보여줘야 합니다.');
assert(checkin.includes('r.name} −${Math.round(r.gap*10)/10'),
  '누가 몇 게임 뒤처졌는지 부족량까지 보여줘야 합니다.');
assert(checkin.includes('지각자는 도착 이후 기준'),
  '지각자와 동일 체류 부족을 구분한다는 설명이 있어야 합니다.');
// 2026-08-15 운영자: "실시간으로 보면서 너무 부족하다 싶을 때 알림이 와서 챙길 수
// 있게" — 임계(1.25)를 새로 넘는 순간 토스트+진동. 초반 20분은 소음 구간이라
// 침묵하고, 1.0 아래로 풀릴 때까지 재알림하지 않는다(히스테리시스).
assert(checkin.includes('FAIR_ALERT_GAP=1.25'), '실시간 경보 임계는 1.25 게임입니다.');
assert(checkin.includes('FAIR_ALERT_WARMUP_MS=20*60_000'),
  '세션 초반 20분은 경보를 울리지 않아야 합니다(시뮬 실측: 초반은 전원이 걸리는 소음).');
assert(checkin.includes('FAIR_ALERT_CLEAR=1.0') && checkin.includes('_fairAlerted.delete(key)'),
  '한 번 울린 경보는 풀릴 때까지 반복되지 않아야 합니다.');
assert(checkin.includes('navigator.vibrate'), '현장 소음 속에서도 닿도록 진동을 함께 울립니다.');
assert(checkin.includes('checkFairnessAlerts();'),
  '임원 화면 갱신 경로에서 경보 판정을 호출해야 실시간이 됩니다.');
assert(engine.includes('applyFairOpportunity(session, match);'),'앱이 꺼져 있어도 Firebase 경기 투입이 공정 기회를 기록해야 합니다.');
assert(engine.includes('rollbackFairOpportunity(session, match, now);'),'Firebase 이번만 뒤로도 공정 기회를 원복해야 합니다.');

console.log('daily fairness regression ok');
