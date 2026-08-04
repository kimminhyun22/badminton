'use strict';
/**
 * 운영 설정도 서버 명령(official-settings-update)으로 모읍니다.
 *
 * 운영자 판단 ③ — 준비 단계를 "잠그지" 않습니다. 현장 융통성은 그대로 두고,
 * 기록하는 주체만 서버로 옮깁니다. 그래서 잠금이 아니라 명령 신설입니다.
 *
 * 지금 이 명령이 받는 것은 코트 수뿐입니다. 운영 시간과 자동 진행은 일부러
 * 뺐습니다 — 관리자 게시 payload(_dailyPublicEvent)가 queuePolicy.auto 를 매번
 * 다시 계산해 덮어쓰고 운영 시간은 아예 싣지 않아서, 서버에 저장해도 다음 게시
 * 한 번에 사라집니다. 화면을 되살릴 때 payload 부터 같이 고치고 추가하십시오.
 *
 * 여기서 지키는 것:
 *   1) 관리자 연결이면 코트 수를 바꿀 수 있다
 *   2) 임원 연결로는 못 바꾼다 (운영 설정은 관리자 것)
 *   3) 진행 중인 코트를 잘라내는 축소는 거절한다
 *   4) 사라질 값을 저장한 척하지 않는다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DSET001';
const SECRET = 'settings-command-regression-secret-at-least-32-bytes';

const adminGrant = issueOfficialGrant({
  v:1, sid:SESSION_ID, cid:'admin-client', iat:NOW-1000, exp:NOW+60*60*1000
}, SECRET);
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

function makeSession(active){
  return {
    serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+48*60*60*1000,
    capabilities:{officialOpsServerV2:true},
    players:[
      player('p1','가선수'), player('p2','나선수'), player('p3','다선수'), player('p4','라선수'),
      player('p9','임원선수',{isClubOfficial:true})
    ],
    reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
    event:{
      courts:3, nextTarget:0, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:0, auto:true},
      active:active || [], next:[], expected:[], serverStandby:[]
    }
  };
}

function send(patch, {admin = true, active = null} = {}){
  return applyOfficialRequest(makeSession(active), {
    type:'official-settings-update',
    operationId:'set_'+Math.random().toString(36).slice(2,9),
    commandProtocol:2,
    actorPlayerId:admin ? '' : 'p9',
    actorPlayerName:admin ? '관리자' : '임원선수',
    officialGrantToken:admin ? adminGrant : officialGrant,
    createdAt:NOW+1000,
    expiresAt:NOW+30*60*1000,
    ...patch
  }, {now:NOW+1000, grantSecret:SECRET, checkinId:SESSION_ID, adminClaim:admin});
}

// 1) 관리자는 셋 다 바꿀 수 있습니다.
{
  const result = send({courts:5, expectedCourts:3});
  assert.strictEqual(result.status, 'applied', `설정 변경이 적용되어야 합니다: ${result.reason || ''}`);
  assert.strictEqual(result.session.event.courts, 5, '코트 수가 반영되어야 합니다.');
  assert.deepStrictEqual(Object.keys(result.result.settings).sort(), ['courts'],
    '관리자 원본이 따라 그릴 수 있도록 바뀐 값을 결과로 돌려줘야 합니다.');
  // 운영 시간·자동 진행은 일부러 받지 않습니다. 게시 payload 가 매번 덮어쓰기 때문입니다.
  const ignored = send({courts:4, expectedCourts:3, operatingStart:'19:30', autoAssign:false});
  assert.deepStrictEqual(Object.keys(ignored.result.settings).sort(), ['courts'],
    '게시 때 사라질 값을 저장한 척하면 안 됩니다.');
  console.log('  관리자 설정 변경: applied', JSON.stringify(result.result.settings));
}

// 2) 임원 연결로는 못 바꿉니다.
{
  const result = send({courts:5}, {admin:false});
  assert.strictEqual(result.status, 'rejected', '임원 연결의 설정 변경은 거절되어야 합니다.');
  assert(result.reason.includes('관리자'), `거절 이유가 명확해야 합니다: ${result.reason}`);
  console.log(`  임원 설정 변경: rejected (${result.reason})`);
}

// 3) 진행 중인 코트를 잘라내는 축소는 거절합니다.
{
  const active = [{
    id:'m1', court:3, seq:1, startedAt:NOW-5*60*1000, expectedMinutes:15,
    endAt:NOW+10*60*1000, playerIds:['p1','p2','p3','p4'], t1Ids:['p1','p2'], t2Ids:['p3','p4']
  }];
  const result = send({courts:2, expectedCourts:3}, {active});
  assert.strictEqual(result.status, 'rejected', '진행 중인 코트를 없애는 축소는 거절되어야 합니다.');
  assert(result.reason.includes('3코트'), `어느 코트가 걸렸는지 알려 줘야 합니다: ${result.reason}`);
  console.log(`  진행 중 코트 축소: rejected (${result.reason})`);

  // 진행 중이 아닌 코트까지만 줄이는 것은 됩니다.
  const ok = send({courts:3, expectedCourts:3}, {active});
  assert.strictEqual(ok.status, 'applied', '진행 중인 코트를 남기는 변경은 허용해야 합니다.');
}

// 4) 형식·정합성이 틀리면 거절합니다.
const badCases = [
  [{courts:0}, '코트 수 하한'],
  [{courts:13}, '코트 수 상한'],
  [{}, '바꿀 값 없음'],
  [{courts:5, expectedCourts:9}, '기대한 코트 수 불일치']
];
badCases.forEach(([patch, label])=>{
  const result = send(patch);
  assert.strictEqual(result.status, 'rejected', `${label}은 거절되어야 합니다. 실제: ${result.status}`);
  console.log(`  ${label}: rejected (${result.reason})`);
});

// 5) 관리자 화면이 이 명령을 쓰고, 서버가 확정한 값만 되받는지 봅니다.
assert(daily.includes("type:'official-settings-update'"), '관리자 화면이 설정 명령을 보내야 합니다.');
assert(daily.includes('function _dailyApplyOfficialSettings'), '서버가 확정한 설정을 되받는 경로가 있어야 합니다.');
const applyStart = daily.indexOf('function _dailyApplyOfficialSettings');
const applyEnd = daily.indexOf('function _dailyApplyTemporaryOfficial', applyStart);
const applySource = daily.slice(applyStart, applyEnd);
assert(applySource.includes('req.serverResult?.settings'),
  '보낸 값이 아니라 서버가 적용한 값을 받아야 합니다.');
console.log('  관리자 화면 연결 확인');

console.log('\ndaily settings command regression ok');
