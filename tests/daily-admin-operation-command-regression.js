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

// 7b) 코트 번호 정정(운영자 2026-08-13 "코트 번호 정정 추가해").
//     화면 번호와 실제 코트가 어긋났을 때 임원이 고칩니다.
{
  const withCourts=()=>{
    const s=makeSession();
    s.event.active=[
      {id:'m1',court:1,seq:1,type:'남복',startedAt:NOW-5*60_000,expectedMinutes:15,endAt:NOW+10*60_000,
       playerIds:['p1','p2','p3','p4'],t1Ids:['p1','p2'],t2Ids:['p3','p4'],t1:['가선수','나선수'],t2:['다선수','라선수']},
      {id:'m2',court:2,seq:2,type:'남복',startedAt:NOW-5*60_000,expectedMinutes:15,endAt:NOW+10*60_000,
       playerIds:['p5','p6','p7','p8'],t1Ids:['p5','p6'],t2Ids:['p7','p8'],t1:['마선수','바선수'],t2:['사선수','아선수']}
    ];
    s.players.forEach(p=>{if(['p1','p2','p3','p4','p5','p6','p7','p8'].includes(p.id)){p.status='playing';p.currentMatchId=['p1','p2','p3','p4'].includes(p.id)?'m1':'m2';}});
    return s;
  };
  const moved=send(withCourts(),{type:'official-court-renumber',matchId:'m1',court:5,expectedCourt:1},{admin:false});
  assert.strictEqual(moved.status,'applied',`코트 번호 정정이 적용되어야 합니다: ${moved.reason||''}`);
  assert.strictEqual(moved.session.event.active.find(m=>m.id==='m1').court,5,'새 번호로 바뀌어야 합니다.');
  // 이미 쓰는 번호로 옮기면 서로 맞바꿉니다(관리자 화면과 같은 규칙).
  const swap=send(withCourts(),{type:'official-court-renumber',matchId:'m1',court:2,expectedCourt:1,allowSwap:true},{admin:false});
  assert.strictEqual(swap.status,'applied',`맞바꾸기가 적용되어야 합니다: ${swap.reason||''}`);
  assert.strictEqual(swap.session.event.active.find(m=>m.id==='m1').court,2,'대상 경기가 2코트로 가야 합니다.');
  assert.strictEqual(swap.session.event.active.find(m=>m.id==='m2').court,1,'있던 경기는 1코트로 와야 합니다.');
  // 맞바꿈을 허용하지 않으면 거절 — 두 경기가 같은 번호에 서면 안 됩니다.
  const blocked=send(withCourts(),{type:'official-court-renumber',matchId:'m1',court:2,expectedCourt:1},{admin:false});
  assert.strictEqual(blocked.status,'rejected','맞바꿈 동의 없이 점유된 번호로 옮기면 거절되어야 합니다.');
  // 경합: 그 사이 번호가 이미 바뀌었으면 거절.
  const stale=send(withCourts(),{type:'official-court-renumber',matchId:'m1',court:5,expectedCourt:3},{admin:false});
  assert.strictEqual(stale.status,'rejected','기대 번호가 다르면 거절되어야 합니다.');
  const bad=send(withCourts(),{type:'official-court-renumber',matchId:'m1',court:13,expectedCourt:1},{admin:false});
  assert.strictEqual(bad.status,'rejected','1~12 밖 번호는 거절되어야 합니다.');
  console.log('  코트 번호 정정: applied · 맞바꾸기 · 동의 없으면 거절 · 경합/범위 거절');
}

// 7c) 도착 되돌리기(운영자 2026-08-13). 잘못 참가 등록된 사람을 도착 전으로.
{
  const r=send(makeSession(),{type:'official-player-unarrive',playerId:'p1',expectedName:'가선수'},{admin:false});
  assert.strictEqual(r.status,'applied',`도착 되돌리기가 적용되어야 합니다: ${r.reason||''}`);
  const p=r.session.players.find(x=>x.id==='p1');
  assert.strictEqual(p.status,'planned','도착 전 상태여야 합니다.');
  assert.strictEqual(p.preArrivalVisible,true,'도착 전 명단에 보여야 합니다.');
  // 이미 뛴 사람은 「경기 후 종료」가 맞는 처리입니다.
  const played=makeSession();
  played.players.find(x=>x.id==='p1').games=2;
  const tooLate=send(played,{type:'official-player-unarrive',playerId:'p1'},{admin:false});
  assert.strictEqual(tooLate.status,'rejected','경기를 뛴 선수는 거절되어야 합니다.');
  // 경기중인 사람도 거절 — 경기를 먼저 정리해야 합니다.
  const busy=makeSession();
  const bp=busy.players.find(x=>x.id==='p1');
  bp.status='playing'; bp.currentMatchId='m1';
  const playing=send(busy,{type:'official-player-unarrive',playerId:'p1'},{admin:false});
  assert.strictEqual(playing.status,'rejected','경기중 선수는 거절되어야 합니다.');
  // 이미 도착 전이면 중복 처리하지 않습니다.
  const dup=send(r.session,{type:'official-player-unarrive',playerId:'p1'},{admin:false});
  assert.strictEqual(dup.status,'rejected','이미 도착 전이면 거절되어야 합니다.');
  console.log('  도착 되돌리기: applied · 뛴 선수/경기중/중복 거절');
}

