'use strict';
/**
 * '입장 처리'가 정말 필요한가?
 * 경기 종료 시 서버 자동 투입(auto-handoff)이 언제 건너뛰는지 확인한다.
 */
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const REPO = process.env.SIM_ENGINE_ROOT || path.join(__dirname, '..');
const {canonicalJson, issueOfficialGrant, refreshEvent} = require(`${REPO}/functions/daily-official-engine`);
const {replenishPrepared} = require(`${REPO}/functions/daily-server-matchmaker`);
const {applyCommandTransaction} = require(`${REPO}/functions/daily-official-command`);

const NOW = 1_830_000_000_000;
const CHECKIN = 'DENTER01', CLIENT = 'official_enter_client';
const SECRET = 'enter-need-secret', ACTOR = '임원';
const hash = v => crypto.createHash('sha256').update(canonicalJson(v)).digest('hex');

function mk(id, name, extra = {}){
  return {
    id, name, gender:'M', level:4, ageGroup:'40대', grade:'C',
    status:'wait', statusLabel:'wait', locked:false, currentMatchId:'', afterMatchStatus:'',
    games:0, fairExpected:0, mixedGames:0, typeTrackedGames:0, lastPlayedSeq:0,
    partnerCount:{}, opponentCount:{}, partnerCountById:{}, opponentCountById:{},
    joinedAt:NOW, waitFrom:NOW, lastStatusAt:NOW-1000, restPausedMs:0,
    preArrivalVisible:false, registrationCancelled:false,
    isClubOfficial:name===ACTOR, isTemporaryOfficial:false, isGuest:false,
    partnerName:'', partnerId:'', ...extra
  };
}

function build(){
  const players = [mk('o', ACTOR)];
  for(let i=1;i<=11;i++)players.push(mk('p'+i, '선수'+i));
  const grant = issueOfficialGrant({v:1,sid:CHECKIN,cid:CLIENT,pid:'o',iat:NOW-1000,exp:NOW+48*3600_000}, SECRET);
  return {grant, state:{
    session:{
      serverSessionId:CHECKIN, commandProtocol:2, serverRevision:0, matchStartedAt:NOW,
      expiresAt:NOW+48*3600_000, officialInvite:{tokenHash:'a'.repeat(64),expiresAt:NOW+48*3600_000},
      capabilities:{officialOpsServerV2:true, officialAutoHandoffV1:true, memberStatusServerV1:true},
      players, reservations:[], arrivalCandidates:[],
      serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
      event:{courts:1, nextTarget:1, serverExpectedGoal:0, completed:0, finishMode:false,
        operationStarted:true, queuePolicy:{official:1, auto:true},
        active:[], next:[], expected:[], serverStandby:[]}
    },
    officialClaims:{[CLIENT]:{clientId:CLIENT,expiresAt:NOW+48*3600_000,claimMode:'roster',officialPlayerId:'o'}}
  }};
}

function submit(ctx, extra, now, label){
  const operationId = `e_${label}_${String(ctx.i++).padStart(4,'0')}`;
  const stored = {actorPlayerId:'o', actorPlayerName:ACTOR, createdAt:now,
    expiresAt:now+30*60_000, source:'enter-need', operationId, ...extra};
  const out = applyCommandTransaction(ctx.state, {
    storedCommand:stored, engineCommand:{...stored, officialGrantToken:ctx.grant}, operationId,
    payloadHash:hash(stored), clientId:CLIENT, grantPlayerId:'o', now,
    checkinId:CHECKIN, grantSecret:SECRET});
  assert.strictEqual(out.action, 'commit', `${label}: ${out.failureMessage||''}`);
  ctx.state = out.current;
  return out;
}

