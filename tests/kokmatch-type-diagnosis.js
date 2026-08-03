'use strict';
/**
 * 민턴LIVE 종목 배분 / 반복 대진 진단
 * - 실제 클럽 36명 명부로 서버 매치메이커를 그대로 구동
 * - 측정: 종목 분포, 여성별 남복/여복/혼복, 파트너/상대 반복 분포
 */

const assert = require('assert');
const crypto = require('crypto');

const path = require('path');
const REPO = process.env.SIM_ENGINE_ROOT || path.join(__dirname, '..');
const {canonicalJson, issueOfficialGrant, refreshEvent} = require(`${REPO}/functions/daily-official-engine`);
const {effectiveLevel, replenishPrepared} = require(`${REPO}/functions/daily-server-matchmaker`);
const {applyCommandTransaction} = require(`${REPO}/functions/daily-official-command`);

const BASE_NOW = 1_830_000_000_000;
const MATCH_MINUTES = 15;
const COURTS = Number(process.env.SIM_COURTS || 3);
const WAVES = Number(process.env.SIM_WAVES || 16);
const CHECKIN_ID = 'DDIAG36';
const CLIENT_ID = 'official_diag_client';
const SECRET = 'kokmatch-type-diagnosis-secret';
const ACTOR_NAME = '김민현';

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
const GRADE_LEVEL = Object.freeze({S:7,A:6,B:5,C:4,D:3,E:2});

const hash = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');

function playerRows(){
  return ROSTER.map(([name,gender,grade,ageGroup],index)=>{
    const level = Math.max(1, GRADE_LEVEL[grade] - (gender === 'F' ? 1 : 0));
    return {
      id:`p${String(index+1).padStart(2,'0')}`, memberId:`member_p${index+1}`,
      name, gender, grade, level, ageGroup, isGuest:false,
      status:'wait', statusLabel:'wait', preArrivalVisible:false, registrationCancelled:false,
      locked:false, currentMatchId:'', afterMatchStatus:'', games:0, fairExpected:0,
      mixedGames:0, typeTrackedGames:0, lastPlayedSeq:0,
      partnerCount:{}, opponentCount:{}, partnerCountById:{}, opponentCountById:{},
      joinedAt:BASE_NOW, waitFrom:BASE_NOW, lastStatusAt:BASE_NOW-1000,
      restPausedMs:0, isClubOfficial:name===ACTOR_NAME, isTemporaryOfficial:false
    };
  });
}

function makeRoot(){
  const players = playerRows();
  const actor = players.find(row=>row.name===ACTOR_NAME);
  const grant = issueOfficialGrant({
    v:1, sid:CHECKIN_ID, cid:CLIENT_ID, pid:actor.id,
    iat:BASE_NOW-1000, exp:BASE_NOW+48*60*60_000
  }, SECRET);
  return {
    actorId:actor.id, grant,
    current:{
      session:{
        serverSessionId:CHECKIN_ID, commandProtocol:2, serverRevision:0,
        matchStartedAt:BASE_NOW, expiresAt:BASE_NOW+48*60*60_000,
        officialInvite:{tokenHash:'a'.repeat(64), expiresAt:BASE_NOW+48*60*60_000},
        capabilities:{officialOpsServerV2:true, officialAutoHandoffV1:true, officialOperationUndoV1:true, memberStatusServerV1:true},
        players, reservations:[], arrivalCandidates:[],
        serverRuntime:{holds:{}, nextSeq:1, fourCounts:{}, exactCounts:{}},
        event:{
          courts:COURTS, nextTarget:COURTS, serverExpectedGoal:0, completed:0,
          finishMode:false, operationStarted:true, queuePolicy:{official:COURTS, auto:true},
          plannedEndAt:BASE_NOW + WAVES * MATCH_MINUTES * 60_000,
          active:[], next:[], expected:[], serverStandby:[]
        }
      },
      officialClaims:{[CLIENT_ID]:{clientId:CLIENT_ID, expiresAt:BASE_NOW+48*60*60_000, claimMode:'roster', officialPlayerId:actor.id}}
    }
  };
}

function submit(context, extra, now, label){
  const operationId = `diag_${label}_${String(context.operationIndex++).padStart(5,'0')}`;
  const stored = {
    actorPlayerId:context.actorId, actorPlayerName:ACTOR_NAME, createdAt:now,
    expiresAt:now+30*60_000, source:'type-diagnosis', operationId, ...extra
  };
  const outcome = applyCommandTransaction(context.state, {
    storedCommand:stored, engineCommand:{...stored, officialGrantToken:context.grant},
    operationId, payloadHash:hash(stored), clientId:CLIENT_ID,
    grantPlayerId:context.actorId, now, checkinId:CHECKIN_ID, grantSecret:SECRET
  });
  assert.strictEqual(outcome.action, 'commit', `${label}: ${outcome.failureMessage||'커밋 실패'}`);
  assert.strictEqual(outcome.terminal.status, 'applied', `${label}: ${outcome.terminal.reason||'거절'}`);
  context.state = outcome.current;
  return outcome;
}

