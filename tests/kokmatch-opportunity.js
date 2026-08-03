'use strict';
/**
 * "이은하에게 여복 기회가 실제로 있었나"를 셉니다.
 * 매 보충 시점의 '대기 중' 인원만으로 유효한 여복 4인 조합이 만들어지는지 검사.
 */
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const REPO = process.env.SIM_ENGINE_ROOT || path.join(__dirname, '..');
const {canonicalJson, issueOfficialGrant, refreshEvent} = require(`${REPO}/functions/daily-official-engine`);
const {replenishPrepared, effectiveLevel, TEAM_DIFF_LIMIT, PARTNER_GAP_HARD, PARTNER_GAP_SYMMETRY_LIMIT} = require(`${REPO}/functions/daily-server-matchmaker`);
const {applyCommandTransaction} = require(`${REPO}/functions/daily-official-command`);

const BASE_NOW = 1_830_000_000_000, MATCH_MINUTES = 15, COURTS = 3, WAVES = 16;
const CHECKIN_ID = 'DOPP0001', CLIENT_ID = 'official_opp_client';
const SECRET = 'kokmatch-opportunity-secret', ACTOR_NAME = '김민현';
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
    session:{serverSessionId:CHECKIN_ID, commandProtocol:2, serverRevision:0, matchStartedAt:BASE_NOW,
      expiresAt:BASE_NOW+48*3600_000, officialInvite:{tokenHash:'a'.repeat(64),expiresAt:BASE_NOW+48*3600_000},
      capabilities:{officialOpsServerV2:true, officialAutoHandoffV1:true, officialOperationUndoV1:true, memberStatusServerV1:true},
      players, reservations:[], arrivalCandidates:[],
      serverRuntime:{holds:{},nextSeq:1,fourCounts:{},exactCounts:{}},
      event:{courts:COURTS,nextTarget:COURTS,serverExpectedGoal:0,completed:0,finishMode:false,
        operationStarted:true,queuePolicy:{official:COURTS,auto:true},active:[],next:[],expected:[],serverStandby:[]}},
    officialClaims:{[CLIENT_ID]:{clientId:CLIENT_ID,expiresAt:BASE_NOW+48*3600_000,claimMode:'roster',officialPlayerId:actor.id}}
  }};
}
function submit(ctx, extra, now, label){
  const operationId = `o_${label}_${String(ctx.operationIndex++).padStart(5,'0')}`;
  const stored = {actorPlayerId:ctx.actorId, actorPlayerName:ACTOR_NAME, createdAt:now,
    expiresAt:now+30*60_000, source:'opportunity', operationId, ...extra};
  const outcome = applyCommandTransaction(ctx.state, {storedCommand:stored,
    engineCommand:{...stored, officialGrantToken:ctx.grant}, operationId, payloadHash:hash(stored),
    clientId:CLIENT_ID, grantPlayerId:ctx.actorId, now, checkinId:CHECKIN_ID, grantSecret:SECRET});
  assert.strictEqual(outcome.action,'commit',`${label}: ${outcome.failureMessage||''}`);
  ctx.state = outcome.current;
}

const gap = (a,b)=>Math.abs(effectiveLevel(a)-effectiveLevel(b));
function womensDoublesPossible(pool, mustInclude){
  const women = pool.filter(p=>p.gender==='F');
  if(women.length < 4)return false;
  const layouts=[[0,1,2,3],[0,2,1,3],[0,3,1,2]];
  for(let a=0;a<women.length-3;a++)for(let b=a+1;b<women.length-2;b++)
    for(let c=b+1;c<women.length-1;c++)for(let d=c+1;d<women.length;d++){
      const four=[women[a],women[b],women[c],women[d]];
      if(mustInclude && !four.some(p=>p.name===mustInclude))continue;
      const ok = layouts.some(L=>{
        const t1=[four[L[0]],four[L[1]]], t2=[four[L[2]],four[L[3]]];
        const g1=gap(t1[0],t1[1]), g2=gap(t2[0],t2[1]);
        if(g1>=PARTNER_GAP_HARD||g2>=PARTNER_GAP_HARD)return false;
        if(Math.abs(g1-g2)>PARTNER_GAP_SYMMETRY_LIMIT)return false;
        return Math.abs((t1[0].eff??effectiveLevel(t1[0]))+(effectiveLevel(t1[1]))-(effectiveLevel(t2[0])+effectiveLevel(t2[1])))<=TEAM_DIFF_LIMIT;
      });
      if(ok)return true;
    }
  return false;
}

const root = makeRoot();
const ctx = {state:root.current, actorId:root.actorId, grant:root.grant, operationIndex:1};
replenishPrepared(ctx.state.session,{now:BASE_NOW,requestId:'o_init'});
refreshEvent(ctx.state.session, BASE_NOW);
for(let c=0;c<COURTS;c++){
  refreshEvent(ctx.state.session, BASE_NOW);
  const item = ctx.state.session.event.next.find(r=>r.cueState==='free'&&r.targetCourt);
  if(!item)break;   // 첫 투입 뒤 남은 코트는 서버가 알아서 채웁니다
  submit(ctx,{type:'official-queue-enter-free',token:`i_${c+1}`,queueId:item.queueId||item.id,
    court:item.targetCourt,newMatchId:`i_match_${c+1}`,
    expectedQueueIndex:ctx.state.session.event.next.indexOf(item)+1,expectedHoldId:item.targetHoldId||'',
    expectedPlayerIds:[...item.playerIds],expectedTeam1Ids:[...item.t1Ids],expectedTeam2Ids:[...item.t2Ids]},BASE_NOW,`i_${c+1}`);
}

const TARGETS = ['이은하','장희선'];
const stats = Object.fromEntries(TARGETS.map(n=>[n,{waiting:0,anyWomensDoubles:0,ownWomensDoubles:0}]));
for(let wave=1;wave<=WAVES;wave++){
  const now = BASE_NOW + wave*MATCH_MINUTES*60_000;
  const waiting = ctx.state.session.players.filter(p=>p.status==='wait'&&!p.currentMatchId);
  const womenWaiting = waiting.filter(p=>p.gender==='F');
  for(const name of TARGETS){
    if(!waiting.some(p=>p.name===name))continue;
    stats[name].waiting++;
    if(womensDoublesPossible(waiting,null))stats[name].anyWomensDoubles++;
    if(womensDoublesPossible(waiting,name))stats[name].ownWomensDoubles++;
  }
  if(wave===1||wave===8||wave===16){
    console.log(`  ${wave}회차 대기 ${waiting.length}명(여성 ${womenWaiting.length}명): ${womenWaiting.map(p=>`${p.name}(${effectiveLevel(p)})`).join(' ')}`);
  }
  const matches = ctx.state.session.event.active.slice().sort((a,b)=>a.court-b.court);
  for(const m of matches){
    submit(ctx,{type:'official-court-complete',token:`c_${wave}_${m.court}`,matchId:m.id,court:m.court,
      expectedStartedAt:m.startedAt,expectedPlayerIds:[...m.playerIds]},now,`c_${wave}_${m.court}`);
  }
}
console.log('\n── 여복 기회 실측 (보충 시점 기준) ──');
for(const name of TARGETS){
  const s = stats[name];
  console.log(`  ${name}: 대기 상태였던 시점 ${s.waiting}회 / 그중 여복 자체가 성립한 시점 ${s.anyWomensDoubles}회 / 본인이 낄 수 있는 여복이 성립한 시점 ${s.ownWomensDoubles}회`);
}
