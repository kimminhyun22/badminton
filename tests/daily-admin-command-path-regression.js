'use strict';
/**
 * 관리자 쓰기를 임원과 같은 명령 경로로 옮기는 2단계.
 *
 * 관리자는 세션을 만든 주체라 명단에 '선수'로 들어 있지 않습니다. 그래서 서버가
 * 임원 본인 확인(isLiveOperator)만 보고 있으면 관리자가 보낸 명령은 전부 거절됩니다.
 * 초대 토큰으로 확인한 관리자 연결(adminClaim)이면 운영 명령을 받도록 열었습니다.
 *
 * 여기서 지키는 것:
 *   1) 관리자 연결로 보낸 운영 명령이 적용된다 (actorPlayerId 없이)
 *   2) 관리자 연결이 아니면 예전처럼 거절된다 — 임원 경로의 본인 확인은 그대로다
 *   3) 관리자 화면은 게시된 뒤 직접 쓰지 않고 명령을 보낸다
 */
const assert = require('assert');
const fs = require('path') && require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DADMIN1';
const SECRET = 'admin-command-regression-secret-at-least-32-bytes';

// 관리자 연결: 선수(pid)에 묶이지 않은 초대 토큰 자격입니다.
const adminGrant = issueOfficialGrant({
  v:1, sid:SESSION_ID, cid:'admin-client', iat:NOW-1000, exp:NOW+60*60*1000
}, SECRET);
// 임원 연결: 본인 선수 id 가 박혀 있습니다.
const officialGrant = issueOfficialGrant({
  v:1, sid:SESSION_ID, cid:'official-client', pid:'p9', iat:NOW-1000, exp:NOW+60*60*1000
}, SECRET);

function player(id, name, extra = {}){
  return {
    id, name, gender:'M', level:4, grade:'C', ageGroup:'40대',
    status:'wait', statusLabel:'wait', locked:false, currentMatchId:'', afterMatchStatus:'',
    games:0, fairExpected:0, mixedGames:0, typeTrackedGames:0, lastPlayedSeq:0,
    partnerCount:{}, opponentCount:{}, partnerCountById:{}, opponentCountById:{},
    joinedAt:NOW, waitFrom:NOW, lastStatusAt:NOW-1000, restPausedMs:0,
    preArrivalVisible:false, registrationCancelled:false,
    isClubOfficial:false, isTemporaryOfficial:false, isGuest:false,
    ...extra
  };
}

function makeSession(){
  return {
    serverSessionId:SESSION_ID,
    serverRevision:0,
    expiresAt:NOW+48*60*60*1000,
    capabilities:{officialOpsServerV2:true},
    commandProtocol:2,
    players:[
      player('p1','가선수'), player('p2','나선수'), player('p3','다선수'), player('p4','라선수'),
      player('p5','마선수'), player('p6','바선수'), player('p7','사선수'), player('p8','아선수'),
      player('p9','임원선수',{isClubOfficial:true})
    ],
    reservations:[],
    arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
    event:{
      courts:1, nextTarget:1, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:1, auto:true},
      active:[], next:[], expected:[], serverStandby:[]
    }
  };
}

function send(request, options){
  return applyOfficialRequest(makeSession(), {
    commandProtocol:2,
    createdAt:NOW+1000,
    expiresAt:NOW+30*60*1000,
    ...request
  }, {now:NOW+1000, grantSecret:SECRET, checkinId:SESSION_ID, ...options});
}

// 1) 관리자 연결로 보낸 운영 명령이 적용됩니다.
//    actorPlayerId 가 비어 있어도(관리자는 선수가 아님) 통과해야 합니다.
const adminCases = [
  ['선수 상태 변경', {
    type:'official-player-status', operationId:'admin_status',
    playerId:'p1', status:'rest', expectedStatus:'wait',
    expectedCurrentMatchId:'', expectedLastStatusAt:NOW-1000
  }],
  ['파트너 접수', {
    type:'official-partner-reservation', operationId:'admin_partner',
    playerIds:['p1','p2'], playerNames:['가선수','나선수']
  }]
];

