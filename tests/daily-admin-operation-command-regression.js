'use strict';
/**
 * 4단계 — 관리자만 쓰던 운영 동작에 서버 명령을 신설했습니다.
 *
 * 선수 제외·이름 변경·선수 추가·대기 경기 삭제·대기 경기 재생성·게임신청 반영·
 * 마무리 전환, 그리고 기존 명령을 넓힌 둘(교체 선수 지정, 대진 순서 임의 이동).
 *
 * 여기서 지키는 것:
 *   1) 관리자 연결이면 각 명령이 세션에 반영된다
 *   2) 임원 연결로는 못 쓴다 (관리자 전용 동작이고, 확장 옵션도 관리자 전용)
 *   3) 전제가 깨진 요청은 거절한다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant, refreshEvent} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DADMOP1';
const SECRET = 'admin-operation-regression-secret-at-least-32-bytes';

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

function makeSession(overrides){
  const session = {
    serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+48*60*60*1000,
    capabilities:{officialOpsServerV2:true},
    players:[
      player('p1','가선수'), player('p2','나선수'), player('p3','다선수'), player('p4','라선수'),
      player('p5','마선수'), player('p6','바선수'), player('p7','사선수'), player('p8','아선수'),
      player('p9','임원선수',{isClubOfficial:true})
    ],
    reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
    event:{
      courts:2, nextTarget:2, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:2, auto:true},
      active:[], next:[], expected:[], serverStandby:[]
    }
  };
  return Object.assign(session, overrides || {});
}

// 편성기가 채운 실제 대기표로 시작합니다(손으로 만든 큐는 서버 규칙과 어긋납니다).
function seededSession(overrides){
  const session = makeSession(overrides);
  const {replenishPrepared} = require('../functions/daily-server-matchmaker');
  replenishPrepared(session, {now:NOW, requestId:'seed'});
  refreshEvent(session, NOW);
  return session;
}

function send(session, request, {admin = true} = {}){
  return applyOfficialRequest(session, {
    operationId:'op_'+Math.random().toString(36).slice(2,9),
    commandProtocol:2,
    actorPlayerId:admin ? '' : 'p9',
    actorPlayerName:admin ? '관리자' : '임원선수',
    officialGrantToken:admin ? adminGrant : officialGrant,
    createdAt:NOW+1000,
    expiresAt:NOW+30*60*1000,
    ...request
  }, {now:NOW+1000, grantSecret:SECRET, checkinId:SESSION_ID, adminClaim:admin});
}

// 1) 선수 제외
{
  const r = send(makeSession(), {type:'official-player-remove', playerId:'p1', expectedName:'가선수'});
  assert.strictEqual(r.status, 'applied', `선수 제외가 적용되어야 합니다: ${r.reason || ''}`);
  assert(!r.session.players.some(p=>p.id === 'p1'), '명단에서 빠져야 합니다.');
  console.log('  선수 제외: applied');

  const busy = makeSession();
  busy.players[0].currentMatchId = 'm1';
  const blocked = send(busy, {type:'official-player-remove', playerId:'p1'});
  assert.strictEqual(blocked.status, 'rejected', '경기중 선수 제외는 거절되어야 합니다.');
  console.log(`  경기중 선수 제외: rejected (${blocked.reason})`);
}

// 2) 이름 변경 — 이름을 키로 쓰는 기록도 함께 옮겨야 합니다.
{
  const session = makeSession();
  session.players[1].partnerCount = {'가선수':3};
  const r = send(session, {type:'official-player-rename', playerId:'p1', name:'가선수2', expectedName:'가선수'});
  assert.strictEqual(r.status, 'applied', `이름 변경이 적용되어야 합니다: ${r.reason || ''}`);
  assert.strictEqual(r.session.players.find(p=>p.id === 'p1').name, '가선수2');
  assert.deepStrictEqual(r.session.players.find(p=>p.id === 'p2').partnerCount, {'가선수2':3},
    '이름을 키로 쓰는 파트너 기록도 함께 옮겨야 합니다.');
  console.log('  이름 변경: applied (파트너 기록 이전 확인)');

  const dup = send(makeSession(), {type:'official-player-rename', playerId:'p1', name:'나선수'});
  assert.strictEqual(dup.status, 'rejected', '중복 이름은 거절되어야 합니다.');
  console.log(`  중복 이름: rejected (${dup.reason})`);
}

// 3) 선수 추가(직접·게스트)
{
  const r = send(makeSession(), {
    type:'official-player-create', playerId:'dpv2_new1', name:'새선수',
    grade:'B', gender:'F', level:5, ageGroup:'30대', isGuest:true
  });
  assert.strictEqual(r.status, 'applied', `선수 추가가 적용되어야 합니다: ${r.reason || ''}`);
  const added = r.session.players.find(p=>p.id === 'dpv2_new1');
  assert(added, '새 선수가 명단에 들어가야 합니다.');
  assert.strictEqual(added.isGuest, true, '게스트 표시가 보존되어야 합니다.');
  assert.strictEqual(added.gender, 'F', '성별이 보존되어야 합니다.');
  console.log('  선수 추가: applied');

  const dup = send(makeSession(), {type:'official-player-create', playerId:'dpv2_x', name:'가선수'});
  assert.strictEqual(dup.status, 'rejected', '이미 있는 이름은 거절되어야 합니다.');
  console.log(`  중복 선수 추가: rejected (${dup.reason})`);
}

// 4) 대기 경기 삭제
{
  const session = seededSession();
  assert(session.event.next.length >= 1, '삭제할 대기표가 있어야 합니다.');
  const target = session.event.next[0];
  const r = send(session, {
    type:'official-queue-delete',
    queueId:target.queueId || target.id,
    expectedPlayerIds:[...(target.playerIds || [])]
  });
  assert.strictEqual(r.status, 'applied', `대기 경기 삭제가 적용되어야 합니다: ${r.reason || ''}`);
  console.log('  대기 경기 삭제: applied');

  const stale = seededSession();
  const staleTarget = stale.event.next[0];
  const mismatch = send(stale, {
    type:'official-queue-delete',
    queueId:staleTarget.queueId || staleTarget.id,
    expectedPlayerIds:['p1','p2','p3','p4']
  });
  if(mismatch.status !== 'applied'){
    console.log(`  선수 바뀐 대기 경기 삭제: rejected (${mismatch.reason})`);
  }
}

// 5) 대기 경기 재생성
{
  const session = seededSession();
  const target = session.event.next[0];
  const r = send(session, {
    type:'official-queue-regenerate',
    queueId:target.queueId || target.id,
    expectedPlayerIds:[...(target.playerIds || [])]
  });
  assert.strictEqual(r.status, 'applied', `대기 경기 재생성이 적용되어야 합니다: ${r.reason || ''}`);
  assert(r.session.event.next.length >= 1, '재생성 후에도 대기표가 있어야 합니다.');
  console.log('  대기 경기 재생성: applied');
}

// 6) 게임신청 반영
{
  const session = seededSession({});
  session.reservations = [{id:'res1', mode:'pair', team1:['p1','p2'], team2:[], label:'가선수 · 나선수'}];
  const r = send(session, {type:'official-reservation-promote', reservationId:'res1'});
  assert.strictEqual(r.status, 'applied', `게임신청 반영이 적용되어야 합니다: ${r.reason || ''}`);
  const placed = (r.session.event.next || []).find(item=>String(item.reservationId) === 'res1');
  assert(placed, '신청이 대기표에 올라야 합니다.');
  const first = (placed.t1Ids || []).map(String);
  const second = (placed.t2Ids || []).map(String);
  assert((first.includes('p1') && first.includes('p2')) || (second.includes('p1') && second.includes('p2')),
    '신청한 둘이 같은 편이어야 합니다.');
  console.log('  게임신청 반영: applied');

  const missing = send(seededSession(), {type:'official-reservation-promote', reservationId:'nope'});
  assert.strictEqual(missing.status, 'rejected', '없는 신청은 거절되어야 합니다.');
  console.log(`  없는 신청 반영: rejected (${missing.reason})`);
}

// 7) 마무리 전환
{
  const r = send(makeSession(), {type:'official-finish-mode', finishMode:true});
  assert.strictEqual(r.status, 'applied', `마무리 전환이 적용되어야 합니다: ${r.reason || ''}`);
  assert.strictEqual(r.session.event.finishMode, true, '마무리 상태가 켜져야 합니다.');
  console.log('  마무리 전환: applied');

  const already = makeSession();
  already.event.finishMode = true;
  const dup = send(already, {type:'official-finish-mode', finishMode:true});
  assert.strictEqual(dup.status, 'rejected', '이미 마무리 중이면 거절되어야 합니다.');
  console.log(`  중복 마무리 전환: rejected (${dup.reason})`);
}

// 8) 관리자 전용 — 임원 연결로는 전부 막혀야 합니다.
const adminOnly = [
  {type:'official-player-remove', playerId:'p1'},
  {type:'official-player-rename', playerId:'p1', name:'딴이름'},
  {type:'official-player-create', playerId:'dpv2_z', name:'딴선수'},
  {type:'official-queue-delete', queueId:'q1'},
  {type:'official-queue-regenerate', queueId:'q1'},
  {type:'official-reservation-promote', reservationId:'res1'},
  {type:'official-finish-mode', finishMode:true},
  {type:'official-settings-update', courts:5}
];
adminOnly.forEach(request=>{
  const r = send(makeSession(), request, {admin:false});
  assert.strictEqual(r.status, 'rejected', `${request.type} 은 임원 연결로 막혀야 합니다.`);
  assert(r.reason.includes('관리자'), `${request.type} 거절 이유가 관리자 전용임을 밝혀야 합니다: ${r.reason}`);
});
console.log(`  관리자 전용 ${adminOnly.length}종: 임원 연결 전부 rejected`);

// 9) 확장 옵션도 임원에게 열렸습니다(운영자 2026-08-10 "다음 대진 순서 변경도
//    할 수 있게" — 임원의 게임 설정 자유는 최대 보장, 시스템은 사후 균형).
{
  const session = seededSession();
  const target = session.event.next[0];
  const secondId = String((session.event.next[1]||{}).queueId||(session.event.next[1]||{}).id||'');
  const free = send(session, {
    type:'official-queue-yield', queueId:target.queueId || target.id,
    expectedQueueIndex:1, targetQueueIndex:2, allowFreeMove:true,
    expectedPlayerIds:[...(target.playerIds || [])],
    expectedTeam1Ids:[...(target.t1Ids || [])],
    expectedTeam2Ids:[...(target.t2Ids || [])]
  }, {admin:false});
  assert.strictEqual(free.status, 'applied', `임원 임의 순서 이동이 적용되어야 합니다: ${free.reason||''}`);
  if(secondId){
    assert.strictEqual(String(free.session.event.next[0].queueId||free.session.event.next[0].id), secondId,
      '이동 후 2순위였던 대진이 1순위가 되어야 합니다.');
  }
  console.log('  임원 임의 순서 이동: applied (2026-08-10 개방)');

  // 대기 경기의 '이 선수로' 지정은 임원에게도 열렸습니다(운영자 2026-08-10
  // "다음 대진도 동일하게") — 진행 경기 지정 교체와 같은 신뢰입니다.
  const pickSession = seededSession();
  const pickTarget = pickSession.event.next[0];
  assert(pickTarget, '편성기가 다음 대진을 만들어야 합니다.');
  const pickQueued = new Set();
  ['next','expected','serverStandby'].forEach(key=>(pickSession.event[key]||[]).forEach(item=>(item.playerIds||[]).forEach(id=>pickQueued.add(String(id)))));
  const spare = pickSession.players.find(p=>!pickQueued.has(String(p.id)));
  assert(spare, '대기 여유 선수가 있어야 합니다.');
  const pickOutId = String((pickTarget.playerIds||[])[0]);
  const pick = send(pickSession, {
    type:'official-queue-replace', queueId:String(pickTarget.queueId||pickTarget.id),
    outPlayerId:pickOutId, inPlayerId:String(spare.id),
    expectedPlayerIds:[...(pickTarget.playerIds||[])]
  }, {admin:false});
  assert.strictEqual(pick.status, 'applied', `임원 지정 교체가 적용되어야 합니다: ${pick.reason||''}`);
  const after = pick.session.event.next.find(i=>String(i.queueId||i.id)===String(pickTarget.queueId||pickTarget.id));
  assert(after.playerIds.map(String).includes(String(spare.id))&&!after.playerIds.map(String).includes(pickOutId),
    '지정한 선수로 바뀌어야 합니다.');
  console.log('  임원 교체 선수 지정: applied (운영자 2026-08-10 결정)');
}

// 10) 관리자 화면이 이 명령들을 실제로 보내는지 봅니다.
const wired = [
  ['선수 제외', "type:'official-player-remove'"],
  ['이름 변경', "type:'official-player-rename'"],
  ['선수 추가', "type:'official-player-create'"],
  ['대기 경기 삭제', "type:'official-queue-delete'"],
  ['대기 경기 재생성', "type:'official-queue-regenerate'"],
  ['게임신청 반영', "type:'official-reservation-promote'"],
  ['마무리 전환', "type:'official-finish-mode'"],
  ['교체 선수 지정', 'inPlayerId:newId'],
  ['순서 임의 이동', 'allowFreeMove:true']
];
wired.forEach(([label, marker])=>{
  assert(daily.includes(marker), `관리자 ${label}이 서버 명령을 보내야 합니다 (${marker}).`);
});
assert(daily.includes('function _dailyApplyAdminOperation'), '새 명령의 재생 경로가 있어야 합니다.');
console.log(`  관리자 화면 연결 ${wired.length}종 확인`);

console.log('\ndaily admin operation command regression ok');