function scenario(label, breakNext){
  const root = build();
  const ctx = {state:root.state, grant:root.grant, i:1};
  const s = () => ctx.state.session;

  // 1) 운영 시작: 첫 대진은 '입장 처리'로만 들어갑니다(끝난 경기가 없으니 자동 트리거가 없음)
  replenishPrepared(s(), {now:NOW, requestId:'e_init'});
  refreshEvent(s(), NOW);
  const first = s().event.next.find(r=>r.cueState==='free'&&r.targetCourt);
  const startedWithoutEnter = !!s().event.active.length;
  submit(ctx, {type:'official-queue-enter-free', token:'t1', queueId:first.queueId||first.id,
    court:first.targetCourt, newMatchId:'m1',
    expectedQueueIndex:s().event.next.indexOf(first)+1, expectedHoldId:first.targetHoldId||'',
    expectedPlayerIds:[...first.playerIds], expectedTeam1Ids:[...first.t1Ids], expectedTeam2Ids:[...first.t2Ids]},
    NOW, 'enter1');

  // 2) 다음 대진 한 명을 휴식 처리(원하면)
  refreshEvent(s(), NOW+60000);
  const queued = s().event.next[0];
  let rested = null;
  if(breakNext && queued){
    rested = s().players.find(p=>queued.playerIds.includes(p.id));
    submit(ctx, {type:'official-player-status', playerId:rested.id, playerName:rested.name,
      status:'rest', expectedStatus:rested.status, expectedCurrentMatchId:'',
      expectedLastStatusAt:rested.lastStatusAt}, NOW+61000, 'rest');
  }

  // 3) 경기 종료 → 자동 투입이 되는가?
  const active = s().event.active[0];
  submit(ctx, {type:'official-court-complete', token:'c1', matchId:active.id, court:active.court,
    expectedStartedAt:active.startedAt, expectedPlayerIds:[...active.playerIds]}, NOW+900000, 'complete');
  refreshEvent(s(), NOW+900000);

  const nowActive = s().event.active.length;
  const freeQueued = (s().event.next||[]).filter(r=>r.cueState==='free'&&r.targetCourt).length;
  console.log(`\n【${label}】`);
  console.log(`  운영 시작 시 '입장 처리' 없이 경기가 있었나: ${startedWithoutEnter ? '있음' : '없음 ← 첫 대진은 입장 처리 필수'}`);
  if(rested)console.log(`  다음 대진의 ${rested.name} 를 휴식 처리함`);
  console.log(`  경기 종료 후 진행 중 코트: ${nowActive}개  →  ${nowActive ? '자동 투입됨' : '★ 코트가 빈 채로 남음'}`);
  console.log(`  '입장 처리' 버튼이 뜨는 대진: ${freeQueued}건`);
  assert.strictEqual(nowActive, 1, `${label}: 경기 종료 뒤 코트가 자동으로 채워져야 합니다.`);
  assert.strictEqual(freeQueued, 0, `${label}: 자동 투입이 끝나면 '입장 처리'가 남으면 안 됩니다.`);
}

scenario('정상 — 다음 대진 4명 모두 대기', false);
scenario('다음 대진 한 명이 휴식 중', true);

// 시나리오 3: 운영 중에 코트를 늘리면?
{
  const root = build();
  const ctx = {state:root.state, grant:root.grant, i:1};
  const s = () => ctx.state.session;
  replenishPrepared(s(), {now:NOW, requestId:'x_init'});
  refreshEvent(s(), NOW);
  const first = s().event.next.find(r=>r.cueState==='free'&&r.targetCourt);
  submit(ctx, {type:'official-queue-enter-free', token:'t1', queueId:first.queueId||first.id,
    court:first.targetCourt, newMatchId:'m1',
    expectedQueueIndex:s().event.next.indexOf(first)+1, expectedHoldId:first.targetHoldId||'',
    expectedPlayerIds:[...first.playerIds], expectedTeam1Ids:[...first.t1Ids], expectedTeam2Ids:[...first.t2Ids]},
    NOW, 'enter1');
  // 관리자가 코트를 1 → 2로 늘림 (게시로 반영)
  s().event.courts = 2; s().event.nextTarget = 2;
  replenishPrepared(s(), {now:NOW+120000, requestId:'x_grow'});
  refreshEvent(s(), NOW+120000);
  console.log('\n【운영 중 코트를 1 → 2로 늘린 직후】');
  console.log(`  진행 중 코트: ${s().event.active.length}개`);
  // 임원이 아무 동작이나 하면(여기서는 회원 상태 변경) 빈 코트가 채워져야 합니다
  const idle = s().players.find(pl=>pl.status==='wait'&&pl.id!=='o');
  submit(ctx, {type:'official-player-status', playerId:idle.id, playerName:idle.name,
    status:'rest', expectedStatus:idle.status, expectedCurrentMatchId:'',
    expectedLastStatusAt:idle.lastStatusAt}, NOW+130000, 'anyop');
  refreshEvent(s(), NOW+130000);
  const active = s().event.active.length;
  const freeQueued = (s().event.next||[]).filter(r=>r.cueState==='free'&&r.targetCourt).length;
  console.log('  임원이 다른 동작(회원 상태 변경)을 한 뒤');
  console.log(`  진행 중 코트: ${active}개  →  ${active>=2 ? '★ 자동으로 채워짐' : '아직 비어 있음'}`);
  console.log(`  '입장 처리' 버튼이 뜨는 대진: ${freeQueued}건  →  ${freeQueued ? '★ 임원이 눌러야 시작됨' : '자동으로 채워짐'}`);
  assert.strictEqual(active, 2, '코트를 늘린 뒤 임원이 무슨 동작이든 하면 빈 코트가 채워져야 합니다.');
  assert.strictEqual(freeQueued, 0, "코트 증설 뒤에도 '입장 처리'가 남으면 안 됩니다.");
}
console.log('\nauto enter regression ok');
