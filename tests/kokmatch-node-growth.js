'use strict';
/**
 * live/checkin_<id> 노드 크기 증가 측정.
 * 모든 임원/회원 명령은 이 노드 '전체'를 트랜잭션으로 읽고 다시 쓴다.
 * requests / serverCommands 가 정리되지 않으면 노드가 계속 커진다.
 */
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const REPO = process.env.SIM_ENGINE_ROOT || path.join(__dirname, '..');
const {canonicalJson, issueOfficialGrant, refreshEvent} = require(`${REPO}/functions/daily-official-engine`);
const {replenishPrepared} = require(`${REPO}/functions/daily-server-matchmaker`);
const {applyCommandTransaction} = require(`${REPO}/functions/daily-official-command`);
const {applyMemberCommandTransaction} = require(`${REPO}/functions/daily-member-command`);

const BASE_NOW = 1_830_000_000_000;
const MATCH_MINUTES = 15, COURTS = 3, WAVES = 16;
const CHECKIN_ID = 'DGROWTH1', CLIENT_ID = 'official_growth_client';
const SECRET = 'kokmatch-node-growth-secret', ACTOR_NAME = '김민현';

const ROSTER = [
  ['강연수','F','D','40대'], ['곽유진','M','C','30대'], ['권혁창','M','A','40대'],
  ['김병철','M','C','50대'], ['김민정','F','C','40대'], ['김민현','M','D','40대'],
  ['김석','M','B','40대'],   ['김원옥','F','D','40대'], ['김은숙','F','C','40대'],
  ['김주영','M','C','30대'], ['김진아','F','D','40대'], ['김태원','M','E','40대'],
  ['김하주','M','S','40대'], ['남경란','F','C','40대'], ['노경록','M','E','40대'],
  ['도재준','M','C','50대'], ['민상기','M','B','50대'], ['박수진','F','D','50대'],
  ['안승희','M','D','40대'], ['우연정','F','C','40대'], ['이상우','M','A','40대'],
  ['이범영','M','A','50대'], ['이민수','M','B','40대'], ['이은하','F','A','40대'],
  ['이준원','M','D','40대'], ['이혜련','F','D','50대'], ['장봉수','M','B','40대'],
  ['장희선','F','B','40대'], ['정동수','M','C','50대'], ['정영례','F','C','40대'],
  ['차재풍','M','C','50대'], ['천희주','M','D','50대'], ['최시복','M','C','40대'],
  ['최영연','M','C','20대'], ['최영훈','M','B','50대'], ['홍승철','M','A','40대']
];
const GRADE_LEVEL = {S:7,A:6,B:5,C:4,D:3,E:2};
const hash = v => crypto.createHash('sha256').update(canonicalJson(v)).digest('hex');
const kb = obj => (Buffer.byteLength(JSON.stringify(obj),'utf8')/1024).toFixed(1);

function makeRoot(){
  const players = ROSTER.map(([name,gender,grade,ageGroup],i)=>({
    id:`p${String(i+1).padStart(2,'0')}`, memberId:`member_p${i+1}`, name, gender, grade,
    level:Math.max(1, GRADE_LEVEL[grade]-(gender==='F'?1:0)), ageGroup, isGuest:false,
    status:'wait', statusLabel:'wait', preArrivalVisible:false, registrationCancelled:false,
    locked:false, currentMatchId:'', afterMatchStatus:'', games:0, fairExpected:0,
    mixedGames:0, typeTrackedGames:0, lastPlayedSeq:0,
    partnerCount:{}, opponentCount:{}, partnerCountById:{}, opponentCountById:{},
    joinedAt:BASE_NOW, waitFrom:BASE_NOW, lastStatusAt:BASE_NOW-1000, restPausedMs:0,
    isClubOfficial:name===ACTOR_NAME, isTemporaryOfficial:false
  }));
  const actor = players.find(r=>r.name===ACTOR_NAME);
  const grant = issueOfficialGrant({v:1,sid:CHECKIN_ID,cid:CLIENT_ID,pid:actor.id,iat:BASE_NOW-1000,exp:BASE_NOW+48*3600_000}, SECRET);
  return {actorId:actor.id, grant, current:{
    session:{
      serverSessionId:CHECKIN_ID, commandProtocol:2, serverRevision:0, matchStartedAt:BASE_NOW,
      expiresAt:BASE_NOW+48*3600_000, officialInvite:{tokenHash:'a'.repeat(64),expiresAt:BASE_NOW+48*3600_000},
      capabilities:{officialOpsServerV2:true, officialAutoHandoffV1:true, officialOperationUndoV1:true, memberStatusServerV1:true},
      players, reservations:[], arrivalCandidates:[],
      serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
      event:{courts:COURTS,nextTarget:COURTS,serverExpectedGoal:0,completed:0,finishMode:false,
        operationStarted:true,queuePolicy:{official:COURTS,auto:true},active:[],next:[],expected:[],serverStandby:[]}
    },
    officialClaims:{[CLIENT_ID]:{clientId:CLIENT_ID,expiresAt:BASE_NOW+48*3600_000,claimMode:'roster',officialPlayerId:actor.id}}
  }};
}

