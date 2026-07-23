'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {
  applyOfficialRequest,
  issueOfficialGrant,
  refreshEvent
}=require('../functions/daily-official-engine');

const root=path.join(__dirname,'..');
const daily=fs.readFileSync(path.join(root,'js','daily.js'),'utf8');
const checkin=fs.readFileSync(path.join(root,'checkin.html'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'css','app.css'),'utf8');
const engine=fs.readFileSync(path.join(root,'functions','daily-official-engine.js'),'utf8');

function functionSource(src,name,nextName){
  const start=src.indexOf(`function ${name}`);
  const end=src.indexOf(`function ${nextName}`,start+1);
  assert(start>=0&&end>start,`${name} 함수 범위를 찾을 수 있어야 합니다.`);
  return src.slice(start,end);
}

assert(index.includes('id="dailyPauseBtn"'),'관리자 상황판의 주요 운영 제어에 일시정지 버튼이 있어야 합니다.');
assert(index.includes('id="dailyPauseNotice"'),'정지 상태를 관리자에게 명확히 알리는 영역이 있어야 합니다.');
assert(daily.includes('paused:_dailyPaused'),'일시정지 상태를 로컬 저장과 공용 이벤트에 기록해야 합니다.');
assert(daily.includes('pausedAt:_dailyPausedAt'),'앱 재실행 후에도 정지 기준 시각을 복구할 수 있어야 합니다.');
assert(daily.includes('pauseRevision:_dailyPauseRevision'),'여러 관리자 화면이 정지 상태를 덮어쓰지 않도록 별도 버전을 기록해야 합니다.');
assert(daily.includes('if(!_dailyPaused)dailyEnsureQueue()'),'일시정지 중 저장으로 대진 순서를 다시 만들면 안 됩니다.');
assert(functionSource(daily,'dailyRenderQueue','dailyRenderRecommend').includes('if(!_dailyPaused)dailyEnsureQueue()'),'화면을 다시 그리는 것만으로 정지 중 대진을 재계산하면 안 됩니다.');
assert(daily.includes('if(_dailyPaused)return 0;'),'일시정지 중 자동 코트 투입을 막아야 합니다.');
assert(daily.includes('now-since-Number(p.restPausedMs||0)<DAILY_REST_AUTO_DONE_MS'),'전체 정지 시간 때문에 휴식 선수가 재개 직후 자동 종료되면 안 됩니다.');
assert(functionSource(daily,'_dailyQueueRestPassActive','_dailyQueueRestPassLabel').includes('_dailyEffectiveNow()'),'조금 쉬고 유효시간도 전체 정지 중에는 줄어들면 안 됩니다.');
assert(daily.includes("event.pauseReason=reason||DAILY_PAUSE_REASON"),'공용 링크에도 정지 사유를 즉시 전달해야 합니다.');
assert(daily.includes('remotePauseRevision>payloadPauseRevision'),'전송 도중 정지 버전이 바뀌어도 오래된 화면 데이터가 최신 정지 상태를 덮어쓰면 안 됩니다.');
assert(daily.includes("allowWhilePaused:!!req.serverAppliedAt"),'정지 직전에 서버가 확정한 작업은 관리자 원본에 안전하게 이어 붙여야 합니다.');
assert(checkin.includes('class="event-pause-banner"'),'회원·임원 화면에 진행 정지 안내를 보여야 합니다.');
assert(checkin.includes('eventFlowPaused()&&officialFlowOperationType'),'정지 중 임원의 코트 진행 명령을 회원 화면에서도 막아야 합니다.');
assert(checkin.includes("afterPartyDisabledAttr=sendingKey?'disabled':''"),'정지 중에도 뒷풀이 신청과 명단 확인은 계속 가능해야 합니다.');
assert(functionSource(checkin,'sendStatus','sendQueueDefer').includes("blockPausedOperation('선수 상태를 변경')"),'회원 상태 변경도 정지 중에는 대진을 흔들지 않도록 막아야 합니다.');
assert(engine.includes('PAUSED_FLOW_TYPES'),'앱이 꺼져 있어도 서버가 정지 중 코트 진행 명령을 막아야 합니다.');
assert(css.includes('.daily-live-control.pause.active'),'정지와 재개 버튼 상태가 시각적으로 구분되어야 합니다.');