adminCases.forEach(([label, request])=>{
  const result = send({...request, actorPlayerId:'', actorPlayerName:'관리자', officialGrantToken:adminGrant},
    {adminClaim:true});
  assert.strictEqual(result.status, 'applied',
    `관리자 ${label} 명령이 적용되어야 합니다. 실제: ${result.status} / ${result.reason || ''}`);
  console.log(`  관리자 ${label}: applied (revision ${result.revision})`);
});

// 2) 관리자 연결이 아니면 예전 그대로 거절됩니다.
//    임원 경로의 '본인 확인'을 느슨하게 만든 게 아니라는 뜻입니다.
adminCases.forEach(([label, request])=>{
  const result = send({...request, actorPlayerId:'', actorPlayerName:'관리자', officialGrantToken:adminGrant},
    {adminClaim:false});
  assert.strictEqual(result.status, 'rejected',
    `관리자 자격 없이 보낸 ${label} 명령은 거절되어야 합니다. 실제: ${result.status}`);
  console.log(`  관리자 자격 없음 ${label}: rejected (${result.reason})`);
});

// 명단에 없는 선수를 사칭해도 통하면 안 됩니다.
{
  const result = send({
    type:'official-player-status', operationId:'admin_spoof',
    playerId:'p1', status:'rest', expectedStatus:'wait',
    expectedCurrentMatchId:'', expectedLastStatusAt:NOW-1000,
    actorPlayerId:'p1', actorPlayerName:'가선수', officialGrantToken:officialGrant
  }, {adminClaim:false});
  assert.strictEqual(result.status, 'rejected', '임원이 아닌 선수의 운영 명령은 거절되어야 합니다.');
  console.log(`  일반 선수 사칭: rejected (${result.reason})`);
}

// 3) 관리자 화면이 실제로 명령을 보내도록 바뀌었는지 봅니다.
assert(daily.includes('async function _dailySendAdminCommand'),
  '관리자 명령을 보내는 공통 경로가 있어야 합니다.');
assert(/if\(!_dailyCheckinId\)return \{live:false,ok:false\};/.test(daily),
  '게시 전에는 명령을 보내지 않고 호출부가 직접 쓰도록 알려야 합니다.');
// 실패해도 로컬을 고치지 않는다는 약속(2026-08-03 확정)을 코드로 고정합니다.
const senderStart = daily.indexOf('async function _dailySendAdminCommand');
const senderEnd = daily.indexOf('\nasync function dailyOperatorStartQueueItem', senderStart);
assert(senderStart >= 0 && senderEnd > senderStart, '명령 전송 함수 범위를 찾을 수 있어야 합니다.');
const sender = daily.slice(senderStart, senderEnd);
assert(!/_dailyPlayers|_dailyQueue|_dailyMatches|_dailyReservations\s*[=.]/.test(sender),
  '명령 전송 경로가 실패 시 관리자 원본을 직접 고치면 안 됩니다.');
assert(sender.includes('_dailyPullServerReconcile'),
  '명령 결과는 서버에서 다시 받아 그려야 합니다.');

const converted = [
  ["선수 상태 변경", "type:'official-player-status'"],
  ["파트너 지정", "type:'official-partner-reservation'"],
  ["파트너 해제", "type:'official-partner-cancel'"],
  ["다음 대진 투입", "type:'official-queue-enter-free'"],
  ["대진 순서 변경", "type:'official-queue-yield'"],
  ["경기 종료", "type:'official-court-complete'"],
  ["참가 등록", "type:'official-player-arrival'"],
  ["명부 선수 추가", "type:'official-player-add'"]
];
converted.forEach(([label, marker])=>{
  assert(daily.includes(marker), `관리자 ${label}이 서버 명령을 보내야 합니다 (${marker}).`);
});
console.log(`  관리자 화면에서 서버 명령으로 보내는 동작 ${converted.length}종 확인`);


