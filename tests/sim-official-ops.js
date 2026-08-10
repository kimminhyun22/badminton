'use strict';
// 임원 화면의 조작을 실전 세션 위에서 전부 눌러 보는 통합 시뮬레이션
// (운영자 2026-08-13 "버튼 업그레이드 등 새로 추가·변경한 것들 이상 없는지").
//
// 순차 종료·인원 변동이 있는 3코트 세션을 돌리면서, 임원 화면 버튼이 보내는
// 명령을 그대로 서버 엔진에 넣고 **매 조작 뒤 불변식**을 확인한다:
//   · 한 선수가 두 진행 경기에 서지 않는다
//   · 한 선수가 두 대기 대진에 들어가지 않는다
//   · 대기 대진은 항상 서로 다른 4명이다
//   · 두 경기가 같은 코트 번호를 쓰지 않는다
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const REPO = path.join(__dirname, '..');
const {canonicalJson, issueOfficialGrant, refreshEvent} = require(path.join(REPO,'functions/daily-official-engine'));
const {replenishPrepared} = require(path.join(REPO,'functions/daily-server-matchmaker'));
const {applyCommandTransaction} = require(path.join(REPO,'functions/daily-official-command'));

const COURTS=3, BASE_NOW=1_830_000_000_000;
const CHECKIN_ID='DSIMOPS', CLIENT_ID='simops_client';
const SECRET='sim-ops-secret-string-at-least-32-bytes!!';
const ACTOR='운영임원';
const GRADE_LEVEL={S:7,A:6,B:5,C:4,D:3,E:2};
const AGES=['20대','30대','40대','50대','60대+'];

const SPEC=[['S',1],['A',5],['B',5],['C',9],['D',9],['E',1]];
const ROSTER=[];
(function(){let i=0,f=0;SPEC.forEach(([g,n])=>{for(let k=0;k<n;k++){i++;
  const gender=(f<11&&i%3===1)?'F':'M'; if(gender==='F')f++;
  ROSTER.push([`${g}${String(i).padStart(2,'0')}`,gender,g]);}});
  ROSTER[5][0]=ACTOR;})();

const hash=v=>crypto.createHash('sha256').update(canonicalJson(v)).digest('hex');
const results=[];
let opIndex=0, ctx=null;

