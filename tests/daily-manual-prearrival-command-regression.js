'use strict';
/**
 * 5단계를 막고 있던 마지막 두 동작에 명령을 붙였습니다.
 *
 *   1) 수동 경기 등록 → official-manual-match
 *   2) 도착 전 등록   → official-player-create (status:'planned')
 *
 * 나머지 셋은 확인해 보니 애초에 차단 요소가 아니었습니다.
 *   - 일시정지·재개: 세션 전체가 아니라 event.paused 계열만 고치는 자체 트랜잭션
 *     (`_dailySyncPauseState`)이라 통째 쓰기 문제군에 속하지 않습니다
 *   - 팀전 명단 가져오기: `_dailyCheckinId` 가 있으면 아예 거부하는 게시 전 전용
 *   - 회원 신청 승인: `_dailyReservationRequestError` 가 항상 거절합니다
 *     (파트너 요청은 임원 화면 전담)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DMANUAL';
const SECRET = 'manual-prearrival-regression-secret-at-least-32-bytes';

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

function makeSession(){
  return {
    serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+48*60*60*1000,
    capabilities:{officialOpsServerV2:true},
    players:[
      player('p1','가선수'), player('p2','나선수'), player('p3','다선수'), player('p4','라선수'),
      player('p5','마선수'), player('p9','임원선수',{isClubOfficial:true})
    ],
    reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
    event:{
      courts:2, nextTarget:0, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:0, auto:true},
      active:[], next:[], expected:[], serverStandby:[]
    }
  };
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

const manual = {
  type:'official-manual-match', matchId:'sm_manual1', court:1,
  team1Ids:['p1','p2'], team2Ids:['p3','p4']
};

// 1) 수동 경기 등록 — 코트에 바로 올라가고 선수가 경기중이 됩니다.
{
  const r = send(makeSession(), manual);
  assert.strictEqual(r.status, 'applied', `수동 경기 등록이 적용되어야 합니다: ${r.reason || ''}`);
  const match = r.session.event.active.find(m=>m.id === 'sm_manual1');
  assert(match, '코트에 경기가 올라가야 합니다.');
  assert.strictEqual(match.court, 1, '지정한 코트여야 합니다.');
  assert.strictEqual(match.manualStarted, true, '수동 등록 표시가 남아야 합니다.');
  ['p1','p2','p3','p4'].forEach(id=>{
    const p = r.session.players.find(x=>x.id === id);
    assert.strictEqual(p.status, 'playing', `${p.name} 는 경기중이어야 합니다.`);
    assert.strictEqual(p.currentMatchId, 'sm_manual1', `${p.name} 의 진행 경기가 연결되어야 합니다.`);
    assert.strictEqual(p.games, 0, '등록만으로 경기 수가 오르면 안 됩니다.');
  });
  console.log('  수동 경기 등록: applied');
}

// 2) 전제가 깨지면 거절합니다.
const badCases = [
  [{...manual, court:1, team1Ids:['p1','p2'], team2Ids:['p3','p3']}, '중복 선수'],
  [{...manual, team2Ids:['p3']}, '선수 수 부족'],
  [{...manual, court:9}, '없는 코트'],
  [{...manual, team2Ids:['p3','nope']}, '명단에 없는 선수']
];
badCases.forEach(([request, label])=>{
  const r = send(makeSession(), request);
  assert.strictEqual(r.status, 'rejected', `${label}은 거절되어야 합니다. 실제: ${r.status}`);
  console.log(`  ${label}: rejected (${r.reason})`);
});

// 이미 경기 중인 코트에는 못 넣습니다.
{
  const first = send(makeSession(), manual);
  const second = send(first.session, {...manual, matchId:'sm_manual2', team1Ids:['p5','p9'], team2Ids:['p1','p2']});
  assert.strictEqual(second.status, 'rejected', '같은 코트에 두 경기를 올리면 안 됩니다.');
  console.log(`  코트 중복: rejected (${second.reason})`);
}

// 3) 도착 전 등록 — 명단에는 오르지만 대진에는 안 들어갑니다.
{
  const r = send(makeSession(), {
    type:'official-player-create', playerId:'dpv2_pre1', name:'늦은선수',
    grade:'C', gender:'F', level:4, ageGroup:'30대', status:'planned'
  });
  assert.strictEqual(r.status, 'applied', `도착 전 등록이 적용되어야 합니다: ${r.reason || ''}`);
  const added = r.session.players.find(p=>p.id === 'dpv2_pre1');
  assert(added, '명단에 올라야 합니다.');
  assert.strictEqual(added.status, 'planned', '도착 전 상태여야 합니다.');
  assert.strictEqual(added.preArrivalVisible, true, '도착 전 표시가 켜져야 합니다.');
  // 도착 전 선수는 아직 뛰지 않으므로 라이브 추가로 기록하면 안 됩니다.
  assert(!added.liveAddedAt, '도착 전 등록을 라이브 후 추가로 기록하면 안 됩니다.');
  console.log('  도착 전 등록: applied (planned · 라이브 추가 아님)');

  // 기본값은 현장 참가입니다.
  const now = send(makeSession(), {
    type:'official-player-create', playerId:'dpv2_now1', name:'현장선수', grade:'C', gender:'M'
  });
  assert.strictEqual(now.session.players.find(p=>p.id === 'dpv2_now1').status, 'wait',
    'status 를 안 주면 현장 참가여야 합니다.');
  console.log('  기본값: wait 유지');
}

// 4) 선수 추가는 관리자 전용, 수동 경기 등록은 임원에게도 열렸습니다
//    (운영자 2026-08-10 "임원이 새로운 게임을 생성할 수 있는 권한" —
//     임원의 게임 설정 자유는 최대 보장, 시스템은 사후 균형).
{
  const r = send(makeSession(), {type:'official-player-create', playerId:'dpv2_x', name:'딴선수', status:'planned'}, {admin:false});
  assert.strictEqual(r.status, 'rejected', '선수 추가는 임원 연결로 막혀야 합니다.');
  assert(r.reason.includes('관리자'), `거절 이유가 관리자 전용임을 밝혀야 합니다: ${r.reason}`);
  const byOfficial = send(makeSession(), manual, {admin:false});
  assert.strictEqual(byOfficial.status, 'applied', `임원 새 게임 등록이 적용되어야 합니다: ${byOfficial.reason || ''}`);
  const match = byOfficial.session.event.active.find(m=>m.id === 'sm_manual1');
  assert(match && match.court === 1, '임원이 등록한 경기가 코트에 올라가야 합니다.');
  ['p1','p2','p3','p4'].forEach(id=>{
    assert.strictEqual(byOfficial.session.players.find(p=>p.id === id).status, 'playing',
      '임원 등록 경기의 4명이 경기중이어야 합니다.');
  });
  console.log('  선수 추가: 관리자 전용 유지 · 새 게임 등록: 임원 applied (2026-08-10 개방)');
}

// 5) 관리자 화면이 두 명령을 보내는지, 재생 경로가 있는지 봅니다.
assert(daily.includes("type:'official-manual-match'"), '관리자 화면이 수동 경기 등록 명령을 보내야 합니다.');
assert(daily.includes("status:'planned'"), '도착 전 등록이 planned 상태로 명령을 보내야 합니다.');
assert(daily.includes('function _dailyRegisterPreArrivalsViaServer'), '도착 전 등록 전송 경로가 있어야 합니다.');
assert(daily.includes("req.type==='official-manual-match'"), '수동 경기 등록 재생 경로가 있어야 합니다.');

// 5b) 임원 화면의 다음 대진 짜기 배선 (2026-08-10 "새 게임 등록은 다음 대진을
//     수동으로 짠다는 뜻"). 코트 즉시 시작이 아니라 대기표에 추가합니다.
{
  const checkin = fs.readFileSync(path.join(root, 'checkin.html'), 'utf8');
  assert(checkin.includes('openOfficialQueueCompose'), '임원 화면에 다음 대진 짜기 진입점이 있어야 합니다.');
  assert(checkin.includes("type:'official-queue-add'"), '임원 화면이 대진 추가 명령을 보내야 합니다.');
  assert(checkin.includes('다음 대진 짜기'), '다음 대진 짜기 버튼이 있어야 합니다.');
  assert(!checkin.includes('openOfficialManualMatch'),
    '코트 즉시 시작형 새 게임 등록은 남아 있으면 안 됩니다 — 의미가 바뀌었습니다.');
  ['openOfficialQueueCompose','_officialComposeToggle','sendOfficialQueueMove'].forEach(name=>{
    const start = checkin.indexOf('function '+name);
    assert(start >= 0, `${name} 이 있어야 합니다.`);
    const src = checkin.slice(start, checkin.indexOf('\nfunction ', start + 10));
    assert(!/\bprompt\(/.test(src), `${name} 이 prompt 를 쓰면 안 됩니다.`);
  });
  // A팀·B팀 확인창 없이 바로 보내면 오조작 한 번이 대기표를 어지럽힙니다.
  assert(/A팀 .*B팀 /s.test(checkin) && checkin.includes('다음 대진에 추가할까요?'),
    '팀 구성을 보여주는 확인창이 있어야 합니다.');
  // 순서 변경: 위/아래 버튼이 allowFreeMove 로 보냅니다(운영자 2026-08-10).
  assert(checkin.includes('sendOfficialQueueMove')&&checkin.includes('allowFreeMove:true'),
    '임원 순서 변경 버튼이 있어야 합니다.');
  console.log('  임원 다음 대진 짜기 배선: 버튼 · 팀 확인창 · 순서 변경 · prompt 없음');
}

// 6) 차단 요소가 아니라고 판정한 셋의 근거를 코드로 고정합니다.
//    이 전제가 바뀌면 5단계 계획을 다시 세워야 합니다.
assert(/async function _dailySyncPauseState\(/.test(daily)
  && daily.includes("_fbDb.ref(_dailyCheckinPath()+'/session')"),
  '일시정지는 세션 전체가 아니라 자체 트랜잭션으로 부분 수정해야 합니다.');
const teamRosterStart = daily.indexOf('function dailyImportTeamRoster');
const teamRosterSource = daily.slice(teamRosterStart, teamRosterStart + 600);
assert(teamRosterSource.includes('if(_dailyCheckinId||_dailyOperationStarted||_dailyMatches.length)'),
  '팀전 명단 가져오기는 게시 후에는 거부해야 합니다.');
assert(daily.includes("if(req.type==='reservation'&&!options?.official)return '파트너 요청은 클럽 임원이 현장에서 접수합니다.'"),
  '회원 파트너 요청은 관리자 승인이 아니라 임원 화면에서 접수해야 합니다.');
console.log('  차단 요소 아님 판정 근거 3종 고정');

console.log('\ndaily manual/prearrival command regression ok');
