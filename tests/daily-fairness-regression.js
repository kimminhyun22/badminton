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
// 2026-08-15 운영자: "대시보드에 경고 창이 뜨는 방식이 제일 좋을 것 같아 …
// 주시하고 있다가 대진을 짜서 넣으면 되거든" — 심각 부족은 해소될 때까지 떠 있는
// 경고 창으로, 이름을 누르면 그 선수를 담은 채 「다음 대진 짜기」가 열린다.
assert(checkin.includes('official-fair-alert') && checkin.includes('fairnessSeriousRows()'),
  '심각 부족은 지나가는 토스트가 아니라 떠 있는 경고 창이어야 합니다.');
assert(checkin.includes("openOfficialQueueCompose('${esc(p.id)}','${esc(r.id)}')"),
  '경고 창의 이름은 그 선수를 담은 채 다음 대진 짜기로 이어져야 합니다.');
assert(checkin.includes('picked:preset?[preset.id]:[]'),
  '대진 짜기는 경고에서 넘어온 선수를 미리 선택해야 합니다.');
// 2026-08-15 실전: "대기 대진에 있는데 게임부족으로 떠 … 알람의 의미가 없어" —
// 대기 배정도 게임으로 세서, 경보는 「시스템도 아직 안 챙긴 부족」만 잡는다.
assert(checkin.includes('(!active&&queued?1:0)'),
  '대기 대진에 배정된 게임도 세야 곧 해소될 부족이 경보로 오르지 않습니다.');
assert(/const queued=\(session\?\.event\?\.next\|\|\[\]\)\.some/.test(checkin),
  '대기 배정 판정은 다음 대기표(event.next)를 봐야 합니다.');
assert(engine.includes('applyFairOpportunity(session, match);'),'앱이 꺼져 있어도 Firebase 경기 투입이 공정 기회를 기록해야 합니다.');
assert(engine.includes('rollbackFairOpportunity(session, match, now);'),'Firebase 이번만 뒤로도 공정 기회를 원복해야 합니다.');

console.log('daily fairness regression ok');

// 2026-08-15 시뮬: 마무리 전환 순간 대기 크레딧이 사라지며 6명 경보가 떴다 —
// 더 넣을 대진이 없는 마무리 모드의 부족 경보는 행동 불가능한 헛경보다.
assert((checkin.match(/finishMode\)return/g)||[]).length>=2,
  '마무리 모드에서는 경고 창과 토스트 모두 침묵해야 합니다.');

// 2026-08-15 운영자: "임원이 넣을 바에야, 그냥 시스템이 대진 짜면 되잖아" /
// "상대 3회 반복도 그냥 혼복 만들어서 투입해". 서버·관리자 동일 규칙:
// ① 대기 강제는 **상대 기준**(동료 중앙값+15분, 최소 30분) + 공정 격차 동반(≥0.75)
//    일 때만 — 절대값 기준은 대인원(36명/3코트=순환 45분)에서 오발동한다(실측).
// ② 4번째 맞대결(3회 반복 뒤)은 2,400 — 혼복 문턱(3,200)에 근접시켜 혼복으로 푼다.
//    (3번째 맞대결 인상은 replenish 공정성 가드를 깨서 반려 — 실측 2026-08-15)
const matchmaker=fs.readFileSync(path.join(root,'functions','daily-server-matchmaker.js'),'utf8');
assert(matchmaker.includes('WAIT_FORCE_MINUTES = 30')&&matchmaker.includes('WAIT_FORCE_OVER_MEDIAN = 15'),
  '서버 대기 강제 상수(30분·중앙값+15분)가 있어야 합니다.');
assert(matchmaker.includes('Math.max(WAIT_FORCE_MINUTES, median + WAIT_FORCE_OVER_MEDIAN)'),
  '대기 강제 문턱은 동료 중앙값 기준으로 계산해야 합니다.');
assert(matchmaker.includes('fairGap(player) >= FAIR_PRIORITY_GAP) || null'),
  '대기 강제는 공정 격차가 벌어지기 시작한(≥0.75) 사람만 잡아야 합니다.');
assert(matchmaker.includes('value === 3 ? 600'),
  '서버: 4번째 맞대결은 2,400(600×4)이어야 합니다.');
assert(daily.includes('if(c===3)return 2400;'),
  '관리자 로컬 경로도 서버와 같은 4번째 맞대결 벌점을 써야 합니다.');
assert(daily.includes('Math.max(DAILY_WAIT_FORCE_MINUTES,median+DAILY_WAIT_FORCE_OVER_MEDIAN)'),
  '관리자 로컬 경로도 상대 기준 대기 강제를 써야 합니다.');
