'use strict';
/**
 * 클럽 임원이 관리자 없이 오늘 명단을 일괄 설정한다.
 *
 * 같은 회원 링크에 보관된 클럽 명부 스냅샷만 사용하고, 선택한 여러 명을 한 서버
 * 트랜잭션으로 현장 참가 또는 도착 전으로 등록한다. 요청은 후보 키만 보내므로
 * 급수·성별·임원 자격을 위조할 수 없어야 한다.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const repo = process.env.MINTON_ROSTER_SETUP_ROOT
  ? path.resolve(process.env.MINTON_ROSTER_SETUP_ROOT)
  : path.join(__dirname, '..');
const {applyCommandTransaction} = require(path.join(repo, 'functions', 'daily-official-command'));
const {applyOfficialClaimTransaction} = require(path.join(repo, 'functions', 'daily-official-claim'));
const {canonicalJson, issueOfficialGrant} = require(path.join(repo, 'functions', 'daily-official-engine'));

const NOW = 1_830_100_000_000;
const SESSION_ID = 'DSETUP1';
const SECRET = 'official-roster-setup-regression-secret-at-least-32-bytes';
const CLIENT = 'official-client';
const hash = value=>crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');

function player(id, name, extra = {}){
  return {
    id,name,gender:'M',level:4,grade:'C',ageGroup:'40대',club:'테스트클럽',
    status:'wait',statusLabel:'참가',locked:false,currentMatchId:'',afterMatchStatus:'',
    games:0,fairExpected:0,mixedGames:0,typeTrackedGames:0,lastPlayedSeq:0,
    partnerCount:{},opponentCount:{},partnerCountById:{},opponentCountById:{},
    joinedAt:NOW,waitFrom:NOW,lastStatusAt:NOW-1000,restPausedMs:0,
    preArrivalVisible:false,registrationCancelled:false,
    isClubOfficial:false,isTemporaryOfficial:false,isGuest:false,...extra
  };
}
function session(){
  return {
    serverSessionId:SESSION_ID,serverRevision:0,commandProtocol:2,
    expiresAt:NOW+48*3600_000,arrivalClub:'테스트클럽',
    capabilities:{officialOpsServerV2:true,officialRosterSetupV1:true},
    players:[
      player('p1','도착전선수',{status:'planned',statusLabel:'도착 전',preArrivalVisible:true}),
      player('p8','운영도우미',{isTemporaryOfficial:true}),
      player('p9','클럽임원',{isClubOfficial:true})
    ],
    arrivalCandidates:[
      {candidateKey:'player:p1',kind:'existing',playerId:'p1',name:'도착전선수',status:'planned',lastStatusAt:NOW-1000},
      {candidateKey:'roster:m1',kind:'roster',memberId:'m1',name:'명부선수',grade:'B',level:5,gender:'F',ageGroup:'30대',club:'테스트클럽',isClubOfficial:false},
      {candidateKey:'roster:m2',kind:'roster',memberId:'m2',name:'명부임원',grade:'A',level:6,gender:'M',ageGroup:'40대',club:'테스트클럽',isClubOfficial:true},
      {candidateKey:'roster:foreign',kind:'roster',memberId:'foreign',name:'다른클럽선수',grade:'C',level:4,gender:'M',ageGroup:'40대',club:'다른클럽',isClubOfficial:false}
    ],
    reservations:[],serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
    event:{courts:3,nextTarget:3,completed:0,finishMode:false,operationStarted:false,
      queuePolicy:{official:3,auto:true},active:[],next:[],expected:[],serverStandby:[]}
  };
}
function rootFor(currentSession, actorId = 'p9'){
  return {
    session:currentSession,requests:{},serverCommands:{},serverOps:{},
    officialClaims:{[CLIENT]:{clientId:CLIENT,officialPlayerId:actorId,claimMode:'roster',claimNonce:'nonce1',expiresAt:NOW+3600_000}}
  };
}
function submit(currentSession, extra, actorId = 'p9'){
  const operationId='setup_'+Math.random().toString(36).slice(2,10);
  const stored={
    type:'official-roster-setup',operationId,actorPlayerId:actorId,
    actorPlayerName:actorId==='p9'?'클럽임원':'운영도우미',
    createdAt:NOW,expiresAt:NOW+30*60_000,source:'test',...extra
  };
  const grant=issueOfficialGrant({v:1,sid:SESSION_ID,cid:CLIENT,pid:actorId,iat:NOW-1000,exp:NOW+3600_000,cn:'nonce1'},SECRET);
  return applyCommandTransaction(rootFor(currentSession,actorId),{
    storedCommand:stored,engineCommand:{...stored,officialGrantToken:grant},
    operationId,payloadHash:hash(stored),clientId:CLIENT,grantPlayerId:actorId,
    grantClaimNonce:'nonce1',now:NOW,checkinId:SESSION_ID,grantSecret:SECRET
  });
}

// 1) 기존 도착 전 선수와 새 명부 선수를 한 트랜잭션으로 현장 참가 등록한다.
{
  const result=submit(session(),{
    candidateKeys:['player:p1','roster:m1','roster:m2'],status:'wait',
    // 요청에 역할 필드를 끼워도 서버 명부 스냅샷 외에는 신뢰하지 않는다.
    isClubOfficial:true
  });
  assert.strictEqual(result.action,'commit',result.failureMessage||result.terminal?.reason||'일괄 명부 등록이 적용되어야 합니다.');
  assert.strictEqual(result.terminal?.status,'applied');
  const players=result.current.session.players;
  assert.strictEqual(players.find(p=>p.id==='p1').status,'wait','기존 도착 전 선수는 현장 참가로 바뀌어야 합니다.');
  const ordinary=players.find(p=>p.memberId==='m1');
  const official=players.find(p=>p.memberId==='m2');
  assert(ordinary&&official,'선택한 명부 선수 두 명이 모두 추가되어야 합니다.');
  assert.strictEqual(ordinary.grade,'B');
  assert.strictEqual(ordinary.gender,'F');
  assert.strictEqual(ordinary.isClubOfficial,false,'요청 필드로 임원 자격을 위조하면 안 됩니다.');
  assert.strictEqual(official.isClubOfficial,true,'서버 명부에 있던 임원 자격은 보존해야 합니다.');
  assert.strictEqual(result.current.session.serverRevision,1,'여러 명을 한 명령으로 처리해 리비전은 한 번만 올라야 합니다.');
  const applied=result.terminal.serverResult?.rosterSetup?.players||[];
  assert.strictEqual(applied.length,3,'관리자 추종용으로 적용 선수 세 명이 반환되어야 합니다.');
  assert(!result.current.session.arrivalCandidates.some(c=>['player:p1','roster:m1','roster:m2'].includes(c.candidateKey)),
    '등록한 후보는 후보 목록에서 빠져야 합니다.');
  console.log('  임원 일괄 현장 참가: 3명 · revision 1 · 명부 프로필/임원 표시 보존');
}

// 2) 도착 전 등록도 같은 명령으로 하며 자동대진에는 들어가지 않는다.
{
  const result=submit(session(),{candidateKeys:['roster:m1'],status:'planned'});
  assert.strictEqual(result.action,'commit',result.failureMessage||result.terminal?.reason||'');
  const added=result.current.session.players.find(p=>p.memberId==='m1');
  assert.strictEqual(added.status,'planned');
  assert.strictEqual(added.preArrivalVisible,true);
  assert(!added.liveAddedAt,'도착 전 선수는 라이브 후 참가로 기록하면 안 됩니다.');
  console.log('  임원 일괄 도착 전: 대진 제외 상태 유지');
}

// 3) 전체 명령은 원자적이다. 잘못된 후보·다른 클럽·중복 키는 일부만 적용하지 않는다.
for(const [label,keys] of [
  ['없는 후보',['roster:m1','roster:missing']],
  ['다른 클럽',['roster:m1','roster:foreign']],
  ['중복 후보',['roster:m1','roster:m1']]
]){
  const before=session();
  const result=submit(before,{candidateKeys:keys,status:'wait'});
  assert.notStrictEqual(result.terminal?.status,'applied',`${label}가 섞이면 전체 명령을 거절해야 합니다.`);
  assert.strictEqual(before.players.length,3,`${label} 거절 때 입력 세션을 바꾸면 안 됩니다.`);
}
console.log('  원자성: 없는 후보 · 다른 클럽 · 중복 후보 전체 거절');

// 4) 운영 도우미는 일상 진행만 맡고, 오늘 명단 일괄 설정은 정식 클럽 임원만 한다.
{
  const result=submit(session(),{candidateKeys:['roster:m1'],status:'wait'},'p8');
  assert.notStrictEqual(result.terminal?.status,'applied','운영 도우미가 전체 명부를 설정하면 안 됩니다.');
  assert(String(result.failureMessage||result.terminal?.reason||'').includes('클럽 임원'),'거절 이유가 정식 임원 경계를 알려야 합니다.');
  console.log('  권한: 클럽 임원만 일괄 명부 설정');
}

// 5) 아직 도착 전인 정식 임원도 관리자 확인 없이 연결하고 오늘 명단을 준비할 수 있다.
{
  const current=session();
  const actor=current.players.find(p=>p.id==='p9');
  actor.status='planned';
  actor.statusLabel='도착 전';
  actor.preArrivalVisible=true;
  delete current.capabilities.officialRosterSetupV1;
  const claimed=applyOfficialClaimTransaction({session:current,officialClaims:{}},{
    clientId:'prep-client',requestedPlayerId:'p9',now:NOW,maxGrantMs:3600_000,claimNonce:'prep-nonce'
  });
  assert.strictEqual(claimed.action,'commit',claimed.failureMessage||'도착 전 클럽 임원의 운영 연결이 열려야 합니다.');
  assert.strictEqual(claimed.current.session.capabilities.officialRosterSetupV1,true,
    '기존 상시 링크도 임원 연결과 함께 일괄 명부 능력을 받아야 합니다.');
  const setup=submit(claimed.current.session,{candidateKeys:['roster:m1'],status:'wait'});
  assert.strictEqual(setup.terminal?.status,'applied',setup.failureMessage||setup.terminal?.reason||'도착 전 임원의 명부 준비 명령이 적용돼야 합니다.');
  console.log('  시작 진입: 도착 전 정식 임원 연결 → 관리자 없이 명부 준비');
}

// 6) 화면·관리자 추종·능력 표시 배선.
const checkin=fs.readFileSync(path.join(repo,'checkin.html'),'utf8');
const daily=fs.readFileSync(path.join(repo,'js','daily.js'),'utf8');
const claim=fs.readFileSync(path.join(repo,'functions','daily-official-claim.js'),'utf8');
assert(checkin.includes('function sendOfficialRosterSetup(actorId,status)')&&checkin.includes("type:'official-roster-setup'"),
  '임원 화면에 일괄 명부 전송기가 있어야 합니다.');
assert(checkin.includes('toggleOfficialRosterSetupAll')&&checkin.includes('official-roster-setup-check'),
  '명부 시트에 다중 선택과 전체 선택이 있어야 합니다.');
assert(checkin.includes('function sessionSetupEligible()'),
  '도착 전 임원이 운영 준비에 진입하는 조건을 화면에 명시해야 합니다.');
assert(checkin.includes('명부 불러오기')&&checkin.includes('현장 참가 등록'),
  '운영 준비에서 명부 불러오기와 현장 참가 액션이 보여야 합니다.');
assert(daily.includes('officialRosterSetupV1:!!_dailyOfficialInviteHash'),
  '관리자 게시 페이로드에 일괄 명부 능력 표시가 있어야 합니다.');
assert(claim.includes('officialRosterSetupV1 = true'),
  '기존 상시 링크도 임원 연결 때 새 능력 표시를 받아야 관리자 재게시를 기다리지 않습니다.');
assert(daily.includes("if(req.type==='official-roster-setup'){"),
  '관리자 추종자가 서버의 일괄 명부 결과를 적용해야 합니다.');
console.log('  배선: 운영 준비 → 다중 선택 → 서버 명령 → 관리자 추종');

console.log('\ndaily official roster setup regression ok');