function build(){
  const players=ROSTER.map(([name,gender,grade],i)=>({
    id:'p'+String(i+1).padStart(2,'0'),memberId:'m'+i,name,gender,grade,
    level:Math.max(1,GRADE_LEVEL[grade]-(gender==='F'?1:0)),ageGroup:AGES[i%AGES.length],isGuest:false,
    status:'wait',statusLabel:'wait',preArrivalVisible:false,registrationCancelled:false,
    locked:false,currentMatchId:'',afterMatchStatus:'',games:0,fairExpected:0,
    mixedGames:0,typeTrackedGames:0,lastPlayedSeq:0,
    partnerCount:{},opponentCount:{},partnerCountById:{},opponentCountById:{},
    joinedAt:BASE_NOW,waitFrom:BASE_NOW,lastStatusAt:BASE_NOW-1000,restPausedMs:0,
    isClubOfficial:name===ACTOR,isTemporaryOfficial:false}));
  // 늦게 오는 3명은 도착 전으로 시작 — 지각 등록·도착 되돌리기 대상
  [21,26,29].forEach(i=>{players[i].status='planned';players[i].statusLabel='planned';players[i].preArrivalVisible=true;});
  const actor=players.find(p=>p.name===ACTOR);
  const grant=issueOfficialGrant({v:1,sid:CHECKIN_ID,cid:CLIENT_ID,pid:actor.id,
    iat:BASE_NOW-1000,exp:BASE_NOW+48*3600_000},SECRET);
  return {actorId:actor.id,grant,state:{session:{
    serverSessionId:CHECKIN_ID,commandProtocol:2,serverRevision:0,matchStartedAt:BASE_NOW,
    expiresAt:BASE_NOW+48*3600_000,
    officialInvite:{tokenHash:'a'.repeat(64),expiresAt:BASE_NOW+48*3600_000},
    capabilities:{officialOpsServerV2:true,officialAutoHandoffV1:true,officialOperationUndoV1:true,
      memberStatusServerV1:true,temporaryOfficialV1:true,officialQueueHoldV1:true,
      officialQueueCardOpsV1:true,officialQueueYieldOneStepV1:true,officialArrivalV1:true},
    players,reservations:[],arrivalCandidates:[],
    serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
    event:{courts:COURTS,nextTarget:COURTS,serverExpectedGoal:0,completed:0,finishMode:false,
      operationStarted:true,queuePolicy:{official:COURTS,auto:true},
      active:[],next:[],expected:[],serverStandby:[]}},
    officialClaims:{[CLIENT_ID]:{clientId:CLIENT_ID,expiresAt:BASE_NOW+48*3600_000,
      claimMode:'roster',officialPlayerId:actor.id}}}};
}
const S=()=>ctx.state.session;
function send(extra,now,label){
  const operationId=`ops_${label}_${String(opIndex++).padStart(4,'0')}`;
  const stored={actorPlayerId:ctx.actorId,actorPlayerName:ACTOR,createdAt:now,
    expiresAt:now+30*60_000,source:'sim-ops',operationId,...extra};
  const outcome=applyCommandTransaction(ctx.state,{
    storedCommand:stored,engineCommand:{...stored,officialGrantToken:ctx.grant},
    operationId,payloadHash:hash(stored),clientId:CLIENT_ID,grantPlayerId:ctx.actorId,
    now,checkinId:CHECKIN_ID,grantSecret:SECRET});
  const ok=outcome.action==='commit'&&outcome.terminal?.status==='applied';
  if(ok)ctx.state=outcome.current;
  return {ok,reason:outcome.terminal?.reason||outcome.failureMessage||''};
}
function invariants(where){
  const s=S();
  const onCourt=new Set(), courts=new Set();
  s.event.active.forEach(m=>{
    assert(!courts.has(Number(m.court)),`[${where}] 두 경기가 같은 코트(${m.court})를 씁니다.`);
    courts.add(Number(m.court));
    (m.playerIds||[]).forEach(id=>{
      assert(!onCourt.has(id),`[${where}] ${id} 가 두 진행 경기에 있습니다.`);
      onCourt.add(id);
    });
  });
  const queued=new Set();
  s.event.next.forEach(item=>{
    const ids=item.playerIds||[];
    assert.strictEqual(ids.length,4,`[${where}] 대기 대진이 4명이 아닙니다.`);
    assert.strictEqual(new Set(ids).size,4,`[${where}] 대기 대진에 같은 선수가 둘 있습니다.`);
    ids.forEach(id=>{
      assert(!queued.has(id),`[${where}] ${id} 가 두 대기 대진에 있습니다.`);
      queued.add(id);
    });
  });
}
function check(label,res,{expect='applied'}={}){
  const passed = expect==='applied' ? res.ok : !res.ok;
  results.push({label,ok:passed,detail:res.reason});
  assert(passed,`${label}: ${expect==='applied'?`적용돼야 하는데 거절됨(${res.reason})`:'거절돼야 하는데 적용됨'}`);
  invariants(label);
}
function enterFree(now,tag){
  for(let g=0;g<COURTS+2;g++){
    refreshEvent(S(),now);
    const busy=new Set(S().event.active.map(m=>Number(m.court)));
    const free=[...Array(COURTS)].map((_,i)=>i+1).find(c=>!busy.has(c));
    if(!free)return;
    const item=S().event.next.find(r=>r.cueState==='free'&&r.targetCourt);
    if(!item)return;
    const r=send({type:'official-queue-enter-free',token:`e_${tag}_${g}`,queueId:item.queueId||item.id,
      court:item.targetCourt,newMatchId:`m_${tag}_${g}`,
      expectedQueueIndex:S().event.next.indexOf(item)+1,expectedHoldId:item.targetHoldId||'',
      expectedPlayerIds:[...item.playerIds],expectedTeam1Ids:[...item.t1Ids],
      expectedTeam2Ids:[...item.t2Ids]},now,`enter_${tag}_${g}`);
    if(!r.ok)return;
  }
}

