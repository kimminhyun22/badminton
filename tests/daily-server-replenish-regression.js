'use strict';

const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const {
  canonicalJson,
  issueOfficialGrant
} = require('../functions/daily-official-engine');
const {
  TEAM_DIFF_LIMIT,
  PARTNER_GAP_HARD,
  effectiveLevel
} = require('../functions/daily-server-matchmaker');
const {applyCommandTransaction} = require('../functions/daily-official-command');

const BASE_NOW = 1_820_000_000_000;
const CHECKIN_ID = 'DROLL222';
const CLIENT_ID = 'official_replenish_client_12345';
const SECRET = 'daily-server-replenish-regression-secret';
const GRANT = issueOfficialGrant({
  v:1,sid:CHECKIN_ID,cid:CLIENT_ID,pid:'official',
  iat:BASE_NOW-1000,exp:BASE_NOW+48*60*60_000
}, SECRET);

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
      games:0,mixedGames:0,typeTrackedGames:0,lastPlayedSeq:0,
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
      matchStartedAt:BASE_NOW-30*60_000,
      expiresAt:BASE_NOW+48*60*60_000,
      officialInvite:{tokenHash:'a'.repeat(64),expiresAt:BASE_NOW+48*60*60_000},
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
    officialClaims:{
      [CLIENT_ID]:{
        clientId:CLIENT_ID,
        expiresAt:BASE_NOW+48*60*60_000,
        claimMode:'roster',
        officialPlayerId:'official'
      }
    }
  };
}

function submit(current, command, now){
  const stored = {
    actorPlayerId:'official',
    actorPlayerName:'운영임원',
    createdAt:now,
    expiresAt:now+30*60_000,
    source:'club-official-support',
    ...command
  };
  return {
    stored,
    outcome:applyCommandTransaction(current, {
      storedCommand:stored,
      engineCommand:{...stored,officialGrantToken:GRANT},
      operationId:stored.operationId,
      payloadHash:hash(stored),
      clientId:CLIENT_ID,
      grantPlayerId:'official',
      now,
      checkinId:CHECKIN_ID,
      grantSecret:SECRET
    })
  };
}

function complete(current, match, index, now){
  return submit(current, {
    type:'official-court-complete',
    operationId:`rolling_complete_${String(index).padStart(4,'0')}`,
    token:`rolling_token_${String(index).padStart(4,'0')}`,
    matchId:match.id,
    court:match.court,
    expectedStartedAt:match.startedAt,
    expectedPlayerIds:[...match.playerIds]
  }, now);
}

function assertPreparedValid(session){
  const occupied = new Set();
  session.event.active.forEach(match=>match.playerIds.forEach(id=>{
    assert(!occupied.has(id),'진행 경기 사이에 같은 선수가 중복되면 안 됩니다.');
    occupied.add(id);
  }));
  session.event.next.forEach(item=>{
    assert.strictEqual(item.playerIds.length,4,'새 다음 대진은 정확히 네 명이어야 합니다.');
    assert.strictEqual(new Set(item.playerIds).size,4,'한 대진 안에 같은 선수가 중복되면 안 됩니다.');
    item.playerIds.forEach(id=>{
      assert(!occupied.has(id),'진행 경기와 다음 대진에 같은 선수가 겹치면 안 됩니다.');
      occupied.add(id);
    });
    const first=item.t1Ids.map(id=>session.players.find(player=>player.id===id));
    const second=item.t2Ids.map(id=>session.players.find(player=>player.id===id));
    const diff=Math.abs(first.reduce((sum,row)=>sum+effectiveLevel(row),0)-second.reduce((sum,row)=>sum+effectiveLevel(row),0));
    assert(diff<=TEAM_DIFF_LIMIT,'서버 보충 대진의 팀 실력차가 허용 범위를 넘으면 안 됩니다.');
    assert(Math.abs(effectiveLevel(first[0])-effectiveLevel(first[1]))<PARTNER_GAP_HARD,'첫 팀 파트너 실력차가 너무 크면 안 됩니다.');
    assert(Math.abs(effectiveLevel(second[0])-effectiveLevel(second[1]))<PARTNER_GAP_HARD,'둘째 팀 파트너 실력차가 너무 크면 안 됩니다.');
  });
}

