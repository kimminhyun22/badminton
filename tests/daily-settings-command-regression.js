'use strict';
/**
 * 운영 설정도 서버 명령(official-settings-update)으로 모읍니다.
 *
 * 운영자 판단 ③ — 준비 단계를 "잠그지" 않습니다. 현장 융통성은 그대로 두고,
 * 기록하는 주체만 서버로 옮깁니다. 그래서 잠금이 아니라 명령 신설입니다.
 *
 * 지금 이 명령이 받는 것은 코트 수뿐입니다. 운영 시간과 자동 진행은 일부러
 * 뺐습니다 — 관리자 게시 payload(_dailyPublicEvent)가 queuePolicy.auto 를 매번
 * 다시 계산해 덮어쓰고 운영 시간은 아예 싣지 않아서, 서버에 저장해도 다음 게시
 * 한 번에 사라집니다. 화면을 되살릴 때 payload 부터 같이 고치고 추가하십시오.
 *
 * 여기서 지키는 것:
 *   1) 관리자 연결이면 코트 수를 바꿀 수 있다
 *   2) 정식 임원도 같은 명령으로 바꿀 수 있다
 *   3) 축소 시 진행 경기는 끝까지 두고 초과 코트만 배수한다
 *   4) 증설 시 새 빈 코트를 즉시 채운다
 *   5) 사라질 값을 저장한 척하지 않는다
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {applyOfficialRequest, issueOfficialGrant} = require('../functions/daily-official-engine');

const root = path.join(__dirname, '..');
const daily = fs.readFileSync(path.join(root, 'js', 'daily.js'), 'utf8');
const checkin = fs.readFileSync(path.join(root, 'checkin.html'), 'utf8');
const {replenishPrepared} = require('../functions/daily-server-matchmaker');

const NOW = 1_830_000_000_000;
const SESSION_ID = 'DSET001';
const SECRET = 'settings-command-regression-secret-at-least-32-bytes';

const adminGrant = issueOfficialGrant({
  v:1, sid:SESSION_ID, cid:'admin-client', iat:NOW-1000, exp:NOW+60*60*1000
}, SECRET);
const officialGrant = issueOfficialGrant({
  v:1, sid:SESSION_ID, cid:'official-client', pid:'p9', iat:NOW-1000, exp:NOW+60*60*1000
}, SECRET);
const secondOfficialGrant = issueOfficialGrant({
  v:1, sid:SESSION_ID, cid:'official-client-2', pid:'p10', iat:NOW-1000, exp:NOW+60*60*1000
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

function makeSession(active){
  return {
    serverSessionId:SESSION_ID, serverRevision:0, commandProtocol:2,
    expiresAt:NOW+48*60*60*1000,
    capabilities:{officialOpsServerV2:true},
    players:[
      player('p1','가선수'), player('p2','나선수'), player('p3','다선수'), player('p4','라선수'),
      player('p9','임원선수',{isClubOfficial:true})
    ],
    reservations:[], arrivalCandidates:[],
    serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
    event:{
      courts:3, nextTarget:0, completed:0, finishMode:false, operationStarted:true,
      queuePolicy:{official:0, auto:true},
      active:active || [], next:[], expected:[], serverStandby:[]
    }
  };
}

function sendTo(session, patch, {admin = true, at = NOW + 1000, actorId = 'p9', grantToken = officialGrant} = {}){
  return applyOfficialRequest(session, {
    type:patch.type || 'official-settings-update',
    operationId:'set_'+Math.random().toString(36).slice(2,9),
    commandProtocol:2,
    actorPlayerId:admin ? '' : actorId,
    actorPlayerName:admin ? '관리자' : '임원선수',
    officialGrantToken:admin ? adminGrant : grantToken,
    createdAt:at,
    expiresAt:at+30*60*1000,
    ...patch
  }, {now:at, grantSecret:SECRET, checkinId:SESSION_ID, adminClaim:admin});
}

function send(patch, {admin = true, active = null} = {}){
  return sendTo(makeSession(active), patch, {admin});
}

// 1) 관리자는 셋 다 바꿀 수 있습니다.
{
  const result = send({courts:5, expectedCourts:3});
  assert.strictEqual(result.status, 'applied', `설정 변경이 적용되어야 합니다: ${result.reason || ''}`);
  assert.strictEqual(result.session.event.courts, 5, '코트 수가 반영되어야 합니다.');
  assert.deepStrictEqual(Object.keys(result.result.settings).sort(), ['courts'],
    '관리자 원본이 따라 그릴 수 있도록 바뀐 값을 결과로 돌려줘야 합니다.');
  // 운영 시간·자동 진행은 일부러 받지 않습니다. 게시 payload 가 매번 덮어쓰기 때문입니다.
  const ignored = send({courts:4, expectedCourts:3, operatingStart:'19:30', autoAssign:false});
  assert.deepStrictEqual(Object.keys(ignored.result.settings).sort(), ['courts'],
    '게시 때 사라질 값을 저장한 척하면 안 됩니다.');
  console.log('  관리자 설정 변경: applied', JSON.stringify(result.result.settings));
}

// 2) 설정 변경도 임원에게 열렸습니다(운영자 2026-08-10 "관리자와 동일한 기능").
{
  const result = send({courts:5}, {admin:false});
  assert.strictEqual(result.status, 'applied', `임원 설정 변경이 적용되어야 합니다: ${result.reason||''}`);
  console.log('  임원 설정 변경: applied (2026-08-10 개방)');
}

// 3) 진행 중 축소는 현재 경기를 보존한 채 높은 번호 코트부터 배수합니다.
{
  const s=makeSession();
  s.capabilities.officialAutoHandoffV1=true;
  s.players=[player('p9','임원선수',{isClubOfficial:true}),
    ...Array.from({length:40},(_,i)=>player(`d${i+1}`,`가명${i+1}`))];
  s.event.courts=4;
  s.event.nextTarget=4;
  s.event.queuePolicy={official:4,auto:true};
  s.serverRuntime.nextSeq=5;
  s.event.active=Array.from({length:4},(_,index)=>{
    const ids=Array.from({length:4},(__,offset)=>`d${index*4+offset+1}`);
    ids.forEach(id=>{const p=s.players.find(row=>row.id===id);p.status='playing';p.currentMatchId=`m${index+1}`;});
    return {id:`m${index+1}`,court:index+1,seq:index+1,startedAt:NOW-5*60*1000,
      expectedMinutes:15,endAt:NOW+10*60*1000,playerIds:ids,t1Ids:ids.slice(0,2),t2Ids:ids.slice(2)};
  });
  replenishPrepared(s,{now:NOW,requestId:'seed_resize'});
  assert.strictEqual(s.event.next.filter(item=>!item.manualComposed).length,4,'축소 전 자동 다음 대진 4개가 있어야 합니다.');
  const occupied=new Set([...s.event.active,...s.event.next].flatMap(item=>item.playerIds||[]));
  const manualIds=s.players.filter(p=>p.id!=='p9'&&!occupied.has(p.id)).slice(0,4).map(p=>p.id);
  assert.strictEqual(manualIds.length,4,'직접 편성 보존을 시험할 여유 선수가 있어야 합니다.');
  s.event.next.push({id:'manual_resize',queueId:'manual_resize',manualComposed:true,
    playerIds:manualIds,t1Ids:manualIds.slice(0,2),t2Ids:manualIds.slice(2)});

  const reduced=sendTo(s,{courts:3,expectedCourts:4},{admin:false});
  assert.strictEqual(reduced.status,'applied',`진행 중 축소가 적용되어야 합니다: ${reduced.reason||''}`);
  assert.strictEqual(reduced.session.event.courts,3,'운영 목표는 즉시 3코트로 바뀌어야 합니다.');
  assert.deepStrictEqual(reduced.result.courtAdjustment.drainingCourts,[4],'4코트는 현재 경기 뒤 닫혀야 합니다.');
  assert.strictEqual(reduced.session.event.active.length,4,'4코트의 현재 경기를 취소하면 안 됩니다.');
  assert.strictEqual(reduced.session.event.next.filter(item=>!item.manualComposed).length,3,'자동 다음 대진은 새 코트 수에 맞춰야 합니다.');
  assert(reduced.session.event.next.some(item=>item.queueId==='manual_resize'),'코트 축소가 임원이 직접 짠 대진을 지우면 안 됩니다.');

  const court1=reduced.session.event.active.find(match=>match.court===1);
  const lowerDone=sendTo(reduced.session,{type:'official-court-complete',matchId:court1.id,
    expectedStartedAt:court1.startedAt,expectedPlayerIds:[...court1.playerIds]},{admin:false,at:NOW+2000});
  assert.strictEqual(lowerDone.status,'applied',lowerDone.reason||'낮은 번호 코트 종료가 적용되어야 합니다.');
  assert.deepStrictEqual(lowerDone.session.event.active.map(match=>match.court).sort((a,b)=>a-b),[1,2,3,4],
    '배수 중에도 목표 범위 안의 빈 코트는 채우고 4코트 현재 경기는 유지해야 합니다.');
  assert((lowerDone.result.autoEntries||[]).every(entry=>entry.court<=3),'닫는 코트에 새 경기를 투입하면 안 됩니다.');

  const court4=lowerDone.session.event.active.find(match=>match.court===4);
  const drained=sendTo(lowerDone.session,{type:'official-court-complete',matchId:court4.id,
    expectedStartedAt:court4.startedAt,expectedPlayerIds:[...court4.playerIds]},{admin:false,at:NOW+3000});
  assert.strictEqual(drained.status,'applied',drained.reason||'닫는 코트 종료가 적용되어야 합니다.');
  assert.deepStrictEqual(drained.session.event.active.map(match=>match.court).sort((a,b)=>a-b),[1,2,3],
    '4코트 종료 뒤에는 3코트만 운용해야 합니다.');

  const expanded=sendTo(drained.session,{courts:4,expectedCourts:3},{admin:false,at:NOW+4000});
  assert.strictEqual(expanded.status,'applied',expanded.reason||'운영 중 증설이 적용되어야 합니다.');
  assert(expanded.result.autoEntries?.some(entry=>entry.court===4),'늘린 4코트는 즉시 자동 투입해야 합니다.');
  assert.deepStrictEqual(expanded.session.event.active.map(match=>match.court).sort((a,b)=>a-b),[1,2,3,4]);

  const reducedAfterAutoFill=sendTo(expanded.session,{courts:3,expectedCourts:4},{admin:false,at:NOW+5000});
  assert.strictEqual(reducedAfterAutoFill.status,'applied','방금 자동 투입된 4코트도 우선 배수 상태로 바뀌어야 합니다.');
  const freshCourt4=reducedAfterAutoFill.session.event.active.find(match=>match.court===4);
  assert(freshCourt4?.autoHandoffAt,'4코트에는 2분 대응 창이 남은 자동 투입 경기가 있어야 합니다.');
  const closedNow=sendTo(reducedAfterAutoFill.session,{
    type:'official-active-yield',matchId:freshCourt4.id,court:4,token:'close_draining_court_token',
    expectedStartedAt:freshCourt4.startedAt,expectedAutoHandoffAt:freshCourt4.autoHandoffAt,
    expectedPlayerIds:[...freshCourt4.playerIds],expectedTeam1Ids:[...freshCourt4.t1Ids],expectedTeam2Ids:[...freshCourt4.t2Ids]
  },{admin:false,at:NOW+6000});
  assert.strictEqual(closedNow.status,'applied',closedNow.reason||'방금 투입된 배수 코트는 즉시 닫을 수 있어야 합니다.');
  assert.deepStrictEqual(closedNow.session.event.active.map(match=>match.court).sort((a,b)=>a-b),[1,2,3],
    '지금 닫기 뒤에는 목표 코트만 진행 중이어야 합니다.');
  assert.strictEqual(closedNow.result.autoEntered,false,'닫는 코트에 대체 경기를 다시 투입하면 안 됩니다.');
  assert.deepStrictEqual(closedNow.result.drainingCourtClosed,{court:4,targetCourts:3},'즉시 닫은 코트와 목표 코트를 결과에 남겨야 합니다.');
  assert.strictEqual(closedNow.result.deferred.queueIndex,2,'되돌린 경기는 대기 순서에서 한 칸만 뒤로 가야 합니다.');
  assert.strictEqual(closedNow.session.event.next.filter(item=>!item.manualComposed).length,3,'즉시 닫은 뒤에도 자동 대기 수는 3코트 목표를 지켜야 합니다.');
  assert(closedNow.session.event.next.some(item=>item.queueId==='manual_resize'),'즉시 닫아도 직접 편성 대진을 지우면 안 됩니다.');
  const restoredIds=new Set(freshCourt4.playerIds);
  assert(closedNow.session.players.filter(player=>restoredIds.has(player.id)).every(player=>player.status==='wait'&&!player.currentMatchId),
    '즉시 닫은 경기의 네 선수는 대기 상태로 돌아가야 합니다.');
  const duplicateClose=sendTo(closedNow.session,{
    type:'official-active-yield',matchId:freshCourt4.id,court:4,token:'duplicate_close_draining_court_token',
    expectedStartedAt:freshCourt4.startedAt,expectedAutoHandoffAt:freshCourt4.autoHandoffAt,
    expectedPlayerIds:[...freshCourt4.playerIds],expectedTeam1Ids:[...freshCourt4.t1Ids],expectedTeam2Ids:[...freshCourt4.t2Ids]
  },{admin:false,at:NOW+6001});
  assert.strictEqual(duplicateClose.status,'rejected','두 임원이 같은 코트를 동시에 닫아도 두 번째 처리는 거절되어야 합니다.');
  assert.strictEqual(duplicateClose.session.serverRevision,closedNow.session.serverRevision,'중복 즉시 닫기가 서버 상태를 한 번 더 진행하면 안 됩니다.');
  console.log('  진행 중 코트 조정: 4→3 배수 · 3코트 유지 · 3→4 즉시 투입 · 방금 투입 코트 즉시 닫기');
}

// 3b) 두 임원이 같은 화면에서 동시에 바꾸면 먼저 확정된 값만 남깁니다.
{
  const s=makeSession();
  s.players.push(player('p10','다른임원',{isClubOfficial:true}));
  const first=sendTo(s,{courts:2,expectedCourts:3},{admin:false,actorId:'p9'});
  assert.strictEqual(first.status,'applied');
  const stale=sendTo(first.session,{courts:1,expectedCourts:3},
    {admin:false,at:NOW+2000,actorId:'p10',grantToken:secondOfficialGrant});
  assert.strictEqual(stale.status,'rejected','동시에 누른 옛 코트 수 요청은 거절되어야 합니다.');
  assert.strictEqual(stale.session.event.courts,2,'먼저 확정된 코트 수를 뒤 요청이 덮으면 안 됩니다.');
  console.log('  동시 임원 코트 변경: 먼저 확정된 요청 유지');
}

// 4) 형식·정합성이 틀리면 거절합니다.
const badCases = [
  [{courts:0}, '코트 수 하한'],
  [{courts:13}, '코트 수 상한'],
  [{}, '바꿀 값 없음'],
  [{courts:5, expectedCourts:9}, '기대한 코트 수 불일치']
];
badCases.forEach(([patch, label])=>{
  const result = send(patch);
  assert.strictEqual(result.status, 'rejected', `${label}은 거절되어야 합니다. 실제: ${result.status}`);
  console.log(`  ${label}: rejected (${result.reason})`);
});

// 5) 관리자 화면이 이 명령을 쓰고, 서버가 확정한 값만 되받는지 봅니다.
assert(daily.includes("type:'official-settings-update'"), '관리자 화면이 설정 명령을 보내야 합니다.');
assert(daily.includes('function _dailyApplyOfficialSettings'), '서버가 확정한 설정을 되받는 경로가 있어야 합니다.');
const applyStart = daily.indexOf('function _dailyApplyOfficialSettings');
const applyEnd = daily.indexOf('function _dailyApplyTemporaryOfficial', applyStart);
const applySource = daily.slice(applyStart, applyEnd);
assert(applySource.includes('req.serverResult?.settings'),
  '보낸 값이 아니라 서버가 적용한 값을 받아야 합니다.');
assert(checkin.includes('줄이면 초과 코트는 현재 경기 종료 후 닫힙니다.'),
  '임원은 코트를 줄이기 전에 현재 경기 보존 방식을 알아야 합니다.');
assert(checkin.includes("방금 투입된 경기는 2분 안에 '지금 닫기'로 되돌릴 수 있습니다."),
  '코트 축소 입력창은 방금 자동 투입된 경기의 즉시 닫기 방법도 알려야 합니다.');
assert(checkin.includes("drainingCourt?'지금 닫기':'이번만 뒤로'")&&checkin.includes("if(court>Math.max(1,Number(session?.event?.courts)||1))return true;"),
  '배수 중인 자동 투입 코트에는 대체 경기 없이도 지금 닫기 버튼이 보여야 합니다.');
assert(checkin.includes("operation==='active-yield'&&getLastComplete()?.drainingCourt")&&checkin.includes('`${undoLabel} 취소 요청`'),
  '즉시 닫기 되돌리기 안내도 기존 이번만 뒤로와 구분해야 합니다.');
assert(daily.includes('const drainingCourtClosed=!!result.drainingCourtClosed')&&daily.includes("m.cancelReason=drainingCourtClosed?'club-official-draining-court-close'"),
  '관리자 원본은 즉시 닫기 결과를 대체 경기 없는 정상 명령으로 따라가야 합니다.');
assert(checkin.includes('event-court-drain-badge')&&checkin.includes('종료 후 닫힘'),
  '임원 화면은 배수 중인 코트를 짧게 표시해야 합니다.');
assert(daily.includes('daily-court-drain-badge')&&daily.includes('종료 후 닫힘'),
  '관리자 화면도 배수 중인 코트를 표시해야 합니다.');
assert(daily.includes("drainingCourts.length?`${active}→${courts}`"),
  '관리자 진행 요약은 4/3 같은 오류 모양 대신 배수 방향을 보여야 합니다.');
console.log('  관리자 화면 연결 확인');

console.log('\ndaily settings command regression ok');