// ── 세션 시작 ─────────────────────────────────────────────────────────
ctx=build();
replenishPrepared(S(),{now:BASE_NOW,requestId:'init'});
enterFree(BASE_NOW,'init');
invariants('초기 투입');
assert.strictEqual(S().event.active.length,COURTS,'세 코트가 모두 시작돼야 합니다.');

let t=0;
const at=()=>BASE_NOW+(t)*60_000;

// 1) 코트 번호 정정 — 새 기능(v554). 코트 수 안에서만 허용(v560 수리)
t=5;
{
  const m=S().event.active[0];
  const from=Number(m.court);
  const other=S().event.active.find(x=>Number(x.court)!==from);
  const to=Number(other.court);
  check('코트 번호 정정(맞바꾸기)',send({type:'official-court-renumber',matchId:m.id,
    court:to,expectedCourt:from,allowSwap:true},at(),'renum1'));
  assert.strictEqual(Number(S().event.active.find(x=>x.id===m.id).court),to,'대상이 상대 번호로 가야 합니다.');
  assert.strictEqual(Number(S().event.active.find(x=>x.id===other.id).court),from,'상대는 원래 번호로 와야 합니다.');
  assert.strictEqual(S().event.active.length,COURTS,'코트 수보다 많은 경기가 생기면 안 됩니다.');
  check('코트 번호 정정(코트 수 밖 거절)',send({type:'official-court-renumber',matchId:m.id,
    court:COURTS+4,expectedCourt:to,allowSwap:true},at(),'renum2'),{expect:'rejected'});
  check('코트 번호 정정(맞바꿈 동의 없으면 거절)',send({type:'official-court-renumber',matchId:m.id,
    court:from,expectedCourt:to},at(),'renum3'),{expect:'rejected'});
  check('코트 번호 정정(지문 불일치 거절)',send({type:'official-court-renumber',matchId:m.id,
    court:from,expectedCourt:99,allowSwap:true},at(),'renum4'),{expect:'rejected'});
  // 원래대로 되돌려 둡니다.
  send({type:'official-court-renumber',matchId:m.id,court:from,expectedCourt:to,
    allowSwap:true},at(),'renum_back');
  assert.strictEqual(S().event.active.length,COURTS,'되돌린 뒤에도 코트 수가 유지돼야 합니다.');
}

// 2) 지각 참가 등록 → 도착 되돌리기 — 새 기능(v554)
t=10;
{
  const late=S().players.find(p=>['planned','invited'].includes(p.status));
  check('지각 선수 참가 등록',send({type:'official-player-arrival',playerId:late.id,
    candidateKey:`player:${late.id}`,status:'wait',
    expectedStatus:late.status,expectedLastStatusAt:late.lastStatusAt},at(),'arrive'));
  assert.strictEqual(S().players.find(p=>p.id===late.id).status,'wait');
  check('도착 되돌리기',send({type:'official-player-unarrive',playerId:late.id,
    expectedName:late.name},at(),'unarrive'));
  const back=S().players.find(p=>p.id===late.id);
  assert.strictEqual(back.status,'planned','도착 전으로 돌아가야 합니다.');
  assert.strictEqual(back.preArrivalVisible,true,'도착 전 명단에 보여야 합니다.');
  check('도착 되돌리기(중복 거절)',send({type:'official-player-unarrive',playerId:late.id},at(),'unarrive2'),
    {expect:'rejected'});
  const playing=S().event.active[0].playerIds[0];
  check('도착 되돌리기(경기중 거절)',send({type:'official-player-unarrive',playerId:playing},at(),'unarrive3'),
    {expect:'rejected'});
}