function startInitialMatches(context){
  replenishPrepared(context.state.session, {now:BASE_NOW, requestId:'diag_initial'});
  refreshEvent(context.state.session, BASE_NOW);
  for(let count=0;count<COURTS;count++){
    refreshEvent(context.state.session, BASE_NOW);
    const item = context.state.session.event.next.find(row=>row.cueState==='free' && row.targetCourt);
    if(!item)break;   // 첫 투입 뒤 남은 코트는 서버가 알아서 채웁니다
    submit(context, {
      type:'official-queue-enter-free', token:`initial_${count+1}`,
      queueId:item.queueId||item.id, court:item.targetCourt, newMatchId:`initial_match_${count+1}`,
      expectedQueueIndex:context.state.session.event.next.indexOf(item)+1,
      expectedHoldId:item.targetHoldId||'',
      expectedPlayerIds:[...item.playerIds], expectedTeam1Ids:[...item.t1Ids], expectedTeam2Ids:[...item.t2Ids]
    }, BASE_NOW, `initial_${count+1}`);
  }
}

function completeWave(context, now, waveIndex, finalWave){
  const matches = context.state.session.event.active.slice().sort((a,b)=>a.court-b.court);
  if(finalWave){
    context.state.session.event.finishMode = true;
    context.state.session.event.next = [];
    context.state.session.event.expected = [];
    context.state.session.event.serverStandby = [];
  }
  for(const match of matches){
    context.matchLog.push({
      wave:waveIndex, type:match.type,
      playerIds:[...match.playerIds], t1Ids:[...match.t1Ids], t2Ids:[...match.t2Ids]
    });
    submit(context, {
      type:'official-court-complete', token:`complete_${waveIndex}_${match.court}`,
      matchId:match.id, court:match.court,
      expectedStartedAt:match.startedAt, expectedPlayerIds:[...match.playerIds]
    }, now, `complete_${waveIndex}_${match.court}`);
  }
}

function run(){
  const root = makeRoot();
  const context = {state:root.current, actorId:root.actorId, grant:root.grant, operationIndex:1, matchLog:[]};
  startInitialMatches(context);
  for(let wave=1;wave<=WAVES;wave++){
    completeWave(context, BASE_NOW + wave*MATCH_MINUTES*60_000, wave, wave===WAVES);
  }
  return context;
}

// ── 리포트 ────────────────────────────────────────────────
const context = run();
const session = context.state.session;
const byId = new Map(session.players.map(row=>[row.id, row]));
const nameOf = id => byId.get(id)?.name || id;

const typeCounts = {};
const perPlayer = new Map();
const partnerPairs = new Map();
const opponentPairs = new Map();
const fourCounts = new Map();

session.players.forEach(row=>perPlayer.set(row.id, {name:row.name, gender:row.gender, grade:row.grade,
  eff:effectiveLevel(row), games:0, 남복:0, 여복:0, 혼복:0, 예외:0}));

for(const match of context.matchLog){
  typeCounts[match.type] = (typeCounts[match.type]||0)+1;
  match.playerIds.forEach(id=>{
    const row = perPlayer.get(id);
    row.games++;
    if(row[match.type] != null) row[match.type]++;
  });
  for(const team of [match.t1Ids, match.t2Ids]){
    const key = [...team].sort().join('|');
    partnerPairs.set(key, (partnerPairs.get(key)||0)+1);
  }
  for(const a of match.t1Ids) for(const b of match.t2Ids){
    const key = [a,b].sort().join('|');
    opponentPairs.set(key, (opponentPairs.get(key)||0)+1);
  }
  const fourKey = [...match.playerIds].sort().join('|');
  fourCounts.set(fourKey, (fourCounts.get(fourKey)||0)+1);
}

const rows = [...perPlayer.values()];
const women = rows.filter(r=>r.gender==='F');
const men = rows.filter(r=>r.gender==='M');

console.log(`\n════ 민턴LIVE 종목·반복 진단 (${COURTS}코트 × ${WAVES}회차 = ${context.matchLog.length}경기, ${rows.length}명) ════`);
console.log(`종목 분포: ${JSON.stringify(typeCounts)}`);
const totalSlots = context.matchLog.length*4;
const femaleSlots = rows.filter(r=>r.gender==='F').reduce((s,r)=>s+r.games,0);
console.log(`여성 슬롯 비중: ${femaleSlots}/${totalSlots} = ${(femaleSlots/totalSlots*100).toFixed(1)}% (명부 여성비 ${(women.length/rows.length*100).toFixed(1)}%)`);

