'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  applyMemberStatusRequest,
  applyOfficialRequest,
  canonicalJson,
  issueOfficialGrant
} = require('../functions/daily-official-engine');
const {applyMemberCommandTransaction} = require('../functions/daily-member-command');

const NOW = 1_850_000_000_000;
const CHECKIN_ID = 'DMBR2222';
const SECRET = 'daily-member-status-regression-secret';

function clone(value){return JSON.parse(JSON.stringify(value));}
function hash(value){return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');}
function player(id, options = {}){
  return {
    id,
    name:id.toUpperCase(),
    level:options.level || 4,
    grade:'C',
    gender:options.gender || 'M',
    ageGroup:'40대',
    team:options.team || '',
    status:options.status || 'wait',
    statusLabel:options.status || 'wait',
    locked:false,
    currentMatchId:'',
    afterMatchStatus:'',
    games:options.games || 0,
    mixedGames:0,
    typeTrackedGames:0,
    lastPlayedSeq:0,
    partnerCountById:{},
    opponentCountById:{},
    joinedAt:NOW-60*60_000,
    waitFrom:NOW-30*60_000,
    lastStatusAt:NOW-1000,
    isClubOfficial:!!options.official
  };
}
function queue(id, ids){
  return {
    id,
    queueId:id,
    type:'남복',
    teamMode:false,
    t1Ids:ids.slice(0, 2),
    t2Ids:ids.slice(2),
    team1:ids.slice(0, 2),
    team2:ids.slice(2),
    playerIds:[...ids],
    t1:ids.slice(0, 2).map(value=>value.toUpperCase()),
    t2:ids.slice(2).map(value=>value.toUpperCase()),
    strict:true,
    flexible:false
  };
}
function session(options = {}){
  const players = [
    player('official',{status:'rest',official:true}),
    player('p1'),
    player('p2'),
    player('p3'),
    player('p4'),
    player('p5',{status:options.freeStatus || 'wait'}),
    player('p6',{status:'rest'})
  ];
  return {
    serverSessionId:CHECKIN_ID,
    commandProtocol:2,
    serverRevision:0,
    expiresAt:NOW+48*60*60_000,
    capabilities:{officialOpsServerV2:true,memberStatusServerV1:true},
    players,
    reservations:[],
    arrivalCandidates:[],
    serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
    event:{
      courts:1,
      nextTarget:1,
      serverExpectedGoal:0,
      completed:0,
      finishMode:false,
      operationStarted:true,
      queuePolicy:{official:1,auto:true},
      active:[],
      next:[queue('q1',['p1','p2','p3','p4'])],
      expected:[],
      serverStandby:[]
    }
  };
}
function memberCommand(operationId, extra = {}){
  return {
    type:'member-player-status',
    operationId,
    commandProtocol:2,
    actorPlayerId:'p1',
    playerId:'p1',
    playerName:'P1',
    status:'rest',
    expectedStatus:'wait',
    expectedCurrentMatchId:'',
    expectedLastStatusAt:NOW-1000,
    createdAt:NOW,
    expiresAt:NOW+5*60_000,
    source:'member-checkin-server',
    ...extra
  };
}

const applied = applyMemberStatusRequest(session(), memberCommand('member_status_apply_001'), {
  now:NOW,
  requestId:'member_status_apply_001'
});
assert.strictEqual(applied.status,'applied','회원 상태 요청은 관리자 앱 없이 서버에서 즉시 적용되어야 합니다.');
assert.strictEqual(applied.session.players.find(row=>row.id==='p1').status,'rest','회원 휴식 상태를 서버 세션에 바로 반영해야 합니다.');
const repaired = applied.session.event.next.find(item=>item.queueId==='q1');
assert(repaired,'유효한 대체 선수가 있으면 기존 다음 대진 자체를 없애면 안 됩니다.');
assert.deepStrictEqual(
  repaired.playerIds.filter(id=>['p2','p3','p4'].includes(id)).sort(),
  ['p2','p3','p4'],
  '상태를 바꾸지 않은 나머지 세 선수는 같은 대진에 그대로 남아야 합니다.'
);
assert(repaired.playerIds.includes('p5')&&!repaired.playerIds.includes('p1'),'공정성 검사를 통과한 대체 선수 한 명만 투입해야 합니다.');
assert.strictEqual(applied.result.playerStatus.queueRepair.keptThree,true,'서버 결과에 3인 유지 교체 성공을 기록해야 합니다.');
assert.strictEqual(applied.result.playerStatus.queueRepair.replacementPlayerId,'p5','서버 결과에 실제 대체 선수를 기록해야 합니다.');

const removedRestPassSession = session();
removedRestPassSession.event.next[0].restPass = {playerId:'p1',playerName:'P1',court:1,createdAt:NOW-1000};
removedRestPassSession.event.next[0].restPassText = 'P1님이 조금 쉬고 입장';
const removedRestPass = applyMemberStatusRequest(removedRestPassSession, memberCommand('member_status_rest_pass_001'), {
  now:NOW,
  requestId:'member_status_rest_pass_001'
});
assert(!removedRestPass.session.event.next[0].restPass,'빠진 선수가 요청한 조금 쉬고 표시는 대체된 대진에 남으면 안 됩니다.');
assert.notStrictEqual(removedRestPass.session.event.next[0].cueState,'hold','대체 완료된 대진이 이전 선수의 조금 쉬고 요청 때문에 코트 투입에서 막히면 안 됩니다.');

const retainedRestPassSession = session();
retainedRestPassSession.event.next[0].restPass = {playerId:'p2',playerName:'P2',court:1,createdAt:NOW-1000};
retainedRestPassSession.event.next[0].restPassText = 'P2님이 조금 쉬고 입장';
const retainedRestPass = applyMemberStatusRequest(retainedRestPassSession, memberCommand('member_status_rest_pass_002'), {
  now:NOW,
  requestId:'member_status_rest_pass_002'
});
assert.strictEqual(retainedRestPass.session.event.next[0].restPass.playerId,'p2','남은 세 선수 중 한 명의 조금 쉬고 요청은 교체 후에도 유지해야 합니다.');

const genderSession = session();
genderSession.players.find(row=>row.id==='p2').gender = 'F';
genderSession.players.find(row=>row.id==='p4').gender = 'F';
genderSession.players.find(row=>row.id==='p5').gender = 'F';
genderSession.players.find(row=>row.id==='p6').gender = 'M';
genderSession.players.find(row=>row.id==='p6').status = 'wait';
const genderApplied = applyMemberStatusRequest(genderSession, memberCommand('member_status_gender_001'), {
  now:NOW,
  requestId:'member_status_gender_001'
});
assert.strictEqual(genderApplied.result.playerStatus.queueRepair.replacementPlayerId,'p6','가능한 경우 기존 혼복 구성을 유지하는 대체 선수를 우선해야 합니다.');
assert.strictEqual(genderApplied.session.event.next[0].type,'혼복','대체 후에도 엄격한 성별 경기 유형을 유지해야 합니다.');

const teamSession = session();
teamSession.event.teamMode = true;
teamSession.event.next[0].teamMode = true;
['p1','p2','p5'].forEach(id=>{teamSession.players.find(row=>row.id===id).team='청팀';});
['p3','p4','p6'].forEach(id=>{teamSession.players.find(row=>row.id===id).team='홍팀';});
teamSession.players.find(row=>row.id==='p6').status = 'wait';
const teamApplied = applyMemberStatusRequest(teamSession, memberCommand('member_status_team_001'), {
  now:NOW,
  requestId:'member_status_team_001'
});
assert.strictEqual(teamApplied.result.playerStatus.queueRepair.replacementPlayerId,'p5','청홍팀전에서는 빠진 선수와 같은 팀 선수만 대체 투입해야 합니다.');
assert(teamApplied.session.event.next[0].t1Ids.every(id=>teamApplied.session.players.find(row=>row.id===id).team==='청팀'),'대체 후 청팀 구성이 섞이면 안 됩니다.');

const projectedSession = session({freeStatus:'rest'});
projectedSession.players.find(row=>row.id==='p5').status = 'wait';
projectedSession.players.find(row=>row.id==='p6').status = 'wait';
projectedSession.players.push(player('p7'),player('p8'));
projectedSession.event.expected = [queue('q2',['p5','p6','p7','p8'])];
const projectedApplied = applyMemberStatusRequest(projectedSession, memberCommand('member_status_projected_001'), {
  now:NOW,
  requestId:'member_status_projected_001'
});
assert.strictEqual(projectedApplied.result.playerStatus.queueRepair.keptThree,true,'미편성 선수가 없어도 뒤 예상 대진에서 공정한 대체 선수를 찾을 수 있어야 합니다.');
assert.strictEqual(projectedApplied.result.playerStatus.queueRepair.replacementSource,'expected','예상 대진에서 가져온 대체 선수의 출처를 기록해야 합니다.');
assert(!projectedApplied.session.event.expected.some(item=>item.queueId==='q2'),'한 명을 가져온 예상 대진은 중복 선수를 남기지 않도록 해체 후 다시 편성해야 합니다.');

const noCandidate = applyMemberStatusRequest(session({freeStatus:'rest'}), memberCommand('member_status_remove_001'), {
  now:NOW,
  requestId:'member_status_remove_001'
});
assert.strictEqual(noCandidate.status,'applied','대체 선수가 없어도 회원 상태 변경 자체는 적용되어야 합니다.');
assert.strictEqual(noCandidate.session.event.next.length,0,'공정한 대체 선수가 없을 때만 해당 대진을 해체해야 합니다.');
assert.strictEqual(noCandidate.result.playerStatus.queueRepair.queueRemoved,true,'대진 해체 여부를 서버 결과에 남겨야 합니다.');

const stale = applyMemberStatusRequest(session(), memberCommand('member_status_stale_001',{
  expectedLastStatusAt:NOW-2000
}), {now:NOW,requestId:'member_status_stale_001'});
assert.strictEqual(stale.status,'rejected','오래된 회원 화면의 상태 요청은 현재 대진을 바꾸면 안 됩니다.');
assert.strictEqual(stale.session.players.find(row=>row.id==='p1').status,'wait','거절된 요청은 선수 상태를 보존해야 합니다.');

const impersonated = applyMemberStatusRequest(session(), memberCommand('member_status_actor_001',{
  actorPlayerId:'p2'
}), {now:NOW,requestId:'member_status_actor_001'});
assert.strictEqual(impersonated.status,'rejected','회원 즉시 처리 API는 요청자와 대상 선수가 다르면 거절해야 합니다.');

const root = {session:session()};
const stored = memberCommand('member_transaction_001');
const input = {
  storedCommand:stored,
  operationId:stored.operationId,
  payloadHash:hash(stored),
  now:NOW,
  checkinId:CHECKIN_ID
};
const firstTransaction = applyMemberCommandTransaction(root, input);
assert.strictEqual(firstTransaction.action,'commit','회원 상태 변경은 세션과 요청 기록을 한 트랜잭션으로 저장해야 합니다.');
assert.strictEqual(firstTransaction.terminal.status,'applied','회원 트랜잭션의 성공 결과를 호출자에게 돌려줘야 합니다.');
assert(firstTransaction.current.requests[stored.operationId].serverAppliedAt,'관리자 재접속용 서버 적용 기록을 남겨야 합니다.');
const duplicate = applyMemberCommandTransaction(firstTransaction.current, input);
assert.strictEqual(duplicate.action,'duplicate','같은 회원 요청이 재전송되어도 상태를 두 번 바꾸면 안 됩니다.');
assert.strictEqual(duplicate.terminal.resultRevision,firstTransaction.current.session.serverRevision,'중복 요청은 최초 결과 리비전을 그대로 반환해야 합니다.');
const collisionStored = {...stored,status:'done'};
const collision = applyMemberCommandTransaction(firstTransaction.current, {
  ...input,
  storedCommand:collisionStored,
  payloadHash:hash(collisionStored)
});
assert.strictEqual(collision.action,'abort','같은 요청 번호에 다른 상태를 넣은 재전송은 충돌로 차단해야 합니다.');
assert.strictEqual(collision.failureCode,'already-exists','요청 번호 충돌 원인을 명확히 기록해야 합니다.');
const competingStored = memberCommand('member_transaction_competing_001',{status:'done'});
const competing = applyMemberCommandTransaction(firstTransaction.current, {
  storedCommand:competingStored,
  operationId:competingStored.operationId,
  payloadHash:hash(competingStored),
  now:NOW+1,
  checkinId:CHECKIN_ID
});
assert.strictEqual(competing.terminal.status,'rejected','동시에 보낸 오래된 두 번째 상태 요청은 첫 번째 트랜잭션 뒤 거절되어야 합니다.');
assert.strictEqual(competing.current.session.players.find(row=>row.id==='p1').status,'rest','경합한 오래된 요청이 먼저 적용된 상태를 덮어쓰면 안 됩니다.');
assert.strictEqual(competing.current.session.serverRevision,firstTransaction.current.session.serverRevision,'거절된 경합 요청은 서버 리비전을 올리면 안 됩니다.');

const officialSession = session();
const grant = issueOfficialGrant({
  v:1,
  sid:CHECKIN_ID,
  cid:'official_test_client_123456',
  pid:'official',
  iat:NOW-1000,
  exp:NOW+60*60_000
}, SECRET);
const official = applyOfficialRequest(officialSession, {
  type:'official-player-status',
  operationId:'official_status_unified_001',
  actorPlayerId:'official',
  actorPlayerName:'OFFICIAL',
  playerId:'p1',
  playerName:'P1',
  status:'done',
  expectedStatus:'wait',
  expectedCurrentMatchId:'',
  expectedLastStatusAt:NOW-1000,
  createdAt:NOW,
  expiresAt:NOW+30*60_000,
  officialGrantToken:grant
}, {
  now:NOW,
  requestId:'official_status_unified_001',
  checkinId:CHECKIN_ID,
  grantSecret:SECRET
});
assert.strictEqual(official.status,'applied','임원 상태 처리도 공통 서버 교체 엔진을 계속 사용해야 합니다.');
assert.strictEqual(official.result.playerStatus.queueRepair.keptThree,true,'임원과 회원 요청의 대진 보정 결과가 같아야 합니다.');
assert(official.session.event.next[0].playerIds.includes('p5'),'임원 처리에서도 기존 3명과 공정한 대체 1명을 유지해야 합니다.');

const rootPath = path.join(__dirname,'..');
const checkinSource = fs.readFileSync(path.join(rootPath,'checkin.html'),'utf8');
const dailySource = fs.readFileSync(path.join(rootPath,'js','daily.js'),'utf8');
const functionsSource = fs.readFileSync(path.join(rootPath,'functions','index.js'),'utf8');
assert(checkinSource.includes("httpsCallable('submitDailyMemberStatusRequest')"),'회원 화면은 관리자 앱 대신 회원 상태 서버 함수를 직접 호출해야 합니다.');
assert(checkinSource.includes("type:'member-player-status'")&&checkinSource.includes('expectedLastStatusAt:Number(p.lastStatusAt||0)'),'회원 요청은 본인 식별값과 최신 상태 지문을 함께 보내야 합니다.');
assert(dailySource.includes('memberStatusServerV1:!!_dailyOfficialInviteHash'),'관리자 세션은 서버 준비가 끝난 경우에만 회원 즉시 처리 기능을 게시해야 합니다.');
assert(dailySource.includes("req.type==='member-player-status'"),'관리자 재접속 시 회원 서버 처리 결과도 리비전 순서대로 원본에 연결해야 합니다.');
assert(functionsSource.includes('exports.submitDailyMemberStatusRequest'),'Firebase 함수 진입점을 배포 대상에 포함해야 합니다.');
assert(functionsSource.includes('function publicMemberStatusCommand(raw, operationId)')&&functionsSource.includes("source:'member-checkin-server'"),'회원 callable은 클라이언트가 보낸 서버 전용 필드를 저장하지 않고 허용된 상태 필드만 새로 구성해야 합니다.');

console.log('Daily member immediate status regression passed.');