function operationalEvent(event){
  return {
    completed:event.completed,
    finishMode:!!event.finishMode,
    nextTarget:event.nextTarget,
    active:event.active.map(match=>({
      id:match.id,court:match.court,seq:match.seq,startedAt:match.startedAt,
      t1Ids:[...match.t1Ids],t2Ids:[...match.t2Ids]
    })),
    next:event.next.map(item=>({
      id:item.queueId||item.id,
      t1Ids:[...item.t1Ids],
      t2Ids:[...item.t2Ids],
      reservationId:item.reservationId||null
    })),
    expected:event.expected.map(item=>item.queueId||item.id),
    serverStandby:event.serverStandby.map(item=>item.queueId||item.id)
  };
}

let state = root();
let now = BASE_NOW;

const first = complete(state,state.session.event.active[0],1,now);
assert.strictEqual(first.outcome.terminal.status,'applied','예비 대진이 비어 있어도 서버가 종료 요청을 처리해야 합니다.');
state = first.outcome.current;
assert.strictEqual(state.session.event.active.length,3,'종료한 코트에는 서버가 만든 새 대진이 즉시 들어가야 합니다.');
assert(state.session.event.next.length>=2,'관리자 앱이 없어도 다음 대진을 계속 보충해야 합니다.');
assert(state.requests.rolling_complete_0001.serverResult.queueSync.next.length===state.session.event.next.length,'관리자 재접속용 다음 대진 동기화본을 남겨야 합니다.');
assertPreparedValid(state.session);

const duplicate = applyCommandTransaction(state, {
  storedCommand:first.stored,
  engineCommand:{...first.stored,officialGrantToken:GRANT},
  operationId:first.stored.operationId,
  payloadHash:hash(first.stored),
  clientId:CLIENT_ID,
  grantPlayerId:'official',
  now,
  checkinId:CHECKIN_ID,
  grantSecret:SECRET
});
assert.strictEqual(duplicate.action,'duplicate','같은 종료 요청 재전송은 새 경기를 한 번 더 만들면 안 됩니다.');
assert.strictEqual(duplicate.terminal.resultRevision,state.session.serverRevision,'중복 응답은 최초 처리 리비전을 그대로 돌려줘야 합니다.');

const restPassBase=JSON.parse(JSON.stringify(state));
const restPassQueue=restPassBase.session.event.next[0];
restPassQueue.restPass={playerId:restPassQueue.playerIds[0],playerName:'잠시자리비움',createdAt:now};
restPassQueue.restPassText='잠시자리비움님이 조금 쉬고 입장';
const restPassLate=restPassBase.session.players.find(row=>row.id==='p25');
const restPassResult=submit(restPassBase,{
  type:'official-player-arrival',
  operationId:'rolling_rest_pass_sync',
  playerId:restPassLate.id,
  status:'wait',
  expectedStatus:'invited',
  expectedLastStatusAt:restPassLate.lastStatusAt
},now+1000);
assert.strictEqual(restPassResult.outcome.terminal.status,'applied','잠시 자리 비움 대진이 있어도 임원 운영은 계속 처리되어야 합니다.');
const restPassSync=restPassResult.outcome.current.requests.rolling_rest_pass_sync.serverResult.queueSync.next
  .find(item=>item.queueId===restPassQueue.queueId);
assert.deepStrictEqual(restPassSync.restPass,restPassQueue.restPass,'관리자 재접속용 대진 동기화에서 잠시 쉬기 상태와 시각이 유지되어야 합니다.');