console.log(`\n── 여성 선수별 종목 배분 (여복 오름차순) ──`);
[...women].sort((a,b)=>a.여복-b.여복 || b.혼복-a.혼복).forEach(r=>{
  const mixRate = r.games ? (r.혼복/r.games*100).toFixed(0) : '0';
  console.log(`  ${r.name.padEnd(4,'　')} ${r.grade} 유효${String(r.eff).padStart(4)} | ${String(r.games).padStart(2)}경기 · 여복 ${r.여복} · 혼복 ${r.혼복}(${mixRate}%) · 예외 ${r.예외}`);
});

console.log(`\n── 남성 선수별 종목 배분 (혼복 오름차순) ──`);
[...men].sort((a,b)=>a.혼복-b.혼복).forEach(r=>{
  console.log(`  ${r.name.padEnd(4,'　')} ${r.grade} 유효${String(r.eff).padStart(4)} | ${String(r.games).padStart(2)}경기 · 남복 ${r.남복} · 혼복 ${r.혼복} · 예외 ${r.예외}`);
});

console.log(`\n── 파트너 반복 상위 15 ──`);
[...partnerPairs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([key,count])=>{
  const [a,b] = key.split('|');
  const ga = byId.get(a).gender, gb = byId.get(b).gender;
  const kind = ga===gb ? (ga==='M'?'남복조':'여복조') : '혼복조';
  console.log(`  ${count}회  ${nameOf(a)} + ${nameOf(b)}  (${kind})`);
});
const partnerHist = {};
[...partnerPairs.values()].forEach(v=>{partnerHist[v]=(partnerHist[v]||0)+1;});
console.log(`  파트너 조합 반복 분포(횟수:조합수): ${JSON.stringify(partnerHist)}`);

console.log(`\n── 상대 반복 상위 10 ──`);
[...opponentPairs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([key,count])=>{
  const [a,b] = key.split('|');
  console.log(`  ${count}회  ${nameOf(a)} vs ${nameOf(b)}`);
});
const oppHist = {};
[...opponentPairs.values()].forEach(v=>{oppHist[v]=(oppHist[v]||0)+1;});
console.log(`  상대 반복 분포(횟수:조합수): ${JSON.stringify(oppHist)}`);

const repeatedFours = [...fourCounts.values()].filter(v=>v>1).length;
console.log(`\n── 같은 4인 재조합: ${repeatedFours}건 / 총 ${fourCounts.size}조합`);

const gamesArr = rows.map(r=>r.games);
console.log(`── 경기 수 min/max: ${Math.min(...gamesArr)}/${Math.max(...gamesArr)}`);
const wg = women.map(r=>r.games), mg = men.map(r=>r.games);
const avg = a=>(a.reduce((s,v)=>s+v,0)/a.length).toFixed(2);
console.log(`── 여성 경기 수 min/평균/max: ${Math.min(...wg)}/${avg(wg)}/${Math.max(...wg)}  |  남성: ${Math.min(...mg)}/${avg(mg)}/${Math.max(...mg)}`);
const half = Math.ceil(WAVES/2);
const early = context.matchLog.filter(m=>m.wave<=half), late = context.matchLog.filter(m=>m.wave>half);
const mixRate = a=>a.length?((a.filter(m=>m.type==='혼복').length/a.length)*100).toFixed(0):'-';
console.log(`── 혼복 비율 전반(1~${half}회차) ${mixRate(early)}%  →  후반(${half+1}~${WAVES}회차) ${mixRate(late)}%`);

// 남성 파트너 다양성: 각 남성이 함께 뛴 서로 다른 파트너 수
console.log(`\n── 파트너 다양성 (같이 뛴 서로 다른 파트너 수 / 경기 수) ──`);
const partnersOf = new Map();
rows.forEach(r=>partnersOf.set(r.name, new Set()));
for(const match of context.matchLog){
  for(const team of [match.t1Ids, match.t2Ids]){
    partnersOf.get(nameOf(team[0])).add(nameOf(team[1]));
    partnersOf.get(nameOf(team[1])).add(nameOf(team[0]));
  }
}
[...rows].sort((a,b)=>(partnersOf.get(a.name).size/Math.max(1,a.games))-(partnersOf.get(b.name).size/Math.max(1,b.games)))
  .slice(0,10).forEach(r=>{
    console.log(`  ${r.name.padEnd(4,'　')} ${r.gender} ${r.grade} | ${r.games}경기 · 파트너 ${partnersOf.get(r.name).size}명`);
  });