function submit(ctx, extra, now, label){
  const operationId = `g_${label}_${String(ctx.operationIndex++).padStart(5,'0')}`;
  const stored = {actorPlayerId:ctx.actorId, actorPlayerName:ACTOR_NAME, createdAt:now,
    expiresAt:now+30*60_000, source:'growth', operationId, ...extra};
  const outcome = applyCommandTransaction(ctx.state, {
    storedCommand:stored, engineCommand:{...stored, officialGrantToken:ctx.grant}, operationId,
    payloadHash:hash(stored), clientId:CLIENT_ID, grantPlayerId:ctx.actorId, now,
    checkinId:CHECKIN_ID, grantSecret:SECRET});
  assert.strictEqual(outcome.action,'commit',`${label}: ${outcome.failureMessage||''}`);
  ctx.state = outcome.current;
}

// 회원 상태 변경(휴식→복귀)을 흉내내 requests/serverCommands 누적을 함께 본다
function memberTap(ctx, player, status, now, label){
  const operationId = `m_${label}_${String(ctx.operationIndex++).padStart(5,'0')}`;
  const stored = {type:'member-player-status', operationId, actorPlayerId:player.id, playerId:player.id,
    playerName:player.name, status, statusLabel:status, expectedStatus:player.status||'',
    expectedCurrentMatchId:player.currentMatchId||'', expectedLastStatusAt:Number(player.lastStatusAt||0),
    createdAt:now, expiresAt:now+5*60_000, source:'member-checkin-server'};
  const outcome = applyMemberCommandTransaction(ctx.state, {storedCommand:stored, operationId,
    payloadHash:hash(stored), now, checkinId:CHECKIN_ID});
  if(outcome.action==='commit')ctx.state = outcome.current;
  return outcome;
}

const root = makeRoot();
const ctx = {state:root.current, actorId:root.actorId, grant:root.grant, operationIndex:1};

replenishPrepared(ctx.state.session,{now:BASE_NOW,requestId:'g_init'});
refreshEvent(ctx.state.session, BASE_NOW);
for(let c=0;c<COURTS;c++){
  refreshEvent(ctx.state.session, BASE_NOW);
  const item = ctx.state.session.event.next.find(r=>r.cueState==='free'&&r.targetCourt);
  if(!item)break;   // 첫 투입 뒤 남은 코트는 서버가 알아서 채웁니다
  submit(ctx,{type:'official-queue-enter-free',token:`init_${c+1}`,queueId:item.queueId||item.id,
    court:item.targetCourt,newMatchId:`init_match_${c+1}`,
    expectedQueueIndex:ctx.state.session.event.next.indexOf(item)+1,expectedHoldId:item.targetHoldId||'',
    expectedPlayerIds:[...item.playerIds],expectedTeam1Ids:[...item.t1Ids],expectedTeam2Ids:[...item.t2Ids]},
    BASE_NOW,`init_${c+1}`);
}

console.log('회차 | 노드 KB | session KB | requests | serverCommands | requests+cmds KB');
const startKb = Number(kb(ctx.state));
for(let wave=1;wave<=WAVES;wave++){
  const now = BASE_NOW + wave*MATCH_MINUTES*60_000;
  const matches = ctx.state.session.event.active.slice().sort((a,b)=>a.court-b.court);
  for(const m of matches){
    submit(ctx,{type:'official-court-complete',token:`c_${wave}_${m.court}`,matchId:m.id,court:m.court,
      expectedStartedAt:m.startedAt,expectedPlayerIds:[...m.playerIds]},now,`c_${wave}_${m.court}`);
  }
  // 회원 탭 흉내: 대기중 6명이 휴식→복귀
  const waiting = ctx.state.session.players.filter(p=>p.status==='wait'&&!p.currentMatchId).slice(0,6);
  for(const p of waiting){
    memberTap(ctx, p, 'rest', now+1000, `r${wave}_${p.id}`);
    const fresh = ctx.state.session.players.find(r=>r.id===p.id);
    if(fresh) memberTap(ctx, fresh, 'wait', now+2000, `w${wave}_${p.id}`);
  }
  const reqCount = Object.keys(ctx.state.requests||{}).length;
  const cmdCount = Object.keys(ctx.state.serverCommands||{}).length;
  const tailKb = kb({requests:ctx.state.requests||{}, serverCommands:ctx.state.serverCommands||{}});
  console.log(`${String(wave).padStart(4)} | ${String(kb(ctx.state)).padStart(7)} | ${String(kb(ctx.state.session)).padStart(10)} | ${String(reqCount).padStart(8)} | ${String(cmdCount).padStart(14)} | ${String(tailKb).padStart(16)}`);
}
const endKb = Number(kb(ctx.state));
console.log(`\n시작 ${startKb}KB → 종료 ${endKb}KB (${(endKb/startKb).toFixed(1)}배)`);
console.log(`이 노드 전체가 명령 1건마다 다운로드 → 병합 → 업로드된다 (ref.transaction).`);
console.log(`회원 1탭 왕복 트래픽 ≈ ${(endKb*2/1024).toFixed(2)}MB (읽기+쓰기, 종료 시점 기준)`);

console.log('\n── 노드 구성 (KB) ──');
Object.keys(ctx.state).forEach(k=>console.log(`  ${k.padEnd(18)} ${kb(ctx.state[k])}`));
const cmds = ctx.state.serverCommands||{};
const cmdKeys = Object.keys(cmds);
console.log(`  serverCommands 1건 평균 ${(Buffer.byteLength(JSON.stringify(cmds),'utf8')/Math.max(1,cmdKeys.length)/1024).toFixed(2)}KB`);
const biggest = cmdKeys.sort((a,b)=>JSON.stringify(cmds[b]).length-JSON.stringify(cmds[a]).length)[0];
console.log(`  최대 항목 ${biggest}: ${(Buffer.byteLength(JSON.stringify(cmds[biggest]),'utf8')/1024).toFixed(2)}KB`);
