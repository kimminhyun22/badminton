'use strict';
/**
 * 진행 중 경기 선수 교체 (운영자 결정 2026-08-08).
 *
 *   1) 경기는 교체로 들어간 선수가 뛴 걸로 — 종료 시점 명단으로 셉니다
 *   2) 임원이 처리할 수 있습니다 (inPlayerId 지정 포함)
 *   3) 다른 코트 선수와 맞교환이 됩니다 (두 경기 원자적 교체)
 *
 * 코트에서 4명이 동의하고 바꾸는 일을 시스템이 막으면, 기록만 실제와 어긋납니다.
 * 대진 공정성 엔진의 전제가 "기록된 4명 = 실제 뛴 4명"입니다.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');
const checkin = fs.readFileSync(path.join(root, 'checkin.html'), 'utf8');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DREPL01';
const SECRET = 'active-replace-regression-secret-at-least-32-bytes';
const adminGrant = issueOfficialGrant({v:1, sid:SESSION_ID, cid:'admin', iat:NOW-1000, exp:NOW+3600_000}, SECRET);
const officialGrant = issueOfficialGrant({v:1, sid:SESSION_ID, cid:'off', pid:'p9', iat:NOW-1000, exp:NOW+3600_000}, SECRET);

function player(id, name, extra = {}){
  return {id, name, gender:'M', level:4, grade:'C', ageGroup:'40대',
    status:'wait', statusLabel:'wait', locked:false, currentMatchId:'', afterMatchStatus:'',
    games:0, fairExpected:0, mixedGames:0, typeTrackedGames:0, lastPlayedSeq:0,
    partnerCount:{}, opponentCount:{}, partnerCountById:{}, opponentCountById:{},
    joinedAt:NOW, waitFrom:NOW, lastStatusAt:NOW-1000, restPausedMs:0,
    preArrivalVisible:false, registrationCancelled:false,
    isClubOfficial:false, isTemporaryOfficial:false, isGuest:false, ...extra};
}
function activeMatch(id, court, ids){
  return {id, court, seq:court, type:'남복', startedAt:NOW-5*60_000, expectedMinutes:15,
    endAt:NOW+10*60_000, playerIds:[...ids], t1Ids:ids.slice(0,2), t2Ids:ids.slice(2,4),
    t1:['',''], t2:['','']};
}
function makeSession(){
  const players=[];
  for(let i=1;i<=9;i++)players.push(player('p'+i,'선수'+i,{isClubOfficial:i===9}));
  ['p1','p2','p3','p4','p5','p6','p7','p8'].forEach((id,i)=>{
    const p=players.find(x=>x.id===id);
    p.status='playing'; p.statusLabel='playing'; p.locked=true;
    p.currentMatchId=i<4?'m1':'m2';
  });
  const w=player('w1','대기선수');
  players.push(w);
  return {serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+48*3600_000, capabilities:{officialOpsServerV2:true},
    players, reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:3, fourCounts:{}, exactCounts:{}},
    event:{courts:2, nextTarget:0, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:0, auto:true},
      active:[activeMatch('m1',1,['p1','p2','p3','p4']), activeMatch('m2',2,['p5','p6','p7','p8'])],
      next:[], expected:[], serverStandby:[]}};
}
function send(session, request, {admin=true}={}){
  return applyOfficialRequest(session, {
    operationId:'op_'+Math.random().toString(36).slice(2,9), commandProtocol:2,
    actorPlayerId:admin?'':'p9', actorPlayerName:admin?'관리자':'임원선수',
    officialGrantToken:admin?adminGrant:officialGrant,
    createdAt:NOW+1000, expiresAt:NOW+30*60_000, ...request
  }, {now:NOW+1000, grantSecret:SECRET, checkinId:SESSION_ID, adminClaim:admin});
}
const base={type:'official-active-replace', matchId:'m1', court:1,
  expectedStartedAt:NOW-5*60_000, expectedPlayerIds:['p1','p2','p3','p4']};

// 1) 대기 선수 투입: 들어온 선수가 마저 뛰고, 종료하면 그 선수가 경기를 가져갑니다.
{
  const r=send(makeSession(), {...base, outPlayerId:'p1', inPlayerId:'w1'});
  assert.strictEqual(r.status,'applied',`교체가 적용되어야 합니다: ${r.reason||''}`);
  const m=r.session.event.active.find(x=>x.id==='m1');
  assert(m.playerIds.includes('w1')&&!m.playerIds.includes('p1'),'명단이 바뀌어야 합니다.');
  assert.strictEqual(m.startedAt,NOW-5*60_000,'타이머(시작 시각)는 그대로여야 합니다.');
  const w=r.session.players.find(p=>p.id==='w1');
  const out=r.session.players.find(p=>p.id==='p1');
  assert.strictEqual(w.status,'playing','들어온 선수는 경기중이어야 합니다.');
  assert.strictEqual(out.status,'rest','나간 선수는 휴식으로 전환됩니다.');
  // 결정 1: 종료하면 끝까지 뛴 사람이 경기를 가져갑니다.
  const done=send(r.session, {type:'official-court-complete', matchId:'m1', court:1,
    expectedStartedAt:NOW-5*60_000, expectedPlayerIds:['w1','p2','p3','p4']});
  assert.strictEqual(done.status,'applied',`교체 후 종료가 되어야 합니다: ${done.reason||''}`);
  assert.strictEqual(done.session.players.find(p=>p.id==='w1').games,1,'교체 투입 선수가 경기 수를 가져갑니다.');
  assert.strictEqual(done.session.players.find(p=>p.id==='p1').games,0,'나간 선수는 경기 수가 오르지 않습니다.');
  console.log('  대기 선수 투입: 명단 교체 · 타이머 유지 · 종료 시 투입 선수 +1');
}

// 2) 맞교환: 두 코트의 명단이 한 번에 바뀝니다.
{
  const r=send(makeSession(), {...base, outPlayerId:'p1', inPlayerId:'p5'});
  assert.strictEqual(r.status,'applied',`맞교환이 적용되어야 합니다: ${r.reason||''}`);
  const m1=r.session.event.active.find(x=>x.id==='m1');
  const m2=r.session.event.active.find(x=>x.id==='m2');
  assert(m1.playerIds.includes('p5')&&!m1.playerIds.includes('p1'),'1코트에 p5 가 들어와야 합니다.');
  assert(m2.playerIds.includes('p1')&&!m2.playerIds.includes('p5'),'2코트에 p1 이 가야 합니다.');
  assert.strictEqual(r.session.players.find(p=>p.id==='p1').currentMatchId,'m2');
  assert.strictEqual(r.session.players.find(p=>p.id==='p5').currentMatchId,'m1');
  assert.strictEqual(r.session.players.find(p=>p.id==='p1').status,'playing','맞교환은 둘 다 계속 경기중입니다.');
  console.log('  코트 간 맞교환: 두 경기 동시 교체 · 둘 다 경기중 유지');
}

// 3) 임원도 지정 교체가 됩니다 (결정 2). queue-replace 의 지정 금지는 그대로입니다.
{
  const r=send(makeSession(), {...base, outPlayerId:'p1', inPlayerId:'w1'}, {admin:false});
  assert.strictEqual(r.status,'applied',`임원 교체가 적용되어야 합니다: ${r.reason||''}`);
  console.log('  임원 지정 교체: applied');
  const q=send(makeSession(), {type:'official-queue-replace', queueId:'q1',
    outPlayerId:'p1', inPlayerId:'w1', expectedPlayerIds:['p1','p2','p3','p4']}, {admin:false});
  assert.strictEqual(q.status,'rejected','대기 경기의 지정 교체는 여전히 관리자 전용입니다.');
  assert(q.reason.includes('관리자'),q.reason);
  console.log('  대기 경기 지정 교체(임원): rejected 유지');
}

// 4) 전제가 깨지면 거절합니다.
[
  [{...base, outPlayerId:'p1', inPlayerId:'p2'}, '같은 경기 선수'],
  [{...base, outPlayerId:'p1', inPlayerId:'p1'}, '같은 선수'],
  [{...base, outPlayerId:'w1', inPlayerId:'p2'}, '경기에 없는 out'],
  [{...base, expectedPlayerIds:['p1','p2','p3','p9'], outPlayerId:'p1', inPlayerId:'w1'}, '지문 불일치']
].forEach(([req,label])=>{
  const r=send(makeSession(), req);
  assert.strictEqual(r.status,'rejected',`${label}은 거절되어야 합니다.`);
  console.log(`  ${label}: rejected (${r.reason})`);
});
{
  const s2=makeSession();
  s2.players.find(p=>p.id==='w1').status='rest';
  const r=send(s2, {...base, outPlayerId:'p1', inPlayerId:'w1'});
  assert.strictEqual(r.status,'rejected','휴식 선수는 참가로 바꾼 뒤 넣어야 합니다.');
  console.log(`  휴식 선수 투입: rejected (${r.reason})`);
}

// 5) 화면 배선 — 관리자·임원 양쪽, 그리고 관리자 원본의 재생·검증 (오늘 밤의 교훈).
assert(daily.includes("type:'official-active-replace'"),'관리자 화면이 교체 명령을 보내야 합니다.');
assert(daily.includes("req.type==='official-active-replace'"),'관리자 원본에 재생·검증 분기가 있어야 합니다.');
assert(daily.includes('function _dailyApplyActiveReplaceLocal'),'재생과 게시 전 경로가 같은 적용 함수를 써야 합니다.');
assert(checkin.includes('sendOfficialActiveReplace'),'임원 화면에 교체 전송이 있어야 합니다.');
assert(checkin.includes('선수 교체'),'임원 진행중 카드에 교체 버튼이 있어야 합니다.');
console.log('  관리자·임원 화면 배선 + 재생 경로 확인');

console.log('\ndaily active replace regression ok');
