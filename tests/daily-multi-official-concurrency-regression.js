'use strict';

const assert=require('assert');
const crypto=require('crypto');
const {
  canonicalJson,
  issueOfficialGrant
}=require('../functions/daily-official-engine');
const {applyCommandTransaction}=require('../functions/daily-official-command');

const NOW=1_840_000_000_000;
const CHECKIN_ID='DMULTI22';
const SECRET='daily-multi-official-concurrency-secret';
const INVITE_HASH='c'.repeat(64);
const OFFICIALS=[
  {id:'official-a',name:'임원A',clientId:'official_client_a_12345'},
  {id:'official-b',name:'임원B',clientId:'official_client_b_12345'},
  {id:'official-c',name:'임원C',clientId:'official_client_c_12345'},
  {id:'official-d',name:'임원D',clientId:'official_client_d_12345'}
].map(row=>({
  ...row,
  grant:issueOfficialGrant({
    v:1,sid:CHECKIN_ID,cid:row.clientId,pid:row.id,
    iat:NOW-1000,exp:NOW+48*60*60_000
  },SECRET)
}));

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function hash(value){
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function player(index){
  const playing=index<=12;
  const levels=[6,5,4,3,5,4];
  return {
    id:`p${index}`,name:`선수${String(index).padStart(2,'0')}`,
    level:levels[(index-1)%levels.length],grade:'C',
    gender:index%2?'M':'F',ageGroup:'40대',
    status:playing?'playing':'wait',statusLabel:playing?'playing':'wait',
    locked:playing,currentMatchId:playing?`m${Math.ceil(index/4)}`:'',
    afterMatchStatus:'',games:0,fairExpected:0,mixedGames:0,typeTrackedGames:0,
    lastPlayedSeq:0,partnerCount:{},opponentCount:{},
    joinedAt:NOW-60*60_000,waitFrom:NOW-(60-index)*60_000,
    lastStatusAt:NOW-1000,isClubOfficial:false
  };
}

function active(id,court,ids){
  return {
    id,court,seq:court,type:'혼복',teamMode:false,
    startedAt:NOW-10*60_000,expectedMinutes:15,endAt:NOW+5*60_000,
    t1Ids:ids.slice(0,2),t2Ids:ids.slice(2),playerIds:[...ids],
    t1:ids.slice(0,2),t2:ids.slice(2)
  };
}

function root(){
  const officialPlayers=OFFICIALS.map(row=>({
    id:row.id,name:row.name,level:4,grade:'C',gender:'M',ageGroup:'40대',
    status:'rest',statusLabel:'rest',locked:false,currentMatchId:'',afterMatchStatus:'',
    games:0,fairExpected:0,mixedGames:0,typeTrackedGames:0,lastPlayedSeq:0,
    partnerCount:{},opponentCount:{},joinedAt:NOW-60*60_000,waitFrom:NOW,
    lastStatusAt:NOW-1000,isClubOfficial:true
  }));
  return {
    session:{
      serverSessionId:CHECKIN_ID,commandProtocol:2,serverRevision:0,serverLastRequestId:'',
      matchStartedAt:NOW-30*60_000,expiresAt:NOW+48*60*60_000,
      officialInvite:{tokenHash:INVITE_HASH,expiresAt:NOW+48*60*60_000},
      capabilities:{officialOpsServerV2:true,officialAutoHandoffV1:true,officialOperationUndoV1:true},
      players:[...officialPlayers,...Array.from({length:32},(_,index)=>player(index+1))],
      reservations:[],arrivalCandidates:[],
      serverRuntime:{holds:{},nextSeq:4,fourCounts:{},exactCounts:{}},
      event:{
        courts:3,nextTarget:3,serverExpectedGoal:0,completed:0,
        finishMode:false,operationStarted:true,queuePolicy:{official:3,auto:true},
        active:[
          active('m1',1,['p1','p2','p3','p4']),
          active('m2',2,['p5','p6','p7','p8']),
          active('m3',3,['p9','p10','p11','p12'])
        ],
        next:[],expected:[],serverStandby:[]
      }
    },
    requests:{},serverCommands:{},serverOps:{},
    officialClaims:Object.fromEntries(OFFICIALS.map(row=>[row.clientId,{
      clientId:row.clientId,expiresAt:NOW+48*60*60_000,
      inviteHash:INVITE_HASH,claimMode:'roster',officialPlayerId:row.id
    }]))
  };
}

function storedCommand(actor,command,now){
  return {
    actorPlayerId:actor.id,actorPlayerName:actor.name,
    createdAt:now,expiresAt:now+30*60_000,source:'club-official-support',
    ...command
  };
}

function submit(current,actor,command,now){
  const stored=storedCommand(actor,command,now);
  const outcome=applyCommandTransaction(clone(current),{
    storedCommand:stored,
    engineCommand:{...stored,officialGrantToken:actor.grant},
    operationId:stored.operationId,
    payloadHash:hash(stored),
    clientId:actor.clientId,
    grantPlayerId:actor.id,
    now,checkinId:CHECKIN_ID,grantSecret:SECRET
  });
  return {
    outcome,
    state:outcome.action==='commit'?outcome.current:current
  };
}

function completeCommand(snapshot,matchId,operationId,token){
  const match=snapshot.session.event.active.find(row=>row.id===matchId);
  assert(match,`${matchId} 진행 경기가 있어야 합니다.`);
  return {
    type:'official-court-complete',operationId,token,
    matchId:match.id,court:match.court,
    expectedStartedAt:match.startedAt,expectedPlayerIds:[...match.playerIds]
  };
}

function activeYieldCommand(snapshot,match,operationId,token){
  return {
    type:'official-active-yield',operationId,token,
    matchId:match.id,court:match.court,
    expectedStartedAt:match.startedAt,
    expectedAutoHandoffAt:match.autoHandoffAt,
    expectedPlayerIds:[...match.playerIds],
    expectedTeam1Ids:[...match.t1Ids],
    expectedTeam2Ids:[...match.t2Ids]
  };
}

function statusCommand(snapshot,playerId,status,operationId){
  const row=snapshot.session.players.find(player=>player.id===playerId);
  assert(row,`${playerId} 선수가 있어야 합니다.`);
  return {
    type:'official-player-status',operationId,
    playerId:row.id,playerName:row.name,status,
    expectedStatus:row.status,
    expectedCurrentMatchId:row.currentMatchId||'',
    expectedLastStatusAt:row.lastStatusAt
  };
}

function assertInvariants(session){
  const activeIds=session.event.active.flatMap(match=>match.playerIds||[]);
  const nextIds=session.event.next.flatMap(item=>item.playerIds||[]);
  assert.strictEqual(new Set(activeIds).size,activeIds.length,'진행 경기에서 한 선수가 중복되면 안 됩니다.');
  assert.strictEqual(new Set(nextIds).size,nextIds.length,'다음 대진에서 한 선수가 중복되면 안 됩니다.');
  assert(!nextIds.some(id=>activeIds.includes(id)),'진행 경기와 다음 대진에 같은 선수가 겹치면 안 됩니다.');
  assert(session.event.active.length<=session.event.courts,'진행 경기가 코트 수를 넘으면 안 됩니다.');
  assert(session.event.next.length<=session.event.courts,'다음 대진이 코트 수를 넘으면 안 됩니다.');
}

const orders=[
  [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]
];

orders.forEach((order,caseIndex)=>{
  let state=root();
  const snapshot=clone(state);
  const commands=['m1','m2','m3'].map((matchId,index)=>completeCommand(
    snapshot,matchId,`different_court_${caseIndex}_${index}`,`different_token_${caseIndex}_${index}`
  ));
  const terminals=[];
  order.forEach((commandIndex,index)=>{
    const result=submit(state,OFFICIALS[commandIndex],commands[commandIndex],NOW+1000+index);
    state=result.state;
    terminals.push(result.outcome.terminal?.status);
  });
  assert.deepStrictEqual(terminals,['applied','applied','applied'],'서로 다른 코트의 동시 종료는 처리 순서와 무관하게 모두 적용되어야 합니다.');
  assert.strictEqual(state.session.serverRevision,3,'서로 다른 세 코트 종료는 서버 리비전 세 건으로 직렬화되어야 합니다.');
  assert(['m1','m2','m3'].every(id=>!state.session.event.active.some(match=>match.id===id)),'종료한 원래 경기가 남으면 안 됩니다.');
  assert(Array.from({length:12},(_,index)=>state.session.players.find(row=>row.id===`p${index+1}`).games).every(games=>games===1),'원래 세 경기 선수는 정확히 한 경기만 증가해야 합니다.');
  assertInvariants(state.session);
});

for(const order of [[0,1],[1,0]]){
  let state=root();
  const snapshot=clone(state);
  const commands=[
    completeCommand(snapshot,'m1','same_court_a','same_court_token_a'),
    completeCommand(snapshot,'m1','same_court_b','same_court_token_b')
  ];
  const statuses=[];
  order.forEach((commandIndex,index)=>{
    const result=submit(state,OFFICIALS[commandIndex],commands[commandIndex],NOW+2000+index);
    state=result.state;
    statuses.push(result.outcome.terminal?.status);
  });
  assert.deepStrictEqual(statuses.sort(),['applied','rejected'],'같은 경기 동시 종료는 한 건만 적용되고 한 건은 현재 상태 불일치로 거절되어야 합니다.');
  assert.strictEqual(state.session.serverRevision,1,'같은 경기 종료를 두 번 눌러도 서버 상태는 한 번만 진행되어야 합니다.');
  assert(['p1','p2','p3','p4'].every(id=>state.session.players.find(row=>row.id===id).games===1),'같은 경기 선수의 게임 수가 두 번 증가하면 안 됩니다.');
  assertInvariants(state.session);
}

{
  let state=root();
  const command=completeCommand(state,'m1','duplicate_operation','duplicate_token');
  const first=submit(state,OFFICIALS[0],command,NOW+3000);
  state=first.state;
  const duplicate=submit(state,OFFICIALS[0],command,NOW+3000);
  assert.strictEqual(first.outcome.terminal?.status,'applied','첫 명령은 적용되어야 합니다.');
  assert.strictEqual(duplicate.outcome.action,'duplicate','네트워크 재전송된 같은 명령은 중복으로 식별되어야 합니다.');
  assert.strictEqual(duplicate.state.session.serverRevision,1,'같은 명령 재전송이 서버 상태를 한 번 더 진행하면 안 됩니다.');
}

for(const order of ['status-first','complete-first']){
  let state=root();
  const snapshot=clone(state);
  const status=statusCommand(snapshot,'p1','done',`status_complete_${order}`);
  const complete=completeCommand(snapshot,'m1',`complete_status_${order}`,`complete_status_token_${order}`);
  const commands=order==='status-first'
    ? [[OFFICIALS[0],status],[OFFICIALS[1],complete]]
    : [[OFFICIALS[1],complete],[OFFICIALS[0],status]];
  const terminals=[];
  commands.forEach(([actor,command],index)=>{
    const result=submit(state,actor,command,NOW+4000+index);
    state=result.state;
    terminals.push(result.outcome.terminal?.status);
  });
  const target=state.session.players.find(row=>row.id==='p1');
  assert.strictEqual(target.games,1,'경기 종료와 선수 상태 변경이 겹쳐도 게임 수는 한 번만 증가해야 합니다.');
  if(order==='status-first'){
    assert.deepStrictEqual(terminals,['applied','applied'],'경기 후 종료 표시가 먼저면 뒤이은 경기 종료까지 모두 적용되어야 합니다.');
    assert.strictEqual(target.status,'done','경기 후 종료 요청이 실제 종료 상태로 이어져야 합니다.');
  }else{
    assert.deepStrictEqual(terminals,['applied','rejected'],'경기 종료가 먼저면 오래된 선수 상태 요청은 다른 상태에 잘못 적용되지 않아야 합니다.');
  }
  assertInvariants(state.session);
}

for(const order of ['yield-first','complete-first']){
  let state=root();
  const initial=submit(
    state,OFFICIALS[0],
    completeCommand(state,'m1',`race_seed_${order}`,`race_seed_token_${order}`),
    NOW+5000
  );
  state=initial.state;
  const base=clone(state);
  const autoMatch=base.session.event.active.find(match=>match.autoHandoffSourceMatchId==='m1');
  assert(autoMatch,'경기 종료 뒤 자동 투입된 경기가 있어야 합니다.');
  const yieldCommand=activeYieldCommand(base,autoMatch,`race_yield_${order}`,`race_yield_token_${order}`);
  const complete=completeCommand(base,autoMatch.id,`race_complete_${order}`,`race_complete_token_${order}`);
  const commands=order==='yield-first'
    ? [[OFFICIALS[1],yieldCommand],[OFFICIALS[2],complete]]
    : [[OFFICIALS[2],complete],[OFFICIALS[1],yieldCommand]];
  const terminals=[];
  commands.forEach(([actor,command],index)=>{
    const result=submit(state,actor,command,NOW+6000+index);
    state=result.state;
    terminals.push(result.outcome.terminal?.status);
  });
  assert.deepStrictEqual(terminals,['applied','rejected'],'같은 자동 투입 경기에 종료와 이번만 뒤로가 겹치면 먼저 처리한 한 건만 적용되어야 합니다.');
  const autoPlayers=autoMatch.playerIds.map(id=>state.session.players.find(row=>row.id===id).games);
  assert(autoPlayers.every(games=>games===autoPlayers[0]&&games<=1),'종료·뒤로 충돌로 선수 게임 수가 중복 증가하면 안 됩니다.');
  assertInvariants(state.session);
}

{
  let state=root();
  const complete=completeCommand(state,'m1','undo_seed','undo_shared_token');
  state=submit(state,OFFICIALS[0],complete,NOW+7000).state;
  const undo={
    type:'official-operation-undo',operationId:'undo_first',token:'undo_shared_token'
  };
  const first=submit(state,OFFICIALS[1],undo,NOW+7100);
  state=first.state;
  const second=submit(state,OFFICIALS[2],{
    ...undo,operationId:'undo_second'
  },NOW+7200);
  state=second.state;
  assert.strictEqual(first.outcome.terminal?.status,'applied','첫 되돌리기는 적용되어야 합니다.');
  assert.strictEqual(second.outcome.terminal?.status,'rejected','같은 작업의 두 번째 되돌리기는 거절되어야 합니다.');
  assert.strictEqual(state.session.players.find(row=>row.id==='p1').games,0,'되돌리기는 경기 수를 종료 전으로 정확히 복원해야 합니다.');
  assert(state.session.event.active.some(match=>match.id==='m1'),'되돌린 원래 경기가 다시 진행 상태여야 합니다.');
  assertInvariants(state.session);
}

{
  let state=root();
  state=submit(
    state,OFFICIALS[0],
    completeCommand(state,'m1','undo_stale_seed','undo_stale_token'),
    NOW+8000
  ).state;
  const status=statusCommand(state,'p13','rest','undo_stale_status');
  state=submit(state,OFFICIALS[1],status,NOW+8100).state;
  const beforeUndoPlayer=clone(state.session.players.find(row=>row.id==='p13'));
  const staleUndo=submit(state,OFFICIALS[2],{
    type:'official-operation-undo',operationId:'undo_stale_attempt',token:'undo_stale_token'
  },NOW+8200);
  assert.strictEqual(staleUndo.outcome.terminal?.status,'rejected','다른 임원 처리가 뒤따른 작업은 오래된 상태로 되돌리면 안 됩니다.');
  assert.deepStrictEqual(staleUndo.state.session.players.find(row=>row.id==='p13'),beforeUndoPlayer,'거절된 되돌리기가 최신 선수 상태를 훼손하면 안 됩니다.');
  assertInvariants(staleUndo.state.session);
}

{
  let state=root();
  state=submit(
    state,OFFICIALS[0],
    completeCommand(state,'m1','undo_admin_race_seed','undo_admin_race_token'),
    NOW+9000
  ).state;
  state.session.arrivalCandidates.push({
    candidateKey:'roster:late-member',
    kind:'roster',
    memberId:'late-member',
    name:'뒤늦게 확인된 회원'
  });
  const protectedUndo=submit(state,OFFICIALS[1],{
    type:'official-operation-undo',
    operationId:'undo_admin_race_attempt',
    token:'undo_admin_race_token'
  },NOW+9100);
  assert.strictEqual(protectedUndo.outcome.terminal?.status,'rejected','관리자가 갱신한 지각 후보를 오래된 되돌리기로 덮으면 안 됩니다.');
  assert(protectedUndo.state.session.arrivalCandidates.some(row=>row.candidateKey==='roster:late-member'),'거절된 되돌리기는 관리자 최신 후보를 보존해야 합니다.');
  assertInvariants(protectedUndo.state.session);
}

console.log('daily multi official concurrency regression ok');