const shiftStart=daily.indexOf('function _dailyShiftMatchTimes');
const shiftEnd=daily.indexOf('async function _dailySyncPauseState',shiftStart);
assert(shiftStart>=0&&shiftEnd>shiftStart,'일시정지 시계 이동 함수 범위를 찾을 수 있어야 합니다.');
const shiftSource=daily.slice(shiftStart,shiftEnd);
const shiftSandbox={};
vm.createContext(shiftSandbox);
vm.runInContext(`
let _dailyMatches=[{id:'m1',startedAt:1000,endAt:901000,autoHandoffAt:1000,autoHandoffExpiresAt:121000}];
let _dailyLastCompleteUndo={expiresAt:46000};
let _dailyPlayers=[
  {id:'wait',status:'wait',waitFrom:500},
  {id:'rest',status:'rest',restPausedMs:1000},
  {id:'defer',status:'wait',waitFrom:700,deferUntil:500000}
];
let _dailyQueue=[{id:'q1',restPass:{createdAt:2000}}];
function _dailyNow(){return 301000;}
function _dailyNormalizeStatus(status){return status;}
${shiftSource}
this.resume=()=>_dailyResumePausedClocks(1000,301000);
this.matches=_dailyMatches;
this.undo=_dailyLastCompleteUndo;
this.players=_dailyPlayers;
this.queue=_dailyQueue;
`,shiftSandbox);
assert.strictEqual(shiftSandbox.resume(),300000,'재개 시 실제 정지 시간을 계산해야 합니다.');
assert.strictEqual(shiftSandbox.matches[0].startedAt,1000,'서버 명령 식별에 쓰는 경기 시작 시각은 바꾸면 안 됩니다.');
assert.strictEqual(shiftSandbox.matches[0].endAt,1201000,'진행 경기 종료 시각을 정지 시간만큼 뒤로 옮겨야 합니다.');
assert.strictEqual(shiftSandbox.matches[0].autoHandoffAt,1000,'자동 투입 식별 시각은 재개 후에도 그대로여야 합니다.');
assert.strictEqual(shiftSandbox.matches[0].autoHandoffExpiresAt,421000,'이번만 뒤로의 2분 기회도 정지 중 줄어들면 안 됩니다.');
assert.strictEqual(shiftSandbox.undo.expiresAt,46000,'운영 되돌리기 만료 시간은 서버 안전 기한이므로 늘리면 안 됩니다.');
assert.strictEqual(shiftSandbox.players[0].waitFrom,300500,'대기 시간에서 전체 정지 시간이 제외되어야 합니다.');
assert.strictEqual(shiftSandbox.players[1].restPausedMs,301000,'휴식 자동 종료 시간도 전체 정지만큼 보존되어야 합니다.');
assert.strictEqual(shiftSandbox.players[2].deferUntil,800000,'운영 중 미루기 기한도 정지 시간만큼 보존되어야 합니다.');
assert.strictEqual(shiftSandbox.queue[0].restPass.createdAt,302000,'조금 쉬고 기한도 정지 시간만큼 보존되어야 합니다.');

const NOW=1_900_000_000_000;
const SESSION_ID='DPAUSE1';
const SECRET='pause-regression-secret-at-least-32-bytes';
const grant=issueOfficialGrant({
  v:1,sid:SESSION_ID,cid:'pause-client',pid:'official',iat:NOW-1000,exp:NOW+60*60*1000
},SECRET);
const players=[
  {id:'official',name:'임원',status:'wait',lastStatusAt:NOW-1000,isClubOfficial:true},
  ...Array.from({length:8},(_,i)=>({
    id:`p${i+1}`,name:`선수${i+1}`,status:i<4?'playing':'wait',
    currentMatchId:i<4?'m1':'',lastStatusAt:NOW-1000,waitFrom:NOW-60000,
    games:0,isClubOfficial:false
  }))
];
const session={
  serverSessionId:SESSION_ID,
  serverRevision:0,
  expiresAt:NOW+48*60*60*1000,
  capabilities:{officialOpsServerV2:true},
  players,
  reservations:[],
  arrivalCandidates:[],
  serverRuntime:{holds:{}},
  event:{
    paused:true,
    pausedAt:NOW,
    pauseReason:'생일축하·공지',
    courts:1,
    completed:0,
    nextTarget:1,
    queuePolicy:{official:1},
    active:[{
      id:'m1',court:1,seq:1,startedAt:NOW-5*60*1000,expectedMinutes:15,
      endAt:NOW+10*60*1000,
      playerIds:['p1','p2','p3','p4'],
      t1Ids:['p1','p2'],t2Ids:['p3','p4']
    }],
    next:[{
      id:'q1',queueId:'q1',playerIds:['p5','p6','p7','p8'],
      t1Ids:['p5','p6'],t2Ids:['p7','p8']
    }],
    expected:[],
    serverStandby:[]
  }
};