for(let index=2;index<=30;index++){
  now += 15*60_000;
  if(index>=2&&index<=7){
    const late=state.session.players.find(row=>row.id===`p${23+index}`);
    const arrival=submit(state,{
      type:'official-player-arrival',
      operationId:`rolling_arrival_${index}`,
      playerId:late.id,
      status:'wait',
      expectedStatus:'invited',
      expectedLastStatusAt:late.lastStatusAt
    },now-1000);
    assert.strictEqual(arrival.outcome.terminal.status,'applied','지각 선수는 서버 운영 중에도 즉시 참가 처리되어야 합니다.');
    state=arrival.outcome.current;
  }
  if(index>=12&&index<=17){
    const leaving=state.session.players
      .filter(row=>row.id!=='official'&&row.status==='wait'&&!row.currentMatchId)
      .sort((a,b)=>b.games-a.games||a.id.localeCompare(b.id))[0];
    assert(leaving,'조기 귀가 처리할 대기 선수가 있어야 합니다.');
    const done=submit(state,{
      type:'official-player-status',
      operationId:`rolling_done_${index}`,
      playerId:leaving.id,
      status:'done',
      expectedLastStatusAt:leaving.lastStatusAt
    },now-500);
    assert.strictEqual(done.outcome.terminal.status,'applied','조기 귀가는 관리자 앱 없이 즉시 대진에서 빠져야 합니다.');
    state=done.outcome.current;
    assert(!state.session.event.next.some(item=>item.playerIds.includes(leaving.id)),'귀가 선수가 보충 대진에 남으면 안 됩니다.');
  }
  const match=state.session.event.active.slice().sort((a,b)=>a.startedAt-b.startedAt||a.court-b.court)[0];
  assert(match,'운영 중인 코트가 끊기면 안 됩니다.');
  const completed=complete(state,match,index,now);
  assert.strictEqual(completed.outcome.terminal.status,'applied',`${index}번째 종료도 서버에서 이어져야 합니다.`);
  state=completed.outcome.current;
  assert.strictEqual(state.session.event.active.length,3,'운영 가능 인원이 충분한 동안 세 코트가 계속 채워져야 합니다.');
  assertPreparedValid(state.session);
}

const activePlayers=new Set(state.session.event.active.flatMap(match=>match.playerIds));
const participants=state.session.players.filter(row=>row.id!=='official'&&!['invited','done'].includes(row.status));
const completedGames=participants.map(row=>row.games+(activePlayers.has(row.id)?1:0));
const regularGames=participants
  .filter(row=>row.joinedAt<=BASE_NOW)
  .map(row=>row.games+(activePlayers.has(row.id)?1:0));
const lateGames=participants
  .filter(row=>row.joinedAt>BASE_NOW)
  .map(row=>row.games+(activePlayers.has(row.id)?1:0));
assert(
  Math.max(...regularGames)-Math.min(...regularGames)<=2,
  `같은 시간 동안 참가한 선수의 출전 횟수 차이는 두 경기 이하여야 합니다. ${JSON.stringify(regularGames)}`
);
assert(Math.max(...completedGames)-Math.min(...completedGames)<=3,'지각자를 포함해도 출전 격차가 과도하게 벌어지면 안 됩니다.');
assert(lateGames.length===6&&Math.min(...lateGames)>=3,'순차 도착한 지각자도 남은 시간에 최소 세 경기 기회를 받아야 합니다.');
assert(Object.keys(state.session.serverRuntime.fourCounts).length>5,'같은 네 명 반복 회피용 서버 이력이 누적되어야 합니다.');
assert(Object.keys(state.session.serverRuntime.exactCounts).length>5,'동일 팀 대결 반복 회피용 서버 이력이 누적되어야 합니다.');

const reservationBase=root();
reservationBase.session.event.next=[];
const pairIds=['p13','p14'];
const reserved=submit(reservationBase,{
  type:'official-partner-reservation',
  operationId:'rolling_partner_0001',
  playerIds:pairIds
},BASE_NOW+1000);
assert.strictEqual(reserved.outcome.terminal.status,'applied','임원 파트너 접수도 서버 보충 엔진에 연결되어야 합니다.');
const pairQueue=reserved.outcome.current.session.event.next.find(item=>item.reservationId==='sr_rolling_partner_0001');
assert(pairQueue,'접수한 파트너를 서버가 다음 대진에 편성해야 합니다.');
assert(pairIds.every(id=>pairQueue.t1Ids.includes(id))||pairIds.every(id=>pairQueue.t2Ids.includes(id)),'접수한 두 선수는 같은 편이어야 합니다.');