// 3) 대기표 아이콘 줄 — 위로/아래로 · 다시 짜기 · 삭제 · 일시정지/재시작
t=15;
{
  // 남은 지각자를 등록해 대기 풀을 실전 수준으로 만듭니다.
  // (「다시 짜기」는 새로 짤 4명이 필요하므로 여유 인원이 있어야 합니다.)
  S().players.filter(p=>['planned','invited'].includes(p.status)).forEach((p,i)=>{
    send({type:'official-player-arrival',playerId:p.id,candidateKey:`player:${p.id}`,
      status:'wait',expectedStatus:p.status,expectedLastStatusAt:p.lastStatusAt},at(),`arrive_more_${i}`);
  });
  refreshEvent(S(),at());
  if(S().event.next.length>=2){
    const first=S().event.next[0];
    check('아이콘 ▼ 아래로',send({type:'official-queue-yield',queueId:first.queueId||first.id,
      token:'mv1',expectedQueueIndex:1,targetQueueIndex:2,allowFreeMove:true,
      expectedCueState:first.cueState||'',expectedTargetCourt:first.targetCourt||null,
      expectedHoldId:first.targetHoldId||'',expectedPlayerIds:[...first.playerIds],
      expectedTeam1Ids:[...first.t1Ids],expectedTeam2Ids:[...first.t2Ids]},at(),'move_down'));
    const nowSecond=S().event.next[1];
    check('아이콘 ▲ 위로',send({type:'official-queue-yield',queueId:nowSecond.queueId||nowSecond.id,
      token:'mv2',expectedQueueIndex:2,targetQueueIndex:1,allowFreeMove:true,
      expectedCueState:nowSecond.cueState||'',expectedTargetCourt:nowSecond.targetCourt||null,
      expectedHoldId:nowSecond.targetHoldId||'',expectedPlayerIds:[...nowSecond.playerIds],
      expectedTeam1Ids:[...nowSecond.t1Ids],expectedTeam2Ids:[...nowSecond.t2Ids]},at(),'move_up'));
  }
  const item=S().event.next[0];
  check('아이콘 ⏸ 일시정지',send({type:'official-queue-hold',queueId:item.queueId||item.id,
    token:'hold1',expectedPlayerIds:[...item.playerIds]},at(),'hold'));
  check('아이콘 ▶ 재시작',send({type:'official-queue-resume',queueId:item.queueId||item.id,
    token:'resume1',expectedPlayerIds:[...item.playerIds]},at(),'resume'));
  check('아이콘 ↻ 다시 짜기',send({type:'official-queue-regenerate',queueId:item.queueId||item.id,
    expectedPlayerIds:[...item.playerIds]},at(),'regen'));
  const del=S().event.next[S().event.next.length-1];
  check('아이콘 🗑 삭제',send({type:'official-queue-delete',queueId:del.queueId||del.id,
    expectedPlayerIds:[...del.playerIds]},at(),'del'));
}

// 4) 운영 현황 도구 6개 — 선수 추가 · 이름 변경 · 제외 · 코트 수 · 도우미 · 마무리
t=25;
{
  check('🙋 선수 추가(게스트)',send({type:'official-player-create',playerId:'dpv2_sim_guest',
    name:'게스트손님',grade:'C',gender:'M',level:4,ageGroup:'40대',isGuest:true},at(),'create'));
  assert(S().players.some(p=>p.id==='dpv2_sim_guest'),'명단에 들어가야 합니다.');
  check('✏️ 이름 변경',send({type:'official-player-rename',playerId:'dpv2_sim_guest',
    name:'게스트변경',expectedName:'게스트손님'},at(),'rename'));
  check('🚫 제외',send({type:'official-player-remove',playerId:'dpv2_sim_guest',
    expectedName:'게스트변경'},at(),'remove'));
  assert(!S().players.some(p=>p.id==='dpv2_sim_guest'),'명단에서 빠져야 합니다.');
  const before=S().event.courts;
  check('🏸 코트 수 변경',send({type:'official-settings-update',courts:before+1,
    expectedCourts:before},at(),'courts'));
  assert.strictEqual(S().event.courts,before+1);
  send({type:'official-settings-update',courts:before,expectedCourts:before+1},at(),'courts_back');
  const helper=S().players.find(p=>p.status==='wait'&&!p.isClubOfficial&&!p.currentMatchId);
  check('🤝 운영 도우미 지정',send({type:'official-temporary-grant',playerId:helper.id,
    expectedName:helper.name},at(),'grant'));
  check('🤝 운영 도우미 해제',send({type:'official-temporary-revoke',playerId:helper.id,
    expectedName:helper.name},at(),'revoke'));
}