// 4) 서버가 받는 관리자 명령을 관리자 원본이 다시 거절하면 안 됩니다.
//    서버 validateCommon 만 넓히고 클라이언트 _dailyOfficialRequestError 를 두면
//    명령은 적용됐는데 화면이 "운영 권한이 있는 회원만..." 으로 멈춥니다(2026-08-04 실측).
{
  const start = daily.indexOf('function _dailyOfficialRequestError');
  const end = daily.indexOf('\nfunction ', start + 10);
  const src = daily.slice(start, end);

  assert(/const serverAdmin\s*=\s*!!req\.serverAppliedAt\s*&&\s*!req\.actorPlayerId/.test(src),
    '관리자 명령(actorPlayerId 없음)은 명령 종류를 가리지 않고 관리자 자격으로 받아야 합니다.');
  assert(!/adminClaimCommand/.test(src),
    '관리자 자격을 3종으로 좁히던 낡은 규칙이 남아 있으면 안 됩니다.');

  // 서버가 아는 관리자 명령은 클라이언트도 알아야 합니다.
  const engine = fs.readFileSync(path.join(root, 'functions', 'daily-official-engine.js'), 'utf8');
  const adminOnlyStart = engine.indexOf('const adminOnlyCommand = [');
  const adminOnly = engine.slice(adminOnlyStart, engine.indexOf('].includes(request.type)', adminOnlyStart))
    .match(/'official-[a-z-]+'/g).map(s=>s.replace(/'/g, ''));
  adminOnly.forEach(type=>{
    assert(src.includes(`'${type}'`),
      `${type} 을 관리자 원본이 모릅니다. _dailyOfficialRequestError 에 추가해야 서버 결과를 받습니다.`);
  });
  console.log(`  관리자 원본이 아는 관리자 전용 명령 ${adminOnly.length}종 확인`);
}


// 5) 로컬에만 있는 경기를 서버가 모른 채 명령을 받으면 안 됩니다.
//    자동 배정(dailyMaybeAutoAssign)은 명령을 거치지 않고 로컬에서 경기를 시작합니다.
//    그 경기는 전체 게시로만 서버에 올라가는데, 게시 전에 종료 명령을 보내면
//    서버가 "종료할 진행중 경기를 찾지 못했습니다"로 거절합니다(2026-08-04 실측).
{
  const senderStart2 = daily.indexOf('async function _dailySendAdminCommand');
  const senderEnd2 = daily.indexOf('\nasync function dailyOperatorStartQueueItem', senderStart2);
  const sender2 = daily.slice(senderStart2, senderEnd2);
  assert(/await dailyPushCheckinSession\(\);/.test(sender2),
    '명령을 보내기 전에 관리자 원본을 먼저 게시해야 합니다.');
  // 플래그로 가르면 안 됩니다 — 무관한 게시가 끝나도 꺼져서 경합을 못 막습니다.
  assert(!/if\(_dailyCheckinNeedsPublish\s*&&\s*!await dailyPushCheckinSession/.test(sender2),
    '게시를 _dailyCheckinNeedsPublish 로 건너뛰면 방금 시작한 경기의 명령이 거절됩니다.');
  // 게시 순서가 명령 전송보다 앞서야 의미가 있습니다.
  assert(sender2.indexOf('dailyPushCheckinSession') < sender2.indexOf('submitDailyOfficialRequest'),
    '게시는 명령 전송보다 먼저여야 합니다.');
  console.log('  명령 전 게시 보장 확인');

  // 서버가 모르는 경기의 종료는 실제로 거절되는지(전제 확인)
  const s = makeSession();
  s.event.active = [];
  const r = send({
    type:'official-court-complete', operationId:'sim_complete',
    matchId:'dm_only_local', court:1, expectedStartedAt:NOW-1000,
    expectedPlayerIds:['p1','p2','p3','p4'],
    actorPlayerId:'', actorPlayerName:'관리자', officialGrantToken:adminGrant
  }, {adminClaim:true});
  assert.strictEqual(r.reason, '종료할 진행중 경기를 찾지 못했습니다.',
    '서버가 모르는 경기의 종료는 거절되어야 합니다(이 전제가 깨지면 위 보장이 불필요해집니다).');
  console.log(`  서버가 모르는 경기 종료: rejected (${r.reason})`);
}

console.log('\ndaily admin command path regression ok');