const refreshed=refreshEvent(JSON.parse(JSON.stringify(session)),NOW+20*60*1000);
assert.strictEqual(refreshed.event.active[0].remain,10,'정지 중 서버 시간이 지나도 경기 남은 시간이 줄면 안 됩니다.');
assert.strictEqual(refreshed.event.next[0].cueState,'paused','정지 중 다음 대진은 입장 가능 상태가 되면 안 됩니다.');

const common={
  commandProtocol:2,
  actorPlayerId:'official',
  actorPlayerName:'임원',
  officialGrantToken:grant,
  createdAt:NOW+1000,
  expiresAt:NOW+30*60*1000
};
const complete=applyOfficialRequest(session,{
  ...common,
  type:'official-court-complete',
  operationId:'pause_complete',
  matchId:'m1',
  expectedStartedAt:NOW-5*60*1000,
  expectedPlayerIds:['p1','p2','p3','p4']
},{now:NOW+1000,grantSecret:SECRET,checkinId:SESSION_ID});
assert.strictEqual(complete.status,'rejected','정지 중 임원의 경기 종료를 서버가 거절해야 합니다.');
assert(complete.reason.includes('일시 정지'),'거절 이유가 현장에서 이해할 수 있어야 합니다.');

const status=applyOfficialRequest(session,{
  ...common,
  type:'official-player-status',
  operationId:'pause_status',
  playerId:'p1',
  status:'rest',
  expectedStatus:'playing',
  expectedCurrentMatchId:'m1',
  expectedLastStatusAt:NOW-1000
},{now:NOW+1000,grantSecret:SECRET,checkinId:SESSION_ID});
assert.strictEqual(status.status,'rejected','정지 중 임원의 선수 상태 변경도 서버가 거절해야 대기 순서가 고정됩니다.');

const undoBase=JSON.parse(JSON.stringify(session));
undoBase.event.paused=false;
undoBase.event.pausedAt=0;
undoBase.event.pauseReason='';
undoBase.event.pauseRevision=0;
const undoToken='pause_undo_token';
const completed=applyOfficialRequest(undoBase,{
  ...common,
  type:'official-court-complete',
  operationId:'pause_before_undo',
  token:undoToken,
  matchId:'m1',
  expectedStartedAt:NOW-5*60*1000,
  expectedPlayerIds:['p1','p2','p3','p4']
},{now:NOW+2000,grantSecret:SECRET,checkinId:SESSION_ID});
assert.strictEqual(completed.status,'applied','되돌리기 검증용 경기 종료가 먼저 적용되어야 합니다.');
completed.session.event.paused=true;
completed.session.event.pausedAt=NOW+3000;
completed.session.event.pauseReason='생일축하·공지';
completed.session.event.pauseRevision=7;
const undone=applyOfficialRequest(completed.session,{
  ...common,
  type:'official-operation-undo',
  operationId:'pause_undo',
  token:undoToken,
  createdAt:NOW+4000
},{now:NOW+4000,grantSecret:SECRET,checkinId:SESSION_ID,serverOps:completed.serverOps});
assert.strictEqual(undone.status,'applied','정지 중에도 직전 실수는 되돌릴 수 있어야 합니다.');
assert.strictEqual(undone.session.event.paused,true,'되돌리기가 현재 일시정지 상태를 해제하면 안 됩니다.');
assert.strictEqual(undone.session.event.pauseRevision,7,'되돌리기가 최신 일시정지 버전을 되감으면 안 됩니다.');

console.log('daily pause regression ok');
