'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  applyOfficialRequest,
  canonicalJson,
  issueOfficialGrant
} = require('../functions/daily-official-engine');
const {applyCommandTransaction} = require('../functions/daily-official-command');

const BASE_NOW = 1_830_000_000_000;
const CHECKIN_ID = 'DINTER22';
const OFFICIAL_CLIENT_ID = 'official_interaction_client_12345';
const MANAGER_CLIENT_ID = 'manager_interaction_client_12345';
const SECRET = 'daily-live-admin-official-interaction-secret';
const INVITE_HASH = 'b'.repeat(64);

const OFFICIAL_GRANT = issueOfficialGrant({
  v:1,sid:CHECKIN_ID,cid:OFFICIAL_CLIENT_ID,pid:'official',
  iat:BASE_NOW-1000,exp:BASE_NOW+48*60*60_000
}, SECRET);
const MANAGER_GRANT = issueOfficialGrant({
  v:1,sid:CHECKIN_ID,cid:MANAGER_CLIENT_ID,pid:'official',
  iat:BASE_NOW-1000,exp:BASE_NOW+48*60*60_000
}, SECRET);

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function hash(value){
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function player(index){
  const id = `p${index}`;
  const status = index <= 12 ? 'playing' : index <= 24 ? 'wait' : 'invited';
  const levels = [5,4,3,4,5,3];
  return {
    id,
    name:`선수${String(index).padStart(2,'0')}`,
    level:levels[(index-1)%levels.length],
    grade:'C',
    gender:index%2 ? 'M' : 'F',
    ageGroup:'40대',
    status,
    statusLabel:status,
    locked:status === 'playing',
    currentMatchId:index <= 12 ? `m${Math.ceil(index/4)}` : '',
    afterMatchStatus:'',
    games:0,
    fairExpected:0,
    mixedGames:0,
    typeTrackedGames:0,
    lastPlayedSeq:0,
    partnerCount:{},
    opponentCount:{},
    joinedAt:BASE_NOW-30*60_000,
    waitFrom:BASE_NOW-(45-index)*60_000,
    lastStatusAt:BASE_NOW-1000,
    isClubOfficial:false
  };
}

function active(id, court, ids){
  return {
    id,court,seq:court,type:'혼복',teamMode:false,
    startedAt:BASE_NOW-10*60_000,
    expectedMinutes:15,
    endAt:BASE_NOW+5*60_000,
    t1Ids:ids.slice(0,2),
    t2Ids:ids.slice(2),
    playerIds:[...ids],
    t1:ids.slice(0,2),
    t2:ids.slice(2)
  };
}

function root(){
  const players = [
    {
      id:'official',name:'운영임원',level:4,gender:'M',ageGroup:'40대',
      status:'rest',statusLabel:'rest',locked:false,currentMatchId:'',afterMatchStatus:'',
      games:0,fairExpected:0,mixedGames:0,typeTrackedGames:0,lastPlayedSeq:0,
      partnerCount:{},opponentCount:{},joinedAt:BASE_NOW-60*60_000,
      waitFrom:BASE_NOW,lastStatusAt:BASE_NOW-1000,isClubOfficial:true
    },
    ...Array.from({length:30},(_,index)=>player(index+1))
  ];
  return {
    session:{
      serverSessionId:CHECKIN_ID,
      commandProtocol:2,
      serverRevision:0,
      serverLastRequestId:'',
      matchStartedAt:BASE_NOW-30*60_000,
      expiresAt:BASE_NOW+48*60*60_000,
      officialInvite:{tokenHash:INVITE_HASH,expiresAt:BASE_NOW+48*60*60_000},
      capabilities:{officialOpsServerV2:true,officialAutoHandoffV1:true},
      players,
      reservations:[],
      arrivalCandidates:[],
      serverRuntime:{holds:{},nextSeq:4,fourCounts:{},exactCounts:{}},
      event:{
        courts:3,
        nextTarget:3,
        serverExpectedGoal:0,
        completed:0,
        finishMode:false,
        operationStarted:true,
        queuePolicy:{official:3,auto:true},
        active:[
          active('m1',1,['p1','p2','p3','p4']),
          active('m2',2,['p5','p6','p7','p8']),
          active('m3',3,['p9','p10','p11','p12'])
        ],
        next:[],
        expected:[],
        serverStandby:[]
      }
    },
    requests:{},
    serverCommands:{},
    serverOps:{},
    officialClaims:{
      [OFFICIAL_CLIENT_ID]:{
        clientId:OFFICIAL_CLIENT_ID,
        expiresAt:BASE_NOW+48*60*60_000,
        claimMode:'roster',
        officialPlayerId:'official'
      }
    }
  };
}

function submitOfficial(current, command, now){
  const stored = {
    actorPlayerId:'official',
    actorPlayerName:'운영임원',
    createdAt:now,
    expiresAt:now+30*60_000,
    source:'club-official-support',
    ...command
  };
  const outcome = applyCommandTransaction(current, {
    storedCommand:stored,
    engineCommand:{...stored,officialGrantToken:OFFICIAL_GRANT},
    operationId:stored.operationId,
    payloadHash:hash(stored),
    clientId:OFFICIAL_CLIENT_ID,
    grantPlayerId:'official',
    now,
    checkinId:CHECKIN_ID,
    grantSecret:SECRET
  });
  assert.strictEqual(outcome.action,'commit',`${stored.operationId} 트랜잭션이 저장되어야 합니다.`);
  assert.strictEqual(outcome.terminal.status,'applied',`${stored.operationId} 임원 처리가 적용되어야 합니다.`);
  return outcome.current;
}

function managerSnapshot(current){
  return {
    baseRevision:Number(current.session.serverRevision||0),
    baseLastRequestId:String(current.session.serverLastRequestId||''),
    session:clone(current.session)
  };
}

function managerComplete(snapshot, matchId, now){
  const match = snapshot.session.event.active.find(item=>item.id===matchId);
  assert(match,`관리자 화면에서 ${matchId} 진행 경기를 찾을 수 있어야 합니다.`);
  const requestId=`manager_complete_${matchId}_${now}`;
  const result = applyOfficialRequest(snapshot.session, {
    type:'official-court-complete',
    operationId:requestId,
    token:`token_${requestId}`,
    actorPlayerId:'official',
    actorPlayerName:'시스템관리자',
    createdAt:now,
    expiresAt:now+30*60_000,
    matchId:match.id,
    court:match.court,
    expectedStartedAt:match.startedAt,
    expectedPlayerIds:[...match.playerIds],
    officialGrantToken:MANAGER_GRANT
  }, {
    now,
    requestId,
    checkinId:CHECKIN_ID,
    grantSecret:SECRET,
    serverOps:{}
  });
  assert.strictEqual(result.status,'applied',`${matchId} 관리자 경기 종료가 로컬 원본에 적용되어야 합니다.`);
  snapshot.session=result.session;
  snapshot.session.serverRevision=snapshot.baseRevision;
  snapshot.session.serverLastRequestId=snapshot.baseLastRequestId;
  return snapshot;
}

function managerPublish(current, snapshot){
  const currentRevision=Number(current.session.serverRevision||0);
  const currentLastRequestId=String(current.session.serverLastRequestId||'');
  if(
    currentRevision!==snapshot.baseRevision
    ||currentLastRequestId!==snapshot.baseLastRequestId
  )return {committed:false,current};
  const next={...current,session:clone(snapshot.session),updatedAt:BASE_NOW};
  next.session.serverRevision=currentRevision;
  next.session.serverLastRequestId=currentLastRequestId;
  return {committed:true,current:next};
}

function assertOperationalInvariants(session){
  assert.strictEqual(session.event.active.length,3,'운영 가능 인원이 충분하면 세 코트가 계속 진행되어야 합니다.');
  assert(session.event.next.length<=3,'다음 대진은 코트 수보다 많으면 안 됩니다.');
  const activeIds=session.event.active.flatMap(match=>match.playerIds||[]);
  const nextIds=session.event.next.flatMap(match=>match.playerIds||[]);
  assert.strictEqual(new Set(activeIds).size,activeIds.length,'한 선수가 두 진행 경기에 중복되면 안 됩니다.');
  assert.strictEqual(new Set(nextIds).size,nextIds.length,'한 선수가 두 다음 대진에 중복되면 안 됩니다.');
  assert(!nextIds.some(id=>activeIds.includes(id)),'진행 선수와 다음 대진 선수가 겹치면 안 됩니다.');
  session.event.next.forEach(item=>{
    assert.strictEqual((item.playerIds||[]).length,4,'다음 대진은 네 명을 유지해야 합니다.');
  });
}

let state=root();

const staleBeforeArrival=managerComplete(managerSnapshot(state),'m1',BASE_NOW+60_000);
state=submitOfficial(state,{
  type:'official-player-arrival',
  operationId:'interaction_arrival_001',
  playerId:'p25',
  status:'wait',
  expectedStatus:'invited',
  expectedLastStatusAt:BASE_NOW-1000
},BASE_NOW+30_000);
assert.strictEqual(state.session.players.find(item=>item.id==='p25').status,'wait','임원이 지각 선수를 즉시 참가 처리해야 합니다.');
assert.strictEqual(state.session.players.find(item=>item.id==='p25').joinedAt,BASE_NOW+30_000,'지각 도착 시각을 실제 처리 시각으로 기록해야 합니다.');
let publish=managerPublish(state,staleBeforeArrival);
assert.strictEqual(publish.committed,false,'지각 등록 전 관리자 화면이 최신 임원 상태를 덮어쓰면 안 됩니다.');
assert(state.session.event.active.some(match=>match.id==='m1'),'거절된 오래된 관리자 게시가 실제 진행 경기를 끝내면 안 됩니다.');

let manager=managerComplete(managerSnapshot(state),'m1',BASE_NOW+60_000);
publish=managerPublish(state,manager);
assert.strictEqual(publish.committed,true,'지각 등록을 동기화한 관리자 경기 종료는 게시되어야 합니다.');
state=publish.current;
assert.strictEqual(state.session.serverRevision,1,'관리자 게시가 임원 서버 리비전을 임의로 올리거나 내리면 안 됩니다.');
assert.strictEqual(state.session.serverLastRequestId,'interaction_arrival_001','관리자 게시가 최근 임원 명령 식별자를 보존해야 합니다.');
assertOperationalInvariants(state.session);

const pairQueue=state.session.event.next[0];
assert(pairQueue,'파트너 지정에 사용할 다음 대진이 있어야 합니다.');
const pairIds=[...pairQueue.t1Ids];
const staleBeforePartner=managerComplete(managerSnapshot(state),'m2',BASE_NOW+2*60_000);
state=submitOfficial(state,{
  type:'official-partner-reservation',
  operationId:'interaction_partner_001',
  playerIds:pairIds,
  playerNames:pairIds.map(id=>state.session.players.find(player=>player.id===id)?.name||id)
},BASE_NOW+90_000);
const reservation=state.session.reservations.find(item=>item.id==='sr_interaction_partner_001');
assert(reservation,'임원이 지정한 같은 편 요청이 서버 명단에 남아야 합니다.');
const reservedQueue=state.session.event.next.find(item=>item.reservationId===reservation.id);
assert(reservedQueue,'파트너 지정이 실제 다음 대진에 연결되어야 합니다.');
assert(
  pairIds.every(id=>reservedQueue.t1Ids.includes(id))||pairIds.every(id=>reservedQueue.t2Ids.includes(id)),
  '파트너 지정 두 명은 반드시 같은 편이어야 합니다.'
);
publish=managerPublish(state,staleBeforePartner);
assert.strictEqual(publish.committed,false,'파트너 지정 전 관리자 화면이 예약과 표시를 덮어쓰면 안 됩니다.');

manager=managerComplete(managerSnapshot(state),'m2',BASE_NOW+2*60_000);
publish=managerPublish(state,manager);
assert.strictEqual(publish.committed,true,'파트너 지정을 동기화한 관리자 경기 종료는 게시되어야 합니다.');
state=publish.current;
assert.strictEqual(state.session.serverRevision,2,'파트너 지정 뒤 관리자 게시도 서버 리비전을 보존해야 합니다.');
const activePartner=state.session.event.active.find(match=>match.reservationId===reservation.id);
const queuedPartner=state.session.event.next.find(item=>item.reservationId===reservation.id);
assert(activePartner||queuedPartner,'관리자 경기 종료 뒤에도 파트너 지정 대진과 표시가 유지되어야 합니다.');
assertOperationalInvariants(state.session);

const leavingQueue=state.session.event.next.find(item=>item.reservationId!==reservation.id)||state.session.event.next[0];
const leavingId=leavingQueue.playerIds.find(id=>!pairIds.includes(id));
const leavingPlayer=state.session.players.find(item=>item.id===leavingId);
state=submitOfficial(state,{
  type:'official-player-status',
  operationId:'interaction_early_leave_wait_001',
  playerId:leavingPlayer.id,
  playerName:leavingPlayer.name,
  status:'done',
  expectedStatus:leavingPlayer.status,
  expectedCurrentMatchId:leavingPlayer.currentMatchId||'',
  expectedLastStatusAt:leavingPlayer.lastStatusAt
},BASE_NOW+3*60_000);
assert.strictEqual(state.session.players.find(item=>item.id===leavingId).status,'done','대기 중 조기 귀가 선수를 즉시 종료 처리해야 합니다.');
assert(!state.session.event.next.some(item=>item.playerIds.includes(leavingId)),'조기 귀가 선수가 다음 대진에 남으면 안 됩니다.');
assertOperationalInvariants(state.session);

const activeForLeave=state.session.event.active.find(match=>!match.playerIds.some(id=>pairIds.includes(id)))||state.session.event.active[0];
const activeLeavingId=activeForLeave.playerIds[0];
const activeLeaving=state.session.players.find(item=>item.id===activeLeavingId);
const staleBeforeActiveLeave=managerComplete(managerSnapshot(state),activeForLeave.id,BASE_NOW+4*60_000);
state=submitOfficial(state,{
  type:'official-player-status',
  operationId:'interaction_early_leave_active_001',
  playerId:activeLeaving.id,
  playerName:activeLeaving.name,
  status:'done',
  expectedStatus:'playing',
  expectedCurrentMatchId:activeForLeave.id,
  expectedLastStatusAt:activeLeaving.lastStatusAt
},BASE_NOW+3*60_000+30_000);
const deferredLeaving=state.session.players.find(item=>item.id===activeLeavingId);
assert.strictEqual(deferredLeaving.status,'playing','경기 중 조기 귀가는 현재 경기를 중단하면 안 됩니다.');
assert.strictEqual(deferredLeaving.afterMatchStatus,'done','경기 중 조기 귀가는 경기 후 종료로 예약되어야 합니다.');
publish=managerPublish(state,staleBeforeActiveLeave);
assert.strictEqual(publish.committed,false,'경기 후 종료 표시 전 관리자 화면이 임원 상태를 덮어쓰면 안 됩니다.');

manager=managerComplete(managerSnapshot(state),activeForLeave.id,BASE_NOW+4*60_000);
publish=managerPublish(state,manager);
assert.strictEqual(publish.committed,true,'경기 후 종료를 동기화한 관리자 경기 종료는 게시되어야 합니다.');
state=publish.current;
const completedLeaving=state.session.players.find(item=>item.id===activeLeavingId);
assert.strictEqual(completedLeaving.status,'done','해당 경기 종료 시 조기 귀가 선수가 자동으로 종료 상태가 되어야 합니다.');
assert.strictEqual(completedLeaving.afterMatchStatus,'','경기 종료 뒤 예약 상태를 남기면 안 됩니다.');
assert(!state.session.event.next.some(item=>item.playerIds.includes(activeLeavingId)),'종료된 선수가 새 다음 대진에 다시 들어가면 안 됩니다.');
assert.strictEqual(state.session.serverRevision,4,'두 조기 종료 임원 처리 뒤에도 관리자 게시가 최신 리비전을 보존해야 합니다.');
assert.strictEqual(state.session.serverLastRequestId,'interaction_early_leave_active_001','최종 관리자 게시가 최신 임원 명령 식별자를 보존해야 합니다.');
assertOperationalInvariants(state.session);

const processedCommands=[
  'interaction_arrival_001',
  'interaction_partner_001',
  'interaction_early_leave_wait_001',
  'interaction_early_leave_active_001'
];
assert.deepStrictEqual(
  processedCommands.map(id=>state.serverCommands[id]?.status),
  ['applied','applied','applied','applied'],
  '지각·파트너 지정·조기 종료 임원 명령이 모두 한 번씩만 적용되어야 합니다.'
);

console.log('daily live admin-official interaction regression ok');