// 8) 운영 명령은 임원에게 전부 열렸습니다(운영자 2026-08-10 "관리자와 동일한
//    기능 제공"). 관리자 전용으로 남는 것은 임원 자격 부여뿐입니다 —
//    보안 경계라 자유권 대상이 아닙니다.
const formerlyAdminOnly = [
  {type:'official-player-remove', playerId:'p1'},
  {type:'official-player-rename', playerId:'p1', name:'딴이름'},
  {type:'official-player-create', playerId:'dpv2_z', name:'딴선수'},
  {type:'official-queue-delete', queueId:'q1', expectedPlayerIds:[]},
  {type:'official-queue-regenerate', queueId:'q1', expectedPlayerIds:[]},
  {type:'official-reservation-promote', reservationId:'res1'},
  {type:'official-settings-update', courts:5, expectedCourts:2},
  {type:'official-finish-mode', finishMode:true}
];
formerlyAdminOnly.forEach(request=>{
  const r = send(makeSession(), request, {admin:false});
  assert(!/관리자만/.test(r.reason||''),
    `${request.type} 이 임원 연결에서 권한으로 막히면 안 됩니다: ${r.reason||r.status}`);
});
console.log(`  옛 관리자 전용 ${formerlyAdminOnly.length}종: 임원 권한 게이트 없음 확인`);
{
  const r = send(makeSession(), {type:'official-finish-mode', finishMode:true}, {admin:false});
  assert.strictEqual(r.status, 'applied', `임원 마무리 전환이 적용되어야 합니다: ${r.reason||''}`);
  assert.strictEqual(r.session.event.finishMode, true, '마무리 상태가 켜져야 합니다.');
  const create = send(makeSession(), {type:'official-player-create', playerId:'dpv2_off', name:'임원추가'}, {admin:false});
  assert.strictEqual(create.status, 'applied', `임원 선수 추가가 적용되어야 합니다: ${create.reason||''}`);
  console.log('  임원 마무리 전환·선수 추가: applied (2026-08-10 개방)');
}

// 8b) 임원 자격 부여(official-player-official)만 관리자 전용으로 남습니다.
//     도착 전 등록 버그로 세션에 굳은 자격 풀림을 복구하는 명령입니다.
{
  const byOfficial = send(makeSession(), {type:'official-player-official', playerId:'p1', isClubOfficial:true}, {admin:false});
  assert.strictEqual(byOfficial.status, 'rejected', '임원이 임원 자격을 주면 안 됩니다 — 권한이 번집니다.');
  assert(byOfficial.reason.includes('관리자'), byOfficial.reason);
  const s = makeSession();
  const target = s.players.find(p=>p.id==='p1');
  target.isTemporaryOfficial = true;
  const grant = send(s, {type:'official-player-official', playerId:'p1', expectedName:target.name, isClubOfficial:true});
  assert.strictEqual(grant.status, 'applied', `관리자 자격 복구가 적용되어야 합니다: ${grant.reason||''}`);
  const after = grant.session.players.find(p=>p.id==='p1');
  assert.strictEqual(after.isClubOfficial, true, '임원 자격이 복구되어야 합니다.');
  assert.strictEqual(after.isTemporaryOfficial, false, '임원이 되면 도우미 표시는 정리되어야 합니다.');
  const wrongName = send(makeSession(), {type:'official-player-official', playerId:'p1', expectedName:'딴사람', isClubOfficial:true});
  assert.strictEqual(wrongName.status, 'rejected', '이름 지문이 어긋나면 거절되어야 합니다.');
  console.log('  임원 자격 복구: 관리자 applied · 임원 rejected · 지문 검증');
}

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
  // 2026-08-13: 임원 화면에서 보낸 두 명령을 관리자 원본이 받아 재생해야 합니다.
  ['코트 번호 정정 재생', "req.type==='official-court-renumber'"],
  ['도착 되돌리기 재생', "req.type==='official-player-unarrive'"],
  ['교체 선수 지정', 'inPlayerId:newId'],
  ['순서 임의 이동', 'allowFreeMove:true']
];
wired.forEach(([label, marker])=>{
  assert(daily.includes(marker), `관리자 ${label}이 서버 명령을 보내야 합니다 (${marker}).`);
});
assert(daily.includes('function _dailyApplyAdminOperation'), '새 명령의 재생 경로가 있어야 합니다.');
console.log(`  관리자 화면 연결 ${wired.length}종 확인`);

console.log('\ndaily admin operation command regression ok');