// 5) 다음 대진 짜기 — 중복 예약 상황 포함(경고는 화면, 서버는 자리 정리)
t=30;
{
  refreshEvent(S(),at());
  const queuedIds=new Set();
  S().event.next.forEach(i=>(i.playerIds||[]).forEach(id=>queuedIds.add(String(id))));
  const free=S().players.filter(p=>p.status==='wait'&&!p.currentMatchId&&!queuedIds.has(String(p.id)));
  if(free.length>=3&&queuedIds.size){
    const dup=[...queuedIds][0];      // 이미 대기표에 잡힌 선수를 일부러 포함
    check('➕ 다음 대진 짜기(중복 선수 포함)',send({type:'official-queue-add',queueId:'sq_sim_dup',
      team1Ids:[dup,free[0].id],team2Ids:[free[1].id,free[2].id]},at(),'compose_dup'));
    const item=S().event.next.find(i=>String(i.queueId||i.id)==='sq_sim_dup');
    assert(item,'짠 대진이 대기표에 있어야 합니다.');
    assert.strictEqual(item.manualComposed,true,'직접 짠 대진 표시(예약 딱지)가 있어야 합니다.');
  }
}

// 6) 진행 코트 조작 — 선수 교체 · 경기 취소 · 종료와 되돌리기
t=40;
{
  const m=S().event.active[0];
  const out=m.playerIds[0];
  const cand=S().players.find(p=>p.status==='wait'&&!p.currentMatchId
    &&!S().event.next.some(i=>(i.playerIds||[]).includes(p.id)));
  if(cand){
    check('진행 코트 선수 교체',send({type:'official-active-replace',matchId:m.id,
      outPlayerId:out,inPlayerId:cand.id,expectedStartedAt:m.startedAt,
      expectedPlayerIds:[...m.playerIds]},at(),'areplace'));
  }
  const m2=S().event.active[1];
  check('경기 취소',send({type:'official-court-cancel',matchId:m2.id,
    expectedStartedAt:m2.startedAt,expectedPlayerIds:[...m2.playerIds]},at(),'cancel'));
  enterFree(at(),'after_cancel');
  const m3=S().event.active[0];
  check('경기 종료',send({type:'official-court-complete',token:'done_sim',matchId:m3.id,
    court:m3.court,expectedStartedAt:m3.startedAt,expectedPlayerIds:[...m3.playerIds]},at(),'complete'));
  check('경기 종료 되돌리기',send({type:'official-court-complete-undo',token:'done_sim'},at(),'undo'));
}

// 7) 마무리 전환 — 이후 새 대진이 자동 생성되지 않아야 함
t=60;
{
  check('🏁 마무리 전환',send({type:'official-finish-mode',finishMode:true},at(),'finish'));
  assert.strictEqual(S().event.finishMode,true);
  const before=S().event.next.length;
  replenishPrepared(S(),{now:at(),requestId:'after_finish'});
  assert(S().event.next.length<=before,'마무리 후에는 새 대진이 늘면 안 됩니다.');
  check('🏁 마무리 해제',send({type:'official-finish-mode',finishMode:false},at(),'unfinish'));
}

// ── 결과 ──────────────────────────────────────────────────────────────
const failed=results.filter(r=>!r.ok);
console.log(`\n=== 임원 조작 통합 시뮬 · ${COURTS}코트 · ${results.length}개 조작 ===`);
results.forEach(r=>console.log(`  ${r.ok?'OK  ':'FAIL'} ${r.label}${r.detail&&r.ok?` (${r.detail})`:''}`));
console.log(`\n진행 ${S().event.active.length}코트 · 대기 ${S().event.next.length}개 · 명단 ${S().players.length}명`);
assert.strictEqual(failed.length,0,'실패한 조작이 있습니다.');
console.log('sim official ops ok — 모든 조작 정상, 불변식 유지');
