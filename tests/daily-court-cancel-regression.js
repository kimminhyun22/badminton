'use strict';
/**
 * 경기 취소는 완료와 정확히 반대입니다.
 *
 * 완료 = "이 경기 쳤다" → 경기 수 +1, 파트너·상대 기록 남김, 공정성 기대치 소모
 * 취소 = "잘못 시작했다, 없던 일" → 아무것도 안 세고 경기 전 상태로 되돌림
 *
 * 취소 버튼이 없던 동안에는 오투입도 종료로 처리할 수밖에 없었습니다. 그러면
 * 안 뛴 4명의 경기 수가 올라가고, 대진이 경기 수 적은 사람 우선이라 그날 남은
 * 순번이 계속 틀어집니다. 그래서 둘을 헷갈리면 안 됩니다.
 *
 * 여기서 지키는 것:
 *   1) 취소는 경기 수·파트너·상대 기록을 늘리지 않는다
 *   2) 완료는 늘린다 (대조군 — 둘이 같아지면 이 테스트가 잡는다)
 *   3) 취소는 공정성 기대치를 되돌린다
 *   4) 관리자 전용이고, 전제가 깨지면 거절한다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DCANCEL';
const SECRET = 'court-cancel-regression-secret-at-least-32-bytes';

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

const PLAYING = ['p1','p2','p3','p4'];

function makeSession(){
  const players = [
    player('p1','가선수'), player('p2','나선수'), player('p3','다선수'), player('p4','라선수'),
    player('p5','마선수'), player('p6','바선수'), player('p9','임원선수',{isClubOfficial:true})
  ];
  PLAYING.forEach(id=>{
    const p = players.find(x=>x.id === id);
    p.status = 'playing'; p.statusLabel = 'playing'; p.currentMatchId = 'm1'; p.locked = true;
  });
  return {
    serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+48*60*60*1000,
    capabilities:{officialOpsServerV2:true},
    players,
    reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:2, fourCounts:{}, exactCounts:{}},
    event:{
      courts:2, nextTarget:0, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:0, auto:true},
      active:[{
        id:'m1', court:1, seq:1, type:'남복',
        startedAt:NOW-5*60*1000, expectedMinutes:15, endAt:NOW+10*60*1000,
        playerIds:[...PLAYING], t1Ids:['p1','p2'], t2Ids:['p3','p4'],
        t1:['가선수','나선수'], t2:['다선수','라선수'],
        // 투입할 때 서버가 남긴 공정성 기대치. 취소하면 되돌아야 합니다.
        fairExpectedDeltas:[{id:'p5', amount:2}, {id:'p6', amount:2}]
      }],
      next:[], expected:[], serverStandby:[]
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

const base = {matchId:'m1', court:1, expectedStartedAt:NOW-5*60*1000, expectedPlayerIds:[...PLAYING]};

// 1) 취소: 아무것도 세지 않고 참가 상태로 되돌립니다.
{
  const seeded = makeSession();
  seeded.players.find(p=>p.id === 'p5').fairExpected = 2;
  seeded.players.find(p=>p.id === 'p6').fairExpected = 2;
  const r = send(seeded, {type:'official-court-cancel', ...base});
  assert.strictEqual(r.status, 'applied', `취소가 적용되어야 합니다: ${r.reason || ''}`);
  assert.strictEqual((r.session.event.active || []).length, 0, '코트가 비어야 합니다.');
  PLAYING.forEach(id=>{
    const p = r.session.players.find(x=>x.id === id);
    assert.strictEqual(p.games, 0, `${p.name} 경기 수가 오르면 안 됩니다.`);
    assert.strictEqual(p.typeTrackedGames, 0, `${p.name} 종목 기록이 오르면 안 됩니다.`);
    assert.deepStrictEqual(p.partnerCount, {}, `${p.name} 파트너 기록이 남으면 안 됩니다.`);
    assert.deepStrictEqual(p.opponentCount, {}, `${p.name} 상대 기록이 남으면 안 됩니다.`);
    assert.strictEqual(p.status, 'wait', `${p.name} 는 참가 상태로 돌아와야 합니다.`);
    assert.strictEqual(p.currentMatchId, '', `${p.name} 의 진행 경기가 풀려야 합니다.`);
  });
  // 공정성 기대치는 되돌아야 합니다.
  assert.strictEqual(r.session.players.find(p=>p.id === 'p5').fairExpected, 0,
    '취소하면 대기 선수의 공정성 기대치가 되돌아와야 합니다.');
  console.log('  취소: applied · 경기 수 0 · 기록 없음 · 공정성 되돌림');
}

// 2) 대조군 — 완료는 정확히 반대로 셉니다. 둘이 같아지면 여기서 잡힙니다.
{
  const r = send(makeSession(), {type:'official-court-complete', ...base});
  assert.strictEqual(r.status, 'applied', `완료가 적용되어야 합니다: ${r.reason || ''}`);
  const p1 = r.session.players.find(x=>x.id === 'p1');
  assert.strictEqual(p1.games, 1, '완료는 경기 수를 올려야 합니다.');
  const partnerLogged = Object.keys(p1.partnerCount || {}).length + Object.keys(p1.partnerCountById || {}).length;
  assert(partnerLogged > 0, '완료는 파트너 기록을 남겨야 합니다.');
  console.log('  완료(대조군): applied · 경기 수 1 · 파트너 기록 남음');
}

// 3) 전제가 깨지면 거절합니다.
const badCases = [
  [{...base, matchId:'nope'}, '없는 경기'],
  [{...base, expectedStartedAt:NOW}, '시작 시각 불일치'],
  [{...base, expectedPlayerIds:['p1','p2','p3','p5']}, '선수 구성 불일치'],
  [{...base, expectedPlayerIds:['p1','p2']}, '선수 수 부족']
];
badCases.forEach(([request, label])=>{
  const r = send(makeSession(), {type:'official-court-cancel', ...request});
  assert.strictEqual(r.status, 'rejected', `${label}은 거절되어야 합니다.`);
  console.log(`  ${label}: rejected (${r.reason})`);
});

// 4) 관리자 전용입니다.
{
  const r = send(makeSession(), {type:'official-court-cancel', ...base}, {admin:false});
  assert.strictEqual(r.status, 'rejected', '임원 연결의 경기 취소는 거절되어야 합니다.');
  assert(r.reason.includes('관리자'), `거절 이유가 명확해야 합니다: ${r.reason}`);
  console.log(`  임원 경기 취소: rejected (${r.reason})`);
}

// 5) 관리자 화면이 명령을 보내고, 버튼이 되살아났는지 봅니다.
assert(daily.includes("type:'official-court-cancel'"), '관리자 화면이 취소 명령을 보내야 합니다.');
assert(daily.includes(`onclick="dailyCancelMatch('\${m.id}')"`), '코트 카드에 경기 취소 버튼이 있어야 합니다.');
assert(daily.includes('function _dailyApplyMatchCancel'), '취소 결과를 원본에 반영하는 경로가 있어야 합니다.');
// 로컬 취소도 경기 수를 올리면 안 됩니다.
const cancelStart = daily.indexOf('function _dailyApplyMatchCancel');
const cancelEnd = daily.indexOf('\nfunction ', cancelStart + 10);
const cancelSource = daily.slice(cancelStart, cancelEnd);
assert(!/\.games\s*=/.test(cancelSource), '취소가 경기 수를 건드리면 안 됩니다.');
assert(!/partnerCount|opponentCount/.test(cancelSource), '취소가 파트너·상대 기록을 남기면 안 됩니다.');
assert(cancelSource.includes('_dailyRollbackFairOpportunity'), '취소는 공정성 기대치를 되돌려야 합니다.');
assert(cancelSource.includes('previousStatuses'), '취소는 경기 전 상태로 되돌려야 합니다.');
console.log('  관리자 화면 연결·버튼 확인');


// 6) 취소한 코트에 서버가 곧바로 다른 대진을 자동 투입하면 안 됩니다.
//    종료는 serverResult.autoEnter 로 관리자 원본에 넘겨주지만 취소에는 그 배선이 없어,
//    자동 투입되면 서버에만 경기가 생기고 관리자 화면과 갈라집니다.
//    실측(2026-08-04): 취소 직후 서버 active 에 sm_..._court-cancel_..._c2_0 이 생기고
//    관리자 원본에는 없었습니다.
//
//    ※ 이 규칙은 소스로 고정합니다. 자동 투입이 실제로 발생하는 세션을 픽스처로
//      재현하려 했으나(대기 인원·코트·큐 조합) 안정적으로 만들지 못했습니다.
//      행동 검사가 아니라는 점을 분명히 적어 둡니다.
{
  const engine = fs.readFileSync(path.join(root, 'functions', 'daily-official-engine.js'), 'utf8');
  const guard = engine.match(/if\(!\[([^\]]*)\]\.includes\(request\.type\)\)\{\s*\n\s*autoEnterFreeCourts/);
  assert(guard, '자동 투입 제외 목록을 찾을 수 있어야 합니다.');
  assert(guard[1].includes("'official-court-cancel'"),
    '경기 취소는 자동 투입 제외 목록에 있어야 합니다. 없으면 취소한 코트에 서버가 새 대진을 넣어 관리자 원본과 갈라집니다.');
  console.log('  취소 후 자동 투입 제외 확인 (소스 검사)');
}

console.log('\ndaily court cancel regression ok');