const undoBase=JSON.parse(JSON.stringify(state));
const undoMatch=state.session.event.active[0];
now+=15*60_000;
const undoComplete=complete(state,undoMatch,31,now);
assert.strictEqual(undoComplete.outcome.terminal.status,'applied','되돌리기 전 종료가 적용되어야 합니다.');
const undone=submit(undoComplete.outcome.current,{
  type:'official-operation-undo',
  operationId:'rolling_undo_0031',
  token:'rolling_token_0031'
},now+10_000);
assert.strictEqual(undone.outcome.terminal.status,'applied','서버가 보충한 대진까지 종료 작업과 함께 되돌릴 수 있어야 합니다.');
assert.deepStrictEqual(operationalEvent(undone.outcome.current.session.event),operationalEvent(undoBase.session.event),'되돌리면 진행·다음 대진 순서가 종료 직전과 같아야 합니다.');
assert.deepStrictEqual(undone.outcome.current.session.players,undoBase.session.players,'되돌리면 선수 경기 수와 상태도 종료 직전과 같아야 합니다.');
assert.deepStrictEqual(undone.outcome.current.session.serverRuntime,undoBase.session.serverRuntime,'되돌리면 서버 반복 이력과 코트 상태도 종료 직전과 같아야 합니다.');

const finish=root();
finish.session.event.finishMode=true;
finish.session.event.next=[];
const finishResult=complete(finish,finish.session.event.active[0],40,BASE_NOW+40*60_000);
assert.strictEqual(finishResult.outcome.terminal.status,'applied','마무리 중에도 현재 경기 종료는 처리되어야 합니다.');
assert.strictEqual(finishResult.outcome.current.session.event.next.length,0,'마무리 모드에서는 서버가 새 대진을 만들면 안 됩니다.');
assert.strictEqual(finishResult.outcome.current.session.event.active.length,2,'마무리 모드의 빈 코트는 새 경기로 다시 채우면 안 됩니다.');

const beforeStart=root();
beforeStart.session.event.operationStarted=false;
beforeStart.session.event.queuePolicy.auto=false;
beforeStart.session.event.queuePolicy.official=0;
const beforeStartPlayer=beforeStart.session.players.find(row=>row.id==='p25');
const beforeStartArrival=submit(beforeStart,{
  type:'official-player-arrival',
  operationId:'rolling_before_start',
  playerId:beforeStartPlayer.id,
  status:'wait',
  expectedStatus:'invited',
  expectedLastStatusAt:beforeStartPlayer.lastStatusAt
},BASE_NOW+1000);
assert.strictEqual(beforeStartArrival.outcome.terminal.status,'applied','운영 시작 전 지각 선수 등록 자체는 처리할 수 있어야 합니다.');
assert.strictEqual(beforeStartArrival.outcome.current.session.event.next.length,0,'운영 시작 전에는 서버가 대진을 미리 생성하면 안 됩니다.');

const dailySource=fs.readFileSync(require.resolve('../js/daily.js'),'utf8');
assert(dailySource.includes('function _dailyApplyServerQueueSync(req)'),'관리자 재실행 시 서버 생성 대진을 복원하는 동기화 함수가 있어야 합니다.');
assert(dailySource.includes('partnerCountById:{...history.partnerCountById}')&&dailySource.includes('opponentCountById:{...history.opponentCountById}'),'서버 대진 다양성 판단에 기존 파트너·상대 이력을 안전한 선수 ID로 게시해야 합니다.');
assert(dailySource.includes('fourCounts')&&dailySource.includes('exactCounts'),'같은 네 명과 동일 팀 반복 이력을 서버에 게시해야 합니다.');
assert(dailySource.includes('dailySave({preserveServerQueue:serverQueueSynced})'),'서버 대진을 복원한 직후 브라우저가 다시 생성해 순서를 바꾸면 안 됩니다.');
assert(dailySource.includes("restPass:item?.restPass&&typeof item.restPass==='object'"),'서버 대진 복원 시 잠시 쉬기 상태를 함께 복원해야 합니다.');

console.log('daily server replenish regression ok');
