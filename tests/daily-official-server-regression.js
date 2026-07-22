'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  canonicalJson,
  issueOfficialGrant,
  verifyOfficialGrant
} = require('../functions/daily-official-engine');
const {applyCommandTransaction} = require('../functions/daily-official-command');

const CHECKIN_ID = 'DTEST222';
const CLIENT_ID = 'oc_1234567890abcdef1234567890abcdef';
const SECRET = 'test-secret-should-be-at-least-32-bytes-long';
const BASE_NOW = 1_800_000_000_000;

function clone(value){return JSON.parse(JSON.stringify(value));}
function hash(value){return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');}
function player(id, status, official = false){
  return {
    id,name:id.toUpperCase(),grade:'C',level:4,gender:'M',status,
    statusLabel:status,locked:status==='playing',currentMatchId:'',afterMatchStatus:'',
    games:0,mixedGames:0,typeTrackedGames:0,lastStatusAt:BASE_NOW-1000,
    waitFrom:BASE_NOW-60_000,isClubOfficial:official
  };
}
function queue(id, ids){
  return {
    queueId:id,id,type:'남복',teamMode:false,
    t1Ids:ids.slice(0,2),t2Ids:ids.slice(2,4),
    t1:ids.slice(0,2).map(value=>value.toUpperCase()),
    t2:ids.slice(2,4).map(value=>value.toUpperCase()),
    playerIds:ids
  };
}
function active(id, court, ids, startedAt){
  return {
    id,court,seq:court,type:'남복',teamMode:false,startedAt,
    expectedMinutes:15,endAt:startedAt+15*60_000,
    t1Ids:ids.slice(0,2),t2Ids:ids.slice(2,4),playerIds:ids,
    t1:ids.slice(0,2).map(value=>value.toUpperCase()),
    t2:ids.slice(2,4).map(value=>value.toUpperCase())
  };
}
function baseRoot(){
  const players=[player('official','wait',true)];
  for(let i=1;i<=16;i++)players.push(player(`p${i}`,i<=8?'playing':'wait'));
  for(let i=1;i<=4;i++)players.find(item=>item.id===`p${i}`).currentMatchId='m1';
  for(let i=5;i<=8;i++)players.find(item=>item.id===`p${i}`).currentMatchId='m2';
  return {
    session:{
      serverSessionId:CHECKIN_ID,commandProtocol:2,serverRevision:0,
      expiresAt:BASE_NOW+48*60*60_000,
      capabilities:{officialOpsServerV2:true},
      players,reservations:[],arrivalCandidates:[],serverRuntime:{holds:{},nextSeq:3},
      event:{
        courts:2,nextTarget:2,serverExpectedGoal:1,completed:0,
        queuePolicy:{official:2},
        active:[
          active('m1',1,['p1','p2','p3','p4'],BASE_NOW-14*60_000),
          active('m2',2,['p5','p6','p7','p8'],BASE_NOW-10*60_000)
        ],
        next:[queue('q1',['p9','p10','p11','p12']),queue('q2',['p13','p14','p15','p16'])],
        expected:[queue('q3',['p1','p2','p3','p4'])],
        serverStandby:[queue('q4',['p5','p6','p7','p8'])]
      }
    },
    officialClaims:{[CLIENT_ID]:{clientId:CLIENT_ID,claimedAt:BASE_NOW-1000,expiresAt:BASE_NOW+60*60_000}}
  };
}

const grantToken = issueOfficialGrant({
  v:1,sid:CHECKIN_ID,cid:CLIENT_ID,iat:BASE_NOW-1000,exp:BASE_NOW+60*60_000
}, SECRET);

function storedCommand(type, operationId, now, extra = {}){
  return {
    type,operationId,commandProtocol:2,
    actorPlayerId:'official',actorPlayerName:'운영임원',
    createdAt:now,expiresAt:now+30*60_000,
    source:'club-official-support',...extra
  };
}
function submit(root, type, operationId, now, extra = {}){
  const stored = storedCommand(type, operationId, now, extra);
  const outcome = applyCommandTransaction(root, {
    storedCommand:stored,
    engineCommand:{...stored,officialGrantToken:grantToken},
    operationId,payloadHash:hash(stored),clientId:CLIENT_ID,now,
    checkinId:CHECKIN_ID,grantSecret:SECRET
  });
  return {outcome,stored};
}
function assertOperationalInvariants(session){
  const activeCourts=(session.event.active||[]).map(match=>match.court);
  assert.strictEqual(new Set(activeCourts).size,activeCourts.length,'한 코트에는 진행 경기 하나만 있어야 합니다.');
  const activeIds=(session.event.active||[]).flatMap(match=>match.playerIds||[]);
  assert.strictEqual(new Set(activeIds).size,activeIds.length,'한 선수가 두 진행 경기에 동시에 들어가면 안 됩니다.');
  const nextIds=(session.event.next||[]).flatMap(item=>item.playerIds||[]);
  assert.strictEqual(new Set(nextIds).size,nextIds.length,'다음 대진끼리 같은 선수를 중복 사용하면 안 됩니다.');
  assert(!nextIds.some(id=>activeIds.includes(id)),'진행 중 선수는 다음 대진에 동시에 들어가면 안 됩니다.');
}

const validGrant = verifyOfficialGrant(grantToken,SECRET,CHECKIN_ID,BASE_NOW);
assert(validGrant.ok&&validGrant.payload.cid===CLIENT_ID,'정상 임원 권한 토큰을 검증해야 합니다.');
assert(verifyOfficialGrant(grantToken,SECRET,'DOTHER22',BASE_NOW).reason.includes('다른 민턴LIVE'),'다른 세션의 임원 권한을 재사용하면 안 됩니다.');
assert(verifyOfficialGrant(grantToken,SECRET,CHECKIN_ID,BASE_NOW+60*60_000).reason.includes('시간이 끝났습니다'),'만료된 임원 권한을 거절해야 합니다.');
const tamperedGrant=grantToken.slice(0,-1)+(grantToken.endsWith('a')?'b':'a');
assert(verifyOfficialGrant(tamperedGrant,SECRET,CHECKIN_ID,BASE_NOW).reason.includes('올바르지 않습니다'),'변조된 임원 권한을 거절해야 합니다.');

let root=baseRoot();
const completeExtra={
  matchId:'m1',court:1,token:'undo_complete_1',expectedStartedAt:BASE_NOW-14*60_000,
  expectedPlayerIds:['p1','p2','p3','p4']
};
let first=submit(root,'official-court-complete','operation_complete_001',BASE_NOW,completeExtra);
assert.strictEqual(first.outcome.action,'commit');
assert.strictEqual(first.outcome.terminal.status,'applied');
root=first.outcome.current;
assert.strictEqual(root.session.serverRevision,1,'첫 서버 운영은 리비전을 1 올려야 합니다.');
assert.strictEqual(root.session.event.active.length,1,'종료한 경기만 진행 목록에서 빠져야 합니다.');
assert.strictEqual(root.session.event.next[0].cueState,'free','종료한 코트에 첫 다음 대진이 입장 가능 상태가 되어야 합니다.');
assert.strictEqual(root.session.event.next[0].targetHoldId,`m1:${BASE_NOW}`,'종료 건과 입장 건을 같은 보류 ID로 연결해야 합니다.');
assert(root.session.players.filter(item=>['p1','p2','p3','p4'].includes(item.id)).every(item=>item.status==='wait'&&item.games===1),'종료 선수는 게임 수가 증가하고 참가 상태로 돌아와야 합니다.');
assert(!root.requests.operation_complete_001.officialGrantToken,'공개 요청 기록에 임원 권한 토큰을 저장하면 안 됩니다.');

const beforeDuplicate=JSON.stringify(root);
const duplicate=submit(root,'official-court-complete','operation_complete_001',BASE_NOW,completeExtra);
assert.strictEqual(duplicate.outcome.action,'duplicate','같은 명령 재전송은 기존 결과를 돌려줘야 합니다.');
assert.strictEqual(JSON.stringify(root),beforeDuplicate,'같은 명령 재전송으로 상태를 한 번 더 바꾸면 안 됩니다.');
const conflicting=submit(root,'official-court-complete','operation_complete_001',BASE_NOW,{...completeExtra,court:2});
assert.strictEqual(conflicting.outcome.failureCode,'already-exists','같은 명령 ID의 다른 본문은 충돌로 차단해야 합니다.');

const q1=root.session.event.next.find(item=>item.queueId==='q1');
let entered=submit(root,'official-queue-enter-free','operation_enter_0001',BASE_NOW+1000,{
  queueId:'q1',court:1,token:'undo_enter_1',newMatchId:'dmv2_operation_enter_0001',
  expectedHoldId:q1.targetHoldId,expectedPlayerIds:[...q1.playerIds]
});
assert.strictEqual(entered.outcome.terminal.status,'applied');
root=entered.outcome.current;
assert(root.session.event.active.some(match=>match.id==='dmv2_operation_enter_0001'&&match.court===1),'입장 처리는 결정적 경기 ID로 해당 코트에서 시작해야 합니다.');
assert(root.session.event.next.some(item=>item.queueId==='q3'),'앱이 꺼져 있어도 준비된 예상 대진을 다음 대진으로 승격해야 합니다.');
assertOperationalInvariants(root.session);

const q2Index=root.session.event.next.findIndex(item=>item.queueId==='q2');
const q2=root.session.event.next[q2Index];
let yielded=submit(root,'official-queue-yield','operation_yield_0001',BASE_NOW+2000,{
  queueId:'q2',token:'undo_yield_1',expectedQueueIndex:q2Index+1,targetQueueIndex:2,
  expectedCueState:q2.cueState,expectedTargetCourt:q2.targetCourt||null,expectedHoldId:q2.targetHoldId||'',
  expectedPlayerIds:[...q2.playerIds],expectedTeam1Ids:[...q2.t1Ids],expectedTeam2Ids:[...q2.t2Ids]
});
assert.strictEqual(yielded.outcome.terminal.status,'applied');
root=yielded.outcome.current;
assert.deepStrictEqual(root.session.event.next.map(item=>item.queueId),['q3','q2'],'이번만 뒤로는 네 명과 팀을 유지한 채 선택 순번으로 이동해야 합니다.');
let undo=submit(root,'official-operation-undo','operation_undo_00001',BASE_NOW+3000,{token:'undo_yield_1'});
assert.strictEqual(undo.outcome.terminal.status,'applied','직후 운영은 45초 안에 되돌릴 수 있어야 합니다.');
root=undo.outcome.current;
assert.deepStrictEqual(root.session.event.next.map(item=>item.queueId),['q2','q3'],'되돌리기는 직전 대진 순서를 복원해야 합니다.');
assert.strictEqual(root.session.serverRevision,4,'되돌리기도 새 서버 리비전으로 기록해야 합니다.');

const yieldAgainQ=root.session.event.next[0];
let yieldAgain=submit(root,'official-queue-yield','operation_yield_0002',BASE_NOW+4000,{
  queueId:yieldAgainQ.queueId,token:'undo_yield_2',expectedQueueIndex:1,targetQueueIndex:2,
  expectedCueState:yieldAgainQ.cueState,expectedTargetCourt:yieldAgainQ.targetCourt||null,expectedHoldId:yieldAgainQ.targetHoldId||'',
  expectedPlayerIds:[...yieldAgainQ.playerIds],expectedTeam1Ids:[...yieldAgainQ.t1Ids],expectedTeam2Ids:[...yieldAgainQ.t2Ids]
});
assert.strictEqual(yieldAgain.outcome.terminal.status,'applied');
root=yieldAgain.outcome.current;
const p1=root.session.players.find(item=>item.id==='p1');
let statusChange=submit(root,'official-player-status','operation_status_001',BASE_NOW+5000,{
  playerId:'p1',playerName:'P1',status:'rest',expectedStatus:p1.status,
  expectedCurrentMatchId:p1.currentMatchId||'',expectedLastStatusAt:p1.lastStatusAt||0
});
assert.strictEqual(statusChange.outcome.terminal.status,'applied');
root=statusChange.outcome.current;
const guardedUndo=submit(root,'official-operation-undo','operation_undo_00002',BASE_NOW+6000,{token:'undo_yield_2'});
assert.strictEqual(guardedUndo.outcome.terminal.status,'rejected','이후 다른 운영이 있으면 오래된 되돌리기를 차단해야 합니다.');
assert.strictEqual(guardedUndo.outcome.current.session.serverRevision,6,'거절된 되돌리기는 서버 상태 리비전을 바꾸면 안 됩니다.');

let raceRoot=baseRoot();
let raceComplete=submit(raceRoot,'official-court-complete','race_complete_0001',BASE_NOW,completeExtra);
raceRoot=raceComplete.outcome.current;
const raceQ=raceRoot.session.event.next[0];
const staleYield={
  queueId:raceQ.queueId,token:'race_yield',expectedQueueIndex:1,targetQueueIndex:2,
  expectedCueState:raceQ.cueState,expectedTargetCourt:raceQ.targetCourt,expectedHoldId:raceQ.targetHoldId,
  expectedPlayerIds:[...raceQ.playerIds],expectedTeam1Ids:[...raceQ.t1Ids],expectedTeam2Ids:[...raceQ.t2Ids]
};
let raceEnter=submit(raceRoot,'official-queue-enter-free','race_enter_000001',BASE_NOW+1000,{
  queueId:raceQ.queueId,court:raceQ.targetCourt,token:'race_enter',newMatchId:'dmv2_race_enter',
  expectedHoldId:raceQ.targetHoldId,expectedPlayerIds:[...raceQ.playerIds]
});
raceRoot=raceEnter.outcome.current;
const staleResult=submit(raceRoot,'official-queue-yield','race_yield_000001',BASE_NOW+1000,staleYield);
assert.strictEqual(staleResult.outcome.terminal.status,'rejected','두 임원이 같은 대진을 동시에 처리하면 먼저 반영된 한 건만 성공해야 합니다.');
assert.strictEqual(staleResult.outcome.current.session.event.active.filter(match=>match.court===1).length,1,'동시 요청으로 한 코트에 경기가 중복 생성되면 안 됩니다.');

let unauthorized=baseRoot();
unauthorized.session.players.find(item=>item.id==='official').isClubOfficial=false;
const denied=submit(unauthorized,'official-player-status','operation_denied_001',BASE_NOW,{
  playerId:'p9',status:'rest',expectedLastStatusAt:BASE_NOW-1000
});
assert.strictEqual(denied.outcome.terminal.status,'rejected','임원 링크가 있어도 현재 명단에서 임원 해제된 사람은 운영할 수 없어야 합니다.');
assert.strictEqual(denied.outcome.current.session.serverRevision,0,'권한 거절은 운영 상태를 바꾸면 안 됩니다.');

const checkinSource=fs.readFileSync(path.join(__dirname,'..','checkin.html'),'utf8');
const dailySource=fs.readFileSync(path.join(__dirname,'..','js','daily.js'),'utf8');
const functionSource=fs.readFileSync(path.join(__dirname,'..','functions','index.js'),'utf8');
assert(checkinSource.includes("httpsCallable('claimDailyOfficialInvite')")&&checkinSource.includes("httpsCallable('submitDailyOfficialRequest')"),'임원 링크 권한 교환과 서버 명령 함수를 모두 호출해야 합니다.');
assert(checkinSource.includes("history.replaceState(null,'',cleaned.toString())"),'임원 초대 토큰은 교환 전에 주소창에서 제거해야 합니다.');
assert(checkinSource.includes('newMatchId:`dmv2_${operationId}`')&&checkinSource.includes('playerId:`dpv2_${operationId}`'),'재시도와 관리자 재동기화에 같은 경기·선수 ID를 사용해야 합니다.');
assert(dailySource.includes('serverRevision!==_dailyServerRevision+1'),'관리자 재실행 시 서버 명령을 리비전 순서대로만 원본에 합쳐야 합니다.');
assert(dailySource.includes('_dailyPrepareServerQueueRequest(req)'),'서버에서 승격된 예상 대진도 팀 구성으로 관리자 원본에 복원해야 합니다.');
assert(dailySource.includes("httpsCallable('getDailyOfficialReconcile')"),'관리자 재실행은 공개 요청 표시가 아니라 서버 함수의 검증된 운영 기록을 받아야 합니다.');
assert(dailySource.includes('.filter(r=>!r.appliedAt&&!r.ignoredAt&&!r.serverAppliedAt&&!r.serverRejectedAt)'),'공개 데이터베이스에서 임의로 붙인 서버 처리 표시는 관리자 원본이 신뢰하면 안 됩니다.');
assert(functionSource.includes('exports.getDailyOfficialReconcile'),'서버는 관리자 재동기화용 검증된 명령 조회 함수를 제공해야 합니다.');

const queueHelperStart=dailySource.indexOf('function _dailyOfficialQueueRequestFingerprint');
const queueHelperEnd=dailySource.indexOf('function _dailyOfficialRequestError',queueHelperStart);
assert(queueHelperStart>=0&&queueHelperEnd>queueHelperStart,'서버 대진 재결합 함수 범위를 찾을 수 있어야 합니다.');
const queueHelperCode=`
let _dailyQueue=[];
const players=new Map(Array.from({length:8},(_,i)=>['p'+(i+1),{id:'p'+(i+1),status:'wait'}]));
let _dailyNext=null;
function dailyEnsureQueue(){}
function _dailyQueueIds(q){return [...(q.team1||[]),...(q.team2||[])];}
function _dailyPlayer(id){return players.get(id)||null;}
function _dailyNow(){return ${BASE_NOW};}
function _dailyOfficialTeamFingerprint(team1,team2){const key=ids=>(ids||[]).map(String).sort().join('|');return [key(team1),key(team2)].sort().join(' VS ');}
function _dailyRecalcQueueItem(q){return q;}
function _dailyRefreshNextFromQueue(){_dailyNext=_dailyQueue[0]||null;}
${dailySource.slice(queueHelperStart,queueHelperEnd)}
this.api={
  setQueue:value=>{_dailyQueue=value;},
  prepare:_dailyPrepareServerQueueRequest,
  queue:()=>_dailyQueue
};`;
const queueHelperSandbox={};
vm.createContext(queueHelperSandbox);
vm.runInContext(queueHelperCode,queueHelperSandbox);
queueHelperSandbox.api.setQueue([
  {id:'other',team1:['p5','p6'],team2:['p7','p8']},
  {id:'local-random-id',team1:['p1','p2'],team2:['p3','p4']}
]);
assert.strictEqual(queueHelperSandbox.api.prepare({
  type:'official-queue-enter-free',serverAppliedAt:BASE_NOW,queueId:'server-q3',expectedQueueIndex:1,
  expectedTeam1Ids:['p1','p2'],expectedTeam2Ids:['p3','p4']
}),true);
assert.deepStrictEqual(Array.from(queueHelperSandbox.api.queue(),item=>item.id),['server-q3','other'],'같은 팀 구성의 로컬 예상 대진은 서버 queueId와 순서로 다시 연결해야 합니다.');
queueHelperSandbox.api.setQueue([{id:'other',team1:['p1','p2'],team2:['p3','p4']}]);
assert.strictEqual(queueHelperSandbox.api.prepare({
  type:'official-queue-yield',serverAppliedAt:BASE_NOW,operationId:'restore-op',queueId:'server-q4',expectedQueueIndex:1,
  expectedPlayerIds:['p5','p6','p7','p8'],expectedTeam1Ids:['p5','p6'],expectedTeam2Ids:['p7','p8'],queueType:'남복'
}),true);
assert.strictEqual(queueHelperSandbox.api.queue()[0].id,'server-q4','로컬에 없던 서버 승격 대진도 확인된 네 명과 팀 그대로 복원해야 합니다.');

console.log('daily official server regression ok');
